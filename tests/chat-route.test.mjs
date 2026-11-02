import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { POST as chat } from "../app/api/chat/route.ts";
import { GET as modelList } from "../app/api/models/route.ts";
import { GET as credits } from "../app/api/credits/route.ts";
import { createSessionToken } from "../lib/session-token.ts";
import { addUser, addModel, addCredits, queries, resetTestDb } from "./mocks/db-pool.mjs";
import { resetTestRedis, failTestRedis } from "./mocks/upstash.mjs";

const alice = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bob = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const free = "11111111-1111-4111-8111-111111111111";
const creator = "22222222-2222-4222-8222-222222222222";
const paid = "33333333-3333-4333-8333-333333333333";
const unknown = "44444444-4444-4444-8444-444444444444";
const base = "http://localhost:3000";
const secret = "chat-api-unit-secret-longer-than-32-characters";
let providerCalls = [];

function session(userId, epoch = 1) {
  return "monstera_session=" + createSessionToken(userId, epoch, secret);
}
function request(path, userId, method = "GET", payload, extra = {}) {
  return new NextRequest(base + path, {
    method,
    headers: {
      ...(userId ? { cookie: session(userId) } : {}),
      ...(method === "POST" ? { origin: base, "content-type": "application/json", "x-monstera-request-id": "77777777-7777-4777-8777-777777777777" } : {}),
      ...extra,
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}
const userMessage = [{ role: "user", content: "mock-only, no external AI calls" }];
function fakeSse(text) {
  return new Response('data: {"choices":[{"delta":{"content":"' + text + '"}}]}\n\n' +
    'data: [DONE]\n\n', { status: 200 });
}

beforeEach(() => {
  process.env.MONSTERA_SESSION_SECRET = secret;
  process.env.MONSTERA_FREE_CHAT_ENABLED = "true";
  process.env.OPENROUTER_API_KEY = "fake-no-network-openrouter";
  process.env.DEEPINFRA_API_KEY = "fake-no-network-deepinfra";
  process.env.UPSTASH_REDIS_REST_URL = "https://no-network.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-no-network-redis";
  process.env.MONSTERA_ALPHA_DAILY_REQUEST_CAP = "100";
  process.env.MONSTERA_INTERNAL_CREDIT_TEST_MODE = "false";
  process.env.MONSTERA_REDIS_NAMESPACE = "monstera:unit-alpha";
  process.env.MONSTERA_PROVIDER_SPENDING_LIMIT_CONFIRMED = "true"; // CI mock, not an actual provider budget
  process.env.MONSTERA_ALPHA_ESTIMATED_MICRO_USD_PER_DAY = "1000000";
  process.env.MONSTERA_ALPHA_PROVIDER_PRICES_JSON = JSON.stringify([
    { provider: "openrouter", model: "mock/free", inputMicroUsdPerMillion: 200000,
      outputMicroUsdPerMillion: 1000000, inputTokenCeiling: 25000,
      outputTokenCeiling: 1024, reviewedAt: new Date().toISOString() },
    { provider: "deepinfra", model: "mock/creator", inputMicroUsdPerMillion: 300000,
      outputMicroUsdPerMillion: 1000000, inputTokenCeiling: 25000,
      outputTokenCeiling: 1024, reviewedAt: new Date().toISOString() },
  ]);

  process.env.MONSTERA_ALPHA_APPROVED_MODELS = "openrouter:mock/free,deepinfra:mock/creator,openrouter:mock/paid";
  resetTestDb();
  resetTestRedis();
  providerCalls = [];
  addUser({ id: alice, tier: "free", session_epoch: 1, email_verified_at: new Date(), google_sub: "google-alice" });
  addUser({ id: bob, tier: "creator", session_epoch: 1, email_verified_at: new Date(), google_sub: "google-bob" });
  addCredits(alice, 5);
  addCredits(bob, 150, 25);
  addModel({ id: free, provider: "openrouter", upstream_id: "mock/free", tier_min: "free", ctx: 4096,
    price_in: "0", price_out: "0", enabled: true });
  addModel({ id: creator, provider: "deepinfra", upstream_id: "mock/creator", tier_min: "creator", ctx: 4096,
    price_in: "0", price_out: "0", enabled: true });
  addModel({ id: paid, provider: "openrouter", upstream_id: "mock/paid", tier_min: "free", ctx: 4096,
    price_in: "0.01", price_out: "0", enabled: true });
  globalThis.fetch = async url => {
    providerCalls.push(String(url));
    if (url === "https://openrouter.ai/api/v1/chat/completions") return fakeSse("MOCK_OPENROUTER");
    if (url === "https://api.deepinfra.com/v1/openai/chat/completions") return fakeSse("MOCK_DEEPINFRA");
    throw new Error("UNEXPECTED_EXTERNAL_NETWORK_ACCESS");
  };
});

test("route: unauthenticated and stale sessions are rejected before any provider call", async () => {
  assert.equal((await chat(request("/api/chat", undefined, "POST", { modelId: free, messages: userMessage }))).status, 401);
  assert.equal((await chat(request("/api/chat", alice, "POST", { modelId: free, messages: userMessage },
    { cookie: session(alice, 0) }))).status, 401);
  assert.equal((await modelList(request("/api/models", undefined))).status, 401);
  assert.equal((await credits(request("/api/credits", undefined))).status, 401);
  assert.equal(providerCalls.length, 0);
});

test("route: model list and credits use session identity and tier, never client userId", async () => {
  const a = await modelList(request("/api/models?userId=" + bob, alice));
  assert.equal(a.status, 200);
  const dataA = await a.json();
  assert.equal(dataA.userId, alice);
  assert.deepEqual(dataA.models.map(x => x.id).sort(), [free, paid].sort());
  const b = await modelList(request("/api/models", bob));
  assert.deepEqual((await b.json()).models.map(x => x.id).sort(), [free, creator, paid].sort());
  assert.deepEqual(await (await credits(request("/api/credits?userId=" + bob, alice))).json(),
    { balance: 5, reserved: 0, available: 5 });
  assert.deepEqual(await (await credits(request("/api/credits", bob))).json(),
    { balance: 150, reserved: 25, available: 125 });
  assert.ok(queries().filter(x => x.sql.includes("FROM credits")).every(x => x.parameters.length === 1 &&
    [alice, bob].includes(x.parameters[0])));
});

test("route: authenticated chat streams one completion from mocked OpenRouter", async () => {
  const response = await chat(request("/api/chat", alice, "POST", {
    modelId: free, messages: userMessage, userId: bob, tier: "studio",
  }));
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.ok(body.includes('event: delta\ndata: {"text":"MOCK_OPENROUTER"}\n\n'));
  assert.equal((body.match(/event: done/g) ?? []).length, 1);
  assert.equal(providerCalls.length, 1);
  assert.ok(queries().filter(x => x.sql.includes("FROM users WHERE id")).every(x => x.parameters[0] === alice));
});

test("route: stale tab cannot send another account's local history under a new session", async () => {
  const response = await chat(request("/api/chat", bob, "POST", {
    modelId: free, messages: [{ role: "user", content: "private Alice history" }],
  }, { "x-monstera-expected-user": alice }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "SESSION_CHANGED");
  assert.equal(providerCalls.length, 0);
});

test("route: tier checks, unknown models and paid models reject before provider invocation", async () => {
  for (const [modelId, status, code] of [
    [creator, 403, "TIER_FORBIDDEN"],
    [unknown, 404, "MODEL_NOT_FOUND"],
    [paid, 403, "MODEL_REQUIRES_BILLING"],
  ]) {
    const response = await chat(request("/api/chat", alice, "POST", { modelId, messages: userMessage }));
    assert.equal(response.status, status, modelId);
    assert.equal((await response.json()).code, code);
  }
  assert.equal(providerCalls.length, 0);
});

test("route: creator can select DeepInfra or pre-first-token provider fallback", async () => {
  const direct = await chat(request("/api/chat", bob, "POST", { modelId: creator, messages: userMessage }));
  assert.equal(direct.status, 200);
  assert.match(await direct.text(), /MOCK_DEEPINFRA/);
  globalThis.fetch = async url => {
    providerCalls.push(String(url));
    if (url === "https://openrouter.ai/api/v1/chat/completions") return new Response("provider unavailable", { status: 503 });
    if (url === "https://api.deepinfra.com/v1/openai/chat/completions") return fakeSse("FALLBACK_OK");
    throw new Error("UNEXPECTED_EXTERNAL_NETWORK_ACCESS");
  };
  const result = await chat(request("/api/chat", bob, "POST", {
    modelId: free, fallbackModelId: creator, messages: userMessage,
  }));
  assert.equal(result.status, 200);
  const body = await result.text();
  assert.match(body, /FALLBACK_OK/);
  assert.equal((body.match(/event: done/g) ?? []).length, 1);
});

test("route: free chat disabled, Redis failure and price disagreement fail closed", async () => {
  process.env.MONSTERA_FREE_CHAT_ENABLED = "false";
  const disabled = await chat(request("/api/chat", alice, "POST", { modelId: free, messages: userMessage }));
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).code, "BILLING_POLICY_NOT_CONFIGURED");
  process.env.MONSTERA_FREE_CHAT_ENABLED = "true";
  failTestRedis(true);
  const down = await chat(request("/api/chat", alice, "POST", { modelId: free, messages: userMessage }));
  assert.equal(down.status, 503);
  assert.equal((await down.json()).code, "CHAT_UNAVAILABLE");
  failTestRedis(false);
  process.env.MONSTERA_ALPHA_APPROVED_MODELS = "deepinfra:mock/creator";
  const notApproved = await chat(request("/api/chat", alice, "POST", { modelId: free, messages: userMessage }));
  assert.equal(notApproved.status, 403);
  assert.equal(providerCalls.length, 0);
});

test("route: missing CSRF origin on chat mutation is rejected even with a valid session", async () => {
  const response = await chat(request("/api/chat", alice, "POST",
    { modelId: free, messages: userMessage }, { origin: "" }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "FORBIDDEN");
  assert.equal(providerCalls.length, 0);
});

test("route: invalid origins and oversized JSON are rejected before any provider call", async () => {
  const foreign = await chat(request("/api/chat", alice, "POST", { modelId: free, messages: userMessage },
    { origin: "https://other.example" }));
  assert.equal(foreign.status, 403);
  const large = await chat(request("/api/chat", alice, "POST", {
    modelId: free, messages: [{ role: "user", content: "x".repeat(24500) }],
  }, { "content-length": "1" }));
  assert.equal(large.status, 413);
  assert.equal(providerCalls.length, 0);
});


test("route: excessive provider output is terminated without emitting a successful done", async () => {
  const frame = "data: " + JSON.stringify({ choices: [{ delta: { content: "x".repeat(9000) } }] }) + "\n\n";
  globalThis.fetch = async () => new Response(frame.repeat(20) + "data: [DONE]\n\n", { status: 200 });
  const response = await chat(request("/api/chat", alice, "POST", {
    modelId: free, messages: userMessage,
  }));
  assert.equal(response.status, 200);
  const output = await response.text();
  assert.match(output, /CHAT_RESPONSE_TOO_LARGE/);
  assert.doesNotMatch(output, /event: done/);
  assert.ok(output.length < 160000);
});


test("route: missing provider monetary approval and missing reviewed prices cannot call upstream", async () => {
  delete process.env.MONSTERA_PROVIDER_SPENDING_LIMIT_CONFIRMED;
  const unsafe = await chat(request("/api/chat", alice, "POST", { modelId: free, messages: userMessage }));
  assert.equal(unsafe.status, 503);
  assert.equal((await unsafe.json()).code, "CHAT_UNAVAILABLE");
  process.env.MONSTERA_PROVIDER_SPENDING_LIMIT_CONFIRMED = "true";
  delete process.env.MONSTERA_ALPHA_PROVIDER_PRICES_JSON;
  const unknownPrice = await chat(request("/api/chat", alice, "POST", { modelId: free, messages: userMessage }));
  assert.equal(unknownPrice.status, 503);
  assert.equal(providerCalls.length, 0);
});

test("route: simulated daily USD micro cap prevents dispatching expensive alpha requests", async () => {
  process.env.MONSTERA_ALPHA_ESTIMATED_MICRO_USD_PER_DAY = "100";
  const expensive = await chat(request("/api/chat", alice, "POST", {
    modelId: free, messages: userMessage,
  }));
  assert.equal(expensive.status, 429);
  assert.equal((await expensive.json()).code, "ESTIMATED_BUDGET_EXCEEDED");
  assert.equal(providerCalls.length, 0);
});
