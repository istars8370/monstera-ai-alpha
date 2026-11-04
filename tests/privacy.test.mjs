import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { VenicePrivateAdapter } = require("../.privacy-test-build/lib/providers/venice.js");
const { parseSse } = require("../.privacy-test-build/lib/providers/openrouter.js");
const { createChatHandlers } = require("../.privacy-test-build/lib/chat-handler.js");
const { chatConfig } = require("../.privacy-test-build/lib/chat-config.js");
const { chatPayload } = require("../.privacy-test-build/lib/chat-context.js");
const { ChatSseParser } = require("../.privacy-test-build/lib/client-sse.js");
const { middleware } = require("../.privacy-test-build/middleware.js");
const { NextRequest } = require("next/server");
const env = { ALPHA_CHAT_PROVIDER: "venice", VENICE_API_KEY: "secret-test-only", VENICE_PRIVATE_MODEL_IDS: "private-a,private-b" };
const item = (id, privacy = "private", type = "text", extra = {}) => ({ id, type, model_spec: { name: id, privacy, ...extra } });
const catalog = { data: [item("private-a"), item("private-b"), item("anon", "anonymized"), item("tee", "tee"), item("e2ee", "e2ee"), item("image", "private", "image"), item("offline", "private", "text", { offline: true }), item("missing", undefined)] };
// Set undefined explicitly: default arguments above otherwise select private.
catalog.data.at(-1).model_spec.privacy = undefined;
const textStream = 'data: {"choices":[{"delta":{"content":"안녕"}}]}\r\n\r\ndata: [DONE]\r\n\r\n';
function sse(text = textStream) { return new Response(text, { headers: { "content-type": "text/event-stream" } }); }
function mock(data = catalog, completion = () => sse()) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (options?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return url.endsWith("/models?type=text") ? Response.json(data) : completion(url, options);
  };
  return { calls, fetcher };
}
const collect = async source => { const output = []; for await (const chunk of source) output.push(chunk); return output; };
const request = (payload = { messages: [{ role: "user", content: "fictional" }] }, options = {}) => new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json", ...options.headers }, body: JSON.stringify(payload), ...options });

