import { outputTokenLimit } from "@/lib/providers/limits";
import type { ChatRequest, Chunk, HealthStatus, ModelInfo, ProviderAdapter } from "./types";
import { parseSse } from "./openrouter";

// OpenAI SDK 없이 DeepInfra의 HTTP API를 직접 호출한다.
export class DeepInfraAdapter implements ProviderAdapter {
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}
  async *chatStream(req: ChatRequest): AsyncIterable<Chunk> {
    const response = await this.fetcher("https://api.deepinfra.com/v1/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: req.model, messages: req.messages, stream: true, max_tokens: outputTokenLimit(req.maxTokens), stream_options: { include_usage: true } }),
      signal: req.signal,
    });
    yield* parseSse(response, req.signal);
  }
  async listModels(): Promise<readonly ModelInfo[]> {
    const response = await this.fetcher("https://api.deepinfra.com/v1/openai/models", { headers: { Authorization: `Bearer ${this.apiKey}` } });
    if (!response.ok) throw new Error(`UPSTREAM_HTTP_${response.status}`);
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("data" in payload) || !Array.isArray(payload.data)) throw new Error("INVALID_MODEL_LIST");
    return payload.data.flatMap((item: unknown) => {
      if (!item || typeof item !== "object" || !("id" in item) || typeof item.id !== "string") return [];
      return [{ id: item.id, name: "name" in item && typeof item.name === "string" ? item.name : item.id }];
    });
  }
  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try { await this.listModels(); return { healthy: true, latencyMs: Date.now() - start }; }
    catch { return { healthy: false, latencyMs: Date.now() - start }; }
  }
}
