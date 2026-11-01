import test from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { ALPHA_BUDGET_LUA } from "../lib/alpha-cost-control.ts";

const run = promisify(execFile);
async function evalRedis(minuteKey, dayKey, cap = "12") {
  const { stdout } = await run(
    "docker",
    ["run", "--rm", "--network", "host", "redis:7-alpine", "redis-cli", "-h", "127.0.0.1",
      "EVAL", ALPHA_BUDGET_LUA, "2", minuteKey, dayKey, "10", cap],
    { timeout: 30000 },
  );
  return Number(stdout.trim());
}
test("real isolated Redis executes atomic per-user and global budgets", async () => {
  const prefix = "monstera-ci:" + process.pid;
  const dayKey = prefix + ":2026-11-01";
  const a = await Promise.all(Array.from({ length: 15 }, () => evalRedis(prefix + ":alice:minute", dayKey)));
  assert.equal(a.filter(x => x === 0).length, 10);
  assert.equal(a.filter(x => x === 1).length, 5);
  const b = await Promise.all(Array.from({ length: 5 }, () => evalRedis(prefix + ":bob:minute", dayKey)));
  assert.equal(b.filter(x => x === 0).length, 2);
  assert.equal(b.filter(x => x === 2).length, 3);
});
