# Phase 0 기술 검증 보고서 (1차)

- 작성일: 2026-11-27
- 범위: 기획서 10장 Phase 0의 1~10항
- 상태: **진행 중.** 조사, 검증 도구 제작, 개발 서버(PC 헤드리스 브라우저) 기능 검증까지 했습니다.
  **실제 스마트폰(Android Chrome / iPhone Safari) 측정은 아직 하지 않았습니다.** 이 보고서의 어떤 항목도
  "스마트폰에서 동작 확인"으로 읽으면 안 됩니다(기획서 12-2항).

표기 규칙: **[확인]** 출처 문서나 직접 실행으로 확인함 · **[제조사 주장]** 개발사 발표 수치, 독립 검증 안 됨 ·
**[확실하지 않음]** 근거 부족 · **[추측]** 추론임 · **[미측정]** 실기기 측정 필요

---

## 1. 결론 요약

1. **ZONOS3-Mini는 공식 브라우저(WebGPU) 런타임이 있어 1순위 후보로 유지합니다.** [확인]
   음성 등록은 "임베딩 모드"(192차원 화자 임베딩)로 하면 추가 다운로드가 43 MB뿐이고, 2.6 GB짜리 레퍼런스 인코더가 필요 없습니다. [확인: 공식 README·소스]
2. **iPhone Safari에서 ZONOS3-Mini가 동작하는지는 아직 알 수 없습니다.** 공식 자료는 Pixel 9(Android)와 M3 MacBook Air 수치만 제시합니다. [확실하지 않음]
3. **번역은 Tencent Hy-MT3-1.8B를 품질 1순위 후보로 넣었지만, 브라우저용 ONNX 변환본이 비공식(제3자)이고 크기가 1.07 GB입니다.** TTS와 동시 상주 시 메모리가 관건입니다. [미측정]
   M2M100 418M(MIT)과 NLLB-200 600M(비상업 라이선스)을 비교군으로 둡니다.
4. **ASR은 Whisper(base/small/large-v3-turbo)와 Moonshine(언어별 소형 모델)을 비교합니다.** 발화 버튼으로 언어가 정해지므로 언어 자동 감지가 필요 없고, 이 점이 정확도·속도에 유리합니다.
5. 실기기 측정용 벤치마크 PWA(`bench/`)를 만들었습니다. 외부 전송 감시(서비스워커 차단·기록), 기기 확인, ASR/번역/TTS 개별 측정, 음성 등록, A/B 교대 통합 통역, 결과 내보내기, 데이터 삭제 테스트를 담았습니다.
6. 개발 서버(PC 헤드리스 브라우저)에서 기능 검증: 외부 전송 차단 동작, ZONOS3 공식 엔진으로 4개 언어 합성 성공,
   Whisper/Moonshine 인식, M2M100 12방향 번역을 실행했습니다(8장). 이 시간 수치는 휴대폰 성능이 아닙니다.
7. 목표 지연 시간은 기획서 11장에 따라 **정하지 않았습니다.** 실기기 측정 후 정합니다.

---

## 2. 음성 합성·복제: ZONOS3-Mini

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| 구조 | 희소 MoE, 활성 1억 / 전체 8억 파라미터, 15 Hz 코덱(ZAC-1), 44.1 kHz 출력 | [확인] Zyphra 블로그, GitHub README |
| 가중치 라이선스 | Apache-2.0 | [확인] Hugging Face 모델 카드 `license: apache-2.0` |
| 런타임 라이선스 | MIT (ZONOS3 GitHub 저장소) | [확인] 저장소 LICENSE |
| 언어 | 43개 언어, `ko`, `ja`, `cmn`(표준 중국어), `en_us` 포함 | [확인] 모델 카드, `languages.json` |
| 브라우저 실행 | 공식 `servers/web`: 손으로 짠 WGSL, Web Worker, API를 페이지 안에서 처리(`localFetch`) | [확인] `servers/web/README.md` |
| 속도 | 브라우저 첫 음성까지(TTFA) Pixel 9 570 ms 미만, M3 MacBook Air 150 ms 미만 | [제조사 주장] Zyphra 블로그 |
| iPhone Safari | 공식 문서에 언급 없음 | [확실하지 않음] |
| shader-f16 | 엔진이 요구하지 않음(장치 생성 시 limit만 요구) | [확인] `src/gpu/device.ts` |
| 음성 복제 방식 | ① 원본 클립을 코덱 코드로 넣는 레퍼런스 모드 ② 192차원 MECT-B2 화자 임베딩 모드 | [확인] README |
| 브라우저에서 꺼진 기능 | 텍스트 정규화(숫자·날짜를 읽는 말로 변환), 음성 인식, 발음 사전 | [확인] `servers/web/README.md` 표 |

