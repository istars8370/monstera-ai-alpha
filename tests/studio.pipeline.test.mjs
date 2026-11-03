import test,{beforeEach} from "node:test";
import assert from "node:assert/strict";
import {NextRequest} from "next/server.js";
import {createSessionToken} from "../lib/session-token.ts";
import {POST as submitRoute} from "../app/api/studio/generation/jobs/route.ts";
import {parseMockSubmission,submitMockGeneration} from "../lib/studio/mock-generation.ts";
import {mockStudioEnabled} from "../lib/studio/mock-gate.ts";
import {StudioMockProvider} from "../lib/studio/mock-provider.ts";
import {processNextMockJob,runMockWorkerTick} from "../lib/studio/mock-worker.ts";
import {claimNextMockJob,recoverExpiredMockLeases,finalizeStudioJob} from "../lib/studio/jobs.ts";
import {studioTextActualCredits} from "../lib/studio/generation-policy.ts";
import {addUser,addModel,addCredits,resetTestDb} from "./mocks/db-pool.mjs";
import {resetBillingMock,seedBillingCredit,seedBillingMockUser,billingWallet,
 billingLedger,billingJob,expireBillingMockJobLease} from "./mocks/billing-pool.mjs";

const user="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const model="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const origin="http://localhost:3000";
const secret="mock-studio-session-testing-secret-over-thirty-two-bytes";
const requestId="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const input={modelId:model,modality:"text",prompt:"한국어로 콘텐츠 소개 문장을 작성하세요.",
 maxTokens:128,requestId,consentExternal:true};
