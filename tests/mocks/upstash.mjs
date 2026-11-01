// Mock of the Upstash Redis interface for Node E2E route tests only.
const state = { counts: new Map(), failure: false };
export function resetTestRedis() { state.counts.clear(); state.failure = false; }
export function failTestRedis(value = true) { state.failure = value; }
export class Redis {
  constructor() {}
  async eval(script, keys, args) {
    if (state.failure) throw new Error("OFFLINE_REDIS_MOCK");
    if (!script.includes("INCR") || keys.length !== 2 || args.length !== 2) {
      throw new Error("UNEXPECTED_REDIS_MOCK_SCRIPT");
    }
    const [minute, daily] = keys.map(key => state.counts.get(key) ?? 0);
    const [maxMinute, maxDaily] = args.map(Number);
    if (daily >= maxDaily) return 2;
    if (minute >= maxMinute) return 1;
    state.counts.set(keys[0], minute + 1);
    state.counts.set(keys[1], daily + 1);
    return 0;
  }
}
