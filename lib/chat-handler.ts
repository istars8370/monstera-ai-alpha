import { OpenRouterAdapter } from "./providers/openrouter";
import { VenicePrivateAdapter } from "./providers/venice";
import { chatConfig } from "./chat-config";
import type { ChatMessage } from "./providers/types";

const HEADERS = { "Cache-Control": "no-store, no-transform", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const MAX_BYTES = 24000;
const MAX_OUTPUT_TOKENS = 1024;
const jsonError = (code: string, status: number) => Response.json({ code }, { status, headers: HEADERS });

async function boundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("INVALID_JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) throw new Error("TOO_LARGE");
      chunks.push(value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

// Process-local single-user guard, not a distributed billing quota.
export function createChatHandlers(fetcher: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env) {
  let active = 0;
  let windowStart = 0;
  let requests = 0;
  const adapterFor = (config: NonNullable<ReturnType<typeof chatConfig>>) => config.provider === "venice" ? new VenicePrivateAdapter(config.key, fetcher) : new OpenRouterAdapter(config.key, fetcher);

  async function GET(): Promise<Response> {
    const config = chatConfig(env);
    if (!config) return jsonError("NOT_CONFIGURED", 503);
    try {
      const models = config.provider === "venice"
        ? (await new VenicePrivateAdapter(config.key, fetcher).listModels()).filter(model => config.models.includes(model.id))
        : config.models.map(id => ({ id, name: id }));
      return Response.json({ provider: config.provider, privacy: config.provider === "venice" ? "private" : "provider-policy", models, maxOutputTokens: MAX_OUTPUT_TOKENS }, { headers: HEADERS });
    } catch { return jsonError("MODEL_LOOKUP_FAILED", 503); }
  }

  async function POST(request: Request): Promise<Response> {
    const config = chatConfig(env);
    if (!config) return jsonError("NOT_CONFIGURED", 503);
    const origin = request.headers.get("origin");
    if ((origin && origin !== (config.origin || new URL(request.url).origin)) || request.headers.get("sec-fetch-site") === "cross-site") return jsonError("FORBIDDEN", 403);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return jsonError("INVALID_CONTENT_TYPE", 415);
    if (Number(request.headers.get("content-length") || 0) > MAX_BYTES) return jsonError("TOO_LARGE", 413);
    let payload: unknown;
    try { payload = await boundedJson(request); }
    catch (error) { const large = error instanceof Error && error.message === "TOO_LARGE"; return jsonError(large ? "TOO_LARGE" : "INVALID_JSON", large ? 413 : 400); }
    if (!payload || typeof payload !== "object" || !("messages" in payload) || !Array.isArray(payload.messages)) return jsonError("INVALID_MESSAGES", 400);
    const messages: unknown[] = payload.messages;
    if (messages.length < 1 || messages.length > 20 || !messages.every(m => m && typeof m === "object" && "role" in m && (m.role === "user" || m.role === "assistant") && "content" in m && typeof m.content === "string" && m.content.length > 0 && m.content.length <= 4000)) return jsonError("INVALID_MESSAGES", 400);
    const requestedModel = "model" in payload ? payload.model : config.models[0];
    if (typeof requestedModel !== "string" || !config.models.includes(requestedModel)) return jsonError("INVALID_MODEL", 400);
    // Drop unexpected fields before transmission.
    const typedMessages = messages.map(m => ({ role: (m as ChatMessage).role, content: (m as ChatMessage).content }));
    const now = Date.now();
    if (now - windowStart >= 60000) { windowStart = now; requests = 0; }
    if (active >= 2 || requests >= 10) return jsonError("RATE_LIMITED", 429);
    active++; requests++;
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    request.signal.addEventListener("abort", onAbort, { once: true });
    if (request.signal.aborted) abort.abort();
    let released = false;
    const timeout = setTimeout(onAbort, 90000);
    const release = () => { if (released) return; released = true; active--; clearTimeout(timeout); request.signal.removeEventListener("abort", onAbort); };
    const encoder = new TextEncoder();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const write = (event: string, value: object) => {
          if (cancelled) return;
          try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)); }
          catch { cancelled = true; abort.abort(); }
        };
        try {
          for await (const chunk of adapterFor(config).chatStream({ model: requestedModel, messages: typedMessages, signal: abort.signal, maxOutputTokens: MAX_OUTPUT_TOKENS })) {
            if (abort.signal.aborted) throw new Error("ABORTED");
            if (chunk.type === "delta") write("delta", { text: chunk.text ?? "" });
            if (chunk.type === "done") write("done", {});
          }
          if (abort.signal.aborted) throw new Error("ABORTED");
        } catch { write("error", { code: abort.signal.aborted ? "CHAT_ABORTED" : "CHAT_FAILED" }); }
        finally { release(); if (!cancelled) { try { controller.close(); } catch { /* consumer disconnected */ } } }
      },
      cancel() { cancelled = true; abort.abort(); release(); },
    });
    return new Response(stream, { headers: { ...HEADERS, "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" } });
  }
  return { GET, POST };
}
export const chatHandlers = createChatHandlers();
