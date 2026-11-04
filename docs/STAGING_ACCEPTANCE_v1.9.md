# MONSTERA AI — Staging Acceptance and Financial Policy Decisions v1.9

**Repository:** `istars8370/monstera-ai-alpha`, Draft PR #2.
**Status:** OPERATOR DECISIONS REQUIRED. This file grants no API access, payment,
schema migration, Fly deployment or production data access.

## What is actually proven

The last verified baseline before v1.9 was `bd2f1ab54b0f4a0ef67b34c1974cabf894a8d2bc`:
63 Node/mock tests, 7 browser/mock tests, and 6 isolated integration jobs succeeded.
New v1.9 changes require passing CI on their exact HEAD before the baseline
can be advanced. All Google / Neon / Upstash / AI-provider real E2E is unverified.

## Nonproduction resource approval checklist

The user or designated operator must establish the following OUTSIDE the repository:

| Resource | Evidence required (identifiers only, NEVER secrets) | Permitted action |
| --- | --- | --- |
| Google OAuth Web client | Client display name, test-user consent, callback URL, staging domain | Real interactive test login after approval |
| Neon | Exact nonproduction project and database name, branch, backup/restore plan; verify ownership rather than trusting an environment variable | Read-only probe after approval; schema changes need separate approval |
| Upstash | Dedicated nonproduction Redis database, namespace, read/write test policy and TTL | Small isolated test after approval |
| OpenRouter | Staging-specific key, model allowlist, actual USD key-limit and reset settings independently checked in provider console | One bounded request ONLY after explicit spend approval |
| DeepInfra | Staging-specific key and independently verified billing/spending-limit behavior | One bounded request ONLY after explicit spend approval |
| Service host | HTTPS origin, secret manager, deployment target, rollback image digest | Deployment needs separate approval |

**Do not obtain or print secret values in a chat, PR, GitHub Actions log or
tracked file.** Availability and syntactic preflight do not prove that a live
credential works, or that the target database is nonproduction.

## Provider budget documentation (public, not account evidence)

- OpenRouter API-key limits support `limit` (USD) and `limit_reset`:
  https://openrouter.ai/docs/api/api-reference/api-keys/update-keys
- OpenRouter guardrails and budgets:
  https://openrouter.ai/docs/guides/features/guardrails/overview
- DeepInfra pricing describes prepaid billing and a configurable spending limit:
  https://deepinfra.com/pricing

These are references for **operator verification**, not proof that caps exist
on MONSTERA's actual accounts. Confirm whether the cap covers the specific key,
model, platform fees, provider pass-through costs, automatic replenishment,
parallel calls, and the chosen time interval. A budget that is merely an alert
does not qualify as a guaranteed hard monetary limit.

The application's synthetic USD-micro Redis reservation remains a conservative
estimator, not a provider billing ledger. Provider price snapshots can lag
actual prices, and missing usage metadata cannot safely be treated as zero.
In particular, a fallback can incur costs at both upstream providers.

## Required credit policy decisions — NONE decided automatically

| Decision | Operator must choose / document | Default until decided |
| --- | --- | --- |
| Credit definition | USD-denominated subunit, KRW unit or distinct prepaid usage unit | No financial credit conversion |
| Credit sale and FX | Sold unit, timing, exchange-rate source, tax and rounding | No monetary conversion or sale |
| Per-model rates | Input/output token price, markups, pricing version, change notice | No actual charge |
| Maximum reservation | Input context, completion limit, fallback exposures and precharge ceiling | Paid chat disabled |
| Usage evidence | Trusted usage fields, billable vs nonbillable units, provider reconciliation | No inferred actual usage |
| Streaming partial/cancel | Partial charges, provider billed-but-undelivered tokens, refunds | No automatic paid settlement |
| Usage omitted / timeout | Hold/reconcile vs refund; settlement deadline; fraud/retry rules | Quarantine, no invented charge |
| Reservation expiration | Choose TTL relative to provider timeout and billing finalization | No paid lifecycle enabled |
| Disputes | Correction journal, audit trail, review/appeal and tax requirements | Manual review required |
| Insufficient balance | Rejection/upgrade options, no automatic overdraft | Reject reservation |
| Double submission | Stable idempotency-key scope and replay conflict policy | Reject mismatched replays |
| Provider spend caps | Account-level hard USD limit, reserved balance, per-user quotas | All real paid calls blocked |

The current `holdCredits`, `settleCredits`, and `reclaimExpired` code
is implemented/tested in mocked or disposable database environments. **It is
NOT wired into `/api/chat` for live billing.** Settlement after reservation
expiry and provider-reported usage gaps require an explicit dispute/recovery
policy before enabling paid credits.

## Privacy and launch gates

- IndexedDB is plaintext local browser storage. Shared-browser profiles and
  other tabs on the same origin remain a confidentiality concern, even with
  per-user keys and deletion options. Consider a privacy review and a
  cross-tab purge policy before inviting real users.
- The app does not intentionally save chat message text to the server, but
  external AI providers process prompts under their respective terms.
- Release must remain **Development Verified**, not `Staging Verified`, until
  real nonproduction Google + Neon + upstream model SSE are proven.
- `main` merge, production schema change, Fly deployment, Stripe, paid API
  calls, key rotation and public onboarding each require separate approval.

## Fastest next authorized milestone

1. Obtain an **explicitly nonproduction** Neon project and Google OAuth
   client, with test-user permissions and known callback origin.
2. Record the above resource identification WITHOUT any sensitive values.
3. Authorize and perform read-only test connectivity independently from
   schema modifications. Preserve proof (redacted status and timestamp only).
4. Verify real Google sign-in and zero-credit identity initialization only
   after approval for dedicated test data creation.
5. Confirm provider-account hard cost ceilings and a maximum permitted
   small USD test spend, then run a single bounded SSE call.
6. Reconcile actual usage against provider-side activity and decide credit
   conversion policy. Do not activate user billing or public access.
