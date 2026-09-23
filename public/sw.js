// public/sw.js -- the site as an app on a phone: installable, and able to
// show chapters already read when there is no connection.
//
// What it keeps, and nothing else:
//   - the stylesheets, scripts, fonts and icons, refreshed in the background;
//   - each chapter page as it was last opened, so a chapter begun on the
//     train can be finished in the tunnel.
// Everything that changes something (every POST) goes straight to the
// network, always. A signed-out page (the login form) clears the kept
// chapters, so a shared device does not keep somebody's reading.
(function () {
'use strict';

const STATIC = 'swarm-static-v3';
const PAGES = 'swarm-pages-v1';
const KEEP_PAGES = 40;
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll([OFFLINE, '/css/style.css'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k !== STATIC && k !== PAGES).map((k) => caches.delete(k))
  )).then(() => self.clients.claim()));
});

const isStatic = (url) => /^\/(css|js|fonts|icons|dictionary)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest';
const isChapter = (url) => /^\/chapters\/\d+$/.test(url.pathname) && !url.search;

async function trimPages() {
  const cache = await caches.open(PAGES);
  const keys = await cache.keys();
  for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_PAGES))) await cache.delete(old);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isStatic(url)) {
    // Serve what is kept, and fetch a fresh copy for next time.
    event.respondWith(caches.open(STATIC).then(async (cache) => {
      const kept = await cache.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => kept);
      return kept || fresh;
    }));
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const landed = new URL(res.url || req.url);
        if (landed.pathname === '/login') {
          // Signed out: nothing of theirs stays on this device.
          await caches.delete(PAGES);
        } else if (res.ok && isChapter(url)) {
          const cache = await caches.open(PAGES);
          await cache.put(req, res.clone());
          trimPages();
        }
        return res;
      } catch (err) {
        const kept = await caches.match(req, { cacheName: PAGES });
        return kept || (await caches.match(OFFLINE)) || Response.error();
      }
    })());
  }
});
})();
