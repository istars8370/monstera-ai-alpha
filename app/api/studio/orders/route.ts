import { NextRequest, NextResponse } from "next/server";
import { trustedOrigin } from "@/lib/request-origin";
import { studioHttpError, studioNoSession, studioSession, studioWrongOrigin } from "@/lib/studio/http";
import { readStudioJson } from "@/lib/studio/request";
import { createOrder, listOrders } from "@/lib/studio/orders";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest) {
  try {
    const user=await studioSession(request);
    if(!user)return studioNoSession();
    if(user.tier!=="studio")return NextResponse.json({code:"TIER_FORBIDDEN"},{status:403});
    return NextResponse.json({orders:await listOrders(user.id)},{headers:{"Cache-Control":"no-store"}});
  } catch(error){return studioHttpError(error);}
}
export async function POST(request:NextRequest) {
  if(!trustedOrigin(request,true))return studioWrongOrigin();
  try {
    const user=await studioSession(request);
    if(!user)return studioNoSession();
    if(user.tier!=="studio")return NextResponse.json({code:"TIER_FORBIDDEN"},{status:403});
    const input=await readStudioJson(request,8192);
    const order=await createOrder(user.id,input);
    return NextResponse.json({order,note:"수금은 운영자 수기 기록이며 실제 결제·검증 영수증이 아닙니다."},
      {status:201,headers:{"Cache-Control":"no-store"}});
  } catch(error){return studioHttpError(error);}
}
