import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions, authenticatedUser } from "@/lib/auth";
import { getPool } from "@/db/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });
  }
  let user;
  try { user = await authenticatedUser(request); }
  catch { return NextResponse.json({ code: "AUTH_UNAVAILABLE" }, { status: 503 }); }
  if (!user) return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  try {
    // Revoke every outstanding cookie for this user; no session table is required.
    await getPool().query(
      "UPDATE users SET session_epoch = session_epoch + 1 WHERE id = $1",
      [user.id],
    );
  } catch { return NextResponse.json({ code: "AUTH_UNAVAILABLE" }, { status: 503 }); }
  const response = NextResponse.json({ status: "signed_out" }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  return response;
}
