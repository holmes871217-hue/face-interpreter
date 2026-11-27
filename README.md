# 대면 실시간 음성 통역 PWA

스마트폰 한 대로 두 사람이 교대로 말하는 대면 통역 앱입니다. 음성 인식, 번역, 음성 복제, 음성 합성을 **모두 기기 안에서** 처리합니다.

현재 단계: **Phase 0 (기술 검증)**. 기획서 12-1항("전체 앱을 만들기 전에 Phase 0 기술 검증을 완료한다")에 따라
본 앱(Phase 1~)은 아직 만들지 않았습니다. 지금 저장소에는 실기기 측정용 벤치마크 PWA와 조사 보고서만 있습니다.

| 경로 | 내용 |
| --- | --- |
| `docs/PHASE0_REPORT.md` | 후보 모델 조사(출처 포함), 컨테이너 검증 결과, 실기기 측정 절차, 미해결 사항 |
| `bench/` | Phase 0 벤치마크 PWA (Vite + React + TypeScript) |
| `bench/vendor/zonos3-engine/` | Zyphra 공식 ZONOS3-Mini 브라우저 엔진 빌드본(MIT, 커밋 고정) |

## 벤치마크 앱 실행

```bash
cd bench
npm install
npm run build      # dist/ 생성 (ORT WASM, ZONOS 엔진을 같은 출처로 복사)
npm run preview    # http://localhost:4173
```

스마트폰에서 열려면 **HTTPS**가 필요합니다(마이크·서비스워커·WebGPU 조건).

- Android: PC에서 `adb reverse tcp:4173 tcp:4173` 후 휴대폰 Chrome에서 `http://localhost:4173` (localhost는 보안 컨텍스트로 취급)
- iPhone / Android 공통: `bench/dist/`를 HTTPS 정적 호스팅(GitHub Pages, Cloudflare Pages 등)에 올린 뒤 접속.
  `base: './'`로 빌드되므로 하위 경로(`/<repo>/`)에서도 동작합니다.

자세한 측정 순서는 `docs/PHASE0_REPORT.md` 7장을 보세요.

## 개인정보 원칙 (벤치 앱에도 적용)

- 외부로 나가는 요청은 Hugging Face 공개 모델 파일 GET만 허용. 그 외는 서비스워커가 403으로 차단·기록, 페이지 CSP로 2중 제한
- 회원가입·로그인·분석·광고 SDK·외부 폰트·CDN 스크립트 없음
- 음성 프로필은 192차원 임베딩만 IndexedDB에 저장, 원본 녹음은 저장하지 않음
- 측정 결과는 기기에만 저장, 사용자가 직접 JSON 파일로 내보낼 때만 기기 밖으로 나감
