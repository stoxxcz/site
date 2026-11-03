/*
 * Service worker that adds cross-origin isolation headers (COOP/COEP)
 * to every same-scope response. Static hosts such as GitHub Pages can't
 * send these headers themselves, but SharedArrayBuffer — and therefore the
 * multi-threaded Stockfish build — requires them.
 *
 * It also caches the engine files so repeat visits start instantly.
 */
const CACHE = 'nextmove-v2';
const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './vendor/chess.js',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

function withIsolation(res) {
  if (!res || res.status === 0 || res.type === 'opaque') return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Engine binaries are big and immutable: cache-first.
  const isEngine = url.pathname.includes('/engine/');

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (isEngine) {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return withIsolation(hit);
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone()).catch(() => {});
        return withIsolation(res);
      }
      // Everything else: network-first so updates show up, cache as offline fallback.
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone()).catch(() => {});
        return withIsolation(res);
      } catch (err) {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return withIsolation(hit);
        throw err;
      }
    })()
  );
});
