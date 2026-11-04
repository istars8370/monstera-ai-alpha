# Creative Studio migration map (Stage 0)

Source: `istars8370/shah-cat@024a8e8f` (`feature/creative-studio-scc-v0-1-20261031`, head of stacked PR #99 -> #101 -> #103).
Destination base: `istars8370/monstera-ai-alpha@d06f5576` (`integration/t1-t12`). No changes to `main`.

| 원본 경로 | 대상 경로 | 처리(그대로/변형/폐기/신규) | 근거 |
| --- | --- | --- | --- |
| `creative-studio/studio.html`, `studio.js`, `studio.css` | `app/studio/`, `components/studio/` | 변형 | 정적 브라우저 UI를 Next 15 App Router와 기존 Tailwind 토큰으로 교체, 한국어 유지 |
| `creative-studio/server.mjs` | `app/api/studio/**/route.ts`, `lib/studio/` | 변형 | 실제 구현은 `node:http`의 raw HTTP, 127.0.0.1 단일 운영자·프로세스 메모리 기반 |
| `creative-studio/workflow.mjs` | `lib/studio/workflow.ts` | 변형 | 순수 브리프 검증·검수 체크·승인 상태전이 보존, 사용자별 서버 저장 |
| `creative-studio/text-provider-adapter.mjs`, `server.mjs`의 OpenAI 함수 | `lib/providers/openai.ts`, `lib/model-registry.ts` | 변형 | 현재 레거시 직접호출은 mock transport만 허용; 실 생성은 레지스트리/세션/예약 경유 |
| `creative-studio/scc-*.mjs` (ledger/gateway/durable/bridge/reconciliation/pricing 등) | `lib/billing.ts`, `db/schema.ts` | 폐기 | 자체 SQLite SCC 원장은 복사하지 않음. 기존 PostgreSQL `credits`/`usage_ledger` 호출 |
| `creative-studio/local-access-v13.mjs`, `scc-studio-local-demo.mjs`, `scc-ops-cli.mjs` | 없음 | 폐기 | localhost 전용 접근·데모·CLI 제거 |
| `creative-studio/*.test.mjs` | `tests/studio.*.test.mjs` | 변형 | raw HTTP/SQLite 의존 테스트 대신 세션·Next API·PostgreSQL mock 규격 검증 |
| `.github/workflows/creative-studio.yml` | `.github/workflows/ci.yml` 또는 `integration.yml` | 변형 | 별도 Node 워크플로 중복 없이 기존 CI에 통합 |
| `docs/business/creative-studio-pilot.md` | `docs/business/creative-studio-pilot.md` | 그대로 | 원본 30일 외부 고객 실험 문서, 실제 매출/고객 증명 아님 |
| `docs/business/creative-studio-orders.template.csv` | `docs/business/creative-studio-orders.template.csv` | 그대로 | 헤더만 있는 공개 템플릿, 실제 주문 데이터 이동 금지 |
| 없음 | `db/schema.ts`의 `studio_orders` | 신규 | KRW·노무·환불 업무 원장을 서비스 크레딧과 분리 |
| 없음 | `db/schema.ts`의 `jobs`, `wallet_grants`, 모달리티 잔액 | 신규 | 장기 비동기 작업/일일 멱등 지급/텍스트·이미지·영상 예약 |
| 없음 | `app/api/studio/**`, `app/studio/**` 인증·티어 게이트 | 신규 | 기존 `authenticatedUser(request)`로 identity/tier를 서버 DB에서 확정 |
| 없음 | `lib/studio/quote.ts` | 신규 | 정수 KRW·정수 분 기준 순수 견적 계산 및 경계값 테스트 |

## Verified details, conflicts, and assumptions
- Source has standalone `creative-studio/server.mjs`, `studio.html`, `studio.css`, `studio.js`; the server begins `import http from 'node:http'`. It is not a Next.js app.
- Source test suite uses `creative-studio/*.test.mjs`, including `server.test.mjs`, `scc-durable.test.mjs`, `scc-http-idempotency.integration.test.mjs`, `scc-gateway.durable.test.mjs`; original CI executes `node --test creative-studio/*.test.mjs` and explicitly unsets OPENAI_API_KEY, OPENAI_MODEL and CREATIVE_STUDIO_MODE.
- Source environment names found: `CREATIVE_STUDIO_PORT`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `CREATIVE_STUDIO_MODE`, `CREATIVE_STUDIO_SYNTHETIC_TEXT`. Before production implementation, inspect remaining source and use only safe adapter configuration.
- Destination `lib/billing.ts` exports `holdCredits(input)`, **not** the requested `holdCredits(input, ttlSeconds)`. Integrate TTL using the already-defined input contract after checking implementation, without rewriting billing.
- Destination `lib/router.ts` defines `tierRank` but does **not export** it. A minimal export is required for the requested tier gate.
- Destination `middleware.ts` currently applies Basic alpha auth to all routes; Studio needs session auth in page/API handlers **in addition** to that wrapper, with no open bypass.
- Original pilot document requires extra order fields `labor_rate_krw`, `fee_krw`, `conflict_declared`, and `consent_recorded` beyond the user's abbreviated list. Preserve these in the business-order model where appropriate.
- `usage_ledger` already enforces nonnegative reservation/settlement and settled <= reserved; `sync_blobs` limits ciphertext to 1 MiB. Keep these constraints.
- **No live provider requests, payments, deployments, or merges allowed.** A passing unit suite is not proof of real production operation.

## Execution checkpoints
0. Repository audit and this map; 1. App Router UI+logic; 2. session/tier; 3. modular credits, jobs and generated SQL migration; 4. order ledger+quote; 5. model-registry provider; 6. offline tests+CI; 7. only **after** destination PR merge, follow-up `shah-cat` cleanup PR.

## Stage-0 audit verification
- GitHub repository trees read from `shah-cat@49f5303e` and `monstera-ai-alpha@dc7aa4b8`.
- Source `docs/business/creative-studio-pilot.md` and `.github/workflows/creative-studio.yml` read in full.
- This is a **mapping-only commit**. No generated code was tested yet.
