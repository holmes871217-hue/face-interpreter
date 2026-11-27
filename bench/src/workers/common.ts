import { env } from '@huggingface/transformers';

/** Serve onnxruntime-web WASM from our own origin (transformers.js defaults to jsDelivr). */
export function configureTransformers(base: string) {
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
  if (onnx.wasm) {
    onnx.wasm.wasmPaths = {
      mjs: base + 'ort-wasm-simd-threaded.asyncify.mjs',
      wasm: base + 'ort-wasm-simd-threaded.asyncify.wasm',
    };
    onnx.wasm.numThreads = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated
      ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  }
  env.allowLocalModels = false;
  env.allowRemoteModels = true;   // first download only; afterwards served from Cache Storage
  env.useBrowserCache = true;
}

export interface ProgressInfo { file: string; loaded: number; total: number; status: string }

/** Aggregates transformers.js per-file progress into one readout. */
export function progressAggregator(post: (p: { loaded: number; total: number; files: number; status: string }) => void) {
  const files = new Map<string, { loaded: number; total: number }>();
  let last = 0;
  return (p: Partial<ProgressInfo> & { status: string }) => {
    if (p.file && (p.status === 'progress' || p.status === 'download' || p.status === 'done')) {
      const cur = files.get(p.file) ?? { loaded: 0, total: 0 };
      if (typeof p.total === 'number' && p.total > 0) cur.total = p.total;
      if (typeof p.loaded === 'number') cur.loaded = p.loaded;
      if (p.status === 'done') cur.loaded = cur.total;
      files.set(p.file, cur);
    }
    const now = performance.now();
    if (now - last < 150 && p.status === 'progress') return;
    last = now;
    let loaded = 0, total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    post({ loaded, total, files: files.size, status: p.status });
  };
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}
