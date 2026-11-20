/* Janela "Ajustar capa" (episódio e corte). A prévia é desenhada aqui com o mesmo motor (design/engine.js) e os mesmos modelos
   (design/models.js) que o servidor usa para gravar a imagem: o que se vê é o que sai. Três abas: Texto (só os campos do modelo,
   com contador), Modelo (a mesma capa em cada modelo, para escolher com os olhos) e Foto (quadros, fotos e a marca do rosto). */
(function () {
  const dlg = document.querySelector('[data-ajustar]');
  const E = window.PulsoDesign; const M = window.PulsoModels;

  // Contador de palavras de um campo comum (ex.: a credencial na janela da ficha): <small data-word-counter="id" data-max="8">.
  document.querySelectorAll('[data-word-counter]').forEach((el) => {
    const input = document.getElementById(el.dataset.wordCounter); const max = Number(el.dataset.max);
    if (!input) return;
    const show = () => { const n = input.value.trim().split(/\s+/).filter(Boolean).length; el.textContent = `${n} de ${max} ${max === 1 ? 'palavra' : 'palavras'}`; el.classList.toggle('bad', n > max); };
    input.addEventListener('input', show); show();
  });
  // Vídeo do convidado sendo gerado: pergunta de tempos em tempos e recarrega a aba quando ele fica pronto.
  const waiting = document.querySelector('[data-video-wait]');
  if (waiting) {
    const ask = async () => {
      try {
        const json = await (await fetch(waiting.dataset.videoWait, { headers: { Accept: 'application/json' } })).json();
        if (json.ok && !json.waiting) { const to = new URL(window.location.href); to.searchParams.set('capas', 'videos'); to.hash = 'capas'; window.location.assign(to.href); return; }
      } catch { /* sem conexão: tenta de novo na próxima volta */ }
      setTimeout(ask, 5000);
    };
    setTimeout(ask, 5000);
  }
  if (!dlg || !E || !M) return;

  const $ = (sel) => dlg.querySelector(sel);
  const csrf = document.querySelector('meta[name="csrf"]')?.content || '';
  const canvas = $('[data-aj-canvas]'); const ctx = canvas.getContext('2d');
  const mini = $('[data-aj-mini]'); const source = $('[data-aj-source]');
  const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const measure = makeCanvas(10, 10).getContext('2d');
  const FONTS = ['700 40px "Space Grotesk"', 'italic 400 40px "Instrument Serif"', '500 40px "JetBrains Mono"', '500 40px "Inter"'];
  const FIELD_HELP = {
    pre: 'ex.: O imóvel pode', hl: 'ex.: fechar', post: 'ex.: sua clínica', setup: 'ex.: Escolheu o imóvel', punch: 'ex.: errado?', num: 'ex.: 3', line: 'ex.: erros ao escolher o imóvel',
    quote: 'ex.: Reforma não salva imóvel errado.', hook: 'ex.: O imóvel que pode fechar sua clínica', guest: 'ex.: Dr. Márcio Martins', sub: 'ex.: Como abrir com segurança e não perder dinheiro.',
  };
  let st = null; // { cover, data, frames, photos, model, frame, flip, faces: {ref: face}, images: {ref: img}, srcTab }
  let timer = null;

  const loadImage = (frame) => new Promise((resolve) => {
    if (!frame || st.images[frame.ref]) { resolve(); return; }
    const img = new Image();
    img.onload = () => { st.images[frame.ref] = img; resolve(); };
    img.onerror = () => resolve();
    img.src = frame.url;
  });
  const frameNow = () => st.frames.find((f) => f.ref === st.frame) || null;
  const photoNow = () => { const f = frameNow(); return f ? { ref: f.ref, w: f.w, h: f.h, face: st.faces[f.ref] || f.face || null } : null; };
  const kindOf = () => M.MODELS[st.model].kind;
  const countOf = (field, value) => { const lim = M.limitOf(field, kindOf()) || {}; return lim.words ? { n: M.countWords(value), max: lim.words, unit: lim.words === 1 ? 'palavra' : 'palavras' } : lim.chars ? { n: [...String(value).trim()].length, max: lim.chars, unit: 'caracteres' } : null; };

  function buildNow(model = st.model) {
    return M.build(measure, model, st.data, st.images[st.frame] ? photoNow() : null, { flip: st.flip, angle: st.cover.angle });
  }
  function paint(target, built, width) {
    const spec = built.spec;
    target.width = width || spec.width; target.height = Math.round(target.width * (spec.height / spec.width));
    const c = target.getContext('2d'); const k = target.width / spec.width;
    c.setTransform(k, 0, 0, k, 0, 0);
    E.render(c, spec, st.images, { makeCanvas });
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  function setStatus(text, tone = '') {
    const el = $('[data-aj-status]'); el.textContent = text; el.className = `small ${tone === 'bad' ? 'bad-text' : tone === 'warn' ? 'warn-text' : 'muted'}`;
  }
  function draw() {
    const built = buildNow();
    const save = $('[data-aj-save]');
    $('[data-aj-error]').textContent = '';
    if (built.error) {
      canvas.classList.add('is-off'); save.disabled = true;
      setStatus(built.error.join(' '), 'bad');
      return;
    }
    canvas.classList.remove('is-off'); save.disabled = false;
    paint(canvas, built);
    const square = built.spec.format === 'spotify_cover'; const reel = built.spec.format === 'reel_cover';
    if (reel) { // no grid do perfil o Instagram mostra só a faixa central 3:4 (y 240 a 1680)
      const tmp = makeCanvas(10, 10); paint(tmp, built, 96);
      mini.width = 96; mini.height = 128;
      mini.getContext('2d').drawImage(tmp, 0, Math.round(240 * (96 / 1080)), 96, 128, 0, 0, 96, 128);
    } else paint(mini, built, square ? 64 : 168);
    $('[data-aj-mini-label]').textContent = square ? '64 PX · LISTA DO APP' : reel ? 'GRID DO PERFIL · 3:4' : '168 PX · CELULAR';
    const lint = E.lint(ctx, built.spec, built.ctxData);
    const reads = M.reads(built.spec);
    if (lint.issues.length) setStatus(lint.issues[0], 'bad');
    else if (reads === false) setStatus('Não lê a 168 px: o destaque está pequeno ou há palavras demais.', 'bad');
    else if (built.warnings.length) setStatus(built.warnings[0], 'warn');
    else if (lint.warnings.length) setStatus(lint.warnings[0], 'warn');
    else setStatus(reads ? 'Lê bem.' : 'Sem avisos.');
    drawSource();
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(() => { draw(); if (!$('[data-aj-pane="modelo"]').hidden) drawModels(); }, 140); };

  // ---------------------------------------------------------------- aba Texto
  function renderFields() {
    const box = $('[data-aj-fields]'); box.textContent = '';
    const m = M.MODELS[st.model];
    for (const field of m.fields) {
      const lim = M.limitOf(field, m.kind) || { label: field };
      const label = document.createElement('label');
      const cnt = document.createElement('small'); cnt.className = 'counter';
      const input = document.createElement(field === 'quote' || field === 'sub' ? 'textarea' : 'input');
      if (input.tagName === 'INPUT') input.type = 'text'; else input.rows = 2;
      input.value = st.data[field] || ''; input.placeholder = FIELD_HELP[field] || ''; input.maxLength = 160; input.autocomplete = 'off';
      const show = () => { const c = countOf(field, input.value); if (!c) return; cnt.textContent = `${c.n} de ${c.max} ${c.unit}`; cnt.classList.toggle('bad', c.n > c.max); };
      input.addEventListener('input', () => { st.data[field] = input.value; show(); later(); });
      label.append(`${lim.label} `, cnt, input); box.append(label); show();
    }
    const total = m.fields.includes('pre') && m.kind === 'youtube_thumb';
    $('[data-aj-rule]').textContent = [
      total ? 'A capa inteira leva até 6 palavras.' : '',
      m.fields.includes('quote') && st.quoteFound === false ? 'Não achei esta frase na transcrição: confira no áudio antes de usar.' : '',
      m.fields.includes('num') ? 'Só número dito no episódio.' : '',
      m.kind === 'reel_cover' && m.fields.includes('hook') ? 'O texto é o gancho do trecho; a palavra em destaque tem que estar escrita igual no gancho.' : '',
      'Se não cabe no limite, reescreva ou troque de modelo: a fonte não diminui abaixo do mínimo.',
    ].filter(Boolean).join(' ');
  }

  // ---------------------------------------------------------------- aba Modelo
  function drawModels() {
    const box = $('[data-aj-models]'); box.textContent = '';
    for (const id of M.modelsFor(st.cover.kind, st.cover.angle)) {
      const m = M.MODELS[id];
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = `adjust-model${id === st.model ? ' on' : ''}`; btn.setAttribute('aria-pressed', String(id === st.model));
      const built = buildNow(id);
      const cv = makeCanvas(10, 10); cv.className = 'adjust-model-img';
      const name = document.createElement('span'); name.className = 'adjust-model-name';
      const strong = document.createElement('strong'); strong.textContent = m.name;
      const code = document.createElement('span'); code.className = 'mono small muted'; code.textContent = ` ${id}`;
      name.append(strong, code);
      const hint = document.createElement('span'); hint.className = 'small muted';
      if (built.error) { btn.classList.add('is-off'); hint.textContent = built.error[0]; cv.width = 240; cv.height = st.cover.kind === 'spotify_cover' ? 240 : st.cover.kind === 'reel_cover' ? 427 : 135; } else {
        paint(cv, built, 240);
        hint.textContent = m.special && st.special ? `${m.hint} Último uso: ${st.special.last}${st.special.recent ? ' (há menos de 5 episódios).' : '.'}` : m.hint;
        if (m.special && st.special && st.special.recent) hint.classList.add('warn-text');
      }
      btn.append(cv, name, hint);
      btn.addEventListener('click', () => { st.model = id; renderFields(); draw(); drawModels(); });
      box.append(btn);
    }
  }

  // ---------------------------------------------------------------- aba Foto
  function drawSource() {
    const f = frameNow(); const img = f && st.images[f.ref];
    const c = source.getContext('2d');
    source.width = 320; source.height = f ? Math.round(320 * (f.h / f.w)) : 180;
    c.fillStyle = '#1A1A1A'; c.fillRect(0, 0, source.width, source.height);
    if (!img) return;
    c.drawImage(img, 0, 0, source.width, source.height);
    const face = st.faces[f.ref] || f.face;
    if (!face) return;
    const eh = face.h * source.height * 1.12; const ew = eh * 0.74;
    c.strokeStyle = '#FAFAFA'; c.lineWidth = 2; c.setLineDash([6, 4]);
    c.beginPath(); c.ellipse(face.x * source.width, face.y * source.height, ew / 2, eh / 2, 0, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
  }
  function renderFrames() {
    const box = $('[data-aj-frames]'); box.textContent = '';
    const photosTab = st.srcTab === 'fotos';
    const list = st.frames.filter((f) => (photosTab ? f.photo : !f.photo));
    for (const f of list) {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = `adjust-frame${f.ref === st.frame ? ' on' : ''}`;
      const img = document.createElement('img'); img.src = f.url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      btn.append(img);
      if (!f.face) { const tag = document.createElement('span'); tag.className = 'mono small adjust-frame-tag'; tag.textContent = 'SEM ROSTO'; btn.append(tag); }
      btn.addEventListener('click', async () => { st.frame = f.ref; await loadImage(f); renderFrames(); draw(); });
      box.append(btn);
    }
    if (photosTab) { // fotografias da gravação que ainda não viraram foto de capa: um toque traz (e a IA marca o rosto)
      const used = new Set(st.frames.filter((f) => f.fileId).map((f) => f.fileId));
      for (const p of st.photos.filter((x) => !used.has(x.id))) {
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'adjust-frame';
        const img = document.createElement('img'); img.src = p.thumb; img.alt = p.name; img.loading = 'lazy'; img.decoding = 'async';
        btn.append(img);
        btn.addEventListener('click', async () => {
          btn.classList.add('is-busy'); btn.disabled = true;
          try {
            const res = await fetch(st.photoUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'x-csrf-token': csrf }, body: new URLSearchParams({ arquivo: String(p.id) }) });
            const json = await res.json();
            if (!json.ok) throw new Error(json.error || 'Não consegui usar esta foto.');
            const r = (json.frame.analysis?.rostos || []).slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
            const fr = { ref: json.frame.ref, url: `/quadros/${json.frame.id}`, w: json.frame.width, h: json.frame.height, face: r ? { x: r.x + r.w / 2, y: r.y + r.h / 2, h: r.h } : null, photo: true, fileId: p.id };
            if (!st.frames.some((x) => x.ref === fr.ref)) st.frames.push(fr);
            st.frame = fr.ref; await loadImage(fr); renderFrames(); draw();
          } catch (err) { $('[data-aj-error]').textContent = err.message; btn.classList.remove('is-busy'); btn.disabled = false; }
        });
        box.append(btn);
      }
    }
    if (!box.children.length) { const p = document.createElement('p'); p.className = 'small muted'; p.textContent = photosTab ? 'Nenhuma fotografia da gravação neste episódio. Envie em Material > Fotografias.' : 'Nenhum quadro do vídeo.'; box.append(p); }
  }
  source.addEventListener('click', (e) => { // marcar o rosto: um toque no rosto
    const f = frameNow(); if (!f) return;
    const r = source.getBoundingClientRect();
    const cur = st.faces[f.ref] || f.face || { h: 0.25 };
    st.faces[f.ref] = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, h: cur.h };
    draw();
  });
  dlg.querySelectorAll('[data-aj-zoom]').forEach((b) => b.addEventListener('click', () => {
    const f = frameNow(); if (!f) return;
    const cur = st.faces[f.ref] || f.face || { x: 0.5, y: 0.38, h: 0.25 };
    // aproximar = dizer que o rosto é menor do que a marca (o recorte amplia para ele chegar à altura do modelo)
    st.faces[f.ref] = { ...cur, h: Math.min(0.9, Math.max(0.05, cur.h * (b.dataset.ajZoom === 'in' ? 0.9 : 1.1))) };
    draw();
  }));
  $('[data-aj-flip]').addEventListener('click', () => { st.flip = !st.flip; draw(); });
  dlg.querySelectorAll('[data-aj-src]').forEach((b) => b.addEventListener('click', () => {
    st.srcTab = b.dataset.ajSrc; dlg.querySelectorAll('[data-aj-src]').forEach((x) => x.classList.toggle('on', x === b)); renderFrames();
  }));

  // ---------------------------------------------------------------- abas, abrir e salvar
  function showTab(key) {
    dlg.querySelectorAll('[data-aj-tab]').forEach((b) => { const on = b.dataset.ajTab === key; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    dlg.querySelectorAll('[data-aj-pane]').forEach((p) => { p.hidden = p.dataset.ajPane !== key; });
    if (key === 'modelo') drawModels();
    if (key === 'foto') { renderFrames(); drawSource(); }
  }
  dlg.querySelectorAll('[data-aj-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.ajTab)));

  async function open(url, opener) {
    opener?.setAttribute('aria-busy', 'true');
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Não consegui abrir esta capa.');
      st = {
        cover: json.cover, data: { ...json.data }, frames: json.frames, photos: json.photos || [], photoUrl: json.photoUrl, saveUrl: json.saveUrl, special: json.special, quoteFound: json.quoteFound,
        model: json.cover.model, frame: json.cover.photo?.ref || json.frames[0]?.ref || null, flip: json.cover.flip, faces: {}, images: {}, srcTab: 'quadros',
      };
      if (json.cover.photo?.face && st.frame) st.faces[st.frame] = json.cover.photo.face;
      const cur = frameNow();
      if (cur && cur.photo) st.srcTab = 'fotos';
      dlg.querySelectorAll('[data-aj-src]').forEach((x) => x.classList.toggle('on', x.dataset.ajSrc === st.srcTab));
      $('[data-aj-kicker]').textContent = json.cover.angle ? M.ANGLES[json.cover.angle].toUpperCase() : json.cover.kind === 'spotify_cover' ? 'SPOTIFY' : 'CORTE';
      await Promise.all([...FONTS.map((f) => document.fonts.load(f)), loadImage(cur)]);
      renderFields(); showTab('texto');
      if (!dlg.open) dlg.showModal();
      draw();
    } catch (err) { window.alert(err.message); } finally { opener?.removeAttribute('aria-busy'); }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ajustar-open]');
    if (b) { e.preventDefault(); open(b.dataset.ajustarOpen, b); }
  });

  $('[data-aj-save]').addEventListener('click', async () => {
    const btn = $('[data-aj-save]'); const err = $('[data-aj-error]');
    const m = M.MODELS[st.model];
    btn.disabled = true; btn.textContent = 'Salvando…'; err.textContent = '';
    try {
      const f = frameNow();
      const res = await fetch(st.saveUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ model: st.model, fields: Object.fromEntries(m.fields.map((k) => [k, st.data[k] || ''])), frame: st.frame, flip: st.flip, face: f ? (st.faces[f.ref] || null) : null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || 'Não consegui salvar. Tente de novo.');
      const to = new URL(json.back, window.location.href);
      if (to.pathname + to.search === window.location.pathname + window.location.search) { window.location.hash = to.hash; window.location.reload(); } else window.location.assign(to.href);
    } catch (e2) { err.textContent = e2.message; btn.disabled = false; btn.textContent = 'Salvar'; }
  });
}());
