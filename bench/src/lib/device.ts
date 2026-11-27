/** Device capability probe (Phase 0, item 9: WebGPU / WASM / memory / storage / mic / PWA). */

export interface DeviceReport {
  userAgent: string;
  platform: string;
  standalone: boolean;
  secureContext: boolean;
  crossOriginIsolated: boolean;
  hardwareConcurrency: number | null;
  deviceMemoryGB: number | null;
  jsHeapLimitMB: number | null;
  webgpu: {
    available: boolean;
    error?: string;
    adapter?: { vendor: string; architecture: string; device: string; description: string };
    features?: string[];
    shaderF16?: boolean;
    limits?: Record<string, number>;
    isFallbackAdapter?: boolean;
  };
  wasm: { simd: boolean; threads: boolean; jspi: boolean };
  storage: { usageMB: number | null; quotaMB: number | null; persisted: boolean | null; opfs: boolean };
  media: { getUserMedia: boolean; audioWorklet: boolean; sampleRate: number | null };
  wakeLock: boolean;
  serviceWorker: boolean;
}

const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

export async function probeDevice(): Promise<DeviceReport> {
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { platform?: string } };
  const perf = performance as Performance & { memory?: { jsHeapSizeLimit: number } };
  const r: DeviceReport = {
    userAgent: navigator.userAgent,
    platform: nav.userAgentData?.platform ?? navigator.platform ?? '',
    standalone: matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true,
    secureContext: isSecureContext,
    crossOriginIsolated: self.crossOriginIsolated === true,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGB: nav.deviceMemory ?? null,
    jsHeapLimitMB: perf.memory ? Math.round(perf.memory.jsHeapSizeLimit / 1048576) : null,
    webgpu: { available: false },
    wasm: { simd: false, threads: false, jspi: false },
    storage: { usageMB: null, quotaMB: null, persisted: null, opfs: false },
    media: { getUserMedia: !!navigator.mediaDevices?.getUserMedia, audioWorklet: typeof AudioWorkletNode !== 'undefined', sampleRate: null },
    wakeLock: 'wakeLock' in navigator,
    serviceWorker: 'serviceWorker' in navigator,
  };

  try {
    if (!navigator.gpu) throw new Error('navigator.gpu 없음');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('requestAdapter()가 null 반환');
    const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
    const limits: Record<string, number> = {};
    for (const k of ['maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeWorkgroupStorageSize',
      'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupSizeX', 'maxStorageBuffersPerShaderStage'] as const) {
      limits[k] = Number(adapter.limits[k]);
    }
    r.webgpu = {
      available: true,
      adapter: info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : undefined,
      features: [...adapter.features].sort(),
      shaderF16: adapter.features.has('shader-f16'),
      limits,
      isFallbackAdapter: (info as unknown as { isFallbackAdapter?: boolean })?.isFallbackAdapter,
    };
  } catch (e) {
    r.webgpu = { available: false, error: e instanceof Error ? e.message : String(e) };
  }

  r.wasm.simd = WebAssembly.validate(SIMD_PROBE);
  r.wasm.threads = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated === true;
  r.wasm.jspi = 'Suspending' in WebAssembly;

  try {
    const est = await navigator.storage.estimate();
    r.storage.usageMB = est.usage != null ? Math.round(est.usage / 1048576) : null;
    r.storage.quotaMB = est.quota != null ? Math.round(est.quota / 1048576) : null;
    r.storage.persisted = await navigator.storage.persisted();
  } catch { /* not supported */ }
  try { await navigator.storage.getDirectory(); r.storage.opfs = true; } catch { /* no OPFS */ }
  try {
    const c = new OfflineAudioContext(1, 1, 44100);
    r.media.sampleRate = c.sampleRate;
  } catch { /* ignore */ }
  return r;
}

export function summarize(d: DeviceReport): { ok: boolean; level: '가능' | '제한' | '불가'; reasons: string[] } {
  const reasons: string[] = [];
  if (!d.secureContext) reasons.push('HTTPS가 아님: 마이크·서비스워커 사용 불가');
  if (!d.webgpu.available) reasons.push(`WebGPU 불가 (${d.webgpu.error ?? ''}) → ZONOS3-Mini TTS 실행 불가`);
  else if (!d.webgpu.shaderF16) reasons.push('shader-f16 미지원 → Hy-MT3 q4f16 등 fp16 모델 사용 불가');
  if (!d.media.getUserMedia) reasons.push('getUserMedia 미지원');
  if (!d.wasm.simd) reasons.push('WASM SIMD 미지원');
  const level = !d.webgpu.available || !d.media.getUserMedia ? '불가' : reasons.length ? '제한' : '가능';
  return { ok: level === '가능', level, reasons };
}
