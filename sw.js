// Service worker: offline-capable app shell, NETWORK-FIRST.
// Same-origin GETs always go to the network with `cache: 'no-cache'` (a cheap 304 revalidation that also
// bypasses the 10-minute HTTP cache of GitHub Pages), so one boot never mixes modules of two deploys.
// The SW cache is only the offline fallback. VERSION is written by tools/stamp.mjs ('wos-' + BUILD_ID).
const VERSION = 'wos-8d42a8cbe9fa';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './src/main.js', './src/ui/hud.css'])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      // a navigation Request can't be re-issued with a RequestInit (TypeError → the stale offline copy was served):
      // navigations fetch the URL afresh instead
      const res = req.mode === 'navigate' ? await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : await fetch(req, { cache: 'no-cache' });
      if (res.ok) e.waitUntil(cache.put(req, res.clone()).catch(() => {}));
      return res;
    } catch {
      // offline: last good copy, else the app shell
      return (await cache.match(req, { ignoreSearch: req.mode === 'navigate' })) || (await cache.match('./index.html')) || Response.error();
    }
  })());
});
