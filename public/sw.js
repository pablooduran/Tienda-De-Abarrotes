const STATIC_CACHE = 'administrau-static-v2';
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/assets/administrau-icon.png',
  '/assets/administrau-growth.png',
  '/css/styles.css',
  '/css/admin.css',
  '/js/pwa-install.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => /^(control-negocio-static-|administrau-static-)/.test(key) && key !== STATIC_CACHE)
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const isStaticAsset = url.pathname === '/manifest.webmanifest' ||
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/assets/');

  if (request.method !== 'GET' || url.origin !== self.location.origin || !isStaticAsset) {
    return;
  }

  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then((response) => {
        if (response.ok) {
          void caches.open(STATIC_CACHE).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
