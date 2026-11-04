import { NextRequest } from "next/server";
import { authenticatedUser } from "@/lib/auth";
import { getPool } from "@/db/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only personal balance endpoint. Never accepts userId or tier from the client.
export async function GET(request: NextRequest): Promise<Response> {
  let user;
  try { user = await authenticatedUser(request); }
  catch { return Response.json({ code: "AUTH_UNAVAILABLE" }, { status: 503 }); }
  if (!user) return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  try {
    const result = await getPool().query<{ balance: number; reserved: number }>(
      "SELECT balance, reserved FROM credits WHERE user_id = $1 LIMIT 1", [user.id],
    );
    const balance = result.rows[0]?.balance ?? 0;
    const reserved = result.rows[0]?.reserved ?? 0;
    return Response.json({ balance, reserved, available: balance - reserved }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ code: "CREDITS_UNAVAILABLE" }, { status: 503 });
  }
}
