/**
 * Minimal service worker — exists to satisfy "installable PWA" criteria
 * (Chrome/Android's install prompt requires one with a real `fetch` handler)
 * and to let the app shell launch instantly/offline once visited, not to
 * cache API responses. Bumping `CACHE_NAME` invalidates every previously
 * cached asset on the next visit — do that whenever the caching strategy
 * itself changes, not on every deploy (stale-while-revalidate below already
 * keeps cached assets fresh across ordinary deploys).
 */
const CACHE_NAME = 'chessscope-shell-v1';

self.addEventListener('install', (event) => {
  // Activate immediately rather than waiting for every open tab of the old
  // version to close first — reasonable for a personal tool with no
  // in-flight-transaction risk across a reload, unlike a banking app.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never intercept the backend API or the analysis-progress WebSocket:
  // this app is live data (bot moves, running analysis jobs), and a cached
  // API response would be a real correctness bug, not a convenience. Not
  // calling `respondWith` here means the browser's own default network
  // fetch happens completely untouched.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return;
  // Cross-origin requests (the backend on a different host/port in dev, any
  // CDN/font host) are equally out of scope — this only ever shells the
  // frontend's own static assets.
  if (url.origin !== self.location.origin) return;

  // Stale-while-revalidate: answer instantly from cache when there is one
  // (including offline), while always refreshing the cache from the network
  // in the background — so a stale asset is visible for at most one reload
  // after a new deploy, never permanently.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});
