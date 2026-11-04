import { NextRequest, NextResponse } from "next/server";
import { trustedOrigin } from "@/lib/request-origin";
import { readStudioJson } from "@/lib/studio/request";
import { studioHttpError, studioNoSession, studioSession, studioWrongOrigin } from "@/lib/studio/http";
import { importMockJobAsDraft } from "@/lib/studio/drafts";
import { mockStudioEnabled } from "@/lib/studio/mock-gate";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};

export async function POST(request:NextRequest,context:Context) {
  if(!trustedOrigin(request,true))return studioWrongOrigin();
  try {
    const user=await studioSession(request);
    if(!user)return studioNoSession();
    if(!mockStudioEnabled()){
      return NextResponse.json({code:"GENERATION_NOT_ENABLED"},{status:501,headers:{"Cache-Control":"no-store"}});
    }
    const {id}=await context.params;
    const body=await readStudioJson(request,8192) as Record<string,unknown>;
    const draft=await importMockJobAsDraft(user.id,id,body.brief);
    return NextResponse.json({draft,mockOnly:true},{status:200,headers:{"Cache-Control":"no-store"}});
  }catch(error){return studioHttpError(error);}
}
