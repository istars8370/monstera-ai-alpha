import { createHmac, timingSafeEqual } from "node:crypto";

// HMAC-authenticated sessions contain only an opaque database UUID and revocation epoch.
export interface SessionClaims {
  v: 1;
  sub: string;
  epoch: number;
  iat: number;
  exp: number;
}
export const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const b64url = /^[A-Za-z0-9_-]+$/;

function checkedSecret(secret: string): string {
  if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("SESSION_SECRET_TOO_SHORT");
  return secret;
}
function mac(data: string, secret: string): Buffer {
  return createHmac("sha256", checkedSecret(secret)).update(data).digest();
}
export function createSessionToken(sub: string, epoch: number, secret: string, now = Math.floor(Date.now() / 1000)): string {
  if (!uuid.test(sub) || !Number.isSafeInteger(epoch) || epoch < 0) throw new Error("INVALID_SESSION_INPUT");
  const claims: SessionClaims = { v: 1, sub, epoch, iat: now, exp: now + SESSION_LIFETIME_SECONDS };
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return encoded + "." + mac(encoded, secret).toString("base64url");
}
export function readSessionToken(token: string | undefined, secret: string, now = Math.floor(Date.now() / 1000)): SessionClaims | null {
  if (!token || token.length > 2048) return null;
  const pieces = token.split(".");
  if (pieces.length !== 2 || !pieces.every(p => p.length > 0 && b64url.test(p))) return null;
  const [body, signed] = pieces;
  const expected = mac(body, secret);
  const actual = Buffer.from(signed, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!value || typeof value !== "object") return null;
    const c = value as Partial<SessionClaims>;
    if (c.v !== 1 || typeof c.sub !== "string" || !uuid.test(c.sub)) return null;
    if (!Number.isSafeInteger(c.epoch) || (c.epoch ?? -1) < 0) return null;
    if (!Number.isSafeInteger(c.iat) || !Number.isSafeInteger(c.exp)) return null;
    if (c.iat! > now + 60 || c.exp! <= now || c.exp! - c.iat! > SESSION_LIFETIME_SECONDS) return null;
    return c as SessionClaims;
  } catch {
    return null;
  }
}
