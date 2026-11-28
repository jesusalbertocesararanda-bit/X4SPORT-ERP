const CACHE_NAME = 'x4sport-pwa-v2';

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

  // Ignorar peticiones externas, APIs y endpoints dinámicos
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

  // Solo atender navegación para criterios de instalabilidad sin cachear datos dinámicos
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cachedRoot = await caches.match('/');
        return cachedRoot || Response.error();
      }),
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification && event.notification.data ? event.notification.data : {};
  const targetView = typeof data.view === 'string' && data.view.trim() ? data.view.trim() : '';
  const targetUrl =
    typeof data.url === 'string' && data.url.trim()
      ? data.url.trim()
      : targetView
        ? `/?view=${encodeURIComponent(targetView)}`
        : '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            await client.focus();
            if (targetView && typeof client.postMessage === 'function') {
              client.postMessage({
                type: 'X4SPORT_NAVIGATE_VIEW',
                view: targetView,
                url: targetUrl,
              });
            }
            return;
          }
        }
        if (self.clients.openWindow) {
          await self.clients.openWindow(targetUrl);
        }
      })
      .catch(() => undefined),
  );
});
