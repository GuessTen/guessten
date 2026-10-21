// Guessten service worker — cache the app shell for fast loads and offline play
const CACHE = 'guessten-v202610211354';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=202610211354',
  './app.js?v=202610211354',
  './config.js?v=202610211354',
  './categories.js?v=202610211354',
  './supabase-client.js?v=202610211354',
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
  if (e.request.method !== 'GET') return;
  // Network-first for EVERYTHING (Supabase calls and app assets alike):
  // the app must always run the latest deployed code when online — a
  // cache-first shell left players stuck on old builds with broken buttons.
  // The cache is only a fallback for genuinely offline use.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res && res.ok && !e.request.url.includes('supabase.co')) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() =>
      caches.match(e.request).then((hit) => hit || caches.match('./index.html'))
    )
  );
});

