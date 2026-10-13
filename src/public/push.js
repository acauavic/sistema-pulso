// Alertas no navegador. Duas camadas:
// 1) Web Push (service worker /sw.js): chega mesmo com o painel fechado. Ligado por aparelho em Notificações.
// 2) Reserva: com a aba aberta mas em segundo plano, a notificação em tempo real vira alerta do sistema
//    (quando a pessoa permitiu alertas e este aparelho não tem push, para não avisar duas vezes).
(function () {
  const csrf = document.querySelector('meta[name="csrf"]')?.content || '';
  const supported = 'serviceWorker' in navigator && 'Notification' in window;
  const pushSupported = supported && 'PushManager' in window;
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) })
    .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(j.error || `erro ${r.status}`); return j; });
  const reg = supported ? navigator.serviceWorker.register('/sw.js').catch(() => null) : Promise.resolve(null);
  const currentSub = async () => { const r = await reg; return r && pushSupported ? r.pushManager.getSubscription() : null; };

  window.pulsoBrowserAlert = async (n) => {
    if (!supported || !document.hidden || Notification.permission !== 'granted') return;
    if (await currentSub()) return; // o push já avisa este aparelho
    const r = await reg; if (!r) return;
    r.showNotification(n.title || 'Pulso', { body: n.body || '', tag: n.id ? `n-${n.id}` : undefined, icon: '/static/icon-192.png', badge: '/static/badge-72.png', data: { url: n.url || '/notificacoes' } });
  };

  // ---------------------------------------------------------------- Notificações > Alertas neste aparelho
  const box = document.querySelector('[data-push]');
  if (!box) return;
  const key = box.dataset.pushKey || '';
  const status = box.querySelector('[data-push-status]');
  const btnOn = box.querySelector('[data-push-on]');
  const btnOff = box.querySelector('[data-push-off]');
  const btnTest = box.querySelector('[data-push-test]');
  const hint = box.querySelector('[data-push-hint]');
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const b64ToBytes = (b64) => { const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
  const say = (text, tip = '') => { status.textContent = text; hint.textContent = tip; hint.hidden = !tip; };
  const show = (on) => { btnOn.hidden = on; btnOff.hidden = !on; btnTest.hidden = !on; };

  async function render() {
    box.hidden = false;
    if (!pushSupported) {
      show(false); btnOn.hidden = true;
      return say('Este navegador não recebe alertas.', isIos && !standalone ? 'No iPhone: toque em Compartilhar > Adicionar à Tela de Início e abra o Pulso por lá para ligar os alertas.' : 'Use Chrome, Edge, Firefox ou Safari atualizados.');
    }
    if (Notification.permission === 'denied') { show(false); btnOn.hidden = true; return say('Alertas bloqueados neste navegador.', 'Libere as notificações nas configurações do site (cadeado ao lado do endereço) e recarregue a página.'); }
    if (!key) { show(false); btnOn.hidden = true; return say('Alertas com o painel fechado ainda não estão configurados no servidor.'); }
    const sub = await currentSub();
    show(Boolean(sub));
    say(sub ? 'Ligados neste aparelho. Os avisos chegam mesmo com o painel fechado.' : 'Desligados neste aparelho.');
  }

  btnOn.addEventListener('click', async () => {
    btnOn.disabled = true;
    try {
      if (await Notification.requestPermission() !== 'granted') return render();
      const r = await reg; if (!r) throw new Error('Não consegui preparar o navegador. Recarregue a página.');
      await navigator.serviceWorker.ready;
      const sub = (await r.pushManager.getSubscription()) || await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      await post('/notificacoes/push/inscrever', { subscription: sub.toJSON() });
      await render();
    } catch (err) { say(err.message || 'Não deu para ligar os alertas.'); } finally { btnOn.disabled = false; }
  });
  btnOff.addEventListener('click', async () => {
    const sub = await currentSub();
    if (sub) { await post('/notificacoes/push/sair', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
    render();
  });
  btnTest.addEventListener('click', async () => {
    btnTest.disabled = true;
    try { await post('/notificacoes/push/teste', {}); say('Alerta de teste enviado. Deve aparecer em alguns segundos.'); } catch (err) { say(err.message); } finally { btnTest.disabled = false; }
  });
  render();
}());
