// Mensagens da equipe. O servidor é a fonte da verdade: a tela só junta o que chega (por id e rev), então receber a mesma coisa duas vezes não muda nada.
// Enviar: cada mensagem nasce com um client_id e fica guardada no aparelho até o servidor confirmar; sem conexão, tenta de novo sozinha com o mesmo código.
// Ficou desconectado: ao voltar, a tela pede tudo o que mudou depois da última rev que viu.
(function () {
  'use strict';
  const root = document.querySelector('[data-chat]');
  if (!root) return;
  const csrf = document.querySelector('meta[name="csrf"]')?.content || '';
  const me = root.dataset.me;
  const boot = JSON.parse(document.getElementById('chat-data').textContent);
  const team = (() => { try { return JSON.parse(document.getElementById('team-users')?.textContent || '[]'); } catch { return []; } })().filter((u) => String(u.id) !== me);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const iconT = $('template[data-chat-icons]');
  const ic = (n) => iconT.content.querySelector(`[data-i="${n}"]`)?.innerHTML || '';
  const TZ = 'America/Sao_Paulo';
  const hourFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
  const shortDay = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
  const dayKey = (d) => dayFmt.format(new Date(d));
  const dayLabel = (d) => { const k = dayKey(d); if (k === dayKey(Date.now())) return 'Hoje'; if (k === dayKey(Date.now() - 86400000)) return 'Ontem'; return shortDay.format(new Date(d)); };
  const when = (d) => (dayKey(d) === dayKey(Date.now()) ? hourFmt.format(new Date(d)) : dayLabel(d));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
  const fmtBytes = (n) => { const u = ['B', 'KB', 'MB']; let i = 0; let x = n; while (x >= 1024 && i < 2) { x /= 1024; i += 1; } return `${x >= 100 || i === 0 ? Math.round(x) : x.toFixed(1).replace('.', ',')} ${u[i]}`; };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  async function api(url, body) {
    const opts = body === undefined ? { headers: { Accept: 'application/json' } } : { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) };
    const res = await fetch(url, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) { const e = new Error(json.error || (res.status === 403 ? 'Sua sessão expirou. Recarregue a página.' : `Erro ${res.status}`)); e.status = res.status; throw e; }
    return json;
  }

  const S = { convs: boot.conversations, cur: null, msgs: new Map(), rev: 0, more: false, firstUnread: null, maxId: 0, thread: null, replies: new Map() };
  const el = {
    convs: $('[data-chat-convs]'), noconv: $('[data-chat-noconv]'), pick: $('[data-chat-pick]'), conv: $('[data-chat-conv]'), name: $('[data-chat-name]'), sub: $('[data-chat-sub]'), avatar: $('[data-chat-avatar]'),
    scroll: $('[data-chat-scroll]'), msgs: $('[data-chat-msgs]'), older: $('[data-chat-older]'), jump: $('[data-chat-jump]'), offline: $('[data-chat-offline]'),
    thread: $('[data-chat-thread]'), tParent: $('[data-chat-thread-parent]'), tMsgs: $('[data-chat-thread-msgs]'), tScroll: $('[data-chat-thread-scroll]'), tSub: $('[data-chat-thread-sub]'),
  };
  const setView = (v) => { root.dataset.view = v; };

  // ---------------------------------------------------------------- lista de conversas
  function paintConvs() {
    el.noconv.hidden = S.convs.length > 0;
    el.convs.innerHTML = S.convs.map((c) => `<a class="chat-item${S.cur?.id === c.id ? ' on' : ''}${c.unread ? ' unread' : ''}" href="/mensagens/${c.id}" data-conv="${c.id}" data-no-skeleton>`
      + `<span class="avatar sm">${c.kind === 'group' ? ic('users') : esc(c.initials)}</span>`
      + `<span class="chat-item-main"><span class="chat-item-top"><strong>${esc(c.name)}</strong><time class="mono small muted">${c.last_at ? esc(when(c.last_at)) : ''}</time></span>`
      + `<span class="chat-item-prev small muted">${c.preview_author ? `${esc(c.preview_author)}: ` : ''}${esc(c.preview || (c.kind === 'group' ? 'Grupo criado' : 'Sem mensagens'))}</span></span>`
      + `${c.unread ? `<span class="nav-count">${c.unread}</span>` : ''}</a>`).join('');
  }
  const refreshConvs = debounce(async () => {
    try { S.convs = (await api('/mensagens/conversas')).conversations; paintConvs(); } catch { /* a próxima conferência acerta */ }
  }, 200);

  // ---------------------------------------------------------------- uma mensagem
  const reactsHtml = (m) => {
    if (!m.reactions.length) return '';
    return `<div class="reacts chat-reacts">${m.reactions.map((r) => { const who = r.users.map((u) => u.name).join(', '); const mine = r.users.some((u) => String(u.id) === me); return `<button type="button" class="react-chip${mine ? ' mine' : ''}" data-chat-react="${esc(r.emoji)}" aria-pressed="${mine}" title="${esc(who)}" aria-label="${esc(r.emoji)} ${r.count}: ${esc(who)}"><span class="react-emoji">${esc(r.emoji)}</span><span class="mono">${r.count}</span></button>`; }).join('')}</div>`;
  };
  const filesHtml = (m) => {
    if (!m.attachments.length) return '';
    return `<div class="cmt-media">${m.attachments.map((a) => (a.kind === 'audio'
      ? `<div class="cmt-audio"><audio controls preload="none" src="${esc(a.url)}"></audio>${a.transcript ? `<details><summary class="small muted">Transcrição</summary><p class="rte-transcript small">${esc(a.transcript)}</p></details>` : ''}</div>`
      : `<a class="btn sm" href="${esc(a.url)}/baixar" data-no-skeleton>${ic('file-text')} ${esc(a.name)} <span class="mono small muted">${fmtBytes(a.size)}</span></a>`)).join('')}</div>`;
  };
  function msgHtml(m, { inThread = false } = {}) {
    const mine = String(m.author_id) === me;
    const body = m.deleted ? '<p class="msg-deleted small muted">Mensagem apagada</p>' : `${m.html ? `<div class="rich-content msg-text">${m.html}</div>` : ''}${filesHtml(m)}`;
    const replies = !inThread && m.reply_count ? `<button type="button" class="msg-replies small" data-chat-open-thread>${ic('message-square')} ${m.reply_count} ${m.reply_count === 1 ? 'resposta' : 'respostas'}${m.last_reply_at ? ` <span class="mono muted">${esc(when(m.last_reply_at))}</span>` : ''}</button>` : '';
    const tools = m.deleted ? '' : `<div class="msg-tools">`
      + `<button type="button" class="icon-btn" data-chat-react-open aria-label="Reagir" title="Reagir">${ic('smile-plus')}</button>`
      + (!m.parent_id && !inThread ? `<button type="button" class="icon-btn" data-chat-open-thread aria-label="Responder em thread" title="Responder em thread">${ic('message-square')}</button>` : '')
      + (mine ? `<button type="button" class="icon-btn" data-chat-edit aria-label="Editar" title="Editar">${ic('pencil')}</button><button type="button" class="icon-btn danger-ic" data-chat-delete aria-label="Apagar" title="Apagar">${ic('trash-2')}</button>` : '')
      + '</div>';
    return `<span class="avatar sm">${esc(m.initials)}</span><div class="msg-body"><div class="msg-meta"><strong>${esc(m.author)}</strong><time class="mono small muted" datetime="${esc(m.created_at)}">${esc(hourFmt.format(new Date(m.created_at)))}</time>${m.edited ? '<span class="mono small muted">editada</span>' : ''}</div>${body}${reactsHtml(m)}${replies}</div>${tools}`;
  }
  function makeLi(m, opts) {
    const li = document.createElement('li');
    li.className = `msg${m.deleted ? ' is-deleted' : ''}`; li.dataset.id = m.id; li.dataset.client = m.client_id; li.dataset.author = m.author_id || ''; li.dataset.at = m.created_at;
    li.innerHTML = msgHtml(m, opts);
    return li;
  }
  const hydrate = (scope) => window.PulsoRich?.hydrate(scope);

  // Marca de dia, "novas" e mensagens seguidas da mesma pessoa, sem recriar as mensagens (o áudio que está tocando continua).
  function decorate(list, { unread = null } = {}) {
    $$('.chat-day, .chat-unread-line', list).forEach((n) => n.remove());
    let prev = null; let marked = false;
    $$('.msg', list).forEach((li) => {
      const newDay = !prev || dayKey(prev.dataset.at) !== dayKey(li.dataset.at);
      if (newDay) { const d = document.createElement('li'); d.className = 'chat-day mono'; d.textContent = dayLabel(li.dataset.at); li.before(d); }
      const id = Number(li.dataset.id);
      let line = false;
      if (unread && !marked && id >= unread && li.dataset.author !== me) { marked = true; line = true; const u = document.createElement('li'); u.className = 'chat-unread-line mono'; u.textContent = 'Novas'; li.before(u); }
      li.classList.toggle('cont', Boolean(prev) && !newDay && !line && prev.dataset.author === li.dataset.author && new Date(li.dataset.at) - new Date(prev.dataset.at) < 300000 && !prev.classList.contains('is-deleted'));
      prev = li;
    });
  }

  function place(list, m, opts) {
    const fresh = makeLi(m, opts);
    const old = list.querySelector(`.msg[data-id="${m.id}"]`);
    let added = false;
    if (old) old.replaceWith(fresh);
    else {
      added = true;
      list.querySelector(`.msg.pending[data-client="${m.client_id}"]`)?.remove();
      const after = $$('.msg:not(.pending)', list).find((li) => Number(li.dataset.id) > m.id);
      const firstPending = list.querySelector('.msg.pending');
      list.insertBefore(fresh, after || firstPending);
    }
    hydrate(fresh);
    return added;
  }
  const nearBottom = (box) => box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const toBottom = (box) => { box.scrollTop = box.scrollHeight; };

  // Junta o que chegou; se for mais antigo do que o que já está na tela, ignora.
  function merge(m) {
    if (!S.cur || m.conversation_id !== S.cur.id) return;
    S.maxId = Math.max(S.maxId, m.id);
    if (m.parent_id) {
      if (S.thread?.id === m.parent_id) {
        const known = S.replies.get(m.id);
        if (known && known.rev >= m.rev) return;
        const stick = nearBottom(el.tScroll) || String(m.author_id) === me;
        S.replies.set(m.id, m);
        place(el.tMsgs, m, { inThread: true }); decorate(el.tMsgs); paintThreadSub();
        if (stick) toBottom(el.tScroll);
      }
      return;
    }
    const known = S.msgs.get(m.id);
    if (known && known.rev >= m.rev) return;
    const stick = nearBottom(el.scroll) || String(m.author_id) === me;
    S.msgs.set(m.id, m);
    const added = place(el.msgs, m);
    decorate(el.msgs, { unread: S.firstUnread });
    if (stick) toBottom(el.scroll); else if (added) el.jump.hidden = false;
    if (S.thread?.id === m.id) { S.thread = m; el.tParent.replaceChildren(makeLi(m, { inThread: true })); hydrate(el.tParent); paintThreadSub(); }
  }

  // ---------------------------------------------------------------- abrir conversa
  function paintHead() {
    const c = S.cur;
    el.name.textContent = c.name;
    el.sub.textContent = c.kind === 'group' ? `${c.members} ${c.members === 1 ? 'pessoa' : 'pessoas'}` : '';
    el.avatar.innerHTML = c.kind === 'group' ? ic('users') : esc(c.initials);
  }
  const markRead = debounce(async () => {
    if (!S.cur || document.visibilityState !== 'visible' || !S.maxId) return;
    const c = S.convs.find((x) => x.id === S.cur.id);
    if (c && c.unread) { c.unread = 0; paintConvs(); }
    try { await api(`/mensagens/conversas/${S.cur.id}/lida`, { ate: S.maxId }); } catch { /* na próxima */ }
  }, 300);

  async function open(id, { push = true } = {}) {
    const conv = S.convs.find((c) => c.id === id);
    if (!conv) { try { S.convs = (await api('/mensagens/conversas')).conversations; } catch { return; } if (!S.convs.find((c) => c.id === id)) { location.href = `/mensagens/${id}`; return; } return open(id, { push }); }
    closeThread();
    S.cur = conv; S.msgs = new Map(); S.maxId = conv.last_message_id || 0;
    S.unreadCount = conv.unread; S.firstUnread = conv.unread ? conv.last_read_id + 1 : null;
    el.msgs.replaceChildren(); el.jump.hidden = true;
    el.pick.hidden = true; el.conv.hidden = false;
    paintHead(); paintConvs(); setView('conv');
    if (push && location.pathname !== `/mensagens/${id}`) history.pushState({ id }, '', `/mensagens/${id}`);
    document.title = `${conv.name} · Mensagens`;
    let page;
    try { page = await api(`/mensagens/conversas/${id}/mensagens`); } catch (e) { el.msgs.innerHTML = `<li class="small err">${esc(e.message)}</li>`; return; }
    if (S.cur?.id !== id) return;
    S.rev = page.rev; S.more = page.more; el.older.hidden = !page.more;
    page.messages.forEach((m) => { S.msgs.set(m.id, m); S.maxId = Math.max(S.maxId, m.id); el.msgs.appendChild(makeLi(m)); });
    pending.filter((p) => p.conv === id && !p.parent).forEach(paintPending);
    decorate(el.msgs, { unread: S.firstUnread }); hydrate(el.msgs);
    const line = $('.chat-unread-line', el.msgs);
    if (line) el.scroll.scrollTop = line.offsetTop - el.scroll.offsetTop - 24; else toBottom(el.scroll);
    markRead();
    $('[data-chat-form] .rte-area')?.focus({ preventScroll: true });
  }
  function closeConv({ push = true } = {}) {
    closeThread();
    S.cur = null; el.conv.hidden = true; el.pick.hidden = false; setView('list'); paintConvs();
    if (push) history.pushState({}, '', '/mensagens');
    document.title = 'Mensagens';
    refreshConvs();
  }

  // Busca o que mudou depois da última rev vista: chamada ao reconectar, ao voltar para a aba e de tempos em tempos.
  let syncing = false;
  async function sync() {
    refreshConvs();
    if (!S.cur || syncing) return;
    syncing = true;
    try {
      for (;;) {
        const id = S.cur?.id; if (!id) break;
        const r = await api(`/mensagens/conversas/${id}/novidades?desde=${S.rev}`);
        if (S.cur?.id !== id) break;
        r.messages.forEach(merge);
        S.rev = Math.max(S.rev, r.rev);
        if (!r.more) break;
      }
      markRead();
    } catch { /* tenta na próxima */ } finally { syncing = false; }
  }

  async function loadOlder() {
    const first = Math.min(...S.msgs.keys());
    el.older.disabled = true;
    try {
      const page = await api(`/mensagens/conversas/${S.cur.id}/mensagens?antes=${first}`);
      const before = el.scroll.scrollHeight;
      const anchor = $('.chat-day, .msg', el.msgs);
      page.messages.forEach((m) => { S.msgs.set(m.id, m); el.msgs.insertBefore(makeLi(m), anchor); });
      decorate(el.msgs, { unread: S.firstUnread }); hydrate(el.msgs);
      el.scroll.scrollTop += el.scroll.scrollHeight - before;
      el.older.hidden = !page.more;
    } catch (e) { window.alert(e.message); } finally { el.older.disabled = false; }
  }

  // ---------------------------------------------------------------- thread
  const paintThreadSub = () => { el.tSub.textContent = `${S.replies.size} ${S.replies.size === 1 ? 'resposta' : 'respostas'}`; };
  async function openThread(id) {
    let t;
    try { t = await api(`/mensagens/m/${id}/respostas`); } catch (e) { window.alert(e.message); return; }
    S.thread = t.parent; S.replies = new Map(t.replies.map((m) => [m.id, m]));
    el.tParent.replaceChildren(makeLi(t.parent, { inThread: true }));
    el.tMsgs.replaceChildren(...t.replies.map((m) => makeLi(m, { inThread: true })));
    pending.filter((p) => p.parent === id).forEach(paintPending);
    decorate(el.tMsgs); hydrate(el.tParent); hydrate(el.tMsgs); paintThreadSub();
    el.thread.hidden = false; setView('thread'); toBottom(el.tScroll);
    t.replies.forEach((m) => { S.maxId = Math.max(S.maxId, m.id); });
    markRead();
    $('[data-chat-thread-form] .rte-area')?.focus({ preventScroll: true });
  }
  function closeThread() {
    if (!S.thread) return;
    S.thread = null; S.replies = new Map(); el.thread.hidden = true; if (S.cur) setView('conv');
  }

  // ---------------------------------------------------------------- envio garantido
  const storeKey = `pulso.chat.pendentes.${me}`;
  const load = () => { try { return JSON.parse(localStorage.getItem(storeKey) || '[]'); } catch { return []; } };
  const save = () => { try { localStorage.setItem(storeKey, JSON.stringify(pending)); } catch { /* sem armazenamento: vale enquanto a página estiver aberta */ } };
  const pending = load();
  let flushing = false; let retryIn = 2000; let retryTimer = null;
  const listFor = (p) => (p.parent ? (S.thread?.id === p.parent ? el.tMsgs : null) : (S.cur?.id === p.conv ? el.msgs : null));

  function paintPending(p) {
    const list = listFor(p);
    if (!list) return;
    let li = list.querySelector(`.msg.pending[data-client="${p.client_id}"]`);
    if (!li) { li = document.createElement('li'); li.className = 'msg pending'; li.dataset.client = p.client_id; li.dataset.author = me; li.dataset.at = new Date(p.at).toISOString(); list.appendChild(li); }
    li.classList.toggle('failed', Boolean(p.failed));
    const status = p.failed
      ? `<p class="msg-status small err">${esc(p.failed)} <button type="button" class="link small" data-chat-retry>Tentar de novo</button> <button type="button" class="link small" data-chat-discard>Descartar</button></p>`
      : `<p class="msg-status mono small muted">${ic('clock')} enviando</p>`;
    li.innerHTML = `<span class="avatar sm">${esc((document.querySelector('.who .avatar')?.textContent || '').trim())}</span><div class="msg-body">${p.html ? `<div class="rich-content msg-text">${p.html}</div>` : ''}${p.atts.length ? '<p class="small muted">Com anexo</p>' : ''}${status}</div>`;
  }
  function drop(p) {
    pending.splice(pending.indexOf(p), 1); save();
    document.querySelectorAll(`.msg.pending[data-client="${p.client_id}"]`).forEach((n) => n.remove());
  }
  async function flush() {
    if (flushing) return;
    flushing = true; clearTimeout(retryTimer);
    try {
      for (const p of [...pending]) {
        if (p.failed) continue;
        try {
          const r = await api(`/mensagens/conversas/${p.conv}/mensagens`, { client_id: p.client_id, html: p.html, anexos: p.atts, parent_id: p.parent });
          drop(p); merge(r.message); retryIn = 2000; el.offline.hidden = true; refreshConvs();
        } catch (e) {
          if (e.status && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) { p.failed = e.message; save(); paintPending(p); continue; } // recusa de verdade: repetir igual não adianta
          el.offline.hidden = false; // sem conexão ou servidor fora: mesma mensagem, mesmo client_id, de novo daqui a pouco
          retryTimer = setTimeout(flush, retryIn); retryIn = Math.min(retryIn * 2, 30000);
          break;
        }
      }
    } finally { flushing = false; }
  }

  function bindComposer(form, target) {
    const rich = $('[data-rich]', form);
    const submit = () => {
      const rte = rich.rte; const t = target();
      if (!rte || !t) return;
      if (rte.pending()) return;
      const html = rte.getHTML();
      const atts = $$('input[name="anexos"]', rich).map((i) => Number(i.value)).filter(Boolean);
      if (!html && !atts.length) { rte.focus(); return; }
      const p = { client_id: uuid(), conv: t.conv, parent: t.parent, html, atts, at: Date.now() };
      pending.push(p); save(); paintPending(p);
      const list = listFor(p); if (list) { decorate(list, list === el.msgs ? { unread: S.firstUnread } : {}); toBottom(list === el.msgs ? el.scroll : el.tScroll); }
      rte.reset(); rte.focus();
      flush();
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); e.stopImmediatePropagation(); submit(); }, true);
    // no computador, Enter envia e Shift+Enter quebra a linha; no celular, Enter quebra a linha e o botão envia
    rich.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing || !e.target.classList?.contains('rte-area') || window.matchMedia('(pointer: coarse)').matches) return;
      e.preventDefault(); e.stopPropagation(); submit();
    }, true);
  }
  bindComposer($('[data-chat-form]'), () => (S.cur ? { conv: S.cur.id, parent: null } : null));
  bindComposer($('[data-chat-thread-form]'), () => (S.cur && S.thread ? { conv: S.cur.id, parent: S.thread.id } : null));

  // ---------------------------------------------------------------- ações na mensagem
  const closePops = () => $$('.chat .react-pop').forEach((p) => p.remove());
  const showErr = (e) => window.alert(e.message || 'Não foi possível.');
  const findMsg = (li) => S.msgs.get(Number(li.dataset.id)) || S.replies.get(Number(li.dataset.id)) || (S.thread?.id === Number(li.dataset.id) ? S.thread : null);

  async function react(li, emoji) {
    closePops();
    try { merge((await api(`/mensagens/m/${li.dataset.id}/reagir`, { emoji })).message); } catch (e) { showErr(e); }
  }
  let editing = null;
  root.addEventListener('click', (e) => {
    const li = e.target.closest('.msg');
    if (e.target.closest('[data-chat-retry]')) { const p = pending.find((x) => x.client_id === li.dataset.client); if (p) { delete p.failed; save(); paintPending(p); flush(); } return; }
    if (e.target.closest('[data-chat-discard]')) { const p = pending.find((x) => x.client_id === li.dataset.client); if (p) drop(p); return; }
    const pick = e.target.closest('[data-chat-pick-emoji]');
    if (pick) { react(li, pick.dataset.chatPickEmoji); return; }
    const chip = e.target.closest('[data-chat-react]');
    if (chip) { react(li, chip.dataset.chatReact); return; }
    const opener = e.target.closest('[data-chat-react-open]');
    if (opener) {
      const had = opener.parentElement.querySelector('.react-pop');
      closePops();
      if (!had) { const pop = document.createElement('span'); pop.className = 'react-pop'; pop.setAttribute('role', 'group'); pop.setAttribute('aria-label', 'Escolha uma reação'); pop.innerHTML = boot.emojis.map((x) => `<button type="button" class="react-pick" data-chat-pick-emoji="${esc(x)}" aria-label="Reagir com ${esc(x)}">${esc(x)}</button>`).join(''); opener.after(pop); }
      return;
    }
    closePops();
    if (e.target.closest('[data-chat-open-thread]')) { openThread(Number(li.dataset.id)); return; }
    if (e.target.closest('[data-chat-edit]')) {
      const m = findMsg(li); if (!m) return;
      editing = m; const dlg = $('#chat-edit'); const rich = $('[data-rich]', dlg);
      rich.rte.reset(); rich.rte.setHTML(m.html); $('[data-chat-edit-err]', dlg).hidden = true; dlg.showModal(); rich.rte.focus();
      return;
    }
    if (e.target.closest('[data-chat-delete]')) {
      if (!window.confirm('Apagar esta mensagem? Ela some para todos.')) return;
      api(`/mensagens/m/${li.dataset.id}/apagar`, {}).then((r) => merge(r.message), showErr);
      return;
    }
    if (li && window.matchMedia('(pointer: coarse)').matches && !e.target.closest('a, button, audio, summary, img')) { // no celular, tocar na mensagem mostra as ações
      const was = li.classList.contains('show-tools');
      $$('.msg.show-tools', root).forEach((n) => n.classList.remove('show-tools'));
      li.classList.toggle('show-tools', !was);
    }
  });
  $('[data-chat-edit-form]').addEventListener('submit', async (e) => {
    e.preventDefault(); e.stopImmediatePropagation();
    const dlg = $('#chat-edit'); const rich = $('[data-rich]', dlg); const err = $('[data-chat-edit-err]', dlg);
    try { merge((await api(`/mensagens/m/${editing.id}/editar`, { html: rich.rte.getHTML() })).message); dlg.close(); } catch (x) { err.textContent = x.message; err.hidden = false; }
  }, true);

  // navegação
  el.convs.addEventListener('click', (e) => { const a = e.target.closest('[data-conv]'); if (!a || e.metaKey || e.ctrlKey) return; e.preventDefault(); open(Number(a.dataset.conv)); });
  $('[data-chat-back]').addEventListener('click', () => closeConv());
  $('[data-chat-thread-close]').addEventListener('click', closeThread);
  el.older.addEventListener('click', loadOlder);
  el.jump.addEventListener('click', () => { toBottom(el.scroll); el.jump.hidden = true; });
  el.scroll.addEventListener('scroll', () => { if (nearBottom(el.scroll)) el.jump.hidden = true; }, { passive: true });
  window.addEventListener('popstate', () => { const m = location.pathname.match(/^\/mensagens\/(\d+)/); if (m) open(Number(m[1]), { push: false }); else if (S.cur) closeConv({ push: false }); });

  // ---------------------------------------------------------------- nova conversa e grupos
  const dNew = $('#chat-new');
  const checks = (people) => people.map((u) => `<li><label class="check"><input type="checkbox" name="pessoas" value="${esc(u.id)}"> <span class="avatar sm">${esc(u.ini)}</span> ${esc(u.name)}</label></li>`).join('');
  $('[data-chat-new]').addEventListener('click', () => {
    $('[data-chat-people]').innerHTML = team.length ? team.map((u) => `<li><button type="button" class="chat-person" data-person="${esc(u.id)}"><span class="avatar sm">${esc(u.ini)}</span> ${esc(u.name)}</button></li>`).join('') : '<li class="small muted">Ainda não há outras pessoas na equipe.</li>';
    $('[data-chat-group-people]').innerHTML = checks(team);
    $('[data-chat-group-form]').reset(); $('[data-chat-group-err]').hidden = true;
    setNewTab('pessoa'); dNew.showModal();
  });
  function setNewTab(t) {
    $$('[data-chat-new-tab]', dNew).forEach((b) => b.classList.toggle('on', b.dataset.chatNewTab === t));
    $$('[data-chat-new-pane]', dNew).forEach((p) => { p.hidden = p.dataset.chatNewPane !== t; });
  }
  dNew.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-chat-new-tab]'); if (tab) { setNewTab(tab.dataset.chatNewTab); return; }
    const person = e.target.closest('[data-person]');
    if (person) {
      try { const r = await api('/mensagens/conversas', { tipo: 'pessoa', pessoa: person.dataset.person }); dNew.close(); S.convs = (await api('/mensagens/conversas')).conversations; open(r.id); } catch (x) { showErr(x); }
    }
  });
  $('[data-chat-group-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; const err = $('[data-chat-group-err]');
    try {
      const r = await api('/mensagens/conversas', { tipo: 'grupo', nome: f.nome.value, pessoas: $$('input[name="pessoas"]:checked', f).map((i) => i.value) });
      dNew.close(); S.convs = (await api('/mensagens/conversas')).conversations; open(r.id);
    } catch (x) { err.textContent = x.message; err.hidden = false; }
  });

  const dInfo = $('#chat-details');
  let info = null;
  async function loadInfo() {
    info = (await api(`/mensagens/conversas/${S.cur.id}`)).conversation;
    const admin = info.kind === 'group' && info.role === 'admin';
    $('[data-chat-d-name]', dInfo).textContent = info.name;
    $('[data-chat-d-rename]', dInfo).hidden = !admin;
    $('[data-chat-d-rename-form]', dInfo).hidden = true;
    $('[data-chat-d-count]', dInfo).textContent = info.kind === 'group' ? `${info.people.length} ${info.people.length === 1 ? 'pessoa' : 'pessoas'}` : 'Conversa individual';
    $('[data-chat-d-members]', dInfo).innerHTML = info.people.map((p) => {
      const self = String(p.id) === me;
      const acts = admin && !self ? `<span class="chat-member-acts"><button type="button" class="link small" data-role="${p.role === 'admin' ? 'member' : 'admin'}" data-uid="${esc(p.id)}">${p.role === 'admin' ? 'Tirar de administrador' : 'Tornar administrador'}</button><button type="button" class="link small danger-link" data-remove="${esc(p.id)}">Remover</button></span>` : '';
      return `<li><span class="avatar sm">${esc(p.initials)}</span><span class="chat-member-name">${esc(p.name)}${self ? ' <span class="small muted">(você)</span>' : ''}</span>${info.kind === 'group' && p.role === 'admin' ? '<span class="badge b-gray">administra</span>' : ''}${acts}</li>`;
    }).join('');
    const outside = team.filter((u) => !info.people.some((p) => String(p.id) === String(u.id)));
    $('[data-chat-d-add]', dInfo).hidden = !admin || !outside.length;
    $('[data-chat-d-add-people]', dInfo).innerHTML = checks(outside);
    $('[data-chat-d-leave]', dInfo).hidden = info.kind !== 'group';
    $('[data-chat-d-err]', dInfo).hidden = true;
  }
  const dErr = (x) => { const n = $('[data-chat-d-err]', dInfo); n.textContent = x.message; n.hidden = false; };
  $('[data-chat-info]').addEventListener('click', async () => { try { await loadInfo(); dInfo.showModal(); } catch (x) { showErr(x); } });
  const afterManage = async () => { await loadInfo(); S.convs = (await api('/mensagens/conversas')).conversations; S.cur = S.convs.find((c) => c.id === S.cur.id) || S.cur; paintHead(); paintConvs(); };
  dInfo.addEventListener('click', async (e) => {
    const url = `/mensagens/conversas/${info?.id}`;
    try {
      if (e.target.closest('[data-chat-d-rename]')) { const f = $('[data-chat-d-rename-form]', dInfo); f.hidden = false; f.nome.value = info.name; f.nome.focus(); return; }
      if (e.target.closest('[data-chat-d-rename-cancel]')) { $('[data-chat-d-rename-form]', dInfo).hidden = true; return; }
      const role = e.target.closest('[data-role]');
      if (role) { await api(`${url}/pessoas/${role.dataset.uid}/papel`, { papel: role.dataset.role }); await afterManage(); return; }
      const rm = e.target.closest('[data-remove]');
      if (rm) { if (window.confirm('Remover esta pessoa do grupo?')) { await api(`${url}/pessoas/${rm.dataset.remove}/remover`, {}); await afterManage(); } return; }
      if (e.target.closest('[data-chat-d-leave]')) {
        if (!window.confirm('Sair deste grupo? Você deixa de ver as mensagens.')) return;
        await api(`${url}/sair`, {}); dInfo.close(); S.convs = S.convs.filter((c) => c.id !== info.id); closeConv();
      }
    } catch (x) { dErr(x); }
  });
  $('[data-chat-d-rename-form]').addEventListener('submit', async (e) => { e.preventDefault(); try { await api(`/mensagens/conversas/${info.id}/nome`, { nome: e.target.nome.value }); await afterManage(); } catch (x) { dErr(x); } });
  $('[data-chat-d-add-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ids = $$('input[name="pessoas"]:checked', e.target).map((i) => i.value);
    if (!ids.length) return;
    try { await api(`/mensagens/conversas/${info.id}/pessoas`, { pessoas: ids }); $('[data-chat-d-add]', dInfo).open = false; await afterManage(); } catch (x) { dErr(x); }
  });

  // ---------------------------------------------------------------- resumo com IA
  const dSum = $('#chat-resumo');
  let sumTarget = null; let sumId = null; let sumPoll = null;
  const sumPart = (s) => $(`[data-chat-sum-${s}]`, dSum);
  function resetSum() { clearTimeout(sumPoll); sumId = null; sumPart('form').hidden = false; sumPart('wait').hidden = true; sumPart('err').hidden = true; sumPart('result').hidden = true; sumPart('done').hidden = true; }
  function openSum(thread) {
    resetSum();
    sumTarget = thread;
    sumPart('scopes').hidden = Boolean(thread); sumPart('thread').hidden = !thread;
    const n = S.unreadCount || 0; const u = sumPart('unread');
    u.hidden = thread || !n; sumPart('n').textContent = n ? String(n) : '';
    if (!thread) { const pick = dSum.querySelector(`input[value="${n ? 'nao_lidas' : '24h'}"]`); pick.checked = true; }
    dSum.showModal();
  }
  function showSum(s) {
    if (s.status === 'pendente' || s.status === 'gerando') { sumPoll = setTimeout(pollSum, 3000); return; }
    clearTimeout(sumPoll);
    sumPart('wait').hidden = true;
    if (s.status === 'erro') { sumPart('err').textContent = s.error; sumPart('err').hidden = false; sumPart('form').hidden = false; return; }
    sumPart('done').hidden = false;
    const ul = (title, list) => (list.length ? `<span class="kicker">${title}</span><ul>${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
    sumPart('result').innerHTML = `<p>${esc(s.result.resumo)}</p>${ul('Decisões', s.result.decisoes)}${ul('Pendências', s.result.pendencias)}<p class="mono small muted">${s.message_count} ${s.message_count === 1 ? 'mensagem' : 'mensagens'} lidas pela IA</p>`;
    sumPart('result').hidden = false;
  }
  async function pollSum() { if (!sumId) return; try { showSum((await api(`/mensagens/resumos/${sumId}`)).summary); } catch { sumPoll = setTimeout(pollSum, 3000); } }
  if (dSum) {
    $('[data-chat-summary]').addEventListener('click', () => openSum(null));
    $('[data-chat-thread-summary]').addEventListener('click', () => openSum(S.thread));
    sumPart('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const scope = sumTarget ? 'thread' : e.target.alcance.value;
      resetSum(); sumPart('form').hidden = true; sumPart('wait').hidden = false;
      try {
        const r = await api(`/mensagens/conversas/${S.cur.id}/resumo`, { alcance: scope, desde_id: scope === 'nao_lidas' ? S.firstUnread : undefined, parent_id: sumTarget ? sumTarget.id : undefined });
        sumId = r.id; sumPoll = setTimeout(pollSum, 3000);
      } catch (x) { sumPart('wait').hidden = true; sumPart('form').hidden = false; sumPart('err').textContent = x.message; sumPart('err').hidden = false; }
    });
    dSum.addEventListener('close', () => { clearTimeout(sumPoll); sumId = null; });
  }

  // ---------------------------------------------------------------- tempo real
  function onEvent(ev) {
    let d; try { d = JSON.parse(ev.data); } catch { return; }
    if (d.kind === 'mensagem') {
      (d.messages || []).forEach(merge);
      if (S.cur?.id === d.conversationId) markRead();
      refreshConvs();
    } else if (d.kind === 'lida') refreshConvs();
    else if (d.kind === 'conversa') {
      refreshConvs();
      if (S.cur?.id === d.conversationId) api(`/mensagens/conversas/${d.conversationId}`).then((r) => { Object.assign(S.cur, r.conversation); paintHead(); }, () => closeConv());
    } else if (d.kind === 'resumo' && d.summaryId === sumId) pollSum();
  }
  const attach = () => {
    const es = window.pulsoEvents;
    if (!es) return;
    es.addEventListener('chat', onEvent);
    es.addEventListener('open', sync); // reconectou: pega o que passou enquanto estava fora
  };
  if (window.pulsoEvents) attach(); else document.addEventListener('DOMContentLoaded', attach); // collab.js, que abre a conexão, carrega depois deste arquivo
  window.addEventListener('online', () => { el.offline.hidden = true; retryIn = 2000; flush(); sync(); });
  window.addEventListener('offline', () => { el.offline.hidden = false; });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { sync(); flush(); } });
  setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 30000); // rede de segurança, mesmo com o tempo real ligado

  paintConvs();
  if (root.dataset.open) open(Number(root.dataset.open), { push: false });
  if (pending.length) flush();
}());
