// Envios em segundo plano. Uma fila única (window.PulsoUploads) manda os arquivos em partes ao servidor enquanto a pessoa
// continua usando o sistema; uma bandeja no canto mostra o andamento em qualquer tela.
//
// Como o painel é feito de páginas inteiras, trocar de página destruiria o envio. Por isso, enquanto houver envio ativo, os
// links e formulários abrem num quadro (<iframe>) por cima da página que está enviando: ela fica viva por baixo, escondida.
// Sem envio ativo nada disso acontece e a navegação é a de sempre. Sem inline script (CSP 'self').
(function () {
  'use strict';
  const FRAME_NAME = 'pulso-shell';

  // Página dentro do quadro: usa a fila da janela de cima.
  let host = window;
  if (window.top !== window) { try { if (window.top.document && window.top.PulsoUploads) host = window.top; } catch { /* outra origem */ } }
  if (host !== window) {
    window.PulsoUploads = host.PulsoUploads;
    window.addEventListener('submit', (e) => guardLogout(e, host.PulsoUploads));
    return;
  }

  const FILE_LIMIT = 4; // arquivos ao mesmo tempo
  const PART_LIMIT = 4; // partes em voo no total
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmtBytes = (n) => {
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let x = n;
    while (x >= 1024 && i < u.length - 1) { x /= 1024; i += 1; }
    return `${x >= 100 || i === 0 ? Math.round(x) : x.toFixed(1).replace('.', ',')} ${u[i]}`;
  };
  const fmtEta = (s) => {
    if (!Number.isFinite(s) || s < 0) return '';
    if (s < 60) return 'menos de 1 min';
    if (s < 3600) return `${Math.ceil(s / 60)} min`;
    return `${Math.floor(s / 3600)} h ${Math.ceil((s % 3600) / 60)} min`;
  };

  const items = [];
  const listeners = new Set();
  let seq = 0;
  let running = 0;
  let slots = PART_LIMIT;
  const waiters = [];
  const acquire = () => (slots > 0 ? (slots -= 1, Promise.resolve()) : new Promise((r) => waiters.push(r)));
  const release = () => { const w = waiters.shift(); if (w) w(); else slots += 1; };
  const online = () => (navigator.onLine ? Promise.resolve() : new Promise((r) => window.addEventListener('online', r, { once: true })));
  const emit = (ev) => listeners.forEach((fn) => { try { fn(ev); } catch { /* um ouvinte quebrado não derruba a fila */ } });

  const ACTIVE = ['queued', 'starting', 'sending', 'finishing'];
  const isActive = (it) => ACTIVE.includes(it.status);
  const activeCount = () => items.filter(isActive).length;
  const bytesDone = (it) => it.doneBytes + Object.values(it.live).reduce((a, b) => a + b, 0);

  // ---------------------------------------------------------------- rede
  class HttpError extends Error { constructor(msg, status, code = '') { super(msg); this.status = status; this.code = code; } }
  // Armazenamento cheio (507): não adianta insistir. A fila inteira para com uma mensagem só, até alguém tentar de novo.
  let blocked = '';
  const isFull = (err) => err && (err.status === 507 || err.code === 'storage_full');
  const failText = (body, status) => body.error || (status >= 500 ? 'o servidor de arquivos não respondeu' : `erro ${status}`);

  async function json(it, url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { Accept: 'application/json', 'x-csrf-token': it.ctx.csrf, ...(opts.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new HttpError(failText(body, res.status), res.status, body.code || '');
    return body;
  }

  function put(it, url, blob, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      it.xhrs.add(xhr);
      xhr.open('PUT', url);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('x-csrf-token', it.ctx.csrf);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
      xhr.onload = () => {
        it.xhrs.delete(xhr);
        let body = {}; try { body = JSON.parse(xhr.responseText); } catch { /* resposta sem corpo */ }
        if (xhr.status >= 200 && xhr.status < 300 && body.ok) resolve();
        else reject(new HttpError(failText(body, xhr.status), xhr.status, body.code || ''));
      };
      xhr.onerror = () => { it.xhrs.delete(xhr); reject(new HttpError('sem conexão', 0)); };
      xhr.onabort = () => { it.xhrs.delete(xhr); reject(new HttpError('cancelado', -1)); };
      xhr.send(blob);
    });
  }

  // ---------------------------------------------------------------- um arquivo
  const partBytes = (it, n) => (n < it.totalParts ? it.partSize : it.file.size - it.partSize * (it.totalParts - 1));

  async function sendPart(it, n) {
    const start = (n - 1) * it.partSize;
    const blob = it.file.slice(start, Math.min(it.file.size, start + it.partSize));
    for (let attempt = 1; ; attempt += 1) {
      if (it.aborted) throw new HttpError('cancelado', -1);
      await acquire();
      try {
        it.live[n] = 0;
        await put(it, `${it.ctx.base}${it.serverId}/parte/${n}`, blob, (loaded) => { it.live[n] = loaded; changed(); });
        it.doneBytes += blob.size;
        delete it.live[n];
        return;
      } catch (err) {
        delete it.live[n];
        if (it.aborted || err.status === -1) throw new HttpError('cancelado', -1);
        if (isFull(err)) throw err;
        if (err.status >= 400 && err.status < 500 && err.status !== 429 && err.status !== 408) throw err; // erro do pedido: repetir não adianta
        if (!navigator.onLine) { it.note = 'sem internet, retoma sozinho'; changed(); await online(); attempt -= 1; continue; }
        if (attempt >= 5) throw err;
        it.note = `reenviando parte ${n} (tentativa ${attempt + 1})`; changed();
        await sleep(1500 * attempt);
      } finally { release(); }
    }
  }

  async function start(it) {
    it.status = 'starting'; it.error = ''; it.note = ''; changed();
    let have = new Set();
    if (it.serverId) { // retomar: pergunta ao servidor quais partes já chegaram (se ele não souber, recomeça do zero)
      try {
        const r = await json(it, `${it.ctx.base}${it.serverId}/partes`);
        if (r.status !== 'enviando' || (r.size && r.size !== it.file.size)) throw new HttpError('outro arquivo', 409);
        if (r.partSize) { it.partSize = r.partSize; it.totalParts = r.totalParts; }
        have = new Set(r.parts);
      } catch (err) {
        if (err.status === 401 || err.status === 403) throw err;
        json(it, `${it.ctx.base}${it.serverId}/cancelar`, { method: 'POST' }).catch(() => {});
        it.serverId = null;
      }
    }
    if (!it.serverId) {
      const init = await json(it, `${it.ctx.base}iniciar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: it.kind, rotulo: it.label, nome: it.file.name, tamanho: it.file.size, tipo: it.file.type, substituir: it.replaceId || '' }),
      });
      it.serverId = init.id; it.partSize = init.partSize; it.totalParts = init.totalParts;
    }
    it.doneBytes = 0; it.live = {};
    const pending = [];
    for (let n = 1; n <= it.totalParts; n += 1) { if (have.has(n)) it.doneBytes += partBytes(it, n); else pending.push(n); }
    it.status = 'sending'; changed();
    const workers = Array.from({ length: Math.min(PART_LIMIT, pending.length) }, async () => {
      while (pending.length && !it.failed) {
        try { await sendPart(it, pending.shift()); } catch (err) { it.failed = true; throw err; }
      }
    });
    const results = await Promise.allSettled(workers);
    const bad = results.find((r) => r.status === 'rejected');
    if (bad) throw bad.reason;
    it.status = 'finishing'; changed();
    await json(it, `${it.ctx.base}${it.serverId}/concluir`, { method: 'POST' });
  }

  async function run(it) {
    running += 1;
    it.failed = false;
    try {
      await start(it);
      it.status = 'done'; it.note = '';
      emit({ type: 'file-done', item: it });
    } catch (err) {
      if (it.aborted) { it.status = 'canceled'; } else if (isFull(err)) {
        blocked = err.message; it.status = 'error'; it.error = 'armazenamento cheio'; it.fatal = false;
        items.filter((x) => x.status === 'queued' && !x.started).forEach((x) => { x.status = 'error'; x.error = 'parado: armazenamento cheio'; x.fatal = false; });
      } else {
        it.status = 'error'; it.error = err.message || 'erro desconhecido';
        it.fatal = err.status === 409 || err.status === 422 || err.status === 401 || err.status === 403; // o servidor recusou: tentar de novo não muda nada
      }
    } finally {
      it.live = {}; it.xhrs.clear();
      running -= 1; changed(); pump();
      if (!activeCount()) finishBatch();
    }
  }

  function pump() {
    while (running < FILE_LIMIT && !blocked) {
      const next = items.find((it) => it.status === 'queued' && !it.started);
      if (!next) return;
      next.started = true;
      run(next);
    }
  }

  let batchBases = new Set();
  function finishBatch() {
    const done = items.filter((it) => it.status === 'done');
    if (done.length) emit({ type: 'all-done', bases: [...batchBases], ok: done.length, failed: items.filter((it) => it.status === 'error').length });
    batchBases = new Set();
    scheduleHide();
  }

  // ---------------------------------------------------------------- API
  function add(entries, ctx) {
    const wrap = (file) => (file instanceof File ? file : new File([file], file.name, { type: file.type, lastModified: file.lastModified })); // cópia leve (mesmo conteúdo) no mundo da janela de cima
    entries.forEach((e) => {
      items.push({
        id: (seq += 1), file: wrap(e.file), kind: e.kind, label: e.label || '', ctx, status: 'queued', started: false, aborted: false,
        serverId: e.resumeId || null, replaceId: e.replaceId || null, resumed: Boolean(e.resumeId),
        partSize: 0, totalParts: 0, doneBytes: 0, live: {}, xhrs: new Set(), error: '', note: '', fatal: false,
      });
      batchBases.add(ctx.base);
    });
    expanded = true; userToggled = false; blocked = '';
    clearTimeout(hideTimer);
    pump(); changed();
    return entries.length;
  }
  function cancel(it) {
    if (it.status === 'done' || it.status === 'canceled') return;
    it.aborted = true;
    it.xhrs.forEach((x) => x.abort());
    if (it.serverId) json(it, `${it.ctx.base}${it.serverId}/cancelar`, { method: 'POST' }).catch(() => {});
    if (!isActive(it) || it.status === 'queued') it.status = 'canceled';
    changed();
    if (!activeCount()) finishBatch();
  }
  function retry(it) {
    if (it.status !== 'error' || it.fatal) return;
    blocked = '';
    it.aborted = false; it.status = 'queued'; it.started = false; it.failed = false;
    batchBases.add(it.ctx.base);
    clearTimeout(hideTimer);
    pump(); changed();
  }
  const retryAll = () => { blocked = ''; items.filter((x) => x.status === 'error' && !x.fatal).forEach(retry); };
  // Este arquivo já está na fila (na mesma pasta de destino)? A janela de envio usa para não mandar duas vezes.
  const has = (base, name, size) => items.some((x) => isActive(x) && x.ctx.base === base && x.file.name === name && x.file.size === size);
  window.PulsoUploads = { add, has, retryAll, active: activeCount, on(fn) { listeners.add(fn); return () => listeners.delete(fn); }, fmtBytes };

  // ---------------------------------------------------------------- avisos ao sair
  window.addEventListener('beforeunload', (e) => { if (activeCount()) { e.preventDefault(); e.returnValue = ''; } });

  function guardLogout(e, U) {
    if (e.defaultPrevented || !U || !U.active()) return;
    const action = e.target && e.target.getAttribute && e.target.getAttribute('action');
    if (action === '/logout' && !window.confirm('Há arquivos sendo enviados. Sair agora interrompe os envios. Sair mesmo?')) e.preventDefault();
  }
  window.addEventListener('submit', (e) => guardLogout(e, window.PulsoUploads));

  // ---------------------------------------------------------------- navegação sem derrubar o envio
  let frame = null;
  function ensureFrame() {
    if (frame) return frame;
    frame = document.createElement('iframe');
    frame.name = FRAME_NAME; frame.className = 'upl-shell'; frame.title = 'Painel Pulso';
    frame.addEventListener('load', () => {
      try {
        const w = frame.contentWindow;
        if (!w || w.location.href === 'about:blank') return;
        history.replaceState(null, '', w.location.pathname + w.location.search + w.location.hash);
        document.title = w.document.title;
      } catch { /* o quadro só abre páginas deste endereço */ }
    });
    document.body.appendChild(frame);
    document.body.classList.add('upl-shell-on');
    return frame;
  }
  window.addEventListener('click', (e) => { // na bolha, depois dos tratadores da própria página
    if (!activeCount() || frame || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || /^\/(logout|static\/)/.test(u.pathname)) return;
    if (u.pathname === location.pathname && u.search === location.search && u.hash) return; // âncora da própria página
    e.preventDefault();
    ensureFrame().src = u.href;
  });
  window.addEventListener('submit', (e) => {
    if (!activeCount() || frame || e.defaultPrevented) return;
    const f = e.target;
    if (!f || f.tagName !== 'FORM' || (f.target && f.target !== '_self') || f.getAttribute('action') === '/logout') return;
    ensureFrame();
    f.target = FRAME_NAME; // a resposta do formulário carrega dentro do quadro
  });

  // ---------------------------------------------------------------- bandeja
  const tpl = document.querySelector('template[data-upl-icons]');
  const icon = (name) => { const n = tpl && tpl.content.querySelector(`[data-i="${name}"]`); return n ? n.innerHTML : ''; };
  let tray = null; let listEl; let titleEl; let metaEl; let barEl; let bodyEl; let headBtn;
  let expanded = true; let userToggled = false; let hideTimer = null; let paintQueued = false;
  const samples = [];

  function buildTray() {
    tray = document.createElement('aside');
    tray.className = 'upl-tray'; tray.setAttribute('aria-label', 'Envios de arquivos'); tray.hidden = true;
    tray.innerHTML = '<button type="button" class="upl-head" aria-expanded="true"><span class="upl-head-txt"><strong class="upl-title"></strong><span class="upl-meta mono small"></span></span><span class="upl-chev"></span><span class="upl-bar" aria-hidden="true"><i></i></span></button>'
      + '<div class="upl-body"><p class="upl-alert small" data-upl-alert hidden></p><ul class="plain upl-list" aria-live="polite"></ul><div class="upl-foot"><button type="button" class="link small" data-upl-retry-all hidden>Tentar todos de novo</button><button type="button" class="link small" data-upl-clear>Limpar concluídos</button></div></div>';
    document.body.appendChild(tray);
    headBtn = tray.querySelector('.upl-head'); titleEl = tray.querySelector('.upl-title'); metaEl = tray.querySelector('.upl-meta');
    barEl = tray.querySelector('.upl-bar i'); bodyEl = tray.querySelector('.upl-body'); listEl = tray.querySelector('.upl-list');
    tray.querySelector('.upl-chev').innerHTML = icon('chevron-up');
    headBtn.addEventListener('click', () => { expanded = !expanded; userToggled = true; paint(); });
    tray.querySelector('[data-upl-retry-all]').addEventListener('click', retryAll);
    tray.querySelector('[data-upl-clear]').addEventListener('click', () => { for (let i = items.length - 1; i >= 0; i -= 1) if (['done', 'canceled'].includes(items[i].status)) items.splice(i, 1); changed(); });
    listEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const it = items.find((x) => x.id === Number(b.closest('li').dataset.id)); if (!it) return;
      if (b.dataset.act === 'cancel') cancel(it);
      else if (b.dataset.act === 'retry') retry(it);
      else if (b.dataset.act === 'dismiss') {
        if (it.serverId && it.status === 'error' && !it.fatal) json(it, `${it.ctx.base}${it.serverId}/cancelar`, { method: 'POST' }).catch(() => {}); // solta o que ficou pela metade no servidor
        items.splice(items.indexOf(it), 1); changed();
      }
    });
  }

  function changed() {
    emit({ type: 'change' });
    if (paintQueued) return;
    paintQueued = true;
    setTimeout(() => { paintQueued = false; paint(); }, 200);
  }

  function stateText(it) {
    if (it.status === 'queued') return 'na fila';
    if (it.status === 'starting') return it.note || (it.resumed ? 'retomando…' : 'preparando…');
    if (it.status === 'sending') return it.note || `${Math.min(99, Math.round((bytesDone(it) / it.file.size) * 100))}%`;
    if (it.status === 'finishing') return 'finalizando…';
    if (it.status === 'done') return 'enviado';
    if (it.status === 'canceled') return 'cancelado';
    return `falhou: ${it.error}`;
  }

  function paint() {
    if (!items.length) { if (tray) tray.hidden = true; return; }
    if (!tray) buildTray();
    tray.hidden = false;
    const act = items.filter(isActive); const errs = items.filter((i) => i.status === 'error'); const done = items.filter((i) => i.status === 'done');
    const total = act.reduce((n, i) => n + i.file.size, 0); const sent = act.reduce((n, i) => n + bytesDone(i), 0);
    const now = Date.now();
    samples.push([now, sent + done.reduce((n, i) => n + i.file.size, 0)]);
    while (samples.length > 2 && now - samples[0][0] > 8000) samples.shift();
    let speed = 0;
    if (samples.length > 1) { const [t0, b0] = samples[0]; const [t1, b1] = samples[samples.length - 1]; speed = t1 > t0 ? ((b1 - b0) / (t1 - t0)) * 1000 : 0; }
    if (act.length) {
      titleEl.textContent = `Enviando ${act.length} arquivo${act.length > 1 ? 's' : ''}`;
      const eta = speed > 50 * 1024 ? fmtEta((total - sent) / speed) : '';
      metaEl.textContent = [`${total ? Math.round((sent / total) * 100) : 0}%`, speed > 1024 ? `${fmtBytes(speed)}/s` : '', eta].filter(Boolean).join(' · ');
      barEl.style.width = `${total ? Math.round((sent / total) * 100) : 0}%`;
    } else {
      titleEl.textContent = errs.length ? `${errs.length} envio${errs.length > 1 ? 's' : ''} com problema` : `${done.length} arquivo${done.length > 1 ? 's enviados' : ' enviado'}`;
      metaEl.textContent = errs.length && done.length ? `${done.length} enviado${done.length > 1 ? 's' : ''}` : '';
      barEl.style.width = errs.length ? '0%' : '100%';
      samples.length = 0;
    }
    tray.classList.toggle('is-error', !act.length && errs.length > 0);
    const alertEl = tray.querySelector('[data-upl-alert]'); alertEl.textContent = blocked; alertEl.hidden = !blocked;
    tray.querySelector('[data-upl-retry-all]').hidden = !errs.some((i) => !i.fatal) || errs.length < 2;
    if (blocked && !act.length) titleEl.textContent = 'Armazenamento cheio: envios parados';
    headBtn.setAttribute('aria-expanded', String(expanded));
    bodyEl.hidden = !expanded;
    tray.classList.toggle('open', expanded);
    if (!expanded) return;
    // a lista é refeita só quando muda a estrutura; o andamento atualiza as linhas existentes
    const sig = items.map((i) => `${i.id}:${i.status}`).join(',');
    if (listEl.dataset.sig !== sig) {
      listEl.dataset.sig = sig;
      listEl.replaceChildren(...items.map((it) => {
        const li = document.createElement('li');
        li.dataset.id = it.id; li.className = `upl-item ${it.status === 'done' ? 'ok' : ''} ${it.status === 'error' ? 'err' : ''}`;
        const actions = [];
        if (it.status === 'error' && !it.fatal) actions.push(`<button type="button" class="icon-btn" data-act="retry" aria-label="Tentar de novo" title="Tentar de novo">${icon('rotate-cw')}</button>`);
        if (isActive(it)) actions.push(`<button type="button" class="icon-btn" data-act="cancel" aria-label="Cancelar envio" title="Cancelar envio">${icon('x')}</button>`);
        else if (it.status !== 'done') actions.push(`<button type="button" class="icon-btn" data-act="dismiss" aria-label="Tirar da lista" title="Tirar da lista">${icon('x')}</button>`);
        li.innerHTML = '<div class="upl-row"><div class="upl-name"><span class="u-name"></span><span class="small muted mono u-where"></span></div><span class="small u-state"></span><span class="upl-act">' + actions.join('') + '</span></div><div class="bar"><i></i></div>';
        li.querySelector('.u-name').textContent = it.label ? `${it.label} · ${it.file.name}` : it.file.name;
        li.querySelector('.u-name').title = it.file.name;
        li.querySelector('.u-where').textContent = `${it.ctx.where ? `${it.ctx.where} · ` : ''}${fmtBytes(it.file.size)}`;
        return li;
      }));
    }
    items.forEach((it, idx) => {
      const li = listEl.children[idx]; if (!li) return;
      li.querySelector('.u-state').textContent = stateText(it);
      const pct = it.status === 'done' ? 100 : Math.min(100, Math.round((bytesDone(it) / it.file.size) * 100));
      li.querySelector('.bar i').style.width = `${pct}%`;
    });
  }

  // depois que tudo termina sem erro, a bandeja se recolhe e some sozinha
  function scheduleHide() {
    clearTimeout(hideTimer);
    const failed = items.some((i) => i.status === 'error');
    if (failed) expanded = true; // quem precisa de atenção fica à vista
    else if (!userToggled) expanded = false;
    paint();
    if (failed) return;
    hideTimer = setTimeout(() => { if (!activeCount() && !items.some((i) => i.status === 'error')) { items.length = 0; paint(); } }, 9000);
  }
})();
