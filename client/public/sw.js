/**
 * Solana Token Monitor — Service Worker
 *
 * Strategy:
 *  - On install: pre-cache the app shell (HTML, fonts, icons, manifest).
 *  - On fetch:
 *      • Navigation requests  → network-first, fall back to cached shell.
 *      • Static assets        → cache-first (versioned by CACHE_NAME).
 *      • WebSocket / API      → always network-only (never cache).
 *  - On activate: delete stale caches from previous versions.
 */

const CACHE_NAME = 'solana-token-monitor-v1';

/** Resources to pre-cache on install */
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/favicon.svg',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

// ─── Install ────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate ───────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ──────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept WebSocket upgrades or non-GET requests
  if (request.method !== 'GET') return;

  // Never intercept WebSocket connections or API calls
  if (
    url.pathname.startsWith('/ws') ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // Never intercept cross-origin requests (e.g. Google Fonts)
  if (url.origin !== self.location.origin) {
    return;
  }

  // Navigation requests (HTML pages) → network-first, fall back to cached '/'
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache a fresh copy of the shell
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() =>
          caches.match('/').then(
            (cached) =>
              cached ||
              new Response('Offline — please reconnect.', {
                status: 503,
                headers: { 'Content-Type': 'text/plain' },
              })
          )
        )
    );
    return;
  }

  // Static assets → cache-first, update cache in background
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });

      // Return cached version immediately if available; otherwise wait for network
      return cached || networkFetch;
    })
  );
});
