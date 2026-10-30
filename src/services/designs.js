// Construtores dos produtos visuais do Pulso (thumbnail, capa vertical, post de frase, tela dividida, carrossel).
// Cada construtor GERA VÁRIAS COMPOSIÇÕES (enquadramento, zoom, onde fica o rosto, quadro inteiro de um lado, faixa escura sob a frase)
// e fica com a que passa no verificador (lint) com o maior texto: nada de texto sobre rosto, sobre legenda já queimada no vídeo
// ou fora da zona segura de cada plataforma. Devolve { spec, ctxData, placed, report }: o spec é o que o motor desenha e o editor edita;
// ctxData traz rostos e legendas queimadas em pixels do canvas, para a conferência e para o editor mostrar as zonas.
const { engine, measureContext } = require('./covers');

const { BRAND, FONTS, FORMATS } = engine;
const ratio = (f) => f.width / f.height;

// Caixas normalizadas do quadro -> pixels do canvas, conforme o enquadramento escolhido.
function boxesFor(frame, bg, W, H) {
  const img = { w: frame.width, h: frame.height };
  const a = frame.analysis || {};
  const t = bg.fit === 'contain' ? engine.bgTransform(img, bg, W, H) : null; // foto menor que o canvas: o texto não pode invadi-la
  return {
    faces: (a.rostos || []).map((r) => engine.mapBox(r, img, bg, W, H)),
    blocks: (a.caixas_de_texto || []).map((r) => engine.mapBox(r, img, bg, W, H)),
    insets: t ? [{ x: Math.round(t.dx), y: Math.round(t.dy), w: Math.round(t.iw), h: Math.round(t.ih) }] : [],
  };
}

const wordmarkLayer = (x, y, size, color = BRAND.white) => ({ id: 'logo', type: 'wordmark', role: 'meta', x, y, size, color });
const metaTag = (id, text, x, y, size, color, w = 700, align = 'left') => ({
  id, type: 'text', role: 'meta', text, x, y, w, size, font: { ...FONTS.mono }, color, align, lineHeight: 1.2, tracking: 0.08, upper: true, shadow: 0,
  chip: { color: 'rgba(10,10,10,0.62)', padX: 14, padY: 8, radius: 8 },
});

// Penalidade de uma composição (menor é melhor): problemas do verificador, avisos, legenda queimada visível, rosto cortado ou enorme.
function penalty(spec, ctxData, placed, { faceMax = 0.7 } = {}) {
  const mctx = measureContext();
  const lint = engine.lint(mctx, spec, ctxData);
  const { width: W, height: H } = spec;
  let p = lint.issues.length * 100 + lint.warnings.length * 6;
  for (const b of engine.uncoveredBlocks(spec, ctxData.blocks)) p += (engine.visibleArea(b, W, H) / (W * H)) * 700;
  for (const s of spec.scrims || []) {
    if (s.side === 'patch') p += 40 + (s.rect.w * s.rect.h) / (W * H) * 120; // caixa escura é o último recurso: a faixa até o rodapé é mais limpa
    if (s.side === 'panel') p += ((H - s.y) / H) * 30; // faixa escura menor deixa mais foto à vista
  }
  for (const f of ctxData.faces) {
    const vis = engine.visibleArea(f, W, H) / (f.w * f.h);
    if (vis < 0.92) p += 160 * (1 - vis);
    if (f.h / H > faceMax) p += 60 * (f.h / H - faceMax) * 10;
  }
  if (placed) {
    if (placed.degraded) p += 60;
    if (!placed.fit.fits) p += 40;
    p -= placed.fit.size / 6;
  }
  return { penalty: p, lint };
}

