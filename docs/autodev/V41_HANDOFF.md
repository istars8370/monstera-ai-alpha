# AUT-41-01: proposal boundary regression coverage

Status: LOCAL_VERIFIED / DRAFT_PUBLICATION. Not merged or released.

- Repository: istars8370/monstera-ai-alpha
- Branch: test/autodev-boundaries-v41
- Baseline: ea5f04b5f463cc4c8fd8a22ec655ed2b63f2aba2
- PR: see the open Draft for branch test/autodev-boundaries-v41.
- Approval: CEO v4.1, 2026-11-06; docs/** and offline tests/** only.
- Owner: this Autopilot execution; no independent QA claimed.
- Existing queue: https://github.com/istars8370/shah-cat/issues/110

This adds boundary coverage absent from the existing ten-case validator suite:
120 source lines accepted, 121 and two rejected; 1200-character metadata
accepted, each 1201-character field rejected; non-string fields rejected.
Rejected proposals must not emit a publish gate result or PR body. The tests
reuse the existing temporary-Git harness and never execute proposed code.

Validation commands (no installation or external service calls):

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/autodev -p 'test_*.py' -v
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/autodev -p 'test_*.py' -v
git diff --check
```

Observed: existing 10 tests PASS; added 6 tests PASS. The current CI does not
discover tests/autodev Python tests; local evidence is not CI coverage.

Public repository visibility and standard ubuntu-latest runners were verified.
GitHub documents standard hosted runners in public repositories as free:
https://docs.github.com/en/actions/concepts/billing-and-usage
Push and pull_request trigger ordinary CI; the paid pilot is schedule/dispatch
only. No release or external messaging steps occur on this branch event. No workflow, dependency,
runtime, secret, variable, API, ledger or wallet changes were made.
The Git proxy lacked CLI credentials; public GitHub HTTPS checkout succeeded.
Connector branch creation succeeded; CLI push authentication remains unverified.

The ChatGPT task was disabled with its last recorded run completed and a
requires_user_action flag; result text was empty, so the disable reason is
unknown. Its environment metadata was inherited/null: this local runtime is
not proof of an equivalent scheduled runtime.

Next condition: verify exact remote HEAD CI and scheduled runtime. Reuse this
Draft and do not create a duplicate. Recheck visibility and workflows before
every subsequent publication; this cost finding is not a permanent exemption.
Do not create more local candidates while this work package awaits publication.
A local directory lock is not a cross-environment lock. If shared lock state
cannot be verified, subsequent executions must not begin a new write task.

## Single task handoff

This branch is the sole v4.1 candidate until AUT-41-01 is resolved. Existing
ChatGPT development tasks were paused during publication; the target task had
no recorded in-progress run, and this repository had no queued/running Actions.
Future writers must verify execution state and exclusive ownership before
mutating it; branch existence alone is not an atomic execution lock. Use
expected_sha and non-force updates to reject concurrent remote changes.
