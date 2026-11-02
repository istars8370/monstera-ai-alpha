import { NextRequest } from "next/server";
import { trustedOrigin } from "@/lib/request-origin";
import { fixedTimeEqual } from "@/lib/google-oidc";
import { reclaimExpired } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 운영 DB에는 접근하지 않는다. 수동 회수는 격리 테스트에서만 활성화한다.
export async function POST(request: NextRequest): Promise<Response> {
  if (process.env.MONSTERA_INTERNAL_CREDIT_TEST_MODE !== "true" ||
      process.env.NODE_ENV === "production") {
    return Response.json({ code: "CREDIT_RECLAIM_DISABLED" }, { status: 503 });
  }
  if (!trustedOrigin(request, true)) return Response.json({ code: "FORBIDDEN" }, { status: 403 });
  const key = process.env.MONSTERA_RECLAIM_OPERATOR_KEY;
  const provided = request.headers.get("authorization");
  if (!key || Buffer.byteLength(key, "utf8") < 32 ||
      !provided?.startsWith("Bearer ") ||
      !fixedTimeEqual(provided.slice(7), key)) {
    return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const reclaimed = await reclaimExpired(100);
    return Response.json({ reclaimed }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ code: "RECLAIM_UNAVAILABLE" }, { status: 503 });
  }
}
