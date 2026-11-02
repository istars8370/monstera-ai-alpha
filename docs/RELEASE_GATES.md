# MONSTERA AI — Release Gates

> **이 문서가 유일한 게이트 기준이며, 갱신은 제자리에서 한다. 버전 파일을 새로 만들지 않는다.**

## 현재 상태

기준 브랜치는 \`integration/t1-t12\`이며 Draft PR #2가 열려 있다. 가장 최근 검증이 완료된 기준점은 \`0d0f9d7abab59131127e03980988d1274fc186ed\`로, 일반 CI 성공, 모의 단위·통합 테스트 64/64, 실제 Chromium으로 수행한 **모의 외부 연동** 테스트 9/9 및 격리 통합 CI 6/6 성공이 확인되었다. 이후 v2.0 커밋 \`d06f557603e5c2aad0e350f03925dc8c0e4f6533\`의 일반/통합 CI는 확인 당시 **대기 중(성공 미확정)**이었다. Google·Neon·Upstash·OpenRouter·DeepInfra 실연동, 실제 공급자 지출 상한, 유료 과금 및 배포는 검증하거나 승인하지 않았다. 문서 전용 PR의 자체 검증은 별도로 보고한다. 현재 분류는 **Development Verified**이며 **Staging Verified / Private Alpha Ready / Paid MVP Ready / Production Approved 모두 미도달**이다.

## G1–G10 릴리스 게이트

| 게이트 | 판정 | 남은 증거 |
| --- | --- | --- |
| G1 — Build | PASS (검증된 기준점 한정) | 새로운 HEAD에서 고정 설치·타입·Lint·테스트·프로덕션 빌드 확인 |
| G2 — Database | PARTIAL | 폐기용 PostgreSQL 마이그레이션·트랜잭션·백업 복원 성공; 실제 비운영 Neon 소유권과 연결 미확인 |
| G3 — Identity | PARTIAL | 모의 Google OIDC, 서명 세션 및 사용자 분리 검증; 실제 Google 로그인·Neon 연동 미확인 |
| G4 — Chat | PARTIAL | 모의 공급자 SSE·중단·라우팅 검증; 실제 공급자 스트림 미검증 |
| G5 — Providers | BLOCKED | 공급자 테스트 키, 강제 USD 한도 검증, 실호출 예산 명시 및 승인 필요 |
| G6 — Cost Control | PARTIAL | Redis 원자적 횟수 제한과 **예상** USD-micro 예약 검증; 실제 공급자 청구액 상한 미확인 |
| G7 — Billing | PARTIAL | 모의/폐기 DB 크레딧 예약·정산·회수 검증; 가격·환율·환불·실사용량 정책과 채팅 결합 미완료 |
| G8 — Security | PARTIAL | OAuth/CSRF/계정 격리 보강; 평문 IndexedDB, 다중 탭, 전체 보안 감사 필요 |
| G9 — Browser | PASS (MOCK 범위 한정) | 실제 Chromium 9개 모의 외부 연동 테스트 성공; 실 Google/Neon/AI E2E 미검증 |
| G10 — Operations | PARTIAL | 고정 Docker 이미지·격리 DB 백업/복구 성공; 실서비스 모니터링·경보·롤백·배포 미검증 |

**출시 분류:** Development Verified. Private Alpha, Paid MVP, Production은 모두 승인되지 않았다. 모의 또는 격리 테스트의 PASS를 LIVE STAGING PASS로 바꾸지 않는다. 새 커밋마다 최신 SHA의 CI 결과를 재확인한다.

## 운영자 차단 해제 절차

1. **Google:** 비운영 OAuth Web 클라이언트, 허용된 테스트 계정, 공개 HTTPS Origin과 정확한 \`/api/auth/google/callback\`을 확인한다. 테스트 계정 생성·로그인은 별도 승인한다.
2. **Neon:** 실제 비운영 프로젝트·브랜치·DB명을 확인한다. \`MONSTERA_STAGING_ONLY\`는 선언일 뿐 소유권 증명이 아니다. 읽기 전용 접속 승인과 마이그레이션/쓰기 승인을 분리한다.
3. **Upstash:** 전용 비운영 인스턴스·네임스페이스 및 TTL/읽기/쓰기 테스트 범위를 확인한다. 운영 키와 공유하지 않는다.
4. **OpenRouter / DeepInfra:** 해당 계정·키에서 강제되는 USD 지출 한도를 **별도로 검증**한다. 자동 재충전, 동시 요청, 플랫폼 수수료, 리셋 정책을 확인하고 최대 허용 소액 테스트 비용을 승인받는다.
5. **실증:** 앞선 조건이 모두 충족되면 승인된 범위에서 Google → Neon → Upstash → 모델 → SSE → 브라우저를 검증한다. 실제 모델 비용과 내부 추정치를 대사한다. API 키·토큰·프롬프트를 PR/로그에 기록하지 않는다.
6. **정책:** 1크레딧 단위, 모델별 입력·출력 가격, 환율·반올림, 실패·취소·사용량 누락, 만료 회수·환불·분쟁 해결 및 실제 비용 대사 원칙을 운영자가 결정한다. 그 전에는 **유료 크레딧 차감을 활성화하지 않는다**.

공급자 문서는 계정 설정의 증거가 아니다. 관련 안내:
[OpenRouter API key limits](https://openrouter.ai/docs/api/api-reference/api-keys/update-keys),
[OpenRouter guardrails](https://openrouter.ai/docs/guides/features/guardrails/overview),
[DeepInfra pricing](https://deepinfra.com/pricing).
무료 알파는 사용자에게 무료여도 공급자 호출 비용이 발생할 수 있다.

## Staging 체크리스트

- \`ALPHA_BASIC_USER\` / \`ALPHA_BASIC_PASSWORD\`: 알파 접근문, 계정 인증 수단 아님.
- \`MONSTERA_PUBLIC_ORIGIN\`: 비운영 HTTPS URL. \`MONSTERA_EXPECTED_GOOGLE_REDIRECT_URI\`: 정확히 같은 HTTPS Origin의 Google 콜백.
- \`GOOGLE_CLIENT_ID\` / \`GOOGLE_CLIENT_SECRET\`: 전용 Web OAuth 클라이언트의 서버 전용 값.
- \`MONSTERA_SESSION_SECRET\`: 32바이트 이상, 승인 없이 교체하지 않음.
- \`DATABASE_URL\`: 별도 Neon 비운영 DB + TLS. \`MONSTERA_STAGING_ONLY=true\`, \`MONSTERA_EXPECTED_TEST_DB_NAME\`은 추가 선언에 불과함.
- \`UPSTASH_REDIS_REST_URL\` / \`UPSTASH_REDIS_REST_TOKEN\` 및 고유 \`MONSTERA_REDIS_NAMESPACE\`: 환경 분리.
- \`MONSTERA_ALPHA_APPROVED_MODELS\`, \`MONSTERA_ALPHA_PROVIDER_PRICES_JSON\`: 검토된 공급자/모델 일치 및 가격 스냅샷(기한 7일), 입력 토큰 한도 25,000 이상, 출력 1,024 이상.
- \`MONSTERA_ALPHA_DAILY_REQUEST_CAP\`: 요청 횟수 제한. \`MONSTERA_ALPHA_ESTIMATED_MICRO_USD_PER_DAY\`: 예상 금액 예약 한도이며 실제 청구 상한 아님.
- \`MONSTERA_PROVIDER_SPENDING_LIMIT_CONFIRMED\`: 실제 공급자 계정의 강제 지출 제한 검증 전에는 false.
- \`MONSTERA_FREE_CHAT_ENABLED\`: 실비용 승인·제한 전에는 false.
- \`OPENROUTER_API_KEY\` / \`DEEPINFRA_API_KEY\`: 서버 전용, 승인된 비운영 키만 사용.
- \`node scripts/preflight.mjs\`: **오프라인 문법·누락 점검만**, 실제 서비스 연결·금액 상한 검증 아님.

테스트 명령(의존성 설치 가능한 환경에서 실행):
\`\`\`sh
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
\`\`\`
통합 CI는 실제 localhost HTTP, 외부 API를 모의 처리하는 Chromium, 폐기용 PostgreSQL 16·Redis 7 및 비루트 Docker 빌드를 검사한다.

## 인시던트 대응 러닝북

1. **안전 차단:** 승인된 테스트 환경에서만 \`MONSTERA_FREE_CHAT_ENABLED=false\`로 추가 AI 호출을 차단한다. 실제 공급자 계정의 한도를 독립적으로 확인한다.
2. **기록:** 요청 ID, 모델, 사건 시각, 요금·장부 상태 등의 비민감 메타데이터만 보존한다. 시크릿과 원문 프롬프트는 로깅하지 않는다.
3. **정산:** \`held / settled / reclaimed\` 상태와 잔액을 대사한다. 부정확한 사용량이 있으면 임의로 청구하지 않고 수동 검토한다.
4. **DB 복구:** 폐기용 DB에서 \`pg_dump\`→별도 DB 복원→5개 테이블·장부·제약조건을 검증한 이력이 있다. **실 Neon/운영 복구 증거는 아니다.** 운영 백업/복원은 별도 승인 필요.
5. **컨테이너:** 이전 이미지 다이제스트를 보존하고 승인된 롤백 절차를 따른다. 자동 DB 롤백은 금지한다.
6. **계정 및 개인정보:** Google \`sub\`, \`session_epoch\`, 크레딧 권한, 브라우저 IndexedDB(현재 **평문**) 및 다중 탭 기록 노출을 검토한다. 로그아웃은 로컬 기록을 자동 삭제하지 않는다.
7. **재개:** 비용·데이터·개인정보 사건을 해결하고 운영자가 단계별로 승인할 때만 Staging/출시 게이트 재평가.

금지: 명시적 승인 없는 \`main\` 병합, Fly 배포, 운영 DB 변경, 공급자 유료 호출, Stripe, 유료 크레딧 차감, 키 회전, 공개 출시.

## 검증 이력 (기록 보존)

아래는 **각 시점의** 결과이다. 최신 브랜치 HEAD의 검증 결과로 대체하여 주장하지 않는다.

- **v1.6** — 고정 설치·타입·Lint·단위·DB/Redis/HTTP: [41307204146](https://github.com/istars8370/monstera-ai-alpha/actions/runs/41307204146).
- **v1.7 초기** — Chromium 모의 브라우저 5건: [41317293932](https://github.com/istars8370/monstera-ai-alpha/actions/runs/41317293932).
- **v1.7** — 커밋 \`7121318\`; 단위·모의 53/53, Chromium 6/6, 로컬 HTTP 5/5, 통합 6/6: [통합 41317962042](https://github.com/istars8370/monstera-ai-alpha/actions/runs/41317962042), [CI 41317965474](https://github.com/istars8370/monstera-ai-alpha/actions/runs/41317965474).
- **v1.8 중간** — \`abe5fc1\`; 단위·모의 63/63, Chromium 모의 7/7, 통합 6/6: [CI 41320237231](https://github.com/istars8370/monstera-ai-alpha/actions/runs/41320237231), [통합 41320232394](https://github.com/istars8370/monstera-ai-alpha/actions/runs/41320232394).
- **v1.8 최종** — \`bd2f1ab\`: [CI 41320482763](https://github.com/istars8370/monstera-ai-alpha/actions/runs/41320482763), [통합 41320478401](https://github.com/istars8370/monstera-ai-alpha/actions/runs/41320478401), 모두 성공.
- **v1.9 중간** — \`2e13d7f\`; 64/64 단위·모의, 9/9 Chromium 모의, 통합 6/6: [CI 41323290412](https://github.com/istars8370/monstera-ai-alpha/actions/runs/41323290412), [통합 41323287574](https://github.com/istars8370/monstera-ai-alpha/actions/runs/41323287574).
- **v1.9 최종** — \`0d0f9d7\`; [CI 41323485219](https://github.com/istars8370/monstera-ai-alpha/actions/runs/41323485219), [통합 41323481785](https://github.com/istars8370/monstera-ai-alpha/actions/runs/41323481785), 모두 성공.
- **v2.0** — \`d06f557\`; 다음 두 런은 최종 확인 당시 **queued / PASS 미확정**: [CI 41388795431](https://github.com/istars8370/monstera-ai-alpha/actions/runs/41388795431), [통합 41388790509](https://github.com/istars8370/monstera-ai-alpha/actions/runs/41388790509).

이력 문서의 원문은 [archive](archive/)에 Git 기록과 함께 보관한다. 새 버전 릴리스 게이트 파일은 생성하지 않는다.
