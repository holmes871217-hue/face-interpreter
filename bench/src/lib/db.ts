/** IndexedDB storage (device-only): voice profiles and bench results. Nothing here is ever sent anywhere. */

export interface VoiceProfile {
  id: string;
  name: string;
  role: 'owner' | 'guest';
  consentAt: string | null;   // guest consent confirmation time (ISO)
  createdAt: string;
  sampleSeconds: number;
  embedding: number[];        // 192-d MECT-B2 speaker embedding (ZONOS3-Mini embedding mode)
  embedMs: number;            // time to compute the embedding (incl. speaker-encoder load on first use)
}

export interface BenchRecord {
  id?: number;
  at: string;
  kind: 'device' | 'asr' | 'mt' | 'tts' | 'voice' | 'pipeline' | 'load' | 'network' | 'offline';
  data: Record<string, unknown>;
}

const DB = 'interpreter-bench';
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('voices')) db.createObjectStore('voices', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('results')) db.createObjectStore('results', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req.result);
    t.onerror = () => rej(t.error);
  });
}

export const voices = {
  all: () => tx<VoiceProfile[]>('voices', 'readonly', s => s.getAll() as IDBRequest<VoiceProfile[]>),
  put: (v: VoiceProfile) => tx('voices', 'readwrite', s => s.put(v)),
  remove: (id: string) => tx('voices', 'readwrite', s => s.delete(id)),
  clear: () => tx('voices', 'readwrite', s => s.clear()),
};

export const results = {
  all: () => tx<BenchRecord[]>('results', 'readonly', s => s.getAll() as IDBRequest<BenchRecord[]>),
  add: (r: Omit<BenchRecord, 'at'>) => tx('results', 'readwrite', s => s.add({ ...r, at: new Date().toISOString() })),
  clear: () => tx('results', 'readwrite', s => s.clear()),
};

/** Deletes every byte this bench stored: IndexedDB, Cache Storage (models + app shell) and the service worker. */
export async function wipeEverything(opts: { models: boolean }): Promise<string[]> {
  const done: string[] = [];
  await voices.clear(); done.push('IndexedDB voices');
  await results.clear(); done.push('IndexedDB results');
  if (opts.models) {
    for (const k of await caches.keys()) { await caches.delete(k); done.push(`Cache Storage: ${k}`); }
    try {
      const root = await navigator.storage.getDirectory();
      // @ts-expect-error entries() is not in every lib.dom version
      for await (const [name] of root.entries()) { await root.removeEntry(name, { recursive: true }); done.push(`OPFS: ${name}`); }
    } catch { /* OPFS not available */ }
  }
  return done;
}
