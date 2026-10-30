// Pulso Podcast com Plateia (página pública): medição, formulário em duas etapas e abertura do WhatsApp.
(() => {
  const body = document.body;
  if (!body.hasAttribute('data-plateia')) return;
  const store = (() => { try { return window.localStorage; } catch { return null; } })();
  const get = (k) => { try { return store && store.getItem(k); } catch { return null; } };
  const put = (k, v) => { try { store && store.setItem(k, v); } catch { /* sem armazenamento */ } };

  // ---- quem é o visitante e de onde veio (UTMs ficam guardadas: a pessoa pode voltar depois, sem a URL da campanha)
  let visitor = get('pl_visitor');
  if (!visitor) { visitor = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40); put('pl_visitor', visitor); }
  const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
  const q = new URLSearchParams(window.location.search);
  let utm = {};
  try { utm = JSON.parse(get('pl_utm') || '{}'); } catch { utm = {}; }
  if (KEYS.some((k) => q.get(k))) { utm = {}; KEYS.forEach((k) => { if (q.get(k)) utm[k] = q.get(k); }); put('pl_utm', JSON.stringify(utm)); }
  let referrer = get('pl_ref') || '';
  if (!referrer && document.referrer && !document.referrer.startsWith(window.location.origin)) { referrer = document.referrer; put('pl_ref', referrer); }
  const landing = get('pl_landing') || (put('pl_landing', window.location.href.split('#')[0]), window.location.href.split('#')[0]);

  const send = (url, data, beacon) => {
    const json = JSON.stringify(data);
    if (beacon && navigator.sendBeacon) { try { if (navigator.sendBeacon(url, new Blob([json], { type: 'application/json' }))) return Promise.resolve(); } catch { /* cai no fetch */ } }
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true });
  };
  const track = (type, extra = {}, beacon = false) => send('/plateia/evento', { type, visitor_id: visitor, utm, referrer, ...extra }, beacon).catch(() => {});

  // ---- ferramentas de análise (só se a gestão informou os códigos): Meta Pixel e Google Analytics 4
  const pixel = body.dataset.metaPixel; const ga4 = body.dataset.ga4;
  const fire = (meta, gaName, params) => {
    try { if (pixel && window.fbq) window.fbq('track', meta, params || {}); } catch { /* ignora */ }
    try { if (ga4 && window.gtag) window.gtag('event', gaName, params || {}); } catch { /* ignora */ }
  };
  if (/^\d{5,20}$/.test(pixel || '')) {
    /* eslint-disable */
    !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq('init', pixel); window.fbq('track', 'PageView');
  }
  if (/^G-[A-Z0-9]{4,12}$/.test(ga4 || '')) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    const s = document.createElement('script'); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${ga4}`; document.head.appendChild(s);
    window.gtag('js', new Date()); window.gtag('config', ga4);
  }

  const pageGuest = Number(body.dataset.guest) || null; // página de um convidado: a visita conta para ele
  track('view', pageGuest ? { guest_id: pageGuest } : {});

  // ---- cliques na agenda
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-track="agenda_click"]');
    if (a) track('agenda_click', {}, true);
  });

  // ---- inscrição
  const dlg = document.getElementById('pl-modal');
  const form = document.getElementById('pl-form');
  const data = JSON.parse(document.getElementById('pl-data').textContent);
  const byCode = Object.fromEntries(data.countries.map((c) => [c.code, c]));
  const steps = { form: dlg.querySelector('[data-step="form"]'), review: dlg.querySelector('[data-step="review"]') };
  let current = null; let ref = null;
  const err = (k, msg) => { const el = dlg.querySelector(`[data-err="${k}"]`); if (el) el.textContent = msg || ''; };
  const show = (name) => { Object.keys(steps).forEach((k) => { steps[k].hidden = k !== name; }); };

  // mesma regra do servidor (o servidor é quem decide): avisa cedo, sem esperar a resposta
  function checkPhone(code, raw) {
    const c = byCode[code]; let d = String(raw || '').replace(/\D/g, '');
    if (!c) return 'Escolha o país do WhatsApp.';
    if (d.startsWith(c.dial) && d.length > c.max) d = d.slice(c.dial.length);
    if (code === 'BR') d = d.replace(/^0+/, '');
    if (d.length < c.min || d.length > c.max) return code === 'BR' ? 'Informe o WhatsApp com DDD, por exemplo (11) 91234-5678.' : 'Esse número parece incompleto ou longo demais.';
    if (code === 'BR' && !/^[1-9][1-9]/.test(d)) return 'O DDD parece inválido.';
    if (code === 'BR' && d.length === 11 && d[2] !== '9') return 'Celular com 11 dígitos começa com 9 depois do DDD.';
    return '';
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-signup]');
    if (!b) return;
    current = { id: Number(b.dataset.signup), name: b.dataset.name, date: b.dataset.date, time: b.dataset.time };
    ref = null;
    track('signup_click', { guest_id: current.id });
    track('form_open', { guest_id: current.id });
    fire('InitiateCheckout', 'begin_checkout', { content_name: current.name });
    dlg.querySelector('[data-episode]').textContent = `Episódio com ${current.name} · ${current.date}, às ${current.time}`;
    ['name', 'phone', 'terms', 'form'].forEach((k) => err(k, ''));
    form.elements.terms.checked = false;
    show('form');
    dlg.showModal();
    form.elements.name.focus();
  });
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    ['name', 'phone', 'terms', 'form'].forEach((k) => err(k, ''));
    const name = form.elements.name.value.replace(/\s+/g, ' ').trim();
    let bad = false;
    if (name.length < 5 || !name.includes(' ')) { err('name', 'Informe seu nome completo.'); bad = true; }
    const pe = checkPhone(form.elements.country.value, form.elements.phone.value);
    if (pe) { err('phone', pe); bad = true; }
    if (!form.elements.terms.checked) { err('terms', 'Para continuar, aceite as condições da plateia.'); bad = true; }
    if (bad || !current) return;
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      const res = await fetch('/plateia/inscricao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest_id: current.id, partner: body.dataset.partner || undefined, name, country: form.elements.country.value, phone: form.elements.phone.value, terms: form.elements.terms.checked, site: form.elements.site.value, visitor_id: visitor, utm, referrer, landing }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { err(json.field || 'form', json.error || 'Não foi possível enviar agora. Tente novamente.'); return; }
      ref = json.ref;
      fire('Lead', 'generate_lead', { content_name: current.name });
      const r = (k, v) => { dlg.querySelector(`[data-r="${k}"]`).textContent = v; };
      r('guest', current.name); r('date', current.date); r('time', current.time); r('duration', body.dataset.duration);
      r('price', json.exempt ? body.dataset.price : (json.price || body.dataset.price)); r('price-label', json.exempt ? 'Participação' : 'Investimento (se selecionado)');
      const wa = dlg.querySelector('[data-whatsapp]');
      if (json.url) { wa.href = json.url; wa.hidden = false; dlg.querySelector('[data-nowa]').hidden = true; } else { wa.hidden = true; dlg.querySelector('[data-nowa]').hidden = false; }
      show('review');
    } catch {
      err('form', 'Sem conexão. Confira a internet e tente de novo.');
    } finally {
      btn.disabled = false; btn.textContent = 'Revisar pedido';
    }
  });

  dlg.querySelector('[data-whatsapp]').addEventListener('click', () => {
    track('whatsapp', { ref, guest_id: current && current.id }, true);
    fire('Contact', 'contact', { content_name: current && current.name });
  });
})();
