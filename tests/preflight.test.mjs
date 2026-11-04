import test from "node:test";
import assert from "node:assert/strict";
import { inspectIntegrationConfig } from "../scripts/preflight.mjs";

const template = {
  ALPHA_BASIC_USER: "private",
  ALPHA_BASIC_PASSWORD: "test-password-never-use-in-live",
  MONSTERA_PUBLIC_ORIGIN: "https://alpha.example.com",
  GOOGLE_CLIENT_ID: "fake-client-id",
  GOOGLE_CLIENT_SECRET: "fake-test-only-value",
  MONSTERA_EXPECTED_GOOGLE_REDIRECT_URI: "https://alpha.example.com/api/auth/google/callback",
  MONSTERA_SESSION_SECRET: "long-mock-signing-secret-for-ci-tests-000",
  DATABASE_URL: "postgresql://mock:secret@ep-example-pooler.neon.tech/staging?sslmode=require",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "fake-test-token",
  OPENROUTER_API_KEY: "fake-no-network-key",
  MONSTERA_FREE_CHAT_ENABLED: "true",
  MONSTERA_ALPHA_APPROVED_MODELS: "openrouter:mock/free",
  MONSTERA_ALPHA_DAILY_REQUEST_CAP: "10",
  MONSTERA_REDIS_NAMESPACE: "monstera:ci-staging",
  MONSTERA_STAGING_ONLY: "true",
  MONSTERA_EXPECTED_TEST_DB_NAME: "staging",
  MONSTERA_PROVIDER_SPENDING_LIMIT_CONFIRMED: "true",
  MONSTERA_ALPHA_ESTIMATED_MICRO_USD_PER_DAY: "100000",
  MONSTERA_ALPHA_PROVIDER_PRICES_JSON: JSON.stringify([{ provider: "openrouter", model: "mock/free",
    inputMicroUsdPerMillion: 200000, outputMicroUsdPerMillion: 1000000, inputTokenCeiling: 25000,
    outputTokenCeiling: 1024, reviewedAt: new Date().toISOString() }]),
};
test("preflight: only reports field statuses, never secret values or live success", () => {
  const result = inspectIntegrationConfig(template);
  assert.equal(result.syntacticallyConfiguredForStagingReview, true);
  assert.equal(result.checks.length, 16);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(template.GOOGLE_CLIENT_SECRET), false);
  assert.equal(serialized.includes(template.DATABASE_URL), false);
  assert.match(result.advisory, /unverified/);
});
test("preflight: missing credentials and invalid budget fail closed", () => {
  const allMissing = inspectIntegrationConfig({});
  assert.equal(allMissing.syntacticallyConfiguredForStagingReview, false);
  assert.equal(allMissing.checks.every(c => !c.ready), true);
  for (const bad of ["0", "-1", "1001", "1.5", "Infinity", ""]) {
    const result = inspectIntegrationConfig({ ...template, MONSTERA_ALPHA_DAILY_REQUEST_CAP: bad });
    assert.equal(result.syntacticallyConfiguredForStagingReview, false, bad);
  }
});
test("preflight: reject insecure external URLs and DB TLS disable", () => {
  const withoutTls = inspectIntegrationConfig({
    ...template, DATABASE_URL: "postgresql://u:p@db.example.com/staging?sslmode=disable",
  });
  assert.equal(withoutTls.checks.find(c => c.name === "declared_nonproduction_db").ready, false);
  const httpRedis = inspectIntegrationConfig({
    ...template, UPSTASH_REDIS_REST_URL: "http://redis.example.com/",
  });
  assert.equal(httpRedis.checks.find(c => c.name === "upstash_rest").ready, false);
  const insecureOrigin = inspectIntegrationConfig({
    ...template, MONSTERA_PUBLIC_ORIGIN: "http://alpha.example.com/",
  });
  assert.equal(insecureOrigin.checks.find(c => c.name === "public_origin").ready, false);
});


test("preflight: production DB name mismatch, missing stage marker, stale prices and absent monetary approval block readiness", () => {
  const wrongDb = inspectIntegrationConfig({ ...template, MONSTERA_EXPECTED_TEST_DB_NAME: "production" });
  assert.equal(wrongDb.syntacticallyConfiguredForStagingReview, false);
  const noStage = inspectIntegrationConfig({ ...template, MONSTERA_STAGING_ONLY: "false" });
  assert.equal(noStage.syntacticallyConfiguredForStagingReview, false);
  const unapproved = inspectIntegrationConfig({ ...template, MONSTERA_PROVIDER_SPENDING_LIMIT_CONFIRMED: "false" });
  assert.equal(unapproved.syntacticallyConfiguredForStagingReview, false);
  const stale = inspectIntegrationConfig({ ...template, MONSTERA_ALPHA_PROVIDER_PRICES_JSON: JSON.stringify([{
    provider: "openrouter", model: "mock/free", inputMicroUsdPerMillion: 200000,
    outputMicroUsdPerMillion: 1000000, inputTokenCeiling: 25000,
    outputTokenCeiling: 1024, reviewedAt: "2000-01-01T00:00:00.000Z",
  }]) });
  assert.equal(stale.syntacticallyConfiguredForStagingReview, false);
  assert.ok(unapproved.advisory.includes("unverified"));
});


test("preflight: staging callback must exactly match public HTTPS origin", () => {
  const valid = inspectIntegrationConfig(template);
  assert.equal(valid.checks.find(check => check.name === "google_redirect_uri").ready, true);
  for (const bad of [
    "https://other.example.com/api/auth/google/callback",
    "http://alpha.example.com/api/auth/google/callback",
    "https://alpha.example.com/api/auth/google/callback?next=evil",
    "https://alpha.example.com/api/auth/google/callback/",
    "https://alpha.example.com/api/auth/google/callback#fragment",
    "",
  ]) {
    const result = inspectIntegrationConfig({ ...template, MONSTERA_EXPECTED_GOOGLE_REDIRECT_URI: bad });
    assert.equal(result.syntacticallyConfiguredForStagingReview, false, bad);
  }
});
