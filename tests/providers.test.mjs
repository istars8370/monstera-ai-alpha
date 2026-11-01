import test from "node:test";
import assert from "node:assert/strict";
import { OpenRouterAdapter } from "../lib/providers/openrouter.ts";

test("OpenRouter request has bounded output and server-only credentials", async () => {
  let captured;
  const fetcher = async (url, options) => {
    captured = { url, ...options };
    return new Response("data: [DONE]\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
  const adapter = new OpenRouterAdapter("test-server-only-api-key", fetcher);
  const chunks = [];
  for await (const chunk of adapter.chatStream({ model: "unit/test", messages: [{ role: "user", content: "hello" }] })) chunks.push(chunk);
  assert.deepEqual(chunks, [{ type: "done" }]);
  assert.equal(captured.url, "https://openrouter.ai/api/v1/chat/completions");
  const request = JSON.parse(captured.body);
  assert.equal(request.model, "unit/test");
  assert.equal(request.max_tokens, 1024);
  assert.equal(request.stream, true);
  assert.equal(captured.headers.Authorization, "Bearer test-server-only-api-key");
  assert.equal(JSON.stringify(request).includes("test-server-only-api-key"), false);
});

test("OpenRouter upstream HTTP failure is rejected without fallback data", async () => {
  const adapter = new OpenRouterAdapter("local-test-key", async () => new Response("failed", { status: 502 }));
  await assert.rejects(async () => {
    for await (const _ of adapter.chatStream({ model: "unit/test", messages: [{ role: "user", content: "hello" }] })) void _;
  }, /UPSTREAM_HTTP_502/);
});
