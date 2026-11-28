const CACHE_NAME = 'x4sport-pwa-v1';

const BYPASSED_HOST_KEYWORDS = [
  'firebaseio.com',
  'firebasedatabase.app',
  'firebaseapp.com',
  'googleapis.com',
  'gstatic.com',
  'accounts.google.com',
  'dolarapi',
  'pydolar',
  'bcv',
  'binance',
  'exchangerate',
  'coingecko',
];

function shouldBypassRequest(request) {
  if (!request || request.method !== 'GET') return true;
  if (request.cache === 'no-store') return true;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return true;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;

  const hostLower = url.hostname.toLowerCase();
  if (BYPASSED_HOST_KEYWORDS.some((kw) => hostLower.includes(kw))) {
    return true;
  }

  // No cachear endpoints de API ni peticiones externas de datos
  if (url.origin !== self.location.origin) return true;
  if (url.pathname.startsWith('/api/')) return true;

  return false;
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled([
          cache.add('/manifest.webmanifest'),
          cache.add('/icon-192.png'),
          cache.add('/icon-512.png'),
        ]),
      )
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('x4sport-pwa-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (shouldBypassRequest(event.request)) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.ok &&
          networkResponse.type === 'basic'
        ) {
          const responseClone = networkResponse.clone();
          void caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, responseClone))
            .catch(() => undefined);
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          const fallbackIndex = await caches.match('/');
          if (fallbackIndex) return fallbackIndex;
        }
        return Response.error();
      }),
  );
});