beforeEach(()=>{
 resetTestDb();resetBillingMock();
 process.env.NODE_ENV="test";
 process.env.DATABASE_URL="postgresql://mock:mock@127.0.0.1:5432/mock";
 process.env.MONSTERA_STUDIO_MOCK_ENABLED="true";
 process.env.MONSTERA_SESSION_SECRET=secret;
 process.env.MONSTERA_PUBLIC_ORIGIN=origin;
 process.env.MONSTERA_MAX_OUTPUT_TOKENS="512";
 process.env.MONSTERA_STUDIO_TEXT_CREDIT_PRICES_JSON=JSON.stringify([{
  modelId:model,provider:"openai",upstreamId:"mock-openai",
  inputCreditsPerMillionTokens:1000000,outputCreditsPerMillionTokens:2000000,
  reviewedAt:new Date().toISOString(),
 }]);
 addUser({id:user,tier:"creator",google_sub:"google-mock-only",email_verified_at:new Date(),
  session_epoch:0,email:"worker@example.invalid"});
 addModel({id:model,provider:"openai",upstream_id:"mock-openai",tier_min:"free",
  enabled:true,ctx:131072});
 addCredits(user,30000);
 seedBillingCredit(user,30000);
 seedBillingMockUser(user,"creator");
});
function request(body=input,extraHeaders={}){
 return new NextRequest(origin+"/api/studio/generation/jobs",{
  method:"POST",headers:{origin,"content-type":"application/json",
   cookie:"monstera_session="+createSessionToken(user,0,secret),...extraHeaders},
  body:JSON.stringify(body),
 });
}
test("worker rejects any injected adapter that is not the offline StudioMockProvider",async()=>{
 await assert.rejects(processNextMockJob({chatStream:async function*(){throw new Error("would call network");},
  listModels:async()=>[],healthCheck:async()=>({healthy:true})}),/ONLY_OFFLINE_MOCK_ADAPTER_ALLOWED/);
});
test("mock gate never enables on production or non-local DB",()=>{
 assert.equal(mockStudioEnabled({NODE_ENV:"production",DATABASE_URL:process.env.DATABASE_URL,
  MONSTERA_STUDIO_MOCK_ENABLED:"true"}),false);
 assert.equal(mockStudioEnabled({NODE_ENV:"test",DATABASE_URL:"postgresql://user:pass@neon.example/db",
  MONSTERA_STUDIO_MOCK_ENABLED:"true"}),false);
 assert.equal(mockStudioEnabled({NODE_ENV:"test",DATABASE_URL:process.env.DATABASE_URL,
  MONSTERA_STUDIO_MOCK_ENABLED:"false"}),false);
 assert.equal(mockStudioEnabled(),true);
});
test("submission requires real UUID idempotency key and remains fail-closed",async()=>{
 assert.throws(()=>parseMockSubmission({...input,requestId:"bad"}),{status:400});
 const prod=await submitRoute(request(),{});
 // route is built from nonproduction environment only, and session is valid.
 assert.equal(prod.status,202);
 const replay=await submitRoute(request());
 assert.equal(replay.status,409);
 await assert.rejects(submitMockGeneration(user,"creator",{...input,maxTokens:64}),{status:409});
 assert.equal(billingWallet(user).reserved>0,true);
 assert.equal(billingJob((await prod.json()).jobId).status,"queued");
});
test("submission rechecks balance atomically and rejects unsupported modalities",async()=>{
 seedBillingCredit(user,5);
 await assert.rejects(submitMockGeneration(user,"creator",input),{status:402});
 assert.equal(billingLedger(user,requestId),null);
 assert.equal((await submitRoute(request({...input,modality:"image"}))).status,501);
 assert.equal((await submitRoute(request({...input,modality:"video"}))).status,403);
});
test("mock worker completes a persistent job and settles trusted provider usage exactly once",async()=>{
 const submitted=await submitMockGeneration(user,"creator",input);
 assert.equal(submitted.mockOnly,true);
 assert.equal(submitted.job.status,"queued");
 const job=await processNextMockJob();
 assert.equal(job.status,"succeeded");
 assert.ok(job.chargedCredits>0);
 assert.ok(job.chargedCredits<submitted.maximumReservedCredits);
 assert.equal(billingJob(job.jobId).status,"succeeded");
 assert.match(billingJob(job.jobId).result_text,/MOCK/);
 assert.equal(billingWallet(user).reserved,0);
 assert.equal(billingWallet(user).balance,30000-job.chargedCredits);
 assert.equal(billingLedger(user,requestId).in_tokens>0,true);
 assert.equal(billingLedger(user,requestId).out_tokens>0,true);
 assert.equal(await processNextMockJob(),null);
 await assert.rejects(finalizeStudioJob(user,job.jobId,requestId,1,true),{status:409});
});
test("truncated fake stream retries, then can succeed",async()=>{
 const submitted=await submitMockGeneration(user,"creator",input);
 const failed=await processNextMockJob(new StudioMockProvider("truncated"));
 assert.equal(failed.status,"queued");
 assert.equal(billingJob(submitted.job.id).attempt_count,1);
 assert.equal(billingLedger(user,requestId).status,"held");
 const completed=await processNextMockJob();
 assert.equal(completed.status,"succeeded");
 assert.equal(billingJob(submitted.job.id).attempt_count,2);
});
test("three deterministic fake failures reach terminal failed with zero charge",async()=>{
 await submitMockGeneration(user,"creator",input);
 for(let i=0;i<2;i++)assert.equal((await processNextMockJob(new StudioMockProvider("error"))).status,"queued");
 assert.equal((await processNextMockJob(new StudioMockProvider("error"))).status,"failed");
 assert.equal(billingWallet(user).reserved,0);
 assert.equal(billingWallet(user).balance,30000);
 assert.equal(billingLedger(user,requestId).settled_amount,0);
 assert.equal(await processNextMockJob(),null);
});
test("expired lease is recovered and old token cannot settle",async()=>{
 const submitted=await submitMockGeneration(user,"creator",input);
 const claimed=await claimNextMockJob("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
 assert.equal(claimed.status,"running");
 expireBillingMockJobLease(claimed.id);
 const rec=await recoverExpiredMockLeases();
 assert.deepEqual(rec,{requeued:1,failed:0});
 assert.equal(billingJob(submitted.job.id).status,"queued");
 await assert.rejects(finalizeStudioJob(user,claimed.id,requestId,10,true,{
  leaseToken:claimed.lease_token,resultText:"fake",usage:{inputTokens:1,outputTokens:1},
 }),{status:409});
 assert.equal((await runMockWorkerTick()).result.status,"succeeded");
});
test("legacy completion cannot bypass active mock lease fencing",async()=>{
 const submitted=await submitMockGeneration(user,"creator",input);
 const job=await claimNextMockJob("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
 assert.equal(job.id,submitted.job.id);
 await assert.rejects(finalizeStudioJob(user,job.id,requestId,1,true),{status:409});
 assert.equal(billingLedger(user,requestId).status,"held");
 assert.equal(billingWallet(user).reserved>0,true);
 expireBillingMockJobLease(job.id);
 assert.equal((await recoverExpiredMockLeases()).requeued,1);
 assert.equal((await processNextMockJob()).status,"succeeded");
});
test("usage cost is bounded by the reserved amount and max output tokens",()=>{
 const policy={inputCreditsPerMillionTokens:1000000,outputCreditsPerMillionTokens:2000000};
 assert.throws(()=>studioTextActualCredits(policy,{inputTokens:100,outputTokens:300},
  {inputTokenCeiling:200,maxTokens:128,reserved:1000}),/UNVERIFIED/);
 assert.throws(()=>studioTextActualCredits(policy,{inputTokens:100,outputTokens:100},
  {inputTokenCeiling:200,maxTokens:128,reserved:50}),/EXCEEDS_HOLD/);
 assert.equal(studioTextActualCredits(policy,{inputTokens:10,outputTokens:20},
  {inputTokenCeiling:200,maxTokens:128,reserved:100}),50);
});
test("mock provider handles empty, aborted and timeout without network",async()=>{
 const cases=["empty","aborted","timeout"];
 for(const scenario of cases){
  const provider=new StudioMockProvider(scenario);
  const controller=new AbortController();
  if(scenario==="timeout")controller.abort();
  const iterator=provider.chatStream({model:"fake",messages:[{role:"user",content:"abc"}],
    maxTokens:32,signal:controller.signal});
  if(scenario==="empty")assert.equal((await iterator.next()).done,true);
  else await assert.rejects(iterator.next(),/UPSTREAM_ABORTED/);
 }
});