// Faixa escura que esconde as legendas queimadas coladas no texto novo. Devolve null se a faixa teria que passar por cima de um rosto.
function patchFor(textBox, blocks, faces, W, H) {
  const pad = 22;
  let rect = grow(textBox, pad);
  for (let i = 0; i < 4; i += 1) { // inclui por inteiro toda legenda que a faixa toca (não deixa pedaço de legenda de fora)
    const touched = blocks.filter((b) => engine.overlap(rect, grow(b, 4)) > 0);
    if (!touched.length) break;
    const xs = [rect, ...touched.map((b) => grow(b, pad))];
    const x0 = Math.min(...xs.map((r) => r.x)); const y0 = Math.min(...xs.map((r) => r.y));
    const x1 = Math.max(...xs.map((r) => r.x + r.w)); const y1 = Math.max(...xs.map((r) => r.y + r.h));
    rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  rect = { x: Math.max(0, rect.x), y: Math.max(0, rect.y), w: Math.min(W, rect.x + rect.w) - Math.max(0, rect.x), h: Math.min(H, rect.y + rect.h) - Math.max(0, rect.y) };
  if (faces.some((f) => engine.overlap(grow(rect, 8), f) > 0)) return null;
  return { rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) }, scrim: { side: 'patch', rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) }, strength: 1, feather: 26 } };
}

function pickBest(cands) {
  return cands.reduce((best, c) => (!best || c.penalty < best.penalty ? c : best), null);
}

// Coloca um elemento pequeno (logotipo, rótulo) num canto que não toque em rosto, legenda ou no texto principal.
// optional: se não houver lugar livre (sem tocar rosto, legenda ou texto), o rótulo some em vez de cair em cima de alguém.
function placeMeta(layer, anchors, obstacles, F, { optional = false } = {}) {
  const mctx = measureContext();
  const box = engine.layerBox(mctx, { ...layer, x: 0, y: 0 });
  const pad = layer.chip ? 18 : 0;
  const bounds = { x: 16, y: 16, w: F.w - 32, h: F.h - 32 };
  const spot = engine.placeSmall({ w: box.w + 2 * pad, h: box.h + 2 * pad }, anchors.map((a) => ({ x: a.x - pad, y: a.y - pad })), obstacles, bounds);
  if (optional && !spot.ok) return null;
  return { ...layer, x: spot.x + pad - box.x, y: spot.y + pad }; // box.x != 0 quando o texto é alinhado à direita/centro
}

const report = (best) => ({ ok: best.lint.ok, issues: best.lint.issues, warnings: best.lint.warnings, penalty: Math.round(best.penalty) });

// ---------------------------------------------------------------- thumbnail 1280×720
function buildThumbnail({ frame, text, label = '', epLabel = '' }) {
  const F = FORMATS.youtube_thumb; const W = F.w; const H = F.h;
  const mctx = measureContext();
  const img = { w: frame.width, h: frame.height };
  const normFaces = frame.analysis?.rostos || [];
  const horizontal = ratio(frame) >= 1.5;
  const cands = [];
  for (const bg0 of engine.framings(img, normFaces, W, H, { zooms: horizontal ? [1, 1.12, 1.25, 1.4] : [1, 1.2], faceAts: [0.3, 0.7], faceYs: [0.4], contain: !horizontal })) {
    const bg = { ...bg0, ref: frame.ref };
    const { faces, blocks, insets } = boxesFor(frame, bg, W, H);
    const placed = engine.autoText(mctx, 'youtube_thumb', text, { faces, blocks, extra: insets, style: { highlight: { lines: 'last', color: BRAND.lime }, shadow: 0.6 } });
    const L = placed.layer;
    const onLeft = L.x < W / 2;
    const obstacles = [...faces, ...blocks, ...F.avoid, engine.layerBox(mctx, L)];
    const logo = placeMeta(wordmarkLayer(0, 0, 44), [{ x: F.safe.l, y: F.safe.t }, { x: W - F.safe.r - 160, y: F.safe.t }, { x: F.safe.l, y: H - F.safe.b - 60 }], obstacles, F);
    const layers = [L, logo];
    if (label) {
      const tag = placeMeta(metaTag('nome', `${label}${epLabel ? ` · ${epLabel}` : ''}`, 0, 0, 20, BRAND.silver, 620),
        [{ x: F.safe.l, y: H - F.safe.b - 30 }, { x: F.safe.l, y: F.safe.t + 70 }, { x: W - F.safe.r - 620, y: F.safe.t }], [...obstacles, engine.layerBox(mctx, logo)], F, { optional: true });
      if (tag) layers.push(tag);
    }
    const spec = { format: 'youtube_thumb', width: W, height: H, bg, dim: 0.06, scrims: [{ side: onLeft ? 'left' : 'right', strength: 0.72, size: 0.6 }, { side: 'bottom', strength: 0.3, size: 0.28 }], layers };
    const ctxData = { faces, blocks, insets };
    const ev = penalty(spec, ctxData, placed, { faceMax: 0.8 });
    cands.push({ spec, ctxData, placed, ...ev });
  }
  const best = pickBest(cands);
  return { spec: best.spec, ctxData: best.ctxData, placed: best.placed, report: report(best), tried: cands.length };
}

