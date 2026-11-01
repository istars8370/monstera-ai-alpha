# MONSTERA AI — Private Alpha Integration

Next.js 15, TypeScript, Neon PostgreSQL/Drizzle, Upstash Redis, OpenRouter and DeepInfra.

**Status:** integration development; not deployed or production-approved. A successful source build does not prove live API connectivity.

## Verified development commands

    corepack enable
    corepack pnpm install --frozen-lockfile
    corepack pnpm typecheck
    corepack pnpm lint
    corepack pnpm test
    corepack pnpm build

GitHub Actions executes these checks. A separate CI job applies committed Drizzle SQL to disposable PostgreSQL 16, checking five tables, constraints, idempotency and rollback. This does not certify Neon production migration.

## Environment configuration

Copy .env.example to .env.local locally, and keep real values out of Git.

- ALPHA_BASIC_USER / ALPHA_BASIC_PASSWORD: temporary alpha access gate, **not user identity**.
- MONSTERA_PUBLIC_ORIGIN: HTTPS outside localhost.
- GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET: Google OAuth Web client. Register redirect URI as origin + /api/auth/google/callback.
- MONSTERA_SESSION_SECRET: at least 32 random UTF-8 bytes; HMAC-authenticated HttpOnly session cookies; session_epoch permits revocation.
- DATABASE_URL: correct Neon environment. Never use a production URL for local tests.
- OPENROUTER_API_KEY / DEEPINFRA_API_KEY: server-side provider keys.
- UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN: required for per-user rate limiting.
- MONSTERA_FREE_CHAT_ENABLED=true: explicit opt-in for enabled zero-price-model alpha chat only. Default disabled.

Even a zero-priced local model can incur upstream provider costs. Set operator-approved usage limits before enabling any real provider.

## Current product behavior

1. Basic Auth protects the private alpha entry point; it is not multi-user authentication.
2. Google OAuth uses state, nonce, PKCE and RSA-signed ID token verification. Verified email locates/creates a users record.
3. Session identity and tier are derived from the server cookie and database, never from user ID or tier fields supplied by the client.
4. /api/models lists enabled models permitted by tier; /api/chat streams with OpenRouter and DeepInfra adapters.
5. The model router only falls back before the first streamed chunk. Requests are size-limited, cancellable and rate-limited in explicitly enabled alpha mode.
6. Conversation content is not intentionally persisted server-side. Browser chat content is stored in **plaintext IndexedDB**, keyed by authenticated user ID. It is not locally encrypted at rest.
7. Application tables: users, credits, usage_ledger, model_registry, sync_blobs. Sync blobs must contain ciphertext from client-side encryption only.

## Release blockers

- Validate the full Google login round-trip and nonproduction Neon user lookup with real credentials.
- Validate real provider responses, per-user rate limits, model access and cancellation.
- Approve credit units/prices, then integrate transactional hold/settlement into the API. Current billing helpers are NOT an enabled or verified paid billing system.
- Seed approved model registry entries; none are automatically enabled by default.
- Review provider data processing, local storage privacy, account isolation and operational monitoring.
- Request explicit approval for main merge, production DB changes, deployment, actual payments and public launch.

See db/migrations and tests for generated SQL and automated test cases.
