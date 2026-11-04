import { NextRequest, NextResponse } from "next/server";
import { trustedOrigin } from "@/lib/request-origin";
import { readStudioJson } from "@/lib/studio/request";
import { studioHttpError, studioNoSession, studioSession, studioWrongOrigin } from "@/lib/studio/http";
import { enforceModalityTier, parseGenerationPreflight } from "@/lib/studio/generation-policy";
import { submitMockGeneration } from "@/lib/studio/mock-generation";
import { mockStudioEnabled } from "@/lib/studio/mock-gate";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request:NextRequest):Promise<NextResponse> {
  if(!trustedOrigin(request,true))return studioWrongOrigin();
  let user;
  try{user=await studioSession(request);}
  catch{return NextResponse.json({code:"STUDIO_UNAVAILABLE"},{status:503,headers:{"Cache-Control":"no-store"}});}
  if(!user)return studioNoSession();
  try {
    const body=await readStudioJson(request,64*1024);
    const input=parseGenerationPreflight(body);
    enforceModalityTier(input.modality,user.tier);
    if(input.modality!=="text" || !mockStudioEnabled()){
      return NextResponse.json({code:"GENERATION_NOT_ENABLED"},
        {status:501,headers:{"Cache-Control":"no-store"}});
    }
    const submitted=await submitMockGeneration(user.id,user.tier,body);
    return NextResponse.json({
      jobId:submitted.job.id,status:submitted.job.status,mockOnly:true,
      reservedCredits:submitted.maximumReservedCredits,
      note:"Mock 작업만 예약했습니다. 실제 AI 호출과 배포는 실행하지 않습니다.",
    },{status:202,headers:{"Cache-Control":"no-store"}});
  }catch(error){return studioHttpError(error);}
}
