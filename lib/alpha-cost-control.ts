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
  if (allow.size === 0 || models.length !== new Set(requestedIds).size) return false;
  const ids = new Set(requestedIds);
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
): Promise<AlphaBudgetResult> {
  const maxDaily = Number(dailyCap);
  if (!UUID.test(userId) || !dailyCap || !/^[1-9][0-9]*$/.test(dailyCap) ||
      !Number.isSafeInteger(maxDaily) || maxDaily > 1000 ||
      !Number.isFinite(now.getTime())) {
    throw new Error("ALPHA_BUDGET_NOT_CONFIGURED");
  }
  const minuteKey = "monstera:alpha:minute:" + userId + ":" + Math.floor(now.getTime() / 60000);
  const dayKey = "monstera:alpha:day:" + now.toISOString().slice(0, 10);
  const result = await evalScript(ALPHA_BUDGET_LUA, [minuteKey, dayKey], ["10", String(maxDaily)]);
  if (result === 0) return "allowed";
  if (result === 1) return "user_rate_limited";
  if (result === 2) return "daily_limit_reached";
  throw new Error("ALPHA_BUDGET_UNAVAILABLE");
}
