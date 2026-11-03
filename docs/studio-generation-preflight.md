# Studio generation preflight (offline, no provider call)

This PR adds `POST /api/studio/generation/preflight` as **validation only**. This endpoint does not reserve credits, insert a job, invoke OpenAI, bill a customer or generate a draft. The existing `/studio` demo and business records are unchanged.

## Request

```json
{
  "modality": "text",
  "modelId": "00000000-0000-4000-8000-000000000001",
  "prompt": "한국어 콘텐츠 브리프를 작성해 주세요.",
  "maxTokens": 128,
  "consentExternal": true
}
```

The example model ID is illustrative, not a seeded or enabled registry entry. The request must come from the authenticated same-origin browser with a valid session. Identity and tier are derived exclusively from the session and DB. The explicit consent flag is required even though this endpoint itself sends nothing upstream. A client-provided `userId`, `tier`, price, or reserved amount is never trusted.

## Server policy

Requires an enabled model in `model_registry`, a sufficiently large registered context window, the user's model tier, an OpenAI provider entry, a supported text modality and a recently reviewed **internal Studio credit** price policy.

The operator may provide `MONSTERA_STUDIO_TEXT_CREDIT_PRICES_JSON` as a **server environment setting**, containing a JSON array of entries in this form:

```json
[
  {
    "modelId": "00000000-0000-4000-8000-000000000001",
    "provider": "openai",
    "upstreamId": "operator-approved-model-id",
    "inputCreditsPerMillionTokens": 1000000,
    "outputCreditsPerMillionTokens": 2000000,
    "reviewedAt": "2026-11-03T00:00:00.000Z"
  }
]
```

**These are illustrative internal credit conversion values, not actual OpenAI prices.** Do not deploy them as a business tariff without a pricing and unit-economics review. A missing, duplicate, mismatched, stale (older than seven days), future-dated or malformed entry fails closed. The model's tier and upstream ID come from `model_registry`, never the request.

The maximum reservation is an integer, ceiling-rounded worst-case estimate:

```
ceil((UTF8 prompt bytes + 8192 framing allowance) * inputCreditsPerMillionTokens / 1e6)
+ ceil(maxOutputTokens * outputCreditsPerMillionTokens / 1e6)
```

All multiplication and division use `bigint`, and the result must fit the existing signed 32-bit ledger reservation. The internal estimate is **not a provider-side hard budget**; actual costs, retries and non-token fees may differ. Existing provider-side spending controls and approval are still required before any real call.

The read-only preflight checks current unreserved text balance but **does not guarantee** the same amount will remain available later; a real job must atomically re-check and hold credits.

## Responses

- 200: `status: "preflight_only"`, `canGenerate: false`, `creditsReserved: 0`, model ID and **estimated** maximum reservation.
- 400/413/415: malformed request, invalid consent or token cap, excessive byte size or unsupported content type.
- 401: missing session; 403: insufficient entitlement or cross-origin request.
- 402: not enough available text credits.
- 404: disabled or unknown registered model.
- 501: image/video generation or an unimplemented Studio provider.
- 503: unavailable DB or unverified/missing server-side price policy or model context.

## Remaining work

1. Decide a reviewed internal-credit policy, and separately verify actual provider billing/limits.
2. Build a durable worker that claims queued jobs, handles retries and crash recovery without double charging.
3. Convert a successful Studio preflight into an atomic hold + job only inside an explicitly gated, offline-testable generation execution path.
4. Compute actual token usage from trusted provider receipts, clamp safely to reservations, reconcile unmatched provider tasks and disallow client-supplied charges.
5. Verify reconciliation and ownership with isolated PostgreSQL concurrency tests, and explicitly approve live provider calls in a later change.

This endpoint is intended as a safe development milestone, not a feature launch.
