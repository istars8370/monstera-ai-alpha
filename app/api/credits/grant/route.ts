import { NextRequest } from "next/server";
import { authenticatedUser } from "@/lib/auth";
import { getPool } from "@/db/pool";
import { trustedOrigin } from "@/lib/request-origin";
import { fetchWalletTier, type WalletTier } from "@/lib/solana-wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configuredGrant(tier: WalletTier): number {
  const key = "MONSTERA_DAILY_GRANT_" + tier.toUpperCase();
  const raw = process.env[key];
  if (!raw) return 0;
  if (!/^(?:0|[1-9][0-9]*)$/.test(raw)) throw new Error("INVALID_GRANT_POLICY");
  const amount = Number(raw);
  if (!Number.isSafeInteger(amount) || amount > 1_000_000) throw new Error("INVALID_GRANT_POLICY");
  return amount;
}

// 소유권 검증은 서명으로 완료된 지갑 주소만 DB에서 읽는다.
// 클라이언트의 userId, tier, token balance를 절대 신뢰하지 않는다.
export async function POST(request: NextRequest): Promise<Response> {
  if (!trustedOrigin(request, true)) return Response.json({ code: "FORBIDDEN" }, { status: 403 });
  let user;
  try { user = await authenticatedUser(request); }
  catch { return Response.json({ code: "AUTH_UNAVAILABLE" }, { status: 503 }); }
  if (!user) return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  const pool = getPool();
  let wallet: string;
  try {
    const result = await pool.query<{ wallet_address: string | null }>(
      "SELECT wallet_address FROM users WHERE id = $1", [user.id],
    );
    if (!result.rows[0]?.wallet_address) {
      return Response.json({ code: "WALLET_REQUIRED" }, { status: 403 });
    }
    wallet = result.rows[0].wallet_address;
  } catch {
    return Response.json({ code: "GRANT_UNAVAILABLE" }, { status: 503 });
  }
  let tier: WalletTier;
  try { tier = await fetchWalletTier(wallet); }
  catch {
    // RPC 실패 시 티어만 free로 강등, 크레딧 잔액 및 예약은 그대로 둔다.
    try {
      const updated = await pool.query("UPDATE users SET tier = 'free' WHERE id = $1", [user.id]);
      if (updated.rowCount !== 1) throw new Error("USER_INVARIANT_BROKEN");
    } catch { return Response.json({ code: "GRANT_UNAVAILABLE" }, { status: 503 }); }
    return Response.json({ code: "SOLANA_RPC_UNAVAILABLE", tier: "free", granted: 0 }, { status: 503 });
  }
  let grant: number;
  try { grant = configuredGrant(tier); }
  catch { return Response.json({ code: "INVALID_GRANT_POLICY" }, { status: 503 }); }

  const day = new Date().toISOString().slice(0, 10);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "UPDATE users SET tier = $1 WHERE id = $2 AND wallet_address = $3",
      [tier, user.id, wallet],
    );
    if (current.rowCount !== 1) throw new Error("USER_INVARIANT_BROKEN");
    if (grant === 0) {
      await client.query("COMMIT");
      return Response.json({ tier, granted: 0, alreadyGranted: false });
    }
    const record = await client.query<{ user_id: string }>(
      "INSERT INTO wallet_grants(user_id, day) VALUES ($1, $2) " +
      "ON CONFLICT (user_id, day) DO NOTHING RETURNING user_id",
      [user.id, day],
    );
    if (record.rowCount === 0) {
      await client.query("COMMIT");
      return Response.json({ tier, granted: 0, alreadyGranted: true });
    }
    if (record.rowCount !== 1) throw new Error("WALLET_GRANT_INVARIANT_BROKEN");
    const changed = await client.query(
      "UPDATE credits SET balance = balance + $1, updated_at = now() " +
      "WHERE user_id = $2 AND balance <= 2147483647 - $1",
      [grant, user.id],
    );
    if (changed.rowCount !== 1) throw new Error("CREDIT_INVARIANT_BROKEN");
    const marked = await client.query(
      "UPDATE users SET last_grant_day = $1 WHERE id = $2", [day, user.id],
    );
    if (marked.rowCount !== 1) throw new Error("USER_INVARIANT_BROKEN");
    await client.query("COMMIT");
    return Response.json({ tier, granted: grant, alreadyGranted: false }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return Response.json({ code: "GRANT_UNAVAILABLE" }, { status: 503 });
  } finally { client.release(); }
}
