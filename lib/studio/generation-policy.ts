import { getPool } from "@/db/pool";
import { DatabaseModelRegistry } from "@/lib/model-registry";
import { outputTokenLimit } from "@/lib/providers/limits";
import { tierRank, type Tier } from "@/lib/router";
import { StudioInputError } from "@/lib/studio/workflow";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MILLION = 1_000_000n;
const MAX_RESERVATION = 2_147_483_647n;
const PRICE_POLICY_ENV = "MONSTERA_STUDIO_TEXT_CREDIT_PRICES_JSON";
const PRICE_REVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INPUT_FRAMING_TOKEN_ALLOWANCE = 8192;

export type StudioGenerationModality = "text" | "image" | "video";
export interface GenerationPreflightInput {
  modality: StudioGenerationModality;
  modelId: string;
  prompt: string;
  maxTokens: number;
  consentExternal: true;
}
export interface StudioCreditPriceSnapshot {
  modelId: string;
  provider: string;
  upstreamId: string;
  inputCreditsPerMillionTokens: number;
  outputCreditsPerMillionTokens: number;
  reviewedAt: string;
}

export interface TextGenerationPreflight {
  status: "preflight_only";
  canGenerate: false;
  creditsReserved: 0;
  modelId: string;
  modality: "text";
  maxTokens: number;
  inputTokenCeiling: number;
  maximumReservedCredits: number;
  priceReviewedAt: string;
}

export function parseGenerationPreflight(input: unknown): GenerationPreflightInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new StudioInputError(400, "생성 요청 형식을 확인하세요.");
  }
  const body = input as Record<string, unknown>;
  if (body.modality !== "text" && body.modality !== "image" && body.modality !== "video") {
    throw new StudioInputError(400, "지원하지 않는 모달리티입니다.");
  }
  if (typeof body.modelId !== "string" || !UUID.test(body.modelId)) {
    throw new StudioInputError(400, "모델 식별자를 확인하세요.");
  }
  if (typeof body.prompt !== "string" || !body.prompt.trim() ||
    body.prompt.length > 8192 || Buffer.byteLength(body.prompt,"utf8") > 24000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body.prompt)) {
    throw new StudioInputError(400, "프롬프트 길이·내용을 확인하세요.");
  }
  if (!Number.isSafeInteger(body.maxTokens) || (body.maxTokens as number) < 1 ||
    (body.maxTokens as number) > 8192) {
    throw new StudioInputError(400, "출력 토큰 한도를 확인하세요.");
  }
  if (body.consentExternal !== true) {
    throw new StudioInputError(400, "외부 공급자 전달에 대한 명시적 동의가 필요합니다.");
  }
  return {
    modality: body.modality,
    modelId: body.modelId,
    prompt: body.prompt.trim(),
    maxTokens: body.maxTokens as number,
    consentExternal: true,
  };
}

export function enforceModalityTier(modality: StudioGenerationModality, tier: Tier): void {
  const required: Tier = modality === "text" ? "free" : modality === "image" ? "creator" : "studio";
  if (tierRank[tier] < tierRank[required]) throw new StudioInputError(403, "이 기능에 접근할 수 없습니다.");
}

function validPositiveRate(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value > 0 && value <= 1_000_000_000;
}
function ceilDivide(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor;
}

export function matchStudioCreditPrice(
  raw: string | undefined, model: { id: string; provider: string; upstreamId: string },
  now = new Date(),
): StudioCreditPriceSnapshot {
  if (!raw || raw.length > 16_000 || !Number.isFinite(now.getTime())) {
    throw new Error("STUDIO_PRICE_POLICY_NOT_CONFIGURED");
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("STUDIO_PRICE_POLICY_NOT_CONFIGURED"); }
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("STUDIO_PRICE_POLICY_NOT_CONFIGURED");
  }
  const found = value.filter((item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item) &&
    (item as Record<string, unknown>).modelId === model.id);
  if (found.length !== 1) throw new Error("STUDIO_PRICE_MISSING_OR_DUPLICATE");
  const policy = found[0] as Record<string, unknown>;
  if (policy.provider !== model.provider || policy.upstreamId !== model.upstreamId ||
    !validPositiveRate(policy.inputCreditsPerMillionTokens) ||
    !validPositiveRate(policy.outputCreditsPerMillionTokens) ||
    typeof policy.reviewedAt !== "string") {
    throw new Error("STUDIO_PRICE_POLICY_INVALID");
  }
  const reviewed = Date.parse(policy.reviewedAt);
  if (!Number.isFinite(reviewed) || reviewed > now.getTime() ||
    now.getTime() - reviewed > PRICE_REVIEW_TTL_MS) {
    throw new Error("STUDIO_PRICE_REVIEW_REQUIRED");
  }
  return policy as unknown as StudioCreditPriceSnapshot;
}

