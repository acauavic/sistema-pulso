// Cloudflare Turnstile ("não sou robô"): carrega o widget do Cloudflare nas caixas [data-turnstile="<chave pública>"].
// Aparece só quando o Cloudflare desconfia da visita (appearance: interaction-only); quase sempre ninguém vê nada.
// Formulário comum: se a pessoa enviar antes da confirmação, espera ela chegar e envia sozinho.
// Quem envia por fetch (estúdio, plateia) marca a caixa com data-ts-manual e usa window.PulsoTurnstile.
(function () {
  'use strict';
  const boxes = [...document.querySelectorAll('[data-turnstile]')];
  if (!boxes.length) return;
  const state = new Map(); // caixa -> { id, token, waiters }
  let api = null; const apiWaiters = [];
  const whenApi = () => new Promise((resolve) => { if (api) resolve(api); else apiWaiters.push(resolve); });

  function render(box) {
    if (state.has(box)) return state.get(box);
    const st = { id: null, token: null, waiters: [] };
    state.set(box, st);
    whenApi().then((ts) => {
      st.id = ts.render(box, {
        sitekey: box.dataset.turnstile,
        action: box.dataset.tsAction || undefined,
        appearance: 'interaction-only',
        theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
        language: 'pt-br',
        callback(token) {
          st.token = token;
          st.waiters.splice(0).forEach((fn) => fn(token));
          box.dispatchEvent(new CustomEvent('turnstile:ok', { detail: token, bubbles: true }));
        },
        'expired-callback'() { st.token = null; ts.reset(st.id); },
        'error-callback'() { st.token = null; return false; }, // o próprio widget tenta de novo
      });
    });
    return st;
  }

  // Token da caixa; espera até `ms` (null se não chegar: o servidor decide e mostra a mensagem).
  function token(box, ms = 15000) {
    const st = render(box);
    if (st.token) return Promise.resolve(st.token);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), ms);
      st.waiters.push((tok) => { clearTimeout(t); resolve(tok); });
    });
  }
  // Depois de usar o token (ele vale uma vez só), pede outro.
  function reset(box) {
    const st = state.get(box);
    if (!st) return;
    st.token = null;
    if (api && st.id != null) api.reset(st.id);
  }
  window.PulsoTurnstile = { render, token, reset };

  // formulário comum: segura o envio até a confirmação chegar (captura: roda antes dos outros "submit")
  document.addEventListener('submit', (e) => {
    const form = e.target;
    const box = form.querySelector && form.querySelector('[data-turnstile]:not([data-ts-manual])');
    if (!box) return;
    const st = render(box);
    if (st.token || form.dataset.tsSent) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const btn = form.querySelector('button[type=submit]');
    if (btn) { btn.disabled = true; btn.dataset.tsLabel = btn.textContent; btn.textContent = 'Confirmando…'; }
    token(box).then(() => {
      form.dataset.tsSent = '1';
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.tsLabel; }
      if (form.requestSubmit) form.requestSubmit(btn || undefined); else form.submit();
    });
  }, true);

  window.__pulsoTurnstileLoad = function () {
    api = window.turnstile;
    apiWaiters.splice(0).forEach((fn) => fn(api));
  };
  boxes.filter((b) => !b.hasAttribute('data-ts-lazy')).forEach(render);
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__pulsoTurnstileLoad';
  s.async = true; s.defer = true;
  document.head.appendChild(s);
}());
