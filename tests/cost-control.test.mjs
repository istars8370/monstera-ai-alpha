import test from "node:test";
import assert from "node:assert/strict";
import { approvedFreeModels, reserveAlphaRequest, reserveEstimatedDailyBudget, ALPHA_BUDGET_LUA, ESTIMATED_SPEND_LUA } from "../lib/alpha-cost-control.ts";

const alice = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bob = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const instant = new Date("2026-11-01T09:30:00.000Z");

test("provider allowlist must match exact enabled zero-priced upstream models", () => {
  const a = { id: alice, provider: "openrouter", upstream_id: "model/alpha", price_in: "0.0000000000", price_out: "0" };
  const b = { id: bob, provider: "deepinfra", upstream_id: "model/beta", price_in: "0", price_out: "0" };
  assert.equal(approvedFreeModels([a], [alice], undefined), false);
  assert.equal(approvedFreeModels([a], [alice], "openrouter:model/alpha"), true);
  assert.equal(approvedFreeModels([a], [alice, bob], "openrouter:model/alpha"), false);
  assert.equal(approvedFreeModels([a, b], [alice, bob], "openrouter:model/alpha"), false);
  assert.equal(approvedFreeModels([a, b], [alice, bob], "deepinfra:model/beta, openrouter:model/alpha"), true);
  assert.equal(approvedFreeModels([a, a], [alice, bob], "openrouter:model/alpha"), false);
  assert.equal(approvedFreeModels([{ ...a, price_out: "0.0000000001" }], [alice], "openrouter:model/alpha"), false);
  assert.equal(approvedFreeModels([{ ...a, price_in: "NaN" }], [alice], "openrouter:model/alpha"), false);
  assert.equal(approvedFreeModels([{ ...a, provider: "other" }], [alice], "openrouter:model/alpha"), false);
});

test("atomic alpha budget enforces per-user minute and global daily limits", async () => {
  const counters = new Map();
  let called = 0;
  const mockEval = async (script, keys, args) => {
    called++;
    assert.equal(script, ALPHA_BUDGET_LUA);
    const [minute, day] = keys.map(k => counters.get(k) ?? 0);
    const [minuteMax, dayMax] = args.map(Number);
    if (day >= dayMax) return 2;
    if (minute >= minuteMax) return 1;
    counters.set(keys[0], minute + 1);
    counters.set(keys[1], day + 1);
    return 0;
  };
  for (let i = 0; i < 10; i++) assert.equal(await reserveAlphaRequest(alice, "12", mockEval, instant), "allowed");
  assert.equal(await reserveAlphaRequest(alice, "12", mockEval, instant), "user_rate_limited");
  for (let i = 0; i < 2; i++) assert.equal(await reserveAlphaRequest(bob, "12", mockEval, instant), "allowed");
  assert.equal(await reserveAlphaRequest(bob, "12", mockEval, instant), "daily_limit_reached");
  assert.equal(called, 14);
});

test("alpha budget fails closed on invalid configuration or upstream error", async () => {
  const noCall = async () => { throw new Error("unreachable"); };
  await assert.rejects(reserveAlphaRequest(alice, undefined, noCall, instant), /ALPHA_BUDGET_NOT_CONFIGURED/);
  await assert.rejects(reserveAlphaRequest(alice, "0", noCall, instant), /ALPHA_BUDGET_NOT_CONFIGURED/);
  await assert.rejects(reserveAlphaRequest(alice, "1001", noCall, instant), /ALPHA_BUDGET_NOT_CONFIGURED/);
  await assert.rejects(reserveAlphaRequest("not-a-valid-uuid", "10", noCall, instant), /ALPHA_BUDGET_NOT_CONFIGURED/);
  await assert.rejects(reserveAlphaRequest(alice, "10", async () => "broken", instant), /ALPHA_BUDGET_UNAVAILABLE/);
  await assert.rejects(reserveAlphaRequest(alice, "10", async () => { throw new Error("redis offline"); }, instant), /redis offline/);
});


test("estimated spend Lua reserves synthetic micro-USD atomically and rejects daily overflow", async () => {
  const spentByKey = new Map();
  const evalMock = async (script, keys, args) => {
    assert.equal(script, ESTIMATED_SPEND_LUA);
    const current = spentByKey.get(keys[0]) ?? 0;
    const [amount, cap] = args.map(Number);
    if (amount > cap || current > cap - amount) return 1;
    spentByKey.set(keys[0], current + amount);
    return 0;
  };
  const ns = "monstera:staging-demo";
  assert.equal(await reserveEstimatedDailyBudget(ns, "100", 60, evalMock, instant), "reserved_estimate");
  assert.equal(await reserveEstimatedDailyBudget(ns, "100", 40, evalMock, instant), "reserved_estimate");
  assert.equal(await reserveEstimatedDailyBudget(ns, "100", 1, evalMock, instant), "daily_estimate_limit");
  assert.equal([...spentByKey.values()][0], 100);
  for (const [prefix, max, cost] of [
    ["", "100", 1], [ns, undefined, 1], [ns, "0", 1], [ns, "1000000001", 1],
    [ns, "100", -1], [ns, "100", NaN], [ns, "100", 0.5],
  ]) {
    await assert.rejects(reserveEstimatedDailyBudget(prefix, max, cost, evalMock, instant),
      /ESTIMATED_SPEND_LIMIT_NOT_CONFIGURED/);
  }
});
