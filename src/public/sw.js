// Service worker do painel Pulso: recebe os alertas (Web Push) e abre o item ao tocar.
// Não guarda páginas em cache: o painel sempre busca a versão nova no servidor.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: event.data ? event.data.text() : '' }; }
  event.waitUntil((async () => {
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
