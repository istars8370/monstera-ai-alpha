# MONSTERA AI — Private Alpha Integration

Next.js 15, TypeScript, Neon PostgreSQL/Drizzle, Upstash Redis, OpenRouter and DeepInfra.

**Status:** integration development; not deployed or production-approved. A successful source build does not prove live API connectivity.

## Verified development commands

    corepack enable
    corepack pnpm install --frozen-lockfile
    corepack pnpm typecheck
    corepack pnpm lint
    corepack pnpm test
    corepack pnpm build

GitHub Actions runs frozen install/typecheck/lint/test/build, real localhost HTTP smoke, Playwright Chromium UI journeys against mocked external responses, disposable PostgreSQL/Redis checks, and a pinned-container smoke test. These checks do NOT certify live Google, Neon, Upstash or paid AI provider calls.

## Browser verification and safety gates

- Browser suite: `pnpm exec playwright install --only-shell chromium` then start Next locally and run `pnpm exec playwright test --config=playwright.config.mjs`. CI runs the complete setup automatically.
- Offline integration setup check: `node scripts/preflight.mjs` prints statuses only; it does not reveal secrets or contact providers.
- Release readiness and blockers: [Current release gates](docs/RELEASE_GATES.md).
- Non-deployment operations checklist: [Staging and incident runbook](docs/RELEASE_GATES.md).

## Environment configuration

Copy .env.example to .env.local locally, and keep real values out of Git.

- ALPHA_BASIC_USER / ALPHA_BASIC_PASSWORD: temporary alpha access gate, **not user identity**.
- MONSTERA_PUBLIC_ORIGIN: HTTPS outside localhost.
- GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET: Google OAuth Web client. Register redirect URI as origin + /api/auth/google/callback.
- MONSTERA_SESSION_SECRET: at least 32 random UTF-8 bytes; HMAC-authenticated HttpOnly session cookies; session_epoch permits revocation.
- DATABASE_URL: correct Neon environment. Never use a production URL for local tests.
- OPENROUTER_API_KEY / DEEPINFRA_API_KEY: server-side provider keys.
- UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN: required for per-user rate limiting.
- MONSTERA_FREE_CHAT_ENABLED=true: explicit opt-in for enabled zero-price-model alpha chat only. Default disabled.
- MONSTERA_ALPHA_APPROVED_MODELS: comma-separated exact provider:model ID allowlist (e.g. openrouter:provider/model). Required even when DB price is zero.
- MONSTERA_ALPHA_DAILY_REQUEST_CAP: positive integer 1..1000. Per-user limit is 10/min; global daily cap is atomic in Redis. Both fail closed when unavailable. **Request counts are NOT a monetary budget.**

Even a zero-priced local model can incur upstream provider costs. Set operator-approved usage limits before enabling any real provider.

## Current product behavior

1. Basic Auth protects the private alpha entry point; it is not multi-user authentication.
2. Google OAuth uses HMAC-signed state, nonce, PKCE and RSA-signed ID token verification. Immutable Google subject (sub) identifies a user. Email-only legacy accounts or an email collision require a separate ownership-verified linking process; never auto-claim accounts by email. New users receive zero credits.
3. Session identity and tier are derived from the signed server cookie and database, never from user ID or tier fields supplied by the client. Logout advances session_epoch, invalidating old sessions. A stale tab presenting another account's expected user ID is rejected (409).
4. /api/models lists enabled models permitted by tier; /api/chat streams with OpenRouter and DeepInfra adapters.
5. The model router only falls back before the first streamed chunk. Unknown/forbidden models return 404/403 before streaming. Requests are size-limited, cancellable and rate-limited in explicitly enabled alpha mode; output max_tokens is bounded at 1024.
6. Conversation content is not intentionally persisted server-side. Browser chat content is stored in **plaintext IndexedDB**, keyed by authenticated user ID. It is not locally encrypted at rest.
7. Application tables: users, credits, usage_ledger, model_registry, sync_blobs. Sync blobs must contain ciphertext from client-side encryption only.

## Release blockers

- Validate the full Google login round-trip and nonproduction Neon user lookup with real credentials.
- Validate real provider responses, per-user rate limits, model access and cancellation.
- Approve credit units/prices, then integrate transactional hold/settlement into the API and verify actual usage/cancellation with isolated test accounts. Current SQL and billing helper tests are **not** an enabled or verified paid billing system; real paid charges remain disabled.
- Seed approved model registry entries; none are automatically enabled by default.
- Approve a provider-specific upstream spending budget. Even zero-price registry models can generate provider charges; a count limit is not a spending ceiling.
- Review provider data processing, local IndexedDB plaintext privacy, account isolation and operational monitoring.
- Request explicit approval for main merge, production DB changes, deployment, actual payments and public launch.

See db/migrations and tests for generated SQL and automated test cases. Release-gate decisions are maintained only in [docs/RELEASE_GATES.md](docs/RELEASE_GATES.md).

## Cost and staging safeguards (historical implementation)

- Cost estimates are USD-micro *predictions*, not verified provider charges. Reviewed upstream prices, a separate operator-confirmed provider hard budget, and Redis call/estimated-cost caps are now mandatory for alpha provider dispatch.
- Actual paid credit charging is still disabled. Billing replay mismatch fails closed.
- Local IndexedDB content is plaintext and visible to the browser profile. The UI offers an explicit confirmed purge of all device chat records.
- Staging preflight is offline only. See docs/RELEASE_GATES.md and docs/RELEASE_GATES.md.


## Current staging/release status

Current milestone: security and billing integrity fixes, disposable backup
restore verification, and nonproduction provider-budget decision checklist.
No live Google, Neon, Upstash or AI model usage; paid charging remains disabled.

- [Staging and financial policy decisions](docs/RELEASE_GATES.md)
- [Current release-gate assessment](docs/RELEASE_GATES.md)
- [Staging and incident runbook](docs/RELEASE_GATES.md)
