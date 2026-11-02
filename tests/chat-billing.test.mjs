import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { POST as chat } from "../app/api/chat/route.ts";
import { POST as manualReclaim } from "../app/api/internal/credits/reclaim/route.ts";
import { createSessionToken } from "../lib/session-token.ts";
import { holdCredits, settleCredits } from "../lib/billing.ts";
import { matchingReviewedProviderPrices, estimateRouteMaximumCost } from "../lib/provider-cost-policy.ts";
import { resetTestDb, addUser, addModel } from "./mocks/db-pool.mjs";
import { resetBillingMock, seedBillingCredit, billingCredit, billingLedger, failNextBillingQuery, expireBillingLedger } from "./mocks/billing-pool.mjs";
import { resetTestRedis } from "./mocks/upstash.mjs";

const alice = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const modelId = "11111111-1111-4111-8111-111111111111";
const requestId = "99999999-9999-4999-8999-999999999999";
const origin = "http://localhost:3000";
const secret = "billing-route-mock-signing-key-with-32-plus-bytes";
const messages = [{ role: "user", content: "only synthetic test prompt" }];
let upstreamCount = 0;

function request(id = requestId, signal) {
  return new NextRequest(origin + "/api/chat", {
    method: "POST",
    headers: {
      origin, "content-type": "application/json",
      cookie: "monstera_session=" + createSessionToken(alice, 1, secret),
      "x-monstera-request-id": id,
      "x-monstera-expected-user": alice,
    },
    body: JSON.stringify({ modelId, messages }),
    ...(signal ? { signal } : {}),
  });
}
function upstream(text, outputTokens) {
  const frames = [{ choices: [{ delta: { content: text } }] }];
  if (outputTokens !== undefined) frames.push({ usage: { prompt_tokens: 12, completion_tokens: outputTokens } });
  const payload = frames.map(value => "data: " + JSON.stringify(value) + "\n\n").join("") + "data: [DONE]\n\n";
  return new Response(payload, { status: 200 });
}
function initialHold() {
  const approved = JSON.parse(process.env.MONSTERA_ALPHA_PROVIDER_PRICES_JSON);
  const snapshots = matchingReviewedProviderPrices(JSON.stringify(approved), [
    { provider: "openrouter", upstream_id: "mock/model" },
  ]);
  return {
    userId: alice, requestId, model: modelId,
    reserved: estimateRouteMaximumCost(snapshots).estimatedMaximumMicroUsd,
    priceSnapshot: JSON.stringify(snapshots),
  };
}
beforeEach(() => {
  upstreamCount = 0;
  resetTestDb(); resetTestRedis(); resetBillingMock();
  addUser({ id: alice, tier: "free", session_epoch: 1, google_sub: "mock-google", email_verified_at: new Date() });
  addModel({ id: modelId, provider: "openrouter", upstream_id: "mock/model", tier_min: "free",
    price_in: "0", price_out: "0", ctx: 4096, enabled: true });
  seedBillingCredit(alice, 100000);
  process.env.MONSTERA_SESSION_SECRET = secret;
  process.env.MONSTERA_FREE_CHAT_ENABLED = "true";
  process.env.MONSTERA_INTERNAL_CREDIT_TEST_MODE = "true";
  process.env.MONSTERA_RECLAIM_OPERATOR_KEY = "mock-only-manual-credit-reclaim-token-long-1234";
  process.env.OPENROUTER_API_KEY = "mock-never-use-live";
  delete process.env.DEEPINFRA_API_KEY;
  process.env.UPSTASH_REDIS_REST_URL = "https://test-only.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN = "mock-token";
  process.env.MONSTERA_ALPHA_DAILY_REQUEST_CAP = "100";
  process.env.MONSTERA_REDIS_NAMESPACE = "monstera:billing-test";
  process.env.MONSTERA_PROVIDER_SPENDING_LIMIT_CONFIRMED = "true";
  process.env.MONSTERA_ALPHA_ESTIMATED_MICRO_USD_PER_DAY = "1000000";
  process.env.MONSTERA_ALPHA_APPROVED_MODELS = "openrouter:mock/model";
  process.env.MONSTERA_ALPHA_PROVIDER_PRICES_JSON = JSON.stringify([{
    provider: "openrouter", model: "mock/model", inputMicroUsdPerMillion: 200000,
    outputMicroUsdPerMillion: 1000000, inputTokenCeiling: 25000,
    outputTokenCeiling: 1024, reviewedAt: new Date().toISOString(),
  }]);
  globalThis.fetch = async url => {
    assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
    upstreamCount++;
    return upstream("TEST_DELTA", 100);
  };
});

