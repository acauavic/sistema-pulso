// Service worker do painel Pulso (app instalado no celular e no computador).
// - Alertas (Web Push): mostra a notificação, atualiza o número no ícone do app e abre o item ao tocar.
// - Arquivos fixos (/static: CSS, JS, fontes, ícones) ficam guardados por versão, então o app abre rápido.
// - Páginas NÃO ficam guardadas (são dados da equipe e precisam estar sempre atualizadas): sem internet,
//   a navegação mostra a página "Sem conexão".
// A versão abaixo é trocada pelo servidor (hash dos arquivos) a cada deploy: o cache antigo é apagado sozinho.
const VERSION = '__ASSET_VERSION__';
const CACHE = `pulso-${VERSION}`;
const OFFLINE = '/static/offline.html';
const PRECACHE = [
  OFFLINE, '/static/offline.js', '/static/app.css', '/static/theme.js', '/static/favicon.svg', '/static/icon-192.png', '/static/badge-72.png',
  '/static/fonts/space-grotesk-latin-500-normal.woff2', '/static/fonts/space-grotesk-latin-600-normal.woff2', '/static/fonts/space-grotesk-latin-700-normal.woff2',
  '/static/fonts/inter-latin-400-normal.woff2', '/static/fonts/inter-latin-500-normal.woff2', '/static/fonts/inter-latin-600-normal.woff2',
  '/static/fonts/jetbrains-mono-latin-400-normal.woff2', '/static/fonts/jetbrains-mono-latin-500-normal.woff2', '/static/fonts/instrument-serif-latin-400-italic.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // um arquivo que falhe não impede a instalação (os alertas não podem depender do cache)
    await Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith('pulso-') && k !== CACHE).map((k) => caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // navegação: sempre da rede; sem internet, a página "Sem conexão"
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () => (await caches.match(OFFLINE)) || new Response('Sem conexão.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })));
    return;
  }
  // arquivos fixos: do cache (a URL leva ?v=versão); o que não estiver guardado vem da rede e fica guardado
  if (url.pathname.startsWith('/static/') && !url.pathname.endsWith('.html')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
  }
  // o resto (dados, envios, eventos em tempo real, anexos) passa direto para a rede
});

const setBadge = (n) => {
  if (typeof n !== 'number' || !self.navigator.setAppBadge) return Promise.resolve();
  return (n > 0 ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge()).catch(() => {});
};

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: event.data ? event.data.text() : '' }; }
  event.waitUntil((async () => {
    await setBadge(data.unread);
    // painel aberto e em primeiro plano: o aviso flutuante da própria página já mostra; não duplica
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (data.tag !== 'teste' && open.some((c) => c.focused && c.visibilityState === 'visible')) return;
    await self.registration.showNotification(data.title || 'Pulso', {
      body: data.body || '',
      tag: data.tag || undefined,
      icon: '/static/icon-192.png',
      badge: '/static/badge-72.png',
      data: { url: data.url || '/notificacoes' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/notificacoes', self.location.origin);
  if (target.origin !== self.location.origin) return; // só caminhos do próprio painel
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === target.origin);
    if (win) { await win.focus(); return win.navigate(target.href); }
    return self.clients.openWindow(target.href);
  })());
});
