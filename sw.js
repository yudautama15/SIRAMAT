// Service worker: aplikasi bisa dibuka offline, tile peta yang pernah dilihat disimpan
const APP_CACHE = 'survei-app-v2';
const TILE_CACHE = 'survei-tiles-v1';
const APP_FILES = ['./', './index.html', './app.js', './map.js', './sheet.js', './db.js',
  './manifest.json', './icon-192.png', './icon-512.png'];
const TILE_HOSTS = ['tile.openstreetmap.org', 'server.arcgisonline.com'];
const MAX_TILES = 6000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_FILES.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== APP_CACHE && k !== TILE_CACHE).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  if (keys.length > MAX_TILES) {
    for (const k of keys.slice(0, keys.length - MAX_TILES)) await c.delete(k);
  }
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) {
    e.respondWith(caches.open(TILE_CACHE).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      try {
        const res = await fetch(e.request);
        if (res.ok || res.type === 'opaque') { c.put(e.request, res.clone()); trimTiles(); }
        return res;
      } catch (err) {
        return new Response('', { status: 504 });
      }
    }));
    return;
  }
  if (url.origin === location.origin) {
    // network-first untuk file aplikasi (agar update terbaca), fallback ke cache saat offline
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
      const copy = res.clone();
      caches.open(APP_CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })
      .then(r => r || caches.match('./index.html'))));
  }
});