### 2-1. 다운로드 크기 (Hugging Face API로 2026-11-27 측정, 리비전 `2921b882…`)

| 구성 | 크기 | 필요한 경우 |
| --- | ---: | --- |
| backbone | 643 MB | 항상 |
| zac (코덱 디코더) | 234 MB | 항상 |
| voices (기본 음성 82개 파일) | 21 MB | 엔진 시작 시 |
| spk (화자 인코더) | 43 MB | 임베딩 모드 음성 등록 |
| encoder + teacher | 1,927 + 740 MB | 레퍼런스 모드만 → **사용 안 함** |

→ 이 앱에 필요한 TTS 다운로드는 약 **0.94 GB**입니다. [확인]

### 2-2. 기획서 요구사항과의 대응

- 음성 원본·임베딩 외부 전송 금지: 엔진이 API를 페이지 안에서 처리하므로 네트워크를 타지 않습니다. 빌드된 엔진 파일에서 외부 URL·`sendBeacon`·`WebSocket`·`XMLHttpRequest` 사용이 없음을 확인했습니다. [확인: 빌드 결과물 검사]
- 프로필 저장: 192차원 실수 벡터(약 0.8 KB)만 IndexedDB에 저장합니다. 원본 녹음은 저장하지 않습니다.
- 주의: 엔진은 업로드된 클립을 페이지가 살아 있는 동안 워커 메모리의 "세션 음성"으로 보관합니다. 디스크에 남지는 않지만, Phase 3에서는 임베딩만 남기고 세션 캐시를 비우는 경로를 만들어야 합니다. [확인: `api/speakers.ts`]
- 텍스트 정규화가 꺼져 있어 "3시"·"15,000원" 같은 숫자를 엔진이 제대로 읽지 못할 수 있습니다. 숫자를 읽는 말로 바꾸는 전처리(언어별)가 필요할 수 있습니다. [추측, 실측 필요]
- 스트리밍: `/v2/generate`가 `stream: true`로 float32 PCM 조각을 내보내므로 받는 대로 재생합니다. [확인]

---

## 3. 음성 인식(ASR) 후보

조건: 네 언어, 오프라인, Android·iPhone 브라우저, 외부 전송 없음.

| 후보 | 크기(다운로드) | 라이선스 | 브라우저 실행 경로 | 비고 |
| --- | --- | --- | --- | --- |
| Whisper base (74M) | WebGPU ≈ 140–200 MB / WASM ≈ 75 MB | Apache-2.0 | transformers.js 4.3.2 | 가장 가벼운 다국어 기준선 |
| Whisper small (244M) | WebGPU ≈ 390–560 MB / WASM ≈ 240 MB | Apache-2.0 | transformers.js | |
| Whisper large-v3-turbo (809M) | ≈ 1.2–2.7 GB | Apache-2.0 | transformers.js | 모바일에서 메모리 초과 가능성 [추측] |
| Moonshine base 언어별(ko/ja/zh/en, 61M) | 언어당 ≈ 80–120 MB | ko/ja/zh: `other`, en: MIT | transformers.js | 라이선스 조건 [확실하지 않음] |
| Qwen3-ASR 0.6B | — | Apache-2.0 | transformers.js 4.3.2에 아키텍처 없음(번들 검사), GGUF만 존재 | 브라우저 경로 없음 → 제외(재검토 가능) |
| SenseVoice Small | — | `other`(FunASR 모델 라이선스) | transformers.js 미지원, sherpa-onnx WASM 가능성 | [확실하지 않음] → 2차 후보 |

참고 수치 [제조사 주장, Moonshine 모델 카드]: 한국어 FLEURS CER — Whisper tiny 15.83, Whisper medium 6.99, Moonshine tiny-ko 8.9.

기획서 4-2의 whisper.cpp WASM은 "실시간보다 느릴 수 있다"는 지적대로, WebGPU 가속 경로가 있는 transformers.js(onnxruntime-web)를 우선 비교 대상으로 했습니다. whisper.cpp WASM은 transformers.js 결과가 부족할 때 추가 비교합니다.

---

## 4. 번역 후보

