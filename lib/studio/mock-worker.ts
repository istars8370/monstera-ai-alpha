import { randomUUID } from "node:crypto";
import type { ProviderAdapter } from "@/lib/providers/types";
import { DatabaseModelRegistry } from "@/lib/model-registry";
import { ModelRouter, type Tier } from "@/lib/router";
import { studioTextActualCredits, type StudioCreditPriceSnapshot } from "@/lib/studio/generation-policy";
import {
  claimNextMockJob, finalizeStudioJob, recoverExpiredMockLeases, reclaimStaleJobs,
  retryOrFailMockJob, type ClaimedMockJob,
} from "@/lib/studio/jobs";
import { requireMockStudio } from "@/lib/studio/mock-gate";
import { StudioMockProvider } from "@/lib/studio/mock-provider";

interface StoredMockPrice extends StudioCreditPriceSnapshot {
  inputTokenCeiling:number;maxTokens:number;mockOnly:true;
}
function readStoredPrice(job:ClaimedMockJob):StoredMockPrice {
  let value:unknown;
  try {value=JSON.parse(job.price_snapshot);}catch{throw new Error("MOCK_PRICE_SNAPSHOT_UNREADABLE");}
  if(!value||typeof value!=="object")throw new Error("MOCK_PRICE_SNAPSHOT_INVALID");
  const price=value as Record<string,unknown>;
  if(price.mockOnly!==true||price.modelId!==job.model||price.provider!=="openai"||
    !Number.isSafeInteger(price.inputTokenCeiling)||price.inputTokenCeiling as number <
    Buffer.byteLength(job.prompt,"utf8")+8192 ||price.maxTokens!==job.max_tokens) {
    throw new Error("MOCK_PRICE_SNAPSHOT_MISMATCH");
  }
  return price as unknown as StoredMockPrice;
}

export interface MockTickResult {
  jobId:string;
  status:"succeeded"|"queued"|"failed";
  chargedCredits:number;
  mockOnly:true;
}
/** Worker is an explicit, durable local-only tick. Nothing runs in HTTP response callbacks.
 * Provider errors are retried safely; settlement errors propagate and remain held for lease recovery.
 */
export async function processNextMockJob(
  adapter:ProviderAdapter=new StudioMockProvider(),timeoutMs=10000,
):Promise<MockTickResult|null> {
  requireMockStudio();
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<10||timeoutMs>60000)throw new Error("INVALID_MOCK_TIMEOUT");
  const job=await claimNextMockJob(randomUUID());
  if(!job)return null;
  let content="",usage:{inputTokens:number;outputTokens:number}|null=null,done=false;
  try{
    const price=readStoredPrice(job);
    if(job.tier!=="free"&&job.tier!=="creator"&&job.tier!=="studio")throw new Error("MOCK_USER_TIER_INVALID");
    const router=new ModelRouter(new DatabaseModelRegistry(),{openai:adapter},timeoutMs);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      for await(const chunk of router.chatStream({
        modelId:job.model,tier:job.tier as Tier,
        messages:[{role:"user",content:job.prompt}],maxTokens:job.max_tokens,
        signal:controller.signal,
      })){
        if(chunk.type==="delta"){
          if(done||typeof chunk.text!=="string")throw new Error("MOCK_BAD_DELTA");
          content+=chunk.text;
          if(content.length>14000)throw new Error("MOCK_OUTPUT_LIMIT");
        }else if(chunk.type==="usage"){
          if(done||usage||!chunk.usage)throw new Error("MOCK_USAGE_DUPLICATE");
          usage=chunk.usage;
        }else if(chunk.type==="done"){
          if(done)throw new Error("MOCK_DUPLICATE_DONE");
          done=true;
        }else{throw new Error("MOCK_STREAM_MALFORMED");}
      }
    }finally{clearTimeout(timer);controller.abort();}
    if(!done||!usage||!content.trim())throw new Error("MOCK_STREAM_INCOMPLETE");
    const trusted=usage as {inputTokens:number;outputTokens:number};
    const charged=studioTextActualCredits(price,trusted,{
      inputTokenCeiling:price.inputTokenCeiling,maxTokens:job.max_tokens,
      reserved:job.reserved_amount,
    });
    const text="[MOCK · 운영 납품·게시 금지]\n"+content;
    await finalizeStudioJob(job.user_id,job.id,job.request_id,charged,true,{
      leaseToken:job.lease_token,resultText:text,usage:trusted,
    });
    return {jobId:job.id,status:"succeeded",chargedCredits:charged,mockOnly:true};
  }catch(error){
    // Only deterministic mock provider/validation failures are safely refundable at zero.
    // No live provider task is ever dispatched by this module.
    const code=error instanceof Error && /^MOCK_[A-Z0-9_]+$/.test(error.message)
      ?error.message:"MOCK_EXECUTION_FAILURE";
    const status=await retryOrFailMockJob(job,code);
    return {jobId:job.id,status,chargedCredits:0,mockOnly:true};
  }
}

export async function runMockWorkerTick(adapter?:ProviderAdapter):Promise<{
  recovered:{requeued:number;failed:number};reclaimed:number;result:MockTickResult|null;
}> {
  requireMockStudio();
  const recovered=await recoverExpiredMockLeases();
  const reclaimed=await reclaimStaleJobs(0);
  const result=await processNextMockJob(adapter);
  return {recovered,reclaimed,result};
}