// ---------------------------------------------------------------- capa vertical 1080×1920 (Reels/TikTok; a grade do Instagram recorta o miolo 3:4)
function buildReelCover({ frame, text, label = '', epLabel = '' }) {
  const F = FORMATS.reel_cover; const W = F.w; const H = F.h;
  const mctx = measureContext();
  const img = { w: frame.width, h: frame.height };
  const cands = [];
  const style = { highlight: { lines: 'last', color: BRAND.lime }, shadow: 0.6 };
  for (const bg0 of engine.framings(img, frame.analysis?.rostos || [], W, H, { zooms: [1, 1.12, 1.25], faceAts: [0.5], faceYs: [0.3, 0.38, 0.46] })) {
    const bg = { ...bg0, ref: frame.ref };
    const { faces, blocks } = boxesFor(frame, bg, W, H);
    const variants = [{ placed: engine.autoText(mctx, 'reel_cover', text, { faces, blocks, style }), patch: null }];
    if (blocks.length) { // legenda queimada no meio da imagem: o texto ignora a legenda e uma faixa escura a esconde
      const free = engine.autoText(mctx, 'reel_cover', text, { faces, blocks: [], style });
      const patch = patchFor(engine.layerBox(mctx, free.layer), blocks, faces, W, H);
      if (patch) variants.push({ placed: free, patch });
    }
    for (const { placed, patch } of variants) {
      const hiddenSpec = { scrims: patch ? [patch.scrim] : [] };
      const shown = engine.uncoveredBlocks(hiddenSpec, blocks);
      const obstacles = [...faces, ...shown, engine.layerBox(mctx, placed.layer), ...(patch ? [patch.rect] : [])];
      const logo = placeMeta(wordmarkLayer(0, 0, 64), [{ x: F.safe.l, y: F.safe.t }, { x: W - F.safe.r - 230, y: F.safe.t }], obstacles, F);
      const layers = [placed.layer, logo];
      if (label) {
        const tag = placeMeta(metaTag('nome', `${label}${epLabel ? ` · ${epLabel}` : ''}`, 0, 0, 26, BRAND.silver, 900),
          [{ x: F.safe.l, y: F.safe.t + 92 }, { x: F.safe.l, y: F.h - F.safe.b - 40 }, { x: W - F.safe.r - 700, y: F.safe.t + 92 }], [...obstacles, engine.layerBox(mctx, logo)], F, { optional: true });
        if (tag) layers.push(tag);
      }
      const spec = { format: 'reel_cover', width: W, height: H, bg, dim: 0.04, scrims: [{ side: 'bottom', strength: 0.62, size: 0.46 }, ...(patch ? [patch.scrim] : [])], layers };
      const ctxData = { faces, blocks };
      cands.push({ spec, ctxData, placed, ...penalty(spec, ctxData, placed) });
    }
  }
  const best = pickBest(cands);
  return { spec: best.spec, ctxData: best.ctxData, placed: best.placed, report: report(best), tried: cands.length };
}