| 후보 | 크기 | 라이선스 | 12개 방향 | 비고 |
| --- | --- | --- | --- | --- |
| **Tencent Hy-MT3-1.8B** (2026-11-24 공개) | q4f16 ONNX ≈ 1.07 GB | Apache-2.0 | 102개 언어, 직접 번역 | 원본은 공식. **ONNX 변환본(`konstbet/Hy-MT3-1.8B-ONNX`)은 제3자 제작**, 업로드 3일, 다운로드 22회. shader-f16 필요 [추측: q4f16] |
| Meta M2M100 418M | q8 ≈ 0.5 GB | MIT | 100개 언어 다대다 직접 번역 | 2020년 모델, 품질은 상대적으로 낮을 가능성 [추측] |
| Meta NLLB-200 distilled 600M | q8 ≈ 0.9 GB | **CC-BY-NC-4.0 (비상업)** | 직접 번역 | 무상 지인 공유 범위에서만 검토 |
| Google TranslateGemma 4B | ≈ 2–3 GB [추측] | Gemma 이용약관, 승인 필요 | | 휴대폰에서 TTS와 동시 상주 어려움 [추측] → 1차 제외 |

- Hy-MT3 제조사 주장: 1.8B 모델이 iFlytek·Microsoft Translator·Qwen-MT-Flash 등 상용 API보다 일반 번역에서 우수. [제조사 주장, 모델 카드]
- 중간 언어(영어) 경유: 벤치 앱에 "영어 경유" 옵션을 넣어 직접 번역과 같은 문장으로 비교합니다(기획서 2-3).
- 품질 평가: 벤치 앱의 10개 대화 문장(4개 언어 병렬)을 12개 방향으로 번역하고, 참조문과 나란히 놓아 사람이 판단합니다. 자동 점수(BLEU 등)는 짧은 대화문에서 신뢰도가 낮아 쓰지 않았습니다.

---

## 5. 브라우저·기기 조건

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| iOS/iPadOS 26 Safari WebGPU | 기본 활성화 | [확인] WebKit "Safari 26.0" 발표, enablegpu.com 안내 |
| Safari 26 WebGPU 안정성 | 구현 문제 보고 있음 | [확실하지 않음] 개발자 커뮤니티 게시글(일화) |
| iPhone 탭당 메모리 한도 | 공개 문서 없음 | [확실하지 않음] → 실측 필수 |
| Android Chrome WebGPU | 지원(기기 GPU에 따라 다름) | [제조사 주장] Pixel 9 수치 |

### 5-1. 메모리 예산 [추측: 다운로드 크기 기준, 실제 GPU 메모리는 다를 수 있음]

| 조합 | TTS | 번역 | ASR | 합계 |
| --- | ---: | ---: | ---: | ---: |
| 가벼운 조합 | 0.94 GB | M2M100 0.5 GB | Moonshine 2개 언어 0.2 GB | 약 1.6 GB |
| 품질 우선 조합 | 0.94 GB | Hy-MT3 1.07 GB | Whisper small 0.4 GB | 약 2.4 GB |

세 모델을 동시에 GPU에 올려야 지연 없이 교대 통역이 됩니다. iPhone에서 2 GB 이상이 버티는지가 Phase 0의 핵심 위험입니다.

---

## 6. 이번에 만든 검증 도구: `bench/` (Phase 0 벤치마크 PWA)

| 탭 | 하는 일 | 대응 항목(기획서 10장) |
| --- | --- | --- |
| 기기 | WebGPU 어댑터·shader-f16·버퍼 한도, WASM SIMD/스레드, 저장 공간·영구 저장, 마이크, Wake Lock | 9장, Phase 0-2/3 |
| 음성인식 | 후보 모델 로드(다운로드 크기·로드 시간·워밍업), 제시문 읽기 → 인식 결과·CER·처리 시간·종료 감지 시간 | 0-5, 0-6 |
| 번역 | 후보별 12개 방향 × N문장 일괄 번역, 직접/영어 경유 비교, 방향별 평균 시간 | 0-7, 0-8 |
| 합성·음성 | ZONOS3-Mini 로드, 4개 언어 합성(첫 음성 시간·RTF), 소유자/상대방(동의 확인) 음성 등록, 프로필 삭제 | 0-1~0-4 |
| 통합 통역 | A/B 큰 버튼, 언어 교환, 방향별 출력 목소리 선택, VAD 자동 종료, 재생 중 마이크 꺼짐, 중단, 단계별 지연 기록 | 6장, 7장, 11장 |
| 네트워크 | 서비스워커가 모든 요청 기록, 외부는 HF GET만 허용·나머지 403 차단, 오프라인 시뮬레이션 | 0-10, 11장 |
| 결과 | 중앙값 요약, JSON 파일 내보내기, 데이터 삭제와 삭제 확인 | 11장 |

