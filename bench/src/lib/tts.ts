/** ZONOS3-Mini through its official in-browser engine (WebGPU, Web Worker). The engine serves its HTTP-shaped API
 *  in-process via `localFetch`: requests to /v2/* never touch the network. */
import { CODES, type Lang } from '../data/languages';
import { audioContext, StreamPlayer } from './audio';
import { ZONOS_BASE } from './models';

interface EngineModule {
  engine: {
    init(progress: (p: { models: string[]; loaded: number; total: number; fetched: number }) => void, opts?: { base?: string; cache?: boolean }): Promise<void>;
    onFatal(cb: (m: string) => void): void;
    onEncoderProgress(cb: (p: { models: string[]; loaded: number; total: number; fetched: number }) => void): void;
  };
  localFetch(input: string, init?: RequestInit): Promise<Response>;
}

export const SAMPLE_RATE = 44100;
const SESSION = 'bench-' + Math.random().toString(16).slice(2, 10);
let mod: EngineModule | null = null;
let ready: Promise<{ ms: number }> | null = null;
let fatal: string | null = null;

export type EngineProgress = { models: string[]; loaded: number; total: number; fetched: number };

export function loadTts(onProgress: (p: EngineProgress) => void, onEncoder?: (p: EngineProgress) => void): Promise<{ ms: number }> {
  ready ??= (async () => {
    const t0 = performance.now();
    const url = new URL('./zonos3-engine/engine.js', document.baseURI).href;
    mod = (await import(/* @vite-ignore */ url)) as EngineModule;
    mod.engine.onFatal(m => { fatal = m; });
    if (onEncoder) mod.engine.onEncoderProgress(onEncoder);
    await mod.engine.init(onProgress, { base: ZONOS_BASE, cache: true });
    return { ms: performance.now() - t0 };
  })().catch(e => { ready = null; throw e; });
  return ready;
}

export function ttsFatal() { return fatal; }

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  if (!mod) throw new Error('TTS engine not loaded');
  const headers = new Headers(init.headers);
  headers.set('x-tts-session-id', SESSION);
  if (init.body) headers.set('content-type', 'application/json');
  return mod.localFetch(path, { ...init, headers });
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await api(path, init);
  const body = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body) as T;
}

export interface DefaultVoice { id: string; label: string; language?: string; [k: string]: unknown }

export async function listVoices(): Promise<DefaultVoice[]> {
  const j = await apiJson<{ speakers: DefaultVoice[] }>('/v2/speakers');
  return j.speakers;
}

export async function capabilities(): Promise<Record<string, unknown>> {
  return apiJson('/v2/capabilities');
}

