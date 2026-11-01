import test from "node:test";
import assert from "node:assert/strict";
import { ChatSseParser } from "../lib/client-sse.ts";

test("browser SSE handles Unicode split mid-byte, CRLF split and complete event", () => {
  const encoded = new TextEncoder().encode(
    'event: delta\r\ndata: {"text":"한글🌱"}\r\n\r\nevent: done\n' +
    'data: {}\n\n',
  );
  const parser = new ChatSseParser();
  const received = [];
  for (const byte of encoded) received.push(...parser.push(Uint8Array.of(byte)));
  assert.deepEqual(received, [{ kind: "delta", text: "한글🌱" }, { kind: "done" }]);
  assert.doesNotThrow(() => parser.finish());
});

test("browser SSE accepts multiline JSON data, ignores unknown events and signals upstream errors", () => {
  const parser = new ChatSseParser();
  const events = parser.push(new TextEncoder().encode(
    'event: keepalive\ndata: {}\n\n' +
    'event: delta\ndata: {"text":\ndata: "hello"}\n\n' +
    'event: error\ndata: {"code":"PROVIDER_FAILED"}\n\n',
  ));
  assert.deepEqual(events, [{ kind: "delta", text: "hello" }, { kind: "error", code: "PROVIDER_FAILED" }]);
  assert.throws(() => parser.finish(), /CHAT_INTERRUPTED/);
});

test("browser SSE detects truncated frames and maliciously oversized events", () => {
  const parser = new ChatSseParser();
  parser.push(new TextEncoder().encode('event: delta\ndata: {"text":"partial"'));
  assert.throws(() => parser.finish(), /CHAT_INTERRUPTED/);
  assert.throws(() => new ChatSseParser().push(new TextEncoder().encode("x".repeat(65537))), /CHAT_SSE_FRAME_TOO_LARGE/);
  const huge = new TextEncoder().encode('event: delta\ndata: {"text":"' + "x".repeat(120000) + '"}\n\n');
  const response = new ChatSseParser();
  // Each frame is bounded to 64K in normal operation; reject before accumulating huge text.
  assert.throws(() => response.push(huge), /CHAT_RESPONSE_TOO_LARGE|CHAT_SSE_FRAME_TOO_LARGE/);
});

test("browser SSE discards trailing events once done received", () => {
  const parser = new ChatSseParser();
  const result = parser.push(new TextEncoder().encode(
    'event: done\ndata: {}\n\nevent: delta\ndata: {"text":"untrusted"}\n\n',
  ));
  assert.deepEqual(result, [{ kind: "done" }]);
  assert.deepEqual(parser.push(new Uint8Array()), []);
});
