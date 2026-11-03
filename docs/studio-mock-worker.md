# Creative Studio — Mock generation pipeline and worker

**Status: development-only integration. NOT a live model service.** This document does not authorize deployment or billing. Existing Draft PR #7 remains unmerged.

## Boundaries

- Submit: `POST /api/studio/generation/jobs` (session, Origin, tier, model, price, token cap, consent, UUID requestId).
- Price preview: existing `POST /api/studio/generation/preflight` (read-only, no holds).
- Supported modality: **text only**, provider registry entry must be `openai`, but the worker always instantiates the **offline** `StudioMockProvider` under the router's `openai` key.
- Job status: `GET /api/studio/jobs/:id` (owner scoped).
- Import: `POST /api/studio/generation/jobs/:id/draft` with a valid brief (owner scoped). Imports a finished mock result as unapproved `DRAFT` only. Repeats return the same draft, never overwrite manual edits.
- `/studio` exposes model, preflight, job, result and manual import UI in opted-in development environments. It does not execute workers in a page or response callback.

**Default = disabled.** `MONSTERA_STUDIO_MOCK_ENABLED=true` must be explicitly set. Mock code also requires `NODE_ENV != production` and a local loopback `DATABASE_URL` (127.0.0.1 / localhost). Regardless of flags, a production build or remote DB returns 501 for job submission and does not execute a mock worker. Real OpenAI/API calls, payments, images, video and automatic publishing are never invoked.

## Local-only development configuration (synthetic data)

Use a **disposable local** database with migrations 0000–0004 applied. Set server-only environment configuration:

- `MONSTERA_STUDIO_MOCK_ENABLED=true`
- `DATABASE_URL=postgresql://<local-test-user>:<local-test-password>@127.0.0.1:5432/<disposable-db>`
- `MONSTERA_MAX_OUTPUT_TOKENS=512` (sample safety cap)
- `MONSTERA_STUDIO_TEXT_CREDIT_PRICES_JSON`: reviewed test-only policy array documented in `docs/studio-generation-preflight.md` (illustrative internal credits, not OpenAI pricing).
- Existing session secret and local test user/credit/model rows.

**Connection limitation:** The application's existing `db/pool.ts` uses Neon WebSocket transport, not a native TCP PostgreSQL driver. This worker CLI is wired to that shared pool. Until a compatible local transport is demonstrated, do **not** claim that `pnpm studio:mock-worker` has been verified against a standalone PostgreSQL instance. CI runs disposable PostgreSQL SQL-level lease/transaction races and a separate Node fake-DB end-to-end test. A local transport integration test is a remaining readiness gate.

The worker is an explicitly invoked single tick:

```bash
pnpm studio:mock-worker
```

A long-running supervisor/scheduler and real credentials are **not** configured or started. This command is not a production daemon. It may fail before connecting if the local database does not support the application's Neon WebSocket transport; that is an unresolved integration item.

## Queue and settlement invariants

1. Admission preflights against the live server-side model registry, tier, recent reviewed price snapshot and unreserved balance.
2. Within one transaction, the billing engine creates an idempotent `usage_ledger` hold, increases `credits.reserved`, and creates `studio_jobs` with prompt and token limits. Failing admission rolls back all writes.
3. Mock worker claims the oldest eligible queued job with `FOR UPDATE OF l,j SKIP LOCKED` and a 60-second lease UUID. Claim increments attempt count (max 3).
4. Stream is generated without network. The worker requires a completion marker, a single usage event and bounded output; it verifies usage against prompt and output ceilings and charges no more than the reservation.
5. Successful status, result text, usage tokens, wallet reduction and ledger settlement commit in **one transaction** fenced by the lease UUID. Duplicate or stale completions are rejected.
6. Mock failures may retry with the same hold. After three attempts, only the **never-external** mock job is settled at zero and marked failed. Live-provider failures are NOT presumed free.
7. Expired leases can be requeued for mock execution. Expired holds are handled by `reclaimStaleJobs`. The reclaimer skips actively leased jobs. A crashed worker never leaves an in-memory-only queue as the source of truth.
8. Successful mock results must be manually imported into an owner-owned draft. Import creates `DRAFT` and `checks = null`; five manual review checks still apply. A job can create at most one draft.

## Verification

- `tests/studio.pipeline.test.mjs`: fake registration, reservation, stream usage settlement, provider failure/truncation, bounded retries, old lease token, no other provider calls.
- `tests/studio.result-import.test.mjs`: idempotent, owner-scoped draft import and no overwrites.
- `tests/studio-job-concurrency.sh` and `tests/studio-worker-lease-race.sh`: disposable PostgreSQL 16 row-lock/lease races.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build`: run under CI on the exact changed HEAD.

**Not yet production-ready:** tested native worker-to-PostgreSQL transport, process supervisor, upstream hard-spending cap, pricing/usage reconciliation against real OpenAI, real provider retries/billing ambiguity, operator audit, production load testing and security review.

## Operational decisions still required

1. Implement or verify a compatible local test DB transport for the worker CLI (without altering the existing Neon production client contract).
2. Choose a reviewed internal-credit policy from actual provider quotes and unit economics.
3. Decide worker deployment architecture and securely schedule isolated ticks; do not run a detached HTTP Promise.
4. Run real isolated-DB integration tests with the same worker module and process restarts.
5. Only after all gates succeed should a separately reviewed PR consider real provider usage or deployment.
