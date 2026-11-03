import { NextRequest, NextResponse } from "next/server";
import { trustedOrigin } from "@/lib/request-origin";
import { readStudioJson } from "@/lib/studio/request";
import { studioHttpError, studioNoSession, studioSession, studioWrongOrigin } from "@/lib/studio/http";
import {
  enforceModalityTier, evaluateStudioTextPreflight, parseGenerationPreflight,
} from "@/lib/studio/generation-policy";
import { StudioInputError } from "@/lib/studio/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Safe, read-only gate for a future text worker. It does not call OpenAI, reserve
 * a credit, write a job, or trigger an async task. Real generation is not enabled.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!trustedOrigin(request, true)) return studioWrongOrigin();
  let user;
  try { user = await studioSession(request); }
  catch { return NextResponse.json({code:"STUDIO_UNAVAILABLE"},{status:503,headers:{"Cache-Control":"no-store"}}); }
  if (!user) return studioNoSession();
  try {
    const body = await readStudioJson(request, 64 * 1024);
    const input = parseGenerationPreflight(body);
    enforceModalityTier(input.modality, user.tier);
    if (input.modality !== "text") {
      return NextResponse.json({code:"MODALITY_NOT_IMPLEMENTED"},{status:501,headers:{"Cache-Control":"no-store"}});
    }
    const result = await evaluateStudioTextPreflight(user.id, user.tier, input);
    return NextResponse.json({
      ...result,
      note:"서버 정책을 검증한 예상 예약액입니다. 실제 생성·예약·결제는 실행하지 않았습니다.",
    }, {headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    if (error instanceof StudioInputError && error.status === 501) {
      return NextResponse.json({code:"MODALITY_NOT_IMPLEMENTED"},{status:501,headers:{"Cache-Control":"no-store"}});
    }
    return studioHttpError(error);
  }
}