/** Build a float32 .npy (v1.0) from an embedding vector, as the API's speaker_embedding_base64 expects. */
export function npyBase64(vec: number[]): string {
  const header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${vec.length},), }`;
  const pad = 64 - ((10 + header.length + 1) % 64);
  const h = header + ' '.repeat(pad % 64) + '\n';
  const buf = new Uint8Array(10 + h.length + vec.length * 4);
  buf.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0], 0);
  new DataView(buf.buffer).setUint16(8, h.length, true);
  for (let i = 0; i < h.length; i++) buf[10 + i] = h.charCodeAt(i);
  new Float32Array(buf.buffer, 10 + h.length, vec.length).set(vec);
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}

function b64(bytes: ArrayBuffer): string {
  const u = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Enrol a voice: the clip goes to the in-process engine (speaker encoder, 43 MB), we keep only the 192-d embedding. */
export async function embedVoice(wav: ArrayBuffer, label: string): Promise<{ embedding: number[]; ms: number }> {
  const t0 = performance.now();
  const v = await apiJson<{ id: string }>('/v2/speakers', {
    method: 'POST',
    body: JSON.stringify({ speaker_audio_base64: b64(wav), speaker_audio_name: `${label}.wav`, label }),
  });
  const e = await apiJson<{ embedding: number[] }>(`/v2/speakers/${encodeURIComponent(v.id)}/embedding`);
  return { embedding: e.embedding, ms: performance.now() - t0 };
}

export type VoiceRef = { kind: 'default'; id: string } | { kind: 'auto' } | { kind: 'embedding'; embedding: number[] };

export interface TtsResult {
  ttfaMs: number;          // request → first PCM bytes from the engine
  firstPlayMs: number | null; // request → first audio scheduled on the speaker
  totalMs: number;         // request → last PCM bytes
  audioSec: number;
  rtf: number;             // totalMs / audio duration
  playbackEndMs: number | null;
  underruns: number;       // times playback ran dry mid-sentence (audible gaps)
  gapSec: number;          // total silence inserted by those gaps
  laci: boolean;           // alignment-guarded decoding was used
  capped: boolean;         // hit the length cap (runaway generation)
}

/** Default voice per language (ZONOS3-Mini ships no Japanese voice; a Korean female voice is used for ja). */
export const AUTO_VOICE: Record<Lang, string> = {
  ko: 'default_b7a257a5b1478493', // Seoyeon ko F
  ja: 'default_b7a257a5b1478493', // (no ja voice) Seoyeon ko F
  en: 'default_de4d191ca7574982', // Savannah en American F
  zh: 'default_eaee7325255d4783', // Meilin zh F
};

/** Upper bound on generated frames (15 Hz) from the text length, so a take that fails to stop cannot run for a minute. */
export function frameCap(text: string, lang: Lang): number {
  const charsPerSec = lang === 'en' ? 9 : 3.5;   // deliberately slow speaking rates: the cap must not cut real speech
  return Math.ceil(15 * (2 + text.length / charsPerSec));
}

export interface SynthOptions { play: boolean; seed?: number; signal?: AbortSignal; laci?: boolean; prebufferSec?: number }

export async function synthesize(text: string, lang: Lang, voice: VoiceRef, opts: SynthOptions = { play: true }): Promise<TtsResult> {
  const cap = frameCap(text, lang);
  const body: Record<string, unknown> = {
    text, language: CODES.zonos[lang], stream: true, format: 'pcm', seed: opts.seed ?? 1234,
    speaker_mode: 'embedding',   // embedding mode needs only the 43 MB speaker encoder, not the 2.6 GB reference encoder
    max_tokens: cap,
  };
  // LACI: the engine tracks the reading position and rolls back skipped text, hallucinated audio and early stops.
  let laci = opts.laci ?? true;
  if (laci) body.laci = true;
  if (voice.kind === 'default') body.speaker_embedding_id = voice.id;
  else if (voice.kind === 'auto') body.speaker_embedding_id = AUTO_VOICE[lang];
  else { body.speaker_embedding_base64 = npyBase64(voice.embedding); body.speaker_embedding_name = 'profile.npy'; }

  const ctx = opts.play ? await audioContext() : null;
  const player = ctx ? new StreamPlayer(ctx, SAMPLE_RATE, opts.prebufferSec ?? 0.4) : null;
  const t0 = performance.now();
  let r = await api('/v2/generate', { method: 'POST', body: JSON.stringify(body), signal: opts.signal });
  if (r.status === 400 && laci) {
    // Engine without LACI heads for this language: fall back to plain decoding and say so in the result.
    const msg = await r.text();
    if (!/laci/i.test(msg)) throw new Error(`/v2/generate 400: ${msg.slice(0, 300)}`);
    laci = false;
    delete body.laci;
    r = await api('/v2/generate', { method: 'POST', body: JSON.stringify(body), signal: opts.signal });
  }
  if (!r.ok || !r.body) throw new Error(`/v2/generate ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const reader = r.body.getReader();
  let ttfa = -1;
  let carry = new Uint8Array(0);
  let samples = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    if (ttfa < 0) ttfa = performance.now() - t0;
    const joined = new Uint8Array(carry.length + value.length);
    joined.set(carry); joined.set(value, carry.length);
    const usable = joined.length - (joined.length % 4);
    const f = new Float32Array(joined.slice(0, usable).buffer);
    carry = joined.slice(usable);
    samples += f.length;
    player?.push(f);
  }
  player?.end();
  const totalMs = performance.now() - t0;
  const audioSec = samples / SAMPLE_RATE;
  let playbackEndMs: number | null = null;
  if (player) { await player.ended(); playbackEndMs = performance.now() - t0; }
  return {
    ttfaMs: ttfa, firstPlayMs: player?.firstPlayAt ? player.firstPlayAt - t0 : null,
    totalMs, audioSec, rtf: audioSec > 0 ? totalMs / 1000 / audioSec : NaN, playbackEndMs,
    underruns: player?.underruns ?? 0, gapSec: player?.gapSec ?? 0, laci, capped: audioSec * 15 >= cap - 2,
  };
}
