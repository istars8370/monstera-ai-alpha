import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { authenticatedUser, newSessionCookie, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { getPool } from "@/db/pool";
import { trustedOrigin } from "@/lib/request-origin";
import {
  consumeWalletNonce, verifyWalletChallenge, verifyWalletSignature, walletSigningMessage,
} from "@/lib/solana-wallet";
import { SIWS_COOKIE, SIWS_COOKIE_OPTIONS } from "@/app/api/auth/wallet/nonce/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function respond(status: number, code: string, identity?: { id: string; epoch: number }): NextResponse {
  const result = NextResponse.json(
    identity ? { status: "authenticated", userId: identity.id } : { code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
  // 성공과 실패 모두에서 브라우저의 원본 챌린지를 소비한다.
  result.cookies.set(SIWS_COOKIE, "", { ...SIWS_COOKIE_OPTIONS, maxAge: 0 });
  if (identity) result.cookies.set(SESSION_COOKIE, newSessionCookie(identity.id, identity.epoch), sessionCookieOptions);
  return result;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!trustedOrigin(request, true)) return respond(403, "FORBIDDEN");
  if (!request.headers.get("content-type")?.startsWith("application/json")) return respond(415, "INVALID_CONTENT_TYPE");
  if (Number(request.headers.get("content-length") || 0) > 2048) return respond(413, "TOO_LARGE");
  let data: unknown;
  try {
    const text = await request.text();
    if (text.length > 2048) return respond(413, "TOO_LARGE");
    data = JSON.parse(text);
  } catch { return respond(400, "INVALID_JSON"); }
  if (!data || typeof data !== "object") return respond(400, "INVALID_SIGNATURE");
  const input = data as Record<string, unknown>;
  if (typeof input.walletAddress !== "string" || typeof input.signature !== "string" ||
      input.signature.length > 96) return respond(400, "INVALID_SIGNATURE");
  const challenge = verifyWalletChallenge(
    request.cookies.get(SIWS_COOKIE)?.value, process.env.MONSTERA_SESSION_SECRET ?? "",
  );
  if (!challenge) return respond(401, "INVALID_NONCE");
  if (!verifyWalletSignature(input.walletAddress, input.signature,
    walletSigningMessage(challenge, input.walletAddress))) return respond(401, "INVALID_SIGNATURE");
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const namespace = process.env.MONSTERA_REDIS_NAMESPACE;
  if (!redisUrl || !redisToken || !namespace) return respond(503, "SIWS_REDIS_NOT_CONFIGURED");
  try {
    const redis = new Redis({ url: redisUrl, token: redisToken });
    const consume = await consumeWalletNonce(
      request.cookies.get(SIWS_COOKIE)!.value, (lua, keys, args) => redis.eval(lua, keys, args), namespace,
    );
    if (!consume) return respond(401, "INVALID_NONCE");
    // 클라이언트가 전달한 userId/tier는 사용하지 않는다.
    const current = await authenticatedUser(request);
    const pool = getPool();
    const found = await pool.query<{ id: string; session_epoch: number }>(
      "SELECT id, session_epoch FROM users WHERE wallet_address = $1 LIMIT 1", [input.walletAddress],
    );
    const owner = found.rows[0];
    if (owner && current && owner.id !== current.id) return respond(409, "WALLET_ALREADY_LINKED");
    if (!owner && !current) return respond(401, "WALLET_LINK_REQUIRED");
    if (current) {
      const linked = await pool.query<{ id: string; session_epoch: number }>(
        "UPDATE users SET wallet_address = $1, wallet_verified_at = now() " +
        "WHERE id = $2 AND (wallet_address IS NULL OR wallet_address = $1) " +
        "RETURNING id, session_epoch",
        [input.walletAddress, current.id],
      );
      const result = linked.rows[0];
      if (linked.rowCount !== 1 || !result) return respond(409, "WALLET_RELINK_REQUIRES_REVIEW");
      return respond(200, "OK", { id: result.id, epoch: result.session_epoch });
    }
    const updated = await pool.query<{ id: string; session_epoch: number }>(
      "UPDATE users SET wallet_verified_at = now() WHERE id = $1 RETURNING id, session_epoch",
      [owner!.id],
    );
    if (updated.rowCount !== 1 || !updated.rows[0]) throw new Error("WALLET_ACCOUNT_NOT_FOUND");
    return respond(200, "OK", { id: updated.rows[0].id, epoch: updated.rows[0].session_epoch });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return respond(409, "WALLET_ALREADY_LINKED");
    }
    return respond(503, "SIWS_UNAVAILABLE");
  }
}
