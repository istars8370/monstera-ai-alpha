import test, {beforeEach} from "node:test";
import assert from "node:assert/strict";
import {holdCredits,settleCredits,reclaimExpired} from "../lib/billing.ts";
import {resetBillingMock,seedBillingCredit,billingCredit,billingWallet,billingLedger,expireBillingLedger} from "./mocks/billing-pool.mjs";
const user="11111111-1111-4111-8111-111111111111";
beforeEach(()=>resetBillingMock());
const input=(modality,requestId,reserved=80)=>({
  userId:user,requestId,model:"fake-registry-id",reserved,priceSnapshot:"mock-price",
  modality,ttlSeconds:modality==="video"?3600:modality==="image"?600:120,
});
test("image holds and settlement use only the image wallet",async()=>{
 seedBillingCredit(user,1000,0,{image_balance:100,image_reserved:0,video_balance:300,video_reserved:0});
 const first=await holdCredits(input("image","image-once"));
 assert.equal(first.status,"held");
 assert.deepEqual(await holdCredits(input("image","image-once")),{status:"duplicate_held"});
 assert.equal(billingWallet(user).image_reserved,80);
 assert.equal(billingCredit(user).reserved,0);
 const settled=await settleCredits(user,"image-once",50);
 assert.deepEqual(settled,{status:"settled",charged:50});
 assert.deepEqual(await settleCredits(user,"image-once",50),settled);
 assert.equal(billingWallet(user).image_balance,50);
 assert.equal(billingWallet(user).image_reserved,0);
 assert.equal(billingCredit(user).balance,1000);
});
test("video holds use 3600s TTL and are not swept before their expiration",async()=>{
 seedBillingCredit(user,0,0,{video_balance:200});
 const now=Date.now();
 assert.equal((await holdCredits(input("video","long-video"))).status,"held");
 assert.ok(billingLedger(user,"long-video").reserved_until>=now+3_590_000);
 assert.equal(await reclaimExpired(),0);
 assert.equal(billingWallet(user).video_reserved,80);
 expireBillingLedger(user,"long-video");
 assert.equal(await reclaimExpired(),1);
 assert.equal(billingWallet(user).video_reserved,0);
 assert.equal(billingLedger(user,"long-video").status,"reclaimed");
});
test("insufficient modality balance never creates a held ledger row",async()=>{
 seedBillingCredit(user,1000,0,{image_balance:10});
 const result=await holdCredits(input("image","insufficient"));
 assert.equal(result.status,"insufficient");
 assert.equal(billingLedger(user,"insufficient"),null);
 assert.equal(billingCredit(user).balance,1000);
});
test("idempotency key cannot be replayed across modalities",async()=>{
 seedBillingCredit(user,2000,0,{image_balance:1000});
 await holdCredits(input("text","same-key"));
 await assert.rejects(holdCredits(input("image","same-key")),/IDEMPOTENCY_KEY_REUSED/);
 assert.equal(billingWallet(user).image_reserved,0);
});
test("invalid TTL and unknown modality are refused before DB access",async()=>{
 await assert.rejects(holdCredits({...input("video","bad"),ttlSeconds:600}),/INVALID_HOLD_TTL/);
 await assert.rejects(holdCredits({...input("audio","bad")}),/INVALID_HOLD_TTL/);
});
