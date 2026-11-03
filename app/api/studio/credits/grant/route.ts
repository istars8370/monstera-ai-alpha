import { NextRequest, NextResponse } from "next/server";
import { trustedOrigin } from "@/lib/request-origin";
import { studioHttpError, studioNoSession, studioSession, studioWrongOrigin } from "@/lib/studio/http";
import { claimDailyGrant } from "@/lib/studio/grants";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest) {
  if(!trustedOrigin(request,true))return studioWrongOrigin();
  try {
    const user=await studioSession(request);
    if(!user)return studioNoSession();
    // No client-supplied tier, user ID, grant size or time value is accepted.
    if(request.body) return NextResponse.json({code:"INVALID_GRANT_BODY"},{status:400});
    const grant=await claimDailyGrant(user.id,user.tier);
    return NextResponse.json(grant,{headers:{"Cache-Control":"no-store"}});
  } catch(error){return studioHttpError(error);}
}
