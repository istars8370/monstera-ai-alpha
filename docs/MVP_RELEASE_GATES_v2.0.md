# MONSTERA AI — Integration Release Assessment v2.0

Working branch: \`integration/t1-t12\`. Draft PR #2. No deployment approval.

## Baseline, verification levels

v1.9 verified base: \`0d0f9d7abab59131127e03980988d1274fc186ed\`
- General CI: https://github.com/istars8370/monstera-ai-alpha/actions/runs/41323485219 (success)
- Integration: https://github.com/istars8370/monstera-ai-alpha/actions/runs/41323481785 (success)
- 64/64 Node/mock; 9/9 real Chromium with intercepted external services; 6/6 CI integration jobs.

This is **historical** evidence only. After v2.0 commits, check the latest
HEAD's CI and record actual results in Draft PR #2. No live Google, Neon,
Upstash, OpenRouter or DeepInfra service has been tested in these runs.

## v2.0 actions and constraints

- TASK 62: latest SHA, draft PR and CI confirmed, original base unchanged.
- TASK 63: staging preflight now requires a separately declared **exact**
  \`MONSTERA_EXPECTED_GOOGLE_REDIRECT_URI\`, matching
  \`MONSTERA_PUBLIC_ORIGIN + /api/auth/google/callback\` byte-for-byte.
  It rejects mismatched hosts, non-HTTPS callbacks, query strings and fragments.
- TASK 64 (configuration): Google OAuth startup rejects HTTP, including
  localhost HTTP, in \`NODE_ENV=production\`. Local development may still
  use localhost HTTP to preserve offline mock testing. This does not
  validate real Google app registration.
- TASK 65: isolated Redis Lua budgeting previously passed, actual Upstash
  REST credential or nonproduction resource identity not supplied. LIVE BLOCKED.
- TASK 66: supplier price snapshots and estimated internal USD-micro caps are
  not invoice hard limits. No provider credentials, independently audited account
  caps or explicit spend approval. LIVE BLOCKED.
- TASK 67: Chromium remains mocked behind the actual Next/React client.
  Actual Google-to-Neon-to-SSE browser E2E BLOCKED.
- TASK 68: the existing credit ledger is not integrated with paid chat.
  No operator-approved credit unit, pricing, FX/rounding, missing-usage,
  cancellation, refund or reconciliation policies. PAID MVP BLOCKED.
- TASK 69: production OAuth origin and staging callback consistency improved.
  Plaintext IndexedDB and cross-tab/shared-browser data exposure still need
  explicit privacy review. No independent penetration test.
- TASK 70: evaluate independently for private alpha and paid MVP.

## Release gates — scope-specific, conservative

| Gate | Decision | Remaining proof |
| --- | --- | --- |
| G1 Build | PASS at v1.9 baseline; v2.0 latest CI to verify | Frozen pnpm install, typecheck, lint, test, build |
| G2 Database | PARTIAL | Disposable PostgreSQL migration, rollback and backup restore PASS; live staging Neon unverified |
| G3 Google identity | PARTIAL | Signed mock OAuth and account isolation pass; real Google/Neon login unverified |
| G4 Chat | PARTIAL | Mocked SSE, cancellation and model routing PASS; actual provider SSE not run |
| G5 Providers | BLOCKED | Explicit bounded paid-test consent, verified upstream hard cap and test keys |
| G6 Monetary limit | PARTIAL | Atomic synthetic USD-micro reservations PASS; actual upstream invoice hard limit unverified |
| G7 Billing | PARTIAL | Credit ledger mocked/isolated; no approved paid-chat billing policy |
| G8 Security | PARTIAL | Existing auth, session, CSRF controls plus redirect hardening; unresolved privacy/audit |
| G9 Browser | PASS in MOCK scope only | Actual browser tests with intercepted APIs; no real external identity |
| G10 Operations | PARTIAL | Pinned container, disposable DB recovery; staging deployment, alerts and rollback unverified |

**Private Alpha Ready:** Not reached. Requires real Google + Neon + Upstash,
provider SSE at controlled verified monetary spend, privacy/security and
operational safeguards. Free to the user does not mean zero supplier cost.

**Paid MVP Ready:** Not reached. Requires all private-alpha safeguards and
operator-approved financial credits/pricing/metering/refund/FX and actual
cost reconciliation. Keep operational credit debits and Stripe disabled.

**Production Approved:** Not reached. Separate approval for public launch,
main merge, actual deployment and production data is always mandatory.

## Operator actions to unblock Staging Verified

1. Provide *non-sensitive identifiers only* of dedicated **staging** Google
   OAuth client, authorized test account, exact HTTPS callback and domain.
   Do not place client secrets in GitHub issues, PRs or chat.
2. Identify a dedicated Neon nonproduction project/branch/database and Upstash
   Redis resource; approve read-only checks separately from schema/data changes.
3. Set a provider-specific hard USD cap, explicitly authorize a maximum test
   spend and verify auto-replenishment/provider key limits; do not rely solely
   on the app's synthetic Redis USD micro counter.
4. Authorize a bounded single-model test only after the above checks. Record
   success without recording prompts or secrets in logs.
5. Independently approve staging host/deployment, privacy policy, data
   retention and rollback/monitoring before inviting users.

Do NOT repeat already-passed mock tests just to increase test counts. Any
unapproved real connections remain BLOCKED; all work on the integration branch.
