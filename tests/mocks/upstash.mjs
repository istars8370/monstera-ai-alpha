// Mock of the Upstash Redis interface for Node E2E route tests only.
const state = { counts: new Map(), usedNonces: new Set(), failure: false };
export function resetTestRedis() { state.counts.clear(); state.usedNonces.clear(); state.failure = false; }
export function failTestRedis(value = true) { state.failure = value; }
export class Redis {
  constructor() {}
  async eval(script, keys, args) {
    if (state.failure) throw new Error("OFFLINE_REDIS_MOCK");
    if (keys.length === 1 && args.length === 0 && script.includes("SETNX")) {
      if (state.usedNonces.has(keys[0])) return 0;
      state.usedNonces.add(keys[0]);
      return 1;
    }
    if (keys.length === 1 && args.length === 2 && script.includes("INCRBY")) {
      const amount = Number(args[0]), cap = Number(args[1]);
      const spent = state.counts.get(keys[0]) ?? 0;
      if (amount > cap || spent > cap - amount) return 1;
      state.counts.set(keys[0], spent + amount);
      return 0;
    }
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
