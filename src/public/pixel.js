// Meta Pixel das páginas públicas de patrocinador e convidado (a plateia tem o dela em plateia.js).
// Uso: <script src="/static/pixel.js" data-pixel="ID" data-content="Media kit" data-category="patrocinador" defer></script>
// Dispara PageView e ViewContent (nome e categoria da página). Páginas com endereço secreto chegam aqui já com o endereço limpo.
(() => {
  const me = document.currentScript;
  const id = me && me.dataset.pixel;
  if (!/^\d{5,20}$/.test(id || '')) return;
  /* eslint-disable */
  !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  window.fbq('init', id);
  window.fbq('track', 'PageView');
  const params = {};
  if (me.dataset.content) params.content_name = me.dataset.content;
  if (me.dataset.category) params.content_category = me.dataset.category;
  window.fbq('track', 'ViewContent', params);
})();