// ---------------------------------------------------------------- post de frase 1080×1350
// Duas estratégias por enquadramento: (a) frase numa faixa livre do próprio quadro; (b) faixa escura sob a frase, que também
// cobre uma legenda queimada que esteja na parte de baixo (nunca cobre rosto).
function buildQuotePost({ frame, quote, who = '', role = '', epLabel = '' }) {
  const F = FORMATS.post_4x5; const W = F.w; const H = F.h;
  const mctx = measureContext();
  const img = { w: frame.width, h: frame.height };
  const clean = quote.replace(/^[“"]|[”"]$/g, '');
  const footerH = who ? (role ? 118 : 80) : 0;
  const cands = [];
  for (const bg0 of engine.framings(img, frame.analysis?.rostos || [], W, H, { zooms: [1, 1.18, 1.35], faceAts: [0.5, 0.35, 0.65], faceYs: [0.3, 0.4] })) {
    const bg = { ...bg0, ref: frame.ref };
    const { faces, blocks } = boxesFor(frame, bg, W, H);
    const faceBottom = Math.max(0, ...faces.map((f) => f.y + f.h));
    const strategies = [];
    // (a) faixa livre
    const fmtA = { ...F, safe: { ...F.safe, b: F.safe.b + footerH + 30 } };
    strategies.push({ name: 'faixa', placed: engine.autoText(mctx, fmtA, clean, { faces, blocks, style: { shadow: 0.7, font: { ...FONTS.voice } } }), hidden: [] });
    // (b) faixa escura: do topo escolhido até o rodapé; legendas que ficam dentro dela são cobertas
    for (const top0 of [faceBottom + 40, H * 0.5, H * 0.58, H * 0.66]) {
      // legenda queimada logo acima da faixa (ou cortada por ela): sobe a faixa para cobri-la por inteiro
      const near = blocks.filter((b) => b.y < top0 - 20 && b.y + b.h > top0 - 70);
      const top = near.length ? Math.min(top0, ...near.map((b) => b.y - 28)) : top0;
      if (top < faceBottom + 24 || top > H - 360) continue;
      const hidden = blocks.filter((b) => b.y >= top - 20);
      const above = blocks.filter((b) => b.y < top - 20);
      if (above.some((b) => b.y + b.h > top - 70)) continue; // legenda "pela metade" na transição: descarta
      const area = { x: F.safe.l, y: top + 24, w: W - F.safe.l - F.safe.r, h: H - F.safe.b - footerH - (top + 24) };
      if (area.h < 220) continue;
      const fit = engine.fitText(mctx, clean, { w: area.w, h: area.h, font: FONTS.voice, maxSize: 92, minSize: 48, lineHeight: 1.1, tracking: -0.005, maxLines: 7 });
      const y = area.y + (area.h - fit.height) / 2;
      strategies.push({
        name: 'faixa-escura', hidden, panelTop: top,
        placed: { fit, degraded: false, layer: { id: 'texto', type: 'text', role: 'main', text: clean, x: F.safe.l, y: Math.round(y), w: area.w, size: fit.size, font: { ...FONTS.voice }, color: BRAND.white, align: 'left', lineHeight: 1.1, tracking: -0.005, upper: false, shadow: 0.5, highlight: null } },
      });
    }
    // (c) texto ignora a legenda queimada e uma faixa escura a esconde (quando a legenda está no meio da imagem e não dá para cortá-la fora)
    if (blocks.length) {
      const free = engine.autoText(mctx, fmtA, clean, { faces, blocks: [], style: { shadow: 0.7, font: { ...FONTS.voice } } });
      const patch = patchFor(engine.layerBox(mctx, free.layer), blocks, faces, W, H);
      if (patch) strategies.push({ name: 'faixa-sobre-legenda', placed: free, hidden: blocks.filter((b) => engine.uncoveredBlocks({ scrims: [patch.scrim] }, [b]).length === 0), patch });
    }
    for (const st of strategies) {
      const L = st.placed.layer;
      const textBox = engine.layerBox(mctx, L);
      const glyph = { id: 'aspas', type: 'text', role: 'deco', text: '“', x: L.x - 6, y: L.y - 150, w: 220, size: 220, font: { ...FONTS.display }, color: BRAND.lime, align: 'left', lineHeight: 1, tracking: 0, shadow: 0 };
      const obstacles = [...faces, ...blocks.filter((b) => !st.hidden.includes(b)), textBox];
      const glyphBox = { x: glyph.x + 4, y: glyph.y + 40, w: 110, h: 110 };
      const useGlyph = !obstacles.some((o) => o !== textBox && engine.overlap(grow(glyphBox, 6), o) > 0) && glyph.y > F.safe.t + 40;
      const layers = [];
      if (useGlyph) layers.push(glyph);
      layers.push(L);
      if (who) {
        const textBottom = L.y + st.placed.fit.height;
        layers.push(metaTag('autor', who, L.x, textBottom + 30, 28, BRAND.white, 900));
        if (role) layers.push(metaTag('cargo', role, L.x, textBottom + 30 + 46, 22, BRAND.silver, 900));
      }
      const logo = placeMeta(wordmarkLayer(0, 0, 52), [{ x: F.safe.l, y: F.safe.t }, { x: W - F.safe.r - 200, y: F.safe.t }], obstacles, F);
      layers.push(logo);
      if (epLabel) {
        const ep = placeMeta(metaTag('ep', epLabel, 0, 0, 22, BRAND.silver, 300, 'right'), [{ x: W - F.safe.r - 160, y: F.safe.t + 6 }, { x: F.safe.l, y: F.safe.t + 80 }], [...obstacles, engine.layerBox(mctx, logo)], F, { optional: true });
        if (ep) layers.push(ep);
      }
      const scrims = st.name === 'faixa-escura'
        ? [{ side: 'panel', y: st.panelTop, fade: 60, strength: 1 }]
        : [{ side: 'bottom', strength: 0.78, size: 0.62 }, ...(st.patch ? [st.patch.scrim] : [])];
      const spec = { format: 'post_4x5', width: W, height: H, bg, dim: 0.08, scrims, layers };
      const ctxData = { faces, blocks: blocks.filter((b) => !st.hidden.includes(b)) };
      const ev = penalty(spec, ctxData, st.placed);
      cands.push({ spec, ctxData, placed: st.placed, strategy: st.name, ...ev });
    }
  }
  const best = pickBest(cands);
  return { spec: best.spec, ctxData: best.ctxData, placed: best.placed, report: { ...report(best), strategy: best.strategy }, tried: cands.length };
}
const grow = engine.grow;

