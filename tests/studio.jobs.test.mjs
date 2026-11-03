import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getStudioJob, reserveQueuedJob, finalizeStudioJob, reclaimStaleJobs } from "../lib/studio/jobs.ts";
import { reclaimExpired } from "../lib/billing.ts";
import {
  resetBillingMock, seedBillingCredit, billingWallet, billingLedger, billingJob,
  failNextBillingQuery, expireBillingLedger,
} from "./mocks/billing-pool.mjs";

const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const input = (requestId="job-1", reserved=80) => ({
  userId:user, requestId, model:"mock-video-model", modality:"video", ttlSeconds:3600,
  priceSnapshot:"fake-fixed-price", reserved,
});
beforeEach(() => {
  resetBillingMock();
  seedBillingCredit(user,500,0,{video_balance:200});
});

test("atomic admission rolls back a hold when job insertion fails",async()=>{
  failNextBillingQuery("INSERT INTO studio_jobs");
  await assert.rejects(reserveQueuedJob(input()),/MOCK_DATABASE_WRITE_FAILED/);
  assert.equal(billingLedger(user,"job-1"),null);
  assert.equal(billingWallet(user).video_reserved,0);
  assert.equal(billingWallet(user).video_balance,200);
  const success=await reserveQueuedJob(input());
  assert.equal(success.status,"queued");
  assert.equal(billingWallet(user).video_reserved,80);
});
test("insufficient job admission leaves no held row and refuses replay",async()=>{
  await assert.rejects(reserveQueuedJob(input("poor",201)),{status:402});
  assert.equal(billingLedger(user,"poor"),null);
  assert.equal(billingWallet(user).video_reserved,0);
  const job=await reserveQueuedJob(input());
  await assert.rejects(reserveQueuedJob(input()),{status:409});
  assert.equal(billingWallet(user).video_reserved,80);
  assert.equal((await getStudioJob(user,job.id)).id,job.id);
  await assert.rejects(getStudioJob(other,job.id),{status:404});
});
test("job completion commits balance, ledger and terminal status exactly once",async()=>{
  const job=await reserveQueuedJob(input());
  const finished=await finalizeStudioJob(user,job.id,"job-1",50,true);
  assert.equal(finished.status,"succeeded");
  assert.equal(billingWallet(user).video_balance,150);
  assert.equal(billingWallet(user).video_reserved,0);
  assert.equal(billingLedger(user,"job-1").settled_amount,50);
  assert.equal(billingLedger(user,"job-1").status,"settled");
  await assert.rejects(finalizeStudioJob(user,job.id,"job-1",50,true),{status:409});
  assert.equal(billingWallet(user).video_balance,150);
});
test("job update failure rolls back credit settlement and can be retried",async()=>{
  const job=await reserveQueuedJob(input());
  failNextBillingQuery("UPDATE studio_jobs SET status=$3");
  await assert.rejects(finalizeStudioJob(user,job.id,"job-1",60,true),/MOCK_DATABASE_WRITE_FAILED/);
  assert.equal(billingLedger(user,"job-1").status,"held");
  assert.equal(billingWallet(user).video_balance,200);
  assert.equal(billingWallet(user).video_reserved,80);
  assert.equal(billingJob(job.id).status,"queued");
  assert.equal((await finalizeStudioJob(user,job.id,"job-1",60,true)).status,"succeeded");
  assert.equal(billingWallet(user).video_balance,140);
});
test("incorrect idempotency key and nonzero failed-job cost are rejected",async()=>{
  const job=await reserveQueuedJob(input());
  await assert.rejects(finalizeStudioJob(user,job.id,"wrong-key",40,true),{status:409});
  await assert.rejects(finalizeStudioJob(user,job.id,"job-1",10,false),{status:400});
  assert.equal(billingWallet(user).video_reserved,80);
  assert.equal((await finalizeStudioJob(user,job.id,"job-1",0,false)).status,"failed");
  assert.equal(billingWallet(user).video_balance,200);
});
test("job expiry is not affected by stream abort or generic reclaim",async()=>{
  const job=await reserveQueuedJob(input());
  const now=Date.now();
  assert.ok(billingLedger(user,"job-1").reserved_until>now+3500000);
  assert.equal(await reclaimExpired(),0);
  expireBillingLedger(user,"job-1");
  assert.equal(await reclaimExpired(),0);
  assert.equal(await reclaimStaleJobs(3600),0);
  assert.equal(billingWallet(user).video_reserved,80);
  assert.equal(await reclaimStaleJobs(0),1);
  assert.equal(await reclaimStaleJobs(0),0);
  assert.equal(billingJob(job.id).status,"reclaimed");
  assert.equal(billingLedger(user,"job-1").status,"reclaimed");
  assert.equal(billingWallet(user).video_reserved,0);
  await assert.rejects(finalizeStudioJob(user,job.id,"job-1",0,true),{status:409});
});
