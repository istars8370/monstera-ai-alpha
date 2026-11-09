# MONSTERA Privacy Alpha — 2026-11-04

Status: Draft PR #10. No merge, deployment or live inference authorized.

## Implemented boundary

- Explicit `ALPHA_CHAT_PROVIDER=venice` or `openrouter` is required. Missing/unknown values return 503; no default vendor or automatic fallback.
- Venice uses a fixed HTTPS host, rejects redirects, disables its built-in system prompt and web/X search, scraping and citations, and sends `store:false` for compatibility. Venice accepts `store` for OpenAI compatibility but does not use it. Sending `store:false` does not enforce or verify non-retention.
- Each completion rechecks the exact model ID against Venice's text catalog. Only `model_spec.privacy === "private"` and non-offline entries qualify. Unknown metadata, TEE/E2EE/anonymous tiers, lookup failure and model suffixes absent from the catalog fail closed. This is provider metadata validation, not an audit of actual retention.
- `/api/models` exposes only the operator's allowlist; Basic authentication protects both model and chat routes. Credentials are server environment variables and are never returned.
- `ALPHA_APP_ORIGIN` pins the allowed browser origin (the loopback demo uses `http://127.0.0.1:3000`). This avoids Next host normalization rejecting legitimate requests, without trusting arbitrary Host/forwarded headers. Missing configuration falls back to the request URL origin; malformed origin settings fail closed.
- Chat request cap is 24,000 actual UTF-8 bytes, at most 20 messages of 4,000 characters. Extra message properties are dropped. Only user/assistant text is accepted.
- UI shows the active provider and model, and discloses the recent-message window. Older history is omitted from requests to fit the byte limit; long assistant messages contribute their final 4,000 characters. This is context selection, not persistent storage or summarization.
- Responses are capped at 1,024 requested output tokens. A process-local guard allows at most two active streams and ten generation requests per minute. These are coarse single-process controls, not a dollar budget or distributed quota. Configure provider-side spend limits before live use.
- Completion timeout is 90 seconds; catalog timeout is 15 seconds. Cancellation reaches upstream fetch and releases readers; errors returned to the browser are fixed codes rather than provider bodies, keys or prompts.
- No application transcript DB or transcript logs. Success and error API responses use no-store. Build-time framework telemetry can be disabled with `NEXT_TELEMETRY_DISABLED=1`.

## Storage decision and PR #6 reuse assessment

PR #6 at `c8dd7a311407611e9c4dca0a3e8b9ee1bff951d3` was reviewed. It uses Argon2id (3 operations, 64 MiB), XChaCha20-Poly1305, IndexedDB v2, per-user AAD and passphrase locking. It is based on `integration/t1-t12`, with account identity/auth APIs absent from this main-based alpha. Sumo sodium dependency and a different lockfile are also required. Blindly copying it would not establish account isolation or safe legacy migration.

Therefore encrypted persistence is **NOT VERIFIED / not integrated** here. The legacy plaintext persistence UI and all automatic IndexedDB access are removed. The UI retains new chat history in browser memory without application-managed persistent storage; refresh clears the UI history. Submitted context is also processed by the MONSTERA server and selected provider. Existing IndexedDB databases are never automatically opened, read, overwritten, migrated or deleted. “현재 대화 비우기” clears memory only. Legacy records can still be present on the device; this is not secure erasure. Encryption, opt-in migration and account isolation remain a separate completion gate.

The existing `ChatSseParser` from the PR #6 branch is reused without importing its auth, storage or Studio code. Shared upstream parsing is fixed for split CRLF and pending-read cancellation.

## Privacy claims and remaining limits

Private is a provider contractual/policy tier. It is not E2EE, a verified TEE, client-only inference or proof of no retention. The MONSTERA server and selected provider process plaintext prompts. Hosting/proxy logs, browser memory, extensions, XSS, crash dumps and local operators remain trust boundaries. Do not use real customer/business personal data for QA. Basic auth is single-user access control, not multi-user account isolation; use loopback locally or HTTPS on an approved host.

No extra MONSTERA content classifier is added. Model/provider restrictions still apply. No policy-bypass guarantee is offered.

## Verification and exact-head gate

`pnpm test:privacy` runs offline TypeScript-compiled Node tests with injected fetch mocks. CI runs typecheck, lint, privacy tests and production build on the same checkout. It does not call the Venice API or provision secrets. Browser QA uses the explicit loopback Mock demo and fictional messages. CI installs Chromium and runs `pnpm test:browser` for model selection, streaming, network failure, cancel, clear, refresh, legacy-record preservation, web-storage inactivity, mobile overflow and log/key checks. This is automated QA, not independent human acceptance.

Encryption roundtrip/deletion, live model availability, real inference quality/latency/billing and independent human QA are not covered. CI success must be checked for the final commit SHA, not the prior `545c54d` or an unrelated merge commit. No merge/deployment until CEO approval.

Official API documentation reviewed on 2026-11-04:
- https://docs.venice.ai/api-reference/endpoint/models/list
- https://docs.venice.ai/api-reference/endpoint/chat/completions
- https://venice.ai/privacy
