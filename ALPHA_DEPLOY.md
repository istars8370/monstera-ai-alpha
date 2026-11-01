# MONSTERA AI — Operational Readiness Runbook (not a deployment authorization)

This document supersedes the initial alpha skeleton notes. MONSTERA AI is a private
integration candidate; merging, deployment, live credentials and payments need explicit approval.

## Local, non-destructive verification

    corepack enable
    corepack pnpm install --frozen-lockfile
    corepack pnpm typecheck
    corepack pnpm lint
    corepack pnpm test
    corepack pnpm build

GitHub integration CI also applies committed Drizzle SQL to a disposable PostgreSQL service,
tests Redis Lua budgets on a disposable Redis server, starts the built Next.js app and
runs mock-backed Playwright Chromium browser journeys. These checks are NOT live provider tests.

## Offline configuration inspection

    node scripts/preflight.mjs

Reports status of the alpha Basic gate, public HTTPS origin, Google OAuth, signed sessions,
test Neon URL, Upstash REST URL, at least one AI provider, alpha opt-in, model allowlist,
and global daily request cap. Does not display credential values, resolve URLs or call APIs.

The command can report that the configuration is syntactically ready, **not that a credential
works** or that provider spend limits are configured. Operator approval is still required.

## Environment prerequisites (never commit actual values)

- ALPHA_BASIC_USER / ALPHA_BASIC_PASSWORD — strong temporary private access gate.
- MONSTERA_PUBLIC_ORIGIN — exact public HTTPS origin.
- GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — OAuth Web client with the matching callback URL.
- MONSTERA_SESSION_SECRET — randomly generated secret, >=32 bytes, stored in secret manager.
- DATABASE_URL — dedicated nonproduction Neon database initially; TLS enabled.
- UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN — dedicated nonproduction Redis.
- OPENROUTER_API_KEY / DEEPINFRA_API_KEY — server-side only; use no live calls without budget approval.
- MONSTERA_FREE_CHAT_ENABLED / MONSTERA_ALPHA_APPROVED_MODELS / MONSTERA_ALPHA_DAILY_REQUEST_CAP —
  remain disabled or unconfigured until cost and provider controls are reviewed.

A local-zero model price does not prove the upstream provider is free. Call quotas are not
a monetary cap; configure a provider-side spending limit separately.

## Container verification (no deployment)

The Dockerfile builds with pnpm 9.15.9 and the frozen lockfile, then runs Next's standalone
server as a non-root user. GitHub container-smoke tests HTTP /api/health, the Basic gate
and a forbidden user-scoped endpoint without a session. This is not a production rollout.

## Release checks, operations and incident response

1. Obtain approval for a nonproduction environment and test identity; verify OAuth/Neon.
2. Confirm immutable Google sub ownership and reject auto-linking legacy email-only accounts.
3. Restore a disposable Neon backup and validate migrations before production scheduling.
4. Review inbound TLS, public origin, protected cookies and storage risk.
5. Set money-denominated provider budgets and alerts, separate from Redis request caps.
6. Validate monitored provider failures, upstream usage, timeouts and cancellation on test credits.
7. Define credit pricing and reconciliation before enabling even a limited paid pilot.
8. Establish rollback: preserve previous image digest, point-in-time DB restore plan,
   session secret handling and approved incident contacts.
9. Verify actual Fly app name, limits, health check and secret access only after approval.
10. Receive separate approval for merge, actual deployment, production database migrations,
    paid API calls, payment activation and public access.

If any condition fails, keep the Draft PR open and the environment offline.
Refer to docs/MVP_RELEASE_GATES_v1.7.md for evidence and release gate status.
