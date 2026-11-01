import test from "node:test";
import assert from "node:assert/strict";
import { parseSse } from "../lib/providers/openrouter.ts";

test("SSE parser handles CRLF split between network chunks", async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"content":"hello"}}]}\r',
    '\n\r',
    '\ndata: [DONE]\r',
    '\n\r',
    '\n',
  ];
  const stream = new ReadableStream({
    start(controller) {
      for (const text of chunks) controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  const result = [];
  for await (const event of parseSse(new Response(stream))) result.push(event);
  assert.deepEqual(result, [{ type: "delta", text: "hello" }, { type: "done" }]);
});


test("provider rejects oversized complete SSE frames before parsing JSON", async () => {
  const large = 'data: {"choices":[{"delta":{"content":"' +
    "x".repeat(140000) + '"}}]}\n\n' + 'data: [DONE]\n\n';
  await assert.rejects(async () => {
    for await (const event of parseSse(new Response(large))) void event;
  }, /UPSTREAM_EVENT_TOO_LARGE/);
});
