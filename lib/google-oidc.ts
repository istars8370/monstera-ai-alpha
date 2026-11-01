import { createHmac, createPublicKey, timingSafeEqual, verify as verifySignature } from "node:crypto";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  origin: string;
  redirectUri: string;
}

export function googleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const publicOrigin = process.env.MONSTERA_PUBLIC_ORIGIN;
  if (!clientId || !clientSecret || !publicOrigin) throw new Error("GOOGLE_OAUTH_NOT_CONFIGURED");
  let url: URL;
  try { url = new URL(publicOrigin); } catch { throw new Error("INVALID_PUBLIC_ORIGIN"); }
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
      url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("INVALID_PUBLIC_ORIGIN");
  }
  return { clientId, clientSecret, origin: url.origin, redirectUri: url.origin + "/api/auth/google/callback" };
}
export function fixedTimeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

// A signed state proves that OAuth began behind the private alpha access gate.
// The callback itself cannot require Basic credentials after a Google redirect.
export function signOAuthState(random: string, secret: string): string {
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(random) || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("INVALID_OAUTH_STATE_SECRET");
  }
  const signature = createHmac("sha256", secret).update("monstera-oauth-state-v1:" + random).digest("base64url");
  return random + "." + signature;
}
export function verifySignedOAuthState(value: string | undefined, secret: string): boolean {
  if (!value || Buffer.byteLength(secret, "utf8") < 32) return false;
  const parts = value.split(".");
  if (parts.length !== 2) return false;
  try { return fixedTimeEqual(value, signOAuthState(parts[0], secret)); }
  catch { return false; }
}

export async function verifyGoogleIdToken(
  token: string, clientId: string, nonce: string, fetcher: typeof fetch = fetch, now = Math.floor(Date.now() / 1000),
): Promise<{ email: string; googleSubject: string }> {
  if (token.length > 12000) throw new Error("INVALID_ID_TOKEN");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error("INVALID_ID_TOKEN");
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Record<string, unknown>;
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch { throw new Error("INVALID_ID_TOKEN"); }
  if (!header || header.alg !== "RS256" || typeof header.kid !== "string" || !claims) throw new Error("INVALID_ID_TOKEN");
  const response = await fetcher("https://www.googleapis.com/oauth2/v3/certs", {
    signal: AbortSignal.timeout(8000), cache: "no-store",
  });
  if (!response.ok) throw new Error("JWKS_UNAVAILABLE");
  const jwks: unknown = await response.json();
  if (!jwks || typeof jwks !== "object" || !("keys" in jwks) || !Array.isArray(jwks.keys)) throw new Error("INVALID_JWKS");
  const jwk = jwks.keys.find((key: unknown): key is JsonWebKey =>
    !!key && typeof key === "object" && "kid" in key &&
    key.kid === header.kid && "kty" in key && key.kty === "RSA" &&
    "use" in key && key.use === "sig" && "n" in key && "e" in key,
  ) as import("node:crypto").JsonWebKey | undefined;
  if (!jwk) throw new Error("UNKNOWN_SIGNING_KEY");
  let authentic: boolean;
  try {
    authentic = verifySignature("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]),
      createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
  } catch { throw new Error("INVALID_ID_TOKEN"); }
  if (!authentic) throw new Error("INVALID_ID_TOKEN");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(String(claims.iss)) ||
      claims.aud !== clientId || claims.nonce !== nonce ||
      typeof claims.exp !== "number" || claims.exp <= now ||
      typeof claims.iat !== "number" || claims.iat > now + 60 ||
      claims.email_verified !== true ||
      typeof claims.email !== "string" || claims.email.length > 320 ||
      !/^[^\s@]+@[^\s@]+$/.test(claims.email) ||
      typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) {
    throw new Error("INVALID_ID_TOKEN_CLAIMS");
  }
  return { email: claims.email.toLowerCase(), googleSubject: claims.sub };
}

export const FLOW_COOKIE_OPTIONS = {
  httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production",
  path: "/api/auth/google", maxAge: 600,
};
export const OAUTH_COOKIE_NAMES = {
  state: "monstera_oauth_state", nonce: "monstera_oauth_nonce", verifier: "monstera_oauth_verifier",
};
