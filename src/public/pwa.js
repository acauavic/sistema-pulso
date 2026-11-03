// App instalado (PWA). Três momentos da jornada no celular:
// 1) no navegador: convite para instalar (Android/computador usam o pedido nativo; iPhone abre a janela com os passos);
// 2) já instalado: convite para ligar os alertas deste aparelho (push.js faz a inscrição);
// 3) sempre: aviso discreto quando a conexão cai e volta.
// O cartão só aparece no Início e, dispensado, some por 14 dias. "Instalar o app" também fica no rodapé do menu.
(function () {
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage bloqueado */ } },
  };
  const QUIET_MS = 14 * 86400000;
  const quiet = (k) => Number(store.get(k) || 0) > Date.now() - QUIET_MS;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const mobile = window.matchMedia('(max-width: 860px), (pointer: coarse)').matches;
  if (standalone) document.documentElement.classList.add('is-app');

  let deferred = null; // pedido de instalação guardado (Chrome, Edge, Samsung Internet)
  const installBtns = document.querySelectorAll('[data-pwa-install]');
  const iosDialog = document.getElementById('modal-pwa-ios');
  const canInstall = () => !standalone && Boolean(deferred || isIos);

  const card = document.querySelector('[data-app-card]');
  const el = card && {
    title: card.querySelector('[data-app-card-title]'),
    body: card.querySelector('[data-app-card-body]'),
    go: card.querySelector('[data-app-card-go]'),
    close: card.querySelector('[data-app-card-close]'),
  };
  let mode = ''; // 'install' | 'push'
  const showCard = (m, title, body, go) => { mode = m; el.title.textContent = title; el.body.textContent = body; el.go.textContent = go; el.go.disabled = false; el.go.hidden = false; card.hidden = false; };
  const hideCard = () => { if (card) card.hidden = true; mode = ''; };

  async function render() {
    installBtns.forEach((b) => { b.hidden = !canInstall(); });
    if (!card || !mobile) return;
    if (canInstall() && !quiet('pulso-app-install')) {
      return showCard('install', 'Use o Pulso como app', 'Fica na tela de início, abre em tela cheia e recebe os alertas mesmo fechado.', 'Instalar');
    }
    if (standalone && window.PulsoPush && !quiet('pulso-app-push') && await window.PulsoPush.state() === 'off') {
      return showCard('push', 'Ligue os alertas deste celular', 'Tarefas, prazos e respostas de convidados chegam como notificação, com o app fechado.', 'Ativar alertas');
    }
    return hideCard();
  }

  async function install() {
    if (deferred) {
      const ask = deferred; deferred = null;
      ask.prompt();
      await ask.userChoice.catch(() => null);
      return render();
    }
    if (isIos && iosDialog && !iosDialog.open) iosDialog.showModal();
    return null;
  }

  async function enableAlerts() {
    el.go.disabled = true;
    try {
      await window.PulsoPush.enable();
      el.title.textContent = 'Alertas ligados.';
      el.body.textContent = 'Os avisos chegam mesmo com o app fechado. Dá para desligar em Notificações > Avisos.';
      el.go.hidden = true;
      setTimeout(hideCard, 5000);
    } catch (err) {
      const [msg, tip] = window.PulsoPush.explain(err);
      el.body.textContent = tip ? `${msg} ${tip}` : msg;
      el.go.textContent = 'Tentar de novo';
      el.go.disabled = false;
    }
  }

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; render(); });
  window.addEventListener('appinstalled', () => { deferred = null; store.set('pulso-app-install', String(Date.now())); render(); });
  installBtns.forEach((b) => b.addEventListener('click', install));
  if (card) {
    el.go.addEventListener('click', () => (mode === 'install' ? install() : enableAlerts()));
    el.close.addEventListener('click', () => { store.set(mode === 'push' ? 'pulso-app-push' : 'pulso-app-install', String(Date.now())); hideCard(); });
  }
  render();

  // conexão: aviso curto ao cair e ao voltar (o service worker mostra a página "Sem conexão" se a navegação falhar)
  window.addEventListener('offline', () => window.pulsoToast?.({ title: 'Sem conexão', body: 'O que você enviar agora pode não ser salvo. Assim que a internet voltar, siga normalmente.', tone: 'warn' }));
  window.addEventListener('online', () => window.pulsoToast?.({ title: 'Conexão de volta' }));
}());
