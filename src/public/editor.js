// Editor completo de capas e posts. Usa o MESMO motor do servidor (design/engine.js) e as contas dos modelos (design/models.js):
// o que aparece aqui é o que é salvo. Vale para as capas dos modelos do guia (foto recortada, tarja, degradê, logotipo) e para as
// capas antigas e os posts (fundo com quadro do vídeo, faixas de contraste).
(function () {
  const root = document.querySelector('[data-editor]');
  const dataEl = document.getElementById('editor-data');
  if (!root || !dataEl || !window.PulsoDesign) return;
  const E = window.PulsoDesign; const M = window.PulsoModels || null;
  const B = E.BRAND;
  const data = JSON.parse(dataEl.textContent);
  let spec = data.spec;
  if (!Array.isArray(spec.layers)) spec.layers = [];
  if (!Array.isArray(spec.scrims)) spec.scrims = [];
  let ctxData = { faces: data.ctx?.faces || [], blocks: data.ctx?.blocks || [], insets: data.ctx?.insets || [] };
  const F = data.format;
  const SAFE = spec.safe || F.safe; const AVOID = spec.avoid || F.avoid || [];
  const isModel = Boolean(data.model && M);
  const csrf = document.querySelector('meta[name="csrf"]')?.content || '';
  const canvas = root.querySelector('[data-canvas]');
  const overlay = root.querySelector('[data-overlay]');
  const stageEl = root.querySelector('[data-stage]');
  const ctx = canvas.getContext('2d');
  const octx = overlay.getContext('2d');
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => [...root.querySelectorAll(sel)];
  const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  // Cores da marca do Pulso (manual de marca) e a cor livre ao lado.
  const PALETTE = [['Branco', B.white], ['Preto', B.black], ['Lime', B.lime], ['Plum', B.plum], ['Bone', B.bone], ['Grafite', B.graphite], ['Aço', B.steel], ['Prata', B.silver]];
  const WEIGHTS = data.weights || { 'Space Grotesk': [400, 500, 600, 700], 'Instrument Serif': [400], Inter: [400, 500, 600], 'JetBrains Mono': [400, 500] };
  const DEFAULT_WEIGHT = { 'Space Grotesk': 700, 'Instrument Serif': 400, Inter: 500, 'JetBrains Mono': 500 };
  const WEIGHT_NAMES = { 400: 'Regular', 500: 'Médio', 600: 'Seminegrito', 700: 'Negrito' };
  const SIZE_RANGE = { text: [12, 420], tarja: [24, 360], wordmark: [16, 300], arrow: [12, 300] };
  const RESIZABLE = new Set(['text', 'tarja', 'wordmark', 'arrow', 'rect', 'pulse']);
  const NO_HIT = new Set(['gradient', 'dots']); // ficam atrás de tudo e cobrem a capa inteira: escolhe-se pela lista
  // Nomes das partes dos modelos do guia (design/models.js) e dos tipos de camada.
  const NAMES = {
    texto: 'Frase', destaque: 'Destaque', apoio: 'Apoio', fecho: 'Fecho', rotulo: 'Rótulo', logo: 'Logotipo', foto: 'Foto', degrade: 'Degradê',
    topo: 'Sombra de cima', base: 'Sombra de baixo', faixas: 'Faixas escuras', pontos: 'Pontos', pulso: 'Linha de pulso', filete: 'Filete', ponto: 'Ponto',
    aspas: 'Aspas', nome: 'Nome', ep: 'Número', epLetras: 'EP', epPonto: 'Ponto do EP',
  };
  const TYPE_NAMES = { text: 'Texto', tarja: 'Tarja', wordmark: 'Logotipo', rect: 'Linha', arrow: 'Seta', photo: 'Foto', gradient: 'Degradê', dots: 'Pontos', pulse: 'Linha de pulso' };

  const zones = { safe: true, faces: true, blocks: true, avoid: true, crop: true };
  const images = {};
  const ORIG_FILTER = {};
  let selectedId = null;
  let panelIndex = 0;
  let undoStack = []; let redoStack = [];
  let drag = null; let guides = [];
  let dirty = false;

  canvas.width = spec.width; canvas.height = spec.height; overlay.width = spec.width; overlay.height = spec.height;
  stageEl.style.setProperty('--ratio', `${spec.width} / ${spec.height}`);
  stageEl.classList.toggle('portrait', spec.height > spec.width);
  stageEl.classList.toggle('square', spec.height === spec.width);

  // ---------------------------------------------------------------- imagens e fontes
  const frameById = Object.fromEntries(data.frames.map((f) => [f.ref, f]));
  const loadImage = (ref) => new Promise((resolve) => {
    if (images[ref]) { resolve(images[ref]); return; }
    const f = frameById[ref]; if (!f) { resolve(null); return; }
    const img = new Image();
    img.onload = () => { images[ref] = img; resolve(img); };
    img.onerror = () => resolve(null);
    img.src = `${data.imageBase}${f.id}`;
  });
  const usedRefs = () => [...new Set([spec.bg?.ref, ...(spec.bg?.panels || []).map((p) => p.ref), ...spec.layers.filter((l) => l.type === 'photo').map((l) => l.ref)].filter(Boolean))];

  // ---------------------------------------------------------------- zonas de rosto e legenda
  // A foto de uma camada no formato dos modelos: tamanho do arquivo e o rosto (a marcação feita na janela Ajustar ou o da análise).
  const photoInfo = (l) => {
    const f = l && l.ref ? frameById[l.ref] : null;
    if (!f || !M) return null;
    return { w: f.width, h: f.height, face: M.faceOf(f.analysis?.rostos, spec.photo?.ref === l.ref ? spec.photo.face : null) };
  };
  function recomputeCtx() {
    const faces = []; const blocks = []; const insets = [];
    const addFrom = (ref, bg, W, H, ox, oy) => {
      const f = frameById[ref]; if (!f) return;
      const img = { w: f.width, h: f.height };
      if (bg.fit === 'contain') { const t = E.bgTransform(img, bg, W, H); insets.push({ x: t.dx + ox, y: t.dy + oy, w: t.iw, h: t.ih }); }
      for (const r of f.analysis.rostos || []) { const m = E.mapBox(r, img, bg, W, H); faces.push({ ...m, x: m.x + ox, y: m.y + oy }); }
      for (const r of f.analysis.caixas_de_texto || []) { const m = E.mapBox(r, img, bg, W, H); blocks.push({ ...m, x: m.x + ox, y: m.y + oy }); }
    };
    if (spec.bg?.kind === 'frame') addFrom(spec.bg.ref, spec.bg, spec.width, spec.height, 0, 0);
    if (spec.bg?.kind === 'panels') spec.bg.panels.forEach((p) => addFrom(p.ref, p.bg, p.rect.w, p.rect.h, p.rect.x, p.rect.y));
    if (M) faces.push(...M.facesOf(spec, (ref) => photoInfo({ ref })));
    ctxData = { faces, blocks, insets };
  }

  // ---------------------------------------------------------------- desenho
  function draw() {
    E.render(ctx, spec, images, { makeCanvas });
    drawOverlay();
    scheduleChecks();
  }

  const boxOf = (l) => E.layerBox(ctx, l);
  const handleOf = (l, k) => {
    if (!l || l.hidden || !RESIZABLE.has(l.type)) return null;
    const b = boxOf(l);
    return { x: b.x + b.w + 6 * k, y: b.y + b.h + 6 * k };
  };
  function drawOverlay() {
    const W = spec.width; const H = spec.height;
    const k = W / (overlay.getBoundingClientRect().width || W); // 1 px de tela = k px de design
    octx.clearRect(0, 0, W, H);
    const rect = (r, stroke, fill, dash) => {
      octx.save(); octx.lineWidth = 2 * k; octx.strokeStyle = stroke; if (dash) octx.setLineDash([8 * k, 6 * k]);
      if (fill) { octx.fillStyle = fill; octx.fillRect(r.x, r.y, r.w, r.h); }
      octx.strokeRect(r.x, r.y, r.w, r.h); octx.restore();
    };
    const oval = (r, stroke, fill) => {
      octx.save(); octx.lineWidth = 2 * k; octx.strokeStyle = stroke; octx.fillStyle = fill;
      octx.beginPath(); octx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); octx.fill(); octx.stroke(); octx.restore();
    };
    if (zones.safe) rect({ x: SAFE.l, y: SAFE.t, w: W - SAFE.l - SAFE.r, h: H - SAFE.t - SAFE.b }, 'rgba(200,255,66,0.9)', null, true);
    if (zones.avoid) for (const a of AVOID) rect(a, 'rgba(255,122,107,0.9)', 'rgba(255,122,107,0.18)');
    if (zones.crop && F.crop34) {
      octx.save(); octx.fillStyle = 'rgba(0,0,0,0.5)';
      octx.fillRect(0, 0, W, F.crop34.y); octx.fillRect(0, F.crop34.y + F.crop34.h, W, H - F.crop34.y - F.crop34.h); octx.restore();
    }
    if (zones.faces) for (const f of ctxData.faces) (f.oval ? oval : rect)(f, 'rgba(255,255,255,0.95)', 'rgba(255,255,255,0.08)');
    if (zones.blocks) for (const b of ctxData.blocks) rect(b, 'rgba(255,194,102,0.95)', 'rgba(255,194,102,0.12)');
    const sel = layerById(selectedId);
    if (sel && !sel.hidden) {
      const b = boxOf(sel);
      octx.save(); octx.lineWidth = 3 * k; octx.strokeStyle = '#7B61FF';
      if (sel.type === 'photo' || NO_HIT.has(sel.type)) octx.setLineDash([10 * k, 6 * k]);
      octx.strokeRect(b.x - 6 * k, b.y - 6 * k, b.w + 12 * k, b.h + 12 * k);
      const hd = handleOf(sel, k);
      if (hd) { octx.setLineDash([]); octx.fillStyle = '#7B61FF'; octx.fillRect(hd.x - 9 * k, hd.y - 9 * k, 18 * k, 18 * k); }
      octx.restore();
    }
    for (const g of guides) { // linhas de alinhamento enquanto arrasta (centro e bordas da zona segura)
      octx.save(); octx.lineWidth = 1.5 * k; octx.strokeStyle = '#7B61FF'; octx.setLineDash([6 * k, 4 * k]); octx.beginPath();
      if (g.axis === 'x') { octx.moveTo(g.at, 0); octx.lineTo(g.at, H); } else { octx.moveTo(0, g.at); octx.lineTo(W, g.at); }
      octx.stroke(); octx.restore();
    }
  }

  // ---------------------------------------------------------------- conferência e teste de redução (na hora, sem esperar salvar)
  let checksTimer = null;
  const scheduleChecks = () => { clearTimeout(checksTimer); checksTimer = setTimeout(renderChecks, 120); };
  function paintAt(target, width) {
    target.width = width; target.height = Math.round(width * (spec.height / spec.width));
    const c = target.getContext('2d'); const k = width / spec.width;
    c.setTransform(k, 0, 0, k, 0, 0); E.render(c, spec, images, { makeCanvas }); c.setTransform(1, 0, 0, 1, 0, 0);
  }
  function renderChecks() {
    const res = E.lint(ctx, spec, ctxData);
    const el = $('[data-lint]'); el.textContent = '';
    const add = (text, cls) => { const p = document.createElement('p'); p.className = cls; p.textContent = text; el.appendChild(p); };
    res.issues.forEach((t) => add(t, 'lint-bad'));
    res.warnings.forEach((t) => add(t, 'lint-warn'));
    let extra = 0;
    const ph = spec.layers.find((l) => l.type === 'photo' && !l.hidden && l.ref && l.img);
    const info = ph ? photoInfo(ph) : null;
    if (info) {
      const sc = M.photoScale(ph, info, spec.scale || 1);
      if (sc.soft) { add(`Foto ampliada ${String(Math.round(sc.real * 10) / 10).replace('.', ',')}×: fica sem nitidez. Afaste um pouco ou troque por uma foto maior.`, 'lint-warn'); extra += 1; }
    }
    const unchecked = [spec.bg?.ref, ...spec.layers.filter((l) => l.type === 'photo' && !l.hidden).map((l) => l.ref)].some((r) => r && frameById[r]?.analysis?.unchecked);
    if (unchecked) { add('Esta imagem entrou sem conferência de rostos: veja se o texto não cobre ninguém.', 'lint-warn'); extra += 1; }
    if (!res.issues.length && !res.warnings.length && !extra) add('Tudo certo: nada cobre rosto ou legenda, e o texto está dentro da zona segura.', 'lint-ok');

    const kind = { youtube_thumb: 'yt', spotify_cover: 'sp', reel_cover: 'rl' }[spec.format];
    const box = $('[data-reads]'); box.hidden = !kind;
    if (!kind) return;
    const mini = $('[data-mini]');
    if (kind === 'rl') { // no grid do perfil o Instagram mostra só a faixa central 3:4
      const tmp = makeCanvas(10, 10); paintAt(tmp, 96);
      mini.width = 96; mini.height = 128;
      const g = mini.getContext('2d'); g.clearRect(0, 0, 96, 128); g.drawImage(tmp, 0, Math.round((F.crop34 ? F.crop34.y : 240) * (96 / spec.width)), 96, 128, 0, 0, 96, 128);
    } else paintAt(mini, kind === 'sp' ? 64 : 168);
    mini.className = `piece-mini piece-mini-${kind === 'rl' ? 'rl' : kind}`;
    $('[data-mini-label]').textContent = kind === 'sp' ? '64 PX · LISTA DO APP' : kind === 'rl' ? 'GRID DO PERFIL · 3:4' : '168 PX · CELULAR';
    const verdict = $('[data-reads-verdict]');
    const reads = isModel ? M.reads(spec) : null;
    verdict.className = `small ${reads === false ? 'bad-text' : 'muted'}`;
    verdict.textContent = reads === false ? 'Não lê a 168 px: o destaque está pequeno ou há palavras demais.' : reads ? 'Lê bem.' : 'Confira se lê neste tamanho.';
  }

  // ---------------------------------------------------------------- camadas
  const layerById = (id) => spec.layers.find((l) => l.id === id) || null;
  const layerName = (l) => NAMES[l.id] || (/^cred\d$/.test(l.id) ? `Credencial ${Number(l.id.slice(4)) + 1}` : TYPE_NAMES[l.type] || l.type);
  const layerSnippet = (l) => ((l.type === 'text' || l.type === 'tarja') && l.text ? `“${String(l.text).replace(/\n/g, ' ').slice(0, 28)}”` : '');
  const iconNode = (name) => { const t = document.querySelector(`template[data-icon="${name}"]`); return t ? t.content.cloneNode(true) : document.createTextNode(''); };
  const newId = () => `n${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

  function renderLayerList() {
    const ul = $('[data-layer-list]'); ul.textContent = '';
    [...spec.layers].reverse().forEach((l) => {
      const li = document.createElement('li');
      li.className = `${l.id === selectedId ? 'on' : ''}${l.hidden ? ' is-hidden' : ''}`;
      const btn = document.createElement('button'); btn.type = 'button'; btn.setAttribute('aria-pressed', String(l.id === selectedId));
      const name = document.createElement('span'); name.className = 'layer-name'; name.textContent = layerName(l);
      const snip = document.createElement('span'); snip.className = 'layer-snip'; snip.textContent = layerSnippet(l);
      btn.append(name, snip);
      btn.addEventListener('click', () => select(l.id));
      const eye = document.createElement('button'); eye.type = 'button'; eye.className = 'icon-btn';
      eye.title = l.hidden ? 'Mostrar' : 'Ocultar'; eye.setAttribute('aria-label', `${l.hidden ? 'Mostrar' : 'Ocultar'} ${layerName(l)}`);
      eye.append(iconNode(l.hidden ? 'eye-off' : 'eye'));
      eye.addEventListener('click', () => { snapshot(); l.hidden = !l.hidden; if (l.type === 'photo') recomputeCtx(); commit(); });
      li.append(btn, eye); ul.appendChild(li);
    });
  }
  function select(id) { selectedId = id; refreshPanels(); drawOverlay(); }

  // ---------------------------------------------------------------- mudanças e desfazer
  let lastGroup = null; let lastAt = 0;
  // Uma mudança de propriedade: mexidas seguidas no mesmo controle (arrastar um controle deslizante) viram um desfazer só.
  function change(group, fn) {
    const now = Date.now();
    if (group !== lastGroup || now - lastAt > 700) snapshot();
    lastGroup = group; lastAt = now;
    fn(); dirty = true; draw(); setStatus('Alterações não salvas');
  }
  function commit() { dirty = true; draw(); refreshPanels(); setStatus('Alterações não salvas'); }
  function snapshot() { undoStack.push(JSON.stringify({ spec, ctxData })); if (undoStack.length > 80) undoStack.shift(); redoStack = []; syncHistory(); }
  function restore(json) {
    const s = JSON.parse(json); spec = s.spec; ctxData = s.ctxData; lastGroup = null;
    if (!layerById(selectedId)) selectedId = null;
    Promise.all(usedRefs().map(loadImage)).then(() => { dirty = true; draw(); refreshPanels(); syncHistory(); });
  }
  function undo() { const last = undoStack.pop(); if (!last) return; redoStack.push(JSON.stringify({ spec, ctxData })); restore(last); setStatus('Alteração desfeita'); }
  function redo() { const next = redoStack.pop(); if (!next) return; undoStack.push(JSON.stringify({ spec, ctxData })); restore(next); setStatus('Alteração refeita'); }
  function syncHistory() { $('[data-undo]').disabled = !undoStack.length; $('[data-redo]').disabled = !redoStack.length; }
  $('[data-undo]').addEventListener('click', undo);
  $('[data-redo]').addEventListener('click', redo);

  // ---------------------------------------------------------------- cores (marca + cor livre)
  // get/set leem e gravam a cor no objeto certo; a linha se redesenha para marcar a escolhida.
  function colorRow(box, get, set, group) {
    const render = () => {
      box.textContent = '';
      const cur = String(get() || '').toLowerCase();
      for (const [name, hex] of PALETTE) {
        const on = cur === hex.toLowerCase();
        const b = document.createElement('button'); b.type = 'button'; b.title = name; b.setAttribute('aria-label', name); b.setAttribute('aria-pressed', String(on));
        b.style.background = hex; b.className = on ? 'on' : '';
        b.addEventListener('click', () => { change(group, () => set(hex)); render(); });
        box.appendChild(b);
      }
      const custom = /^#[0-9a-f]{6}$/.test(cur) && !PALETTE.some(([, hex]) => hex.toLowerCase() === cur);
      const pick = document.createElement('label'); pick.className = `swatch-custom${custom ? ' on' : ''}`; pick.title = 'Outra cor';
      if (custom) pick.style.background = cur;
      const input = document.createElement('input'); input.type = 'color'; input.setAttribute('aria-label', 'Outra cor');
      input.value = /^#[0-9a-f]{6}$/.test(cur) ? cur : '#ffffff';
      input.addEventListener('input', () => change(group, () => set(input.value))); // ao vivo, sem refazer a linha (o seletor está aberto)
      input.addEventListener('change', render);
      pick.append(input); box.appendChild(pick);
    };
    render();
  }

  // ---------------------------------------------------------------- propriedades da camada escolhida
  const appliesTo = (el, type) => !el.dataset.for || el.dataset.for.split(' ').includes(type);
  function propValue(l, key) {
    if (key === 'family') return l.font?.family || 'Space Grotesk';
    if (key === 'weight') return l.font?.weight || DEFAULT_WEIGHT[l.font?.family] || 700;
    if (key === 'italic') return !!l.font?.italic;
    if (key === 'highlight') return !!l.highlight;
    if (key === 'strokeWidth') return l.stroke?.width || 0;
    if (key === 'chip') return !!l.chip;
    if (key === 'shadowDistance') return l.shadowDistance ?? 0.4;
    if (key === 'alpha') return l.alpha ?? 1;
    if (key === 'tracking') return l.tracking ?? (l.type === 'tarja' ? -0.065 : 0);
    if (key === 'lineHeight') return l.lineHeight ?? 1.05;
    if (key === 'shadow') return l.shadow || 0;
    return l[key];
  }
  const outText = (key, v) => {
    if (v == null) return '';
    if (key === 'size') return `${Number(v).toFixed(0)} px`;
    if (key === 'alpha') return Number(v) >= 1 ? 'nenhuma' : `${Math.round((1 - Number(v)) * 100)}%`;
    if (key === 'strokeWidth') return Number(v) ? `${Math.round(Number(v) * 100)}%` : 'sem';
    if (key === 'shadow' || key === 'shadowDistance') return `${Math.round(Number(v) * 100)}%`;
    return Number(v).toFixed(2).replace('.', ',');
  };
  const syncOuts = (l) => $$('[data-out]').forEach((o) => { o.textContent = outText(o.dataset.out, propValue(l, o.dataset.out)); });
  const wordsOfText = (t) => String(t || '').split(/\s+/).filter(Boolean);
  const norm = (w) => String(w).toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '');

  // Texto mudou: as palavras em destaque seguem as mesmas palavras (no lugar, se o número de palavras não mudou).
  function remark(l, oldText) {
    if (!l.marks) return;
    const oldW = wordsOfText(oldText); const newW = wordsOfText(l.text);
    let out;
    if (oldW.length === newW.length) out = l.marks.words.filter((i) => i < newW.length);
    else {
      const used = new Set(); out = [];
      for (const target of l.marks.words.map((i) => norm(oldW[i] || '')).filter(Boolean)) {
        const j = newW.findIndex((w, k) => !used.has(k) && norm(w) === target);
        if (j >= 0) { used.add(j); out.push(j); }
      }
    }
    if (out.length) l.marks = { ...l.marks, words: out.sort((a, b) => a - b) }; else delete l.marks;
  }
  function renderWords(l) {
    const box = $('[data-words]'); box.textContent = '';
    if (l.type !== 'text') return;
    const marked = new Set(l.marks?.words || []);
    wordsOfText(l.text).forEach((w, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = `word-chip${marked.has(i) ? ' on' : ''}`;
      b.textContent = l.upper ? w.toLocaleUpperCase('pt-BR') : w; b.setAttribute('aria-pressed', String(marked.has(i)));
      b.addEventListener('click', () => {
        change(Symbol('marca'), () => {
          const set = new Set(l.marks?.words || []);
          if (set.has(i)) set.delete(i); else set.add(i);
          if (set.size) { l.marks = { words: [...set].sort((a, c) => a - c), color: l.marks?.color || B.lime }; l.highlight = null; } else delete l.marks;
        });
        renderWords(l);
      });
      box.appendChild(b);
    });
    $('[data-marks-colors]').hidden = !(l.marks && l.marks.words.length);
    $('[data-hl-last]').hidden = !l.highlight;
    if (l.marks) colorRow($('[data-swatches="marks"]'), () => l.marks?.color, (hex) => { if (l.marks) l.marks.color = hex; }, 'marks');
  }

  function setProp(l, key, val) {
    if (key === 'text') { const old = l.text; l.text = l.type === 'tarja' ? String(val).replace(/\s*\n\s*/g, ' ') : String(val); remark(l, old); return; }
    if (key === 'family') {
      const ws = WEIGHTS[val] || [400];
      const serif = val === 'Instrument Serif';
      l.font = { ...(l.font || {}), family: val, weight: ws.includes(l.font?.weight) ? l.font.weight : DEFAULT_WEIGHT[val], italic: serif ? true : (l.font?.family === 'Instrument Serif' ? false : !!l.font?.italic) };
      return;
    }
    if (key === 'weight') { l.font = { ...(l.font || {}), weight: Number(val) }; return; }
    if (key === 'italic') { l.font = { ...(l.font || {}), italic: Boolean(val) }; return; }
    if (key === 'highlight') { l.highlight = val ? { color: l.highlight?.color || B.lime, lines: 'last' } : null; return; }
    if (key === 'upper') { l.upper = Boolean(val); return; }
    if (key === 'strokeWidth') { if (Number(val) > 0) l.stroke = { width: Number(val), color: l.stroke?.color || B.black }; else delete l.stroke; return; }
    if (key === 'chip') { if (val) l.chip = { color: 'rgba(10,10,10,0.62)', padX: Math.round(l.size * 0.22), padY: Math.round(l.size * 0.12), radius: Math.round(l.size * 0.12) }; else delete l.chip; return; }
    if (key === 'shadowDistance') { l.shadowDistance = Number(val); if (l.shadowAngle == null) l.shadowAngle = 90; if (!l.shadow) l.shadow = 0.6; return; }
    if (key === 'alpha') { if (Number(val) >= 1) delete l.alpha; else l.alpha = Number(val); return; }
    if (key === 'w') { l.w = Math.max(l.type === 'text' ? 40 : 1, Number(val) || 0); return; }
    if (key === 'h') { l.h = Math.max(1, Number(val) || 0); return; }
    l[key] = Number(val);
  }

  function refreshProps() {
    const l = layerById(selectedId); const props = $('[data-props]');
    props.hidden = !l;
    if (!l) return;
    $('[data-sel-name]').textContent = layerName(l);
    props.querySelectorAll('[data-for]').forEach((el) => { el.hidden = !appliesTo(el, l.type); });
    const fam = propValue(l, 'family');
    // peso: só os hospedados desta fonte (o servidor desenha os mesmos)
    const wsel = $('[data-p="weight"]'); wsel.textContent = '';
    for (const w of WEIGHTS[fam] || [400]) { const o = document.createElement('option'); o.value = String(w); o.textContent = `${WEIGHT_NAMES[w] || w} · ${w}`; wsel.appendChild(o); }
    $('[data-italic]').hidden = l.type !== 'text' || fam === 'Instrument Serif'; // a serifa da marca já é itálica
    const R = SIZE_RANGE[l.type] || [12, 420]; const sz = $('[data-p="size"]'); sz.min = R[0]; sz.max = R[1];
    $$('[data-p]').forEach((el) => {
      const v = propValue(l, el.dataset.p);
      if (el.type === 'checkbox') el.checked = !!v; else if (document.activeElement !== el) el.value = v ?? '';
    });
    $$('[data-align]').forEach((b) => { const on = (l.align || 'left') === b.dataset.align; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    root.querySelector('[data-for="text tarja wordmark rect pulse dots arrow"] > summary').textContent = ['text', 'tarja', 'wordmark'].includes(l.type) ? 'Letra e cor' : 'Cor';
    $('[data-color-label]').textContent = { tarja: 'Cor do texto', wordmark: 'Cor do nome' }[l.type] || 'Cor';
    $('[data-w-label]').textContent = l.type === 'pulse' ? 'Comprimento' : 'Largura';
    syncOuts(l);
    colorRow($('[data-swatches="color"]'), () => l.color, (hex) => { l.color = hex; }, 'color');
    if (l.type === 'tarja') colorRow($('[data-swatches="bg"]'), () => l.bg, (hex) => { l.bg = hex; }, 'tarja-bg');
    if (l.type === 'wordmark') colorRow($('[data-swatches="dotColor"]'), () => l.dotColor || B.lime, (hex) => { l.dotColor = hex; }, 'dot');
    renderWords(l);
    if (l.type !== 'text') return;
    $('[data-stroke-colors-wrap]').hidden = !(l.stroke?.width > 0);
    if (l.stroke?.width > 0) colorRow($('[data-swatches="stroke"]'), () => l.stroke?.color, (hex) => { if (l.stroke) l.stroke.color = hex; }, 'stroke');
    $('[data-chip-colors-wrap]').hidden = !l.chip;
    if (l.chip) colorRow($('[data-swatches="chip"]'), () => l.chip?.color, (hex) => { if (l.chip) { l.chip.color = hex; delete l.chip.stroke; } }, 'chip');
    // lado da sombra: o botão mais perto do ângulo atual (ou "em volta" quando a distância é zero)
    const glow = l.shadowAngle != null && (l.shadowDistance ?? 0.4) === 0;
    const ang = l.shadowAngle ?? 90;
    $$('[data-shadow-dir]').forEach((b) => {
      const d = b.dataset.shadowDir;
      const on = Boolean(l.shadow) && (glow ? d === 'glow' : d !== 'glow' && Math.abs((((Number(d) - ang) % 360) + 540) % 360 - 180) < 23);
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
  }

  $$('[data-p]').forEach((el) => {
    const key = el.dataset.p;
    const apply = () => {
      const l = layerById(selectedId); if (!l) return;
      const val = el.type === 'checkbox' ? el.checked : el.value;
      change(`p:${key}`, () => setProp(l, key, val));
      if (key === 'text') { renderLayerList(); renderWords(l); }
      if (['family', 'strokeWidth', 'chip', 'highlight', 'shadowDistance', 'upper'].includes(key)) refreshProps(); else syncOuts(l);
    };
    el.addEventListener('input', apply);
    if (el.type === 'checkbox' || el.tagName === 'SELECT') el.addEventListener('change', apply);
  });
  $$('[data-align]').forEach((b) => b.addEventListener('click', () => {
    const l = layerById(selectedId); if (!l) return;
    change(Symbol('alinhar'), () => { l.align = b.dataset.align; }); refreshProps();
  }));
  $$('[data-shadow-dir]').forEach((b) => b.addEventListener('click', () => {
    const l = layerById(selectedId); if (!l || l.type !== 'text') return;
    change(Symbol('sombra'), () => {
      if (!l.shadow) l.shadow = 0.6;
      if (b.dataset.shadowDir === 'glow') { l.shadowAngle = l.shadowAngle ?? 90; l.shadowDistance = 0; } else { l.shadowAngle = Number(b.dataset.shadowDir); if (!l.shadowDistance) l.shadowDistance = 0.4; }
    });
    refreshProps();
  }));

  // ---------------------------------------------------------------- ordem, duplicar, excluir, adicionar
  $$('[data-order]').forEach((b) => b.addEventListener('click', () => {
    const i = spec.layers.findIndex((l) => l.id === selectedId); if (i < 0) return;
    const j = b.dataset.order === 'up' ? i + 1 : i - 1;
    if (j < 0 || j >= spec.layers.length) return;
    snapshot(); const [l] = spec.layers.splice(i, 1); spec.layers.splice(j, 0, l); commit();
  }));
  function duplicateSelected() {
    const l = layerById(selectedId); if (!l) return;
    snapshot();
    const copy = JSON.parse(JSON.stringify(l)); copy.id = newId();
    if (typeof copy.x === 'number') copy.x += 24;
    if (typeof copy.y === 'number') copy.y += 24;
    spec.layers.splice(spec.layers.indexOf(l) + 1, 0, copy);
    selectedId = copy.id;
    if (copy.type === 'photo') recomputeCtx();
    commit();
  }
  function deleteSelected() {
    const l = layerById(selectedId); if (!l) return;
    snapshot(); spec.layers = spec.layers.filter((x) => x.id !== selectedId); selectedId = null;
    if (l.type === 'photo') recomputeCtx();
    commit();
  }
  $('[data-duplicate]').addEventListener('click', duplicateSelected);
  $('[data-delete]').addEventListener('click', deleteSelected);
  const focusText = () => { const t = $('[data-p="text"]'); if (t && !t.closest('[hidden]')) { t.focus(); t.select(); } };
  $$('[data-add]').forEach((b) => b.addEventListener('click', () => {
    snapshot();
    const id = newId(); const t = b.dataset.add; const W = spec.width; const H = spec.height; const unit = Math.min(W, H);
    const display = { family: 'Space Grotesk', weight: 700, italic: false };
    let layer;
    if (t === 'text') layer = { id, type: 'text', role: 'main', css: true, text: 'Novo texto', x: SAFE.l, y: Math.round(H * 0.4), w: Math.round((W - SAFE.l - SAFE.r) * 0.7), size: Math.round(unit * 0.1), font: display, color: B.white, align: 'left', lineHeight: 0.98, tracking: -0.04, upper: false, shadow: 0, highlight: null };
    else if (t === 'tarja') layer = { id, type: 'tarja', role: 'main', text: 'Destaque', x: SAFE.l, y: Math.round(H * 0.45), size: Math.round(unit * 0.13), font: display, color: B.black, bg: B.lime, pad: { t: 12, r: 30, b: 26, l: 20 }, tracking: -0.065, lineHeight: 0.85, upper: false };
    else if (t === 'wordmark') layer = { id, type: 'wordmark', role: 'meta', css: true, x: SAFE.l, y: SAFE.t, size: Math.round(unit * 0.067), color: B.white, dotColor: B.lime };
    else layer = { id, type: 'rect', role: 'deco', x: SAFE.l, y: Math.round(H * 0.5), w: Math.round(unit * 0.33), h: Math.max(3, Math.round(unit * 0.006)), color: B.lime, radius: 0 };
    spec.layers.push(layer); selectedId = id; commit();
    if (t === 'text' || t === 'tarja') focusText();
  }));

  // ---------------------------------------------------------------- arrastar, aumentar e enquadrar a foto
  const toDesign = (e) => { const r = overlay.getBoundingClientRect(); return { x: ((e.clientX - r.left) * spec.width) / r.width, y: ((e.clientY - r.top) * spec.height) / r.height, k: spec.width / r.width }; };
  const hit = (p) => {
    for (let i = spec.layers.length - 1; i >= 0; i -= 1) {
      const l = spec.layers[i]; if (l.hidden || NO_HIT.has(l.type) || l.alpha === 0) continue;
      const b = boxOf(l); const pad = 10 * p.k;
      if (p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad) return l;
    }
    return null;
  };
  // Move a foto dentro do painel (o painel fica no lugar do modelo; a foto anda por dentro, sem deixar buraco).
  function panPhoto(l, x, y) {
    const info = photoInfo(l); if (!info || !l.img) return;
    const out = M.placePhoto(l, info, { s: l.img.w / info.w, x, y });
    l.img = out.img; l.fade = out.fade;
  }
  function resizeTo(l, d, p, shift) {
    const dx = p.x - d.start.x; const dy = p.y - d.start.y; const o = d.orig;
    if (l.type === 'rect') { l.w = Math.max(2, Math.round(o.w + dx)); l.h = Math.max(2, Math.round(o.h + dy)); return; }
    if (l.type === 'pulse' || (l.type === 'text' && shift)) { l.w = Math.max(60, Math.round(o.w + dx)); return; } // Shift: só a largura da caixa
    const k = Math.max(0.1, (d.box.w + dx) / (d.box.w || 1)); const R = SIZE_RANGE[l.type] || [12, 420];
    l.size = Math.round(clamp(o.size * k, R[0], R[1]));
    if (l.type === 'text') l.w = Math.max(60, Math.round(o.w * (l.size / o.size))); // a caixa cresce junto: as linhas continuam iguais
  }
  overlay.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    const p = toDesign(e); const sel = layerById(selectedId);
    const hd = handleOf(sel, p.k);
    if (hd && Math.abs(p.x - hd.x) <= 18 * p.k && Math.abs(p.y - hd.y) <= 18 * p.k) {
      drag = { mode: 'resize', id: sel.id, start: p, orig: JSON.parse(JSON.stringify(sel)), box: boxOf(sel), snap: false };
      overlay.setPointerCapture(e.pointerId); return;
    }
    const l = hit(p);
    if (!l) { select(null); return; }
    if (l.id !== selectedId) select(l.id);
    drag = l.type === 'photo' ? { mode: 'pan', id: l.id, start: p, img: { ...(l.img || {}) }, snap: false } : { mode: 'move', id: l.id, dx: p.x - l.x, dy: p.y - l.y, snap: false };
    overlay.setPointerCapture(e.pointerId);
  });
  overlay.addEventListener('pointermove', (e) => {
    const p = toDesign(e);
    if (!drag) { const l = hit(p); const sel = layerById(selectedId); const hd = handleOf(sel, p.k); overlay.style.cursor = hd && Math.abs(p.x - hd.x) <= 18 * p.k && Math.abs(p.y - hd.y) <= 18 * p.k ? 'nwse-resize' : l ? (l.type === 'photo' ? 'grab' : 'move') : 'default'; return; }
    const l = layerById(drag.id); if (!l) return;
    if (!drag.snap) { snapshot(); drag.snap = true; } // o desfazer guarda o estado só quando algo se move de fato
    if (drag.mode === 'resize') resizeTo(l, drag, p, e.shiftKey);
    else if (drag.mode === 'pan') { panPhoto(l, drag.img.x + (p.x - drag.start.x), drag.img.y + (p.y - drag.start.y)); recomputeCtx(); }
    else {
      let x = p.x - drag.dx; let y = p.y - drag.dy;
      guides = [];
      if (!e.altKey) { // ímã: centro e bordas da zona segura (Alt solta o ímã)
        const b = boxOf({ ...l, x, y }); const snap = 10 * p.k; const W = spec.width; const H = spec.height;
        for (const [t, at] of [[SAFE.l, SAFE.l], [(W - b.w) / 2, W / 2], [W - SAFE.r - b.w, W - SAFE.r]]) if (Math.abs(b.x - t) < snap) { x += t - b.x; guides.push({ axis: 'x', at }); break; }
        for (const [t, at] of [[SAFE.t, SAFE.t], [(H - b.h) / 2, H / 2], [H - SAFE.b - b.h, H - SAFE.b]]) if (Math.abs(b.y - t) < snap) { y += t - b.y; guides.push({ axis: 'y', at }); break; }
      }
      l.x = Math.round(x); l.y = Math.round(y);
    }
    dirty = true; draw();
  });
  const endDrag = () => {
    if (!drag) return;
    const moved = drag.snap; drag = null; guides = [];
    refreshProps(); if (moved) { refreshBg(); setStatus('Alterações não salvas'); }
    drawOverlay();
  };
  overlay.addEventListener('pointerup', endDrag); overlay.addEventListener('pointercancel', endDrag);
  overlay.addEventListener('dblclick', (e) => { // dois toques num texto: vai direto para o campo do texto
    const l = hit(toDesign(e));
    if (l && (l.type === 'text' || l.type === 'tarja')) { select(l.id); focusText(); }
  });
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return; // janela aberta (Ajustar, IA): o teclado é dela
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const mod = e.metaKey || e.ctrlKey; const key = e.key.toLowerCase();
    if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && key === 'y') { e.preventDefault(); redo(); return; }
    const l = layerById(selectedId);
    if (!l) return;
    if (mod && key === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if (e.key === 'Escape') { select(null); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
    const step = e.shiftKey ? 12 : 2;
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!mv) return;
    e.preventDefault();
    change('setas', () => {
      if (l.type === 'photo') { if (l.img) panPhoto(l, l.img.x + mv[0], l.img.y + mv[1]); recomputeCtx(); } else { l.x += mv[0]; l.y += mv[1]; }
    });
    refreshProps();
  });

  // ---------------------------------------------------------------- foto e fundo
  const photoLayers = () => spec.layers.filter((l) => l.type === 'photo');
  // O que os controles da aba mexem: a foto do modelo (a escolhida, ou a primeira) ou o fundo das capas antigas.
  function photoTarget() {
    const sel = layerById(selectedId);
    if (sel && sel.type === 'photo') return { kind: 'layer', l: sel };
    const pl = photoLayers().find((l) => !l.hidden) || photoLayers()[0];
    if (pl) return { kind: 'layer', l: pl };
    if (spec.bg.kind === 'frame') return { kind: 'bg', b: spec.bg };
    if (spec.bg.kind === 'panels' && spec.bg.panels[panelIndex]) return { kind: 'bg', b: spec.bg.panels[panelIndex].bg, panel: spec.bg.panels[panelIndex] };
    return null;
  }
  const verticalRange = (l) => ({ min: l.h - l.img.h, max: l.h * 0.22 });
  function photoValues(t) {
    if (t.kind === 'bg') return { zoom: t.b.zoom || 1, px: t.b.cx ?? 0.5, py: t.b.cy ?? 0.5, mirror: !!t.b.flipX, adj: { brightness: 1, contrast: 1, saturate: 1, blur: 0, ...(t.b.adjust || {}) } };
    const l = t.l; const info = photoInfo(l);
    const adj = { brightness: 1, contrast: 1, saturate: 1, ...(l.filter || {}) };
    if (!info || !l.img) return { zoom: 1, px: 0.5, py: 0.5, mirror: !!l.mirror, adj, off: true };
    const vr = verticalRange(l);
    return {
      zoom: M.photoScale(l, info).zoom, mirror: !!l.mirror, adj,
      px: l.img.w - l.w > 0.5 ? clamp(-l.img.x / (l.img.w - l.w), 0, 1) : 0.5,
      py: vr.max - vr.min > 0.5 ? clamp((vr.max - l.img.y) / (vr.max - vr.min), 0, 1) : 0.5,
    };
  }
  // Aproxima a foto do modelo sem tirar o rosto do lugar.
  function zoomPhoto(l, info, zoom) {
    const sc = M.photoScale(l, info); const s = sc.min * zoom;
    const f = info.face || M.DEFAULT_FACE; const fx = l.mirror ? 1 - f.x : f.x;
    const ax = l.img.x + fx * l.img.w; const ay = l.img.y + f.y * l.img.h;
    const out = M.placePhoto(l, info, { s, x: ax - fx * info.w * s, y: ay - f.y * info.h * s });
    l.img = out.img; l.fade = out.fade;
  }
  function refreshBg() {
    const solid = spec.bg.kind === 'solid';
    $('[data-bg-color]').hidden = !solid;
    if (solid) colorRow($('[data-swatches="bgcolor"]'), () => spec.bg.color, (hex) => { spec.bg.color = hex; }, 'fundo');
    const panels = $('[data-bg-panels]'); panels.textContent = '';
    if (spec.bg.kind === 'panels') {
      const row = document.createElement('div'); row.className = 'row';
      spec.bg.panels.forEach((p, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = `btn sm ${i === panelIndex ? 'on' : ''}`; b.textContent = i === 0 ? 'Quadro de cima' : 'Quadro de baixo'; b.addEventListener('click', () => { panelIndex = i; refreshBg(); }); row.appendChild(b); });
      panels.appendChild(row);
    }
    const t = photoTarget();
    const layerMode = Boolean(t && t.kind === 'layer');
    $('[data-bg-adjust]').hidden = !t;
    $$('[data-legacy-only]').forEach((el) => { el.hidden = layerMode || isModel; });
    $('[data-photo-kicker]').textContent = layerMode ? 'Foto' : 'Enquadramento';
    if (t) {
      const v = photoValues(t);
      const set = (sel, val) => { const el = $(sel); if (el && document.activeElement !== el) el.value = val; if (el) el.disabled = Boolean(v.off); };
      set('[data-bg="zoom"]', v.zoom); set('[data-bg="px"]', v.px); set('[data-bg="py"]', v.py);
      $('[data-out-bg="zoom"]').textContent = `${v.zoom.toFixed(2).replace('.', ',')}×`;
      $('[data-orient="flipX"]').classList.toggle('on', v.mirror);
      $('[data-orient="flipY"]').classList.toggle('on', t.kind === 'bg' && !!t.b.flipY);
      $$('[data-adj]').forEach((el) => { if (document.activeElement !== el) el.value = v.adj[el.dataset.adj] ?? 0; });
      $$('[data-out-adj]').forEach((o) => { const k2 = o.dataset.outAdj; o.textContent = k2 === 'blur' ? `${v.adj.blur || 0} px` : `${Math.round((v.adj[k2] ?? 1) * 100)}%`; });
    }
    if (!isModel) { // leitura do texto (capas antigas): escurecer e a faixa de contraste
      const dim = $('[data-bg="dim"]'); if (document.activeElement !== dim) dim.value = spec.dim || 0;
      const scrim = $('[data-bg="scrim"]'); if (document.activeElement !== scrim) scrim.value = spec.scrims[0]?.strength || 0;
      scrim.closest('label').hidden = !spec.scrims[0];
      $('[data-out-bg="dim"]').textContent = outText('dim', spec.dim || 0);
      $('[data-out-bg="scrim"]').textContent = outText('scrim', spec.scrims[0]?.strength || 0);
    }
    renderFramesPicker(); renderPhotos();
  }
  $$('[data-bg]').forEach((el) => el.addEventListener('input', () => {
    const k2 = el.dataset.bg; const v = Number(el.value);
    if (k2 === 'dim') { change('dim', () => { spec.dim = v; }); refreshBg(); return; }
    if (k2 === 'scrim') { change('scrim', () => { if (spec.scrims[0]) spec.scrims[0].strength = v; }); refreshBg(); return; }
    const t = photoTarget(); if (!t) return;
    change(`bg:${k2}`, () => {
      if (t.kind === 'bg') { t.b[{ zoom: 'zoom', px: 'cx', py: 'cy' }[k2]] = v; recomputeCtx(); return; }
      const l = t.l; const info = photoInfo(l); if (!info || !l.img) return;
      if (k2 === 'zoom') zoomPhoto(l, info, v);
      else if (k2 === 'px') panPhoto(l, -v * (l.img.w - l.w), l.img.y);
      else { const vr = verticalRange(l); panPhoto(l, l.img.x, vr.max - v * (vr.max - vr.min)); }
      recomputeCtx();
    });
    refreshBg();
  }));
  $$('[data-orient]').forEach((b) => b.addEventListener('click', () => {
    const t = photoTarget(); if (!t) return;
    const k2 = b.dataset.orient;
    change(Symbol('orientar'), () => {
      if (t.kind === 'layer') { // espelhar a foto do modelo: o rosto fica no mesmo ponto do painel
        const l = t.l; const info = photoInfo(l);
        if (k2 !== 'flipX' || !l.img) return;
        const f = (info && info.face) || M.DEFAULT_FACE; const before = l.mirror ? 1 - f.x : f.x;
        const faceX = l.img.x + before * l.img.w;
        if (l.mirror) delete l.mirror; else l.mirror = true;
        if (info) panPhoto(l, faceX - (1 - before) * l.img.w, l.img.y);
      } else if (k2 === 'rotL' || k2 === 'rotR') t.b.rot = (((t.b.rot || 0) + (k2 === 'rotR' ? 90 : -90)) % 360 + 360) % 360;
      else t.b[k2] = !t.b[k2];
      recomputeCtx();
    });
    refreshPanels();
  }));
  // Cor da foto (brilho, contraste, saturação): no modelo vai no filtro da foto; nas capas antigas, nos ajustes do fundo.
  function setAdjust(patch) {
    const t = photoTarget(); if (!t) return;
    if (t.kind === 'layer') {
      const f = { ...(t.l.filter || {}), ...patch };
      for (const k2 of Object.keys(f)) if (!['brightness', 'contrast', 'saturate'].includes(k2)) delete f[k2];
      t.l.filter = f;
      return;
    }
    const a = { brightness: 1, contrast: 1, saturate: 1, blur: 0, ...(t.b.adjust || {}), ...patch };
    if (a.brightness === 1 && a.contrast === 1 && a.saturate === 1 && !a.blur) delete t.b.adjust; else t.b.adjust = a;
  }
  $$('[data-adj]').forEach((el) => el.addEventListener('input', () => { change(`adj:${el.dataset.adj}`, () => setAdjust({ [el.dataset.adj]: Number(el.value) })); refreshBg(); }));
  $('[data-adj-mono]').addEventListener('click', () => { change(Symbol('pb'), () => setAdjust({ saturate: 0, contrast: 1.1 })); refreshBg(); });
  $('[data-adj-reset]').addEventListener('click', () => {
    const t = photoTarget(); if (!t) return;
    change(Symbol('original'), () => {
      if (t.kind === 'layer') t.l.filter = JSON.parse(JSON.stringify(ORIG_FILTER[t.l.id] || { saturate: 0.85, contrast: 1.06 }));
      else setAdjust({ brightness: 1, contrast: 1, saturate: 1, blur: 0 });
    });
    refreshBg();
  });

  // Foto nova (quadro, fotografia do episódio ou imagem enviada). Na capa do modelo, entra no painel da foto com o rosto no mesmo
  // ponto e na mesma altura da foto anterior; nas capas antigas vira o fundo (ou o painel escolhido), sem giro nem ajustes antigos.
  async function applyFrame(f) {
    if (!frameById[f.ref]) { data.frames.push(f); frameById[f.ref] = f; }
    await loadImage(f.ref);
    const t = photoTarget();
    snapshot(); lastGroup = null;
    if (t && t.kind === 'layer' && M) {
      const l = t.l; const cur = photoInfo(l);
      let tx = l.w / 2; let ty = l.h * 0.42; let th = l.h * 0.42;
      if (cur && l.img) { const fc = cur.face || M.DEFAULT_FACE; tx = l.img.x + (l.mirror ? 1 - fc.x : fc.x) * l.img.w; ty = l.img.y + fc.y * l.img.h; th = fc.h * l.img.h; }
      const c = M.crop({ w: f.width, h: f.height, face: M.faceOf(f.analysis?.rostos, null) }, l.w, l.h, tx, ty, th, spec.scale || 1);
      l.ref = f.ref; l.img = c.img; l.fade = c.fade; delete l.mirror;
      if (!l.filter) l.filter = { saturate: 0.85, contrast: 1.06 };
      spec.photo = { ref: f.ref };
    } else {
      const target = spec.bg.kind === 'panels' ? spec.bg.panels[panelIndex] : null;
      const fresh = { fit: 'cover', zoom: 1, cx: 0.5, cy: 0.5, align: 'center', rot: 0, flipX: false, flipY: false, adjust: undefined };
      if (spec.bg.kind === 'solid') spec.bg = { kind: 'frame', ref: f.ref, ...fresh };
      else { Object.assign(target ? target.bg : spec.bg, fresh); if (target) target.ref = f.ref; else spec.bg.ref = f.ref; }
    }
    recomputeCtx(); commit();
  }
  function renderFramesPicker() {
    const picker = $('[data-frame-picker]');
    $('[data-frames-empty]').hidden = data.frames.length > 0;
    const t = photoTarget();
    const current = t ? (t.kind === 'layer' ? t.l.ref : t.panel ? t.panel.ref : spec.bg.ref) : null;
    if (picker.dataset.count === String(data.frames.length)) { // já montado: só marca o escolhido (sem recarregar as miniaturas)
      picker.querySelectorAll('button').forEach((b) => { const on = b.dataset.ref === current; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      return;
    }
    picker.textContent = ''; picker.dataset.count = String(data.frames.length);
    const wide = data.frames.filter((f) => f.width > f.height).length > data.frames.length / 2;
    picker.classList.toggle('is-wide', wide);
    data.frames.slice().sort((a, b) => (b.score || 0) - (a.score || 0)).forEach((f) => {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.ref = f.ref; b.className = f.ref === current ? 'on' : ''; b.setAttribute('aria-pressed', String(f.ref === current));
      const img = document.createElement('img'); img.src = `${data.imageBase}${f.id}`; img.alt = `Quadro em ${Math.round(f.at_ms / 1000)} s`; img.loading = 'lazy'; img.decoding = 'async';
      const cap = document.createElement('span'); cap.className = 'handle'; cap.textContent = f.analysis.from_file ? 'fotografia' : f.analysis.custom ? 'enviada' : `${Math.floor(f.at_ms / 60000)}:${String(Math.floor((f.at_ms % 60000) / 1000)).padStart(2, '0')}`;
      b.append(img, cap);
      b.addEventListener('click', () => applyFrame(f));
      picker.appendChild(b);
    });
  }

  $$('[data-bg-src]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-bg-src]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
    $$('[data-bg-pane]').forEach((p) => { p.hidden = p.dataset.bgPane !== b.dataset.bgSrc; });
  }));
  const photos = data.photos || [];
  if (!data.frames.length && photos.length) $('[data-bg-src="photos"]')?.click(); // sem quadros do vídeo: já abre nas fotografias
  const countEl = $('[data-photo-count]'); if (countEl) countEl.textContent = photos.length ? String(photos.length) : '';
  let photosBuilt = false;
  function renderPhotos() {
    const grid = $('[data-photo-picker]'); if (!grid) return;
    if (!photos.length) { $('[data-photo-hint]').textContent = 'Este episódio ainda não tem fotografias no material bruto. Quando subirem (JPG, PNG ou WebP), aparecem aqui.'; return; }
    const t = photoTarget();
    const ref = t ? (t.kind === 'layer' ? t.l.ref : t.panel ? t.panel.ref : spec.bg.ref) : null;
    const current = frameById[ref || '']?.analysis?.from_file;
    if (!photosBuilt) {
      photosBuilt = true;
      photos.forEach((p) => {
        const b = document.createElement('button'); b.type = 'button'; b.dataset.file = p.id; b.title = p.name;
        const img = document.createElement('img'); img.src = p.thumb; img.alt = p.name; img.loading = 'lazy'; img.decoding = 'async';
        const cap = document.createElement('span'); cap.className = 'handle'; cap.textContent = p.kind === 'bastidor' ? 'bastidores' : p.name.replace(/\.[^.]+$/, '');
        b.append(img, cap);
        b.addEventListener('click', () => usePhoto(p, b));
        grid.appendChild(b);
      });
    }
    grid.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(b.dataset.file) === String(current)));
  }
  async function usePhoto(p, btn) {
    const msg = $('[data-photo-msg]');
    if (btn.classList.contains('busy')) return;
    btn.classList.add('busy'); msg.textContent = `Preparando ${p.name}: deixando em pé e conferindo os rostos…`;
    try {
      const res = await fetch(data.photoUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'x-csrf-token': csrf }, body: new URLSearchParams({ arquivo: p.id }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || 'Tente de novo em alguns segundos.');
      await applyFrame(json.frame);
      msg.textContent = json.frame.analysis.unchecked ? 'Foto aplicada, mas os rostos não foram conferidos: veja se o texto não cobre ninguém.' : 'Foto aplicada. Acerte o enquadramento acima, se precisar.';
    } catch (err) { msg.textContent = `Não deu para usar a foto. ${err.message}`; } finally { btn.classList.remove('busy'); }
  }
  const upload = $('[data-upload]');
  upload?.addEventListener('change', async () => {
    const file = upload.files[0]; const msg = $('[data-upload-msg]');
    if (!file) return;
    msg.textContent = 'Enviando…';
    try {
      const res = await fetch(data.uploadUrl, { method: 'POST', headers: { 'x-csrf-token': csrf, 'Content-Type': file.type || 'application/octet-stream', Accept: 'application/json' }, body: file });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || 'Tente de novo em alguns segundos.');
      await applyFrame(json.frame);
      msg.textContent = json.frame.analysis.unchecked ? 'Imagem aplicada, mas os rostos não foram conferidos: olhe com atenção se o texto não cobre ninguém.' : 'Imagem aplicada.';
    } catch (err) { msg.textContent = `Não deu para enviar. ${err.message}`; } finally { upload.value = ''; }
  });

  // ---------------------------------------------------------------- abas, zonas e salvar
  function refreshPanels() { renderLayerList(); refreshProps(); refreshBg(); }
  const showTab = (key) => {
    $$('[data-tab]').forEach((x) => { const on = x.dataset.tab === key; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); });
    $$('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== key; });
  };
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.goto)));
  $$('[data-zone]').forEach((c) => c.addEventListener('change', () => { zones[c.dataset.zone] = c.checked; drawOverlay(); }));
  if (F.crop34) $('[data-zone-crop]').hidden = false;
  const setStatus = (t) => { $('[data-status]').textContent = t; };

  $('[data-save]').addEventListener('click', async () => {
    const btn = $('[data-save]'); btn.disabled = true; setStatus('Salvando…');
    try {
      const res = await fetch(data.saveUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ spec, ctx: ctxData }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || 'Tente de novo em alguns segundos.');
      dirty = false; if (isModel) spec.edited = true;
      const issues = json.lint?.issues || []; const warns = json.lint?.warnings || [];
      setStatus(issues.length ? `Capa salva, com ${issues.length === 1 ? '1 problema' : `${issues.length} problemas`}: ${issues[0]}` : warns.length ? `Capa salva, com ${warns.length === 1 ? '1 aviso' : `${warns.length} avisos`}: ${warns[0]}` : 'Capa salva.');
    } catch (err) { setStatus(`Não deu para salvar. ${err.message}`); } finally { btn.disabled = false; }
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('pulso:capa-ajustada', () => { dirty = false; }); // a janela Ajustar montou a capa de novo pelo modelo
  window.addEventListener('resize', drawOverlay);

  // ---------------------------------------------------------------- início
  (async () => {
    const faces = [];
    for (const [fam, ws] of Object.entries(WEIGHTS)) for (const w of ws) faces.push(`${fam === 'Instrument Serif' ? 'italic ' : ''}${w} 40px "${fam}"`);
    await Promise.all(faces.map((f) => document.fonts.load(f).catch(() => null)));
    await document.fonts.ready;
    await Promise.all(usedRefs().map(loadImage));
    if (isModel) recomputeCtx(); // as zonas de rosto seguem a foto como ela está no desenho
    for (const l of spec.layers) if (l.type === 'photo') ORIG_FILTER[l.id] = JSON.parse(JSON.stringify(l.filter || {}));
    selectedId = (spec.layers.find((l) => !l.hidden && (l.type === 'text' || l.type === 'tarja') && (l.role || 'main') === 'main') || {}).id || null;
    draw(); refreshPanels(); syncHistory();
    data.frames.forEach((f) => loadImage(f.ref)); // o resto dos quadros em segundo plano (para trocar a foto sem esperar)
  })();
})();
