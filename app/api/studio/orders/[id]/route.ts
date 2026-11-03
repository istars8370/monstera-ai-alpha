import { NextRequest, NextResponse } from "next/server";
import { trustedOrigin } from "@/lib/request-origin";
import { studioHttpError, studioNoSession, studioSession, studioWrongOrigin } from "@/lib/studio/http";
import { readStudioJson } from "@/lib/studio/request";
import { getOrder, updateOrder } from "@/lib/studio/orders";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
export async function GET(request:NextRequest,context:Context) {
  try {
    const user=await studioSession(request);
    if(!user)return studioNoSession();
    if(user.tier!=="studio")return NextResponse.json({code:"TIER_FORBIDDEN"},{status:403});
    const {id}=await context.params;
    return NextResponse.json({order:await getOrder(user.id,id)},{headers:{"Cache-Control":"no-store"}});
  } catch(error){return studioHttpError(error);}
}
export async function PATCH(request:NextRequest,context:Context) {
  if(!trustedOrigin(request,true))return studioWrongOrigin();
  try {
    const user=await studioSession(request);
    if(!user)return studioNoSession();
    if(user.tier!=="studio")return NextResponse.json({code:"TIER_FORBIDDEN"},{status:403});
    const {id}=await context.params;
    const body=await readStudioJson(request,8192) as Record<string,unknown>;
    const order=await updateOrder(user.id,id,body.revision as number,body.order);
    return NextResponse.json({order},{headers:{"Cache-Control":"no-store"}});
  } catch(error){return studioHttpError(error);}
}
