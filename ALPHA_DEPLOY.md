# MONSTERA AI — v1.8 Staging and Recovery Runbook

This is not deployment permission. Branch changes stay on integration/t1-t12.

## Offline checks (no live credentials required)

    corepack enable
    corepack pnpm install --frozen-lockfile
    corepack pnpm typecheck
    corepack pnpm lint
    corepack pnpm test
    corepack pnpm build
    node scripts/preflight.mjs

CI runs disposable PostgreSQL 16, Redis 7, Chromium mock E2E, real local HTTP
and pinned nonroot Docker container smoke tests. They are not live Neon,
Google, Upstash, or provider tests.

## Staging configuration checklist

- Basic alpha access gate, exact MONSTERA_PUBLIC_ORIGIN and Google OAuth callback.
- MONSTERA_SESSION_SECRET >= 32 secure bytes; do not rotate without approval.
- DATABASE_URL: dedicated staging Neon with TLS enabled; set
  MONSTERA_STAGING_ONLY=true and MONSTERA_EXPECTED_TEST_DB_NAME.
  These flags are declarations, NOT independent proof of DB ownership.
- Separate UPSTASH_REDIS_REST_URL/TOKEN and MONSTERA_REDIS_NAMESPACE.
- Keep MONSTERA_FREE_CHAT_ENABLED=false without approved upstream spend limits.
- MONSTERA_ALPHA_APPROVED_MODELS and MONSTERA_ALPHA_PROVIDER_PRICES_JSON
  must match reviewed provider/model IDs; token ceilings >= 25000 input and
  >= 1024 output; stale prices fail closed.
- MONSTERA_ALPHA_DAILY_REQUEST_CAP enforces request counts only.
- MONSTERA_ALPHA_ESTIMATED_MICRO_USD_PER_DAY is an estimated, integer
  micro-USD budget, not a proven provider invoice cap.
- MONSTERA_PROVIDER_SPENDING_LIMIT_CONFIRMED must remain false until a
  provider account-level spending cap has been independently verified.
- No real OpenRouter or DeepInfra calls without explicit low-cost approval.

The preflight prints configuration status ONLY and cannot verify credentials,
database ownership or monetary provider limits.

## Incident response rehearsal — disposable environments only

1. Stop test calls by disabling free alpha mode through an approved test config.
2. Independently check provider spending limits and unexpected charges.
3. Preserve request IDs and timestamps; do not store prompt bodies or secrets.
4. Reconcile held/settled/reclaimed credits against transaction logs.
5. Verify backups and restore into disposable DB, not production.
6. Preserve previous container image digest and approved rollback steps.
7. Evaluate Google subject ownership, session epochs and local IndexedDB records.
8. Keep release blocked until operator signs off on each remaining issue.

See docs/MVP_RELEASE_GATES_v1.8.md for the current release gate criteria.
