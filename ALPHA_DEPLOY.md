# MONSTERA AI — 개인 PC 실행

현재 개발 브랜치: `feat/venice-private-alpha-20261104` (Draft PR #10).
병합·배포·실제 유료 호출은 승인 대기입니다. 아래 데모는 비용 없이 UI를 확인합니다.

## API 키 없이 오프라인 데모

Node.js 22와 pnpm 9.15.9가 필요합니다. 저장소를 받은 뒤 실행합니다.

```bash
git switch feat/venice-private-alpha-20261104
corepack pnpm install --frozen-lockfile
corepack pnpm demo
```

브라우저에서 http://127.0.0.1:3000 을 열고 `demo` / `demo-local-only`로 로그인합니다.
모델 이름과 응답에 “오프라인 데모 / 실제 AI 아님”이 표시됩니다. 답변은 고정 Mock 텍스트입니다.
모델 전환, 스트리밍, 중단, 현재 대화 비우기, 새로고침을 확인할 수 있습니다.
종료는 터미널에서 Ctrl+C입니다. 다른 프로그램이 3000 포트를 쓰면 먼저 종료하세요.

데모는 127.0.0.1에만 바인딩합니다. 더미 키로 설정을 덮어쓰며, 별도 preload가 Venice 요청을 가로채고 다른 외부 fetch를 차단합니다. 이 preload는 실제 앱에서 가져오지 않습니다. 데모 계정으로 외부 서비스를 열지 마세요.

## 로컬 검증

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test:privacy
corepack pnpm build
# 선택: Chromium을 설치한 QA 환경에서 브라우저 통합 테스트
corepack pnpm exec playwright install --with-deps chromium
corepack pnpm test:browser
```

## 실제 Venice 사용 — 유료 API 승인 후에만

`.env.example`을 `.env.local`로 복사하고 로컬에서 직접 입력합니다. 실제 키·비밀번호를 채팅이나 Git에 올리지 않습니다.

```dotenv
ALPHA_BASIC_USER=your-local-name
ALPHA_BASIC_PASSWORD=replace-with-a-long-random-password
ALPHA_CHAT_PROVIDER=venice
VENICE_API_KEY=your-approved-key
VENICE_PRIVATE_MODEL_ID=exact-current-private-text-model-id
VENICE_PRIVATE_MODEL_IDS=
NEXT_TELEMETRY_DISABLED=1
```

여러 모델은 `VENICE_PRIVATE_MODEL_IDS=id1,id2`로 허용 목록을 설정합니다. 값이 있으면 단일 ID보다 우선합니다. 모델 ID는 현재 Venice 문서·계정에서 확인하세요. 카탈로그에서 Private로 확인되지 않으면 요청은 차단됩니다.

승인 후 `corepack pnpm dev --hostname 127.0.0.1`로 시작합니다. 실제 모드는 API 요금이 발생합니다. 응답은 최대 1,024토큰, 프로세스당 분당 10회/동시 2회로 제한하지만, 정확한 지출 한도는 공급업체 계정에서 별도로 설정해야 합니다.

OpenRouter는 `ALPHA_CHAT_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, `ALPHA_MODEL_ID`를 명시한 경우에만 사용합니다. 이는 Venice Private와 다른 공급업체 정책이며 UI에 표시됩니다. 실패 시 공급업체를 자동 변경하지 않습니다.

## 현재 제한

대화 저장은 꺼져 있고 새로고침하면 현재 대화가 사라집니다. 이전 기기 기록은 자동으로 읽거나 삭제하지 않습니다. 암호화 저장·계정 격리·실제 유료 연결은 아직 완료되지 않았습니다. Private는 E2EE/TEE/로컬 실행을 뜻하지 않습니다. Stripe·크레딧·Neon·Redis 및 운영 데이터 마이그레이션은 사용하지 않습니다.

배포 절차는 이번 작업 범위가 아닙니다. 외부 공개 또는 운영 배포 전에 별도 승인이 필요합니다.
