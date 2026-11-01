import type { NextRequest } from "next/server";
import { getPool } from "@/db/pool";
import type { Tier } from "@/lib/router";
import { createSessionToken, readSessionToken, SESSION_LIFETIME_SECONDS } from "@/lib/session-token";

export const SESSION_COOKIE = "monstera_session";
const allowedTiers = new Set<Tier>(["free", "creator", "studio"]);

function sessionSecret(): string {
  const value = process.env.MONSTERA_SESSION_SECRET;
  if (!value || Buffer.byteLength(value, "utf8") < 32) throw new Error("AUTH_NOT_CONFIGURED");
  return value;
}
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_LIFETIME_SECONDS,
};
export function newSessionCookie(userId: string, epoch: number): string {
  return createSessionToken(userId, epoch, sessionSecret());
}
export interface AuthenticatedUser {
  id: string;
  tier: Tier;
}

// Never derive identity or subscription tier from headers or request JSON.
export async function authenticatedUser(request: NextRequest): Promise<AuthenticatedUser | null> {
  const token = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value, sessionSecret());
  if (!token) return null;
  const result = await getPool().query<{
    id: string; tier: string; session_epoch: number; email_verified_at: Date | null;
  }>(
    "SELECT id, tier, session_epoch, email_verified_at FROM users WHERE id = $1 LIMIT 1",
    [token.sub],
  );
  const user = result.rows[0];
  if (!user || user.session_epoch !== token.epoch || !user.email_verified_at || !allowedTiers.has(user.tier as Tier)) return null;
  return { id: user.id, tier: user.tier as Tier };
}