외부 전송 감시의 한계: 서비스워커는 WebSocket·WebRTC를 볼 수 없습니다. 앱 코드에 둘 다 없고 페이지 CSP로도 막지만,
최종 확인은 원격 디버깅 네트워크 탭과 비행기 모드 테스트로 교차 검증해야 합니다.

---

## 7. 실기기 측정 절차 (사용자 수행 필요)

준비: `bench/dist`를 HTTPS로 배포(README 참고). Wi-Fi에서 모델을 받은 뒤 측정합니다.

1. **기기 탭**: 판정 결과를 확인하고 "영구 저장 요청"을 누릅니다.
2. **합성·음성 탭**: 엔진 로드(약 0.94 GB) → "4개 언어 연속 테스트"를 2회 실행(첫 회는 셰이더 컴파일 포함).
   TTFA·RTF·발음(특히 숫자)을 확인합니다.
3. 음성 등록: 소유자 음성을 5/8/12/20초로 각각 등록하고 같은 문장을 합성해 닮은 정도를 들어 봅니다 → 녹음 길이 결정.
4. **음성인식 탭**: Whisper base → small → Moonshine 순으로 언어별 제시문 3개씩 읽기.
5. **번역 탭**: M2M100 → Hy-MT3(기기 탭에서 shader-f16 true일 때만) → 필요 시 NLLB. 문장 수 3으로 12개 방향 실행, 영어 경유도 1회.
6. **통합 통역 탭**: 두 사람이 한국어↔일본어 등으로 10턴 이상 교대 대화. 앱이 백그라운드로 가거나 화면이 꺼질 때의 동작도 확인합니다.
7. **오프라인**: 네트워크 탭에서 오프라인 시뮬레이션을 켜거나, 실제 비행기 모드로 6번 반복.
8. **결과 탭**: JSON 내보내기 → 이 저장소 `docs/results/`에 기기명으로 넣어 주시면 분석해 모델 선정과 목표 지연을 확정합니다.
9. 장시간(30분 이상) 통역 시 발열·배터리 감소량을 메모합니다(앱에서 측정 불가).

권장 기기: 최근 Android 1대(가능하면 Pixel 또는 Galaxy S 시리즈), iPhone 1대(iOS 26 이상). 메모리 한계를 보기 위해 구형 기기 1대를 더하면 좋습니다.

---

## 8. 개발 컨테이너 검증 결과 (PC 헤드리스 Chromium)

> 아래는 **스마트폰이 아닌** 개발 서버(리눅스, CPU 4코어, GPU 없음)에서 한 기능 검증입니다. WebGPU는 SwiftShader(CPU 에뮬레이션)여서
> **시간 수치는 휴대폰 성능과 무관하며 참고용으로도 쓰면 안 됩니다.**

환경: Playwright Chromium 158(헤드리스), `vite preview`(localhost), 서비스워커 활성, crossOriginIsolated = true(WASM 4스레드).
마이크는 Chromium 가짜 장치(`--use-file-for-fake-audio-capture`)에 WAV를 넣었습니다. 테스트 음성은 ZONOS3-Mini가 합성한 음성이라
**사람 목소리보다 인식이 쉬울 수 있습니다**(합성음 기준 결과).

### 8-1. 개인정보·네트워크

| 시험 | 결과 |
| --- | --- |
| 서비스워커가 페이지·워커 요청을 가로채는가 | O (첫 방문 후 1회 새로고침으로 제어 시작) |
| Hugging Face로 POST(본문 100 B) 시도 | 서비스워커가 **403 차단** + 기록 |
| 허용 목록 밖 호스트(example.com) GET | 페이지 CSP가 **차단** |
| M2M100 12방향 번역 중 외부 요청 | 모델 다운로드 GET 11건(huggingface.co만), **본문 전송 0건, GET 외 0건** |
| ASR 2회차 이후(모델 캐시됨) | **외부 요청 0건** (Cache Storage에서 로드) |
| 빌드 결과물 내 외부 주소 | `cdn.jsdelivr.net`(transformers.js 기본값 문자열, 실제로는 자체 경로로 덮어씀 + SW·CSP가 차단), 그 외 문서 링크 문자열뿐 |

