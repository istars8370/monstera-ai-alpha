import { NextRequest } from "next/server";
import { trustedOrigin } from "@/lib/request-origin";
import { Redis } from "@upstash/redis";
import { approvedFreeModels, reserveAlphaRequest, reserveEstimatedDailyBudget, type FreeModelRecord } from "@/lib/alpha-cost-control";
import { matchingReviewedProviderPrices, estimateRouteMaximumCost } from "@/lib/provider-cost-policy";
import { holdCredits, settleCredits } from "@/lib/billing";
import { authenticatedUser } from "@/lib/auth";
import { getPool } from "@/db/pool";
import { DatabaseModelRegistry } from "@/lib/model-registry";
import { ModelRouter, RouterError } from "@/lib/router";
import { OpenRouterAdapter } from "@/lib/providers/openrouter";
import { DeepInfraAdapter } from "@/lib/providers/deepinfra";
import type { ChatMessage, ProviderAdapter } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class BadRequest extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

async function limitedJson(request: NextRequest): Promise<unknown> {
  if (!request.body) throw new BadRequest("INVALID_JSON", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > 24000) {
        await reader.cancel();
        throw new BadRequest("TOO_LARGE", 413);
      }
      chunks.push(result.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
    catch { throw new BadRequest("INVALID_JSON", 400); }
  } finally { reader.releaseLock(); }
}
interface ParsedChat { modelId: string; fallbackModelId?: string; messages: ChatMessage[]; }
function parseRequest(payload: unknown): ParsedChat {
  if (!payload || typeof payload !== "object") throw new BadRequest("INVALID_MESSAGES", 400);
  const body = payload as Record<string, unknown>;
  if (typeof body.modelId !== "string" || !UUID.test(body.modelId)) throw new BadRequest("INVALID_MODEL", 400);
  if (body.fallbackModelId !== undefined &&
      (typeof body.fallbackModelId !== "string" || !UUID.test(body.fallbackModelId))) throw new BadRequest("INVALID_FALLBACK", 400);
  const entries = body.messages;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 20 || !entries.every((m: unknown) => {
    if (!m || typeof m !== "object") return false;
    const data = m as Record<string, unknown>;
    return (data.role === "user" || data.role === "assistant") &&
      typeof data.content === "string" && data.content.length > 0 && data.content.length <= 4000;
  })) throw new BadRequest("INVALID_MESSAGES", 400);
  return { modelId: body.modelId, fallbackModelId: body.fallbackModelId as string | undefined, messages: entries as ChatMessage[] };
}

async function reserveAlphaBudget(userId: string, selectedModels: FreeModelRecord[]) {
  // A manual acknowledgment is NOT proof of a provider hard spending limit.
  // Operators must separately configure AND verify it with their provider.
  if (process.env.MONSTERA_PROVIDER_SPENDING_LIMIT_CONFIRMED !== "true") {
    throw new Error("PROVIDER_SPENDING_LIMIT_UNVERIFIED");
  }
  const namespace = process.env.MONSTERA_REDIS_NAMESPACE;
  if (!namespace) throw new Error("REDIS_NAMESPACE_NOT_CONFIGURED");
  const snapshots = matchingReviewedProviderPrices(
    process.env.MONSTERA_ALPHA_PROVIDER_PRICES_JSON, selectedModels,
  );
  const exposure = estimateRouteMaximumCost(snapshots);
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("RATE_LIMIT_NOT_CONFIGURED");
  const redis = new Redis({ url, token });
  const evalScript = (script: string, keys: string[], args: string[]) => redis.eval(script, keys, args);
  // The count guard is conservative: a cost-blocked request also consumes a
  // rate-limit slot. The only purpose is to fail closed before upstream calls.
  const countDecision = await reserveAlphaRequest(
    userId, process.env.MONSTERA_ALPHA_DAILY_REQUEST_CAP,
    evalScript, new Date(), namespace,
  );
  if (countDecision !== "allowed") return countDecision;
  const spendDecision = await reserveEstimatedDailyBudget(
    namespace, process.env.MONSTERA_ALPHA_ESTIMATED_MICRO_USD_PER_DAY,
    exposure.estimatedMaximumMicroUsd, evalScript,
  );
  return spendDecision === "daily_estimate_limit" ? "estimated_budget_exceeded" : "allowed";
}

