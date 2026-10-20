// Colaboração no painel: busca global (Ctrl/⌘ + K), bolinha de responsável, menções em comentários, contador de notificações
// e o quadro de tarefas. Sem inline script (CSP 'self').
(function () {
  const csrf = document.querySelector('meta[name="csrf"]')?.content || '';
  let team = [];
  try { team = JSON.parse(document.getElementById('team-users')?.textContent || '[]'); } catch { team = []; }
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) })
    .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(j.error || `erro ${r.status}`); return j; });

  // ---------------------------------------------------------------- busca global
  const palette = document.querySelector('[data-palette]');
  if (palette) {
    const input = palette.querySelector('[data-palette-input]');
    const box = palette.querySelector('[data-palette-results]');
    const tips = palette.querySelector('[data-palette-tips]');
    let items = []; let active = 0; let timer = null; let lastQ = null; let seq = 0;
    const RECENT_KEY = 'pulso-busca-recentes';
    const recents = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
    const remember = (it) => { try { const list = [it, ...recents().filter((r) => r.url !== it.url)].slice(0, 6); localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* sem storage */ } };

    function render(groups) {
      items = []; box.innerHTML = '';
      if (!groups.length) { box.innerHTML = '<p class="palette-empty">Nada encontrado. A gestão vê as buscas sem resultado e pode criar atalhos para elas.</p>'; return; }
      for (const g of groups) {
        const h = document.createElement('div'); h.className = 'palette-group'; h.textContent = g.label; box.appendChild(h);
        for (const it of g.items) {
          const i = items.length; items.push(it);
          const el = document.createElement('a');
          el.className = 'palette-item'; el.href = it.url || '#'; el.dataset.i = i; el.setAttribute('role', 'option');
          el.innerHTML = `<span class="pi-title">${esc(it.title)}</span><span class="pi-sub">${esc(it.sub || '')}</span>`;
          box.appendChild(el);
        }
      }
      setActive(0);
    }
    function setActive(i) {
      active = Math.max(0, Math.min(items.length - 1, i));
      box.querySelectorAll('.palette-item').forEach((el) => el.classList.toggle('on', Number(el.dataset.i) === active));
      box.querySelector('.palette-item.on')?.scrollIntoView({ block: 'nearest' });
    }
    async function load(q) {
      const my = ++seq;
      try {
        const res = await fetch(`/busca?q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
        const data = await res.json();
        if (my !== seq) return;
        let groups = data.groups || [];
        if (!q) { const rec = recents(); if (rec.length) groups = [{ label: 'Abertos recentemente', items: rec }, ...groups]; }
        render(groups);
        if (tips) { tips.hidden = !data.tips; tips.textContent = data.tips ? `${data.tips} sugest${data.tips > 1 ? 'ões' : 'ão'} para melhorar a busca →` : ''; }
      } catch { box.innerHTML = '<p class="palette-empty">Não foi possível buscar agora.</p>'; }
    }
    function choose(i, newTab) {
      const it = items[i]; if (!it) return;
      if (it.js === 'theme') { document.querySelector('[data-theme-toggle]')?.click(); palette.close(); return; }
      if (it.js === 'logout') { document.querySelector('form[action="/logout"]')?.submit(); return; }
      if (!it.url) return;
      if (lastQ && lastQ.length >= 2) navigator.sendBeacon?.('/busca/escolha', new Blob([JSON.stringify({ q: lastQ, url: it.url, _csrf: csrf })], { type: 'application/json' }));
      if (it.kind !== 'acao') remember({ title: it.title, sub: it.sub, url: it.url, kind: it.kind });
      if (newTab) window.open(it.url, '_blank'); else window.location.href = it.url;
    }
    const open = () => { if (palette.open) return; palette.showModal(); input.value = ''; lastQ = ''; load(''); setTimeout(() => input.focus(), 10); };
    document.querySelectorAll('[data-palette-open]').forEach((b) => b.addEventListener('click', open));
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette.open ? palette.close() : open(); }
      else if (e.key === '/' && !palette.open && !e.target.closest('input, textarea, select, [contenteditable]')) { e.preventDefault(); open(); }
    });
    input.addEventListener('input', () => { clearTimeout(timer); const q = input.value.trim(); timer = setTimeout(() => { lastQ = q; load(q); }, 160); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(active, e.metaKey || e.ctrlKey); }
    });
    box.addEventListener('click', (e) => { const el = e.target.closest('.palette-item'); if (!el) return; e.preventDefault(); choose(Number(el.dataset.i), e.metaKey || e.ctrlKey); });
    box.addEventListener('mousemove', (e) => { const el = e.target.closest('.palette-item'); if (el) setActive(Number(el.dataset.i)); });
    palette.addEventListener('click', (e) => { if (e.target === palette) palette.close(); });
  }

  // ---------------------------------------------------------------- bolinha de responsável (como no ClickUp)
  let pop = null;
  const closePop = () => { pop?.remove(); pop = null; };
  function openPicker(dot) {
    closePop();
    pop = document.createElement('div');
    pop.className = 'dot-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Escolher responsável');
    pop.innerHTML = '<input type="search" placeholder="Buscar pessoa…" aria-label="Buscar pessoa"><ul role="listbox"></ul>';
    document.body.appendChild(pop);
    const r = dot.getBoundingClientRect();
    pop.style.top = `${window.scrollY + r.bottom + 6}px`;
    pop.style.left = `${Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - 260))}px`;
    const list = pop.querySelector('ul'); const search = pop.querySelector('input');
    const draw = () => {
      const q = norm(search.value);
      const people = team.filter((u) => !q || norm(u.name).includes(q));
      list.innerHTML = `<li><button type="button" data-pick=""><span class="dot-av is-empty">–</span> Sem responsável</button></li>` +
        people.map((u) => `<li><button type="button" data-pick="${esc(u.id)}" class="${u.id === dot.dataset.user ? 'on' : ''}"><span class="dot-av">${esc(u.ini)}</span> ${esc(u.name)}</button></li>`).join('');
    };
    draw(); search.focus();
    search.addEventListener('input', draw);
    search.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); if (e.key === 'Enter') { e.preventDefault(); list.querySelector('[data-pick]:not([data-pick=""])')?.click(); } });
    list.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-pick]'); if (!b) return;
      const userId = b.dataset.pick || null;
      try {
        const res = await post('/responsavel', { tipo: dot.dataset.tipo, id: dot.dataset.id, user_id: userId });
        const u = res.user;
        dot.dataset.user = u ? u.id : '';
        dot.classList.toggle('is-empty', !u);
        dot.querySelector('.dot-av').textContent = u ? (team.find((t) => t.id === u.id)?.ini || u.name[0]) : '+';
        const name = dot.querySelector('.dot-name'); if (name) name.textContent = u ? u.name : 'Sem responsável';
        dot.title = u ? `Responsável: ${u.name} (clique para trocar)` : 'Sem responsável (clique para escolher)';
        closePop();
      } catch (err) { window.alert(err.message); }
    });
  }
  document.addEventListener('click', (e) => {
    const dot = e.target.closest('[data-dot]');
    if (dot) { e.preventDefault(); e.stopPropagation(); if (pop && pop.dataset.for === dot.dataset.id + dot.dataset.tipo) { closePop(); return; } openPicker(dot); pop.dataset.for = dot.dataset.id + dot.dataset.tipo; return; }
    if (pop && !e.target.closest('.dot-pop')) closePop();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
  // a bolinha dentro de um card arrastável/clicável não deve abrir o card
  document.querySelectorAll('[data-dot]').forEach((d) => { d.addEventListener('mousedown', (e) => e.stopPropagation()); d.setAttribute('draggable', 'false'); });

  // ---------------------------------------------------------------- menções (@) nos comentários
  document.querySelectorAll('[data-mention]').forEach((area) => {
    const list = area.parentElement.querySelector('[data-mention-list]');
    let start = -1; let pos = 0; let opts = [];
    const hide = () => { list.hidden = true; start = -1; };
    const pick = (u) => {
      const before = area.value.slice(0, start); const after = area.value.slice(area.selectionStart);
      area.value = `${before}@${u.name} ${after}`;
      const caret = before.length + u.name.length + 2; area.setSelectionRange(caret, caret); area.focus(); hide();
    };
    area.addEventListener('input', () => {
      const upto = area.value.slice(0, area.selectionStart);
      const m = upto.match(/(^|\s)@([\p{L}\p{N} ]{0,30})$/u);
      if (!m) { hide(); return; }
      start = upto.length - m[2].length - 1;
      const q = norm(m[2]);
      opts = team.filter((u) => norm(u.name).startsWith(q) || norm(u.name).includes(` ${q}`)).slice(0, 6);
      if (!opts.length) { hide(); return; }
      pos = 0;
      list.innerHTML = opts.map((u, i) => `<li role="option" data-i="${i}" class="${i === 0 ? 'on' : ''}"><span class="dot-av">${esc(u.ini)}</span>${esc(u.name)}</li>`).join('');
      list.hidden = false;
    });
    area.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); area.form.requestSubmit(); return; }
      if (list.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); pos = (pos + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length; list.querySelectorAll('li').forEach((li, i) => li.classList.toggle('on', i === pos)); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(opts[pos]); }
      else if (e.key === 'Escape') hide();
    });
    list.addEventListener('mousedown', (e) => { const li = e.target.closest('li'); if (li) { e.preventDefault(); pick(opts[Number(li.dataset.i)]); } });
    area.addEventListener('blur', () => setTimeout(hide, 150));
  });

  // ---------------------------------------------------------------- avisos em tempo real (SSE) + contador de notificações
  // O servidor empurra cada notificação nova (/eventos). Se a conexão cair, o navegador reconecta sozinho;
  // por garantia o contador também é conferido a cada 2 minutos e quando a aba volta a ficar visível.
  // o contador aparece no menu lateral, na barra de baixo do celular e no ícone do app instalado (Badging API)
  const badges = document.querySelectorAll('[data-unread]');
  const badge = badges[0];
  const toasts = document.querySelector('[data-toasts]');
  const setTitle = (n) => { document.title = document.title.replace(/^\(\d+\) /, ''); if (n) document.title = `(${n}) ${document.title}`; };
  const setAppBadge = (n) => { try { if (n) navigator.setAppBadge?.(n)?.catch?.(() => {}); else navigator.clearAppBadge?.()?.catch?.(() => {}); } catch { /* sem suporte */ } };
  const setUnread = (n) => { if (!badge) return; badges.forEach((b) => { b.textContent = n; b.hidden = !n; }); setTitle(n); setAppBadge(n); };
  if (badge) setAppBadge(Number(badge.textContent || 0));
  const refresh = async () => {
    if (document.hidden || !badge) return;
    try { const data = await (await fetch('/notificacoes/resumo', { headers: { Accept: 'application/json' } })).json(); setUnread(data.unread); } catch { /* tenta de novo depois */ }
  };
  // aviso flutuante: some sozinho em 8 s; clicar abre o item
  window.pulsoToast = (t) => {
    if (!toasts) return;
    const el = document.createElement(t.url ? 'a' : 'div');
    el.className = `toast ${t.tone || ''}`; if (t.url) el.href = t.url;
    el.setAttribute('role', 'status');
    const strong = document.createElement('strong'); strong.textContent = t.title || ''; el.appendChild(strong);
    if (t.body) { const p = document.createElement('span'); p.textContent = t.body; el.appendChild(p); }
    toasts.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 8000);
  };
  if (window.EventSource) {
    const es = new EventSource('/eventos');
    es.addEventListener('notification', (e) => {
      let n; try { n = JSON.parse(e.data); } catch { return; }
      if (badge) setUnread(Number(badge.textContent || 0) + 1);
      window.pulsoToast({ title: n.title, body: n.body, url: n.url });
      window.pulsoBrowserAlert?.(n); // aba em segundo plano: alerta do sistema (push.js)
    });
  }
  setInterval(refresh, 120_000);
  document.addEventListener('visibilitychange', refresh);

  // ---------------------------------------------------------------- tarefas: status rápido (bloqueada pede motivo) e quadro
  const askReason = () => { const r = window.prompt('Por que a tarefa está bloqueada? (o motivo fica visível para a equipe)'); return r && r.trim() ? r.trim() : null; };
  document.querySelectorAll('select[data-status-select]').forEach((sel) => {
    const original = sel.value;
    sel.addEventListener('change', () => {
      const form = sel.form;
      if (sel.value === 'bloqueada') {
        const reason = askReason();
        if (!reason) { sel.value = original; return; }
        let input = form.querySelector('input[name="block_reason"]');
        if (!input) { input = document.createElement('input'); input.type = 'hidden'; input.name = 'block_reason'; form.appendChild(input); }
        input.value = reason;
      }
      form.submit();
    });
  });

  document.querySelector('dialog[data-open-on-load]')?.showModal();
  // formulário da tarefa: o campo "motivo" aparece quando o status é Bloqueada
  document.querySelectorAll('[data-block-toggle]').forEach((sel) => {
    const field = sel.form.querySelector('[data-block-reason]');
    const sync = () => { field.hidden = sel.value !== 'bloqueada'; field.querySelector('input').required = sel.value === 'bloqueada'; };
    sel.addEventListener('change', sync); sync();
  });

  const board = document.querySelector('[data-task-board]');
  if (board) {
    let dragged = null;
    board.addEventListener('dragstart', (e) => { const card = e.target.closest('[data-task]'); if (!card) return; dragged = card; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    board.addEventListener('dragend', () => { dragged?.classList.remove('dragging'); dragged = null; board.querySelectorAll('.drop').forEach((c) => c.classList.remove('drop')); });
    board.querySelectorAll('[data-status-col]').forEach((col) => {
      col.addEventListener('dragover', (e) => { if (!dragged) return; e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault(); col.classList.remove('drop');
        if (!dragged) return;
        const card = dragged; const status = col.dataset.statusCol; const from = card.closest('[data-status-col]');
        if (from === col) return;
        let reason = null;
        if (status === 'bloqueada') { reason = askReason(); if (!reason) return; }
        col.querySelector('[data-cards]').prepend(card);
        try {
          await post(`/tarefas/${card.dataset.task}/status`, { status, block_reason: reason });
          const count = (c) => c.querySelector('[data-count]'); [from, col].forEach((c) => { count(c).textContent = c.querySelectorAll('[data-task]').length; });
          card.classList.toggle('is-blocked', status === 'bloqueada');
          const r = card.querySelector('[data-reason]'); if (r) { r.textContent = reason ? `Bloqueada: ${reason}` : ''; r.hidden = !reason; }
        } catch (err) { from.querySelector('[data-cards]').prepend(card); window.alert(err.message); }
      });
    });
  }
})();
