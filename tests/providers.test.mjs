import test from "node:test";
import assert from "node:assert/strict";
import { OpenRouterAdapter } from "../lib/providers/openrouter.ts";
import { DeepInfraAdapter } from "../lib/providers/deepinfra.ts";

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


test("DeepInfra adapter streams generated deltas and usage from mocked HTTP", async () => {
  let call;
  const adapter = new DeepInfraAdapter("offline-test-key", async (url, options) => {
    call = { url, ...options };
    return new Response([
      'data: {"choices":[{"delta":{"content":"hello"}}]}\r\n\r\n',
      'data: {"usage":{"prompt_tokens":3,"completion_tokens":1}}\r\n\r\n',
      'data: [DONE]\r\n\r\n',
    ].join(""), { status: 200 });
  });
  const events = [];
  for await (const event of adapter.chatStream({ model: "offline/deepinfra", messages: [{ role: "user", content: "ping" }] })) events.push(event);
  assert.equal(call.url, "https://api.deepinfra.com/v1/openai/chat/completions");
  assert.equal(JSON.parse(call.body).max_tokens, 1024);
  assert.deepEqual(events, [
    { type: "delta", text: "hello" },
    { type: "usage", usage: { inputTokens: 3, outputTokens: 1 } },
    { type: "done" },
  ]);
});

test("SSE failure/truncation from DeepInfra fails closed", async () => {
  const create = text => new DeepInfraAdapter("local", async () => new Response(text, { status: 200 }));
  for (const [response, message] of [
    ['data: {"error":{"message":"failed"}}\n\n', /UPSTREAM_STREAM_ERROR/],
    ['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', /UPSTREAM_TRUNCATED_SSE/],
    ['data: invalid-json\n\n', /UPSTREAM_INVALID_SSE_JSON/],
  ]) {
    await assert.rejects(async () => {
      for await (const event of create(response).chatStream({ model: "mock", messages: [{ role: "user", content: "ping" }] })) {
        void event;
      }
    }, message);
  }
});