### 8-2. TTS: ZONOS3-Mini 공식 브라우저 엔진 (SwiftShader WebGPU)

| 항목 | 결과 |
| --- | --- |
| 엔진 초기화(약 0.9 GB 다운로드 포함) | 성공, 460 s (CPU 에뮬레이션 + 다른 시험과 CPU 공유) |
| 4개 언어 합성(`ko`, `ja`, `en_us`, `cmn`, 임베딩 모드, 비스트리밍 WAV) | **4개 모두 HTTP 200, 정상 WAV 생성** (각 2.0–2.9 s 음성) |
| 합성 시간 | 문장당 77–96 s — **SwiftShader라서 의미 없는 수치**. 휴대폰 GPU 실측 필요 |
| 기본 음성 | 27개. 한국어 2(Seoyeon F, Minjun M), 중국어 2, 영어 다수, **일본어 전용 기본 음성 없음** → 일본어는 다른 언어 음성으로 합성(교차 언어) |
| `speaker_modes` | `reference`, `embedding` 둘 다 제공 확인 |
| shader-f16 | SwiftShader 어댑터에 없음에도 동작 → 엔진이 f16을 요구하지 않음을 실행으로 확인 |
| 생성 음성 청취 품질 | **확인 안 함**(컨테이너에 스피커 없음). 대신 아래 ASR로 내용이 맞게 읽혔는지 간접 확인 |

### 8-3. ASR (WASM, PC CPU 4스레드) — 입력: 위 ZONOS 합성음

| 모델 | 언어 | 정답 | 인식 결과 | 처리 시간(음성 길이) |
| --- | --- | --- | --- | --- |
| Whisper base q8 | ko | 역까지 걸어서 얼마나 걸리나요? | 여기까지 걸어서 얼마나 걸리나요? (1어절 오류) | 1.98 s (2.6 s) |
| Whisper base q8 | ja | 駅まで歩いてどのくらいかかりますか？ | 駅まで歩いてどのくらいかかりますか? (정확) | 2.16 s (2.9 s) |
| Whisper base q8 | en | How long does it take to walk to the station? | 동일 (정확) | 1.94 s (2.9 s) |
| Whisper base q8 | zh | 走到车站要多长时间？ | 走到**車**站要多**長時間**。 (내용 정확, **번체자 출력**) | 2.01 s (2.1 s) |
| Moonshine base q8 | zh | 〃 | 走 到 车 站 要 多 长 时 间 (정확, 글자 사이 공백) | 0.85 s |
| Moonshine base q8 | ja | 〃 | 駅まで歩いてどのくらいかかりますか？ (정확) | 0.87 s |
| Moonshine base q8 | ko | 〃 | **"audiotext"** (실패) | 0.33 s |

- 발화 종료 감지: 무음 700 ms 대기 설정에서 743 ms (오디오 프레임 단위 때문).
- Whisper 중국어는 언어를 `chinese`로 고정해도 번체자로 출력 → 간체 변환(예: OpenCC 계열, 라이선스 확인 필요) 또는 다른 모델 필요.
- Moonshine 한국어: Node(onnxruntime-node)에서 같은 음성을 넣으면 q8은 "미역까지 걸어서 얼마나 걸리나요?", fp32는 "audiotext"로
  결과가 실행 환경·정밀도에 따라 달라짐. **원인 미확인 → 현재 한국어에는 쓰기 어려움.**

### 8-4. 번역: M2M100 418M q8 (WASM) — 12개 방향, 문장 1개 ("안녕하세요, 만나서 반갑습니다.")

| 방향 | 출력 | 판정(작성자 의견) |
| --- | --- | --- |
| ko→ja | こんにちは、会ってよかったです。 | 어색함 |
| ko→en | Hello, I am glad to meet. | 어색함 |
| ko→zh | 您好,很高兴见到您。 | 자연스러움 |
| ja→ko | 안녕하세요, 여러분을 만나게 되어 기`<unk>`니다. | **오류**(어휘 누락 `<unk>`, "여러분" 오역) |
| ja→en | Hello, I am glad to see you. | 대체로 맞음 |
| ja→zh | 你好,我很高兴能见到你。 | 자연스러움 |
| en→ko | 안녕하세요, 당신을 만나게 되면 좋습니다. | 어색함 |
| en→ja | こんにちは、あなたに会えるのが素敵です。 | 어색함 |
| en→zh | 好,好,好,… (최대 길이까지 반복, 88.8 s) | **실패**(반복 루프) |
| zh→ko | 안녕하세요, 당신을 만나게 되어 기`<unk>`니다. | **오류**(`<unk>`) |
| zh→ja | こんにちは、あなたに会ってよかったです。 | 어색함 |
| zh→en | Hello, I am glad to see you. | 대체로 맞음 |

