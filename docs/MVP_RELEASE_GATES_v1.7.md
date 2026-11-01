# MONSTERA AI — MVP Release Gates v1.7

## Scope and evidence

Repository: istars8370/monstera-ai-alpha. Only integration/t1-t12 may be modified without further approval.
Draft PR: https://github.com/istars8370/monstera-ai-alpha/pull/2

Evidence is the **latest completed CI run for the exact branch HEAD**. Do not replace that
with a historical green run. Earlier verified runs include:
- v1.6 frozen install/typecheck/lint/unit tests/DB+Redis+HTTP:
  https://github.com/istars8370/monstera-ai-alpha/actions/runs/41307204146
- v1.7 first Chromium suite (5 passing browser cases with mocked external APIs):
  https://github.com/istars8370/monstera-ai-alpha/actions/runs/41317293932

Production changes have NOT been approved. These checks do not include real provider use,
payment authorization, production migrations or a published service.

## Release gates (conservative scope)

| Gate | Status | Evidence and outstanding condition |
| --- | --- | --- |
| G1 Build | PASS if latest HEAD checks succeed | Frozen pnpm 9.15.9, typecheck, lint, tests, Next production build; verify latest run |
| G2 Database | PARTIAL | Committed Drizzle SQL, exactly five tables, SQL rollback/idempotency/concurrent holds in disposable PostgreSQL; nonproduction Neon WebSocket connectivity not tested |
| G3 Identity | PARTIAL | Signed state, mock Google OIDC, immutable sub, cookie epoch revocation and account collision tests; live Google + Neon login not tested |
| G4 Chat | PARTIAL | Mocked route-level SSE, fallback, failure and cancellation; browser uses mocked API responses; provider streaming not validated live |
| G5 Provider | BLOCKED | Actual OpenRouter/DeepInfra credentials + explicit test-call spending authorization required |
| G6 Rate Limit | PARTIAL | Atomic per-user/minute and global/day request limits on disposable Redis; actual Upstash access and money caps unverified |
| G7 Billing | PARTIAL | SQL invariants and mock transactional hold/settle/reclaim; pricing, metering, billing UI and paid charges not integrated |
| G8 Security | PARTIAL | Regression tests for identity spoofing, CSRF, replay, frame limits and account isolation; deep audit/privacy review outstanding |
| G9 Browser | PASS in MOCK scope only | Playwright Chromium login UI, model selection, IndexedDB persistence, account switch, logout, error/cancel; real OAuth/provider/browser E2E pending |
| G10 Operations | PARTIAL until current CI passes | Pinned Docker image smoke test, preflight inspection and recovery runbook; real monitoring, backups and deployment not tested |

MVP Release Candidate is **NOT APPROVED** while G3–G8 remain partial/blocked.
A passing CI run does not override any release gate's missing real-world evidence.

## Approved next steps without monetary spend

1. Validate config file structure locally: \`node scripts/preflight.mjs\`. It prints
   configured/missing status only; no secrets are printed and no connections are made.
2. Exercise browser tests with mocked services through the integration CI.
3. Exercise PostgreSQL and Redis using disposable CI services.
4. Review code, tests, cookie handling, and local IndexedDB privacy risks.
5. Review a full rollback plan, sign-in recovery, logs and spending alerting policy.

## Explicit approvals and hard blockers

- Nonproduction Google OAuth account/configuration + Neon test DB connection: obtain a
  dedicated test environment, consent, and credential management. Do not paste secrets in PR.
- Upstash and AI providers: obtain dedicated test credentials, a **money-denominated**
  upstream spending cap and explicit authorization before ANY potentially billable calls.
  Request-count limits alone do not guarantee any money limit.
- Credits: define one credit's unit, token pricing, rounding, cancellation, provider
  usage reporting, maximum reservation, refund/reconciliation and FX policy.
- Privacy: decide whether local plaintext IndexedDB is acceptable for pilot users;
  verify local record cleanup and account switching under multi-user browsers.
- Operations: approve the production domain, TLS, Neon migration, backup/restore tests,
  incident response/monitoring, Fly machine configuration, secrets management and budgets.

Never approve, merge into main, deploy, migrate production DB, change secret keys, enable
Stripe/paid credits, or open to the public without the user's separate explicit decision.

## Test levels must not be conflated

- UNIT / MOCK E2E: synthetic upstream data and in-memory DB.
- LOCAL HTTP / BROWSER MOCK: actual Next server/Chromium, upstream responses intercepted.
- ISOLATED DB / REDIS: disposable Docker services, NOT Neon/Upstash production.
- LIVE TEST: explicitly authorized real test account/providers, currently **not executed**.
- PRODUCTION: not executed.
