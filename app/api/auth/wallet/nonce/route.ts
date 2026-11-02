import { NextResponse } from "next/server";
import { issueWalletChallenge } from "@/lib/solana-wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const SIWS_COOKIE = "monstera_siws_nonce";

export const SIWS_COOKIE_OPTIONS = {
  httpOnly: true, sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/api/auth/wallet", maxAge: 300,
};

// 서버에 서명용 프라이빗 키는 없으며 챌린지만 5분짜리 쿠키로 발급한다.
export function GET(): NextResponse {
  try {
    const { challenge, cookie } = issueWalletChallenge(process.env.MONSTERA_SESSION_SECRET ?? "");
    const response = NextResponse.json({
      nonce: challenge.nonce,
      issuedAt: new Date(challenge.issuedAt).toISOString(),
      domain: challenge.domain,
    }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(SIWS_COOKIE, cookie, SIWS_COOKIE_OPTIONS);
    return response;
  } catch {
    return NextResponse.json({ code: "SIWS_NOT_CONFIGURED" }, { status: 503 });
  }
}
