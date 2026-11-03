import { NextRequest, NextResponse } from "next/server";
import { authenticatedUser } from "@/lib/auth";
import { trustedOrigin } from "@/lib/request-origin";
import { calculateQuote, type QuoteInput } from "@/lib/studio/quote";
import { readStudioJson } from "@/lib/studio/request";
import { StudioInputError } from "@/lib/studio/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!trustedOrigin(request, true)) return NextResponse.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  let user;
  try {
    user = await authenticatedUser(request);
  } catch {
    return NextResponse.json({ code: "STUDIO_UNAVAILABLE" }, { status: 503 });
  }
  if (!user) return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  if (user.tier !== "studio") return NextResponse.json({ code: "TIER_FORBIDDEN" }, { status: 403 });

  try {
    const value = await readStudioJson(request, 8192);
    const result = calculateQuote(value as unknown as QuoteInput);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StudioInputError && error.status >= 400 && error.status < 500) {
      return NextResponse.json({ code: "INVALID_STUDIO_REQUEST" }, { status: error.status });
    }
    if (error instanceof RangeError) return NextResponse.json({ code: "INVALID_QUOTE" }, { status: 400 });
    return NextResponse.json({ code: "STUDIO_UNAVAILABLE" }, { status: 503 });
  }
}
