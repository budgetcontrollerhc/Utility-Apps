const CACHE_NAME = 'my-apps-launcher-v1';
const SHELL_FILES = [
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// App shell: cache-first. Live data (Apps Script API calls) always goes to the network.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isApiCall = url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com');

  if (isApiCall) return; // never intercept API/auth calls

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
