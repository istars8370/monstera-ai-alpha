// Fail-closed controls for explicitly approved unbilled private-alpha provider calls.
// These are request-count limits, NOT a guaranteed monetary budget.
export interface FreeModelRecord {
  id: string;
  provider: string;
  upstream_id: string;
  price_in: string;
  price_out: string;
}
export function approvedFreeModels(
  models: readonly FreeModelRecord[],
  requestedIds: readonly string[],
  approvedNames: string | undefined,
): boolean {
  if (!approvedNames || requestedIds.length < 1) return false;
  const allow = new Set(approvedNames.split(",").map(v => v.trim()).filter(Boolean));
  const ids = new Set(requestedIds);
  if (allow.size === 0 || models.length !== ids.size ||
      new Set(models.map(m => m.id)).size !== ids.size) return false;
  return models.every(m =>
    ids.has(m.id) && allow.has(m.provider + ":" + m.upstream_id) &&
    Number.isFinite(Number(m.price_in)) && Number(m.price_in) === 0 &&
    Number.isFinite(Number(m.price_out)) && Number(m.price_out) === 0,
  );
}

// Both counters are read and incremented inside ONE Redis script to avoid races.
export const ALPHA_BUDGET_LUA = [
  "local day = redis.call('GET', KEYS[2])",
  "if day and tonumber(day) >= tonumber(ARGV[2]) then return 2 end",
  "local minute = redis.call('GET', KEYS[1])",
  "if minute and tonumber(minute) >= tonumber(ARGV[1]) then return 1 end",
  "local m = redis.call('INCR', KEYS[1])",
  "if m == 1 then redis.call('EXPIRE', KEYS[1], 70) end",
  "local d = redis.call('INCR', KEYS[2])",
  "if d == 1 then redis.call('EXPIRE', KEYS[2], 90000) end",
  "return 0",
].join("\n");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AlphaBudgetResult = "allowed" | "user_rate_limited" | "daily_limit_reached";
export async function reserveAlphaRequest(
  userId: string,
  dailyCap: string | undefined,
  evalScript: (script: string, keys: string[], args: string[]) => Promise<unknown>,
  now: Date = new Date(),
  namespace = "monstera:alpha",
): Promise<AlphaBudgetResult> {
  const maxDaily = Number(dailyCap);
  if (!UUID.test(userId) || !dailyCap || !/^[1-9][0-9]*$/.test(dailyCap) ||
      !Number.isSafeInteger(maxDaily) || maxDaily > 1000 ||
      !Number.isFinite(now.getTime()) || !/^[a-z][a-z0-9:-]{3,48}$/.test(namespace)) {
    throw new Error("ALPHA_BUDGET_NOT_CONFIGURED");
  }
  const minuteKey = namespace + ":minute:" + userId + ":" + Math.floor(now.getTime() / 60000);
  const dayKey = namespace + ":day:" + now.toISOString().slice(0, 10);
  const result = await evalScript(ALPHA_BUDGET_LUA, [minuteKey, dayKey], ["10", String(maxDaily)]);
  if (result === 0) return "allowed";
  if (result === 1) return "user_rate_limited";
  if (result === 2) return "daily_limit_reached";
  throw new Error("ALPHA_BUDGET_UNAVAILABLE");
}


// A second Redis atomic gate reserves a conservative synthetic USD-micro estimate.
// This is NOT provider-side billing enforcement; operator-approved hard provider limits
// and validated price snapshots are mandatory before authorizing a real upstream call.
export const ESTIMATED_SPEND_LUA = [
  "local amount=tonumber(ARGV[1])",
  "local cap=tonumber(ARGV[2])",
  "local spent=tonumber(redis.call('GET', KEYS[1]) or '0')",
  "if amount > cap or spent > cap - amount then return 1 end",
  "local next=redis.call('INCRBY', KEYS[1], amount)",
  "if spent == 0 then redis.call('EXPIRE', KEYS[1], 90000) end",
  "return 0",
].join("\n");

export type EstimateBudgetDecision = "reserved_estimate" | "daily_estimate_limit";
export async function reserveEstimatedDailyBudget(
  namespace: string,
  dailyCap: string | undefined,
  estimateMicroUsd: number,
  evalScript: (script: string, keys: string[], args: string[]) => Promise<unknown>,
  now: Date = new Date(),
): Promise<EstimateBudgetDecision> {
  const limit = Number(dailyCap);
  if (!/^[a-z][a-z0-9:-]{3,48}$/.test(namespace) || !dailyCap ||
      !/^[1-9][0-9]*$/.test(dailyCap) || !Number.isSafeInteger(limit) || limit > 1_000_000_000 ||
      !Number.isSafeInteger(estimateMicroUsd) || estimateMicroUsd < 0 ||
      !Number.isFinite(now.getTime())) throw new Error("ESTIMATED_SPEND_LIMIT_NOT_CONFIGURED");
  const key = namespace + ":estimated-micro-usd:" + now.toISOString().slice(0, 10);
  const result = await evalScript(ESTIMATED_SPEND_LUA, [key], [String(estimateMicroUsd), String(limit)]);
  if (result === 0) return "reserved_estimate";
  if (result === 1) return "daily_estimate_limit";
  throw new Error("ESTIMATED_SPEND_LIMIT_UNAVAILABLE");
}
