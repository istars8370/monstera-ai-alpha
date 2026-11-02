import { NextRequest, NextResponse } from "next/server";
import { authenticatedUser } from "@/lib/auth";
import { trustedOrigin } from "@/lib/request-origin";
import { calculateQuote, type QuoteInput } from "@/lib/studio/quote";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({error:"UNAUTHENTICATED"},{status:401});
    if (user.tier !== "studio") return NextResponse.json({error:"TIER_FORBIDDEN"},{status:403});
    if (!trustedOrigin(request,true)) return NextResponse.json({error:"INVALID_ORIGIN"},{status:403});
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return NextResponse.json({error:"INVALID_CONTENT_TYPE"},{status:415});
    const raw = await request.text();
    if (Buffer.byteLength(raw,"utf8")>8192) return NextResponse.json({error:"TOO_LARGE"},{status:413});
    let value: unknown;
    try { value=JSON.parse(raw); } catch {return NextResponse.json({error:"INVALID_JSON"},{status:400});}
    const result=calculateQuote(value as QuoteInput);
    return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    if (error instanceof RangeError) return NextResponse.json({error:"INVALID_QUOTE"},{status:400});
    return NextResponse.json({error:"STUDIO_UNAVAILABLE"},{status:503});
  }
}
