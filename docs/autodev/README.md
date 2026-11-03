# MONSTERA OS — Autonomous Development Pilot v0.1

**Status: DRAFT / NOT ENABLED.** This is a proposed automation behind a repository-variable kill switch. It is not an autonomous production deployment service.

## What it does
- Up to one scheduled attempt per day (09:17 Korea time), or on manual workflow dispatch **after the workflow is merged into the default branch**.
- Only when `MONSTERA_AUTODEV_ENABLED=true` and a valid Korea-time end date `MONSTERA_AUTODEV_END_DATE` is not in the past.
- If an open `autodev/pilot-*` PR exists, skips the entire run. This preserves the one-draft-at-a-time WIP limit.
- Runs OpenAI Codex with **read-only** permissions and `drop-sudo` in a job with no GitHub write permission. The agent sees the repository and returns structured JSON containing a proposed *single new test file* patch.
- A separate read-only verification job treats the response as untrusted data, checks file scope and patch validity, and does **not execute the proposed test code**.
- Only then a separate short privileged job applies that data patch, makes a unique branch without force-push, and opens a **Draft PR**. It never merges, publishes, deploys, sends Telegram messages, or touches ledger/token/customer data.
- Any failed gate simply blocks the proposed change. A successful Draft PR still requires independent test execution and CEO review.

## Human setup required (do not auto-enable)
1. Close the unrelated baseline CI decision first: MONSTERA AI PR #8 remains a distinct CEO-controlled merge decision.
2. Review and explicitly approve this pilot workflow PR. The default branch must contain this workflow before GitHub can run its scheduled trigger.
3. Configure repository **Actions secret** `OPENAI_API_KEY`. The ChatGPT subscription and OpenAI API billing are separate. Do not paste a key into issues, prompts, chats, or repository files.
4. Configure repository **Actions variables**: `MONSTERA_AUTODEV_ENABLED=true` and `MONSTERA_AUTODEV_END_DATE=YYYY-MM-DD` (KST). Choose a limited trial window, up to seven days initially.
5. Ensure GitHub's Action workflow permissions allow opening PRs from `GITHUB_TOKEN` (repository Settings → Actions → General). Do not grant the Codex job write access.
6. Monitor first execution in Actions. Confirm it creates at most one new Draft PR and no runtime code modification. Review its patch, then run the proposed test in an isolated QA environment.

## Fast stop
Set `MONSTERA_AUTODEV_ENABLED=false` or remove the variable. Revoke/rotate the API key if exposed. Keep existing PRs and logs for audit. The expiry date also bounds future attempts.

## Guardrails
- Agent never receives a write-capable GitHub token; `actions/checkout` runs with `persist-credentials: false`.
- Codex is the **last step** in its job. The privileged PR stage runs in another fresh job, receives only bounded JSON, and never executes the model-created test.
- Only one added file matching `tests/autodev/[a-z0-9-]+.test.mjs`, max 120 lines, is accepted. No existing code or workflow changes, symlinks, binary patches, renames, deletes, or force-push.
- Workflow uses no event-sourced untrusted prompt/body text; the prompt is a reviewed file on the default branch.
- No automatic cross-repo updates to SHAH CAT Issue #110; the PR body contains a backlink. Control-board state remains reviewed by a human.
- This is a **first autonomous patch-proposal trial**, not proof of multi-day uninterrupted execution or continuously self-improving development.

## Acceptance and next gate
1. Exact-HEAD workflow configuration reviewed and baseline CI succeeds.
2. With test credentials and switch explicitly configured, one scheduled/manual run produces a syntactically valid bounded proposal (or a safe no-change result).
3. A new Draft PR is created only if validation succeeds, with no changes to default-branch product code; next run is skipped while that Draft remains open.
4. CEO approval required before expanding allowed paths, executing agent-authored code automatically, increasing frequency, or enabling autonomous iterations.

## Dependencies
- OpenAI official `openai/codex-action@v1` (requires separate API key and usage-based charges).
- GitHub-hosted Ubuntu Actions runner; current control board: https://github.com/istars8370/shah-cat/issues/110
- Existing MONSTERA AI PR #2-#8 remain untouched.

**Work package ID:** AUT-01. **Not a replacement for C-01 Ledger/Studio/CI gates.**
