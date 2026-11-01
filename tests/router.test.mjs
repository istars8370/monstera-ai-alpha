import test from "node:test";
import assert from "node:assert/strict";
import { ModelRouter, RouterError } from "../lib/router.ts";

const registry = {
  async findEnabled(id) {
    if (id === "primary") return { id, provider: "one", upstreamId: "first", tierMin: "free", enabled: true };
    if (id === "fallback") return { id, provider: "two", upstreamId: "second", tierMin: "creator", enabled: true };
    if (id === "paid") return { id, provider: "two", upstreamId: "premium", tierMin: "studio", enabled: true };
    return null;
  },
};
const messages = [{ role: "user", content: "hello" }];

test("routing: tier restriction comes from registry", async () => {
  const router = new ModelRouter(registry, {
    one: { async *chatStream() { yield { type: "done" }; } },
    two: { async *chatStream() { yield { type: "done" }; } },
  });
  await assert.rejects(async () => {
    for await (const _ of router.chatStream({ modelId: "paid", tier: "free", messages })) { void _; }
  }, error => error instanceof RouterError && error.code === "TIER_FORBIDDEN" && error.status === 403);
});

test("routing: fallback occurs only before the first chunk", async () => {
  const calls = [];
  const router = new ModelRouter(registry, {
    one: { async *chatStream() { calls.push("primary"); throw new Error("upstream down"); } },
    two: { async *chatStream() { calls.push("fallback"); yield { type: "delta", text: "backup" }; yield { type: "done" }; } },
  });
  const result = [];
  for await (const chunk of router.chatStream({ modelId: "primary", fallbackModelId: "fallback", tier: "creator", messages })) result.push(chunk);
  assert.deepEqual(calls, ["primary", "fallback"]);
  assert.deepEqual(result, [{ type: "delta", text: "backup" }, { type: "done" }]);
});

test("routing: never mix providers after a primary delta", async () => {
  let fallbackUsed = false;
  const router = new ModelRouter(registry, {
    one: { async *chatStream() { yield { type: "delta", text: "partial" }; throw new Error("lost upstream"); } },
    two: { async *chatStream() { fallbackUsed = true; yield { type: "done" }; } },
  });
  const chunks = [];
  await assert.rejects(async () => {
    for await (const chunk of router.chatStream({ modelId: "primary", fallbackModelId: "fallback", tier: "creator", messages })) chunks.push(chunk);
  }, error => error instanceof RouterError && error.code === "STREAM_INTERRUPTED");
  assert.deepEqual(chunks, [{ type: "delta", text: "partial" }]);
  assert.equal(fallbackUsed, false);
});

test("routing: initial provider timeout falls back without mixing content", async () => {
  const router = new ModelRouter(registry, {
    one: {
      async *chatStream({ signal }) {
        await new Promise((resolve, reject) => {
          if (signal.aborted) return reject(new Error("aborted"));
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
        yield { type: "done" };
      },
    },
    two: { async *chatStream() { yield { type: "delta", text: "recovered" }; yield { type: "done" }; } },
  }, 20);
  const chunks = [];
  for await (const chunk of router.chatStream({ modelId: "primary", fallbackModelId: "fallback", tier: "creator", messages })) chunks.push(chunk);
  assert.deepEqual(chunks, [{ type: "delta", text: "recovered" }, { type: "done" }]);
});

test("routing: caller cancellation does not try another provider", async () => {
  let fallbackInvoked = false;
  const abort = new AbortController();
  abort.abort();
  const router = new ModelRouter(registry, {
    one: { async *chatStream({ signal }) { if (signal.aborted) throw new Error("cancelled"); yield { type: "done" }; } },
    two: { async *chatStream() { fallbackInvoked = true; yield { type: "done" }; } },
  });
  await assert.rejects(async () => {
    for await (const _ of router.chatStream({
      modelId: "primary", fallbackModelId: "fallback", tier: "creator", messages, signal: abort.signal,
    })) void _;
  }, error => error instanceof RouterError && error.code === "STREAM_INTERRUPTED");
  assert.equal(fallbackInvoked, false);
});