// ---------------------------------------------------------------- tela dividida 1080×1350: dois quadros, uma frase em cada
function buildSplitPost({ top, bottom, epLabel = '' }) {
  const F = FORMATS.post_split; const W = F.w; const H = F.h; const half = H / 2;
  const mctx = measureContext();
  const panels = []; const layers = []; const allFaces = []; const allBlocks = []; const reports = []; const patches = []; const allInsets = [];
  [top, bottom].forEach((item, i) => {
    const y0 = i * half;
    const img = { w: item.frame.width, h: item.frame.height };
    const fmt = { w: W, h: half, kind: 'quote', maxLines: 3, safe: { l: 72, r: 72, t: 40, b: 36 }, avoid: [] };
    const text = `“${item.quote.replace(/^[“"]|[”"]$/g, '')}”`;
    const cands = [];
    for (const bg0 of engine.framings(img, item.frame.analysis?.rostos || [], W, half, { zooms: [1, 1.2, 1.35, 1.5], faceAts: [0.5, 0.3, 0.7], faceYs: [0.36, 0.44], contain: item.frame.width < item.frame.height })) {
      const bg = { ...bg0, ref: item.frame.ref };
      const { faces, blocks, insets } = boxesFor(item.frame, bg, W, half);
      const style = { shadow: 0.8, font: { ...FONTS.voice }, maxLines: 3 };
      const variants = [{ placed: engine.autoText(mctx, fmt, text, { faces, blocks, extra: insets, style }), patch: null }];
      if (blocks.length) { // legenda queimada no caminho: o texto ignora a legenda e uma faixa escura a esconde
        const free = engine.autoText(mctx, fmt, text, { faces, blocks: [], extra: insets, style });
        const patch = patchFor(engine.layerBox(mctx, free.layer), blocks, faces, W, half);
        if (patch) variants.push({ placed: free, patch });
      }
      for (const { placed, patch } of variants) {
        const local = { format: 'post_split', width: W, height: half, bg, scrims: patch ? [patch.scrim] : [], layers: [{ ...placed.layer }] };
        cands.push({ bg, faces, blocks, insets, placed, patch, ...penalty(local, { faces, blocks, insets }, placed) });
      }
    }
    const best = pickBest(cands);
    if (best.patch) patches.push({ ...best.patch.scrim, rect: { ...best.patch.scrim.rect, y: best.patch.scrim.rect.y + y0 } });
    layers.push({ ...best.placed.layer, id: `frase${i + 1}`, y: best.placed.layer.y + y0 });
    panels.push({ ref: item.frame.ref, rect: { x: 0, y: y0, w: W, h: half }, bg: best.bg });
    allFaces.push(...best.faces.map((f) => ({ ...f, y: f.y + y0 })));
    allBlocks.push(...best.blocks.map((b) => ({ ...b, y: b.y + y0 })));
    allInsets.push(...best.insets.map((r) => ({ ...r, y: r.y + y0 })));
    reports.push(report(best));
  });
  layers.push({ id: 'divisor', type: 'rect', role: 'deco', x: 0, y: half - 3, w: W, h: 6, color: BRAND.black });
  const logo = placeMeta(wordmarkLayer(0, 0, 52), [{ x: W - F.safe.r - 190, y: H - 40 - 60 }, { x: W - F.safe.r - 190, y: 40 }, { x: F.safe.l, y: H - 40 - 60 }], [...allFaces, ...allBlocks, ...layers.map((l) => engine.layerBox(mctx, l))], F);
  layers.push(logo);
  if (epLabel) {
    const ep = placeMeta(metaTag('ep', epLabel, 0, 0, 22, BRAND.silver, 300), [{ x: F.safe.l, y: H - 40 - 30 }, { x: F.safe.l, y: half + 16 }], [...allFaces, ...allBlocks, ...layers.map((l) => engine.layerBox(mctx, l))], F, { optional: true });
    if (ep) layers.push(ep);
  }
  const scrims = [0, 1].map((i) => { const b = engine.layerBox(mctx, layers[i]); return { side: 'spot', rect: { x: b.x - 30, y: b.y - 10, w: b.w + 60, h: b.h + 20 }, strength: 0.62 }; });
  const spec = { format: 'post_split', width: W, height: H, bg: { kind: 'panels', panels }, dim: 0.05, scrims: [...patches, ...scrims], layers };
  const lint = engine.lint(mctx, spec, { faces: allFaces, blocks: allBlocks, insets: allInsets });
  return { spec, ctxData: { faces: allFaces, blocks: allBlocks, insets: allInsets }, report: { ok: lint.ok, issues: lint.issues, warnings: lint.warnings, panels: reports } };
}