- 처리 시간: 문장당 3.3–6.3 s(반복 루프 제외). TTS 시험과 CPU를 나눠 쓴 상태라 **과대 측정**됐을 수 있음.
- 조치: 벤치에 "반복 출력 방지(no_repeat_ngram_size=3)" 옵션을 추가(기본 켬). 이 옵션의 효과는 **아직 재측정하지 않았습니다.**
- 판단: M2M100은 한국어 출력에 `<unk>`가 생기고 존댓말·자연스러움이 부족해, 비교 기준선 이상으로 쓰기 어렵다고 봅니다. [작성자 판단]

### 8-5. 이 환경에서 시험하지 못한 것

- Hy-MT3-1.8B: q4f16 모델이라 shader-f16이 필요한데 SwiftShader 어댑터에 없음 → **미실행**
- NLLB-200, Whisper small / large-v3-turbo: 시간 관계상 미실행
- 음성 등록(임베딩 생성), 통합 A/B 통역 화면, 오프라인 시뮬레이션 전체 흐름: SwiftShader 합성이 문장당 1분 이상이라 미실행
- 모든 WebGPU 속도, 메모리 한도, 발열, 배터리, 백그라운드 동작: 실기기 필요

---

## 9. 미해결 사항 / 위험

1. iPhone Safari에서 ZONOS3-Mini 동작 여부와 메모리 한도 [미측정, 최대 위험]
2. Hy-MT3 ONNX 변환본의 정확성(원본 대비) — 제3자 변환. 품질이 좋으면 직접 변환(공식 도구)해 검증 필요
3. Moonshine 비영어 모델 라이선스 원문 확인 필요 [확실하지 않음]
4. ZONOS 브라우저 엔진의 텍스트 정규화 부재 → 숫자 읽기 전처리 필요 여부 [미측정]
5. 세 엔진(ASR·번역·TTS) 동시 상주 시 GPU 메모리 [미측정]
6. 백그라운드 전환·화면 잠금 시 동작(브라우저 정책상 중단될 가능성 높음 [추측]) → Wake Lock 사용, 화면 유지 안내
7. 모델 최초 다운로드 약 1.6–2.4 GB → 지인 공유 시 Wi-Fi 안내 필요
8. Whisper 중국어 번체자 출력 → 간체 변환 단계 필요 [확인: 8-3]
9. Moonshine 한국어 모델 출력 불안정("audiotext") [확인: 8-3, 원인 미확인]
10. M2M100 품질 부족(`<unk>`, 반복 루프) [확인: 8-4] → Hy-MT3 실기기 검증이 번역 선정의 핵심
11. ZONOS 기본 음성에 일본어 전용 음성 없음 → 소유자 음성 등록이 사실상 필수(기획 방향과 일치)

---

## 10. 출처

- Zyphra, "ZONOS3-Mini" 블로그: https://www.zyphra.com/our-work/zonos3-mini
- ZONOS3-Mini GitHub (README, `servers/web/README.md`, `src/gpu/device.ts`, `src/api/speakers.ts`, 커밋 a50e141): https://github.com/Zyphra/ZONOS3-Mini
- ZONOS3-Mini 모델 카드·파일 목록: https://huggingface.co/Zyphra/ZONOS3-Mini
- Tencent Hy-MT3-1.8B 모델 카드: https://huggingface.co/tencent/Hy-MT3-1.8B
- Hy-MT3 ONNX 변환본(제3자): https://huggingface.co/konstbet/Hy-MT3-1.8B-ONNX
- Moonshine tiny-ko 모델 카드: https://huggingface.co/moonshine-ai/moonshine-tiny-ko
- Qwen3-ASR-0.6B: https://huggingface.co/Qwen/Qwen3-ASR-0.6B
- NLLB-200 distilled 600M: https://huggingface.co/facebook/nllb-200-distilled-600M
- M2M100 418M: https://huggingface.co/facebook/m2m100_418M
- transformers.js 4.3.2 (npm `@huggingface/transformers`, 번들 내 지원 아키텍처 직접 검사)
- WebKit, "WebKit Features in Safari 26.0": https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- enablegpu.com, iOS Safari WebGPU 안내: https://enablegpu.com/guides/ios/
