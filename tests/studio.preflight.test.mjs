import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { createSessionToken } from "../lib/session-token.ts";
import { POST as preflight } from "../app/api/studio/generation/preflight/route.ts";
import {
  parseGenerationPreflight, enforceModalityTier, matchStudioCreditPrice,
  computeStudioTextReservation,
} from "../lib/studio/generation-policy.ts";
import { addUser, addCredits, addModel, resetTestDb, queries } from "./mocks/db-pool.mjs";

const origin = "http://localhost:3000";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const modelId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const secret = "studio-preflight-test-secret-greater-than-thirty-two-bytes";
const price = {
  modelId, provider:"openai", upstreamId:"mock-model",
  inputCreditsPerMillionTokens:1_000_000,
  outputCreditsPerMillionTokens:2_000_000,
  reviewedAt:new Date().toISOString(),
};
const sample = { modality:"text",modelId,prompt:"한글 테스트",maxTokens:128,consentExternal:true };
beforeEach(() => {
  resetTestDb();
  process.env.MONSTERA_PUBLIC_ORIGIN=origin;
  process.env.MONSTERA_SESSION_SECRET=secret;
  process.env.MONSTERA_MAX_OUTPUT_TOKENS="512";
  process.env.MONSTERA_STUDIO_TEXT_CREDIT_PRICES_JSON=JSON.stringify([{
    ...price,reviewedAt:new Date().toISOString(),
  }]);
  addUser({id:userId,email:"studio-preflight@example.invalid",google_sub:"google-studio-test",
    tier:"creator",session_epoch:0,email_verified_at:new Date()});
  addCredits(userId,40_000,10);
  addModel({id:modelId,provider:"openai",upstream_id:"mock-model",tier_min:"free",
    enabled:true,ctx:131072,price_in:"0",price_out:"0"});
});
function cookie() {return "monstera_session="+createSessionToken(userId,0,secret);}
function request(body=sample,override={}){
  return new NextRequest(origin+"/api/studio/generation/preflight",{
    method:"POST",
    headers:{origin,"content-type":"application/json",cookie:cookie(),...override},
    body:JSON.stringify(body),
  });
}
test("preflight validates prompt, model, consent and requested output limit",()=>{
  assert.equal(parseGenerationPreflight(sample).maxTokens,128);
  for(const patch of [
    {consentExternal:false},{maxTokens:0},{maxTokens:2048.5},{prompt:""},
    {prompt:"x".repeat(8193)},{modelId:"not-uuid"},{modality:"audio"},
  ]){
    assert.throws(()=>parseGenerationPreflight({...sample,...patch}),{status:400});
  }
});
test("preflight enforces image/creator and video/studio tier independently",()=>{
  assert.throws(()=>enforceModalityTier("image","free"),{status:403});
  assert.doesNotThrow(()=>enforceModalityTier("image","creator"));
  assert.throws(()=>enforceModalityTier("video","creator"),{status:403});
  assert.doesNotThrow(()=>enforceModalityTier("video","studio"));
});
test("preflight requires exact, recent, nonzero server-only pricing snapshot",()=>{
  const fixed=new Date("2026-11-03T12:00:00.000Z");
  const match={id:modelId,provider:"openai",upstreamId:"mock-model"};
  const policy={...price,reviewedAt:"2026-11-02T00:00:00Z"};
  const raw=JSON.stringify([policy]);
  assert.equal(matchStudioCreditPrice(raw,match,fixed).provider,"openai");
  assert.throws(()=>matchStudioCreditPrice(undefined,match,fixed),/NOT_CONFIGURED/);
  assert.throws(()=>matchStudioCreditPrice(JSON.stringify([policy,policy]),match,fixed),/DUPLICATE/);
  assert.throws(()=>matchStudioCreditPrice(JSON.stringify([{...policy,provider:"wrong"}]),match,fixed),/INVALID/);
  assert.throws(()=>matchStudioCreditPrice(JSON.stringify([{...policy,inputCreditsPerMillionTokens:0}]),match,fixed),/INVALID/);
  assert.throws(()=>matchStudioCreditPrice(JSON.stringify([{...policy,reviewedAt:"2026-10-01T00:00:00Z"}]),match,fixed),/REVIEW_REQUIRED/);
  assert.throws(()=>matchStudioCreditPrice(JSON.stringify([{...policy,reviewedAt:"2026-11-04T00:00:00Z"}]),match,fixed),/REVIEW_REQUIRED/);
});
test("preflight reserves an integer upper bound without floating point undercharge",()=>{
  assert.deepEqual(computeStudioTextReservation(price,100,256),{
    inputTokenCeiling:8292,maximumReservedCredits:8804,
  });
  assert.deepEqual(computeStudioTextReservation({...price,
    inputCreditsPerMillionTokens:1,outputCreditsPerMillionTokens:1},1,1),{
    inputTokenCeiling:8193,maximumReservedCredits:2,
  });
  assert.throws(()=>computeStudioTextReservation({
    ...price,inputCreditsPerMillionTokens:1_000_000_000,
    outputCreditsPerMillionTokens:1_000_000_000,
  },24000,16384),/OUT_OF_RANGE/);
});
test("preflight endpoint: session, Origin and consent are enforced",async()=>{
  assert.equal((await preflight(request(sample,{cookie:""}))).status,401);
  assert.equal((await preflight(request(sample,{origin:"https://evil.example"}))).status,403);
  assert.equal((await preflight(request({...sample,consentExternal:false}))).status,400);
  assert.equal((await preflight(request({...sample,maxTokens:1000}))).status,400);
});
test("preflight endpoint never starts providers, holds or jobs",async()=>{
  const response=await preflight(request({...sample,userId:"forged",tier:"studio",
    maximumReservedCredits:0}));
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.status,"preflight_only");
  assert.equal(result.creditsReserved,0);
  assert.equal(result.canGenerate,false);
  assert.equal(result.modelId,modelId);
  assert.ok(result.maximumReservedCredits>0);
  assert.equal(response.headers.get("cache-control"),"no-store");
  assert.equal(queries().some(q=>/INSERT|UPDATE|DELETE|FROM usage_ledger|FROM studio_jobs/i.test(q.sql)),false);
});
test("preflight endpoint fails closed on insufficient credits, disabled model or pricing",async()=>{
  addCredits(userId,5);
  assert.equal((await preflight(request())).status,402);
  addCredits(userId,40_000);
  addModel({id:modelId,provider:"openai",upstream_id:"mock-model",
    tier_min:"free",enabled:false,ctx:131072});
  assert.equal((await preflight(request())).status,404);
  addModel({id:modelId,provider:"openai",upstream_id:"mock-model",
    tier_min:"free",enabled:true,ctx:131072});
  delete process.env.MONSTERA_STUDIO_TEXT_CREDIT_PRICES_JSON;
  assert.equal((await preflight(request())).status,503);
});
test("preflight endpoint requires the model tier and reports unsupported modalities",async()=>{
  addModel({id:modelId,provider:"openai",upstream_id:"mock-model",
    tier_min:"studio",enabled:true,ctx:131072});
  assert.equal((await preflight(request())).status,403);
  assert.equal((await preflight(request({...sample,modality:"video"}))).status,403);
  assert.equal((await preflight(request({...sample,modality:"image"}))).status,501);
});
