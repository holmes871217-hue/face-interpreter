/* Phase 0 bench service worker.
 *
 * 1. Egress firewall + audit log: every request made by the page AND by its dedicated workers passes through here.
 *    - same-origin requests: allowed (app files).
 *    - cross-origin requests: allowed only for GET/HEAD to Hugging Face model hosts (public model download).
 *      Anything else (POST/PUT/PATCH, other hosts) is answered with a synthetic 403 and logged as "blocked".
 *    - offline simulation: every cross-origin request is blocked (proves inference needs no network).
 *    WebSocket / WebRTC are not visible to a service worker; they are covered by the page CSP and by code audit.
 * 2. App-shell cache (same-origin GETs) so the bench opens offline after the first visit.
 * 3. Optional cross-origin isolation (COOP/COEP headers on navigations) so WASM can use threads.
 */
const VERSION = 'bench-sw-v2';
const SHELL_CACHE = 'bench-shell-v1';
const POLICY_CACHE = 'bench-policy';
const ALLOWED_HOST = /^(huggingface\.co|[a-z0-9-]+\.huggingface\.co|([a-z0-9-]+\.)*hf\.co)$/i;

let policy = { offlineSim: false, coi: true };
const log = [];
const MAX_LOG = 3000;
let seq = 0;

async function loadPolicy() {
  try {
    const c = await caches.open(POLICY_CACHE);
    const r = await c.match('policy.json');
    if (r) policy = { ...policy, ...(await r.json()) };
  } catch { /* defaults */ }
}
async function savePolicy() {
  const c = await caches.open(POLICY_CACHE);
  await c.put('policy.json', new Response(JSON.stringify(policy), { headers: { 'content-type': 'application/json' } }));
}
const policyReady = loadPolicy();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('bench-shell-') && k !== SHELL_CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

async function broadcast(msg) {
  const cs = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const c of cs) c.postMessage(msg);
}

function record(entry) {
  entry.seq = ++seq;
  entry.t = Date.now();
  log.push(entry);
  if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
  broadcast({ type: 'net', entry });
}

function shortUrl(u) {
  // Keep host + path; drop signed query strings (they are long and carry no user data).
  return u.origin + u.pathname;
}

self.addEventListener('message', e => {
  const m = e.data || {};
  if (m.type === 'getLog') e.source?.postMessage({ type: 'log', entries: log, policy, version: VERSION });
  if (m.type === 'clearLog') { log.length = 0; e.source?.postMessage({ type: 'log', entries: log, policy, version: VERSION }); }
  if (m.type === 'setPolicy') {
    policy = { ...policy, ...m.policy };
    e.waitUntil(savePolicy().then(() => broadcast({ type: 'policy', policy })));
  }
});

function withHeaders(res, extra) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  const sameOrigin = url.origin === self.location.origin;
  event.respondWith(handle(event, req, url, sameOrigin));
});

async function handle(event, req, url, sameOrigin) {
  await policyReady;
  const method = req.method.toUpperCase();
  const base = { method, url: shortUrl(url), host: url.host, dest: req.destination || '', sameOrigin };

  if (!sameOrigin) {
    let reason = '';
    if (policy.offlineSim) reason = 'offline-simulation';
    else if (!ALLOWED_HOST.test(url.hostname)) reason = 'host-not-allowed';
    else if (method !== 'GET' && method !== 'HEAD') reason = 'method-not-allowed';
    if (reason) {
      let bodyBytes = 0;
      try { bodyBytes = (await req.clone().arrayBuffer()).byteLength; } catch { /* opaque */ }
      record({ ...base, blocked: true, reason, reqBodyBytes: bodyBytes, status: 403 });
      return new Response(`blocked by bench egress policy: ${reason}`, { status: 403, statusText: 'Blocked' });
    }
    try {
      const res = await fetch(req);
      const finalHost = res.url ? new URL(res.url).host : url.host;
      const redirectedOut = res.url && !ALLOWED_HOST.test(new URL(res.url).hostname);
      record({ ...base, blocked: false, status: res.status, resBytes: Number(res.headers.get('content-length') || 0),
        finalHost, warn: redirectedOut ? 'redirected-to-unlisted-host' : undefined, reqBodyBytes: 0 });
      return res;
    } catch (err) {
      record({ ...base, blocked: false, status: 0, error: String(err), reqBodyBytes: 0 });
      throw err;
    }
  }

  // Same origin: app files. Non-GET same-origin requests do not exist in this app; log them if they ever happen.
  if (method !== 'GET') {
    record({ ...base, blocked: false, note: 'same-origin non-GET', reqBodyBytes: 0 });
    return fetch(req);
  }
  const isNav = req.mode === 'navigate';
  const cache = await caches.open(SHELL_CACHE);
  let res;
  try {
    // GitHub Pages sends max-age=600: revalidate the page itself so a new deploy shows up on the next reload.
    // Hashed assets keep normal HTTP caching.
    res = await fetch(req, isNav || /\/(sw\.js|manifest\.webmanifest)$/.test(url.pathname) ? { cache: 'no-cache' } : undefined);
    if (res.ok && res.type === 'basic') event.waitUntil(cache.put(req, res.clone()));
  } catch {
    res = await cache.match(req, { ignoreSearch: isNav });
    if (!res && isNav) res = await cache.match(new URL('./', self.registration.scope).href);
    if (!res) return new Response('offline and not cached', { status: 504 });
  }
  if (isNav && policy.coi) {
    res = withHeaders(res, { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
  } else if (policy.coi && (req.destination === 'worker' || req.destination === 'script')) {
    res = withHeaders(res, { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' });
  }
  return res;
}
