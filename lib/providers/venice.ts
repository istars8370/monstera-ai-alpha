import { parseSse } from "./openrouter";
import type { ChatRequest, Chunk, HealthStatus, ModelInfo, ProviderAdapter } from "./types";

// Single fixed upstream endpoint. Never forward a client-supplied URL or API key.
// Venice describes Private as contract-based prompt/output non-retention.
// This adapter validates catalog metadata only; it does not verify retention or implement E2EE.
const BASE_URL = "https://api.venice.ai/api/v1";

type PrivateModel = ModelInfo & { privacy: "private" };

function parsePrivateTextModels(payload: unknown): PrivateModel[] {
  if (!payload || typeof payload !== "object" || !("data" in payload)) {
    throw new Error("VENICE_MODEL_CATALOG_INVALID");
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length > 1000) {
    throw new Error("VENICE_MODEL_CATALOG_INVALID");
  }
  const models: PrivateModel[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const model = item as {
      id?: unknown;
      type?: unknown;
      model_spec?: { name?: unknown; privacy?: unknown; offline?: unknown };
    };
    if (model.type !== "text" || model.model_spec?.privacy !== "private") continue;
    if (model.model_spec.offline === true) continue;
    if (typeof model.id !== "string" || !model.id || model.id.length > 150) continue;
    const name = typeof model.model_spec.name === "string" && model.model_spec.name
      ? model.model_spec.name.slice(0, 160) : model.id;
    models.push({ id: model.id, name, privacy: "private" });
  }
  return models;
}

export class VenicePrivateAdapter implements ProviderAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async privateModels(signal?: AbortSignal): Promise<PrivateModel[]> {
    signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
    const response = await this.fetcher(BASE_URL + "/models?type=text", {
      method: "GET",
      headers: { Authorization: "Bearer " + this.apiKey },
      cache: "no-store",
      redirect: "error",
      signal,
    });
    if (!response.ok) throw new Error("VENICE_MODEL_LOOKUP_FAILED");
    return parsePrivateTextModels(await response.json());
  }

  async *chatStream(req: ChatRequest): AsyncIterable<Chunk> {
    // Fail closed if the exact selected model is not classified 'private'.
    // Unknown, anonymized, TEE and E2EE models require separately reviewed flows.
    const models = await this.privateModels(req.signal);
    if (!models.some((model) => model.id === req.model)) {
      throw new Error("VENICE_PRIVATE_MODEL_REQUIRED");
    }

    const response = await this.fetcher(BASE_URL + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: true,
        // Venice accepts store for OpenAI compatibility but does not use it.
        // Sending store:false does not enforce or verify non-retention.
        store: false,
        max_completion_tokens: req.maxOutputTokens ?? 1024,
        stream_options: { include_usage: true },
        venice_parameters: {
          include_venice_system_prompt: false,
          enable_web_search: "off",
          enable_web_scraping: false,
          enable_web_citations: false,
          enable_x_search: false,
        },
      }),
      cache: "no-store",
      redirect: "error",
      signal: req.signal,
    });
    yield* parseSse(response, req.signal);
  }

  async listModels(): Promise<readonly ModelInfo[]> {
    return this.privateModels();
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.privateModels();
      return { healthy: true, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }
}

