import test from "node:test";
import assert from "node:assert/strict";
import { inspectIntegrationConfig } from "../scripts/preflight.mjs";

const template = {
  ALPHA_BASIC_USER: "private",
  ALPHA_BASIC_PASSWORD: "test-password-never-use-in-live",
  MONSTERA_PUBLIC_ORIGIN: "https://alpha.example.com",
  GOOGLE_CLIENT_ID: "fake-client-id",
  GOOGLE_CLIENT_SECRET: "fake-test-only-value",
  MONSTERA_SESSION_SECRET: "long-mock-signing-secret-for-ci-tests-000",
  DATABASE_URL: "postgresql://mock:secret@ep-example-pooler.neon.tech/staging?sslmode=require",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "fake-test-token",
  OPENROUTER_API_KEY: "fake-no-network-key",
  MONSTERA_FREE_CHAT_ENABLED: "true",
  MONSTERA_ALPHA_APPROVED_MODELS: "openrouter:mock/free",
  MONSTERA_ALPHA_DAILY_REQUEST_CAP: "10",
};
test("preflight: only reports field statuses, never secret values or live success", () => {
  const result = inspectIntegrationConfig(template);
  assert.equal(result.readyForApprovedLiveTesting, true);
  assert.equal(result.checks.length, 10);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(template.GOOGLE_CLIENT_SECRET), false);
  assert.equal(serialized.includes(template.DATABASE_URL), false);
  assert.match(result.advisory, /unverified/);
});
test("preflight: missing credentials and invalid budget fail closed", () => {
  const allMissing = inspectIntegrationConfig({});
  assert.equal(allMissing.readyForApprovedLiveTesting, false);
  assert.equal(allMissing.checks.every(c => !c.ready), true);
  for (const bad of ["0", "-1", "1001", "1.5", "Infinity", ""]) {
    const result = inspectIntegrationConfig({ ...template, MONSTERA_ALPHA_DAILY_REQUEST_CAP: bad });
    assert.equal(result.readyForApprovedLiveTesting, false, bad);
  }
});
test("preflight: reject insecure external URLs and DB TLS disable", () => {
  const withoutTls = inspectIntegrationConfig({
    ...template, DATABASE_URL: "postgresql://u:p@db.example.com/staging?sslmode=disable",
  });
  assert.equal(withoutTls.checks.find(c => c.name === "nonproduction_neon_url").ready, false);
  const httpRedis = inspectIntegrationConfig({
    ...template, UPSTASH_REDIS_REST_URL: "http://redis.example.com/",
  });
  assert.equal(httpRedis.checks.find(c => c.name === "upstash_rest").ready, false);
  const insecureOrigin = inspectIntegrationConfig({
    ...template, MONSTERA_PUBLIC_ORIGIN: "http://alpha.example.com/",
  });
  assert.equal(insecureOrigin.checks.find(c => c.name === "public_origin").ready, false);
});
