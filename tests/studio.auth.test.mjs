import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { POST as quote } from "../app/api/studio/quote/route.ts";
import { createSessionToken } from "../lib/session-token.ts";
import { addUser, resetTestDb } from "./mocks/db-pool.mjs";

const origin = "http://localhost:3000";
const secret = "studio-test-only-session-key-over-thirty-two-bytes";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sample = { paid_krw:100000, cash_cost_krw:10000, labor_minutes:60,
  labor_rate_krw:20000, fee_krw:1000, refund_krw:0 };
beforeEach(() => {
  resetTestDb();
  process.env.MONSTERA_PUBLIC_ORIGIN = origin;
  process.env.MONSTERA_SESSION_SECRET = secret;
});
function makeRequest(body = sample, cookie = "", requestOrigin = origin) {
  return new NextRequest(origin + "/api/studio/quote", {
    method: "POST",
    headers: { origin:requestOrigin, "content-type":"application/json", ...(cookie ? {cookie} : {}) },
    body: JSON.stringify(body),
  });
}
function login(tier) {
  addUser({id, tier, session_epoch:0, email_verified_at:new Date(),
    google_sub:"verified-test-sub", email:"studio@example.invalid"});
  return "monstera_session=" + createSessionToken(id,0,secret);
}
test("studio quote: anonymous request is denied without querying a valid user", async () => {
  const response = await quote(makeRequest());
  assert.equal(response.status,401);
});
test("studio quote: free and creator tiers receive 403", async () => {
  for (const tier of ["free","creator"]) {
    resetTestDb();
    const response = await quote(makeRequest(sample,login(tier)));
    assert.equal(response.status,403);
  }
});
test("studio quote: authenticated studio tier calculates server-side", async () => {
  const response = await quote(makeRequest({...sample,userId:"forged",tier:"free",
    labor_cost_krw:0,contribution_krw:900000},login("studio")));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{
    net_revenue_krw:100000,labor_cost_krw:20000,contribution_krw:69000,margin_pct:69,
  });
  assert.equal(response.headers.get("cache-control"),"no-store");
});
test("studio quote: invalid Origin is denied even with a valid session", async () => {
  assert.equal((await quote(makeRequest(sample,login("studio"),"https://evil.example"))).status,403);
});
test("studio quote: overlong request is rejected before quote evaluation", async () => {
  const response = await quote(makeRequest({...sample,padding:"x".repeat(10000)},login("studio")));
  assert.equal(response.status,413);
});
test("studio quote: invalid amounts cannot be coerced to zero", async () => {
  const response = await quote(makeRequest({...sample,paid_krw:null},login("studio")));
  assert.equal(response.status,400);
});
