/** Microphone capture, a simple energy VAD, resampling and WAV encoding. Everything stays in memory. */

export interface CaptureResult {
  pcm: Float32Array;          // mono, at `sampleRate`
  sampleRate: number;
  /** ms from capture start to first / last voiced frame (VAD), or null when no speech was found. */
  speechStartMs: number | null;
  speechEndMs: number | null;
  /** ms between the last voiced frame and the moment capture stopped (end-of-utterance detection delay). */
  endDetectMs: number | null;
  stoppedBy: 'vad' | 'manual' | 'max' | 'abort';
  durationMs: number;
}

export interface CaptureOptions {
  vad: boolean;
  hangoverMs: number;     // silence needed after speech to end the utterance
  maxMs: number;
  onLevel?: (rms: number, speaking: boolean) => void;
}

let sharedCtx: AudioContext | null = null;
let workletLoaded = false;

/** One AudioContext for capture and playback; must be created/resumed from a user gesture (iOS). */
export async function audioContext(): Promise<AudioContext> {
  if (!sharedCtx) sharedCtx = new AudioContext({ latencyHint: 'interactive' });
  if (sharedCtx.state !== 'running') await sharedCtx.resume();
  return sharedCtx;
}

export class MicCapture {
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private resolve: ((r: CaptureResult) => void) | null = null;
  private stopReason: CaptureResult['stoppedBy'] = 'manual';
  private sr = 48000;
  private speechStart: number | null = null;
  private lastVoiced: number | null = null;
  private noiseFloor = 0;
  private framesSeen = 0;
  private samples = 0;
  private done = false;

  constructor(private opts: CaptureOptions) {}

  async start(): Promise<Promise<CaptureResult>> {
    const ctx = await audioContext();
    if (!workletLoaded) {
      await ctx.audioWorklet.addModule(new URL('./pcm-capture-worklet.js', document.baseURI).href);
      workletLoaded = true;
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.sr = ctx.sampleRate;
    this.src = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, 'pcm-capture');
    this.node.port.onmessage = e => this.onFrame(e.data as Float32Array);
    this.src.connect(this.node);
    // Keep the graph pulling without sending the mic to the speaker.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(ctx.destination);
    return new Promise<CaptureResult>(r => { this.resolve = r; });
  }

  private onFrame(buf: Float32Array) {
    if (this.done) return;
    this.chunks.push(buf);
    this.samples += buf.length;
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    const rms = Math.sqrt(s / buf.length);
    const nowMs = (this.samples / this.sr) * 1000;
    this.framesSeen++;
    // Noise floor: first ~250 ms, then slow tracking on non-speech frames.
    if (this.framesSeen <= 6) this.noiseFloor = Math.max(this.noiseFloor, rms);
    const thr = Math.max(0.012, this.noiseFloor * 3);
    const speaking = rms > thr;
    if (!speaking && this.framesSeen > 6) this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
    if (speaking) {
      if (this.speechStart === null) this.speechStart = nowMs;
      this.lastVoiced = nowMs;
    }
    this.opts.onLevel?.(rms, speaking);
    if (this.opts.vad && this.lastVoiced !== null && nowMs - this.lastVoiced >= this.opts.hangoverMs) this.finish('vad');
    else if (nowMs >= this.opts.maxMs) this.finish('max');
  }

  stop(reason: CaptureResult['stoppedBy'] = 'manual') { this.finish(reason); }

  private finish(reason: CaptureResult['stoppedBy']) {
    if (this.done) return;
    this.done = true;
    this.stopReason = reason;
    this.node?.port.close();
    this.src?.disconnect();
    this.node?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    const pcm = concat(this.chunks);
    const durationMs = (pcm.length / this.sr) * 1000;
    this.resolve?.({
      pcm, sampleRate: this.sr,
      speechStartMs: this.speechStart, speechEndMs: this.lastVoiced,
      endDetectMs: this.lastVoiced !== null ? durationMs - this.lastVoiced : null,
      stoppedBy: this.stopReason, durationMs,
    });
    this.chunks = [];
  }
}

export function concat(parts: Float32Array[]): Float32Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Trim to the VAD speech region with some padding (keeps ASR input short). */
export function trimToSpeech(r: CaptureResult, padMs = 250): Float32Array {
  if (r.speechStartMs === null || r.speechEndMs === null) return r.pcm;
  const a = Math.max(0, Math.floor(((r.speechStartMs - padMs) / 1000) * r.sampleRate));
  const b = Math.min(r.pcm.length, Math.ceil(((r.speechEndMs + padMs) / 1000) * r.sampleRate));
  return r.pcm.slice(a, b);
}

export async function resample(pcm: Float32Array, from: number, to: number): Promise<Float32Array> {
  if (from === to || pcm.length === 0) return pcm;
  const len = Math.max(1, Math.round((pcm.length * to) / from));
  const ctx = new OfflineAudioContext(1, len, to);
  const buf = ctx.createBuffer(1, pcm.length, from);
  buf.copyToChannel(new Float32Array(pcm), 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return out.getChannelData(0).slice();
}

export function encodeWav(pcm: Float32Array, sampleRate: number): ArrayBuffer {
  const out = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(out);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const x = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return out;
}

export function rmsOf(pcm: Float32Array): number {
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
  return Math.sqrt(s / Math.max(1, pcm.length));
}

/** Gapless player for streamed float32 PCM chunks. */
export class StreamPlayer {
  private next = 0;
  private sources: AudioBufferSourceNode[] = [];
  private lastEnd: Promise<void> = Promise.resolve();
  firstPlayAt: number | null = null;

  constructor(private ctx: AudioContext, private sampleRate: number) {}

  push(chunk: Float32Array) {
    if (!chunk.length) return;
    const buf = this.ctx.createBuffer(1, chunk.length, this.sampleRate);
    buf.copyToChannel(new Float32Array(chunk), 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const at = Math.max(this.ctx.currentTime + 0.03, this.next);
    src.start(at);
    if (this.firstPlayAt === null) this.firstPlayAt = performance.now() + (at - this.ctx.currentTime) * 1000;
    this.next = at + buf.duration;
    this.sources.push(src);
    this.lastEnd = new Promise(r => { src.onended = () => r(); });
  }

  /** Resolves when everything pushed so far has played. */
  ended(): Promise<void> { return this.lastEnd; }

  stop() { for (const s of this.sources) { try { s.stop(); } catch { /* not started */ } } this.sources = []; }
}

export async function playPcm(pcm: Float32Array, sampleRate: number): Promise<void> {
  const ctx = await audioContext();
  const p = new StreamPlayer(ctx, sampleRate);
  p.push(pcm);
  await p.ended();
}
