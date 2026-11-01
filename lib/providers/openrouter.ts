import type { ChatRequest, Chunk, HealthStatus, ModelInfo, ProviderAdapter } from "./types";

export async function* parseSse(response: Response, signal?: AbortSignal): AsyncIterable<Chunk> {
  if (!response.ok) throw new Error(`UPSTREAM_HTTP_${response.status}`);
  if (!response.body) throw new Error("UPSTREAM_NO_BODY");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ended = false;
  try {
    while (!ended) {
      if (signal?.aborted) throw new Error("UPSTREAM_ABORTED");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        if (boundary > 131072) throw new Error("UPSTREAM_EVENT_TOO_LARGE");
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = event.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        if (data.trim() === "[DONE]") { ended = true; break; }
        let parsed: unknown;
        try { parsed = JSON.parse(data); } catch { throw new Error("UPSTREAM_INVALID_SSE_JSON"); }
        const obj = parsed as { error?: unknown; choices?: Array<{ delta?: { content?: unknown } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        if (obj.error) throw new Error("UPSTREAM_STREAM_ERROR");
        for (const choice of obj.choices ?? []) {
          if (typeof choice.delta?.content === "string") yield { type: "delta", text: choice.delta.content };
        }
        if (obj.usage) yield { type: "usage", usage: { inputTokens: obj.usage.prompt_tokens ?? 0, outputTokens: obj.usage.completion_tokens ?? 0 } };
      }
      if (buffer.length > 131072) throw new Error("UPSTREAM_EVENT_TOO_LARGE");
    }
    if (!ended) throw new Error("UPSTREAM_TRUNCATED_SSE");
    yield { type: "done" };
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export class OpenRouterAdapter implements ProviderAdapter {
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}
  async *chatStream(req: ChatRequest): AsyncIterable<Chunk> {
    const response = await this.fetcher("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: req.model, messages: req.messages, stream: true, max_tokens: 1024, stream_options: { include_usage: true } }), signal: req.signal,
    });
    yield* parseSse(response, req.signal);
  }
  async listModels(): Promise<readonly ModelInfo[]> {
    const response = await this.fetcher("https://openrouter.ai/api/v1/models", { headers: { Authorization: `Bearer ${this.apiKey}` } });
    if (!response.ok) throw new Error(`UPSTREAM_HTTP_${response.status}`);
    const data = await response.json() as { data: Array<{ id: string; name?: string }> };
    return data.data.map(model => ({ id: model.id, name: model.name ?? model.id }));
  }
  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try { await this.listModels(); return { healthy: true, latencyMs: Date.now() - start }; }
    catch { return { healthy: false, latencyMs: Date.now() - start }; }
  }
}
