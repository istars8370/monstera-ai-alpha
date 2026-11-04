import test from "node:test";
import assert from "node:assert/strict";
import { assertCompatibleHold, holdCredits, settleCredits, reclaimExpired } from "../lib/billing.ts";

const input = {
  userId: "11111111-1111-4111-8111-111111111111",
  requestId: "request-alpha",
  model: "mock/approved",
  reserved: 100,
  priceSnapshot: '{"unit":"mock","version":1}',
};
const stored = {
  model: input.model,
  reserved_amount: input.reserved,
  price_snapshot: input.priceSnapshot,
};

test("billing: same idempotency key cannot be repurposed for different price or model", () => {
  assert.doesNotThrow(() => assertCompatibleHold(stored, input));
  assert.throws(() => assertCompatibleHold(stored, { ...input, model: "different" }), /IDEMPOTENCY_KEY_REUSED/);
  assert.throws(() => assertCompatibleHold(stored, { ...input, reserved: 101 }), /IDEMPOTENCY_KEY_REUSED/);
  assert.throws(() => assertCompatibleHold(stored, { ...input, priceSnapshot: '{"version":2}' }), /IDEMPOTENCY_KEY_REUSED/);
  assert.throws(() => assertCompatibleHold({ ...stored, price_snapshot: null }, input), /IDEMPOTENCY_KEY_REUSED/);
});

test("billing: credit amounts must fit PostgreSQL signed int32 and be positive for holds", async () => {
  for (const bad of [0, -1, NaN, Infinity, 1.5, 2147483648, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(holdCredits({ ...input, reserved: bad }), /INVALID_HOLD/);
  }
  await assert.rejects(holdCredits({ ...input, requestId: "" }), /INVALID_HOLD/);
  await assert.rejects(holdCredits({ ...input, model: "" }), /INVALID_HOLD/);
  await assert.rejects(holdCredits({ ...input, priceSnapshot: "" }), /INVALID_HOLD/);
  await assert.rejects(holdCredits({ ...input, priceSnapshot: "x".repeat(4097) }), /INVALID_HOLD/);
  for (const bad of [-1, NaN, Infinity, 1.5, 2147483648]) {
    await assert.rejects(settleCredits(input.userId, input.requestId, bad), /INVALID_SETTLEMENT/);
  }
});

test("billing: expired reservation reclaim has bounded batch size", async () => {
  for (const bad of [-1, 0, 1.1, 501, 1_000_000]) {
    await assert.rejects(reclaimExpired(bad), /INVALID_LIMIT/);
  }
});
