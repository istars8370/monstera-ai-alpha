import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateProviderMaximumCost, estimateRouteMaximumCost, withinSimulatedBudget,
} from "../lib/provider-cost-policy.ts";

const now = new Date("2026-11-02T00:00:00.000Z");
const primary = {
  provider: "openrouter", model: "mock/model",
  inputMicroUsdPerMillion: 200_000, outputMicroUsdPerMillion: 1_000_000,
  inputTokenCeiling: 1000, outputTokenCeiling: 1024,
  reviewedAt: "2026-11-01T00:00:00.000Z",
};
test("simulated USD micro cost is ceiling-rounded without floating-point underbilling", () => {
  const result = estimateProviderMaximumCost(primary, now);
  assert.deepEqual(result, {
    currency: "USD", estimatedMaximumMicroUsd: 1224, providerHardLimitVerified: false,
  });
  const minimum = estimateProviderMaximumCost({
    ...primary, inputTokenCeiling: 1, outputTokenCeiling: 1,
    inputMicroUsdPerMillion: 1, outputMicroUsdPerMillion: 1,
  }, now);
  assert.equal(minimum.estimatedMaximumMicroUsd, 2);
});

test("simulated route includes worst-case cost for both fallback attempts", () => {
  const backup = { ...primary, provider: "deepinfra", model: "mock/fallback",
    inputMicroUsdPerMillion: 500_000 };
  const route = estimateRouteMaximumCost([primary, backup], now);
  assert.equal(route.estimatedMaximumMicroUsd, 1224 + 1524);
  assert.equal(withinSimulatedBudget(route, 3000, 3000), true);
  assert.equal(withinSimulatedBudget(route, 2700, 3000), false);
  assert.equal(withinSimulatedBudget(route, 3000, 1000), false);
  assert.throws(() => estimateRouteMaximumCost([primary, primary], now), /INVALID_PROVIDER_ROUTE/);
  assert.throws(() => estimateRouteMaximumCost([], now), /INVALID_PROVIDER_ROUTE/);
});

test("unknown or stale prices, unbounded tokens and malformed numeric values fail closed", () => {
  for (const field of ["inputMicroUsdPerMillion", "outputMicroUsdPerMillion"]) {
    for (const value of [-1, NaN, Infinity, 1.5, 1_000_000_000_001]) {
      assert.throws(() => estimateProviderMaximumCost({ ...primary, [field]: value }, now), /INVALID_PROVIDER_COST_SNAPSHOT/);
    }
  }
  for (const field of ["inputTokenCeiling", "outputTokenCeiling"]) {
    for (const value of [0, -1, 1.5, 1_000_001]) {
      assert.throws(() => estimateProviderMaximumCost({ ...primary, [field]: value }, now), /INVALID_PROVIDER_COST_SNAPSHOT/);
    }
  }
  assert.throws(() => estimateProviderMaximumCost({ ...primary, reviewedAt: "2026-10-01T00:00:00Z" }, now), /PROVIDER_PRICE_REVIEW_REQUIRED/);
  assert.throws(() => estimateProviderMaximumCost({ ...primary, reviewedAt: "2026-11-03T00:00:00Z" }, now), /PROVIDER_PRICE_REVIEW_REQUIRED/);
  assert.throws(() => estimateProviderMaximumCost({ ...primary, provider: "unverified" }, now), /INVALID_PROVIDER_COST_SNAPSHOT/);
  assert.throws(() => withinSimulatedBudget({ ...estimateProviderMaximumCost(primary, now), estimatedMaximumMicroUsd: NaN }, 1000, 1000), /INVALID_SIMULATED_BUDGET/);
});

test("estimated model exposure never claims actual provider-side hard limits", () => {
  const exposure = estimateProviderMaximumCost(primary, now);
  assert.equal(exposure.providerHardLimitVerified, false);
  assert.equal(withinSimulatedBudget(exposure, 1224, 1224), true);
  assert.equal(withinSimulatedBudget(exposure, 1223, 1224), false);
});
