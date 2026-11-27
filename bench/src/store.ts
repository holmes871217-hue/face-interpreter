import { useSyncExternalStore } from 'react';
import type { Lang } from './data/languages';
import type { DeviceReport } from './lib/device';
import type { Device } from './lib/models';
import { results, type BenchRecord } from './lib/db';

export interface State {
  device: DeviceReport | null;
  backend: Device;               // preferred backend for ASR/MT
  asrId: string;
  asrLoaded: Partial<Record<string, Lang[]>>; // candidate id -> languages loaded
  mtId: string;
  mtLoaded: string[];
  mtPivot: boolean;
  mtNoRepeat: boolean;            // seq2seq decoding guard against repetition loops
  ttsLoaded: boolean;
  langA: Lang;
  langB: Lang;
  hangoverMs: number;
  busy: string | null;
}

let state: State = {
  device: null, backend: 'webgpu', asrId: 'whisper-base', asrLoaded: {}, mtId: 'hymt3-1.8b', mtLoaded: [], mtPivot: false, mtNoRepeat: true,
  ttsLoaded: false, langA: 'ko', langB: 'ja', hangoverMs: 700, busy: null,
};
const subs = new Set<() => void>();

export function setState(p: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof p === 'function' ? p(state) : p) };
  subs.forEach(f => f());
}
export function getState() { return state; }
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => sel(state));
}

/** Append a measurement (kept on the device in IndexedDB; exported only by the user as a file). */
export async function record(kind: BenchRecord['kind'], data: Record<string, unknown>) {
  try { await results.add({ kind, data }); } catch (e) { console.warn('result not stored', e); }
}

export const fmtMs = (ms: number | null | undefined) => ms == null || !isFinite(ms) ? '—' : ms >= 10000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
export const fmtMB = (b: number) => `${(b / 1048576).toFixed(0)} MB`;