// Every selected primary/fallback model must have a reviewed allowlist entry.
// The internal zero price permits alpha routing but proves nothing about actual upstream charges.
async function approvedModelRows(ids: string[]): Promise<FreeModelRecord[] | null> {
  const rows = await getPool().query<FreeModelRecord>(
    "SELECT id, provider, upstream_id, price_in, price_out FROM model_registry " +
    "WHERE enabled = true AND id = ANY($1::uuid[])",
    [ids],
  );
  return approvedFreeModels(rows.rows, ids, process.env.MONSTERA_ALPHA_APPROVED_MODELS)
    ? rows.rows : null;
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!trustedOrigin(request, true)) return Response.json({ code: "FORBIDDEN" }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 24000) return Response.json({ code: "TOO_LARGE" }, { status: 413 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ code: "INVALID_CONTENT_TYPE" }, { status: 415 });

  let user;
  try { user = await authenticatedUser(request); }
  catch { return Response.json({ code: "AUTH_UNAVAILABLE" }, { status: 503 }); }
  if (!user) return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  // Detect stale tabs after another Google account signs in; this header never grants access.
  const expectedUserId = request.headers.get("x-monstera-expected-user");
  if (expectedUserId && expectedUserId !== user.id) {
    return Response.json({ code: "SESSION_CHANGED" }, { status: 409 });
  }

  let parsed: ParsedChat;
  try { parsed = parseRequest(await limitedJson(request)); }
  catch (error) {
    const bad = error instanceof BadRequest ? error : new BadRequest("INVALID_JSON", 400);
    return Response.json({ code: bad.code }, { status: bad.status });
  }
  if (process.env.MONSTERA_FREE_CHAT_ENABLED !== "true") {
    return Response.json({ code: "BILLING_POLICY_NOT_CONFIGURED" }, { status: 503 });
  }
  // 서버에서 활성화된 격리 테스트에만 원장 연결을 허용한다. 운영 과금은 비활성화한다.
  const billingRequested = process.env.MONSTERA_INTERNAL_CREDIT_TEST_MODE === "true";
  if (billingRequested && process.env.NODE_ENV === "production") {
    return Response.json({ code: "CREDIT_BILLING_NOT_APPROVED" }, { status: 503 });
  }
  const requestId = request.headers.get("x-monstera-request-id");
  if (!requestId || !UUID.test(requestId)) {
    return Response.json({ code: "INVALID_REQUEST_ID" }, { status: 400 });
  }
  const adapters: Record<string, ProviderAdapter> = {};
  if (process.env.OPENROUTER_API_KEY) adapters.openrouter = new OpenRouterAdapter(process.env.OPENROUTER_API_KEY);
  if (process.env.DEEPINFRA_API_KEY) adapters.deepinfra = new DeepInfraAdapter(process.env.DEEPINFRA_API_KEY);
  if (Object.keys(adapters).length === 0) return Response.json({ code: "PROVIDER_NOT_CONFIGURED" }, { status: 503 });

  const router = new ModelRouter(new DatabaseModelRegistry(), adapters);
  const requestedModels = [parsed.modelId, ...(parsed.fallbackModelId ? [parsed.fallbackModelId] : [])];
  try {
    await router.assertAccessible(requestedModels, user.tier);
  } catch (error) {
    if (error instanceof RouterError) return Response.json({ code: error.code }, { status: error.status });
    return Response.json({ code: "MODELS_UNAVAILABLE" }, { status: 503 });
  }
  let reservedAmount = 0;
  let outputMicroUsdPerMillion = 0;
  try {
    const models = await approvedModelRows(requestedModels);
    if (!models) return Response.json({ code: "MODEL_REQUIRES_BILLING" }, { status: 403 });
    const budget = await reserveAlphaBudget(user.id, models);
    if (budget === "user_rate_limited") return Response.json({ code: "RATE_LIMITED" }, { status: 429 });
    if (budget === "daily_limit_reached") return Response.json({ code: "DAILY_LIMIT_REACHED" }, { status: 429 });
    if (budget === "estimated_budget_exceeded") return Response.json({ code: "ESTIMATED_BUDGET_EXCEEDED" }, { status: 429 });
    if (billingRequested) {
      // 모의 지출 단위는 USD-micro이다. 실제 사용자 과금 단위로 전환하지 않는다.
      const ordered = requestedModels.map(id => models.find(model => model.id === id));
      if (ordered.some(model => !model)) throw new Error("INVALID_BILLING_MODEL");
      const snapshots = matchingReviewedProviderPrices(
        process.env.MONSTERA_ALPHA_PROVIDER_PRICES_JSON, ordered as FreeModelRecord[],
      );
      reservedAmount = estimateRouteMaximumCost(snapshots).estimatedMaximumMicroUsd;
      if (!Number.isSafeInteger(reservedAmount) || reservedAmount > 2147483647) {
        throw new Error("INVALID_HOLD");
      }
      // 라우터는 폴백된 모델 ID를 usage에 포함하지 않는다. 비용 과소평가 방지를
      // 위해 청구는 두 모델 중 큰 출력 단가를 사용한다(운영 과금 금지).
      outputMicroUsdPerMillion = Math.max(...snapshots.map(item => item.outputMicroUsdPerMillion));
      if (reservedAmount > 0) {
        const held = await holdCredits({
          userId: user.id, requestId, model: requestedModels.join("|"),
          reserved: reservedAmount, priceSnapshot: JSON.stringify(snapshots),
        });
        if (held.status === "insufficient") {
          return Response.json({ code: "INSUFFICIENT_CREDITS" }, { status: 402 });
        }
        if (held.status === "duplicate_held") {
          return Response.json({ code: "DUPLICATE_IN_FLIGHT" }, { status: 409 });
        }
        if (held.status === "settled") {
          return Response.json({ code: "ALREADY_SETTLED", charged: held.charged }, { status: 409 });
        }
        if (held.status === "reclaimed") {
          return Response.json({ code: "RESERVATION_RECLAIMED" }, { status: 409 });
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "IDEMPOTENCY_KEY_REUSED") {
      return Response.json({ code: "IDEMPOTENCY_KEY_REUSED" }, { status: 409 });
    }
    return Response.json({ code: "CHAT_UNAVAILABLE" }, { status: 503 });
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 90000);
  const onAbort = () => abort.abort();
  request.signal.addEventListener("abort", onAbort, { once: true });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let completed = false;
      let sentError = false;
      let outputChars = 0;
      let usageOutputTokens: number | null = null;
      const write = (kind: string, data: object) => {
        if (closed || abort.signal.aborted) return;
        try { controller.enqueue(encoder.encode("event: " + kind + "\ndata: " + JSON.stringify(data) + "\n\n")); }
        catch { closed = true; abort.abort(); }
      };
      try {
        for await (const chunk of router.chatStream({
          modelId: parsed.modelId,
          fallbackModelId: parsed.fallbackModelId,
          tier: user.tier,
          messages: parsed.messages,
          signal: abort.signal,
        })) {
          if (abort.signal.aborted) break;
          if (chunk.type === "usage") {
            const tokens = chunk.usage?.outputTokens;
            if (tokens !== undefined && Number.isSafeInteger(tokens) && tokens >= 0) {
              usageOutputTokens = tokens;
            }
          }
          if (chunk.type === "delta") {
            const text = chunk.text ?? "";
            outputChars += text.length;
            if (outputChars > 131072) {
              write("error", { code: "CHAT_RESPONSE_TOO_LARGE" });
              sentError = true;
              abort.abort();
              break;
            }
            write("delta", { text });
          }
          if (chunk.type === "done") { completed = true; break; }
        }
        if (!completed && !sentError && !abort.signal.aborted) {
          write("error", { code: "CHAT_INTERRUPTED" });
          sentError = true;
        }
      } catch {
        if (!sentError && !abort.signal.aborted) {
          write("error", { code: "CHAT_FAILED" });
          sentError = true;
        }
      } finally {
        if (billingRequested && reservedAmount > 0) {
          try {
            // 출력이 전혀 없다면 첫 청크 이전 취소와 동일하게 0으로 정산한다.
            // usage 부재 시 1문자=1토큰으로 보수적으로 추정하고 예약 상한으로 제한한다.
            const billedTokens = outputChars === 0 ? 0 : (usageOutputTokens ?? outputChars);
            const micros = (BigInt(billedTokens) * BigInt(outputMicroUsdPerMillion) + 999999n) / 1000000n;
            const charged = Number(micros > BigInt(reservedAmount) ? BigInt(reservedAmount) : micros);
            const settled = await settleCredits(user.id, requestId!, charged);
            if (settled.status !== "settled") {
              if (!sentError) write("error", { code: "SETTLEMENT_SKIPPED" });
              sentError = true;
            }
          } catch (error) {
            const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
              ? error.message : "SETTLEMENT_FAILED";
            console.error(code, requestId);
            if (!sentError) write("error", { code: "SETTLEMENT_FAILED" });
            sentError = true;
          }
        }
        if (completed && !sentError) write("done", {});
        clearTimeout(timer);
        request.signal.removeEventListener("abort", onAbort);
        if (!closed) { closed = true; try { controller.close(); } catch { /* 클라이언트 취소 */ } }
      }
    },
    cancel() { abort.abort(); clearTimeout(timer); request.signal.removeEventListener("abort", onAbort); },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
