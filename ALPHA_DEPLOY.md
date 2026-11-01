# MONSTERA AI Alpha 0.1 (비공개 시험)

- 기존 T1~T12 기능을 모두 병합하지 않는다. T1 기반의 독립적 채팅 MVP이다.
- Stripe, 크레딧, Neon, Redis, ComfyUI, 서버 동기화는 **비활성화**.
- 비공개 접근은 Basic 인증(HTTPS 필수). 공유 링크만으로 접근할 수 없지만 전문 IAM/SSO 대체는 아니다.
- 원문은 서버 DB/로그에 저장하지 않는다. 요청은 OpenRouter에 전달되며 제공업체 정책이 적용된다.
- 대화는 IndexedDB에 **평문**으로 저장된다. 공용 기기/민감 대화에는 사용하지 않는다.

## 실행

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

`.env.local`에 ALPHA_BASIC_USER, ALPHA_BASIC_PASSWORD, OPENROUTER_API_KEY, ALPHA_MODEL_ID를 설정한다.

## Fly 배포 (사용자 Fly 계정 필요)

```bash
fly auth login
fly apps create YOUR_UNIQUE_APP_NAME
# fly.toml app을 YOUR_UNIQUE_APP_NAME으로 변경
fly secrets set ALPHA_BASIC_USER=alpha ALPHA_BASIC_PASSWORD='STRONG_RANDOM_PASSWORD' OPENROUTER_API_KEY='YOUR_KEY' ALPHA_MODEL_ID='YOUR_OPENROUTER_MODEL_ID'
fly deploy
curl -i https://YOUR_UNIQUE_APP_NAME.fly.dev/api/health
curl -i https://YOUR_UNIQUE_APP_NAME.fly.dev/
```

예상: /api/health 200, / 인증 없이 401, 올바른 Basic 인증 시 200.
비용: Fly Machine 및 OpenRouter 사용량에 따라 청구될 수 있다.

## 주의

- 결제 기능을 비활성화했으므로 **릴리스 마이그레이션도 실행하지 않는다**.
- 앱 레벨 사용량 제한/쿼터는 아직 없다. 외부에 인증 정보를 공유하지 말고 OpenRouter 계정의 지출 한도를 설정한다.
- 프로세스 실행/모델 스트리밍/실제 Fly 배포는 별도로 검증해야 한다.