test("exact explicit provider required; no typo or missing-provider fallback", () => {
  for (const provider of [undefined, "", "Venice", "veniec"]) assert.equal(chatConfig({ ...env, ALPHA_CHAT_PROVIDER: provider }), null);
  assert.equal(chatConfig({ ...env, VENICE_API_KEY: "" }), null);
  assert.equal(chatConfig({ ...env, VENICE_PRIVATE_MODEL_IDS: "bad?web=on" }), null);
});
test("catalog returns only available exact Private text models", async () => {
  const { fetcher } = mock();
  assert.deepEqual((await new VenicePrivateAdapter("test", fetcher).listModels()).map(m => m.id), ["private-a", "private-b"]);
});
for (const model of ["anon", "tee", "e2ee", "image", "offline", "missing", "unknown", "private-a:web"]) {
  test(`reject ${model} before any completion call`, async () => {
    const { fetcher, calls } = mock();
    await assert.rejects(collect(new VenicePrivateAdapter("test", fetcher).chatStream({ model, messages: [] })), /VENICE_PRIVATE_MODEL_REQUIRED/);
    assert.equal(calls.length, 1);
  });
}
for (const malformed of [null, {}, { data: null }, { data: Array(1001).fill(null) }]) {
  test("malformed catalog fails closed", async () => {
    const { fetcher, calls } = mock(malformed);
    await assert.rejects(collect(new VenicePrivateAdapter("test", fetcher).chatStream({ model: "private-a", messages: [] })));
    assert.equal(calls.length, 1);
  });
}
test("Venice request pins privacy flags, fixed host, output bound and signal", async () => {
  const { fetcher, calls } = mock();
  const abort = new AbortController();
  const chunks = await collect(new VenicePrivateAdapter("test", fetcher).chatStream({ model: "private-a", messages: [{ role: "user", content: "fictional" }], signal: abort.signal, maxOutputTokens: 512 }));
  assert.equal(chunks[0].text, "안녕"); assert.equal(chunks.at(-1).type, "done");
  const call = calls[1], body = JSON.parse(call.options.body);
  assert.equal(call.url, "https://api.venice.ai/api/v1/chat/completions");
  assert.equal(call.options.redirect, "error"); assert.equal(call.options.cache, "no-store");
  assert.equal(call.options.signal, abort.signal);
  assert.equal(body.store, false); assert.equal(body.max_completion_tokens, 512);
  assert.deepEqual(body.venice_parameters, { include_venice_system_prompt: false, enable_web_search: "off", enable_web_scraping: false, enable_web_citations: false, enable_x_search: false });
  assert.equal(body.fallbacks, undefined); assert.equal(body.user, undefined);
});
test("lookup failure never falls back or leaks provider error", async () => {
  let count = 0;
  const handlers = createChatHandlers(async () => { count++; throw new Error(env.VENICE_API_KEY); }, env);
  const response = await handlers.POST(request());
  const body = await response.text();
  assert.match(body, /CHAT_FAILED/); assert.doesNotMatch(body, /secret-test-only/); assert.equal(count, 1);
});
test("missing configuration rejects without upstream request", async () => {
  let count = 0;
  const handlers = createChatHandlers(async () => { count++; throw new Error(); }, {});
  assert.equal((await handlers.POST(request())).status, 503);
  assert.equal((await handlers.GET()).status, 503); assert.equal(count, 0);
});
test("model selection returns configured list only and never API key", async () => {
  const { fetcher } = mock();
  const response = await createChatHandlers(fetcher, { ...env, VENICE_PRIVATE_MODEL_IDS: "private-b" }).GET();
  assert.match(response.headers.get("cache-control"), /no-store/);
  const body = await response.text(); assert.doesNotMatch(body, /secret-test-only/);
  assert.deepEqual(JSON.parse(body).models.map(m => m.id), ["private-b"]);
});
test("unknown selection, cross origin, invalid role and content type are rejected", async () => {
  const { fetcher, calls } = mock(); const handlers = createChatHandlers(fetcher, env);
  assert.equal((await handlers.POST(request({ model: "anon", messages: [{ role: "user", content: "x" }] }))).status, 400);
  assert.equal((await handlers.POST(request(undefined, { headers: { "content-type": "application/json", origin: "https://evil.test" } }))).status, 403);
  assert.equal((await handlers.POST(request({ messages: [{ role: "system", content: "x" }] }))).status, 400);
  assert.equal((await handlers.POST(request(undefined, { headers: { "content-type": "text/plain" } }))).status, 415);
  assert.equal(calls.length, 0);
});
test("body cap counts bytes without trusting Content-Length", async () => {
  const { fetcher, calls } = mock(); const handlers = createChatHandlers(fetcher, env);
  const payload = { messages: Array.from({ length: 3 }, () => ({ role: "user", content: "가".repeat(4000) })) };
  assert.equal((await handlers.POST(request(payload))).status, 413); assert.equal(calls.length, 0);
});
test("extra message fields never reach upstream; model and budget preserved", async () => {
  const { fetcher, calls } = mock(); const handlers = createChatHandlers(fetcher, env);
  const response = await handlers.POST(request({ model: "private-b", messages: [{ role: "user", content: "x", secret: "must-drop" }], venice_parameters: { enable_web_search: "on" } }));
  assert.match(await response.text(), /event: done/);
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.model, "private-b"); assert.equal(body.max_completion_tokens, 1024);
  assert.equal(body.messages[0].secret, undefined);
});
test("10 requests per minute process guard", async () => {
  const { fetcher } = mock(); const handlers = createChatHandlers(fetcher, env);
  for (let i = 0; i < 10; i++) { const response = await handlers.POST(request()); assert.equal(response.status, 200); await response.text(); }
  assert.equal((await handlers.POST(request())).status, 429);
});
test("upstream HTTP/stream failures are sanitized without done", async () => {
  for (const completion of [() => new Response(env.VENICE_API_KEY, { status: 500 }), () => sse('data: {"error":"secret-test-only"}\n\n'), () => sse('data: {"choices":[]}\n\n')]) {
    const { fetcher } = mock(catalog, completion);
    const body = await (await createChatHandlers(fetcher, env).POST(request())).text();
    assert.match(body, /CHAT_FAILED/); assert.doesNotMatch(body, /secret-test-only|event: done/);
  }
});
test("SSE decodes UTF8 and CRLF split at every byte boundary", async () => {
  const bytes = new TextEncoder().encode(textStream);
  const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }));
  const chunks = await collect(parseSse(response)); assert.equal(chunks[0].text, "안녕"); assert.equal(chunks.at(-1).type, "done");
});
test("SSE abort unblocks a pending read and cancels reader", async () => {
  let cancelled = false; const abort = new AbortController();
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const result = collect(parseSse(response, abort.signal));
  setTimeout(() => abort.abort(), 10);
  await assert.rejects(result, /UPSTREAM_ABORTED/); assert.equal(cancelled, true);
});
test("request abort propagated to provider and emits sanitized error", async () => {
  const abort = new AbortController(); let observed;
  const fetcher = async (url, options) => {
    observed = options.signal;
    return new Promise((resolve, reject) => { options.signal.addEventListener("abort", () => reject(new Error("secret-test-only")), { once: true }); });
  };
  const response = await createChatHandlers(fetcher, env).POST(request(undefined, { signal: abort.signal }));
  abort.abort(); assert.match(await response.text(), /CHAT_ABORTED/); assert.equal(observed.aborted, true);
});
test("browser SSE parser rejects truncation, supports byte splits and bounds", () => {
  const parser = new ChatSseParser(); const events = [];
  for (const byte of new TextEncoder().encode('event: delta\r\ndata: {"text":"안녕"}\r\n\r\nevent: done\r\ndata: {}\r\n\r\n')) events.push(...parser.push(new Uint8Array([byte])));
  parser.finish(); assert.equal(events[0].text, "안녕");
  assert.throws(() => new ChatSseParser().finish(), /CHAT_INTERRUPTED/);
  assert.throws(() => new ChatSseParser().push(new TextEncoder().encode("x".repeat(65537))), /TOO_LARGE/);
});
test("recent context fits UTF8 byte limit and selects most recent messages", () => {
  const history = Array.from({ length: 30 }, (_, i) => ({ role: "user", content: String(i) + "가".repeat(4000) }));
  const body = chatPayload(history, "private-a");
  assert.ok(new TextEncoder().encode(JSON.stringify(body)).length <= 24000);
  assert.ok(body.messages.length <= 20); assert.equal(body.messages.at(-1).content, history.at(-1).content.slice(-4000));
});
test("Basic authentication protects chat/model endpoints; health stays anonymous", () => {
  const previous = [process.env.ALPHA_BASIC_USER, process.env.ALPHA_BASIC_PASSWORD];
  process.env.ALPHA_BASIC_USER = "test"; process.env.ALPHA_BASIC_PASSWORD = "test-password";
  try {
    for (const path of ["/", "/api/chat", "/api/models"]) {
      assert.equal(middleware(new NextRequest("http://localhost" + path)).status, 401);
      assert.equal(middleware(new NextRequest("http://localhost" + path, { headers: { authorization: "Basic " + Buffer.from("test:test-password").toString("base64") } })).status, 200);
    }
    assert.equal(middleware(new NextRequest("http://localhost/api/health")).status, 200);
  } finally {
    for (const [name, value] of [["ALPHA_BASIC_USER", previous[0]], ["ALPHA_BASIC_PASSWORD", previous[1]]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
test("two active requests block a third; cancellation releases capacity", async () => {
  const signals = [];
  const fetcher = async (url, options) => {
    signals.push(options.signal);
    return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("ABORTED")), { once: true }));
  };
  const handlers = createChatHandlers(fetcher, env);
  const a = await handlers.POST(request()); const b = await handlers.POST(request());
  assert.equal((await handlers.POST(request())).status, 429);
  await a.body.cancel(); assert.equal(signals[0].aborted, true);
  const c = await handlers.POST(request()); assert.equal(c.status, 200);
  await b.body.cancel(); await c.body.cancel();
});
test("catalog privacy change between listing and sending blocks completion", async () => {
  let count = 0;
  const handlers = createChatHandlers(async () => { count++; return Response.json({ data: [item("private-a", count === 1 ? "private" : "anonymized")] }); }, env);
  assert.equal((await handlers.GET()).status, 200);
  assert.match(await (await handlers.POST(request())).text(), /CHAT_FAILED/);
  assert.equal(count, 2);
});
