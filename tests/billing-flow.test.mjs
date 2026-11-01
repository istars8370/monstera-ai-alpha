import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { holdCredits, settleCredits, reclaimExpired } from "../lib/billing.ts";
import {
  resetBillingMock, seedBillingCredit, billingCredit, billingLedger,
  expireBillingLedger, failNextBillingQuery,
} from "./mocks/billing-pool.mjs";

const alice = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bob = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const base = {
  userId: alice, requestId: "request-1", model: "mock/alpha",
  reserved: 40, priceSnapshot: '{"testing":true,"version":1}',
};

beforeEach(() => {
  resetBillingMock();
  seedBillingCredit(alice, 100);
  seedBillingCredit(bob, 70);
});

test("billing lifecycle: one hold, duplicate suppression, partial settlement and replay", async () => {
  const hold = await holdCredits(base);
  assert.equal(hold.status, "held");
  assert.deepEqual(billingCredit(alice), { balance: 100, reserved: 40 });
  assert.deepEqual(await holdCredits(base), { status: "duplicate_held" });
  assert.deepEqual(await settleCredits(alice, base.requestId, 20), { status: "settled", charged: 20 });
  assert.deepEqual(billingCredit(alice), { balance: 80, reserved: 0 });
  assert.deepEqual(await settleCredits(alice, base.requestId, 20), { status: "settled", charged: 20 });
  assert.deepEqual(await holdCredits(base), { status: "settled", charged: 20 });
  await assert.rejects(settleCredits(alice, base.requestId, 21), /SETTLEMENT_REPLAY_MISMATCH/);
  assert.deepEqual(billingCredit(alice), { balance: 80, reserved: 0 });
});

test("billing lifecycle: reused idempotency key with different model or pricing aborts", async () => {
  await holdCredits(base);
  await assert.rejects(holdCredits({ ...base, model: "another-model" }), /IDEMPOTENCY_KEY_REUSED/);
  await assert.rejects(holdCredits({ ...base, reserved: 41 }), /IDEMPOTENCY_KEY_REUSED/);
  await assert.rejects(holdCredits({ ...base, priceSnapshot: '{"version":2}' }), /IDEMPOTENCY_KEY_REUSED/);
  assert.deepEqual(billingCredit(alice), { balance: 100, reserved: 40 });
  assert.equal(billingLedger(alice, base.requestId).status, "held");
});

test("billing lifecycle: insufficient funds roll back the inserted ledger", async () => {
  const insufficient = await holdCredits({ ...base, reserved: 101 });
  assert.deepEqual(insufficient, { status: "insufficient" });
  assert.equal(billingLedger(alice, base.requestId), null);
  assert.deepEqual(billingCredit(alice), { balance: 100, reserved: 0 });
});

test("billing lifecycle: over-settlement and DB write errors roll back balance safely", async () => {
  await holdCredits(base);
  await assert.rejects(settleCredits(alice, base.requestId, 41), /SETTLEMENT_EXCEEDS_RESERVATION/);
  assert.deepEqual(billingCredit(alice), { balance: 100, reserved: 40 });
  failNextBillingQuery("UPDATE usage_ledger SET status = 'settled'");
  await assert.rejects(settleCredits(alice, base.requestId, 20), /MOCK_DATABASE_WRITE_FAILED/);
  assert.deepEqual(billingCredit(alice), { balance: 100, reserved: 40 });
  assert.equal(billingLedger(alice, base.requestId).status, "held");
  assert.deepEqual(await settleCredits(alice, base.requestId, 20), { status: "settled", charged: 20 });
  assert.deepEqual(billingCredit(alice), { balance: 80, reserved: 0 });
});

test("billing lifecycle: expired holds are reclaimed exactly once", async () => {
  await holdCredits(base);
  expireBillingLedger(alice, base.requestId);
  assert.equal(await reclaimExpired(), 1);
  assert.equal(await reclaimExpired(), 0);
  assert.deepEqual(billingCredit(alice), { balance: 100, reserved: 0 });
  assert.deepEqual(await settleCredits(alice, base.requestId, 10), { status: "reclaimed" });
  assert.deepEqual(await holdCredits(base), { status: "reclaimed" });
});

test("billing lifecycle: two accounts can independently use same idempotency key", async () => {
  assert.equal((await holdCredits(base)).status, "held");
  assert.equal((await holdCredits({ ...base, userId: bob })).status, "held");
  assert.deepEqual(await settleCredits(bob, base.requestId, 0), { status: "settled", charged: 0 });
  assert.deepEqual(billingCredit(bob), { balance: 70, reserved: 0 });
  assert.deepEqual(billingCredit(alice), { balance: 100, reserved: 40 });
});