// ---------------------------------------------------------------- carrossel 1080×1350: capa + frases em preto → plum → bone + fechamento
const SLIDE_THEMES = [
  { bg: BRAND.black, fg: BRAND.white, quote: BRAND.lime, mute: BRAND.silver },
  { bg: BRAND.plum, fg: BRAND.white, quote: BRAND.lime, mute: '#B9A6E8' },
  { bg: BRAND.bone, fg: BRAND.black, quote: BRAND.plum, mute: BRAND.steel },
];
const plainTag = (id, text, x, y, w, size, color, align = 'left') => ({
  id, type: 'text', role: 'meta', text, x, y, w, size, font: { ...FONTS.mono }, color, align, lineHeight: 1.2, tracking: 0.08, upper: true, shadow: 0,
});

function buildQuoteSlide({ quote, who, role, epLabel, index, total, theme }) {
  const F = FORMATS.post_4x5; const W = F.w; const H = F.h;
  const mctx = measureContext();
  const clean = quote.replace(/^[“"]|[”"]$/g, '');
  const box = { x: 96, y: 330, w: W - 192, h: H - 330 - 300 };
  const fit = engine.fitText(mctx, clean, { w: box.w, h: box.h, font: FONTS.voice, maxSize: 96, minSize: 52, lineHeight: 1.12, tracking: -0.005, maxLines: 9 });
  const y = box.y + (box.h - fit.height) / 2;
  const layers = [
    wordmarkLayer(96, 84, 52, theme.fg),
    plainTag('ep', epLabel, W - 96 - 400, 94, 400, 22, theme.mute, 'right'),
    { id: 'aspas', type: 'text', role: 'deco', text: '“', x: 90, y: y - 190, w: 260, size: 260, font: { ...FONTS.display }, color: theme.quote, align: 'left', lineHeight: 1, tracking: 0, shadow: 0 },
    { id: 'frase', type: 'text', role: 'main', text: clean, x: 96, y, w: box.w, size: fit.size, font: { ...FONTS.voice }, color: theme.fg, align: 'left', lineHeight: 1.12, tracking: -0.005, shadow: 0 },
    plainTag('autor', who, 96, H - 190, 700, 28, theme.fg),
    plainTag('cargo', role, 96, H - 190 + 40, 700, 22, theme.mute),
    plainTag('pag', `${String(index + 1).padStart(2, '0')}/${String(total).padStart(2, '0')}`, W - 96 - 300, H - 190, 300, 24, theme.mute, 'right'),
    { id: 'seta', type: 'arrow', role: 'deco', x: W - 96 - 44, y: H - 190 + 40, size: 44, color: theme.fg },
  ].filter((l) => l.type !== 'text' || String(l.text).trim());
  const spec = { format: 'post_4x5', width: W, height: H, bg: { kind: 'solid', color: theme.bg }, layers };
  const lint = engine.lint(mctx, spec, { faces: [], blocks: [] });
  return { spec, ctxData: { faces: [], blocks: [] }, report: { ok: lint.ok && fit.fits, issues: [...lint.issues, ...(fit.fits ? [] : ['A frase não coube com tamanho legível: use uma frase mais curta.'])], warnings: lint.warnings } };
}

