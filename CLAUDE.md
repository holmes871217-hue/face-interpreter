# face-interpreter: 작업 안내 (새 세션은 이 파일부터)

대면 실시간 음성 통역 PWA. 스마트폰 한 대로 두 사람이 교대로 말하고, ASR·번역·음성복제·TTS를 **모두 기기 안에서** 처리한다.

- 요구사항 원문: `docs/SPEC.md` (소유자 작성, 기준 문서. 임의로 바꾸지 말 것)
- 지금 어디까지 했나 / 다음 할 일: `docs/STATUS.md` ← **작업 시작 전에 반드시 읽고, 끝나면 갱신**
- 조사·측정 기록과 출처: `docs/PHASE0_REPORT.md`

## 소유자와 일하는 방식

- 소유자는 주로 **휴대폰(Claude 앱)**으로 대화하고, 갤럭시 S22 울트라 크롬에서 직접 검수한다. 터미널·PC가 없다고 가정한다.
- 답변은 **쉬운 한국어로 짧게**. 기술 용어는 풀어서 설명한다. 소유자에게 명령어 실행을 시키지 않는다.
- 근거 없는 내용은 지어내지 말고 "알 수 없음 / 확실하지 않음 / 추측"으로 표시한다. 수치는 실측이나 출처로만 말한다.
- 휴대폰에서 실제로 확인하지 않은 기능을 "된다"고 보고하지 않는다(SPEC 12-2항).
- 소유자에게 측정을 부탁할 때는 "어느 탭 → 어느 버튼 → 무엇을 캡처"까지 순서대로 적는다.

## 검수 흐름 (클라우드에서 수정 → 휴대폰 확인)

1. 코드를 고친다(`bench/`).
2. `cd bench && npm ci && npm run build`로 타입검사·빌드가 통과하는지 확인한다.
3. `main`에 커밋·푸시하면 GitHub Actions(`.github/workflows/pages.yml`)가 자동 빌드·배포한다.
   배포 확인: `gh api repos/holmes871217-hue/face-interpreter/actions/runs --jq '.workflow_runs[0] | "\(.status) \(.conclusion)"'`
4. 배포 주소: **https://holmes871217-hue.github.io/face-interpreter/**
   소유자에게 "크롬에서 새로고침 후 ○○ 탭"으로 안내한다(서비스워커가 앱 파일을 네트워크 우선으로 받으므로 새로고침이면 새 버전).
5. 결과를 `docs/STATUS.md`와 `docs/PHASE0_REPORT.md`에 기록하고 커밋한다.

GitHub Pages 설정 변경 API는 이 클라우드 환경에서 막혀 있다(이미 켜져 있음). 저장소 설정이 필요하면 소유자에게 화면 순서로 안내한다.

## 절대 원칙 (SPEC 3장)

- 음성·임베딩·대화·번역문을 외부로 보내지 않는다. 외부 AI API(OpenAI, Google 번역, ElevenLabs 등), 인증, 분석·광고 SDK, 외부 CDN 스크립트·폰트 금지.
- 외부 접속은 Hugging Face 공개 모델 파일 GET만 허용. `bench/public/sw.js`(서비스워커 차단·기록)와 `bench/index.html` CSP를 약화시키지 말 것.
- onnxruntime WASM과 ZONOS 엔진은 같은 출처에서 서빙한다(`bench/scripts/copy-assets.mjs`).

## 코드 구조 (`bench/`, Phase 0 벤치마크 PWA)

| 경로 | 내용 |
| --- | --- |
| `src/lib/tts.ts` | ZONOS3-Mini 공식 브라우저 엔진 래퍼(`localFetch`로 페이지 안에서 API 처리), LACI, 길이 상한, 언어별 기본 음성, 음량·끊김 측정 |
| `src/lib/audio.ts` | 마이크 캡처, 에너지 VAD, 리샘플, WAV, 지터 버퍼 재생기 |
| `src/lib/engines.ts`, `src/workers/*` | transformers.js 4.3.2 기반 ASR(Whisper, Moonshine)·번역(Hy-MT3, M2M100, NLLB) 워커 |
| `src/lib/models.ts` | 후보 모델 목록·크기·라이선스, ZONOS 리비전 고정 |
| `src/lib/net.ts`, `public/sw.js` | 외부 전송 감시·차단 |
| `src/lib/db.ts` | IndexedDB(음성 임베딩, 측정 결과), 전체 삭제 |
| `src/panels/*` | 탭 화면: 기기, 음성인식, 번역, 합성·음성, 통합 통역, 네트워크, 결과 |
| `vendor/zonos3-engine/` | Zyphra 공식 엔진 빌드본(MIT, 커밋 a50e141). 직접 수정 금지, 갱신 방법은 `SOURCE.md` |

## 개발 서버에서 검증하는 법 (GPU·마이크 없음)

- `npm run preview` 후 Playwright Chromium으로 연다. WebGPU는 `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`로 켜지지만 CPU 에뮬레이션이라 **속도 수치는 의미 없음**(합성 1문장 1~3분), shader-f16 없음.
- 가짜 마이크: `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<16bit wav>` (앞 1초·뒤 3초 무음 패딩해야 VAD가 동작).
