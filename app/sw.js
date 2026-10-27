// Bei Änderungen an gecachten App-Dateien VERSION erhöhen.
const VERSION = 'hk-2026-10-27-1';
const STATIC_CACHE = `${VERSION}-static`;
const API_CACHE = `${VERSION}-api`;

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/app.js',
  '/assets/api.js',
  '/assets/engine.js',
  '/assets/formats.js',
  '/assets/measure.js',
  '/assets/styles.css',
  '/assets/print.css',
  '/assets/favicon.svg',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/icon-maskable-512.png',
  '/trades/3ddruck.json',
  '/trades/abbruch.json',
  '/trades/baumfaellung.json',
  '/trades/baustelle.json',
  '/trades/beton.json',
  '/trades/catering.json',
  '/trades/dachdecker.json',
  '/trades/erdbau.json',
  '/trades/event.json',
  '/trades/fliesenleger.json',
  '/trades/fotografie.json',
  '/trades/garten.json',
  '/trades/landwirtschaft.json',
  '/trades/maler.json',
  '/trades/pflaster.json',
  '/trades/reinigung.json',
  '/trades/tiefbau.json',
  '/trades/trockenbau.json',
  '/trades/umzug.json',
  '/trades/zaun.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => !key.startsWith(VERSION))
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request, fallbackUrl = null) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    return new Response('Offline nicht verfügbar', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ fehler: 'Offline – keine zwischengespeicherten Daten.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(cacheFirst(request, '/'));
    return;
  }

  event.respondWith(cacheFirst(request));
});
