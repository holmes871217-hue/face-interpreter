/// <reference lib="webworker" />
import {
  AutoModelForCausalLM, AutoTokenizer, pipeline,
  type PreTrainedModel, type PreTrainedTokenizer, type Tensor, type TranslationPipeline,
} from '@huggingface/transformers';
import { configureTransformers, errMsg, progressAggregator } from './common';

type Kind = 'seq2seq-m2m' | 'seq2seq-nllb' | 'hymt';
type In =
  | { type: 'load'; reqId: number; repo: string; kind: Kind; device: 'webgpu' | 'wasm'; dtype: Record<string, string> | string; ortBase: string }
  | { type: 'run'; reqId: number; repo: string; kind: Kind; text: string; src: string; tgt: string; prompt?: string }
  | { type: 'unload'; reqId: number };

const seq2seq = new Map<string, TranslationPipeline>();
const llm = new Map<string, { tok: PreTrainedTokenizer; model: PreTrainedModel }>();
let configured = false;
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      if (!configured) { configureTransformers(m.ortBase); configured = true; }
      if (seq2seq.has(m.repo) || llm.has(m.repo)) { post({ type: 'loaded', reqId: m.reqId, ms: 0, cached: true }); return; }
      const t0 = performance.now();
      const progress_callback = progressAggregator(pr => post({ type: 'progress', reqId: m.reqId, ...pr })) as never;
      if (m.kind === 'hymt') {
        const tok = await AutoTokenizer.from_pretrained(m.repo, { progress_callback });
        const model = await AutoModelForCausalLM.from_pretrained(m.repo, { device: m.device, dtype: m.dtype as never, progress_callback });
        llm.set(m.repo, { tok, model });
      } else {
        const p = await pipeline('translation', m.repo, { device: m.device, dtype: m.dtype as never, progress_callback });
        seq2seq.set(m.repo, p as TranslationPipeline);
      }
      post({ type: 'loaded', reqId: m.reqId, ms: performance.now() - t0 });
    } else if (m.type === 'run') {
      const t0 = performance.now();
      let text = '';
      let newTokens = 0;
      if (m.kind === 'hymt') {
        const h = llm.get(m.repo);
        if (!h) throw new Error('model not loaded: ' + m.repo);
        const inputs = h.tok.apply_chat_template([{ role: 'user', content: m.prompt ?? m.text }],
          { add_generation_prompt: true, return_dict: true }) as { input_ids: Tensor; attention_mask: Tensor };
        const inLen = inputs.input_ids.dims[1];
        const maxNew = Math.min(512, 32 + m.text.length * 4);
        const out = await h.model.generate({ ...inputs, max_new_tokens: maxNew, do_sample: false, repetition_penalty: 1.05 }) as Tensor;
        const gen = out.slice(null, [inLen, out.dims[1]]);
        newTokens = gen.dims[1];
        text = h.tok.batch_decode(gen, { skip_special_tokens: true })[0] ?? '';
      } else {
        const p = seq2seq.get(m.repo);
        if (!p) throw new Error('model not loaded: ' + m.repo);
        const out = await p(m.text, { src_lang: m.src, tgt_lang: m.tgt, max_new_tokens: 256 } as never) as { translation_text: string }[];
        text = out[0]?.translation_text ?? '';
      }
      post({ type: 'result', reqId: m.reqId, text: text.trim(), ms: performance.now() - t0, newTokens });
    } else if (m.type === 'unload') {
      for (const p of seq2seq.values()) await p.dispose();
      for (const h of llm.values()) await h.model.dispose();
      seq2seq.clear(); llm.clear();
      post({ type: 'unloaded', reqId: m.reqId });
    }
  } catch (err) {
    post({ type: 'error', reqId: m.reqId, error: errMsg(err) });
  }
};
