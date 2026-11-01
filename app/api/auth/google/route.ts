import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { googleOAuthConfig } from "@/lib/google-oidc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const FLOW_COOKIE_OPTIONS = {
  httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production",
  path: "/api/auth/google", maxAge: 600,
};
export const OAUTH_COOKIE_NAMES = {
  state: "monstera_oauth_state", nonce: "monstera_oauth_nonce", verifier: "monstera_oauth_verifier",
};
export function GET(): NextResponse {
  let config;
  try { config = googleOAuthConfig(); }
  catch { return NextResponse.json({ code: "AUTH_NOT_CONFIGURED" }, { status: 503 }); }
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(OAUTH_COOKIE_NAMES.state, state, FLOW_COOKIE_OPTIONS);
  response.cookies.set(OAUTH_COOKIE_NAMES.nonce, nonce, FLOW_COOKIE_OPTIONS);
  response.cookies.set(OAUTH_COOKIE_NAMES.verifier, verifier, FLOW_COOKIE_OPTIONS);
  return response;
}
