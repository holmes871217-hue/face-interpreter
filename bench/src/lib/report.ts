/** Plain-text test report the owner copies and pastes into the Claude chat (no screenshots, nothing uploaded). */
import type { DeviceReport } from './device';

export interface ErrorEntry { at: string; where: string; message: string }
export interface TtsLine {
  at: string; lang: string; voice: string; chars: number; audioSec: number; rmsDb: number; ok?: boolean;
  attempts?: number; rejected?: string[]; readyMs?: number; ttfaMs: number; rtf: number; laci: boolean;
}

const errors: ErrorEntry[] = [];
const tts: TtsLine[] = [];
const notes: string[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(f => f());

export function onReport(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); }

export function logError(where: string, e: unknown) {
  const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  errors.push({ at: new Date().toLocaleTimeString(), where, message: message.slice(0, 400) });
  if (errors.length > 30) errors.shift();
  emit();
}
export function logTts(l: TtsLine) { tts.push(l); if (tts.length > 40) tts.shift(); emit(); }
export function logNote(n: string) { notes.push(`${new Date().toLocaleTimeString()} ${n}`); if (notes.length > 30) notes.shift(); emit(); }
export function errorCount() { return errors.length; }

let installed = false;
export function installGlobalErrorCapture() {
  if (installed) return;
  installed = true;
  addEventListener('error', e => logError('페이지', e.error ?? e.message));
  addEventListener('unhandledrejection', e => logError('비동기', e.reason));
}

declare const __BUILD__: string;

export function buildReport(device: DeviceReport | null): string {
  const L: string[] = [];
  L.push(`[통역 벤치 결과] 버전 ${typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev'} · ${new Date().toLocaleString()}`);
  if (device) {
    const g = device.webgpu;
    L.push(`기기: ${device.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 90)}`);
    L.push(`GPU: ${g.available ? `${g.adapter?.vendor ?? ''} ${g.adapter?.architecture ?? ''}` : 'WebGPU 없음 ' + (g.error ?? '')} · f16 ${g.shaderF16 ? 'O' : 'X'} · 바인딩 ${g.limits ? Math.round(g.limits.maxStorageBufferBindingSize / 1048576) + 'MB' : '-'} · 격리 ${device.crossOriginIsolated ? 'O' : 'X'}`);
  }
  if (tts.length) {
    L.push('합성(언어 목소리 | 길이 음량 | 검사 | 준비/첫소리):');
    for (const t of tts) {
      const check = t.ok == null ? '스트리밍' : t.ok ? `통과${t.attempts! > 1 ? `(${t.attempts}번째)` : ''}` : '실패';
      const rej = t.rejected?.length ? ` 버림[${t.rejected.join('; ')}]` : '';
      const time = t.readyMs != null ? `${(t.readyMs / 1000).toFixed(1)}s` : `${(t.ttfaMs / 1000).toFixed(1)}s`;
      L.push(`- ${t.lang} ${t.voice} | ${t.audioSec.toFixed(1)}s ${t.rmsDb.toFixed(0)}dB | ${check}${rej} | ${time}${t.laci ? '' : ' LACI끔'}`);
    }
  }
  if (notes.length) { L.push('메모:'); for (const n of notes) L.push(`- ${n}`); }
  L.push(errors.length ? '에러:' : '에러: 없음');
  for (const e of errors) L.push(`- ${e.at} [${e.where}] ${e.message}`);
  return L.join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}
