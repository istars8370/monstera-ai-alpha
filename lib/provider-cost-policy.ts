/**
 * Conservative internal USD-micro cost estimates for offline / staging tests.
 *
 * These calculations NEVER establish an actual provider-side spending ceiling:
 * provider prices can change and unknown/hidden charges or retries may exceed
 * estimates. Actual paid calls remain disabled until external hard caps, approved
 * pricing, usage reconciliation and an explicit launch decision are in place.
 *
 * Prices are integer micro-USD per million tokens (e.g. $1/M = 1_000_000).
 * All arithmetic uses bigint until checked conversion, so fractional rounding
 * and JS floating-point errors cannot under-reserve a simulated budget.
 */
export interface ApprovedProviderPrice {
  provider: "openrouter" | "deepinfra";
  model: string;
  inputMicroUsdPerMillion: number;
  outputMicroUsdPerMillion: number;
  inputTokenCeiling: number;
  outputTokenCeiling: number;
  reviewedAt: string;
}
export interface CostEstimate {
  currency: "USD";
  estimatedMaximumMicroUsd: number;
  providerHardLimitVerified: false;
}

const MILLION = 1_000_000n;
const MAX_TOKEN_COUNT = 1_000_000;
const MAX_PRICE_MICROS_PER_MILLION = 1_000_000_000_000;
const REVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function boundedInteger(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
function ceilDivide(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor;
}

export function estimateProviderMaximumCost(
  snapshot: ApprovedProviderPrice,
  now: Date = new Date(),
): CostEstimate {
  if (!["openrouter", "deepinfra"].includes(snapshot.provider) ||
      !snapshot.model || snapshot.model.length > 512 ||
      !boundedInteger(snapshot.inputTokenCeiling, 1, MAX_TOKEN_COUNT) ||
      !boundedInteger(snapshot.outputTokenCeiling, 1, MAX_TOKEN_COUNT) ||
      !boundedInteger(snapshot.inputMicroUsdPerMillion, 0, MAX_PRICE_MICROS_PER_MILLION) ||
      !boundedInteger(snapshot.outputMicroUsdPerMillion, 0, MAX_PRICE_MICROS_PER_MILLION) ||
      !Number.isFinite(now.getTime())) {
    throw new Error("INVALID_PROVIDER_COST_SNAPSHOT");
  }
  // Using an unreviewed or future-dated price can systematically under-budget.
  const reviewed = Date.parse(snapshot.reviewedAt);
  if (!Number.isFinite(reviewed) || reviewed > now.getTime() ||
      now.getTime() - reviewed > REVIEW_TTL_MS) {
    throw new Error("PROVIDER_PRICE_REVIEW_REQUIRED");
  }
  const input = ceilDivide(
    BigInt(snapshot.inputTokenCeiling) * BigInt(snapshot.inputMicroUsdPerMillion), MILLION,
  );
  const output = ceilDivide(
    BigInt(snapshot.outputTokenCeiling) * BigInt(snapshot.outputMicroUsdPerMillion), MILLION,
  );
  const total = input + output;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("PROVIDER_COST_EXCEEDS_SAFE_RANGE");
  return {
    currency: "USD",
    estimatedMaximumMicroUsd: Number(total),
    providerHardLimitVerified: false,
  };
}

export function estimateRouteMaximumCost(
  snapshots: readonly ApprovedProviderPrice[],
  now: Date = new Date(),
): CostEstimate {
  // A fallback can incur a partial upstream charge, so budget BOTH model calls.
  if (snapshots.length === 0 || snapshots.length > 2) throw new Error("INVALID_PROVIDER_ROUTE");
  const keys = snapshots.map(s => s.provider + ":" + s.model);
  if (new Set(keys).size !== keys.length) throw new Error("INVALID_PROVIDER_ROUTE");
  const total = snapshots.reduce((sum, s) => {
    const next = sum + BigInt(estimateProviderMaximumCost(s, now).estimatedMaximumMicroUsd);
    if (next > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("PROVIDER_COST_EXCEEDS_SAFE_RANGE");
    return next;
  }, 0n);
  return {
    currency: "USD",
    estimatedMaximumMicroUsd: Number(total),
    providerHardLimitVerified: false,
  };
}

export function withinSimulatedBudget(
  estimate: CostEstimate,
  maxRequestMicroUsd: number,
  remainingDailyMicroUsd: number,
): boolean {
  if (!boundedInteger(maxRequestMicroUsd, 1, Number.MAX_SAFE_INTEGER) ||
      !boundedInteger(remainingDailyMicroUsd, 0, Number.MAX_SAFE_INTEGER) ||
      !boundedInteger(estimate.estimatedMaximumMicroUsd, 0, Number.MAX_SAFE_INTEGER) ||
      estimate.currency !== "USD" || estimate.providerHardLimitVerified !== false) {
    throw new Error("INVALID_SIMULATED_BUDGET");
  }
  return estimate.estimatedMaximumMicroUsd <= maxRequestMicroUsd &&
    estimate.estimatedMaximumMicroUsd <= remainingDailyMicroUsd;
}
