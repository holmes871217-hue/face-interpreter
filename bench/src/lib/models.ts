/** Candidate model registry for Phase 0. Sizes are download sizes of the files the bench actually fetches,
 *  read from the Hugging Face API on 2026-11-27 (rounded). Licenses as stated on each model card that day. */

export type Device = 'webgpu' | 'wasm';

export interface AsrCandidate {
  id: string;
  label: string;
  kind: 'whisper' | 'moonshine';
  /** Moonshine models are monolingual: one repo per language. */
  repoFor: (lang: string) => string;
  dtype: (device: Device, f16: boolean) => Record<string, string> | string;
  approxMB: string;
  license: string;
  note?: string;
}

export const ASR_CANDIDATES: AsrCandidate[] = [
  {
    id: 'whisper-base', label: 'Whisper base (74M)', kind: 'whisper',
    repoFor: () => 'onnx-community/whisper-base',
    dtype: (d, f16) => d === 'webgpu' ? { encoder_model: f16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' },
    approxMB: 'WebGPU ≈ 140–200 MB / WASM ≈ 75 MB', license: 'Apache-2.0 (OpenAI Whisper)',
  },
  {
    id: 'whisper-small', label: 'Whisper small (244M)', kind: 'whisper',
    repoFor: () => 'onnx-community/whisper-small',
    dtype: (d, f16) => d === 'webgpu' ? { encoder_model: f16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' },
    approxMB: 'WebGPU ≈ 390–560 MB / WASM ≈ 240 MB', license: 'Apache-2.0 (OpenAI Whisper)',
  },
  {
    id: 'whisper-large-v3-turbo', label: 'Whisper large-v3-turbo (809M)', kind: 'whisper',
    repoFor: () => 'onnx-community/whisper-large-v3-turbo',
    dtype: (d, f16) => d === 'webgpu' ? { encoder_model: f16 ? 'fp16' : 'fp32', decoder_model_merged: f16 ? 'q4f16' : 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' },
    approxMB: 'WebGPU ≈ 1.2–2.7 GB', license: 'Apache-2.0 (OpenAI Whisper)', note: '모바일에서는 메모리 초과 가능성 높음(실측 필요)',
  },
  {
    id: 'moonshine-base', label: 'Moonshine base (언어별 61M)', kind: 'moonshine',
    repoFor: lang => lang === 'en' ? 'onnx-community/moonshine-base-ONNX' : `onnx-community/moonshine-base-${lang}-ONNX`,
    dtype: (d, f16) => d === 'webgpu' ? { encoder_model: f16 ? 'fp16' : 'fp32', decoder_model_merged: f16 ? 'q4f16' : 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' },
    approxMB: '언어당 ≈ 80–120 MB', license: 'ko/ja/zh: "other"(Moonshine 커뮤니티 라이선스로 추정, 확실하지 않음) / en: MIT',
    note: '언어 전환 시 해당 언어 모델을 별도 로드',
  },
];

export interface MtCandidate {
  id: string;
  label: string;
  kind: 'seq2seq-m2m' | 'seq2seq-nllb' | 'hymt';
  repo: string;
  dtype: (device: Device, f16: boolean) => Record<string, string> | string;
  devices: Device[];
  approxMB: string;
  license: string;
  note?: string;
}

export const MT_CANDIDATES: MtCandidate[] = [
  {
    id: 'hymt3-1.8b', label: 'Tencent Hy-MT3-1.8B (q4f16, 제3자 ONNX 변환)', kind: 'hymt',
    repo: 'konstbet/Hy-MT3-1.8B-ONNX', dtype: () => 'q4f16', devices: ['webgpu'],
    approxMB: '≈ 1.07 GB', license: 'Apache-2.0 (원본 tencent/Hy-MT3-1.8B)',
    note: 'ONNX 변환본은 공식이 아님(2026-11-24 업로드, 다운로드 수 매우 적음). shader-f16 필요.',
  },
  {
    id: 'm2m100-418m', label: 'Meta M2M100 418M', kind: 'seq2seq-m2m',
    repo: 'Xenova/m2m100_418M',
    dtype: (d, f16) => d === 'webgpu' && f16 ? { encoder_model: 'fp16', decoder_model_merged: 'q4f16' } : { encoder_model: 'q8', decoder_model_merged: 'q8' },
    devices: ['webgpu', 'wasm'], approxMB: 'q8 ≈ 0.5 GB / fp16+q4f16 ≈ 0.6 GB', license: 'MIT',
  },
  {
    id: 'nllb-600m', label: 'Meta NLLB-200 distilled 600M', kind: 'seq2seq-nllb',
    repo: 'Xenova/nllb-200-distilled-600M',
    dtype: (d, f16) => d === 'webgpu' && f16 ? { encoder_model: 'fp16', decoder_model_merged: 'q4f16' } : { encoder_model: 'q8', decoder_model_merged: 'q8' },
    devices: ['webgpu', 'wasm'], approxMB: 'q8 ≈ 0.9 GB', license: 'CC-BY-NC-4.0 (비상업적 이용만 허용)',
    note: '비상업 라이선스: 지인 공유(무상) 범위에서만 검토',
  },
];

/** ZONOS3-Mini web weights, pinned to the Hugging Face revision checked on 2026-11-27. */
export const ZONOS_REVISION = '2921b8821772b0bd10a04456863d21abf9d2f283';
export const ZONOS_BASE = `https://huggingface.co/Zyphra/ZONOS3-Mini/resolve/${ZONOS_REVISION}/web/`;
export const ZONOS_SIZES_MB = { backbone: 643, zac: 234, spk: 43, voices: 21, encoder_reference_mode: 1927, teacher_reference_mode: 740 };
