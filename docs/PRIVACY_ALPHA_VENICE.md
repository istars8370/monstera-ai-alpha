# MONSTERA AI Privacy Alpha — 2026-11-04

## Goal
Enable a daily-use privacy-first, minimally filtered AI chat with explicit Venice Private-model routing, no server-side transcript DB, and an ephemeral browser session by default.

## What is actually implemented
- `ALPHA_CHAT_PROVIDER=venice` explicitly selects the Venice server-side adapter (otherwise existing OpenRouter behavior stays unchanged).
- Venice API credentials stay in `VENICE_API_KEY` (server environment only). Model ID is an operator-defined `VENICE_PRIVATE_MODEL_ID`.
- Before each generation, the adapter fetches Venice's text catalog and only permits the EXACT model when `model_spec.privacy === "private"`. Missing metadata, unknown ID, provider failures and non-private tiers fail closed.
- Fixed Venice HTTPS API host, no browser-selected upstream URL, and no automatic OpenRouter fallback on Venice failure.
- Venice built-in system prompt is disabled; web search/scraping/citations are disabled to avoid silent retrieval and third-party data disclosure. `store:false` is requested.
- Frontend starts without loading browser-saved transcripts or writing to IndexedDB. Local persistence is explicitly opt-in and can be disabled.
- Chat API uses no server database to persist prompts or responses, and responds with `Cache-Control: no-store`.

## Privacy limits — read before actual use
- **Private does not mean E2EE, TEE, or zero network exposure.** Venice processes prompts; the Venice privacy tier and retention promises are provider policies, not independently verified cryptographic guarantees.
- Existing API sends the selected message history to Venice on each turn. Both Venice and network infrastructure are in the trust boundary; ensure HTTPS.
- The app's legacy optional browser IndexedDB persistence is **plaintext**. Do not enable for sensitive chats. Draft PR #6 contains separate encrypted storage, but has not been integrated or independently accepted here.
- Basic authentication is not a multi-user security platform; local machine, extensions, browser devtools, server operators, and XSS remain risks.
- Default ephemeral session means no persistence by this application, not no storage anywhere (browser memory, crash dumps, proxies, provider infrastructure). Existing persisted chats may remain until explicitly cleared.
- 'Minimal filters' means no extra MONSTERA content classifier or silent provider fallback. This does not bypass provider terms or technical restrictions.
- API key provision and live calling must be explicitly approved and funded; CI/build must never make paid calls.

## Local evaluation (not yet run in a real account)
1. Use existing `ALPHA_DEPLOY.md` local setup and Basic auth. Set `ALPHA_CHAT_PROVIDER=venice`, `VENICE_API_KEY`, `VENICE_PRIVATE_MODEL_ID` in local-only `.env.local` (never commit actual secrets).
2. Select a Venice `text` model that currently advertises `model_spec.privacy: "private"`. Confirm availability and limits through official docs and account.
3. Run `pnpm typecheck && pnpm lint && pnpm build`; launch locally and verify response with **fictional text only**, after explicit paid API approval.
4. Negative tests: unset key -> 503; unknown/non-private model -> no completion request; provider lookup failure -> no fallback; no key leaked in browser or logs.
5. Confirm zero browser transcript storage by default and explicit opt-in behavior; test record removal and a full browser refresh.
6. Independent QA: check HTTP request counts, streaming SSE, abort, private model catalog response, cost and provider billing receipts.

## Explicitly NOT done
- No E2EE or verified provider no-retention audit.
- No user-encrypted local storage in this branch.
- No real Venice API response or billing test.
- No deployment, main merge, production credentials, automatic data transmission, background work, or policy-bypass mechanisms.

Official Venice docs:
- https://docs.venice.ai/api-reference/endpoint/models/list
- https://docs.venice.ai/api-reference/endpoint/chat/completions
