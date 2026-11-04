import { NextRequest } from "next/server";
import { authenticatedUser } from "@/lib/auth";
import { getPool } from "@/db/pool";
import type { Tier } from "@/lib/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rank: Record<Tier, number> = { free: 0, creator: 1, studio: 2 };

export async function GET(request: NextRequest): Promise<Response> {
  let user;
  try { user = await authenticatedUser(request); }
  catch { return Response.json({ code: "AUTH_UNAVAILABLE" }, { status: 503 }); }
  if (!user) return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  try {
    const rows = await getPool().query<{
      id: string; upstream_id: string; provider: string; tier_min: string; ctx: number;
    }>(
      "SELECT id, upstream_id, provider, tier_min, ctx FROM model_registry WHERE enabled = true ORDER BY provider, upstream_id LIMIT 100",
    );
    const models = rows.rows.filter(row =>
      row.tier_min in rank && rank[row.tier_min as Tier] <= rank[user.tier],
    ).map(row => ({
      id: row.id, label: row.upstream_id, provider: row.provider, context: row.ctx,
    }));
    return Response.json({ models, userId: user.id }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ code: "MODELS_UNAVAILABLE" }, { status: 503 });
  }
}
