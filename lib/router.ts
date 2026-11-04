import type { ChatRequest, Chunk, ProviderAdapter } from "./providers/types";

export type Tier = "free" | "creator" | "studio";
export interface RegistryModel { id: string; provider: string; upstreamId: string; tierMin: Tier; enabled: boolean; }
export interface RegistryReader { findEnabled(id: string): Promise<RegistryModel | null>; }
export interface RouteRequest { modelId: string; fallbackModelId?: string; tier: Tier; messages: ChatRequest["messages"]; signal?: AbortSignal; maxTokens?: number; }
export class RouterError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); this.name = "RouterError"; }
}
export const tierRank: Readonly<Record<Tier, number>> = { free: 0, creator: 1, studio: 2 };

// A provider adapter must not be able to hang the request indefinitely by ignoring AbortSignal.
async function nextUntilAbort<T>(iterator: AsyncIterator<T>, signal: AbortSignal): Promise<IteratorResult<T>> {
  if (signal.aborted) throw new Error("UPSTREAM_ABORTED");
  return new Promise<IteratorResult<T>>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => { cleanup(); reject(new Error("UPSTREAM_ABORTED")); };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(() => iterator.next()).then(
      result => { cleanup(); resolve(result); },
      error => { cleanup(); reject(error); },
    );
  });
}

// 응답이 시작된 이후에는 다른 모델의 응답과 섞지 않는다.
export class ModelRouter {
  constructor(private readonly registry: RegistryReader, private readonly adapters: Readonly<Record<string, ProviderAdapter>>, private readonly timeoutMs = 8000) {}
  private async resolve(id: string, tier: Tier): Promise<RegistryModel> {
    const model = await this.registry.findEnabled(id);
    if (!model || !model.enabled) throw new RouterError("MODEL_NOT_FOUND", 404);
    if (tierRank[tier] < tierRank[model.tierMin]) throw new RouterError("TIER_FORBIDDEN", 403);
    if (!this.adapters[model.provider]) throw new RouterError("PROVIDER_UNAVAILABLE", 503);
    return model;
  }
  // Explicit preflight lets HTTP endpoints return 403/404 before opening SSE.
  async assertAccessible(modelIds: readonly string[], tier: Tier): Promise<void> {
    for (const id of new Set(modelIds)) await this.resolve(id, tier);
  }

  async *chatStream(req: RouteRequest): AsyncIterable<Chunk> {
    const primary = await this.resolve(req.modelId, req.tier);
    const fallback = req.fallbackModelId ? await this.resolve(req.fallbackModelId, req.tier) : undefined;
    const targets = fallback && fallback.id !== primary.id ? [primary, fallback] : [primary];
    for (let index = 0; index < targets.length; index++) {
      const model = targets[index];
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      req.signal?.addEventListener("abort", onAbort, { once: true });
      if (req.signal?.aborted) controller.abort();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const iterator = this.adapters[model.provider].chatStream({ model: model.upstreamId, messages: req.messages, signal: controller.signal, maxTokens: req.maxTokens })[Symbol.asyncIterator]();
      let committed = false;
      try {
        const first = await nextUntilAbort(iterator, controller.signal);
        clearTimeout(timer);
        if (first.done) throw new Error("EMPTY_STREAM");
        committed = true;
        yield first.value;
        while (true) {
          const next = await nextUntilAbort(iterator, controller.signal);
          if (next.done) return;
          yield next.value;
        }
      } catch {
        if (committed || req.signal?.aborted) throw new RouterError("STREAM_INTERRUPTED", 502);
        if (index === targets.length - 1) throw new RouterError("ALL_PROVIDERS_FAILED", 502);
      } finally {
        clearTimeout(timer);
        controller.abort();
        req.signal?.removeEventListener("abort", onAbort);
        // Never wait for a stalled adapter's return() after its signal has been aborted.
        try { void iterator.return?.().catch(() => undefined); } catch { /* disposal is best effort */ }
      }
    }
  }
}
