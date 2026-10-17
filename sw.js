// Guessten service worker — cache the app shell for fast loads and offline play
const CACHE = 'guessten-v202610170422';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=202610170422',
  './app.js?v=202610170422',
  './config.js?v=202610170422',
  './categories.js?v=202610170422',
  './supabase-client.js?v=202610170422',
  './manifest.json',
  './mascot.png',
  './dragon-bg.svg',
  './avatars/jake.webp',
  './avatars/kevin.webp',
  './avatars/alex.webp',
  './avatars/joey.webp'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Network-first for Supabase API calls (live scores must be fresh)
  if (e.request.url.includes('supabase.co')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // Cache-first for app assets
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    )
  );
});

