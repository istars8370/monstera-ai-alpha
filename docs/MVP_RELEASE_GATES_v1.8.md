# MONSTERA AI — MVP Release Gates v1.8

Branch: integration/t1-t12. Draft PR #2. **NOT approved for release.**

## Baseline evidence and latest-HEAD requirement

v1.7 HEAD 712131827d23d9aa9a309c0461d968889ba7b781:
- Integration CI https://github.com/istars8370/monstera-ai-alpha/actions/runs/41317962042
- PR CI https://github.com/istars8370/monstera-ai-alpha/actions/runs/41317965474
- 53 unit/mock tests; 6 Chromium tests; 5 local HTTP tests; 6 integration jobs PASS.

v1.8 verified checkpoint: SHA abe5fc1e7e31f97b1669b390860b1df111642e44.
- CI https://github.com/istars8370/monstera-ai-alpha/actions/runs/41320237231 — PASS.
- Integration https://github.com/istars8370/monstera-ai-alpha/actions/runs/41320232394 — PASS.
- 63/63 unit/mock tests, 7/7 mocked Chromium, 6/6 integration jobs.
This checkpoint is verified evidence, NOT blanket approval. If the branch changes, verify the newer HEAD again.

## v1.8 validated checkpoint changes

- Require same-origin Origin header on POST /api/chat; fail closed if the public origin is unset in production.
- Disclose plaintext IndexedDB and add confirmed purge of all account records on the device, serialized after pending writes.
- Synthetic upper-cost estimation in integer USD micro units with BigInt rounding, reviewed operator price snapshots and fallback-inclusive cost.
- Isolated Redis daily budget for the *estimated* USD-micro sum, in addition to existing user-minute and project-day request caps.
- Block provider calls without separate provider spending-limit acknowledgment, recent exact upstream price manifest and environment-specific namespace.
- Billing refuses differing amounts for settlement replays; invariant failures roll back.
- Offline preflight checks declared nonproduction DB name, staging intent, pricing and approvals without exposing credentials or connecting.

## Gate decisions

| Gate | Status | Evidence and blocker |
| --- | --- | --- |
| G1 Build | PASS at verified v1.8 checkpoint | Frozen pnpm, TS, lint, tests and Next build; newer commits require revalidation |
| G2 Database | PARTIAL | Disposable PostgreSQL PASS; real nonproduction Neon unverified |
| G3 Identity | PARTIAL | Mock Google OAuth, signed session and account isolation PASS; live login unverified |
| G4 Chat | PARTIAL | Mock route and browser SSE tests PASS; real provider stream unverified |
| G5 Provider | BLOCKED | Real keys, authorized spend and provider hard account budget unavailable/unverified |
| G6 Cost Control | PARTIAL | Atomic estimated micro-USD Redis reservations implemented; provider invoice-level hard cap not established |
| G7 Billing | PARTIAL | Mock ledger and PostgreSQL invariants; chat charging disabled and prices/FX unsettled |
| G8 Security | PARTIAL | Authentication, CSRF and local privacy mitigations; no full security audit or Git history secrets scan |
| G9 Browser | PASS for v1.7 MOCK scope; v1.8 pending | Real Chromium but intercepted external APIs; device purge added |
| G10 Operations | PARTIAL | Pinned Docker and offline preflight; deployment, backup restore and monitoring not proven |

## Monetary and privacy limits

Zero internal registry price does not prove a free AI provider call. Price snapshots
are operator-maintained, reviewed within 7 days, and contain input/output token
ceilings; they are NOT independently verified provider invoices. The synthetic
USD-micro daily reservation is an internal risk estimate, not a guaranteed
financial limit. The acknowledgment flag is not enforcement at the provider.
Require actual provider-side hard limits and explicit approval for live tests.

IndexedDB chat histories remain unencrypted plaintext. The UI now provides a
confirmed device-wide purge; signing out retains local records. Provider
privacy, host access to local records and historical secret exposure need review.

No main merge, Fly deployment, production database change, Stripe activation,
live paid AI calls, secret rotation or public launch is approved.

## Staging blockers and allowed next actions

Offline syntax check: node scripts/preflight.mjs (no external calls or secrets printed).
Required: explicitly identified staging Neon database, staging Google OAuth credentials,
staging Upstash, reviewed upstream prices, hard provider budgets, user-approved
credit units/rounding/refund/cancellation rules, monitoring and recovery tests.

Validation levels must remain separate: UNIT, MOCK E2E, LOCAL HTTP, BROWSER MOCK,
ISOLATED DB/REDIS, CONTAINER, LIVE STAGING (not run), PRODUCTION (not run).
