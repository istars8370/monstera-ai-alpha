import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/db/pool";
import { FLOW_COOKIE_OPTIONS, OAUTH_COOKIE_NAMES, fixedTimeEqual, googleOAuthConfig, verifyGoogleIdToken } from "@/lib/google-oidc";
import { newSessionCookie, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clearFlow(response: NextResponse): NextResponse {
  for (const name of Object.values(OAUTH_COOKIE_NAMES)) {
    response.cookies.set(name, "", { ...FLOW_COOKIE_OPTIONS, maxAge: 0 });
  }
  return response;
}
function errorResponse(status: number, code = "SIGN_IN_FAILED"): NextResponse {
  return clearFlow(NextResponse.json({ code }, { status, headers: { "Cache-Control": "no-store" } }));
}
export async function GET(request: NextRequest): Promise<NextResponse> {
  const query = request.nextUrl.searchParams;
  const state = request.cookies.get(OAUTH_COOKIE_NAMES.state)?.value;
  const nonce = request.cookies.get(OAUTH_COOKIE_NAMES.nonce)?.value;
  const verifier = request.cookies.get(OAUTH_COOKIE_NAMES.verifier)?.value;
  const code = query.get("code");
  if (query.has("error") || !fixedTimeEqual(query.get("state") ?? undefined, state) ||
      !nonce || !verifier || !code || code.length > 4096) return errorResponse(401);
  try {
    const config = googleOAuthConfig();
    const form = new URLSearchParams({
      code, client_id: config.clientId, client_secret: config.clientSecret,
      code_verifier: verifier, redirect_uri: config.redirectUri, grant_type: "authorization_code",
    });
    const result = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form, cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (!result.ok) return errorResponse(401);
    const payload: unknown = await result.json();
    if (!payload || typeof payload !== "object" || !("id_token" in payload) ||
        typeof payload.id_token !== "string") return errorResponse(401);
    const identity = await verifyGoogleIdToken(payload.id_token, config.clientId, nonce);
    const account = await getPool().query<{ id: string; session_epoch: number }>(
      "INSERT INTO users(email, email_verified_at) VALUES ($1, now()) " +
      "ON CONFLICT (email) DO UPDATE SET email_verified_at = COALESCE(users.email_verified_at, excluded.email_verified_at) " +
      "RETURNING id, session_epoch",
      [identity.email],
    );
    const user = account.rows[0];
    if (!user) return errorResponse(503, "AUTH_UNAVAILABLE");
    const response = clearFlow(NextResponse.redirect(config.origin));
    response.cookies.set(SESSION_COOKIE, newSessionCookie(user.id, user.session_epoch), sessionCookieOptions);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    // No upstream response body, ID token, authorization code or secrets are logged.
    return errorResponse(503, "AUTH_UNAVAILABLE");
  }
}
