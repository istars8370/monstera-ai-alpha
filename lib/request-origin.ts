import type { NextRequest } from "next/server";

// Next can rewrite its internal request origin behind a reverse proxy.
// Use an explicitly configured public origin for CSRF checks, never X-Forwarded-Host.
export function trustedOrigin(request: NextRequest, requireOrigin = false): boolean {
  const supplied = request.headers.get("origin");
  if (!supplied) return !requireOrigin;
  const configured = process.env.MONSTERA_PUBLIC_ORIGIN;
  if (!configured) return process.env.NODE_ENV !== "production" && supplied === request.nextUrl.origin;
  try {
    const url = new URL(configured);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
        url.pathname !== "/" || url.search || url.hash || url.username || url.password) return false;
    return supplied === url.origin;
  } catch { return false; }
}
