import { DatabaseModelRegistry } from "@/lib/model-registry";
import type { Tier } from "@/lib/router";
import { reserveQueuedJob, type StudioJob } from "@/lib/studio/jobs";
import {
  evaluateStudioTextPreflight, matchStudioCreditPrice, parseGenerationPreflight,
  type GenerationPreflightInput, type StudioCreditPriceSnapshot,
} from "@/lib/studio/generation-policy";
import { requireMockStudio } from "@/lib/studio/mock-gate";
import { StudioInputError } from "@/lib/studio/workflow";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRICE_POLICY_ENV="MONSTERA_STUDIO_TEXT_CREDIT_PRICES_JSON";
export interface MockJobPriceSnapshot extends StudioCreditPriceSnapshot {
  inputTokenCeiling:number;
  maxTokens:number;
  mockOnly:true;
}
export interface MockSubmission {
  job:StudioJob;
  maximumReservedCredits:number;
  mockOnly:true;
}
export function parseMockSubmission(raw:unknown): GenerationPreflightInput & {requestId:string} {
  const parsed=parseGenerationPreflight(raw);
  const body=raw as Record<string,unknown>;
  if(typeof body.requestId!=="string" || !UUID.test(body.requestId)) {
    throw new StudioInputError(400,"requestId는 유효한 UUID여야 합니다.");
  }
  return {...parsed,requestId:body.requestId};
}
/** This is intentionally inaccessible in production, even when a flag is set. */
export async function submitMockGeneration(
  userId:string,tier:Tier,raw:unknown,
  env:NodeJS.ProcessEnv=process.env,
):Promise<MockSubmission> {
  requireMockStudio(env);
  const input=parseMockSubmission(raw);
  const preflight=await evaluateStudioTextPreflight(userId,tier,input,env);
  const model=await new DatabaseModelRegistry().findEnabled(input.modelId);
  if(!model||model.provider!=="openai")throw new StudioInputError(404,"활성 모델을 찾을 수 없습니다.");
  const price=matchStudioCreditPrice(env[PRICE_POLICY_ENV],model);
  if(price.reviewedAt!==preflight.priceReviewedAt)throw new Error("STUDIO_PRICE_CHANGED_DURING_SUBMISSION");
  const snapshot:MockJobPriceSnapshot={...price,inputTokenCeiling:preflight.inputTokenCeiling,
    maxTokens:preflight.maxTokens,mockOnly:true};
  // holdCreditsInTransaction re-checks balance and idempotency under a row lock.
  const job=await reserveQueuedJob({
    userId,requestId:input.requestId,modality:"text",ttlSeconds:120,model:input.modelId,
    reserved:preflight.maximumReservedCredits,priceSnapshot:JSON.stringify(snapshot),
    prompt:input.prompt,maxTokens:preflight.maxTokens,
  });
  return {job,maximumReservedCredits:preflight.maximumReservedCredits,mockOnly:true};
}
