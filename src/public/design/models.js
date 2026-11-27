/* Modelos de capa do Pulso (Guia de peças do episódio, v1.1: docs/referencias/capas). O MESMO arquivo roda no servidor e no
   navegador, em cima do motor (engine.js): a prévia da janela "Ajustar capa" é a imagem que o servidor grava.
   Cada modelo é uma função build(ctx, dados, foto, { flip }) -> { spec, ctxData, notes }:
   - dados: os campos da ficha que o modelo usa (guest, tag, ep, axis, pre/hl/post, setup/punch, num/line, quote, hook, sub, creds);
   - foto: { ref, w, h, face: { x, y, h } } com o centro e a altura do rosto de 0 a 1 (o recorte sai dele, como no guia);
   - flip: espelha o desenho (o texto vai para o lado para onde a pessoa olha).
   As medidas vêm do guia (YT-D a YT-G, SP-B, SP-C, RL-B, RL-C, em pixels) e das capas publicadas (YT-A, YT-B, YT-C, YT-A+, SP-A, RL-A). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine'));
  else root.PulsoModels = factory(root.PulsoDesign);
}(typeof self !== 'undefined' ? self : this, (E) => {
  const { BRAND, FONTS } = E;
  const DISPLAY = FONTS.display; const SERIF = FONTS.voice; const MONO = FONTS.mono;
  const INK = BRAND.black; const SHADE = (a) => `rgba(10,10,10,${a})`;
  const MONO_LH = 1.32; // altura de linha "normal" da JetBrains Mono no CSS
  const MAX_ZOOM = 1.5; // acima disso a foto fica ampliada demais (o guia pede trocar)

  const tidy = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const wordsOf = (s) => tidy(s).split(' ').filter(Boolean);
  const countWords = (s) => wordsOf(s).length;
  const upper = (s) => tidy(s).toLocaleUpperCase('pt-BR');
  const ep3 = (n) => { const d = String(n ?? '').replace(/\D/g, ''); return d ? d.padStart(3, '0').slice(-3) : ''; };
  const axisColor = (axis) => (/^(inova|ia$)/i.test(tidy(axis)) ? BRAND.white : BRAND.lime); // lime: Histórias e Negócios; branco: Inovação e IA

  // ---------------------------------------------------------------- recorte pela posição do rosto (a conta do guia)
  // W×H: o painel; (tx, ty): onde o centro do rosto deve cair; th: altura que o rosto deve ter; exp: fator de exportação (Spotify = 3).
  function crop(photo, W, H, tx, ty, th, exp = 1) {
    if (!photo || !photo.w || !photo.h) return null;
    const f = photo.face || { x: 0.5, y: 0.38, h: 0.25 };
    const s = Math.max(th / (f.h * photo.h), W / photo.w, H / photo.h);
    const dw = photo.w * s; const dh = photo.h * s;
    const l = Math.min(0, Math.max(W - dw, tx - f.x * dw));
    const t = Math.min(H * 0.22, Math.max(H - dh, ty - f.y * dh));
    const eh = f.h * dh * 1.12; const ew = eh * 0.74;
    const zoom = s * exp;
    return {
      img: { x: Math.round(l), y: Math.round(t), w: Math.round(dw), h: Math.round(dh) },
      fade: t > 1 ? Math.round(Math.min(dh * 0.16, 240)) : 0,
      face: { x: l + f.x * dw - ew / 2, y: t + f.y * dh - eh / 2, w: ew, h: eh }, // elipse do rosto, relativa ao painel
      zoom, soft: Math.round(zoom * 10) / 10 > MAX_ZOOM, // 1,5× ainda passa; o aviso começa em 1,6×
    };
  }

  // ---------------------------------------------------------------- peças
  const text = (id, str, x, y, w, size, o = {}) => ({
    id, type: 'text', css: true, role: o.role || 'main', text: tidy(str), x: Math.round(x), y: Math.round(y), w: Math.round(w), size,
    font: { ...(o.font || DISPLAY) }, color: o.color || BRAND.white, align: o.align || 'left', lineHeight: o.lh ?? 0.95, tracking: o.tracking ?? -0.055,
    shadow: 0, upper: false, ...(o.marks ? { marks: o.marks } : {}), ...(o.minSize != null ? { minSize: o.minSize } : {}), ...(o.maxLines ? { maxLines: o.maxLines } : {}), ...(o.chip ? { chip: o.chip } : {}),
  });
  const mono = (id, str, x, y, w, size, o = {}) => text(id, str, x, y, w, size, { font: MONO, lh: o.lh ?? 1.3, tracking: o.tracking ?? 0.14, role: 'meta', color: o.color || BRAND.lime, minSize: o.minSize ?? 18, align: o.align, chip: o.chip });
  const tagLine = (str, x, y, w, size, o = {}) => mono('rotulo', `[ ${upper(str)} ]`, x, y, w, size, o);
  const logo = (x, y, size, color = BRAND.white, dotColor = BRAND.lime) => ({ id: 'logo', type: 'wordmark', role: 'meta', css: true, x: Math.round(x), y: Math.round(y), size, color, dotColor });
  const rect = (id, x, y, w, h, color, radius = 0) => ({ id, type: 'rect', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), color, ...(radius ? { radius } : {}) });
  const gradient = (id, x, y, w, h, dir, stops) => ({ id, type: 'gradient', x, y, w, h, dir, stops });
  const tarja = (str, x, y, size, o = {}) => ({ id: 'destaque', type: 'tarja', role: 'main', text: tidy(str), x: Math.round(x), y: Math.round(y), size, font: { ...DISPLAY }, color: o.color || INK, bg: o.bg || BRAND.lime, pad: o.pad || { t: 12, r: 30, b: 26, l: 20 }, tracking: o.tracking ?? -0.065, lineHeight: 0.85 });
  const boxOf = (ctx, layer) => E.layerBox(ctx, layer);
  const wordmarkWidth = (ctx, size) => boxOf(ctx, { type: 'wordmark', x: 0, y: 0, size }).w;

  // Foto no painel (x, y, w, h). c = crop(...). Devolve a camada e a elipse do rosto já em pixels do canvas.
  function photoLayer(photo, c, x, y, w, h, o = {}) {
    if (!photo || !c) return { layer: { id: 'foto', type: 'photo', x, y, w, h, bgColor: o.bgColor || INK, shape: o.shape }, face: null };
    const inset = o.inset || 0;
    return {
      layer: { id: 'foto', type: 'photo', ref: photo.ref, x, y, w, h, img: { x: c.img.x + inset, y: c.img.y + inset, w: c.img.w, h: c.img.h }, fade: c.fade, shape: o.shape || 'rect', bgColor: o.bgColor || INK, filter: o.filter || { saturate: 0.85, contrast: 1.06 }, ...(o.border ? { border: o.border } : {}) },
      face: { x: x + inset + c.face.x, y: y + inset + c.face.y, w: c.face.w, h: c.face.h },
    };
  }
  // Maior tamanho (entre max e min) em que a tarja cabe na largura.
  function tarjaFit(ctx, str, max, min, maxW, pad) {
    let size = max;
    for (; size > min; size -= 2) if (boxOf(ctx, tarja(str, 0, 0, size, { pad })).w <= maxW) break;
    return size;
  }
  // Empilha camadas (texto e tarja) de cima para baixo a partir de y, com os espaços dados. Devolve o y do fim.
  function stack(ctx, layers, y, gaps) {
    let cur = y;
    layers.forEach((l, i) => { l.y = Math.round(cur); cur += boxOf(ctx, l).h + (i < layers.length - 1 ? (Array.isArray(gaps) ? gaps[i] : gaps) : 0); });
    return cur;
  }
  const heightOf = (ctx, layers, gaps) => layers.reduce((s, l, i) => s + boxOf(ctx, l).h + (i < layers.length - 1 ? (Array.isArray(gaps) ? gaps[i] : gaps) : 0), 0);
  // Texto que diminui até caber em maxLines (sem passar do mínimo: abaixo dele a conferência reclama).
  function fitted(ctx, layer, max, min, maxLines) {
    for (let size = max; size >= min; size -= 2) { layer.size = size; const b = boxOf(ctx, layer); if (b.lines.length <= maxLines && b.w <= layer.w + 1) return layer; }
    layer.size = min; return layer;
  }
  // Frase com a palavra de destaque marcada: pre + hl + post numa linha só de texto, e os índices das palavras do destaque.
  function phrase(d) {
    const pre = wordsOf(d.pre); const hl = wordsOf(d.hl); const post = wordsOf(d.post);
    return { full: [...pre, ...hl, ...post].join(' '), marks: hl.map((_, i) => pre.length + i) };
  }

  const finish = (model, format, W, H, bg, layers, faces, notes, extra = {}) => ({
    spec: { format, width: W, height: H, model, bg: { kind: 'solid', color: bg }, scrims: [], layers: layers.filter(Boolean), ...extra },
    ctxData: { faces: faces.filter(Boolean).map((f) => ({ ...E.grow(f, 36), oval: true })), blocks: [] }, // a elipse do rosto + 40 px livres (o verificador soma 4)
    notes,
  });
  const notesOf = (c) => ({ zoom: c ? Math.round(c.zoom * 10) / 10 : null, soft: Boolean(c && c.soft) });

  // ---------------------------------------------------------------- YouTube 1280×720
  const YW = 1280; const YH = 720;
  const YT_EXTRA = { avoid: [{ x: 1144, y: 652, w: 120, h: 52, why: 'duração do vídeo' }], safe: { l: 48, r: 48, t: 44, b: 48 } };
  const mirror = (flip) => (x, w) => (flip ? YW - x - w : x);

  // YT-A · Painel lateral: foto de um lado, degradê preto, frase do outro com a palavra de destaque em lime.
  function ytA(ctx, d, photo, { flip = false } = {}) {
    const P = mirror(flip); const px = P(500, 780);
    const c = crop(photo, 780, YH, flip ? 340 : 440, 300, 320);
    const ph = photoLayer(photo, c, px, 0, 780, YH);
    const col = P(64, 560);
    const { full, marks } = phrase(d);
    const title = fitted(ctx, text('texto', full, col, 0, 560, 116, { tracking: -0.05, lh: 0.98, marks: { words: marks, color: BRAND.lime }, minSize: 54, maxLines: 3 }), 116, 88, 3);
    const th = boxOf(ctx, title).h;
    title.y = Math.round(130 + Math.max(0, (410 - th) / 2));
    return finish('YT-A', 'youtube_thumb', YW, YH, INK, [
      ph.layer, gradient('degrade', px, 0, 780, YH, flip ? 'left' : 'right', [[0, INK], [0.42, SHADE(0)]]),
      d.tag ? tagLine(d.tag, col, 60, 560, 22, { minSize: 20 }) : null, title,
      { id: 'pulso', type: 'pulse', x: col, y: Math.min(586, title.y + th + 44), w: 330, color: BRAND.lime, width: 2, beat: 9, at: 0.42 },
      logo(col, YH - 52 - 48, 48),
    ], [ph.face], notesOf(c), YT_EXTRA);
  }

  // YT-B · Tarja lime: apoio em serifa, uma palavra dentro da tarja (o ponto de leitura no celular) e o fecho em branco.
  function ytB(ctx, d, photo, { flip = false } = {}) {
    const P = mirror(!flip); // desenho de base: foto à esquerda, texto à direita (como nas capas publicadas)
    const px = P(520, 760); const side = !flip;
    const c = crop(photo, 760, YH, side ? 340 : 420, 290, 330);
    const ph = photoLayer(photo, c, px, 0, 760, YH);
    const col = P(64, 520);
    const size = tarjaFit(ctx, d.hl, 116, 72, 520);
    const items = [
      tidy(d.pre) ? text('apoio', d.pre, col, 0, 520, 56, { font: SERIF, tracking: -0.005, lh: 1.02, minSize: 54, maxLines: 2 }) : null,
      tarja(d.hl, col, 0, size),
      tidy(d.post) ? text('texto', d.post, col, 0, 520, 60, { tracking: -0.05, lh: 0.98, minSize: 54, maxLines: 2 }) : null,
    ].filter(Boolean);
    const gaps = 16;
    stack(ctx, items, Math.round(150 + Math.max(0, (450 - heightOf(ctx, items, gaps)) / 2)), gaps);
    const lw = wordmarkWidth(ctx, 48);
    return finish('YT-B', 'youtube_thumb', YW, YH, INK, [
      ph.layer, gradient('degrade', px, 0, 760, YH, side ? 'left' : 'right', [[0, INK], [0.42, SHADE(0)]]),
      d.tag ? tagLine(d.tag, col, 60, 520, 22, { minSize: 20 }) : null, ...items,
      logo(side ? YW - 64 - lw : 64, YH - 52 - 48, 48),
    ], [ph.face], notesOf(c), YT_EXTRA);
  }

  // YT-C · Plum dividido: fundo plum com pontos, filete lime, a palavra de destaque em serifa gigante. A versão premium.
  function ytC(ctx, d, photo, { flip = false } = {}) {
    const P = mirror(flip); const px = P(666, 614);
    const c = crop(photo, 614, YH, 307, 300, 320);
    const ph = photoLayer(photo, c, px, 0, 614, YH, { bgColor: BRAND.plum });
    const col = P(64, 540);
    const hl = fitted(ctx, text('destaque', d.hl, col, 0, 540, 200, { font: SERIF, tracking: -0.01, lh: 0.9, color: BRAND.lime, minSize: 88, maxLines: 1 }), 200, 120, 1);
    const items = [
      tidy(d.pre) ? text('texto', d.pre, col, 0, 540, 68, { tracking: -0.05, lh: 0.95, minSize: 54, maxLines: 2 }) : null,
      hl,
      tidy(d.post) ? text('fecho', d.post, col, 0, 540, 68, { tracking: -0.05, lh: 0.95, minSize: 54, maxLines: 2 }) : null,
    ].filter(Boolean);
    stack(ctx, items, Math.round(130 + Math.max(0, (450 - heightOf(ctx, items, 6)) / 2)), 6);
    return finish('YT-C', 'youtube_thumb', YW, YH, BRAND.plum, [
      { id: 'pontos', type: 'dots', x: P(0, 660), y: 0, w: 660, h: YH, step: 40, r: 3, color: '#3a2663' },
      ph.layer, rect('filete', P(660, 6), 0, 6, YH, BRAND.lime),
      d.tag ? rect('ponto', col, 66, 12, 12, BRAND.lime, 6) : null,
      d.tag ? mono('rotulo', upper(d.tag), col + 24, 60, 500, 22, { minSize: 20 }) : null,
      ...items, logo(col, YH - 52 - 48, 48, BRAND.bone),
    ], [ph.face], notesOf(c), YT_EXTRA);
  }

  // YT-A+ · Painel com credenciais: etiquetas que dizem quem é a pessoa antes do nome, e uma palavra gigante em lime.
  function ytAPlus(ctx, d, photo, { flip = false } = {}) {
    const P = mirror(flip); const px = P(600, 680);
    const c = crop(photo, 680, YH, flip ? 280 : 400, 310, 330);
    const ph = photoLayer(photo, c, px, 0, 680, YH);
    const col = P(64, 540);
    const creds = (Array.isArray(d.creds) && d.creds.length ? d.creds : [d.tag]).map(upper).filter(Boolean).slice(0, 3);
    const chips = []; let cx = col + 12;
    creds.forEach((cr, i) => {
      const chip = mono(`cred${i}`, cr, cx, 150, 520, 20, { color: i === 0 ? INK : BRAND.white, lh: 1.2, minSize: 20, chip: i === 0 ? { color: BRAND.lime, padX: 12, padY: 8, radius: 0 } : { color: 'none', stroke: BRAND.white, strokeWidth: 2, padX: 12, padY: 8, radius: 0 } });
      const w = boxOf(ctx, chip).w;
      if (cx + w + 12 > col + 540 && i > 0) return; // não coube na linha: fica de fora (o rótulo completo continua na ficha)
      chips.push(chip); cx += w + 24 + 10;
    });
    const hl = fitted(ctx, text('destaque', d.hl, col, 0, 540, 250, { tracking: -0.06, lh: 0.9, color: BRAND.lime, minSize: 88, maxLines: 1 }), 250, 96, 1);
    const items = [
      tidy(d.pre) ? text('apoio', d.pre, col, 0, 540, 60, { font: SERIF, tracking: -0.005, lh: 1.05, minSize: 54, maxLines: 2 }) : null,
      hl,
      tidy(d.post) ? text('fecho', d.post, col, 0, 540, 54, { tracking: -0.04, lh: 1, color: BRAND.silver, minSize: 54, maxLines: 2 }) : null,
    ].filter(Boolean);
    stack(ctx, items, 214, [2, 14]);
    return finish('YT-A+', 'youtube_thumb', YW, YH, INK, [
      ph.layer, gradient('degrade', px, 0, 680, YH, flip ? 'left' : 'right', [[0, INK], [0.4, SHADE(0)]]),
      ...chips, ...items, logo(col, YH - 52 - 48, 48),
    ], [ph.face], notesOf(c), YT_EXTRA);
  }

  // YT-D · Número: um número dito no episódio em 400 px e uma linha de até 6 palavras.
  function ytD(ctx, d, photo, { flip = false } = {}) {
    const P = mirror(flip); const px = P(580, 700);
    const c = crop(photo, 700, YH, flip ? 300 : 400, 300, 320);
    const ph = photoLayer(photo, c, px, 0, 700, YH);
    const col = P(64, 560);
    return finish('YT-D', 'youtube_thumb', YW, YH, INK, [
      ph.layer, gradient('degrade', px, 0, 700, YH, flip ? 'left' : 'right', [[0, INK], [0.38, SHADE(0)]]),
      d.tag ? tagLine(d.tag, col, 60, 560, 22, { minSize: 20 }) : null,
      text('destaque', d.num, col - 12, 96, 572, 400, { tracking: -0.08, lh: 1, color: BRAND.lime, minSize: 88, maxLines: 1 }),
      text('texto', d.line, col, 440, 540, 64, { tracking: -0.05, lh: 0.95, minSize: 54, maxLines: 2 }),
      logo(col, YH - 52 - 48, 48),
    ], [ph.face], notesOf(c), YT_EXTRA);
  }

  // YT-E · Close + palavra: rosto grande, frase de até 4 palavras e uma palavra na tarja (que se ajusta à largura).
  function ytE(ctx, d, photo, { flip = false } = {}) {
    const P = mirror(flip); const px = P(520, 760);
    const c = crop(photo, 760, YH, flip ? 320 : 440, 360, 380);
    const ph = photoLayer(photo, c, px, 0, 760, YH, { filter: { saturate: 0.85, contrast: 1.08 } });
    const col = P(64, 620);
    const pad = { t: 12, r: 30, b: 26, l: 20 };
    const size = tarjaFit(ctx, d.punch, 170, 72, 620, pad);
    const items = [text('texto', d.setup, col, 0, 620, 72, { tracking: -0.055, lh: 0.92, minSize: 54, maxLines: 2 }), tarja(d.punch, col, 0, size, { tracking: -0.07, pad })];
    stack(ctx, items, YH - 72 - heightOf(ctx, items, 18), 18);
    const lw = wordmarkWidth(ctx, 48);
    return finish('YT-E', 'youtube_thumb', YW, YH, INK, [
      ph.layer, gradient('degrade', px, 0, 760, YH, flip ? 'left' : 'right', [[0, INK], [0.14, SHADE(0.6)], [0.34, SHADE(0)]]),
      gradient('topo', px, 0, 760, 170, 'down', [[0, SHADE(0.75)], [1, SHADE(0)]]),
      d.tag ? tagLine(d.tag, col, 60, 560, 22, { minSize: 20 }) : null,
      logo(P(YW - 64 - lw, lw), 60, 48), ...items,
    ], [ph.face], notesOf(c), YT_EXTRA);
  }

  // YT-F · Frase do convidado: fundo creme (destaca numa lista escura), frase literal em serifa, nome e credencial.
  function ytF(ctx, d, photo, { flip = false } = {}) {
    const P = mirror(flip); const px = P(760, 520);
    const c = crop(photo, 520, YH, 260, 300, 300);
    const ph = photoLayer(photo, c, px, 0, 520, YH, { filter: { saturate: 0.8, contrast: 1.06 } });
    const col = P(64, 620);
    const lw = wordmarkWidth(ctx, 44);
    const quote = fitted(ctx, text('texto', d.quote, col, 200, 620, 96, { font: SERIF, tracking: -0.005, lh: 0.95, color: INK, minSize: 54, maxLines: 4 }), 96, 72, 3);
    const y0 = YH - 64 - (22 * MONO_LH + 8 + 18 * MONO_LH);
    return finish('YT-F', 'youtube_thumb', YW, YH, BRAND.bone, [
      ph.layer, gradient('topo', px, 0, 520, 170, 'down', [[0, SHADE(0.75)], [1, SHADE(0)]]),
      logo(flip ? px + 48 : px + 520 - 48 - lw, 52, 44),
      text('aspas', '“', col - 8, 20, 300, 260, { font: SERIF, tracking: 0, lh: 1, color: BRAND.plum, role: 'deco' }),
      quote,
      rect('filete', col, y0 + (22 * MONO_LH - 3) / 2, 40, 3, BRAND.plum),
      mono('nome', upper(d.guest), col + 54, y0, flip ? 470 : 560, 22, { color: BRAND.plum, lh: MONO_LH, minSize: 20 }),
      d.tag ? mono('rotulo', upper(d.tag), col + 54, y0 + 22 * MONO_LH + 8, flip ? 470 : 560, 18, { color: BRAND.plum, lh: MONO_LH }) : null, // espelhado: não entra no canto da duração
    ], [ph.face], notesOf(c), YT_EXTRA);
  }

  // YT-G · Lime total: fundo lime e tarja preta. Episódio especial (no máximo 1 a cada 5, para não gastar o lime).
  function ytG(ctx, d, photo, { flip = false } = {}) {
    const P = mirror(flip); const px = P(64, 500);
    const c = crop(photo, 500, 592, 250, 240, 260);
    const ph = photoLayer(photo, c, px, 64, 500, 592, { filter: { saturate: 0.85, contrast: 1.08 } });
    const col = P(624, 600);
    const pad = { t: 10, r: 28, b: 20, l: 18 };
    const items = [
      tidy(d.pre) ? text('texto', d.pre, col, 0, 600, 84, { tracking: -0.06, lh: 0.9, color: INK, minSize: 54, maxLines: 2 }) : null,
      tarja(d.hl, col, 0, tarjaFit(ctx, d.hl, 116, 72, 600, pad), { bg: INK, color: BRAND.lime, pad }),
      tidy(d.post) ? text('fecho', d.post, col, 0, 600, 84, { tracking: -0.06, lh: 0.9, color: INK, minSize: 54, maxLines: 2 }) : null,
    ].filter(Boolean);
    stack(ctx, items, 170, 14);
    return finish('YT-G', 'youtube_thumb', YW, YH, BRAND.lime, [
      ph.layer, d.tag ? tagLine(d.tag, col, 64, 600, 22, { color: INK, minSize: 20 }) : null, ...items,
      logo(col, YH - 56 - 48, 48, INK, BRAND.white),
    ], [ph.face], notesOf(c), YT_EXTRA);
  }

  // ---------------------------------------------------------------- Spotify (base 1000; o arquivo sai em 3000×3000)
  const SW = 1000; const SP_EXTRA = { scale: 3 };
  function epLabel(ctx, ep, rightX, rowY, rowH, color = BRAND.white, size = 30) {
    const y = rowY + (rowH - size * MONO_LH) / 2;
    const num = mono('ep', ep3(ep), 0, y, 200, size, { color, tracking: 0.08, lh: MONO_LH });
    const nw = boxOf(ctx, num).w; num.x = Math.round(rightX - nw);
    const dotX = num.x - 14 - 12;
    const epT = mono('epLetras', 'EP', 0, y, 100, size, { color, tracking: 0.08, lh: MONO_LH });
    epT.x = Math.round(dotX - 14 - boxOf(ctx, epT).w);
    return [epT, rect('epPonto', dotX, rowY + (rowH - 12) / 2, 12, 12, BRAND.lime, 6), num];
  }

  // SP-A · Padrão: logo e número no topo, foto 888×560, nome e a chamada em serifa.
  function spA(ctx, d, photo) {
    const c = crop(photo, 888, 560, 420, 250, 330, 3);
    const ph = photoLayer(photo, c, 56, 150, 888, 560);
    const name = fitted(ctx, text('nome', d.guest, 56, 742, 888, 64, { tracking: -0.055, lh: 0.98, minSize: 64, maxLines: 2 }), 64, 64, 2);
    const hook = fitted(ctx, text('texto', d.hook, 56, 0, 888, 50, { font: SERIF, tracking: -0.005, lh: 1.06, color: BRAND.lime, minSize: 46, maxLines: 2 }), 50, 46, 2);
    stack(ctx, [name, hook], 742, 12);
    return finish('SP-A', 'spotify_cover', SW, SW, INK, [
      ph.layer, gradient('base', 56, 510, 888, 200, 'up', [[0, SHADE(0.72)], [1, SHADE(0)]]),
      logo(56, 56, 64), ...epLabel(ctx, d.ep, 944, 56, 64),
      d.axis ? mono('rotulo', `[ ${upper(d.axis)} ]`, 84, 150 + 560 - 28 - 24 * MONO_LH, 600, 24, { color: axisColor(d.axis), lh: MONO_LH }) : null,
      name, hook,
      { id: 'pulso', type: 'pulse', x: 56, y: 950, w: 888, color: '#3a3a3a', width: 2, beat: 9, at: 0.47 },
    ], [ph.face], notesOf(c), SP_EXTRA);
  }

  // SP-B · Foto cheia: nome em 112 px (lê melhor a 64 px). Pede foto vertical em alta.
  function spB(ctx, d, photo) {
    const c = crop(photo, SW, SW, 480, 320, 300, 3);
    const ph = photoLayer(photo, c, 0, 0, SW, SW);
    const items = [
      d.axis ? mono('rotulo', `[ ${upper(d.axis)} ]`, 56, 0, 888, 24, { color: axisColor(d.axis), lh: MONO_LH }) : null,
      fitted(ctx, text('nome', d.guest, 56, 0, 888, 112, { tracking: -0.06, lh: 0.88, minSize: 64, maxLines: 2 }), 112, 84, 2),
      fitted(ctx, text('texto', d.hook, 56, 0, 888, 52, { font: SERIF, tracking: -0.005, lh: 1.02, minSize: 46, maxLines: 2 }), 52, 46, 2),
    ].filter(Boolean);
    stack(ctx, items, SW - 56 - heightOf(ctx, items, 18), 18);
    return finish('SP-B', 'spotify_cover', SW, SW, INK, [
      ph.layer, gradient('base', 0, 0, SW, SW, 'up', [[0, INK], [0.3, SHADE(0.85)], [0.55, SHADE(0)]]),
      gradient('topo', 0, 0, SW, 240, 'down', [[0, SHADE(0.9)], [0.5, SHADE(0.7)], [1, SHADE(0)]]),
      logo(56, 56, 64), ...epLabel(ctx, d.ep, 944, 56, 64), ...items,
    ], [ph.face], notesOf(c), SP_EXTRA);
  }

  // SP-C · Plum com retrato: episódio especial ou série. O retrato é pequeno, então aceita foto de resolução menor.
  function spC(ctx, d, photo) {
    const c = crop(photo, 464, 464, 232, 220, 230, 3);
    const ph = photoLayer(photo, c, 464, 56, 480, 480, { shape: 'circle', inset: 8, bgColor: BRAND.graphite, border: { color: BRAND.lime, width: 8 } });
    const items = [
      fitted(ctx, text('nome', d.guest, 56, 0, 888, 120, { tracking: -0.06, lh: 0.86, color: BRAND.bone, minSize: 64, maxLines: 2 }), 120, 84, 2),
      fitted(ctx, text('texto', d.hook, 56, 0, 888, 52, { font: SERIF, tracking: -0.005, lh: 1.02, color: BRAND.lime, minSize: 46, maxLines: 2 }), 52, 46, 2),
    ];
    stack(ctx, items, SW - 56 - heightOf(ctx, items, 18), 18);
    return finish('SP-C', 'spotify_cover', SW, SW, BRAND.plum, [
      { id: 'pontos', type: 'dots', x: 0, y: 0, w: SW, h: SW, step: 40, r: 3, color: '#3a2663' },
      ph.layer, logo(56, 56, 64, BRAND.bone),
      mono('ep', `EP ${ep3(d.ep)}`, 56, 150, 400, 30, { tracking: 0.08, lh: MONO_LH }), ...items,
    ], [ph.face], notesOf(c), SP_EXTRA);
  }

  // ---------------------------------------------------------------- Reels e cortes 1080×1920 (o grid mostra só y 240–1680)
  const RW = 1080; const RH = 1920;
  const RL_EXTRA = { safe: { l: 80, r: 80, t: 250, b: 240 } };

  // RL-A · Gancho: o título é o gancho do trecho, com a palavra de destaque em lime; logo e rótulo dentro do grid, sobre degradê.
  function rlA(ctx, d, photo) {
    const c = crop(photo, RW, 1100, 540, 600, 380);
    const ph = photoLayer(photo, c, 0, 0, RW, 1100, { filter: { saturate: 0.8, contrast: 1.06 } });
    const { full, marks } = phrase({ pre: d.pre, hl: d.hl, post: d.post });
    const title = fitted(ctx, text('texto', tidy(d.hook) || full, 80, 0, 920, 128, { tracking: -0.05, lh: 0.98, marks: tidy(d.hook) ? hookMarks(d.hook, d.hl) : { words: marks, color: BRAND.lime }, minSize: 96, maxLines: 4 }), 128, 110, 4);
    const sub = tidy(d.sub) ? fitted(ctx, text('apoio', d.sub, 80, 0, 920, 54, { font: SERIF, tracking: -0.005, lh: 1.1, minSize: 48, maxLines: 3 }), 54, 48, 3) : null;
    const name = tidy(d.guest) ? text('nome', d.guest, 80, 0, 920, 40, { tracking: -0.045, lh: 1, role: 'meta', minSize: 28 }) : null;
    const items = [title, sub, name ? rect('filete', 80, 0, 920, 2, BRAND.graphite) : null, name].filter(Boolean);
    const gaps = items.map((l, i) => (items[i + 1] && items[i + 1].id === 'filete' ? 40 : l.id === 'filete' ? 26 : 26));
    const hOf = (l) => (l.type === 'rect' ? l.h : boxOf(ctx, l).h);
    const total = items.reduce((s, l, i) => s + hOf(l) + (i < items.length - 1 ? gaps[i] : 0), 0);
    let y = Math.max(900, 1650 - total);
    items.forEach((l, i) => { l.y = Math.round(y); y += hOf(l) + (gaps[i] || 0); });
    const tag = d.tag ? tagLine(d.tag, 0, 286, 560, 26, { align: 'right', minSize: 20 }) : null;
    if (tag) tag.x = RW - 80 - 560;
    return finish('RL-A', 'reel_cover', RW, RH, INK, [
      ph.layer, gradient('base', 0, 0, RW, 1100, 'up', [[0, INK], [0.4, SHADE(0)]]),
      gradient('topo', 0, 0, RW, 460, 'down', [[0, SHADE(0.9)], [0.66, SHADE(0.85)], [1, SHADE(0)]]),
      logo(80, 270, 64), tag, ...items,
    ], [ph.face], notesOf(c), RL_EXTRA);
  }
  // Marca no gancho a palavra de destaque (a primeira ocorrência), para ela sair em lime.
  function hookMarks(hook, hl) {
    const target = wordsOf(hl).map((w) => w.toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, ''));
    if (!target.length) return { words: [], color: BRAND.lime };
    const ws = wordsOf(hook).map((w) => w.toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, ''));
    for (let i = 0; i + target.length <= ws.length; i += 1) if (target.every((t, k) => ws[i + k] === t)) return { words: target.map((_, k) => i + k), color: BRAND.lime };
    return { words: [], color: BRAND.lime };
  }

  // RL-B · Frase: a frase literal do corte em serifa. Para cortes de opinião.
  function rlB(ctx, d, photo) {
    const c = crop(photo, RW, 1100, 540, 600, 380);
    const ph = photoLayer(photo, c, 0, 0, RW, 1100, { filter: { saturate: 0.8, contrast: 1.06 } });
    const quote = fitted(ctx, text('texto', d.quote, 80, 1180, 920, 112, { font: SERIF, tracking: -0.005, lh: 0.95, minSize: 72, maxLines: 4 }), 112, 84, 3);
    const end = 1180 + boxOf(ctx, quote).h;
    const y0 = Math.max(1520, Math.round(end + 34));
    return finish('RL-B', 'reel_cover', RW, RH, INK, [
      ph.layer, gradient('base', 0, 0, RW, 1100, 'up', [[0, INK], [0.4, SHADE(0)]]),
      gradient('topo', 0, 0, RW, 460, 'down', [[0, SHADE(0.9)], [0.66, SHADE(0.85)], [1, SHADE(0)]]),
      logo(80, 270, 64),
      text('aspas', '“', 66, 1000, 300, 300, { font: SERIF, tracking: 0, lh: 1, color: BRAND.lime, role: 'deco' }),
      quote,
      rect('filete', 80, y0 + (30 * MONO_LH - 3) / 2, 48, 3, BRAND.lime),
      mono('nome', upper(d.guest), 144, y0, 850, 30, { lh: MONO_LH }),
      d.tag ? mono('rotulo', upper(d.tag), 144, y0 + 30 * MONO_LH + 10, 850, 24, { color: BRAND.silver, lh: MONO_LH }) : null,
    ], [ph.face], notesOf(c), RL_EXTRA);
  }

  // RL-C · Tarja central: a mesma copy da thumbnail YT-B, para reaproveitar o texto no corte principal.
  function rlC(ctx, d, photo) {
    const c = crop(photo, RW, RH, 540, 660, 420);
    const ph = photoLayer(photo, c, 0, 0, RW, RH, { filter: { saturate: 0.8, contrast: 1.06 } });
    const pad = { t: 12, r: 34, b: 26, l: 22 };
    const items = [
      tidy(d.pre) ? text('texto', d.pre, 80, 0, 920, 110, { tracking: -0.06, lh: 0.9, minSize: 96, maxLines: 2 }) : null,
      tarja(d.hl, 80, 0, tarjaFit(ctx, d.hl, 150, 96, 920, pad), { pad }),
      tidy(d.post) ? text('fecho', d.post, 80, 0, 920, 110, { tracking: -0.06, lh: 0.9, minSize: 96, maxLines: 2 }) : null,
    ].filter(Boolean);
    stack(ctx, items, Math.min(1130, 1670 - heightOf(ctx, items, 16)), 16);
    const lw = wordmarkWidth(ctx, 56);
    return finish('RL-C', 'reel_cover', RW, RH, INK, [
      ph.layer, gradient('faixas', 0, 0, RW, RH, 'down', [[0, SHADE(0.9)], [0.17, SHADE(0.85)], [0.26, SHADE(0)], [0.46, SHADE(0)], [0.6, SHADE(0.85)], [0.8, INK], [1, INK]]),
      d.tag ? tagLine(d.tag, 80, 276, 700, 28, { minSize: 20 }) : null,
      logo(RW - 80 - lw, 268, 56), ...items,
    ], [ph.face], notesOf(c), RL_EXTRA);
  }

  // ---------------------------------------------------------------- catálogo, limites e conferência
  // fields: o que o modelo lê da ficha. angles: em que ângulo do teste A/B ele entra (YouTube).
  const MODELS = {
    'YT-A': { kind: 'youtube_thumb', name: 'Painel lateral', hint: 'Foto de um lado, frase do outro com uma palavra em lime.', angles: ['curiosidade', 'contraste', 'autoridade'], fields: ['pre', 'hl', 'post'], build: ytA },
    'YT-B': { kind: 'youtube_thumb', name: 'Tarja lime', hint: 'Uma palavra dentro da tarja: o ponto de leitura no celular.', angles: ['curiosidade', 'contraste'], fields: ['pre', 'hl', 'post'], build: ytB },
    'YT-C': { kind: 'youtube_thumb', name: 'Plum dividido', hint: 'Fundo plum e a palavra em serifa gigante. Versão premium.', angles: ['curiosidade'], fields: ['pre', 'hl', 'post'], build: ytC },
    'YT-A+': { kind: 'youtube_thumb', name: 'Credenciais', hint: 'Diz quem é a pessoa antes do nome. A melhor para quem não conhece.', angles: ['autoridade'], fields: ['pre', 'hl', 'post'], build: ytAPlus },
    'YT-D': { kind: 'youtube_thumb', name: 'Número', hint: 'Um número dito no episódio e uma linha curta.', angles: ['autoridade'], fields: ['num', 'line'], build: ytD },
    'YT-E': { kind: 'youtube_thumb', name: 'Close + palavra', hint: 'Rosto grande, frase curta e uma palavra na tarja.', angles: ['curiosidade', 'contraste'], fields: ['setup', 'punch'], build: ytE },
    'YT-F': { kind: 'youtube_thumb', name: 'Frase do convidado', hint: 'Fundo creme e a frase literal. Destaca numa lista escura.', angles: ['contraste'], fields: ['quote'], build: ytF },
    'YT-G': { kind: 'youtube_thumb', name: 'Lime total', hint: 'Episódio especial: no máximo 1 a cada 5.', angles: ['autoridade'], fields: ['pre', 'hl', 'post'], special: true, build: ytG },
    'SP-A': { kind: 'spotify_cover', name: 'Padrão', hint: 'Logo e número no topo, foto, nome e chamada.', fields: ['guest', 'hook'], build: spA },
    'SP-B': { kind: 'spotify_cover', name: 'Foto cheia', hint: 'Nome grande: lê melhor na lista. Pede foto vertical em alta.', fields: ['guest', 'hook'], build: spB },
    'SP-C': { kind: 'spotify_cover', name: 'Plum com retrato', hint: 'Episódio especial ou série. Aceita foto menor.', fields: ['guest', 'hook'], special: true, build: spC },
    'RL-A': { kind: 'reel_cover', name: 'Gancho', hint: 'O gancho do trecho, com uma palavra em lime.', fields: ['hook', 'hl', 'sub'], build: rlA },
    'RL-B': { kind: 'reel_cover', name: 'Frase', hint: 'A frase literal do corte, em serifa. Para cortes de opinião.', fields: ['quote'], build: rlB },
    'RL-C': { kind: 'reel_cover', name: 'Tarja central', hint: 'A mesma copy da thumbnail de tarja.', fields: ['pre', 'hl', 'post'], build: rlC },
  };
  const ANGLES = { curiosidade: 'Curiosidade', contraste: 'Contraste', autoridade: 'Autoridade' };
  const AXES = ['Histórias', 'Negócios', 'Inovação', 'IA'];

  // Limites de cada campo (os do guia). words: palavras; chars: caracteres; letters: letras da palavra.
  const LIMITS = {
    guest: { label: 'Nome como aparece', chars: 40 },
    tag: { label: 'Credencial', words: 8, ideal: 6 }, // o guia pede até 6; até 8 ainda cabe no rótulo (o próprio guia usa uma de 8)
    pre: { label: 'Antes do destaque', words: 4 },
    hl: { label: 'Palavra em destaque', words: 1 },
    post: { label: 'Depois do destaque', words: 3 },
    setup: { label: 'Frase', words: 4 },
    punch: { label: 'Palavra na tarja', words: 1, letters: 9 },
    num: { label: 'Número', chars: 3 },
    line: { label: 'Linha do número', words: 6 },
    quote: { label: 'Frase do convidado', words: 8 },
    hook: { label: 'Chamada', words: 7 },
    sub: { label: 'Apoio', words: 12 },
  };
  // Limites que mudam com a peça: no corte o gancho vai até 9 palavras e a frase até 10.
  const KIND_LIMITS = { reel_cover: { hook: { label: 'Gancho do trecho', words: 9 }, quote: { label: 'Frase do corte', words: 10 }, hl: { label: 'Palavra em destaque', words: 2 } } };
  const limitOf = (field, kind) => (KIND_LIMITS[kind] && KIND_LIMITS[kind][field]) || LIMITS[field];

  // Confere um campo: '' se está dentro, ou a frase do problema.
  function fieldError(field, value, kind) {
    const lim = limitOf(field, kind); const v = tidy(value);
    if (!lim) return '';
    if (lim.words && countWords(v) > lim.words) return `${lim.label}: ${countWords(v)} palavras, o limite é ${lim.words}.`;
    if (lim.chars && [...v].length > lim.chars) return `${lim.label}: ${[...v].length} caracteres, o limite é ${lim.chars}.`;
    if (lim.letters && [...v.replace(/[^\p{L}\p{N}]/gu, '')].length > lim.letters) return `${lim.label}: a palavra tem mais de ${lim.letters} letras.`;
    return '';
  }
  // O que falta ou passa do limite para um modelo sair. [] = pode gerar.
  const GENERIC = /^(q\s*&\s*a|q\s*e\s*a|corte(\s*\d+)?|perguntas e respostas)$/i;
  function problems(modelId, d) {
    const m = MODELS[modelId]; if (!m) return ['Modelo desconhecido.'];
    const out = [];
    const need = (f, msg) => { if (!tidy(d[f])) out.push(msg); };
    if (m.fields.includes('pre')) need('hl', 'Falta a palavra em destaque.'); // no gancho do corte (RL-A) o destaque é opcional
    if (m.fields.includes('setup')) { need('setup', 'Falta a frase.'); need('punch', 'Falta a palavra da tarja.'); }
    if (m.fields.includes('num')) { need('num', 'Este modelo pede um número dito no episódio.'); need('line', 'Falta a linha do número.'); }
    if (m.fields.includes('quote')) need('quote', 'Este modelo pede uma frase literal do convidado.');
    if (m.fields.includes('hook')) need('hook', m.kind === 'reel_cover' ? 'Falta o gancho do trecho.' : 'Falta a chamada.');
    if (m.fields.includes('guest')) need('guest', 'Falta o nome do convidado.');
    for (const f of m.fields) { const e = fieldError(f, d[f], m.kind); if (e) out.push(e); }
    if (m.fields.includes('pre')) { // o texto todo da capa: até 6 palavras (YouTube e tarja do corte)
      const total = countWords(d.pre) + countWords(d.hl) + countWords(d.post);
      if (total > 6 && m.kind === 'youtube_thumb') out.push(`A capa tem ${total} palavras, o limite é 6. Se não cabe, troque de ângulo.`);
    }
    if (m.kind === 'reel_cover' && m.fields.includes('hook') && (GENERIC.test(tidy(d.hook)) || (tidy(d.guest) && tidy(d.hook).toLocaleLowerCase('pt-BR') === tidy(d.guest).toLocaleLowerCase('pt-BR')))) out.push('Diga o gancho do trecho: "Q&A", "Corte" ou só o nome não contam o que o vídeo entrega.');
    if (d.tag && fieldError('tag', d.tag)) out.push(fieldError('tag', d.tag));
    return out;
  }

  // Teste de redução: a peça é lida a 168 px (YouTube)? Vale o tamanho do destaque e o total de palavras.
  function reads(spec) {
    if (spec.format !== 'youtube_thumb') return null;
    const main = (spec.layers || []).filter((l) => (l.type === 'tarja' || (l.type === 'text' && (l.role || 'main') === 'main')));
    const hl = main.find((l) => l.id === 'destaque') || main.find((l) => l.marks && l.marks.words.length) || main.slice().sort((a, b) => b.size - a.size)[0];
    const total = main.reduce((s, l) => s + countWords(l.text), 0);
    return Boolean(hl) && hl.size >= 84 && total <= (spec.model === 'YT-D' ? 7 : 6); // no modelo de número, o número conta à parte
  }

  // Monta a peça. Devolve { spec, ctxData, notes, warnings } ou { error: [..] } quando a ficha não deixa.
  function build(ctx, modelId, data, photo, opts = {}) {
    const errs = problems(modelId, data);
    if (errs.length) return { error: errs };
    const out = MODELS[modelId].build(ctx, data, photo, opts);
    out.spec.sheet = Object.fromEntries(['guest', 'tag', 'ep', 'axis', 'pre', 'hl', 'post', 'setup', 'punch', 'num', 'line', 'quote', 'hook', 'sub', 'creds'].filter((k) => data[k] != null && data[k] !== '').map((k) => [k, data[k]]));
    if (opts.flip) out.spec.flip = true;
    if (opts.angle) out.spec.angle = opts.angle;
    out.warnings = [];
    if (out.notes.soft) out.warnings.push(`Foto ampliada ${String(out.notes.zoom).replace('.', ',')}×: fica sem nitidez. Troque por uma foto maior.`);
    if (!photo) out.warnings.push('Sem foto: escolha um quadro ou uma foto da gravação.');
    return out;
  }
  const modelsFor = (kind, angle = null) => Object.keys(MODELS).filter((id) => MODELS[id].kind === kind && (!angle || !MODELS[id].angles || MODELS[id].angles.includes(angle)));

  // ---------------------------------------------------------------- editor completo (a capa já montada, mexida à mão)
  const DEFAULT_FACE = { x: 0.5, y: 0.38, h: 0.25 }; // o mesmo que o recorte usa quando a foto não tem rosto lido
  // O rosto de um quadro (centro e altura de 0 a 1): a marcação feita à mão, senão o maior rosto da análise; null = não achou.
  function faceOf(rostos, manual = null) {
    if (manual && [manual.x, manual.y, manual.h].every(Number.isFinite)) return { x: manual.x, y: manual.y, h: manual.h };
    const r = (rostos || []).slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
    return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2, h: r.h } : null;
  }
  // As zonas de rosto de um desenho pronto: a mesma elipse (+40 px) que o modelo marca, seguindo o zoom, o enquadramento e o
  // espelho que a pessoa deu à foto no editor. info(ref) -> { face } ou null.
  function facesOf(spec, info) {
    const out = [];
    for (const l of spec.layers || []) {
      if (l.type !== 'photo' || l.hidden || !l.ref || !l.img) continue;
      const f = (info(l.ref) || {}).face || DEFAULT_FACE;
      const fx = l.mirror ? 1 - f.x : f.x;
      const eh = f.h * l.img.h * 1.12; const ew = eh * 0.74;
      out.push({ ...E.grow({ x: l.x + l.img.x + fx * l.img.w - ew / 2, y: l.y + l.img.y + f.y * l.img.h - eh / 2, w: ew, h: eh }, 36), oval: true });
    }
    return out;
  }
  // Quanto a foto está ampliada no painel. zoom: 1 = o mínimo que cobre o painel; real: a ampliação do arquivo (exp = 3 no Spotify).
  function photoScale(layer, photo, exp = 1) {
    const min = Math.max(layer.w / photo.w, layer.h / photo.h);
    const s = layer.img.w / photo.w;
    return { zoom: s / min, min, s, real: s * exp, soft: Math.round(s * exp * 10) / 10 > MAX_ZOOM };
  }
  // Põe a foto no painel com escala s e canto (x, y), dentro dos limites do recorte: ela sempre cobre o painel dos lados e embaixo,
  // e no alto pode começar até 22% abaixo (a borda some no fundo, como no guia). Devolve { img, fade }.
  function placePhoto(layer, photo, { s, x, y }) {
    const scale = Math.max(s, Math.max(layer.w / photo.w, layer.h / photo.h));
    const w = photo.w * scale; const h = photo.h * scale;
    const cx = Math.min(0, Math.max(layer.w - w, x)); const cy = Math.min(layer.h * 0.22, Math.max(layer.h - h, y));
    return { img: { x: Math.round(cx), y: Math.round(cy), w: Math.round(w), h: Math.round(h) }, fade: cy > 1 ? Math.round(Math.min(h * 0.16, 240)) : 0 };
  }

  // As peças de desenho, para quem monta outras cenas com as mesmas medidas (os vídeos do convidado: services/videoScenes.js).
  const parts = { text, mono, logo, rect, gradient, tarja, photoLayer, stack, heightOf, fitted, boxOf, wordmarkWidth, tarjaFit, epLabel, upper, MONO_LH, SHADE };
  return { MODELS, ANGLES, AXES, LIMITS, KIND_LIMITS, MAX_ZOOM, DEFAULT_FACE, limitOf, fieldError, problems, build, crop, reads, modelsFor, countWords, wordsOf, tidy, ep3, hookMarks, faceOf, facesOf, photoScale, placePhoto, parts };
}));