export function computeStudioTextReservation(
  snapshot: StudioCreditPriceSnapshot, inputBytes: number, maxTokens: number,
): { inputTokenCeiling: number; maximumReservedCredits: number } {
  if (!Number.isSafeInteger(inputBytes) || inputBytes < 1 || inputBytes > 24_000 ||
    !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 16_384 ||
    !validPositiveRate(snapshot.inputCreditsPerMillionTokens) ||
    !validPositiveRate(snapshot.outputCreditsPerMillionTokens)) {
    throw new Error("STUDIO_RESERVATION_INVALID");
  }
  // Reserve one theoretical input token per UTF-8 byte plus a framing allowance.
  // This is an internal worst-case guard, not a provider bill or hard spending limit.
  const inputTokenCeiling = inputBytes + INPUT_FRAMING_TOKEN_ALLOWANCE;
  const input = ceilDivide(BigInt(inputTokenCeiling) *
    BigInt(snapshot.inputCreditsPerMillionTokens), MILLION);
  const output = ceilDivide(BigInt(maxTokens) *
    BigInt(snapshot.outputCreditsPerMillionTokens), MILLION);
  const total = input + output;
  if (total < 1n || total > MAX_RESERVATION) throw new Error("STUDIO_RESERVATION_OUT_OF_RANGE");
  return { inputTokenCeiling, maximumReservedCredits: Number(total) };
}

/** Read-only preflight. Never insert a hold, dispatch a provider, or create a job. */
export async function evaluateStudioTextPreflight(
  userId: string, tier: Tier, input: GenerationPreflightInput,
  env: NodeJS.ProcessEnv = process.env, now = new Date(),
): Promise<TextGenerationPreflight> {
  enforceModalityTier(input.modality, tier);
  if (input.modality !== "text") throw new StudioInputError(501, "이 생성 기능은 준비 중입니다.");

  const model = await new DatabaseModelRegistry().findEnabled(input.modelId);
  if (!model) throw new StudioInputError(404, "활성 모델을 찾을 수 없습니다.");
  if (tierRank[tier] < tierRank[model.tierMin]) throw new StudioInputError(403, "모델 이용 등급이 부족합니다.");
  if (model.provider !== "openai") throw new StudioInputError(501, "이 공급자는 Studio에서 아직 지원하지 않습니다.");

  const policy = matchStudioCreditPrice(env[PRICE_POLICY_ENV], model, now);
  let maxTokens: number;
  try { maxTokens = outputTokenLimit(input.maxTokens, env); }
  catch(error) {
    if (error instanceof Error && error.message === "INVALID_OUTPUT_TOKEN_LIMIT") {
      throw new StudioInputError(400,"출력 토큰 한도가 서버 정책을 초과합니다.");
    }
    throw error;
  }

  const reservation = computeStudioTextReservation(
    policy, Buffer.byteLength(input.prompt,"utf8"), maxTokens,
  );
  const context = await getPool().query<{ctx: number}>(
    "SELECT ctx FROM model_registry WHERE id = $1 AND enabled = true LIMIT 1",
    [model.id],
  );
  const ctx = context.rows[0]?.ctx;
  if (typeof ctx !== "number" || !Number.isSafeInteger(ctx) ||
    ctx < reservation.inputTokenCeiling + maxTokens) {
    throw new Error("STUDIO_MODEL_CONTEXT_UNVERIFIED");
  }

  const wallet = await getPool().query<{balance: number; reserved: number}>(
    "SELECT balance, reserved FROM credits WHERE user_id = $1 LIMIT 1",
    [userId],
  );
  const balance = wallet.rows[0];
  if (!balance || !Number.isSafeInteger(balance.balance) ||
    !Number.isSafeInteger(balance.reserved)) {
    throw new StudioInputError(402,"크레딧 잔액이 없습니다.");
  }
  if (balance.balance - balance.reserved < reservation.maximumReservedCredits) {
    throw new StudioInputError(402,"사용 가능한 크레딧이 부족합니다.");
  }
  return {
    status: "preflight_only",
    canGenerate: false,
    creditsReserved: 0,
    modelId: model.id,
    modality: "text",
    maxTokens,
    inputTokenCeiling: reservation.inputTokenCeiling,
    maximumReservedCredits: reservation.maximumReservedCredits,
    priceReviewedAt: policy.reviewedAt,
  };
}
