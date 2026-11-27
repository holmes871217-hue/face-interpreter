/** Page side of the service-worker egress audit. */

export interface NetEntry {
  seq: number; t: number; method: string; url: string; host: string; dest: string; sameOrigin: boolean;
  blocked: boolean; reason?: string; status?: number; reqBodyBytes?: number; resBytes?: number;
  finalHost?: string; warn?: string; error?: string; note?: string;
}
export interface Policy { offlineSim: boolean; coi: boolean }

type Listener = (entries: NetEntry[], policy: Policy | null) => void;
const entries: NetEntry[] = [];
let policy: Policy | null = null;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach(l => l(entries, policy));

export function onNet(l: Listener): () => void {
  listeners.add(l);
  l(entries, policy);
  return () => listeners.delete(l);
}

export async function registerSW(): Promise<'controlled' | 'reloading' | 'unsupported' | 'error'> {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  navigator.serviceWorker.addEventListener('message', e => {
    const m = e.data;
    if (m?.type === 'net') { entries.push(m.entry); if (entries.length > 3000) entries.shift(); emit(); }
    if (m?.type === 'log') { entries.length = 0; entries.push(...m.entries); policy = m.policy; emit(); }
    if (m?.type === 'policy') { policy = m.policy; emit(); }
  });
  try {
    await navigator.serviceWorker.register(new URL('./sw.js', document.baseURI).href, { scope: './' });
    if (!navigator.serviceWorker.controller) {
      // First visit: reload once so every request (incl. workers) goes through the audit, and COOP/COEP apply.
      if (!sessionStorage.getItem('sw-reloaded')) {
        sessionStorage.setItem('sw-reloaded', '1');
        await navigator.serviceWorker.ready;
        location.reload();
        return 'reloading';
      }
      return 'error';
    }
    navigator.serviceWorker.controller.postMessage({ type: 'getLog' });
    return 'controlled';
  } catch {
    return 'error';
  }
}

export function setPolicy(p: Partial<Policy>) {
  navigator.serviceWorker.controller?.postMessage({ type: 'setPolicy', policy: p });
}
export function clearNetLog() {
  navigator.serviceWorker.controller?.postMessage({ type: 'clearLog' });
}

export function netSummary(list: NetEntry[] = entries) {
  const cross = list.filter(e => !e.sameOrigin);
  return {
    total: list.length,
    crossOrigin: cross.length,
    crossOriginNonGet: cross.filter(e => e.method !== 'GET' && e.method !== 'HEAD').length,
    crossOriginWithBody: cross.filter(e => (e.reqBodyBytes ?? 0) > 0).length,
    blocked: list.filter(e => e.blocked).length,
    hosts: [...new Set(cross.map(e => e.host))],
    redirectWarnings: list.filter(e => e.warn).length,
    downloadedMB: Math.round(cross.reduce((a, e) => a + (e.resBytes ?? 0), 0) / 1048576),
  };
}

/** Marker for an inference window (used to prove "0 requests during inference").
 *  Time-based: the service worker's own sequence counter restarts whenever the browser stops an idle worker,
 *  so sequence numbers are not comparable across that restart. */
export function currentSeq(): number { return Date.now(); }
export function entriesSince(since: number): NetEntry[] {
  const seen = new Set<string>();
  return entries.filter(e => {
    if (e.t < since) return false;
    const k = `${e.seq}:${e.t}:${e.url}`;   // de-duplicate entries re-sent after a getLog
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
