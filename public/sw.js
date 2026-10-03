// BUMP THIS ON EVERY RELEASE.
//
// The activate handler below deliberately preserves whichever caches carry the
// current version number, and deletes everything else. If a release ships new
// code without bumping these, the old caches are treated as current and are
// never evicted: the installed PWA keeps serving the previous build's
// manifest, assets and cached API responses, so the app silently looks and
// behaves like the old version even though the server has the new code.
//
// NOTE: there is deliberately NO api cache any more. Authenticated /api/
// responses are never written to the Cache API (see the fetch handler), so the
// allow-list below holds only the two caches that can actually exist. That also
// means every pre-v7 `pharmacare-api-*` cache is evicted on this upgrade.
const CACHE_NAME = 'pharmacare-v7';
const STATIC_CACHE = 'pharmacare-static-v7';
const DYNAMIC_CACHE = 'pharmacare-dynamic-v7';

const STATIC_ASSETS = [
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.allSettled(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch(() => {})
        )
      );
      // Deliberately NOT self.skipWaiting() here.
      //
      // This used to call skipWaiting(), which activates a new release over any
      // tab that is already open, immediately and without asking. Combined with
      // clients.claim() in the activate handler that meant a deploy could pull
      // the app out from under a cashier in the middle of a sale: the shell and
      // its JS chunks are replaced while the in-flight transaction is still on
      // screen, so the page can end up running new code against a request the
      // old code started.
      //
      // Waiting instead leaves the new worker in `waiting` until the page asks
      // for it via the SKIP_WAITING message below, which ServiceWorkerRegister
      // only sends once the user has been told and has agreed. An old-but-working
      // build beats a mid-transaction one.
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== DYNAMIC_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // NEVER cache, and never serve from cache, an authenticated API response.
    //
    // Every /api/ route in this app is scoped by the caller's session: the same
    // URL returns a different body for a cashier at Branch A than for one at
    // Branch B. The Cache API keys entries on URL + method + `Vary`, and nothing
    // here varies on the session cookie, so `GET /api/products` is ONE cache
    // entry shared by every branch and every user. Caching it therefore meant
    // that whenever the network dropped, the `caches.match` fallback in
    // networkFirst() below could hand Branch B the exact stock levels, prices
    // and totals that Branch A had loaded — a silent cross-branch data leak in
    // the one situation the owner least expects to be reading stale data.
    //
    // Letting these requests bypass the service worker entirely means the
    // browser handles them normally: no cache to poison, and a real network
    // error surfaces as a real network error. The app already degrades to an
    // offline notice, and stale-but-wrong branch data is far worse than an
    // honest "you are offline".
    return;
  }

  // Same reasoning, different transport: React Server Component payloads.
  //
  // The block above only catches /api/ paths, but in the App Router the actual
  // data for a page arrives as an RSC request to the page's OWN pathname with
  // `?_rsc=<buildId>` and an `RSC: 1` header — `/products?_rsc=abc`, not
  // `/api/products`. Those payloads are server-rendered for the current
  // session and carry the same branch-scoped rows the /api/ routes return
  // (stock levels, prices, customer details, sale totals).
  //
  // So these requests used to fall through to the catch-all networkFirst() at
  // the bottom and be written into DYNAMIC_CACHE: one cache entry, shared by
  // every user and branch, never varied on the cookie. On a dropped connection
  // the fallback would then serve Branch B's client the exact payload Branch A
  // had loaded. Guarding `/api/` while caching the identical data one layer up
  // was the same leak with the comments saying it had been prevented.
  //
  // Prefetches (`Next-Router-Prefetch: 1`) are partial and speculative, so they
  // must never be cached either.
  if (request.headers.get('RSC') === '1' || url.searchParams.has('_rsc')) {
    return;
  }

  if (
    url.pathname.startsWith('/_next/static/') ||
    STATIC_ASSETS.includes(url.pathname)
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (
    url.pathname.startsWith('/_next/') ||
    url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?)$/)
  ) {
    event.respondWith(cacheFirst(request, DYNAMIC_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, DYNAMIC_CACHE, 20000));
    return;
  }

  event.respondWith(networkFirst(request, DYNAMIC_CACHE, 15000));
});

async function cacheFirst(request, cacheName) {
  try {
    const cached = await caches.match(request);
    if (cached) return cached;
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: 'You are offline. Please check your connection.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function networkFirst(request, cacheName, timeoutMs) {
  // The timer is cleared on every exit path. It used to be left pending for the
  // whole timeout window whenever the fetch won the race, so a session that
  // walked a few hundred pages accumulated hundreds of live timers; on a
  // low-memory tablet that is real pressure, and the rejected promise from
  // each one is discarded silently.
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });

  try {
    const res = await Promise.race([fetch(request.clone()), timeoutPromise]);
    clearTimeout(timer);
    if (res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    clearTimeout(timer);
    try {
      const cached = await caches.match(request);
      if (cached) return cached;
    } catch {}
    if (request.mode === 'navigate') {
      return new Response(
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#1e293b;text-align:center;padding:20px}div{max-width:400px}h1{font-size:1.5rem;margin-bottom:8px}p{color:#64748b;font-size:0.875rem}</style></head><body><div><h1>You\'re Offline</h1><p>PharmaCare Pro needs an internet connection to load this page. Please check your connection and try again.</p></div></body></html>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=UTF-8' } }
      );
    }
    return new Response(
      JSON.stringify({ error: 'Network unavailable' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHES') {
    caches.keys().then((keys) => {
      return Promise.all(keys.map((k) => caches.delete(k)));
    });
  }
});
