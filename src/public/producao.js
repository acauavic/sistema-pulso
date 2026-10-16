// Produção do episódio: envio de arquivos grandes em partes, revisão com comentários na minutagem e checklists.
// Sem inline script (CSP 'self'). O servidor recebe cada parte e repassa ao Backblaze; links assinados servem o vídeo.
(function () {
  const fmtBytes = (n) => {
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let x = n;
    while (x >= 1024 && i < u.length - 1) { x /= 1024; i += 1; }
    return `${x >= 100 || i === 0 ? Math.round(x) : x.toFixed(1).replace('.', ',')} ${u[i]}`;
  };
  const clock = (ms) => {
    const t = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const s = t % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Lê a largura e a altura do vídeo no próprio navegador (sem enviar nada). Se o navegador não decodifica o formato, deixa o servidor decidir.
  function videoSize(file) {
    return new Promise((resolve) => {
      const v = document.createElement('video'); const url = URL.createObjectURL(file);
      const done = (r) => { URL.revokeObjectURL(url); resolve(r); };
      v.preload = 'metadata'; v.muted = true;
      v.onloadedmetadata = () => done({ w: v.videoWidth, h: v.videoHeight });
      v.onerror = () => done(null);
      setTimeout(() => done(null), 8000);
      v.src = url;
    });
  }
  async function requireHorizontal(file) {
    const size = await videoSize(file);
    if (size && size.w && size.h && size.w <= size.h) {
      throw new Error(`o vídeo do episódio precisa ser horizontal (16:9); este é ${size.h > size.w ? 'vertical' : 'quadrado'} (${size.w}×${size.h}). Cortes verticais são enviados em Conteúdo`);
    }
  }

  // ---------------------------------------------------------------- envio em partes
  document.querySelectorAll('[data-uploader]').forEach((box) => {
    const base = box.dataset.base;
    const csrf = box.dataset.csrf;
    const edited = box.dataset.edited === '1';
    const queue = box.querySelector('[data-queue]');
    const input = box.querySelector('[data-files]');
    const startBtn = box.querySelector('[data-start]');
    const CONCURRENCY = 3;

    const json = async (url, opts = {}) => {
      const res = await fetch(url, { ...opts, headers: { Accept: 'application/json', 'x-csrf-token': csrf, ...(opts.headers || {}) } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || `erro ${res.status}`);
      return body;
    };

    function row(file) {
      const li = document.createElement('li');
      li.className = 'upload-item';
      li.innerHTML = '<div class="row"><strong class="u-name"></strong><span class="handle muted u-size"></span><span class="u-state small"></span></div><div class="bar"><i></i></div>';
      li.querySelector('.u-name').textContent = file.name;
      li.querySelector('.u-size').textContent = fmtBytes(file.size);
      queue.appendChild(li);
      return { li, bar: li.querySelector('.bar i'), state: li.querySelector('.u-state') };
    }

    async function sendPart(id, file, partSize, n, ui, progress) {
      const start = (n - 1) * partSize;
      const blob = file.slice(start, Math.min(file.size, start + partSize));
      for (let attempt = 1; ; attempt += 1) {
        try {
          await json(`${base}${id}/parte/${n}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
          progress.done += blob.size;
          ui.bar.style.width = `${Math.round((progress.done / file.size) * 100)}%`;
          ui.state.textContent = `${Math.round((progress.done / file.size) * 100)}%`;
          return;
        } catch (err) {
          if (attempt >= 4) throw err;
          ui.state.textContent = `reenviando parte ${n} (tentativa ${attempt + 1})…`;
          await sleep(1500 * attempt);
        }
      }
    }

    async function upload(file) {
      const ui = row(file);
      let id = null;
      try {
        const kind = edited ? 'editado' : (box.querySelector('[data-kind]')?.value || 'corte');
        if (edited) await requireHorizontal(file); // o vídeo pilar do episódio é horizontal: avisa antes de subir gigabytes
        const label = box.querySelector('[data-label]')?.value || '';
        ui.state.textContent = 'preparando…';
        const init = await json(`${base}iniciar`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, rotulo: label, nome: file.name, tamanho: file.size, tipo: file.type }),
        });
        id = init.id;
        const progress = { done: 0 };
        const parts = Array.from({ length: init.totalParts }, (_, i) => i + 1);
        const workers = Array.from({ length: Math.min(CONCURRENCY, parts.length) }, async () => {
          while (parts.length) await sendPart(id, file, init.partSize, parts.shift(), ui, progress);
        });
        await Promise.all(workers);
        ui.state.textContent = 'finalizando…';
        await json(`${base}${id}/concluir`, { method: 'POST' });
        ui.bar.style.width = '100%';
        ui.li.classList.add('ok');
        ui.state.textContent = 'enviado';
        return true;
      } catch (err) {
        ui.li.classList.add('err');
        ui.state.textContent = `falhou: ${err.message}`;
        if (id) json(`${base}${id}/cancelar`, { method: 'POST' }).catch(() => {});
        return false;
      }
    }

    startBtn?.addEventListener('click', async () => {
      const files = [...input.files];
      if (!files.length) { input.focus(); return; }
      startBtn.disabled = true;
      input.disabled = true;
      let allOk = true;
      for (const f of files) allOk = (await upload(f)) && allOk; // um arquivo por vez (cada um já usa 3 conexões)
      startBtn.disabled = false;
      input.disabled = false;
      input.value = '';
      if (allOk) { window.location.hash = box.dataset.hash || (edited ? 'edicao' : 'material'); window.location.reload(); }
    });

    // não deixa fechar a aba no meio de um envio sem avisar
    window.addEventListener('beforeunload', (e) => { if (startBtn?.disabled) { e.preventDefault(); e.returnValue = ''; } });
  });

  // ---------------------------------------------------------------- checklists
  document.querySelectorAll('[data-check]').forEach((box) => {
    box.addEventListener('change', async () => {
      const done = box.checked;
      try {
        const res = await fetch(box.dataset.check, {
          method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'x-csrf-token': box.dataset.csrf },
          body: new URLSearchParams({ done: done ? '1' : '0' }),
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        box.checked = !done;
        window.alert('Não foi possível salvar o item. Tente de novo.');
      }
    });
  });

  // ---------------------------------------------------------------- IA de finalização: andamento, contadores e sugestões
  const ia = document.querySelector('[data-ia]');
  if (ia && ia.dataset.running === '1') {
    const poll = async () => {
      try {
        const res = await fetch(ia.dataset.url, { headers: { Accept: 'application/json' } });
        const { job } = await res.json();
        if (job) {
          const msg = ia.querySelector('[data-ia-msg]'); const bar = ia.querySelector('[data-ia-bar]'); const badge = ia.querySelector('[data-ia-badge]');
          if (msg) msg.textContent = job.message || '';
          if (bar) bar.style.width = `${job.progress}%`;
          if (badge) badge.textContent = job.status === 'queued' ? 'na fila' : 'rodando';
          if (job.status === 'done' || job.status === 'error') { window.location.hash = 'finalizacao'; window.location.reload(); return; }
        }
      } catch { /* tenta de novo */ }
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 2000);
  }
  // larguras de barra vêm em data-w (a CSP não aceita style= inline)
  document.querySelectorAll('[data-w]').forEach((el) => { el.style.width = `${el.dataset.w}%`; });

  // ---------------------------------------------------------------- cortes e publicações em andamento
  const cortes = document.querySelector('[data-cortes]');
  if (cortes && cortes.dataset.running === '1') {
    let last = null;
    const poll = async () => {
      try {
        const res = await fetch(cortes.dataset.url, { headers: { Accept: 'application/json' } });
        const data = await res.json();
        for (const c of data.clips || []) {
          const scope = cortes.dataset.single ? (String(c.id) === cortes.dataset.single ? document : null) : document.querySelector(`[data-clip="${c.id}"]`);
          if (!scope) continue;
          const msg = scope.querySelector('[data-clip-msg]'); const bar = scope.querySelector('[data-clip-bar]');
          if (msg && c.message) msg.textContent = c.message;
          if (bar && c.progress != null) bar.style.width = `${c.progress}%`;
        }
        const sig = JSON.stringify([(data.clips || []).map((c) => [c.id, c.status]), (data.publications || []).map((p) => [p.id, p.status])]);
        if (last && sig !== last) { window.location.reload(); return; }
        last = sig;
      } catch { /* tenta de novo */ }
      setTimeout(poll, 4000);
    };
    poll();
  }

  // ---------------------------------------------------------------- janelas (modal) e envio automático de seletores
  // a abertura/fechamento das janelas fica no app.js; aqui só preenchemos a janela de edição de tarefa antes de abrir
  document.querySelectorAll('[data-modal-open][data-task]').forEach((btn) => btn.addEventListener('click', () => {
    const dlg = document.getElementById(btn.dataset.modalOpen);
    if (!dlg) return;
    const t = JSON.parse(btn.dataset.task);
    const form = dlg.querySelector('[data-task-form]');
    form.action = `/episodios/${location.pathname.split('/')[2]}/tarefas/${t.id}`;
    form.querySelectorAll('[data-f]').forEach((el) => { el.value = t[el.dataset.f] ?? ''; });
    const title = form.querySelector('[data-f-text]'); if (title) title.textContent = t.title;
    const rm = form.querySelector('[data-task-remove]'); if (rm) rm.setAttribute('formaction', `${form.action}/excluir`);
  }));
  document.querySelectorAll('[data-task-remove]').forEach((b) => b.addEventListener('click', (e) => { if (!window.confirm('Remover esta tarefa?')) e.preventDefault(); }));
  const bytes = (s) => new TextEncoder().encode(s).length;
  document.querySelectorAll('[data-counter-for]').forEach((el) => {
    const field = document.getElementById(el.dataset.counterFor) || document.querySelector(`[name="${el.dataset.counterFor}"]`);
    if (!field) return;
    const max = Number(el.dataset.max || 0); const maxBytes = Number(el.dataset.maxBytes || 0); const ideal = Number(el.dataset.ideal || 0);
    const draw = () => {
      const len = field.value.length; const b = bytes(field.value);
      const used = maxBytes ? b : len; const limit = maxBytes || max;
      el.textContent = maxBytes ? `${b}/${maxBytes} bytes` : `${len}/${max}${ideal ? ` (ideal até ${ideal})` : ''}`;
      el.classList.toggle('bad', used > limit);
      el.classList.toggle('warn', used <= limit && ((ideal && len > ideal) || used > limit * 0.95));
    };
    field.addEventListener('input', draw); draw();
  });
  document.querySelectorAll('[data-fill]').forEach((b) => b.addEventListener('click', () => {
    const f = document.querySelector(`[name="${b.dataset.fill}"]`);
    if (f && !f.readOnly) { f.value = b.dataset.value; f.dispatchEvent(new Event('input')); f.focus(); }
  }));
  document.querySelectorAll('.frame input[type=radio]').forEach((r) => r.addEventListener('change', () => {
    document.querySelectorAll('.frame').forEach((l) => l.classList.toggle('on', l.contains(r) && r.checked));
  }));

  // ---------------------------------------------------------------- revisão: player e comentários na minutagem
  // Tudo acontece na própria página: comentar, resolver e apagar não recarregam, e o vídeo continua onde está.
  const review = document.querySelector('[data-review]');
  const epId = location.pathname.split('/')[2];
  const post = (url, data) => fetch(url, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'x-csrf-token': (review?.dataset.csrf || document.querySelector('meta[name="csrf"]')?.content || '') },
    body: new URLSearchParams(data),
  });

  const video = review?.querySelector('[data-video]');
  const nowEl = review?.querySelector('[data-now]');
  const timeline = review?.querySelector('[data-timeline]');
  const list = document.querySelector('[data-comment-list]');
  const form = review?.querySelector('[data-comment-form]');
  const tickable = Boolean(form);

  function drawMarkers() {
    if (!timeline || !video || !Number.isFinite(video.duration) || !video.duration) return;
    timeline.innerHTML = '';
    document.querySelectorAll('[data-comment-list] .comment[data-at]').forEach((c) => {
      if (c.dataset.at === '') return;
      const ms = Number(c.dataset.at);
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `marker${c.classList.contains('resolved') ? ' resolved' : ''}`;
      dot.style.left = `${Math.min(100, (ms / 1000 / video.duration) * 100)}%`;
      dot.title = clock(ms);
      dot.setAttribute('aria-label', `Comentário em ${clock(ms)}`);
      dot.addEventListener('click', (e) => { e.stopPropagation(); video.currentTime = ms / 1000; c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
      timeline.appendChild(dot);
    });
  }

  // contador da aba "Revisão" (comentários em aberto)
  function setBadge(counts) {
    const tab = document.querySelector('[data-tab-btn="revisao"]');
    if (!tab || !counts) return;
    let badge = tab.querySelector('.count');
    if (!counts.open) { if (badge) badge.remove(); return; }
    if (!badge) { badge = document.createElement('span'); badge.className = 'count'; tab.append(' ', badge); }
    badge.textContent = counts.open;
  }
  const refreshEmpty = () => { const none = list?.querySelector('[data-no-comments]'); if (none) none.hidden = list.querySelectorAll('.comment').length > 0; };

  // ---- controles do player: ir e voltar, play/pause, velocidade
  if (video) {
    const cur = review.querySelector('[data-cur]'); const dur = review.querySelector('[data-dur]');
    const playBtn = review.querySelector('[data-playpause]');
    const syncTime = () => { const t = clock(video.currentTime * 1000); if (cur) cur.textContent = t; if (nowEl) nowEl.textContent = t; };
    const syncPlay = () => {
      const playing = !video.paused && !video.ended;
      review.querySelector('[data-pp-play]').hidden = playing; review.querySelector('[data-pp-pause]').hidden = !playing;
      playBtn?.setAttribute('aria-label', playing ? 'Pausar' : 'Reproduzir');
    };
    const skip = (secs) => {
      const max = Number.isFinite(video.duration) ? video.duration : Infinity;
      video.currentTime = Math.min(max, Math.max(0, video.currentTime + secs)); syncTime();
    };
    const toggle = () => { if (video.paused) video.play().catch(() => {}); else video.pause(); };
    review.querySelectorAll('[data-skip]').forEach((b) => b.addEventListener('click', () => skip(Number(b.dataset.skip))));
    playBtn?.addEventListener('click', toggle);
    review.querySelector('[data-speed]')?.addEventListener('change', (e) => { video.playbackRate = Number(e.target.value); });

    video.addEventListener('loadedmetadata', () => { drawMarkers(); if (dur) dur.textContent = clock(video.duration * 1000); });
    video.addEventListener('durationchange', () => { if (dur && Number.isFinite(video.duration)) dur.textContent = clock(video.duration * 1000); });
    video.addEventListener('timeupdate', syncTime);
    video.addEventListener('seeked', syncTime);
    video.addEventListener('play', syncPlay); video.addEventListener('pause', syncPlay); video.addEventListener('ended', syncPlay);
    if (video.readyState >= 1) { drawMarkers(); if (dur) dur.textContent = clock(video.duration * 1000); }
    syncPlay();
    // ao escrever um comentário o vídeo pausa, para o ponto não fugir
    form?.querySelector('textarea')?.addEventListener('focus', () => video.pause());

    // clicar na linha dos marcadores leva o vídeo até aquele ponto
    timeline?.addEventListener('click', (e) => {
      if (e.target !== timeline || !Number.isFinite(video.duration)) return;
      const r = timeline.getBoundingClientRect();
      video.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * video.duration; syncTime();
    });

    // atalhos (fora de campos de texto, e só com a aba Revisão à vista)
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !video.offsetParent) return;
      const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (document.querySelector('dialog[open]')) return;
      const k = e.key.toLowerCase(); let used = true;
      if (k === ' ' || k === 'k') toggle();
      else if (k === 'arrowleft') skip(-5); else if (k === 'arrowright') skip(5);
      else if (k === 'j') skip(-10); else if (k === 'l') skip(10);
      else if (k === ',' || k === '.') { video.pause(); skip(k === ',' ? -1 / 30 : 1 / 30); }
      else if (k === 'c' && form) { form.querySelector('textarea').focus(); }
      else used = false;
      if (used) e.preventDefault();
    });
  }

  document.querySelectorAll('[data-seek]').forEach((b) => b.addEventListener('click', () => {
    if (!video) return;
    video.currentTime = Number(b.dataset.seek) / 1000;
    video.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }));

  // ---- comentar, resolver e apagar sem recarregar
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  function renderComment(c) {
    const li = el('li', 'comment'); li.dataset.at = c.at_ms == null ? '' : String(c.at_ms); li.dataset.id = String(c.id);
    const head = el('div', 'row');
    if (c.at_ms != null) { const b = el('button', 'seek handle', `\u00a0${c.clock}`); b.type = 'button'; b.dataset.seek = String(c.at_ms); b.addEventListener('click', () => { video.currentTime = c.at_ms / 1000; video.scrollIntoView({ block: 'center', behavior: 'smooth' }); }); head.append(b); }
    else head.append(el('span', 'badge b-gray', 'geral'));
    head.append(el('span', 'small muted', `${c.author || '—'} · ${c.when}`));
    const body = el('p', 'pre', c.body);
    const actions = el('div', 'row small');
    if (tickable) actions.append(resolveButton(c.id, false));
    actions.append(deleteForm(c.id));
    li.append(head, body, actions);
    return li;
  }
  function resolveButton(id, resolved) {
    const b = el('button', 'link', resolved ? 'reabrir' : 'marcar como resolvido'); b.type = 'button'; b.dataset.resolve = resolved ? '0' : '1'; b.dataset.comment = String(id);
    b.addEventListener('click', () => resolveComment(b)); return b;
  }
  function deleteForm(id) {
    const f = el('form', 'inline'); f.method = 'post'; f.action = `/episodios/${epId}/comentarios/${id}/excluir`; f.dataset.commentDelete = '';
    const tok = el('input'); tok.type = 'hidden'; tok.name = '_csrf'; tok.value = review?.dataset.csrf || document.querySelector('meta[name="csrf"]')?.content || '';
    const b = el('button', 'link', 'apagar'); b.type = 'submit'; f.append(tok, b); bindDelete(f); return f;
  }
  function insertSorted(li) {
    const key = (n) => (n.dataset.at === '' ? -1 : Number(n.dataset.at));
    const next = [...list.querySelectorAll('.comment')].find((n) => key(n) > key(li) || (key(n) === key(li) && Number(n.dataset.id) > Number(li.dataset.id)));
    if (next) list.insertBefore(li, next); else list.insertBefore(li, list.querySelector('[data-no-comments]') || null);
  }

  const submitComment = async (general) => {
    const text = form.querySelector('textarea');
    if (!text.value.trim()) { text.focus(); return; }
    const buttons = form.querySelectorAll('button'); buttons.forEach((b) => { b.disabled = true; });
    try {
      const res = await post(review.dataset.url, { body: text.value, at_ms: general ? '' : String(Math.round(video.currentTime * 1000)), file_id: review.dataset.file });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) { window.alert(out.error || 'Não foi possível salvar o comentário.'); return; }
      const li = renderComment(out.comment); insertSorted(li); refreshEmpty(); setBadge(out.counts); drawMarkers();
      text.value = ''; li.classList.add('just-added'); li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setTimeout(() => li.classList.remove('just-added'), 2400);
      text.focus();
    } catch { window.alert('Sem conexão. Tente de novo.'); } finally { buttons.forEach((b) => { b.disabled = false; }); }
  };
  form?.addEventListener('submit', (e) => { e.preventDefault(); submitComment(false); });
  review?.querySelector('[data-general]')?.addEventListener('click', () => submitComment(true));
  form?.querySelector('textarea')?.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submitComment(false); } });

  async function resolveComment(b) {
    const li = b.closest('.comment'); b.disabled = true;
    try {
      const res = await post(`/episodios/${epId}/comentarios/${b.dataset.comment}/resolver`, { resolved: b.dataset.resolve });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) { window.alert('Não foi possível atualizar o comentário.'); return; }
      li.classList.toggle('resolved', out.resolved); b.dataset.resolve = out.resolved ? '0' : '1'; b.textContent = out.resolved ? 'reabrir' : 'marcar como resolvido';
      setBadge(out.counts); drawMarkers();
    } finally { b.disabled = false; }
  }
  document.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', () => resolveComment(b)));

  function bindDelete(f) {
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); e.stopPropagation(); // a confirmação é daqui (a do app.js é para quem está sem JS)
      if (!window.confirm('Apagar este comentário?')) return;
      const li = f.closest('.comment');
      const res = await post(f.action, {});
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) { window.alert(out.error || 'Não foi possível apagar o comentário.'); return; }
      li.remove(); refreshEmpty(); setBadge(out.counts); drawMarkers();
    });
  }
  document.querySelectorAll('[data-comment-delete]').forEach(bindDelete);
})();
