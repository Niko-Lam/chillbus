/* ChillBus service worker — 只快取靜態外殼，實時資料一律走網絡 */
const VERSION = 'chillbus-v1';
const SHELL = [
  './',
  './index.html',
  './assets/style.css',
  './assets/icon.svg',
  './manifest.webmanifest',
  './assets/js/main.js',
  './assets/js/core.js',
  './assets/js/services.js',
  './assets/js/map.js',
  './assets/js/monitor.js',
  './assets/js/planner.js',
  './assets/js/views.js',
  './assets/js/editors.js',
  './assets/js/modal.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;          // 外部 API 一律直連
  if (url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    e.respondWith(fetch(request).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(request, copy)).catch(() => {});
      return res;
    }).catch(() => hit)),
  );
});
