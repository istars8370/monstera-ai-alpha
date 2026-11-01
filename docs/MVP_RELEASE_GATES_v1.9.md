# MONSTERA AI — Release Gate Assessment v1.9

**Branch:** \`integration/t1-t12\` — Draft PR #2. **Release: NOT APPROVED.**

## Source of truth

The v1.8 starting checkpoint is \`bd2f1ab54b0f4a0ef67b34c1974cabf894a8d2bc\`.
- Prior CI: https://github.com/istars8370/monstera-ai-alpha/actions/runs/41320482763
- Prior integration: https://github.com/istars8370/monstera-ai-alpha/actions/runs/41320478401
- Prior baseline: 63/63 unit/mock, 7/7 Chromium mocked browser, 6/6 integration jobs.

v1.9 verified code and documentation checkpoint: `2e13d7f260ad42af85072276e0e4d095abcb9e1b`
- General CI: https://github.com/istars8370/monstera-ai-alpha/actions/runs/41323290412 — PASS.
- Integration CI: https://github.com/istars8370/monstera-ai-alpha/actions/runs/41323287574 — PASS.
- 64/64 unit and mock integration tests, 9/9 Chromium mocked E2E, six integration jobs PASS.
- Disposable PostgreSQL backup -> separate restore verified account balances, ledger and identity uniqueness.
This checkpoint is evidence for its exact commit. Any subsequent commit, including
this evidence-record update, must be separately checked against the new HEAD.

## v1.9 changes verified at the recorded checkpoint

- Correct per-user IndexedDB deletion, with confirmation and preservation of
  other users' stored records; unsent drafts cleared on logout/account switch.
- Reject late credit-balance fetches for the wrong displayed user.
- Reclaiming an expired credit hold now verifies the corresponding ledger update
  occurred; failures roll back the entire transaction.
- Enforce explicit PostgreSQL \`sslmode=require\`, \`verify-ca\`, or \`verify-full\`
  when NODE_ENV=production.
- CI disposable Postgres backup and restore verifies table count, account balances,
  settled ledger and Google-subject uniqueness after restore.
- New staging/financial decision checklist at
  \`docs/STAGING_ACCEPTANCE_v1.9.md\` (no secrets or arbitrary prices).

## Release Gate assessment

| Gate | Status | Evidence and outstanding condition |
| --- | --- | --- |
| G1 Build | PASS at verified v1.9 checkpoint | Frozen install, TypeScript, lint, 64 unit/mock tests and production build; verify newer HEAD separately |
| G2 Database | PARTIAL | Disposable PostgreSQL migration, transaction and separate backup/restore PASS; actual nonproduction Neon remains unverified |
| G3 Authentication | PARTIAL | Mock Google signed-OIDC + HMAC session + account separation; live Google/Neon sign-in not tested |
| G4 Chat | PARTIAL | Mock provider route, bounded SSE, fallback and cancellation; no real provider responses tested |
| G5 Provider | BLOCKED | No explicit authorization or monetary cap verified for live OpenRouter or DeepInfra |
| G6 Cost Control | PARTIAL | Redis estimated USD-micro guard, count limits and reviewed prices; provider-side invoiced hard caps not verified |
| G7 Billing | PARTIAL | Actual billing helpers exercised with mock/isolated DB; no final credit unit/price/cancel/refund policy, no live charge |
| G8 Security | PARTIAL | Session, OAuth, CSRF, cross-user UI and local deletion mitigations; independent security audit/in-scope full Git history scan outstanding |
| G9 Browser | PASS for v1.9 MOCK scope | 9 Chromium tests with simulated upstream APIs, account-specific deletion and unsent draft handling PASS; live Google/browser chain unverified |
| G10 Operations | PARTIAL | Pinned Docker image, local HTTP and disposable backup/restore; live backup, monitoring, alerting, Fly rollout and rollback untested |

**Current classification: Development Verified**, contingent on latest-HEAD
tests. Not Staging Verified, not Release Candidate, not Production Approved.

## Financial/identity/operational blockers

Refer to \`docs/STAGING_ACCEPTANCE_v1.9.md\` for exact operator approvals.

1. Authorized nonproduction Google client, Neon database and Upstash account;
   separate API secrets and test-data consent.
2. Independently verified upstream per-key/account monetary spending ceilings,
   maximum authorized test spending and approved models.
3. Reconciled actual provider usage, model-specific pricing, one-credit unit,
   FX/rounding/cancellation/refund rules. User charging remains disabled.
4. Plaintext browser history risks and multi-tab purge limitations reviewed.
5. Actual live staging OAuth -> Neon -> model -> provider SSE -> browser E2E;
   staged rollback, monitoring and backup recovery evidence.

## Prohibited without explicit approval

No main merge, Fly deployment, production migration or data edit, paid upstream
call, Stripe, user credit charge, secret rotation or public launch.

Validation levels: UNIT | MOCK E2E | LOCAL HTTP | CHROMIUM MOCK |
ISOLATED DB/REDIS | CONTAINER | LIVE STAGING (NOT RUN) | PRODUCTION (NOT RUN).
