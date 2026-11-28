// @ts-nocheck
const PWA_STATIC_ASSETS = {
  '/manifest.webmanifest': {
    contentType: 'application/manifest+json; charset=utf-8',
    cacheControl: 'public, max-age=3600',
  },
  '/sw.js': {
    contentType: 'application/javascript; charset=utf-8',
    cacheControl: 'no-cache, no-store, must-revalidate',
    serviceWorkerAllowed: '/',
  },
  '/icon-192.png': {
    contentType: 'image/png',
    cacheControl: 'public, max-age=86400',
  },
  '/icon-512.png': {
    contentType: 'image/png',
    cacheControl: 'public, max-age=86400',
  },
  '/apple-touch-icon.png': {
    contentType: 'image/png',
    cacheControl: 'public, max-age=86400',
  },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pwaMeta = PWA_STATIC_ASSETS[url.pathname];

    if (pwaMeta) {
      const assetReq = new Request(new URL(url.pathname, url.origin).toString(), {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: request.headers,
      });
      const assetResponse = await env.ASSETS.fetch(assetReq);
      const assetType = (assetResponse.headers.get('content-type') || '').toLowerCase();

      // Nunca permitir que un fallback SPA (text/html) responda en rutas de PWA
      if (!assetResponse.ok || assetType.includes('text/html')) {
        return new Response('PWA asset not found', {
          status: 404,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }

      const headers = new Headers(assetResponse.headers);
      headers.set('content-type', pwaMeta.contentType);
      headers.set('cache-control', pwaMeta.cacheControl);
      if (pwaMeta.serviceWorkerAllowed) {
        headers.set('service-worker-allowed', pwaMeta.serviceWorkerAllowed);
      }

      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers,
      });
    }

    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('text/html')) {
      return response;
    }
    const isCatalog =
      url.searchParams.get('catalogo') === '1' ||
      url.pathname === '/catalogo';

    const pageTitle = isCatalog ? 'Catálogo X4SPORT' : 'X4SPORT ERP';
    const pageDesc = isCatalog
      ? 'Stock disponible hoy · Camisetas de fútbol Player, Fans y Retro en Guacara, Carabobo. Consulta tallas y pide directo por WhatsApp.'
      : 'Sistema interno de gestión operativa, inventario, ventas, compras y matriz financiera de X4SPORT.';

    return new HTMLRewriter()
      .on('title', {
        element(el) {
          el.setInnerContent(pageTitle);
        },
      })
      .on('meta[name="description"]', {
        element(el) {
          el.setAttribute('content', pageDesc);
        },
      })
      .on('meta[property="og:title"]', {
        element(el) {
          el.setAttribute('content', pageTitle);
        },
      })
      .on('meta[property="og:description"]', {
        element(el) {
          el.setAttribute('content', pageDesc);
        },
      })
      .on('meta[name="twitter:title"]', {
        element(el) {
          el.setAttribute('content', pageTitle);
        },
      })
      .on('meta[name="twitter:description"]', {
        element(el) {
          el.setAttribute('content', pageDesc);
        },
      })
      .transform(response);
  },
};