test("billing chat: hold -> delta -> usage -> settle exactly once", async () => {
  const response = await chat(request());
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /TEST_DELTA/);
  assert.equal((body.match(/event: done/g) ?? []).length, 1);
  const hold = initialHold();
  assert.deepEqual(billingCredit(alice), { balance: 99900, reserved: 0 });
  assert.equal(billingLedger(alice, requestId).settled_amount, 100);
  assert.equal(billingLedger(alice, requestId).reserved_amount, hold.reserved);
  assert.equal(upstreamCount, 1);
});

test("billing chat: insufficient balance returns 402 without persisted held ledger", async () => {
  seedBillingCredit(alice, 0);
  const response = await chat(request());
  assert.equal(response.status, 402);
  assert.equal((await response.json()).code, "INSUFFICIENT_CREDITS");
  assert.equal(billingLedger(alice, requestId), null);
  assert.equal(upstreamCount, 0);
});

test("billing chat: reused requestId cannot reopen a held or settled stream", async () => {
  const hold = initialHold();
  assert.equal((await holdCredits(hold)).status, "held");
  const duplicate = await chat(request());
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).code, "DUPLICATE_IN_FLIGHT");
  assert.equal(billingCredit(alice).reserved, hold.reserved);
  await settleCredits(alice, requestId, 7);
  const settled = await chat(request());
  assert.equal(settled.status, 409);
  assert.deepEqual(await settled.json(), { code: "ALREADY_SETTLED", charged: 7 });
  assert.deepEqual(billingCredit(alice), { balance: 99993, reserved: 0 });
  assert.equal(upstreamCount, 0);
});

test("billing chat: client abort before first delta settles zero and frees full reservation", async () => {
  const abort = new AbortController();
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("MOCK_ABORT")), { once: true });
  });
  const response = await chat(request(requestId, abort.signal));
  assert.equal(response.status, 200);
  abort.abort();
  await response.text();
  assert.deepEqual(billingCredit(alice), { balance: 100000, reserved: 0 });
  assert.equal(billingLedger(alice, requestId).status, "settled");
  assert.equal(billingLedger(alice, requestId).settled_amount, 0);
});

test("billing chat: ledger update throws, SSE closes with exactly one settlement error frame", async () => {
  failNextBillingQuery("UPDATE usage_ledger SET status = 'settled'");
  const response = await chat(request());
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.equal((body.match(/event: error/g) ?? []).length, 1);
  assert.match(body, /SETTLEMENT_FAILED/);
  assert.doesNotMatch(body, /event: done/);
  assert.deepEqual(billingCredit(alice), { balance: 100000, reserved: initialHold().reserved });
  assert.equal(billingLedger(alice, requestId).status, "held");
});

test("billing chat: missing usage uses conservative character estimate without exceeding hold", async () => {
  globalThis.fetch = async () => upstream("0123456789");
  const response = await chat(request());
  assert.equal(response.status, 200);
  assert.match(await response.text(), /event: done/);
  assert.equal(billingLedger(alice, requestId).settled_amount, 10);
  assert.equal(billingCredit(alice).reserved, 0);
  assert.ok(billingLedger(alice, requestId).settled_amount <= billingLedger(alice, requestId).reserved_amount);
});

test("billing chat: invalid request ID is rejected and cannot allocate hold", async () => {
  const response = await chat(request("not-a-uuid"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INVALID_REQUEST_ID");
  assert.equal(billingLedger(alice, "not-a-uuid"), null);
  assert.equal(upstreamCount, 0);
});

test("billing chat: internal credit test switch is always disabled in production", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const response = await chat(request());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "CREDIT_BILLING_NOT_APPROVED");
    assert.equal(billingLedger(alice, requestId), null);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});


test("billing maintenance: operator-only manual reclaim uses existing helper and rejects bad tokens", async () => {
  await holdCredits(initialHold());
  expireBillingLedger(alice, requestId);
  const endpoint = origin + "/api/internal/credits/reclaim";
  const invalid = await manualReclaim(new NextRequest(endpoint, {
    method: "POST", headers: { origin, authorization: "Bearer wrong-token" },
  }));
  assert.equal(invalid.status, 401);
  assert.equal(billingLedger(alice, requestId).status, "held");
  const valid = await manualReclaim(new NextRequest(endpoint, {
    method: "POST", headers: {
      origin, authorization: "Bearer " + process.env.MONSTERA_RECLAIM_OPERATOR_KEY,
    },
  }));
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { reclaimed: 1 });
  assert.equal(billingLedger(alice, requestId).status, "reclaimed");
  assert.deepEqual(billingCredit(alice), { balance: 100000, reserved: 0 });
});
