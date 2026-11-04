import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/db/pool";
import { FLOW_COOKIE_OPTIONS, OAUTH_COOKIE_NAMES, fixedTimeEqual, googleOAuthConfig, verifyGoogleIdToken, verifySignedOAuthState } from "@/lib/google-oidc";
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
      !verifySignedOAuthState(state, process.env.MONSTERA_SESSION_SECRET ?? "") ||
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
    // Authenticate exclusively by Google OIDC subject, never by mutable email address.
    // An existing email-only account is deliberately NOT auto-linked (HTTP 409).
    const client = await getPool().connect();
    let user: { id: string; session_epoch: number } | undefined;
    try {
      await client.query("BEGIN");
      const account = await client.query<{ id: string; session_epoch: number }>(
        "INSERT INTO users(email, google_sub, email_verified_at) VALUES ($1, $2, now()) " +
        "ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, email_verified_at = now() " +
        "RETURNING id, session_epoch",
        [identity.email, identity.googleSubject],
      );
      user = account.rows[0];
      if (!user) throw new Error("ACCOUNT_CREATE_FAILED");
      // New accounts start with zero credits; never mint purchased credits at login.
      await client.query(
        "INSERT INTO credits(user_id, balance, reserved) VALUES ($1, 0, 0) ON CONFLICT (user_id) DO NOTHING",
        [user.id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        return errorResponse(409, "ACCOUNT_LINK_REQUIRED");
      }
      throw error;
    } finally { client.release(); }
    const response = clearFlow(NextResponse.redirect(config.origin));
    response.cookies.set(SESSION_COOKIE, newSessionCookie(user.id, user.session_epoch), sessionCookieOptions);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    // No upstream response body, ID token, authorization code or secrets are logged.
    return errorResponse(503, "AUTH_UNAVAILABLE");
  }
}
