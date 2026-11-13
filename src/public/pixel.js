// Meta Pixel das páginas públicas de patrocinador e convidado (a plateia tem o dela em plateia.js).
// Uso: <script src="/static/pixel.js" data-pixel="ID" data-content="Media kit" data-category="patrocinador" defer></script>
// Dispara PageView e ViewContent (nome e categoria da página). Páginas com endereço secreto chegam aqui já com o endereço limpo.
(() => {
  const me = document.currentScript;
  const id = me && me.dataset.pixel;
  if (!/^\d{5,20}$/.test(id || '')) return;
  // Scripts de terceiros (Meta, Google) só baixam depois que a página terminou de carregar e o navegador ficou livre:
  // não disputam a rede com a foto e o texto do topo. Até lá, os eventos ficam numa fila (fbq/dataLayer) e saem depois.
  const later = (fn) => { const go = () => (window.requestIdleCallback || ((f) => setTimeout(f, 1)))(fn, { timeout: 3000 }); if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true }); };
  const addScript = (src) => later(() => { const s = document.createElement('script'); s.async = true; s.src = src; document.head.appendChild(s); });
  const fbStub = () => {
    if (window.fbq) return;
    const n = function () { if (n.callMethod) n.callMethod.apply(n, arguments); else n.queue.push(arguments); };
    window.fbq = n; if (!window._fbq) window._fbq = n;
    n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    addScript('https://connect.facebook.net/en_US/fbevents.js');
  };
  fbStub();
  window.fbq('init', id);
  window.fbq('track', 'PageView');
  const params = {};
  if (me.dataset.content) params.content_name = me.dataset.content;
  if (me.dataset.category) params.content_category = me.dataset.category;
  window.fbq('track', 'ViewContent', params);
})();