function buildCarousel({ coverFrame, title, quotes, who, role, epLabel }) {
  const slides = [];
  const total = quotes.length + 2;
  const cover = buildQuotePost({ frame: coverFrame, quote: title, who, role, epLabel });
  slides.push(cover);
  quotes.forEach((q, i) => slides.push(buildQuoteSlide({ quote: q, who, role, epLabel, index: i + 1, total, theme: SLIDE_THEMES[i % 3] })));
  const theme = SLIDE_THEMES[quotes.length % 3];
  const W = 1080; const H = 1350;
  const mctx = measureContext();
  const closing = {
    format: 'post_4x5', width: W, height: H, bg: { kind: 'solid', color: theme.bg },
    layers: [
      wordmarkLayer(96, 84, 52, theme.fg), plainTag('ep', epLabel, W - 96 - 400, 94, 400, 22, theme.mute, 'right'),
      { id: 'cta', type: 'text', role: 'main', text: 'A conversa completa está no ar.', x: 96, y: 480, w: W - 192, size: 112, font: { ...FONTS.display }, color: theme.fg, align: 'left', lineHeight: 1.04, tracking: -0.04, shadow: 0, highlight: { lines: 'last', color: theme.quote } },
      plainTag('sub', 'Ouça e assista ao episódio completo', 96, 480 + 4 * 112 * 1.04 + 24, 900, 26, theme.mute),
      plainTag('pag', `${String(total).padStart(2, '0')}/${String(total).padStart(2, '0')}`, W - 96 - 300, H - 190, 300, 24, theme.mute, 'right'),
    ],
  };
  const lint = engine.lint(mctx, { ...closing, format: 'post_4x5' }, { faces: [], blocks: [] });
  slides.push({ spec: closing, ctxData: { faces: [], blocks: [] }, report: { ok: lint.ok, issues: lint.issues, warnings: lint.warnings } });
  return slides;
}

module.exports = { boxesFor, buildThumbnail, buildReelCover, buildQuotePost, buildSplitPost, buildQuoteSlide, buildCarousel, SLIDE_THEMES, penalty };
