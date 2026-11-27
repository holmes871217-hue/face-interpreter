import { CODES, type Lang } from '../data/languages';
import { ASR_CANDIDATES, MT_CANDIDATES, type AsrCandidate, type Device, type MtCandidate } from './models';

export interface LoadProgress { loaded: number; total: number; files: number; status: string }

type Msg = { type: string; reqId: number; [k: string]: unknown };

class WorkerClient {
  private w: Worker;
  private next = 1;
  private waiting = new Map<number, { res: (m: Msg) => void; rej: (e: Error) => void; onProgress?: (p: LoadProgress) => void }>();

  constructor(make: () => Worker) {
    this.w = make();
    this.w.onmessage = (e: MessageEvent<Msg>) => {
      const m = e.data;
      const h = this.waiting.get(m.reqId);
      if (!h) return;
      if (m.type === 'progress') { h.onProgress?.(m as unknown as LoadProgress); return; }
      this.waiting.delete(m.reqId);
      if (m.type === 'error') h.rej(new Error(String(m.error)));
      else h.res(m);
    };
    this.w.onerror = e => {
      for (const h of this.waiting.values()) h.rej(new Error('worker crashed: ' + (e.message || 'unknown (메모리 부족 가능성)')));
      this.waiting.clear();
    };
  }

  call(msg: Record<string, unknown>, onProgress?: (p: LoadProgress) => void, transfer: Transferable[] = []): Promise<Msg> {
    const reqId = this.next++;
    return new Promise((res, rej) => {
      this.waiting.set(reqId, { res, rej, onProgress });
      this.w.postMessage({ ...msg, reqId }, transfer);
    });
  }
}

const ortBase = () => new URL('./ort/', document.baseURI).href;

let asrW: WorkerClient | null = null;
let mtW: WorkerClient | null = null;
const asrWorker = () => (asrW ??= new WorkerClient(() => new Worker(new URL('../workers/asr.worker.ts', import.meta.url), { type: 'module' })));
const mtWorker = () => (mtW ??= new WorkerClient(() => new Worker(new URL('../workers/mt.worker.ts', import.meta.url), { type: 'module' })));

export interface LoadResult { ms: number; warmupMs?: number; cached?: boolean; device: Device; dtype: unknown; repo: string }

export async function loadAsr(c: AsrCandidate, lang: Lang, device: Device, f16: boolean, onProgress?: (p: LoadProgress) => void): Promise<LoadResult> {
  const repo = c.repoFor(lang);
  const dtype = c.dtype(device, f16);
  const r = await asrWorker().call({ type: 'load', repo, device, dtype, ortBase: ortBase() }, onProgress);
  return { ms: Number(r.ms), warmupMs: r.warmupMs as number | undefined, cached: Boolean(r.cached), device, dtype, repo };
}

export async function runAsr(c: AsrCandidate, lang: Lang, audio16k: Float32Array): Promise<{ text: string; ms: number; audioSec: number }> {
  const repo = c.repoFor(lang);
  const copy = audio16k.slice();
  const r = await asrWorker().call({ type: 'run', repo, audio: copy, language: CODES.whisper[lang], kind: c.kind }, undefined, [copy.buffer]);
  return { text: String(r.text), ms: Number(r.ms), audioSec: Number(r.audioSec) };
}

export async function unloadAsr() { if (asrW) await asrW.call({ type: 'unload' }); }

export async function loadMt(c: MtCandidate, device: Device, f16: boolean, onProgress?: (p: LoadProgress) => void): Promise<LoadResult> {
  const dtype = c.dtype(device, f16);
  const r = await mtWorker().call({ type: 'load', repo: c.repo, kind: c.kind, device, dtype, ortBase: ortBase() }, onProgress);
  return { ms: Number(r.ms), cached: Boolean(r.cached), device, dtype, repo: c.repo };
}

/** Hy-MT3 prompt per model card: Chinese prompt when Chinese is involved, English prompt otherwise. */
export function hymtPrompt(text: string, src: Lang, tgt: Lang): string {
  if (src === 'zh' || tgt === 'zh') return `将以下文本翻译为${CODES.hymtZh[tgt]}，注意只需要输出翻译后的结果，不要额外解释：\n\n${text}`;
  return `Translate the following text into ${CODES.hymtEn[tgt]}. Note that you should only output the translated result without any additional explanation:\n\n${text}`;
}

async function translateOnce(c: MtCandidate, text: string, src: Lang, tgt: Lang) {
  const codes = c.kind === 'seq2seq-nllb' ? CODES.nllb : CODES.m2m100;
  const r = await mtWorker().call({
    type: 'run', repo: c.repo, kind: c.kind, text,
    src: codes[src], tgt: codes[tgt], prompt: c.kind === 'hymt' ? hymtPrompt(text, src, tgt) : undefined,
  });
  return { text: String(r.text), ms: Number(r.ms), newTokens: Number(r.newTokens ?? 0) };
}

export interface MtResult { text: string; ms: number; newTokens: number; pivot?: { text: string; ms: number } }

/** Direct translation, or via English (pivot) when requested and neither side is English. */
export async function translate(c: MtCandidate, text: string, src: Lang, tgt: Lang, pivot = false): Promise<MtResult> {
  if (!pivot || src === 'en' || tgt === 'en') return translateOnce(c, text, src, tgt);
  const a = await translateOnce(c, text, src, 'en');
  const b = await translateOnce(c, a.text, 'en', tgt);
  return { text: b.text, ms: a.ms + b.ms, newTokens: a.newTokens + b.newTokens, pivot: { text: a.text, ms: a.ms } };
}

export async function unloadMt() { if (mtW) await mtW.call({ type: 'unload' }); }

export { ASR_CANDIDATES, MT_CANDIDATES };
