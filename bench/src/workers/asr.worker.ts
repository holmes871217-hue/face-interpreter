/// <reference lib="webworker" />
import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { configureTransformers, errMsg, progressAggregator } from './common';

type In =
  | { type: 'load'; reqId: number; repo: string; device: 'webgpu' | 'wasm'; dtype: Record<string, string> | string; ortBase: string }
  | { type: 'run'; reqId: number; repo: string; audio: Float32Array; language?: string; kind: 'whisper' | 'moonshine' }
  | { type: 'unload'; reqId: number };

const loaded = new Map<string, AutomaticSpeechRecognitionPipeline>();
let configured = false;

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      if (!configured) { configureTransformers(m.ortBase); configured = true; }
      if (loaded.has(m.repo)) { post({ type: 'loaded', reqId: m.reqId, ms: 0, cached: true }); return; }
      const t0 = performance.now();
      const p = await pipeline('automatic-speech-recognition', m.repo, {
        device: m.device,
        dtype: m.dtype as never,
        progress_callback: progressAggregator(pr => post({ type: 'progress', reqId: m.reqId, ...pr })) as never,
      });
      loaded.set(m.repo, p as AutomaticSpeechRecognitionPipeline);
      // Warm-up on 1 s of silence so the first real utterance is not charged with shader compilation.
      const tw = performance.now();
      await (p as AutomaticSpeechRecognitionPipeline)(new Float32Array(16000), {});
      post({ type: 'loaded', reqId: m.reqId, ms: tw - t0, warmupMs: performance.now() - tw });
    } else if (m.type === 'run') {
      const p = loaded.get(m.repo);
      if (!p) throw new Error('model not loaded: ' + m.repo);
      const t0 = performance.now();
      const opts: Record<string, unknown> = {};
      if (m.kind === 'whisper') { opts.language = m.language; opts.task = 'transcribe'; }
      else {
        // Moonshine: cap generated tokens by audio length (model card: ~13 tokens/s) to avoid repetition loops.
        opts.max_new_tokens = Math.max(16, Math.ceil((m.audio.length / 16000) * 13));
      }
      const out = await p(m.audio, opts) as { text: string } | { text: string }[];
      const text = (Array.isArray(out) ? out[0]?.text : out.text) ?? '';
      post({ type: 'result', reqId: m.reqId, text: text.trim(), ms: performance.now() - t0, audioSec: m.audio.length / 16000 });
    } else if (m.type === 'unload') {
      for (const p of loaded.values()) await p.dispose();
      loaded.clear();
      post({ type: 'unloaded', reqId: m.reqId });
    }
  } catch (err) {
    post({ type: 'error', reqId: m.reqId, error: errMsg(err) });
  }
};
