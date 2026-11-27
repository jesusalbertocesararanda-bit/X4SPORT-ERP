// @ts-nocheck
export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('text/html')) {
      return response;
    }

    const url = new URL(request.url);
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
