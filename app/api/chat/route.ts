import { NextRequest } from "next/server";
import { OpenRouterAdapter } from "@/lib/providers/openrouter";
import { VenicePrivateAdapter } from "@/lib/providers/venice";
import type { ChatMessage } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 알파에서는 과금과 서버 대화 저장을 사용하지 않는다.
export async function POST(request: NextRequest): Promise<Response> {
  const provider = process.env.ALPHA_CHAT_PROVIDER === "venice" ? "venice" : "openrouter";
  const key = provider === "venice" ? process.env.VENICE_API_KEY : process.env.OPENROUTER_API_KEY;
  const model = provider === "venice" ? process.env.VENICE_PRIVATE_MODEL_ID : process.env.ALPHA_MODEL_ID;
  if (!key || !model) return Response.json({ code: "NOT_CONFIGURED" }, { status: 503 });
  if (Number(request.headers.get("content-length") || 0) > 24000) return Response.json({ code: "TOO_LARGE" }, { status: 413 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ code: "FORBIDDEN" }, { status: 403 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return Response.json({ code: "INVALID_JSON" }, { status: 400 }); }
  if (!payload || typeof payload !== "object" || !("messages" in payload) || !Array.isArray(payload.messages)) return Response.json({ code: "INVALID_MESSAGES" }, { status: 400 });
  const messages: unknown[] = payload.messages;
  if (messages.length < 1 || messages.length > 20 || !messages.every(m => m && typeof m === "object" && "role" in m && (m.role === "user" || m.role === "assistant") && "content" in m && typeof m.content === "string" && m.content.length > 0 && m.content.length <= 4000)) return Response.json({ code: "INVALID_MESSAGES" }, { status: 400 });
  const typedMessages = messages as ChatMessage[];
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 90000);
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const adapter = provider === "venice" ? new VenicePrivateAdapter(key) : new OpenRouterAdapter(key);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (event: string, value: object) => {
        if (closed || abort.signal.aborted) return;
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)); } catch { closed = true; abort.abort(); }
      };
      try {
        for await (const chunk of adapter.chatStream({ model, messages: typedMessages, signal: abort.signal })) {
          if (abort.signal.aborted) break;
          if (chunk.type === "delta") write("delta", { text: chunk.text ?? "" });
          if (chunk.type === "done") write("done", {});
        }
        if (abort.signal.aborted && !closed) write("error", { code: "CHAT_FAILED" });
      } catch { write("error", { code: "CHAT_FAILED" }); }
      finally { clearTimeout(timeout); if (!closed) { closed = true; try { controller.close(); } catch { /* 취소된 스트림 */ } } }
    },
    cancel() { abort.abort(); clearTimeout(timeout); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}
