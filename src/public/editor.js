// Editor visual de capas e posts (Canva simples). Usa o MESMO motor do servidor (design/engine.js): o que aparece aqui é o que é salvo.
(function () {
  const root = document.querySelector('[data-editor]');
  const dataEl = document.getElementById('editor-data');
  if (!root || !dataEl || !window.PulsoDesign) return;
  const E = window.PulsoDesign;
  const data = JSON.parse(dataEl.textContent);
  let spec = data.spec;
  let ctxData = { faces: data.ctx?.faces || [], blocks: data.ctx?.blocks || [], insets: data.ctx?.insets || [] };
  const F = data.format;
  const csrf = document.querySelector('meta[name="csrf"]')?.content || '';
  const canvas = root.querySelector('[data-canvas]');
  const overlay = root.querySelector('[data-overlay]');
  const stageEl = root.querySelector('[data-stage]');
  const ctx = canvas.getContext('2d');
  const octx = overlay.getContext('2d');
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => [...root.querySelectorAll(sel)];
  const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const SWATCHES = [['Branco', E.BRAND.white], ['Preto', E.BRAND.black], ['Lime', E.BRAND.lime], ['Plum', E.BRAND.plum], ['Bone', E.BRAND.bone], ['Prata', E.BRAND.silver]];
  const zones = { safe: true, faces: true, blocks: true, avoid: true, crop: true };
  const images = {};
  let selectedId = null;
  let panelIndex = 0;
  let undoStack = [];
  let drag = null;
  let dirty = false;

  canvas.width = spec.width; canvas.height = spec.height; overlay.width = spec.width; overlay.height = spec.height;
  stageEl.style.setProperty('--ratio', `${spec.width} / ${spec.height}`);
  stageEl.classList.toggle('portrait', spec.height > spec.width);

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
  const usedRefs = () => [...new Set([spec.bg?.ref, ...(spec.bg?.panels || []).map((p) => p.ref)].filter(Boolean))];

  // ---------------------------------------------------------------- zonas (rostos e legendas) a partir da análise do quadro
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
    ctxData = { faces, blocks, insets };
  }

  // ---------------------------------------------------------------- desenho
  function draw() {
    E.render(ctx, spec, images, { makeCanvas });
    drawOverlay();
    renderLint();
  }

  function drawOverlay() {
    const W = spec.width; const H = spec.height;
    const k = W / overlay.getBoundingClientRect().width || 1; // 1 px de tela = k px de design
    octx.clearRect(0, 0, W, H);
    const rect = (r, stroke, fill, dash) => {
      octx.save(); octx.lineWidth = 2 * k; octx.strokeStyle = stroke; if (dash) octx.setLineDash([8 * k, 6 * k]);
      if (fill) { octx.fillStyle = fill; octx.fillRect(r.x, r.y, r.w, r.h); }
      octx.strokeRect(r.x, r.y, r.w, r.h); octx.restore();
    };
    if (zones.safe) rect({ x: F.safe.l, y: F.safe.t, w: W - F.safe.l - F.safe.r, h: H - F.safe.t - F.safe.b }, 'rgba(200,255,66,0.9)', null, true);
    if (zones.avoid) for (const a of F.avoid || []) rect(a, 'rgba(255,122,107,0.9)', 'rgba(255,122,107,0.18)');
    if (zones.crop && F.crop34) {
      octx.save(); octx.fillStyle = 'rgba(0,0,0,0.5)';
      octx.fillRect(0, 0, W, F.crop34.y); octx.fillRect(0, F.crop34.y + F.crop34.h, W, H - F.crop34.y - F.crop34.h); octx.restore();
    }
    if (zones.faces) for (const f of ctxData.faces) rect(f, 'rgba(255,255,255,0.95)', 'rgba(255,255,255,0.08)');
    if (zones.blocks) for (const b of ctxData.blocks) rect(b, 'rgba(255,194,102,0.95)', 'rgba(255,194,102,0.12)');
    const sel = layerById(selectedId);
    if (sel) {
      const b = E.layerBox(ctx, sel);
      octx.save(); octx.lineWidth = 3 * k; octx.strokeStyle = '#7B61FF'; octx.strokeRect(b.x - 6 * k, b.y - 6 * k, b.w + 12 * k, b.h + 12 * k);
      if (sel.type === 'text') { octx.fillStyle = '#7B61FF'; octx.fillRect(b.x + b.w + 6 * k - 8 * k, b.y + b.h + 6 * k - 8 * k, 16 * k, 16 * k); }
      octx.restore();
    }
  }

  // ---------------------------------------------------------------- conferência na hora
  function renderLint() {
    const res = E.lint(ctx, spec, ctxData);
    const el = $('[data-lint]');
    el.innerHTML = '';
    const add = (text, cls) => { const p = document.createElement('p'); p.className = cls; p.textContent = text; el.appendChild(p); };
    res.issues.forEach((t) => add(t, 'lint-bad'));
    res.warnings.forEach((t) => add(t, 'lint-warn'));
    const cur = frameById[spec.bg?.ref];
    if (cur && cur.analysis.unchecked) add('Esta imagem foi enviada sem conferência de rostos: confira se o texto não cobre ninguém.', 'lint-warn');
    if (!res.issues.length && !res.warnings.length && !(cur && cur.analysis.unchecked)) add('Tudo certo: nada cobre rosto ou legenda, e o texto está dentro da zona segura.', 'lint-ok');
  }

  // ---------------------------------------------------------------- camadas
  const layerById = (id) => (spec.layers || []).find((l) => l.id === id) || null;
  const layerName = (l) => (l.type === 'text' ? `“${String(l.text).replace(/\n/g, ' ').slice(0, 26)}”` : { wordmark: 'Logotipo', rect: 'Linha', arrow: 'Seta' }[l.type] || l.type);

  function renderLayerList() {
    const ul = $('[data-layer-list]'); ul.innerHTML = '';
    [...spec.layers].reverse().forEach((l) => {
      const li = document.createElement('li');
      li.className = l.id === selectedId ? 'on' : '';
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = layerName(l) + (l.hidden ? ' (oculta)' : '');
      btn.addEventListener('click', () => { selectedId = l.id; refreshPanels(); drawOverlay(); });
      const eye = document.createElement('button'); eye.type = 'button'; eye.className = 'link small'; eye.textContent = l.hidden ? 'mostrar' : 'ocultar';
      eye.addEventListener('click', () => { snapshot(); l.hidden = !l.hidden; commit(); });
      li.append(btn, eye); ul.appendChild(li);
    });
  }

  // Valor de uma propriedade do painel (algumas ficam em objetos: fonte, contorno, fundo do texto).
  const TEXT_ONLY = ['text', 'family', 'align', 'lineHeight', 'tracking', 'shadow', 'upper', 'italic', 'highlight', 'shadowDistance', 'strokeWidth', 'chip'];
  function propValue(l, key) {
    if (key === 'family') return l.font?.family;
    if (key === 'italic') return !!l.font?.italic;
    if (key === 'highlight') return !!l.highlight;
    if (key === 'strokeWidth') return l.stroke?.width || 0;
    if (key === 'chip') return !!l.chip;
    if (key === 'shadowDistance') return l.shadowDistance ?? 0.4;
    return l[key];
  }
  const outText = (key, v) => (v == null ? '' : key === 'size' ? Number(v).toFixed(0) : key === 'strokeWidth' ? (Number(v) ? `${Math.round(Number(v) * 100)}%` : 'sem') : Number(v).toFixed(2));
  const syncOuts = (l) => $$('[data-out]').forEach((o) => { if (['zoom', 'dim', 'scrim'].includes(o.dataset.out)) return; o.textContent = outText(o.dataset.out, propValue(l, o.dataset.out)); });
  function swatchRow(box, current, onPick, list = SWATCHES) {
    box.innerHTML = '';
    list.forEach(([name, hex]) => {
      const b = document.createElement('button'); b.type = 'button'; b.title = name; b.setAttribute('aria-label', name); b.style.background = hex; b.className = (current || '').toLowerCase() === hex.toLowerCase() ? 'on' : '';
      b.addEventListener('click', () => onPick(hex)); box.appendChild(b);
    });
  }
  function refreshProps() {
    const l = layerById(selectedId); const props = $('[data-props]');
    props.hidden = !l;
    if (!l) return;
    const isText = l.type === 'text';
    $$('[data-p]').forEach((el) => {
      const key = el.dataset.p;
      const label = el.closest('label') || el;
      if (TEXT_ONLY.includes(key)) label.hidden = !isText; else if (key === 'w') label.hidden = !(isText || l.type === 'rect');
      const v = propValue(l, key);
      if (el.type === 'checkbox') el.checked = !!v; else if (document.activeElement !== el) el.value = v ?? '';
    });
    $$('[data-text-only]').forEach((g) => { g.hidden = !isText; });
    syncOuts(l);
    swatchRow($('[data-swatches]'), l.color, (hex) => { snapshot(); l.color = hex; commit(); });
    if (!isText) return;
    swatchRow($('[data-stroke-swatches]'), l.stroke?.color, (hex) => { snapshot(); l.stroke = { width: l.stroke?.width || 0.04, color: hex }; commit(); }, SWATCHES.filter(([n]) => ['Preto', 'Branco', 'Plum', 'Lime'].includes(n)));
    $('[data-stroke-colors-wrap]').hidden = !(l.stroke?.width > 0);
    // lado da sombra: o botão mais perto do ângulo atual (ou "em volta" quando a distância é zero)
    const glow = l.shadowAngle != null && (l.shadowDistance ?? 0.4) === 0;
    const ang = l.shadowAngle ?? 90;
    $$('[data-shadow-dir]').forEach((b) => {
      const d = b.dataset.shadowDir;
      const on = glow ? d === 'glow' : d !== 'glow' && Math.abs((((Number(d) - ang) % 360) + 540) % 360 - 180) < 23;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
  }

  function refreshBg() {
    const panels = $('[data-bg-panels]'); panels.innerHTML = '';
    const bg = spec.bg;
    const target = bg.kind === 'panels' ? bg.panels[panelIndex] : null;
    if (bg.kind === 'panels') {
      const row = document.createElement('div'); row.className = 'row';
      bg.panels.forEach((p, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = `btn sm ${i === panelIndex ? 'on' : ''}`; b.textContent = i === 0 ? 'Quadro de cima' : 'Quadro de baixo'; b.addEventListener('click', () => { panelIndex = i; refreshBg(); }); row.appendChild(b); });
      panels.appendChild(row);
    }
    const t = target ? target.bg : bg;
    const solid = bg.kind === 'solid';
    $('[data-bg-adjust]').hidden = solid;
    if (!solid) { // girar/espelhar e ajustes da foto do fundo (ou do painel escolhido)
      $('[data-orient="flipX"]').classList.toggle('on', !!t.flipX); $('[data-orient="flipY"]').classList.toggle('on', !!t.flipY);
      const adj = { brightness: 1, contrast: 1, saturate: 1, blur: 0, ...(t.adjust || {}) };
      $$('[data-adj]').forEach((el) => { if (document.activeElement !== el) el.value = adj[el.dataset.adj]; });
      $$('[data-out-adj]').forEach((o) => { const k = o.dataset.outAdj; o.textContent = k === 'blur' ? `${adj.blur} px` : `${Math.round(adj[k] * 100)}%`; });
    }
    renderPhotos();
    $$('[data-bg]').forEach((el) => {
      const k = el.dataset.bg; let v;
      if (k === 'dim') v = spec.dim || 0; else if (k === 'scrim') v = (spec.scrims[0] && spec.scrims[0].strength) || 0; else v = t[k];
      if (document.activeElement !== el) el.value = v ?? 0;
      (el.closest('label') || el).hidden = solid && k !== 'dim';
    });
    $$('[data-out]').forEach((o) => { if (['zoom', 'dim', 'scrim'].includes(o.dataset.out)) { const el = $(`[data-bg="${o.dataset.out}"]`); if (el) o.textContent = Number(el.value).toFixed(2); } });
    const picker = $('[data-frame-picker]'); picker.innerHTML = '';
    $('[data-frames-empty]').hidden = data.frames.length > 0;
    const current = solid ? null : target ? target.ref : bg.ref;
    data.frames.slice().sort((a, b) => (b.score || 0) - (a.score || 0)).forEach((f) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = f.ref === current ? 'on' : '';
      const img = document.createElement('img'); img.src = `${data.imageBase}${f.id}`; img.alt = `Quadro em ${Math.round(f.at_ms / 1000)} s`; img.loading = 'lazy';
      const cap = document.createElement('span'); cap.className = 'handle'; cap.textContent = f.analysis.from_file ? 'fotografia' : f.analysis.custom ? 'enviada' : `${Math.floor(f.at_ms / 60000)}:${String(Math.floor((f.at_ms % 60000) / 1000)).padStart(2, '0')} · ${f.score != null ? Number(f.score).toFixed(1) : '—'}`;
      b.append(img, cap);
      b.addEventListener('click', async () => {
        if (spec.bg.kind === 'solid') { await applyFrame(f); return; } // fundo liso: o quadro passa a ser o fundo
        snapshot(); await loadImage(f.ref);
        if (target) target.ref = f.ref; else bg.ref = f.ref;
        recomputeCtx(); commit();
      });
      picker.appendChild(b);
    });
  }

  function refreshPanels() { renderLayerList(); refreshProps(); refreshBg(); }
  function commit() { dirty = true; draw(); refreshPanels(); setStatus('Alterações não salvas'); }

  // ---------------------------------------------------------------- desfazer
  function snapshot() { undoStack.push(JSON.stringify({ spec, ctxData })); if (undoStack.length > 60) undoStack.shift(); }
  $('[data-undo]').addEventListener('click', undo);
  function undo() {
    const last = undoStack.pop(); if (!last) return;
    const s = JSON.parse(last); spec = s.spec; ctxData = s.ctxData;
    Promise.all(usedRefs().map(loadImage)).then(() => { dirty = true; draw(); refreshPanels(); setStatus('Alteração desfeita'); });
  }

  // ---------------------------------------------------------------- propriedades
  $$('[data-p]').forEach((el) => {
    const key = el.dataset.p;
    let armed = false;
    const apply = () => {
      const l = layerById(selectedId); if (!l) return;
      if (!armed) { snapshot(); armed = true; setTimeout(() => { armed = false; }, 600); }
      const val = el.type === 'checkbox' ? el.checked : el.value;
      if (key === 'family') l.font = { ...l.font, family: val };
      else if (key === 'italic') l.font = { ...l.font, italic: val };
      else if (key === 'highlight') l.highlight = val ? { color: E.BRAND.lime, lines: 'last' } : null;
      else if (key === 'text') l.text = val;
      else if (key === 'upper') l.upper = val;
      else if (key === 'align') l.align = val;
      else if (key === 'strokeWidth') l.stroke = Number(val) > 0 ? { width: Number(val), color: l.stroke?.color || E.BRAND.black } : null;
      else if (key === 'chip') l.chip = val ? { color: 'rgba(10,10,10,0.62)', padX: Math.round(l.size * 0.22), padY: Math.round(l.size * 0.12), radius: Math.round(l.size * 0.12) } : undefined;
      else if (key === 'shadowDistance') { l.shadowDistance = Number(val); if (l.shadowAngle == null) l.shadowAngle = 90; if (!l.shadow) l.shadow = 0.6; }
      else l[key] = Number(val);
      if (key === 'family') l.font.weight = { 'Space Grotesk': 700, 'Instrument Serif': 400, Inter: 500, 'JetBrains Mono': 500 }[val] || 400;
      dirty = true; draw(); renderLayerList(); syncOuts(l);
      if (['strokeWidth', 'shadowDistance'].includes(key)) refreshProps();
      setStatus('Alterações não salvas');
    };
    el.addEventListener('input', apply);
    el.addEventListener('change', apply);
  });

  $$('[data-bg]').forEach((el) => el.addEventListener('input', () => {
    snapshot();
    const k = el.dataset.bg; const v = Number(el.value);
    const target = spec.bg.kind === 'panels' ? spec.bg.panels[panelIndex].bg : spec.bg;
    if (k === 'dim') spec.dim = v;
    else if (k === 'scrim') { if (spec.scrims[0]) spec.scrims[0].strength = v; }
    else target[k] = v;
    if (['zoom', 'cx', 'cy'].includes(k)) recomputeCtx();
    dirty = true; draw();
    $$('[data-out]').forEach((o) => { const src = $(`[data-bg="${o.dataset.out}"]`); if (src) o.textContent = Number(src.value).toFixed(2); });
    setStatus('Alterações não salvas');
  }));

  // ---------------------------------------------------------------- adicionar / excluir camadas
  $$('[data-add]').forEach((b) => b.addEventListener('click', () => {
    snapshot();
    const id = `n${Date.now().toString(36).slice(-6)}`;
    const t = b.dataset.add; const W = spec.width; const H = spec.height;
    let layer;
    if (t === 'text') layer = { id, type: 'text', role: 'main', text: 'Novo texto', x: F.safe.l, y: Math.round(H * 0.4), w: Math.round(W * 0.6), size: Math.round(W * 0.06), font: { family: 'Space Grotesk', weight: 700, italic: false }, color: E.BRAND.white, align: 'left', lineHeight: 1.05, tracking: -0.02, upper: false, shadow: 0.5, highlight: null };
    else if (t === 'wordmark') layer = { id, type: 'wordmark', role: 'meta', x: F.safe.l, y: F.safe.t, size: Math.round(W * 0.045), color: E.BRAND.white };
    else layer = { id, type: 'rect', role: 'deco', x: F.safe.l, y: Math.round(H * 0.5), w: 240, h: 8, color: E.BRAND.lime, radius: 4 };
    spec.layers.push(layer); selectedId = id; commit();
  }));
  $('[data-delete]').addEventListener('click', deleteSelected);
  function deleteSelected() { if (!selectedId) return; snapshot(); spec.layers = spec.layers.filter((l) => l.id !== selectedId); selectedId = null; commit(); }

  // ---------------------------------------------------------------- arrastar e redimensionar
  const toDesign = (e) => { const r = overlay.getBoundingClientRect(); return { x: ((e.clientX - r.left) * spec.width) / r.width, y: ((e.clientY - r.top) * spec.height) / r.height, k: spec.width / r.width }; };
  const hit = (p) => {
    for (let i = spec.layers.length - 1; i >= 0; i -= 1) {
      const l = spec.layers[i]; if (l.hidden) continue;
      const b = E.layerBox(ctx, l); const pad = 10 * p.k;
      if (p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad) return l;
    }
    return null;
  };
  overlay.addEventListener('pointerdown', (e) => {
    const p = toDesign(e); const sel = layerById(selectedId);
    if (sel && sel.type === 'text') { // canto de redimensionar
      const b = E.layerBox(ctx, sel);
      if (Math.abs(p.x - (b.x + b.w + 6 * p.k)) <= 14 * p.k && Math.abs(p.y - (b.y + b.h + 6 * p.k)) <= 14 * p.k) { snapshot(); drag = { mode: 'resize', id: sel.id, startW: sel.w, startX: p.x }; overlay.setPointerCapture(e.pointerId); return; }
    }
    const l = hit(p);
    if (l) { selectedId = l.id; snapshot(); drag = { mode: 'move', id: l.id, dx: p.x - l.x, dy: p.y - l.y, moved: false }; overlay.setPointerCapture(e.pointerId); refreshPanels(); drawOverlay(); } else { selectedId = null; refreshPanels(); drawOverlay(); }
  });
  overlay.addEventListener('pointermove', (e) => {
    if (!drag) { const l = hit(toDesign(e)); overlay.style.cursor = l ? 'move' : 'default'; return; }
    const p = toDesign(e); const l = layerById(drag.id); if (!l) return;
    if (drag.mode === 'resize') l.w = Math.max(80, Math.round(drag.startW + (p.x - drag.startX)));
    else {
      let x = p.x - drag.dx; let y = p.y - drag.dy;
      const b = E.layerBox(ctx, { ...l, x, y });
      const snap = 10 * p.k; const cx = (spec.width - b.w) / 2;
      for (const t of [F.safe.l, cx, spec.width - F.safe.r - b.w]) if (Math.abs(x - t) < snap) x = t;
      for (const t of [F.safe.t, spec.height - F.safe.b - b.h]) if (Math.abs(y - t) < snap) y = t;
      l.x = Math.round(x); l.y = Math.round(y); drag.moved = true;
    }
    dirty = true; draw();
  });
  const endDrag = () => { if (!drag) return; drag = null; refreshProps(); setStatus('Alterações não salvas'); };
  overlay.addEventListener('pointerup', endDrag); overlay.addEventListener('pointercancel', endDrag);
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    const l = layerById(selectedId);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (!l) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
    const step = e.shiftKey ? 12 : 2; const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (moves) { e.preventDefault(); snapshot(); l.x += moves[0]; l.y += moves[1]; dirty = true; draw(); refreshProps(); setStatus('Alterações não salvas'); }
  });

  // Imagem nova (enviada ou fotografia do episódio) vira o fundo (ou o painel escolhido), em tela cheia e sem giro/ajustes antigos.
  async function applyFrame(f) {
    if (!frameById[f.ref]) { data.frames.push(f); frameById[f.ref] = f; }
    await loadImage(f.ref);
    snapshot();
    const target = spec.bg.kind === 'panels' ? spec.bg.panels[panelIndex] : null;
    const fresh = { fit: 'cover', zoom: 1, cx: 0.5, cy: 0.5, align: 'center', rot: 0, flipX: false, flipY: false, adjust: undefined };
    if (spec.bg.kind === 'solid') spec.bg = { kind: 'frame', ref: f.ref, ...fresh };
    else { Object.assign(target ? target.bg : spec.bg, fresh); if (target) target.ref = f.ref; else spec.bg.ref = f.ref; }
    recomputeCtx(); commit();
  }

  // ---------------------------------------------------------------- fundo: de onde vem (quadros, fotografias, enviar)
  $$('[data-bg-src]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-bg-src]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
    $$('[data-bg-pane]').forEach((p) => { p.hidden = p.dataset.bgPane !== b.dataset.bgSrc; });
  }));
  const photos = data.photos || [];
  // sem quadros do vídeo e com fotografias: já abre nas fotografias
  if (!data.frames.length && photos.length) $('[data-bg-src="photos"]')?.click();
  const countEl = $('[data-photo-count]'); if (countEl) countEl.textContent = photos.length ? String(photos.length) : '';
  let photosBuilt = false;
  function renderPhotos() {
    const grid = $('[data-photo-picker]'); if (!grid) return;
    if (!photos.length) { $('[data-photo-hint]').textContent = 'Este episódio ainda não tem fotografias no material bruto. Quando subirem (JPG, PNG ou WebP), aparecem aqui.'; return; }
    const current = frameById[(spec.bg.kind === 'panels' ? spec.bg.panels[panelIndex]?.ref : spec.bg.ref) || '']?.analysis?.from_file;
    if (!photosBuilt) {
      photosBuilt = true;
      photos.forEach((p) => {
        const b = document.createElement('button'); b.type = 'button'; b.dataset.file = p.id; b.title = p.name;
        const img = document.createElement('img'); img.src = p.thumb; img.alt = p.name; img.loading = 'lazy';
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
      if (!res.ok || !json.ok) throw new Error(json.error || `erro ${res.status}`);
      await applyFrame(json.frame);
      msg.textContent = json.frame.analysis.unchecked ? 'Foto aplicada, mas os rostos não foram conferidos: veja se o texto não cobre ninguém.' : 'Foto aplicada. Ajuste o enquadramento abaixo, se precisar.';
    } catch (err) { msg.textContent = `Não foi possível usar a foto: ${err.message}`; } finally { btn.classList.remove('busy'); }
  }

  // ---------------------------------------------------------------- girar, espelhar e ajustes da foto
  const bgTarget = () => (spec.bg.kind === 'panels' ? spec.bg.panels[panelIndex].bg : spec.bg);
  $$('[data-orient]').forEach((b) => b.addEventListener('click', () => {
    if (spec.bg.kind === 'solid') return;
    snapshot();
    const t = bgTarget(); const k = b.dataset.orient;
    if (k === 'rotL' || k === 'rotR') t.rot = (((t.rot || 0) + (k === 'rotR' ? 90 : -90)) % 360 + 360) % 360;
    else t[k] = !t[k];
    recomputeCtx(); commit();
  }));
  let adjArmed = false;
  const setAdjust = (patch) => {
    const t = bgTarget();
    const a = { brightness: 1, contrast: 1, saturate: 1, blur: 0, ...(t.adjust || {}), ...patch };
    t.adjust = a.brightness === 1 && a.contrast === 1 && a.saturate === 1 && !a.blur ? undefined : a;
    dirty = true; draw(); refreshBg(); setStatus('Alterações não salvas');
  };
  $$('[data-adj]').forEach((el) => el.addEventListener('input', () => {
    if (spec.bg.kind === 'solid') return;
    if (!adjArmed) { snapshot(); adjArmed = true; setTimeout(() => { adjArmed = false; }, 600); }
    setAdjust({ [el.dataset.adj]: Number(el.value) });
  }));
  $('[data-adj-mono]')?.addEventListener('click', () => { if (spec.bg.kind === 'solid') return; snapshot(); setAdjust({ saturate: 0, contrast: 1.1 }); });
  $('[data-adj-reset]')?.addEventListener('click', () => { if (spec.bg.kind === 'solid') return; snapshot(); setAdjust({ brightness: 1, contrast: 1, saturate: 1, blur: 0 }); });

  // ---------------------------------------------------------------- lado da sombra do texto
  $$('[data-shadow-dir]').forEach((b) => b.addEventListener('click', () => {
    const l = layerById(selectedId); if (!l || l.type !== 'text') return;
    snapshot();
    if (!l.shadow) l.shadow = 0.6;
    if (b.dataset.shadowDir === 'glow') { l.shadowAngle = l.shadowAngle ?? 90; l.shadowDistance = 0; } else { l.shadowAngle = Number(b.dataset.shadowDir); if (!l.shadowDistance) l.shadowDistance = 0.4; }
    commit();
  }));

  // ---------------------------------------------------------------- imagem própria como fundo
  const upload = $('[data-upload]');
  upload?.addEventListener('change', async () => {
    const file = upload.files[0]; const msg = $('[data-upload-msg]');
    if (!file) return;
    msg.textContent = 'Enviando…';
    try {
      const res = await fetch(data.uploadUrl, { method: 'POST', headers: { 'x-csrf-token': csrf, 'Content-Type': file.type || 'application/octet-stream', Accept: 'application/json' }, body: file });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || `erro ${res.status}`);
      const f = json.frame;
      await applyFrame(f);
      msg.textContent = f.analysis.unchecked ? 'Imagem aplicada, mas os rostos não foram conferidos: olhe com atenção se o texto não cobre ninguém.' : 'Imagem aplicada.';
    } catch (err) { msg.textContent = `Não foi possível enviar: ${err.message}`; } finally { upload.value = ''; }
  });

  // ---------------------------------------------------------------- abas, zonas e salvar
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
    $$('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  }));
  $$('[data-zone]').forEach((c) => c.addEventListener('change', () => { zones[c.dataset.zone] = c.checked; drawOverlay(); }));
  if (F.crop34) $('[data-zone-crop]').hidden = false;
  const setStatus = (t) => { $('[data-status]').textContent = t; };

  $('[data-save]').addEventListener('click', async () => {
    const btn = $('[data-save]'); btn.disabled = true; setStatus('Salvando…');
    try {
      const res = await fetch(data.saveUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ spec, ctx: ctxData }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || `erro ${res.status}`);
      dirty = false;
      const issues = (json.lint?.issues || []).length; const warns = (json.lint?.warnings || []).length;
      setStatus(issues ? `Salvo, mas o servidor encontrou ${issues} problema(s): ${json.lint.issues[0]}` : (warns ? `Salvo (${warns} aviso(s): ${json.lint.warnings[0]})` : 'Salvo. Imagem atualizada.'));
    } catch (err) { setStatus(`Não foi possível salvar: ${err.message}`); } finally { btn.disabled = false; }
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('resize', drawOverlay);

  // ---------------------------------------------------------------- início
  (async () => {
    const fam = ['700 40px "Space Grotesk"', 'italic 400 40px "Instrument Serif"', '500 40px "Inter"', '500 40px "JetBrains Mono"'];
    await Promise.all(fam.map((f) => document.fonts.load(f)));
    await document.fonts.ready;
    await Promise.all(usedRefs().map(loadImage));
    selectedId = (spec.layers.find((l) => l.role === 'main') || spec.layers[0] || {}).id || null;
    draw(); refreshPanels();
    // carrega o resto dos quadros em segundo plano (para a troca de fundo)
    data.frames.forEach((f) => loadImage(f.ref));
  })();
})();
