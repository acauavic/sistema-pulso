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

  // ---------------------------------------------------------------- envio de arquivos
  // A fila de verdade (partes, tentativas, bandeja, envio em segundo plano) vive em uploads.js; aqui só se escolhe o que enviar.
  const uploads = () => window.PulsoUploads;
  const shellHidden = () => document.body.classList.contains('upl-shell-on'); // esta página está escondida sob o quadro de navegação: nunca recarregar

  // Ao terminar o lote, a página do envio se atualiza sozinha, sem atropelar quem está digitando ou com janela aberta.
  function refreshWhenDone(box) {
    const note = box.querySelector('[data-refresh-note]');
    document.addEventListener('DOMContentLoaded', () => { // uploads.js carrega depois desta página; ao fim do carregamento a fila já existe
    const U = uploads();
    if (!U) return;
    const off = U.on((ev) => {
      if (ev.type !== 'all-done' || !ev.bases.includes(box.dataset.base) || shellHidden()) return;
      if (ev.failed) { if (note) { note.textContent = 'Alguns arquivos não subiram. Veja a bandeja de envios para tentar de novo.'; note.hidden = false; } return; }
      const a = document.activeElement;
      const busy = document.querySelector('dialog[open]') || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'file');
      if (busy) { if (note) { note.hidden = false; note.querySelector('[data-refresh]')?.addEventListener('click', () => window.location.reload()); } return; }
      window.location.hash = box.dataset.hash || '';
      window.location.reload();
    });
    window.addEventListener('pagehide', off);
    });
  }

  // Vídeo editado e cortes: escolher e enviar (um vídeo por clique no botão, vários nos cortes).
  document.querySelectorAll('[data-uploader]').forEach((box) => {
    const input = box.querySelector('[data-files]');
    const startBtn = box.querySelector('[data-start]');
    const queue = box.querySelector('[data-queue]');
    const edited = box.dataset.edited === '1';
    const say = (text) => { const li = document.createElement('li'); li.className = 'upload-item err'; li.innerHTML = '<span class="u-state small"></span>'; li.firstChild.textContent = text; queue.appendChild(li); };
    refreshWhenDone(box);
    startBtn?.addEventListener('click', async () => {
      const files = [...input.files];
      if (!files.length) { input.focus(); return; }
      queue.replaceChildren();
      const ok = [];
      for (const f of files) {
        try { if (edited) await requireHorizontal(f); ok.push({ file: f, kind: edited ? 'editado' : 'corte', label: '' }); } catch (err) { say(`${f.name}: ${err.message}`); }
      }
      input.value = '';
      if (ok.length) {
        uploads().add(ok, { base: box.dataset.base, csrf: box.dataset.csrf, where: box.dataset.where || '', hash: box.dataset.hash });
        if (box.dataset.closeOnStart) box.closest('dialog')?.close(); // a bandeja mostra o andamento; a página se atualiza no fim
      }
    });
  });

  // Material bruto: tudo de uma vez (vídeos, áudios, fotos), e uma janela para dizer o que é cada coisa.
  const EXT = {
    video: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mxf', 'mts', 'm2ts', 'braw', 'r3d', 'mpg', 'mpeg', 'wmv'],
    audio: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'aif', 'aiff', 'ogg', 'opus', 'wma'],
    image: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff', 'dng', 'cr2', 'cr3', 'arw', 'nef', 'gif'],
  };
  const GROUPS = {
    bruto_video: { label: 'Vídeo do episódio', labelled: true, ph: 'Rótulo (ex.: Câmera 1)' },
    bruto_audio: { label: 'Áudio', labelled: true, ph: 'Rótulo (ex.: Lapela do convidado)' },
    bastidor: { label: 'Bastidores', labelled: false },
    foto: { label: 'Fotografias', labelled: false },
    outro: { label: 'Outro', labelled: true, ph: 'Rótulo (opcional)' },
  };
  const TYPES = [
    { key: 'video', title: 'Vídeos', options: ['bruto_video', 'bastidor', 'outro'], listed: true },
    { key: 'audio', title: 'Áudios', options: ['bruto_audio', 'outro'], listed: true },
    { key: 'image', title: 'Imagens', options: ['foto', 'bastidor', 'outro'], listed: false },
    { key: 'outro', title: 'Outros arquivos', options: ['outro'], listed: true },
  ];
  const typeOf = (name) => {
    const ext = (String(name).match(/\.([A-Za-z0-9]{1,6})$/) || [])[1]?.toLowerCase() || '';
    return Object.keys(EXT).find((k) => EXT[k].includes(ext)) || 'outro';
  };
  const firstOption = (t) => TYPES.find((x) => x.key === t).options[0];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  document.querySelectorAll('[data-material]').forEach((box) => {
    const picker = box.querySelector('[data-material-files]');
    const dlg = document.querySelector('[data-material-dialog]');
    if (!picker || !dlg) return;
    const sections = dlg.querySelector('[data-m-sections]');
    const summary = dlg.querySelector('[data-m-summary]');
    const sendBtn = dlg.querySelector('[data-m-send]');
    let rows = [];
    let existing = []; // o que já está no material bruto deste episódio (servidor)
    let dupChoice = 'skip'; // arquivos com o mesmo nome de um já enviado: skip (não enviar) | replace (substituir) | keep (manter os dois)
    refreshWhenDone(box);

    const key = (f) => `${f.name}|${f.size}|${f.lastModified}`;
    // o servidor guarda o nome "limpo" (sem / : * ? " < > |): compara do mesmo jeito, sem diferenciar maiúsculas
    const sameName = (a, b) => String(a).normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180).toLowerCase() === String(b).toLowerCase();
    // Cada arquivo escolhido: new (novo), resume (tinha parado no meio: continua de onde parou), redo (parou no meio mas o arquivo mudou:
    // o envio velho sai e este recomeça), dup (já existe completo) ou queued (já está na fila de envio agora).
    function classify() {
      rows.forEach((r) => {
        r.state = 'new'; r.match = null;
        if (uploads()?.has?.(box.dataset.base, r.file.name, r.file.size)) { r.state = 'queued'; return; }
        const same = existing.filter((f) => sameName(r.file.name, f.name));
        const partial = same.find((f) => f.status === 'enviando' && f.size === r.file.size);
        if (partial) { r.state = 'resume'; r.match = partial; return; }
        const done = same.filter((f) => f.status === 'pronto');
        if (done.length) { r.state = 'dup'; r.match = done[done.length - 1]; return; }
        const other = same.find((f) => f.status === 'enviando');
        if (other) { r.state = 'redo'; r.match = other; }
      });
    }
    const goes = (r) => r.state !== 'queued' && !(r.state === 'dup' && dupChoice === 'skip');
    async function loadExisting() {
      try {
        const res = await fetch(`${box.dataset.base}existentes`, { headers: { Accept: 'application/json' } });
        const body = await res.json();
        existing = res.ok && body.ok ? body.files : [];
      } catch { existing = []; }
    }
    async function addFiles(list) {
      const seen = new Set(rows.map((r) => key(r.file)));
      const fresh = [];
      [...list].forEach((f) => { if (f.size > 0 && !seen.has(key(f))) { seen.add(key(f)); const type = typeOf(f.name); fresh.push({ file: f, type, group: firstOption(type), label: '' }); } });
      if (!fresh.length && !rows.length) return;
      rows.push(...fresh);
      if (!dlg.open) { summary.textContent = 'Conferindo o que já está no episódio…'; sections.replaceChildren(); sendBtn.disabled = true; dlg.showModal(); }
      await loadExisting();
      classify();
      // quem já existe completo herda o tipo e o rótulo de lá (substituir mantém o arquivo no mesmo lugar)
      rows.forEach((r) => { if (r.match && fresh.includes(r) && GROUPS[r.match.kind]) { r.group = TYPES.find((t) => t.key === r.type).options.includes(r.match.kind) ? r.match.kind : r.group; r.label = r.label || r.match.label || ''; } });
      render();
    }
    const total = () => rows.filter(goes).reduce((n, r) => n + r.file.size, 0);

    function rowEl(r, withSelect) {
      const li = document.createElement('li');
      li.className = 'mrow';
      const name = document.createElement('span'); name.className = 'mrow-name'; name.textContent = r.file.name; name.title = r.file.name;
      const size = document.createElement('span'); size.className = 'mono small muted'; size.textContent = fmtBytes(r.file.size);
      li.append(name, size);
      const opts = TYPES.find((x) => x.key === r.type).options;
      if (withSelect && opts.length > 1) {
        const sel = document.createElement('select'); sel.setAttribute('aria-label', `O que é ${r.file.name}`);
        opts.forEach((o) => { const op = document.createElement('option'); op.value = o; op.textContent = GROUPS[o].label; sel.appendChild(op); });
        sel.value = r.group;
        sel.addEventListener('change', () => { r.group = sel.value; render(); });
        li.appendChild(sel);
      }
      if (GROUPS[r.group].labelled) {
        const inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 80; inp.value = r.label; inp.placeholder = GROUPS[r.group].ph;
        inp.setAttribute('aria-label', `Rótulo de ${r.file.name}`);
        inp.addEventListener('input', () => { r.label = inp.value; });
        li.appendChild(inp);
      }
      const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'icon-btn'; rm.setAttribute('aria-label', `Tirar ${r.file.name}`); rm.title = 'Tirar da lista';
      rm.textContent = '×';
      rm.addEventListener('click', () => { rows = rows.filter((x) => x !== r); if (!rows.length) dlg.close(); else render(); });
      if (r.state === 'resume') { const tag = document.createElement('span'); tag.className = 'badge b-amber mrow-tag'; tag.textContent = 'continua'; tag.title = 'Tinha parado no meio do envio: continua de onde parou'; name.prepend(tag); }
      if (r.state === 'dup') { const tag = document.createElement('span'); tag.className = 'badge b-gray mrow-tag'; tag.textContent = dupChoice === 'replace' ? 'substitui' : 'cópia'; name.prepend(tag); }
      li.appendChild(rm);
      return li;
    }

    function bulkSelect(type, options) {
      const sel = document.createElement('select'); sel.setAttribute('aria-label', `Enviar todos os arquivos de ${type.title.toLowerCase()} como`);
      options.forEach((o) => { const op = document.createElement('option'); op.value = o; op.textContent = GROUPS[o].label; sel.appendChild(op); });
      const mine = rows.filter((r) => r.type === type.key);
      sel.value = mine.every((r) => r.group === mine[0].group) ? mine[0].group : '';
      if (!sel.value) { const op = document.createElement('option'); op.value = ''; op.textContent = 'Misto'; op.disabled = true; sel.prepend(op); sel.value = ''; }
      sel.addEventListener('change', () => { mine.forEach((r) => { r.group = sel.value; }); render(); });
      return sel;
    }

    function dupSection() {
      const dups = rows.filter((r) => r.state === 'dup');
      const resumes = rows.filter((r) => r.state === 'resume' || r.state === 'redo');
      const queued = rows.filter((r) => r.state === 'queued');
      if (!dups.length && !resumes.length && !queued.length) return null;
      const sec = document.createElement('section'); sec.className = 'msec mdup';
      if (dups.length) {
        const head = document.createElement('div'); head.className = 'msec-head';
        const h = document.createElement('strong'); h.textContent = dups.length === 1 ? 'Já existe no episódio' : 'Já existem no episódio';
        const meta = document.createElement('span'); meta.className = 'mono small muted'; meta.textContent = `${dups.length} · ${fmtBytes(dups.reduce((n, r) => n + r.file.size, 0))}`;
        head.append(h, meta); sec.appendChild(head);
        const p = document.createElement('p'); p.className = 'small muted m-0';
        p.textContent = dups.length === 1 ? 'Um arquivo tem o mesmo nome de um que já subiu. O que fazer com ele?' : `${dups.length} arquivos têm o mesmo nome de arquivos que já subiram. O que fazer com eles?`;
        sec.appendChild(p);
        const seg = document.createElement('div'); seg.className = 'seg-radio mdup-choice'; seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', 'Arquivos repetidos');
        [['skip', 'Não enviar de novo'], ['replace', 'Substituir'], ['keep', 'Manter os dois']].forEach(([v, label]) => {
          const l = document.createElement('label'); const i = document.createElement('input'); i.type = 'radio'; i.name = 'm-dup'; i.value = v; i.checked = dupChoice === v;
          i.addEventListener('change', () => { dupChoice = v; render(); });
          const sp = document.createElement('span'); sp.textContent = label; l.append(i, sp); seg.appendChild(l);
        });
        sec.appendChild(seg);
        const hint = document.createElement('p'); hint.className = 'small muted m-0';
        hint.textContent = { skip: 'Só os arquivos novos sobem.', replace: 'O arquivo antigo sai quando o novo terminar de subir (se der erro, o antigo fica).', keep: 'Os dois ficam, com o mesmo nome.' }[dupChoice];
        sec.appendChild(hint);
        const det = document.createElement('details'); det.className = 'msec-more';
        const sum = document.createElement('summary'); sum.className = 'small'; sum.textContent = `Ver ${plural(dups.length, 'arquivo repetido', 'arquivos repetidos')}`;
        const list = document.createElement('ul'); list.className = 'plain mlist';
        dups.forEach((r) => {
          const li = document.createElement('li'); li.className = 'mrow mrow-dup';
          const name = document.createElement('span'); name.className = 'mrow-name'; name.textContent = r.file.name; name.title = r.file.name;
          const sz = document.createElement('span'); sz.className = 'mono small muted'; sz.textContent = r.match.size === r.file.size ? `${fmtBytes(r.file.size)} · mesmo tamanho` : `${fmtBytes(r.file.size)} · antes ${fmtBytes(r.match.size)}`;
          li.append(name, sz); list.appendChild(li);
        });
        det.append(sum, list); sec.appendChild(det);
      }
      if (resumes.length) {
        const p = document.createElement('p'); p.className = 'small mdup-note';
        const cont = resumes.filter((r) => r.state === 'resume').length;
        p.textContent = cont === resumes.length
          ? `${plural(cont, 'arquivo tinha parado', 'arquivos tinham parado')} no meio do envio: ${cont === 1 ? 'continua' : 'continuam'} de onde parou.`
          : `${plural(resumes.length, 'arquivo tinha parado', 'arquivos tinham parado')} no meio do envio: ${cont ? `${cont} continuam de onde pararam e ` : ''}os que mudaram recomeçam.`;
        sec.appendChild(p);
      }
      if (queued.length) {
        const p = document.createElement('p'); p.className = 'small muted m-0';
        p.textContent = `${plural(queued.length, 'arquivo já está', 'arquivos já estão')} na fila de envio agora e ${queued.length === 1 ? 'ficou' : 'ficaram'} de fora.`;
        sec.appendChild(p);
      }
      return sec;
    }

    function render() {
      sections.replaceChildren();
      const ds = dupSection(); if (ds) sections.appendChild(ds);
      TYPES.forEach((t) => {
        const mine = rows.filter((r) => r.type === t.key && goes(r));
        if (!mine.length) return;
        const sec = document.createElement('section'); sec.className = 'msec';
        const head = document.createElement('div'); head.className = 'msec-head';
        const h = document.createElement('strong'); h.textContent = t.title;
        const meta = document.createElement('span'); meta.className = 'mono small muted'; meta.textContent = `${mine.length} · ${fmtBytes(mine.reduce((n, r) => n + r.file.size, 0))}`;
        head.append(h, meta);
        const bulkOpts = t.key === 'video' ? ['bruto_video', 'bastidor'] : (t.key === 'image' ? ['foto', 'bastidor'] : null);
        if (bulkOpts && (mine.length > 1 || !t.listed)) { const w = document.createElement('label'); w.className = 'msec-bulk small muted'; w.append(mine.length > 1 ? 'Todos como ' : 'Enviar como ', bulkSelect(t, bulkOpts)); head.appendChild(w); }
        sec.appendChild(head);
        const list = document.createElement('ul'); list.className = 'plain mlist';
        if (t.listed) { mine.forEach((r) => list.appendChild(rowEl(r, true))); sec.appendChild(list); } else {
          const det = document.createElement('details'); det.className = 'msec-more';
          const sum = document.createElement('summary'); sum.className = 'small'; sum.textContent = `Ver ${plural(mine.length, 'arquivo', 'arquivos')}`;
          mine.forEach((r) => list.appendChild(rowEl(r, false)));
          det.append(sum, list); sec.appendChild(det);
        }
        sections.appendChild(sec);
      });
      const by = {};
      const sending = rows.filter(goes);
      sending.forEach((r) => { by[r.group] = (by[r.group] || 0) + 1; });
      const parts = [];
      if (by.bruto_video) parts.push(plural(by.bruto_video, 'vídeo do episódio', 'vídeos do episódio'));
      if (by.bruto_audio) parts.push(plural(by.bruto_audio, 'áudio', 'áudios'));
      if (by.foto) parts.push(plural(by.foto, 'fotografia', 'fotografias'));
      if (by.bastidor) parts.push(plural(by.bastidor, 'arquivo de bastidores', 'arquivos de bastidores'));
      if (by.outro) parts.push(plural(by.outro, 'outro', 'outros'));
      summary.textContent = sending.length ? `${parts.join(' · ')} · ${fmtBytes(total())}. Rótulos são opcionais e só valem para vídeos e áudios do episódio; fotografias e bastidores entram em quantidade.` : 'Nada novo para enviar: tudo o que você escolheu já está no episódio.';
      sendBtn.disabled = !sending.length;
      sendBtn.textContent = sending.length ? `Enviar ${plural(sending.length, 'arquivo', 'arquivos')}` : 'Nada para enviar';
    }

    picker.addEventListener('change', () => { addFiles(picker.files); picker.value = ''; });
    box.closest('[data-material-drop]')?.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); box.closest('[data-material-drop]').classList.add('dropping'); } });
    box.closest('[data-material-drop]')?.addEventListener('dragleave', (e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('dropping'); });
    box.closest('[data-material-drop]')?.addEventListener('drop', (e) => { e.preventDefault(); e.currentTarget.classList.remove('dropping'); addFiles(e.dataTransfer.files); });
    document.querySelectorAll('[data-material-pick]').forEach((b) => b.addEventListener('click', () => picker.click()));
    dlg.querySelector('[data-m-more]')?.addEventListener('click', () => picker.click());
    dlg.querySelector('[data-m-cancel]')?.addEventListener('click', () => { rows = []; dupChoice = 'skip'; dlg.close(); });
    dlg.addEventListener('cancel', () => { rows = []; dupChoice = 'skip'; });
    sendBtn.addEventListener('click', () => {
      const go = rows.filter(goes);
      if (!go.length) return;
      const entries = go.map((r) => ({
        file: r.file, kind: r.group, label: GROUPS[r.group].labelled ? r.label.trim() : '',
        resumeId: r.state === 'resume' ? r.match.id : null,
        replaceId: r.state === 'redo' || (r.state === 'dup' && dupChoice === 'replace') ? r.match.id : null,
      }));
      rows = []; dupChoice = 'skip'; dlg.close();
      uploads().add(entries, { base: box.dataset.base, csrf: box.dataset.csrf, where: box.dataset.where || '', hash: box.dataset.hash });
    });
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
  // Consulta periódica só com a aba à vista: aba em segundo plano espera voltar (sem pedidos ao servidor que ninguém vê).
  const whenVisible = (fn, ms) => setTimeout(() => {
    if (!document.hidden) return fn();
    const back = () => { if (document.hidden) return; document.removeEventListener('visibilitychange', back); fn(); };
    document.addEventListener('visibilitychange', back);
  }, ms);
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
      whenVisible(poll, 3000);
    };
    whenVisible(poll, 2000);
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
      whenVisible(poll, 4000);
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
    body: data instanceof URLSearchParams ? data : new URLSearchParams(data),
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
      const end = c.dataset.end ? Number(c.dataset.end) : null;
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `marker${end != null ? ' range' : ''}${c.classList.contains('resolved') ? ' resolved' : ''}`;
      dot.style.left = `${Math.min(100, (ms / 1000 / video.duration) * 100)}%`;
      if (end != null) dot.style.width = `${Math.min(100, ((end - ms) / 1000 / video.duration) * 100)}%`;
      dot.title = end != null ? `${clock(ms)} – ${clock(end)}` : clock(ms);
      dot.setAttribute('aria-label', end != null ? `Comentário de ${clock(ms)} a ${clock(end)}` : `Comentário em ${clock(ms)}`);
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dragged) return;
        seekTo(ms, end); c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
      timeline.appendChild(dot);
    });
    drawSelection();
  }

  // ---- ir até um ponto, ou tocar um trecho e parar no fim dele
  let stopAt = null; let startedAt = 0;
  function seekTo(ms, end = null) {
    if (!video) return;
    video.currentTime = ms / 1000;
    stopAt = end; startedAt = ms;
    if (end != null) video.play().catch(() => {});
  }
  function watchStop() {
    if (stopAt == null) return;
    const now = video.currentTime * 1000;
    if (now >= stopAt) { video.pause(); stopAt = null; } else if (now < startedAt - 1000) stopAt = null; // a pessoa saiu do trecho
  }

  // ---- trecho que está sendo marcado para o próximo comentário: início e fim em ms (fim vazio = só o início marcado)
  const sel = { start: null, end: null };
  let dragged = false;
  let selBand = null;
  function drawSelection() {
    if (!timeline || !video || !Number.isFinite(video.duration) || !video.duration) return;
    if (!selBand) { selBand = document.createElement('span'); selBand.className = 'range-sel'; }
    if (selBand.parentNode !== timeline) timeline.appendChild(selBand);
    selBand.hidden = sel.start == null;
    if (sel.start == null) return;
    selBand.style.left = `${Math.min(100, (sel.start / 1000 / video.duration) * 100)}%`;
    selBand.style.width = sel.end != null ? `${Math.min(100, ((sel.end - sel.start) / 1000 / video.duration) * 100)}%` : '';
    selBand.classList.toggle('open', sel.end == null);
  }
  function syncSelection() {
    if (!form) return;
    const label = form.querySelector('[data-where-label]'); const markLabel = form.querySelector('[data-range-mark-label]');
    const mark = form.querySelector('[data-range-mark]'); const clear = form.querySelector('[data-range-clear]');
    const submit = form.querySelector('button[type=submit]');
    const has = sel.start != null;
    label.textContent = sel.end != null ? 'no trecho' : has ? 'trecho a partir de' : 'no ponto';
    if (has) nowEl.textContent = sel.end != null ? `${clock(sel.start)} – ${clock(sel.end)}` : clock(sel.start);
    else nowEl.textContent = clock(video.currentTime * 1000);
    markLabel.textContent = has ? 'Marcar fim do trecho' : 'Marcar início do trecho';
    mark.hidden = sel.end != null; clear.hidden = !has;
    const what = sel.end != null ? 'Comentar neste trecho' : 'Comentar neste ponto';
    submit.setAttribute('aria-label', what); submit.title = what;
    drawSelection();
  }
  function markStart(ms) { sel.start = ms; if (sel.end != null && sel.end <= ms) sel.end = null; syncSelection(); }
  function markEnd(ms) {
    if (sel.start == null) { markStart(ms); return; }
    if (ms === sel.start) return;
    if (ms < sel.start) { sel.end = sel.start; sel.start = ms; } else sel.end = ms;
    syncSelection();
  }
  function clearSelection() { sel.start = null; sel.end = null; syncSelection(); }

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
    const syncTime = () => { const t = clock(video.currentTime * 1000); if (cur) cur.textContent = t; if (nowEl && sel.start == null) nowEl.textContent = t; };
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
    video.addEventListener('timeupdate', () => { syncTime(); watchStop(); });
    video.addEventListener('seeked', syncTime);
    video.addEventListener('play', syncPlay); video.addEventListener('pause', syncPlay); video.addEventListener('ended', syncPlay);
    if (video.readyState >= 1) { drawMarkers(); if (dur) dur.textContent = clock(video.duration * 1000); }
    syncPlay();
    // ao escrever um comentário o vídeo pausa, para o ponto não fugir
    form?.querySelector('.rte-area')?.addEventListener('focus', () => video.pause());

    // clicar na linha dos marcadores leva o vídeo até aquele ponto
    const msAt = (x) => { const r = timeline.getBoundingClientRect(); return Math.round(Math.min(1, Math.max(0, (x - r.left) / r.width)) * video.duration * 1000); };
    timeline?.addEventListener('click', (e) => {
      if (dragged) { dragged = false; return; } // foi o fim de um arraste, não um clique
      if (e.target !== timeline || !Number.isFinite(video.duration)) return;
      video.currentTime = msAt(e.clientX) / 1000; stopAt = null; syncTime();
    });

    // arrastar na linha marca o trecho do comentário (o vídeo acompanha, para a pessoa ver onde está)
    if (timeline && tickable) {
      let from = null; let id = null;
      timeline.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !Number.isFinite(video.duration)) return;
        from = e.clientX; id = e.pointerId; dragged = false;
      });
      timeline.addEventListener('pointermove', (e) => {
        if (from == null || e.pointerId !== id) return;
        if (!dragged) {
          if (Math.abs(e.clientX - from) < 5) return;
          dragged = true; timeline.setPointerCapture(id); video.pause(); stopAt = null;
        }
        const [a, b] = [msAt(from), msAt(e.clientX)];
        sel.start = Math.min(a, b); sel.end = Math.max(a, b);
        video.currentTime = msAt(e.clientX) / 1000;
        syncSelection();
      });
      const drop = (e) => {
        if (from == null || e.pointerId !== id) return;
        from = null;
        if (!dragged) return;
        if (sel.end - sel.start < 500) clearSelection(); // meio segundo: foi um toque, não um trecho
        else video.currentTime = sel.start / 1000;
        setTimeout(() => { dragged = false; }, 0); // o clique que vem junto com o fim do arraste já passou
      };
      timeline.addEventListener('pointerup', drop);
      timeline.addEventListener('pointercancel', drop);
    }

    form?.querySelector('[data-range-mark]')?.addEventListener('click', () => {
      const ms = Math.round(video.currentTime * 1000);
      if (sel.start == null) markStart(ms); else markEnd(ms);
    });
    form?.querySelector('[data-range-clear]')?.addEventListener('click', clearSelection);

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
      else if (k === 'c' && form) { form.querySelector('.rte-area').focus(); }
      else if (k === 'i' && form) markStart(Math.round(video.currentTime * 1000));
      else if (k === 'o' && form) markEnd(Math.round(video.currentTime * 1000));
      else used = false;
      if (used) e.preventDefault();
    });
  }

  const seekFrom = (b) => { if (!video) return; seekTo(Number(b.dataset.seek), b.dataset.seekEnd ? Number(b.dataset.seekEnd) : null); video.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  document.querySelectorAll('[data-seek]:not(.comment [data-seek])').forEach((b) => b.addEventListener('click', () => seekFrom(b)));

  // ---- comentar, resolver e apagar sem recarregar
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  // O servidor devolve o comentário pronto (texto rico, anexos, áudio): aqui só se insere e se ligam os botões.
  function bindComment(li) {
    li.querySelectorAll('[data-seek]').forEach((b) => b.addEventListener('click', () => seekFrom(b)));
    li.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', () => resolveComment(b)));
    li.querySelectorAll('button[data-fix]').forEach((b) => b.addEventListener('click', () => commentAction(b, `/episodios/${epId}/comentarios/${b.dataset.fix}/feito`, { feito: b.dataset.fixTo })));
    li.querySelectorAll('[data-not-yet]').forEach((b) => b.addEventListener('click', () => commentAction(b, `/episodios/${epId}/comentarios/${b.dataset.notYet}/ainda-nao`, {})));
    li.querySelectorAll('[data-comment-delete]').forEach(bindDelete);
    window.PulsoRich?.hydrate(li);
  }
  function insertSorted(li) {
    const key = (n) => (n.dataset.at === '' ? -1 : Number(n.dataset.at));
    const next = [...list.querySelectorAll('.comment')].find((n) => key(n) > key(li) || (key(n) === key(li) && Number(n.dataset.id) > Number(li.dataset.id)));
    if (next) list.insertBefore(li, next); else list.insertBefore(li, list.querySelector('[data-no-comments]') || null);
  }

  const submitComment = async (general) => {
    const rte = form.querySelector('[data-rich]'); const html = rte.rte.getHTML(); const ids = [...rte.querySelectorAll('.rte-chip input')].map((i) => i.value);
    if (!html && !ids.length) { rte.rte.focus(); return; }
    if (rte.rte.pending()) { window.alert('Espere o envio do anexo terminar.'); return; }
    const buttons = form.querySelectorAll('button'); buttons.forEach((b) => { b.disabled = true; });
    try {
      // só o início marcado, sem o fim: vale como comentário naquele ponto
      const data = new URLSearchParams({ body_html: html, at_ms: general ? '' : String(sel.start ?? Math.round(video.currentTime * 1000)), end_ms: general || sel.end == null ? '' : String(sel.end), file_id: review.dataset.file });
      ids.forEach((id) => data.append('anexos', id));
      const res = await post(review.dataset.url, data);
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) { window.alert(out.error || 'Não foi possível salvar o comentário.'); return; }
      const li = document.createElement('template'); li.innerHTML = out.html.trim(); const node = li.content.firstElementChild;
      bindComment(node); insertSorted(node); refreshEmpty(); setBadge(out.counts); drawMarkers();
      clearSelection(); rte.rte.reset(); node.classList.add('just-added'); node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setTimeout(() => node.classList.remove('just-added'), 2400);
      rte.rte.focus();
    } catch { window.alert('Sem conexão. Tente de novo.'); } finally { buttons.forEach((b) => { b.disabled = false; }); }
  };
  form?.addEventListener('submit', (e) => { e.preventDefault(); submitComment(false); });
  review?.querySelector('[data-general]')?.addEventListener('click', () => submitComment(true));

  // Troca o comentário pelo que o servidor devolveu (estado novo: feito, conferido, devolvido) e atualiza contadores e filtro.
  function swapComment(li, out) {
    if (out.html) {
      const tpl = document.createElement('template'); tpl.innerHTML = out.html.trim(); const node = tpl.content.firstElementChild;
      bindComment(node); li.replaceWith(node);
    }
    setBadge(out.counts); setSummary(out.summary); applyFilter(); drawMarkers();
  }
  async function commentAction(b, url, data) {
    const li = b.closest('.comment'); b.disabled = true;
    try {
      const res = await post(url, data);
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) { window.alert(out.error || 'Não foi possível atualizar o comentário.'); return; }
      swapComment(li, out);
    } catch { window.alert('Sem conexão. Tente de novo.'); } finally { b.disabled = false; }
  }
  const resolveComment = (b) => commentAction(b, `/episodios/${epId}/comentarios/${b.dataset.comment}/resolver`, { resolved: b.dataset.resolve });

  // Filtro da revisão: Todos | Para conferir | Em aberto | Conferidos (só esconde na tela).
  const filterBox = document.querySelector('[data-comment-filter]');
  let filterOn = '';
  function applyFilter() {
    list?.querySelectorAll('.comment').forEach((c) => { c.hidden = Boolean(filterOn) && c.dataset.state !== filterOn; });
  }
  function setSummary(s) {
    if (!s || !filterBox) return;
    const set = (k, v) => { const n = filterBox.querySelector(`[data-n="${k}"]`); if (n) n.textContent = v; };
    set('todos', s.total); set('conferir', s.conferir); set('aberto', s.aberto); set('resolvido', s.resolvido);
  }
  filterBox?.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    filterOn = b.dataset.filter;
    filterBox.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x === b));
    applyFilter();
  }));

  // Cartão do editor (aba Material): cada ajuste com a caixa "feito"; o contador acompanha.
  const fixes = document.querySelector('[data-fixes]');
  fixes?.querySelectorAll('input[data-fix]').forEach((box) => box.addEventListener('change', async () => {
    const item = box.closest('.fix-item'); const done = box.checked;
    item.classList.toggle('done', done); // na hora; volta se der erro
    try {
      const res = await post(`/episodios/${epId}/comentarios/${box.dataset.fix}/feito`, { feito: done ? '1' : '0' });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) throw new Error(out.error || 'erro');
      const state = item.querySelector('[data-fix-state]');
      if (state) state.textContent = out.fixed ? (out.fixedVersion ? `feito na v${out.fixedVersion}` : 'feito · entra na próxima versão') : '';
      const all = fixes.querySelectorAll('input[data-fix]').length; const n = fixes.querySelectorAll('input[data-fix]:checked').length;
      const count = fixes.querySelector('[data-fix-count]'); if (count) count.textContent = `${n} de ${all} feitos`;
    } catch (err) {
      box.checked = !done; item.classList.toggle('done', !done);
      window.alert(err.message && err.message !== 'erro' ? err.message : 'Não foi possível salvar. Tente de novo.');
    }
  }));

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
  list?.querySelectorAll('.comment').forEach(bindComment);

  // editar um comentário da revisão: a janela (richtext.js abre e preenche) salva aqui, sem recarregar, e troca o item na lista
  const editDlg = document.getElementById('modal-review-edit');
  editDlg?.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget; const rte = f.querySelector('[data-rich]'); const html = rte.rte.getHTML();
    const ids = [...rte.querySelectorAll('.rte-chip input')].map((i) => i.value); const gone = [...f.querySelectorAll('input[name="remover"]:not(:disabled)')].map((i) => i.value);
    if (!html && !ids.length) { rte.rte.focus(); return; }
    if (rte.rte.pending()) { window.alert('Espere o envio do anexo terminar.'); return; }
    const buttons = f.querySelectorAll('button'); buttons.forEach((b) => { b.disabled = true; });
    try {
      const data = new URLSearchParams({ body_html: html });
      ids.forEach((id) => data.append('anexos', id)); gone.forEach((id) => data.append('remover', id));
      const res = await post(f.getAttribute('action'), data);
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) { window.alert(out.error || 'Não foi possível salvar a edição.'); return; }
      const old = list.querySelector(`.comment[data-id="${out.id}"]`);
      const tpl = document.createElement('template'); tpl.innerHTML = out.html.trim(); const node = tpl.content.firstElementChild;
      bindComment(node); old?.replaceWith(node); setBadge(out.counts); drawMarkers();
      editDlg.close(); node.classList.add('just-added'); setTimeout(() => node.classList.remove('just-added'), 2400);
    } catch { window.alert('Sem conexão. Tente de novo.'); } finally { buttons.forEach((b) => { b.disabled = false; }); }
  });

  // ---- pastas (material bruto e versões do vídeo editado): uma pasta aberta por vez, dentro do próprio card
  document.querySelectorAll('[data-folders]').forEach((box) => {
    const grid = box.querySelector('[data-folder-grid]');
    const panels = [...box.querySelectorAll('[data-folder-panel]')];
    const memo = `pulso-pasta-${box.dataset.key}`; // depois de enviar ou remover e a página recarregar, a pasta continua aberta
    const keep = (key) => { try { if (key) sessionStorage.setItem(memo, key); else sessionStorage.removeItem(memo); } catch { /* sem armazenamento */ } };
    const open = (key, focus = true) => {
      const panel = panels.find((p) => p.dataset.folderPanel === key);
      grid.hidden = Boolean(panel); panels.forEach((p) => { p.hidden = p !== panel; }); keep(panel ? key : '');
      if (!focus) return;
      if (panel) panel.querySelector('[data-folder-back]')?.focus();
      else box.querySelector(`[data-folder-open="${box.dataset.last || ''}"]`)?.focus();
    };
    box.addEventListener('click', (e) => {
      const o = e.target.closest('[data-folder-open]');
      if (o) { box.dataset.last = o.dataset.folderOpen; open(o.dataset.folderOpen); return; }
      if (e.target.closest('[data-folder-back]')) open('');
    });
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape' && grid.hidden && !e.target.closest('dialog')) open(''); });
    let saved = ''; try { saved = sessionStorage.getItem(memo) || ''; } catch { /* sem armazenamento */ }
    if (saved) { box.dataset.last = saved; open(saved, false); }
  });

  // ---- galeria do material: pastas em abas, grade com miniaturas e visualização grande (foto, vídeo, áudio)
  const gal = document.querySelector('[data-gallery]');
  if (gal) {
    let data = []; try { data = JSON.parse(gal.querySelector('[data-g-data]').textContent); } catch { data = []; }
    const tabsEl = gal.querySelector('[data-g-folders]'); const gridEl = gal.querySelector('[data-g-grid]'); const view = gal.querySelector('[data-g-view]');
    const stage = gal.querySelector('[data-g-stage]'); const nameEl = gal.querySelector('[data-g-name]'); const metaEl = gal.querySelector('[data-g-meta]');
    const posEl = gal.querySelector('[data-g-pos]'); const downEl = gal.querySelector('[data-g-down]');
    const prevBtn = gal.querySelector('[data-g-prev]'); const nextBtn = gal.querySelector('[data-g-next]');
    const ic = (k) => gal.querySelector('template[data-g-icons]')?.content.querySelector(`[data-i="${k}"]`)?.innerHTML || '';
    let folder = data[0]?.key; let idx = -1;
    const items = () => (data.find((f) => f.key === folder) || { items: [] }).items;
    // baixar vários: "Selecionar" troca o clique da miniatura por marcar/desmarcar; "Baixar pasta" baixa tudo da pasta (baixar.js)
    const bar = gal.querySelector('[data-g-bar]'); const countEl = gal.querySelector('[data-g-count]'); const noteEl = gal.querySelector('[data-g-note]');
    const goBtn = gal.querySelector('[data-g-go]'); const allBtn = gal.querySelector('[data-g-all]'); const selBtn = gal.querySelector('[data-g-select]'); const everyBtn = gal.querySelector('[data-g-everything]');
    const dl = window.PulsoBaixar;
    let selecting = false; const sel = new Set();
    const asDownload = (it) => ({ href: it.down, name: it.name, bytes: it.bytes, zip: `f${it.id}` });
    const say = (t) => { noteEl.textContent = t; noteEl.hidden = !t; };
    function syncBar() {
      const list = items(); const chosen = list.filter((it) => sel.has(it.id));
      countEl.textContent = chosen.length ? `${dl.plural(chosen.length, 'selecionado', 'selecionados')} · ${dl.bytesText(chosen.reduce((t, it) => t + (Number(it.bytes) || 0), 0))}` : 'Nenhum item marcado';
      goBtn.disabled = !chosen.length; allBtn.textContent = chosen.length === list.length ? 'Limpar seleção' : 'Selecionar todos';
      gridEl.querySelectorAll('.g-tile').forEach((t, n) => { const on = sel.has(list[n]?.id); t.classList.toggle('sel', on); t.setAttribute('aria-pressed', selecting ? String(on) : 'false'); });
    }
    function setSelecting(on) {
      selecting = on; if (!on) sel.clear(); bar.hidden = !on; gridEl.classList.toggle('selecting', on); say('');
      selBtn.lastChild.textContent = on ? ' Cancelar seleção' : ' Selecionar'; syncBar();
    }
    async function runDownload(list) {
      const folderName = (data.find((f) => f.key === folder) || {}).title || folder;
      const r = await dl.start(list.map(asDownload), { zipName: `${gal.dataset.gZip || 'episodio'}-${folderName}` });
      say(r.n ? dl.doneNote(r) : '');
    }
    selBtn.addEventListener('click', () => setSelecting(!selecting));
    gal.querySelector('[data-g-cancel]').addEventListener('click', () => setSelecting(false));
    allBtn.addEventListener('click', () => { const list = items(); const all = list.some((it) => !sel.has(it.id)); list.forEach((it) => (all ? sel.add(it.id) : sel.delete(it.id))); syncBar(); });
    goBtn.addEventListener('click', () => runDownload(items().filter((it) => sel.has(it.id))));
    everyBtn.addEventListener('click', () => runDownload(items()));
    const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const fallbackEl = (type) => { const f = mk('span', 'g-fallback'); f.innerHTML = ic(type === 'video' ? 'video' : type === 'audio' ? 'audio' : type === 'image' ? 'image' : 'file'); return f; };
    const fallback = (box, type) => { box.replaceChildren(fallbackEl(type)); };

    function drawTabs() {
      tabsEl.replaceChildren(...data.map((f) => {
        const b = mk('button', `gal-tab${f.key === folder ? ' on' : ''}`); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(f.key === folder));
        b.append(mk('span', '', f.title), mk('span', 'mono small muted', String(f.items.length)));
        b.addEventListener('click', () => { folder = f.key; sel.clear(); say(''); closeView(false); drawTabs(); drawGrid(); });
        return b;
      }));
    }
    function drawGrid() {
      gridEl.replaceChildren(...items().map((it, n) => {
        const b = mk('button', `g-tile g-${it.type}`); b.type = 'button'; b.setAttribute('aria-label', `Abrir ${it.name}`); b.title = it.name;
        const pic = mk('span', 'g-pic');
        if (it.thumb) {
          const img = document.createElement('img'); img.loading = 'lazy'; img.decoding = 'async'; img.alt = ''; img.src = it.thumb;
          img.addEventListener('error', () => img.replaceWith(fallbackEl(it.type)), { once: true }); // só a imagem: o play e a marca de seleção ficam
          pic.appendChild(img);
        } else fallback(pic, it.type);
        if (it.type === 'video') { const play = mk('span', 'g-play'); play.innerHTML = ic('play'); pic.appendChild(play); }
        const mark = mk('span', 'g-check'); mark.innerHTML = ic('check'); pic.appendChild(mark);
        b.append(pic, mk('span', 'g-cap', it.title ? `${it.title} · ${it.name}` : it.name));
        b.addEventListener('click', () => { if (selecting) { if (sel.has(it.id)) sel.delete(it.id); else sel.add(it.id); syncBar(); } else openView(n); });
        return b;
      }));
      gridEl.scrollTop = 0; syncBar();
    }
    const toolsHide = (hide) => { selBtn.hidden = hide; everyBtn.hidden = hide; bar.hidden = hide || !selecting; noteEl.hidden = hide || !noteEl.textContent; };
    function openView(n) {
      const list = items(); if (!list[n]) return;
      idx = n; const it = list[n];
      stage.replaceChildren();
      if (it.type === 'image') {
        const img = document.createElement('img'); img.alt = it.name; img.src = it.thumb ? it.big : it.view;
        img.addEventListener('error', () => fallback(stage, 'image'), { once: true });
        stage.appendChild(img);
      } else if (it.type === 'video') {
        const v = document.createElement('video'); v.controls = true; v.playsInline = true; v.preload = 'metadata'; if (it.thumb) v.poster = it.thumb; v.src = it.view;
        stage.appendChild(v);
      } else if (it.type === 'audio') {
        const a = document.createElement('audio'); a.controls = true; a.preload = 'metadata'; a.src = it.view; stage.appendChild(a);
      } else {
        fallback(stage, 'file'); stage.appendChild(mk('p', 'small muted', 'Este formato não tem pré-visualização. Baixe o arquivo para abrir.'));
      }
      nameEl.textContent = it.title ? `${it.title} · ${it.name}` : it.name; nameEl.title = it.name;
      metaEl.textContent = `${it.size} · ${it.when}`;
      posEl.textContent = `${n + 1} / ${list.length}`;
      downEl.href = it.down;
      prevBtn.disabled = n === 0; nextBtn.disabled = n === list.length - 1;
      view.hidden = false; gridEl.hidden = true; toolsHide(true);
      gal.querySelector('[data-g-back]').focus();
    }
    function closeView(focus = true) {
      stage.querySelectorAll('video, audio').forEach((m) => m.pause());
      stage.replaceChildren(); view.hidden = true; gridEl.hidden = false; toolsHide(false);
      if (focus && idx >= 0) gridEl.children[idx]?.focus();
      idx = -1;
    }
    const step = (d) => { if (idx < 0) return; const n = idx + d; if (n >= 0 && n < items().length) openView(n); };
    prevBtn.addEventListener('click', () => step(-1)); nextBtn.addEventListener('click', () => step(1));
    gal.querySelector('[data-g-back]').addEventListener('click', () => closeView());
    gal.addEventListener('keydown', (e) => {
      if (view.hidden || e.target.closest('video, audio')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    });
    gal.addEventListener('cancel', (e) => { if (!view.hidden) { e.preventDefault(); closeView(); } }); // Esc na foto volta à pasta; na pasta, fecha
    gal.addEventListener('close', () => { closeView(false); setSelecting(false); });
    let x0 = null; // deslizar no celular
    stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1); });
    document.querySelectorAll('[data-gallery-open]').forEach((b) => b.addEventListener('click', () => {
      folder = data.some((f) => f.key === b.dataset.folder) ? b.dataset.folder : data[0]?.key;
      setSelecting(false); drawTabs(); drawGrid(); closeView(false);
      if (!gal.open) gal.showModal();
    }));
  }
})();

// Quadro do Conteúdo no celular: abre na primeira coluna que tem algo (as primeiras costumam estar vazias).
(function () {
  const board = document.querySelector('#pane-quadro .board');
  if (!board || window.matchMedia('(min-width: 861px)').matches) return;
  const first = [...board.querySelectorAll('.column')].find((c) => c.querySelector('.kcard'));
  if (first) board.scrollLeft = first.offsetLeft - board.offsetLeft;
}());

// Baixar marcadores: cada programa mostra só o que vale para ele (o início da linha do tempo é coisa do DaVinci; a lista em texto não tem quadros).
(function () {
  const form = document.querySelector('form[data-markers]');
  if (!form) return;
  const sync = () => {
    const f = (form.querySelector('input[name="formato"]:checked') || {}).value || 'premiere';
    form.querySelectorAll('[data-mk-only]').forEach((el) => { el.hidden = !el.dataset.mkOnly.split(' ').includes(f); });
  };
  form.addEventListener('change', (e) => { if (e.target.name === 'formato') sync(); });
  sync();
}());
