/**
 * ============================================================================
 * sw.js - Service Worker for StudyBrain AI Offline App Shell & CDN Caching
 * ============================================================================
 * Caches the local application shell so StudyBrain AI launches and runs
 * reliably even when offline, and caches trusted CDN assets (PDF.js, JSZip,
 * Tesseract.js, Transformers.js, Google Fonts) on first use.
 */

const SHELL_CACHE = 'studybrain-shell-v1';
const CDN_CACHE = 'studybrain-cdn-v1';

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './worker.js',
  './manifest.json',
  './icon.svg'
];

const CACHEABLE_CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'unpkg.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const activeCaches = new Set([SHELL_CACHE, CDN_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !activeCaches.has(key))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/**
 * Network-first strategy for same-origin app shell assets so updates apply
 * immediately when online while falling back to cached shell offline.
 */
async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      return cache.match('./index.html');
    }
    throw err;
  }
}

/**
 * Cache-first strategy for immutable versioned CDN dependencies and fonts.
 */
async function cacheFirstCdn(request) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const networkResponse = await fetch(request);
  if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
    cache.put(request, networkResponse.clone());
  }
  return networkResponse;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirstShell(event.request));
    return;
  }

  if (CACHEABLE_CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirstCdn(event.request));
  }
});
