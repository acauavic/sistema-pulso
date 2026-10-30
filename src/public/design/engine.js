/* Motor de capas do Pulso (Canvas 2D). O MESMO arquivo roda no servidor (@napi-rs/canvas) e no editor do navegador:
   o que se vê no editor é o que o servidor renderiza. Tudo em pixels do canvas de design (ex.: 1080×1920).
   - FORMATS: tamanhos e zonas seguras de cada formato (Reels/TikTok/grade do Instagram, YouTube).
   - autoLayout: escolhe onde o texto cabe SEM cobrir rosto nem legenda já queimada no vídeo, dentro da zona segura.
   - render: desenha um "spec" (fundo + faixa de contraste + camadas).
   - lint: confere o resultado (rosto coberto, fora da zona segura, texto pequeno, contraste, palavra cortada). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PulsoDesign = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const BRAND = {
    lime: '#C8FF42', black: '#0A0A0A', plum: '#2D1B4E', white: '#FAFAFA', bone: '#F0EDE3', graphite: '#1F1F1F', steel: '#6B6B6B', silver: '#B5B5B5',
  };
  const FONTS = {
    display: { family: 'Space Grotesk', weight: 700, italic: false },
    voice: { family: 'Instrument Serif', weight: 400, italic: true },
    body: { family: 'Inter', weight: 500, italic: false },
    mono: { family: 'JetBrains Mono', weight: 500, italic: false },
  };

  // Zonas seguras (px). `safe` = onde o texto pode ficar; `avoid` = retângulos que as plataformas cobrem.
  //  - reel_cover: o Instagram mostra a capa na grade recortada em 3:4 (faixa central 1080×1440 = y 240–1680); com folga, y 300–1620.
  //  - youtube_thumb: a duração do vídeo cobre o canto inferior direito; ~12% de borda é cortada em telas pequenas.
  const FORMATS = {
    youtube_thumb: { label: 'Thumbnail do YouTube', w: 1280, h: 720, safe: { l: 64, r: 64, t: 44, b: 52 }, avoid: [{ x: 1280 - 230, y: 720 - 110, w: 230, h: 110, why: 'duração do vídeo' }], maxLines: 2, kind: 'thumb' },
    reel_cover: { label: 'Capa de Reels/TikTok (9:16)', w: 1080, h: 1920, safe: { l: 72, r: 72, t: 300, b: 300 }, avoid: [], maxLines: 4, kind: 'cover', crop34: { y: 240, h: 1440 } },
    post_4x5: { label: 'Post 4:5', w: 1080, h: 1350, safe: { l: 72, r: 72, t: 84, b: 96 }, avoid: [], maxLines: 6, kind: 'quote' },
    post_split: { label: 'Post de tela dividida 4:5', w: 1080, h: 1350, safe: { l: 72, r: 72, t: 40, b: 40 }, avoid: [], maxLines: 4, kind: 'quote' },
  };

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const fontString = (f, size) => `${f.italic ? 'italic ' : ''}${f.weight || 400} ${Math.round(size * 100) / 100}px "${f.family}"`;

  // ---------------------------------------------------------------- texto
  function setFont(ctx, f, size, tracking = 0) {
    ctx.font = fontString(f, size);
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${(tracking * size).toFixed(2)}px`;
  }

  // Quebra por palavras (nunca no meio da palavra). Respeita \n do usuário. { lines, overflow } — overflow = uma palavra sozinha não cabe.
  function wrap(ctx, text, maxWidth) {
    const lines = []; let overflow = false;
    for (const para of String(text).split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(''); continue; }
      let line = words[0];
      if (ctx.measureText(line).width > maxWidth) overflow = true;
      for (let i = 1; i < words.length; i += 1) {
        const test = `${line} ${words[i]}`;
        if (ctx.measureText(test).width <= maxWidth) line = test;
        else { lines.push(line); line = words[i]; if (ctx.measureText(line).width > maxWidth) overflow = true; }
      }
      lines.push(line);
    }
    return { lines, overflow };
  }

  // Palavras que não devem terminar uma linha (ficam coladas à seguinte): artigos, preposições, conjunções, "sem", "não"…
  const DANGLING = new Set(['a', 'o', 'as', 'os', 'um', 'uma', 'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas', 'e', 'ou', 'que', 'por', 'para', 'pra', 'com', 'sem', 'ao', 'à', 'se', 'sua', 'seu', 'não', 'mais', 'muito', 'já', 'me', 'te']);
  const bare = (w) => w.toLowerCase().replace(/[^\p{L}]/gu, '');

  // Quebra de linhas com critério editorial: usa o MENOR número de linhas possível e, entre as quebras que cabem, escolhe a de
  // linhas mais parecidas, prefere quebrar depois de vírgula/ponto e nunca deixa artigo/preposição pendurado no fim nem palavra sozinha na última linha.
  function balance(ctx, text, maxWidth, maxLines) {
    const base = wrap(ctx, text, maxWidth);
    if (base.overflow || base.lines.length <= 1 || /\n/.test(text)) return base;
    const words = String(text).split(/\s+/).filter(Boolean);
    const n = words.length; const k = base.lines.length;
    if (n > 22 || k > 6) return base;
    const w = words.map((x) => ctx.measureText(x).width);
    const space = ctx.measureText(' ').width;
    const lineWidth = (i, j) => { let t = 0; for (let q = i; q < j; q += 1) t += w[q]; return t + space * (j - i - 1); };
    let best = null;
    const cuts = [];
    (function search(start, left) {
      if (left === 1) {
        const ends = [...cuts, n]; const starts = [0, ...cuts];
        const widths = ends.map((e, i) => lineWidth(starts[i], e));
        if (widths.some((x) => x > maxWidth)) return;
        const avg = widths.reduce((s2, x) => s2 + x, 0) / widths.length;
        let cost = widths.reduce((s2, x) => s2 + ((x - avg) / maxWidth) ** 2, 0) * 4;
        ends.slice(0, -1).forEach((e) => {
          const last = words[e - 1];
          if (DANGLING.has(bare(last))) cost += 1.2;
          if (/[,.;:!?]$/.test(last)) cost -= 0.6;
        });
        const lastLineWords = n - starts[starts.length - 1];
        if (k > 1 && lastLineWords === 1 && bare(words[n - 1]).length <= 4) cost += 0.8;
        if (!best || cost < best.cost) best = { cost, starts, ends };
        return;
      }
      for (let c = start + 1; c <= n - left + 1; c += 1) { cuts.push(c); search(c, left - 1); cuts.pop(); }
    }(0, k));
    if (!best) return base;
    return { lines: best.ends.map((e, i) => words.slice(best.starts[i], e).join(' ')), overflow: false };
  }

  // Maior tamanho de fonte (entre min e max) em que o texto cabe na caixa. { size, lines, width, height, fits }
  function fitText(ctx, text, { w, h, font, maxSize, minSize, lineHeight = 1.05, tracking = 0, maxLines = 4, upper = false }) {
    const t = upper ? String(text).toUpperCase() : String(text);
    let size = maxSize;
    for (; size >= minSize; size -= 2) {
      setFont(ctx, font, size, tracking);
      const { lines, overflow } = balance(ctx, t, w, maxLines);
      const height = lines.length * size * lineHeight;
      if (!overflow && lines.length <= maxLines && height <= h) {
        return { size, lines, width: Math.max(...lines.map((l) => ctx.measureText(l).width)), height, fits: true };
      }
    }
    setFont(ctx, font, minSize, tracking);
    const { lines } = wrap(ctx, t, w);
    return { size: minSize, lines, width: Math.max(...lines.map((l) => ctx.measureText(l).width)), height: lines.length * minSize * lineHeight, fits: false };
  }

  // ---------------------------------------------------------------- geometria
  const overlap = (a, b) => {
    const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return x * y;
  };
  const grow = (r, m) => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });

  // ---- girar e espelhar o fundo (bg.rot: 0/90/180/270 no sentido horário; bg.flipX/flipY). Primeiro espelha, depois gira.
  const rotOf = (bg) => ((Math.round((bg?.rot || 0) / 90) * 90) % 360 + 360) % 360;
  // Tamanho da imagem já girada (90/270 trocam largura e altura).
  const orientedSize = (img, bg) => { const r = rotOf(bg); return r === 90 || r === 270 ? { w: img.h, h: img.w } : { w: img.w, h: img.h }; };
  // Caixa normalizada (0–1) do quadro original -> a mesma caixa na imagem espelhada/girada.
  function orientBox(box, bg) {
    let { x, y, w, h } = box;
    if (bg?.flipX) x = 1 - x - w;
    if (bg?.flipY) y = 1 - y - h;
    const r = rotOf(bg);
    if (r === 90) return { x: 1 - y - h, y: x, w: h, h: w };
    if (r === 180) return { x: 1 - x - w, y: 1 - y - h, w, h };
    if (r === 270) return { x: y, y: 1 - x - w, w: h, h: w };
    return { x, y, w, h };
  }
  // Ajustes da foto como filtro de canvas (o mesmo no navegador e no servidor).
  function photoFilter(bg, scale = 1) {
    const a = bg?.adjust; if (!a) return 'none';
    const parts = [];
    if (a.brightness != null && a.brightness !== 1) parts.push(`brightness(${a.brightness})`);
    if (a.contrast != null && a.contrast !== 1) parts.push(`contrast(${a.contrast})`);
    if (a.saturate != null && a.saturate !== 1) parts.push(`saturate(${a.saturate})`);
    if (a.blur) parts.push(`blur(${Math.round(a.blur * scale * 10) / 10}px)`);
    return parts.length ? parts.join(' ') : 'none';
  }
  // Desenha a imagem (espelhada, girada, com ajustes) no retângulo (x, y, w, h) já calculado para a imagem girada.
  function drawOriented(ctx, im, bg, x, y, w, h) {
    const r = rotOf(bg); const f = photoFilter(bg, Math.max(w, h) / 1080);
    ctx.save();
    if (f !== 'none') ctx.filter = f;
    ctx.translate(x + w / 2, y + h / 2); ctx.rotate((r * Math.PI) / 180); ctx.scale(bg?.flipX ? -1 : 1, bg?.flipY ? -1 : 1);
    const [dw, dh] = r === 90 || r === 270 ? [h, w] : [w, h];
    ctx.drawImage(im, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  // Leva uma caixa normalizada (0–1) do quadro original para o canvas, conforme o enquadramento do fundo (e o giro/espelho).
  function mapBox(box, img, bg, W, H) {
    const o = orientBox(box, bg); const sz = orientedSize(img, bg);
    const t = bgTransform(img, bg, W, H);
    return { x: t.dx + o.x * sz.w * t.s, y: t.dy + o.y * sz.h * t.s, w: o.w * sz.w * t.s, h: o.h * sz.h * t.s };
  }

  // Como a imagem é posicionada no canvas: cover (zoom e foco ajustáveis) ou "contain" (cabe inteira).
  function bgTransform(img0, bg, W, H) {
    const img = orientedSize(img0, bg);
    const zoom = bg?.zoom || 1;
    const fit = bg?.fit === 'contain' ? Math.min(W / img.w, H / img.h) : Math.max(W / img.w, H / img.h);
    const s = fit * zoom;
    const iw = img.w * s; const ih = img.h * s;
    if (bg?.fit === 'contain') { // o quadro inteiro, encostado num lado (o resto do canvas é fundo desfocado)
      const dx0 = bg.align === 'left' ? 0 : bg.align === 'right' ? W - iw : (W - iw) / 2;
      return { s, dx: dx0, dy: (H - ih) / 2, iw, ih };
    }
    const cx = bg?.cx ?? 0.5; const cy = bg?.cy ?? 0.5;
    const dx = clamp(W / 2 - cx * iw, Math.min(0, W - iw), Math.max(0, W - iw));
    const dy = clamp(H / 2 - cy * ih, Math.min(0, H - ih), Math.max(0, H - ih));
    return { s, dx, dy, iw, ih };
  }

  const visibleArea = (r, W, H) => Math.max(0, Math.min(r.x + r.w, W) - Math.max(r.x, 0)) * Math.max(0, Math.min(r.y + r.h, H) - Math.max(r.y, 0));

  // Enquadramentos candidatos (geometria pura, sem renderizar): zoom, onde fica o rosto principal, e "quadro inteiro de um lado".
  function framings(img, faces, W, H, { zooms = [1, 1.15, 1.3, 1.5], faceAts = [0.3, 0.5, 0.7], faceYs = [0.34, 0.42], contain = false } = {}) {
    const out = [];
    const f = (faces || []).slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
    const base = Math.max(W / img.w, H / img.h);
    for (const zoom of zooms) {
      const s = base * zoom; const iw = img.w * s; const ih = img.h * s;
      if (!f) { out.push({ kind: 'frame', fit: 'cover', zoom, cx: 0.5, cy: 0.5 }); continue; }
      if (zoom > 1) { // ancorado no topo ou na base: empurra o que está embaixo (ou em cima) para fora do quadro
        const half = H / (2 * ih);
        for (const at of faceAts) {
          const cx = clamp(((f.x + f.w / 2) * iw - (at * W - W / 2)) / iw, 0, 1);
          out.push({ kind: 'frame', fit: 'cover', zoom, cx, cy: clamp(half, 0, 1) }, { kind: 'frame', fit: 'cover', zoom, cx, cy: clamp(1 - half, 0, 1) });
        }
      }
      for (const at of faceAts) for (const fy of faceYs) {
        const fcx = (f.x + f.w / 2) * iw; const fcy = (f.y + f.h / 2) * ih;
        out.push({ kind: 'frame', fit: 'cover', zoom, cx: clamp((fcx - (at * W - W / 2)) / iw, 0, 1), cy: clamp((fcy - (fy * H - H / 2)) / ih, 0, 1) });
      }
    }
    if (contain) for (const align of ['right', 'left']) out.push({ kind: 'frame', fit: 'contain', zoom: 1, align, cx: 0.5, cy: 0.5 });
    return out;
  }

  // Acha um lugar para um retângulo pequeno (rótulo, logotipo) que não toque nos obstáculos; tenta as âncoras na ordem.
  function placeSmall(size, anchors, obstacles, bounds) {
    for (const a of anchors) {
      const r = { x: a.x, y: a.y, w: size.w, h: size.h };
      if (r.x < bounds.x || r.y < bounds.y || r.x + r.w > bounds.x + bounds.w || r.y + r.h > bounds.y + bounds.h) continue;
      if (!obstacles.some((o) => overlap(grow(r, 10), o) > 0)) return { x: a.x, y: a.y, ok: true };
    }
    // nenhum canto serve: varre a área inteira e fica com o lugar livre mais perto do primeiro canto desejado
    let best = null;
    for (let y = bounds.y; y + size.h <= bounds.y + bounds.h; y += 24) {
      for (let x = bounds.x; x + size.w <= bounds.x + bounds.w; x += 24) {
        const r = { x, y, w: size.w, h: size.h };
        if (obstacles.some((o) => overlap(grow(r, 10), o) > 0)) continue;
        const d = Math.hypot(x - anchors[0].x, y - anchors[0].y);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    if (best) return { x: best.x, y: best.y, ok: true };
    return { x: anchors[0].x, y: anchors[0].y, ok: false };
  }

  // Faixas livres ao longo de um eixo, depois de tirar os obstáculos. axis 'y': faixas horizontais (texto de largura total).
  function freeBands(axis, area, obstacles, margin = 0) {
    const start = axis === 'y' ? area.y : area.x; const end = start + (axis === 'y' ? area.h : area.w);
    const blocks = obstacles.map((o) => grow(o, margin)).map((o) => (axis === 'y' ? [o.y, o.y + o.h] : [o.x, o.x + o.w]))
      .map(([a, b]) => [Math.max(start, a), Math.min(end, b)]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
    const bands = []; let cur = start;
    for (const [a, b] of blocks) { if (a > cur) bands.push([cur, a]); cur = Math.max(cur, b); }
    if (cur < end) bands.push([cur, end]);
    return bands.map(([a, b]) => (axis === 'y' ? { x: area.x, y: a, w: area.w, h: b - a } : { x: a, y: area.y, w: b - a, h: area.h }));
  }

  // ---------------------------------------------------------------- layout automático
  // Maiores retângulos livres dentro de `area`, descontados os obstáculos (algoritmo do histograma sobre uma grade).
  function emptyRects(area, obstacles, { cell = 12, minW = 0, minH = 0, top = 10 } = {}) {
    const cols = Math.max(1, Math.floor(area.w / cell)); const rows = Math.max(1, Math.floor(area.h / cell));
    const blocked = Array.from({ length: rows }, () => new Uint8Array(cols));
    for (const o of obstacles) {
      const c0 = Math.max(0, Math.floor((o.x - area.x) / cell)); const c1 = Math.min(cols - 1, Math.ceil((o.x + o.w - area.x) / cell) - 1);
      const r0 = Math.max(0, Math.floor((o.y - area.y) / cell)); const r1 = Math.min(rows - 1, Math.ceil((o.y + o.h - area.y) / cell) - 1);
      for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) blocked[r][c] = 1;
    }
    const found = []; const heights = new Array(cols).fill(0);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) heights[c] = blocked[r][c] ? 0 : heights[c] + 1;
      const stack = [];
      for (let c = 0; c <= cols; c += 1) {
        const h = c === cols ? 0 : heights[c]; let start = c;
        while (stack.length && stack[stack.length - 1].h >= h) {
          const t = stack.pop(); start = t.start;
          if (t.h > 0) found.push({ x: area.x + t.start * cell, y: area.y + (r - t.h + 1) * cell, w: (c - t.start) * cell, h: t.h * cell });
        }
        stack.push({ start, h });
      }
    }
    const good = found.filter((f) => f.w >= minW && f.h >= minH).sort((p, q) => q.w * q.h - p.w * p.h);
    const kept = [];
    for (const f of good) {
      if (kept.some((k) => overlap(k, f) / Math.min(k.w * k.h, f.w * f.h) > 0.6)) continue;
      kept.push(f); if (kept.length >= top) break;
    }
    return kept;
  }

  // ctx só mede texto. `faces` e `blocks` (legendas queimadas) já em pixels do canvas. Devolve a camada de texto e a leitura do espaço.
  function autoText(ctx, fmt, text, { faces = [], blocks = [], extra = [], style = {}, prefer = 'auto' } = {}) {
    const F = typeof fmt === 'string' ? FORMATS[fmt] : fmt;
    const safe = { x: F.safe.l, y: F.safe.t, w: F.w - F.safe.l - F.safe.r, h: F.h - F.safe.t - F.safe.b };
    const obstacles = [...faces.map((f) => grow(f, Math.min(F.w, F.h) * 0.02)), ...blocks.map((b) => grow(b, 6)), ...extra.map((r) => grow(r, 28)), ...(F.avoid || [])];
    const kind = F.kind;
    const font = style.font || (kind === 'quote' ? FONTS.voice : FONTS.display);
    const cfg = {
      thumb: { maxSize: 168, minSize: 84, lineHeight: 0.98, tracking: -0.035 },
      cover: { maxSize: 132, minSize: 72, lineHeight: 1.02, tracking: -0.03 },
      quote: { maxSize: 92, minSize: 48, lineHeight: 1.1, tracking: -0.005 },
    }[kind];
    const opts = { font, ...cfg, ...style, maxLines: style.maxLines || F.maxLines };
    const pad = Math.round(F.w * 0.012);
    const landscape = F.w > F.h;
    const maxTextW = landscape ? F.w * (kind === 'thumb' ? 0.52 : 0.6) : safe.w;

    let rects = emptyRects(safe, obstacles, { minW: Math.min(safe.w, F.w * 0.2), minH: Math.min(safe.h, F.h * 0.07), top: 12 });
    let degraded = false;
    if (!rects.length) { rects = [safe]; degraded = true; } // sem espaço limpo: usa a zona segura e o verificador avisa

    const mainFace = faces.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
    const scored = rects.map((r) => {
      const w = Math.min(r.w, maxTextW);
      const fit = fitText(ctx, text, { ...opts, w, h: Math.min(r.h, landscape ? r.h : F.h * 0.4) });
      let bonus = 0;
      if (mainFace && landscape) { // texto do lado oposto ao rosto principal
        const side = (r.x + w / 2) - (mainFace.x + mainFace.w / 2);
        bonus = (side * (mainFace.x + mainFace.w / 2 < F.w / 2 ? 1 : -1)) / F.w * 300;
      }
      if (!landscape) bonus = prefer === 'top' ? -(r.y - safe.y) / F.h * 300 : ((r.y + r.h) / F.h) * 120; // mais para baixo lê melhor
      return { r, w, fit, score: fit.size * fit.size / 100 * (fit.fits ? 1 : 0.4) + bonus };
    }).sort((a, b) => b.score - a.score);
    const { r, w, fit } = scored[0];

    let x = r.x; let y;
    if (landscape && mainFace && mainFace.x + mainFace.w / 2 < F.w / 2) x = r.x + Math.max(0, r.w - w); // rosto à esquerda: texto encostado à direita
    x = clamp(x, safe.x, safe.x + safe.w - Math.min(w, fit.width + 4));
    y = r.y + (r.h - fit.height) / 2;
    if (!landscape && prefer !== 'top') y = r.y + r.h - fit.height - pad; // encosta no fim da faixa livre
    y = clamp(y, r.y, Math.max(r.y, r.y + r.h - fit.height));
    return {
      layer: {
        id: 'texto', type: 'text', role: 'main', text, x: Math.round(x), y: Math.round(y), w: Math.round(w),
        size: fit.size, font: { ...font }, color: style.color || BRAND.white, align: style.align || 'left', lineHeight: opts.lineHeight, tracking: opts.tracking,
        upper: !!style.upper, shadow: style.shadow ?? 0.5, highlight: style.highlight || null,
      },
      fit, region: r, degraded, safe,
    };
  }

  // ---------------------------------------------------------------- renderização
  const luminance = (r, g, b) => {
    const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const hexToRgb = (hex) => { const m = String(hex).replace('#', ''); const n = parseInt(m.length === 3 ? m.replace(/./g, '$&$&') : m, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const contrast = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

  function layerBox(ctx, layer) {
    if (layer.type === 'text') {
      const text = layer.upper ? String(layer.text).toUpperCase() : String(layer.text);
      setFont(ctx, layer.font, layer.size, layer.tracking || 0);
      const { lines } = balance(ctx, text, layer.w, 99);
      const widths = lines.map((l) => ctx.measureText(l).width);
      const w = Math.max(0, ...widths); const h = lines.length * layer.size * (layer.lineHeight || 1.05);
      const x = layer.align === 'center' ? layer.x + (layer.w - w) / 2 : layer.align === 'right' ? layer.x + layer.w - w : layer.x;
      return { x, y: layer.y, w, h, lines, widths };
    }
    if (layer.type === 'wordmark') {
      setFont(ctx, FONTS.display, layer.size, -0.06);
      const w = ctx.measureText('pulso.').width;
      return { x: layer.x, y: layer.y, w, h: layer.size * 0.9 };
    }
    if (layer.type === 'rect') return { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
    if (layer.type === 'arrow') return { x: layer.x, y: layer.y, w: layer.size, h: layer.size };
    return { x: layer.x || 0, y: layer.y || 0, w: layer.w || 0, h: layer.h || 0 };
  }

  function drawText(ctx, layer) {
    const box = layerBox(ctx, layer);
    if (layer.chip) { // fundo escuro translúcido: garante leitura de rótulos pequenos sobre qualquer imagem
      const padX = layer.chip.padX ?? 14; const padY = layer.chip.padY ?? 8;
      ctx.fillStyle = layer.chip.color || 'rgba(10,10,10,0.62)';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(box.x - padX, box.y - padY, box.w + 2 * padX, box.h + 2 * padY, layer.chip.radius ?? 8); ctx.fill(); } else ctx.fillRect(box.x - padX, box.y - padY, box.w + 2 * padX, box.h + 2 * padY);
    }
    setFont(ctx, layer.font, layer.size, layer.tracking || 0);
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    const lh = layer.size * (layer.lineHeight || 1.05);
    const hl = layer.highlight; // { color, lines: 'last' | n } -> destaca a última linha (um único elemento lime por peça)
    box.lines.forEach((line, i) => {
      const lineW = box.widths[i];
      const x = layer.align === 'center' ? layer.x + (layer.w - lineW) / 2 : layer.align === 'right' ? layer.x + layer.w - lineW : layer.x;
      const y = layer.y + i * lh + (lh - layer.size) / 2 - layer.size * 0.08;
      const isHl = hl && (hl.lines === 'last' ? i === box.lines.length - 1 : hl.lines === i);
      const fill = isHl ? hl.color : layer.color;
      const strokeW = layer.stroke && layer.stroke.width > 0 ? layer.stroke.width * layer.size : 0;
      const withShadow = (fn) => {
        if (!layer.shadow) { fn(); return; }
        ctx.save(); ctx.shadowColor = `rgba(0,0,0,${0.55 * layer.shadow})`; ctx.shadowBlur = layer.size * 0.12 * layer.shadow;
        if (layer.shadowAngle == null) ctx.shadowOffsetY = layer.size * 0.025 * layer.shadow; // sombra clássica, um pouco abaixo
        else { // direção escolhida (graus: 0 = direita, 90 = baixo) e distância (0 = brilho em volta)
          const d = layer.size * 0.1 * (layer.shadowDistance ?? 0.4); const rad = (layer.shadowAngle * Math.PI) / 180;
          ctx.shadowOffsetX = Math.cos(rad) * d; ctx.shadowOffsetY = Math.sin(rad) * d;
        }
        fn(); ctx.restore();
      };
      if (strokeW) { // contorno: desenhado antes (com a sombra) e o preenchimento por cima, limpo
        withShadow(() => { ctx.lineJoin = 'round'; ctx.miterLimit = 2; ctx.lineWidth = strokeW * 2; ctx.strokeStyle = layer.stroke.color || BRAND.black; ctx.strokeText(line, x, y); });
        ctx.fillStyle = fill; ctx.fillText(line, x, y);
      } else withShadow(() => { ctx.fillStyle = fill; ctx.fillText(line, x, y); });
    });
    return box;
  }

  // Desfoque barato e igual nos dois ambientes: reduz e amplia com suavização.
  function drawBlurredCover(ctx, img, W, H, makeCanvas) {
    const small = makeCanvas(Math.max(8, Math.round(W / 24)), Math.max(8, Math.round(H / 24)));
    const sctx = small.getContext('2d'); sctx.imageSmoothingEnabled = true;
    const s = Math.max(small.width / img.width, small.height / img.height);
    sctx.drawImage(img, (small.width - img.width * s) / 2, (small.height - img.height * s) / 2, img.width * s, img.height * s);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, W, H);
  }

  function drawBackground(ctx, spec, images, makeCanvas) {
    const { width: W, height: H } = spec;
    const bg = spec.bg || { kind: 'solid', color: BRAND.black };
    if (bg.kind === 'solid') { ctx.fillStyle = bg.color || BRAND.black; ctx.fillRect(0, 0, W, H); return; }
    if (bg.kind === 'panels') { // vários quadros em retângulos (tela dividida)
      ctx.fillStyle = BRAND.black; ctx.fillRect(0, 0, W, H);
      for (const p of bg.panels) {
        const im = images[p.ref]; if (!im) continue;
        ctx.save(); ctx.beginPath(); ctx.rect(p.rect.x, p.rect.y, p.rect.w, p.rect.h); ctx.clip();
        if (p.bg?.fit === 'contain') { // quadro vertical num painel largo: ele inteiro de um lado, degradê da marca no resto
          const g = ctx.createLinearGradient(p.rect.x + (p.bg.align === 'left' ? p.rect.w : 0), p.rect.y, p.rect.x + (p.bg.align === 'left' ? 0 : p.rect.w), p.rect.y + p.rect.h);
          g.addColorStop(0, BRAND.black); g.addColorStop(1, BRAND.plum);
          ctx.fillStyle = g; ctx.fillRect(p.rect.x, p.rect.y, p.rect.w, p.rect.h);
        }
        const t = bgTransform({ w: im.width, h: im.height }, p.bg, p.rect.w, p.rect.h);
        drawOriented(ctx, im, p.bg, p.rect.x + t.dx, p.rect.y + t.dy, t.iw, t.ih);
        ctx.restore();
      }
      return;
    }
    const img = images[bg.ref];
    ctx.fillStyle = BRAND.black; ctx.fillRect(0, 0, W, H);
    if (!img) return;
    const size = { w: img.width, h: img.height };
    if (bg.fit === 'contain') { // o quadro inteiro de um lado; o resto é um degradê da marca (preto → plum), sem "rosto fantasma"
      const g = ctx.createLinearGradient(bg.align === 'left' ? W : 0, 0, bg.align === 'left' ? 0 : W, H);
      g.addColorStop(0, BRAND.black); g.addColorStop(1, BRAND.plum);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    const t = bgTransform(size, bg, W, H);
    drawOriented(ctx, img, bg, t.dx, t.dy, t.iw, t.ih);
  }

  function drawScrims(ctx, spec) {
    const { width: W, height: H } = spec;
    for (const s of spec.scrims || []) {
      if (s.side === 'spot') { // escurecimento suave e elíptico atrás de um texto, sem "caixa" visível
        const cx = s.rect.x + s.rect.w / 2; const cy = s.rect.y + s.rect.h / 2; const rw = s.rect.w * 0.78; const rh = s.rect.h * 0.9 + 40;
        ctx.save(); ctx.translate(cx, cy); ctx.scale(rw, rh);
        const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        const a2 = clamp(s.strength ?? 0.55, 0, 0.9);
        rg.addColorStop(0, `rgba(10,10,10,${a2})`); rg.addColorStop(0.55, `rgba(10,10,10,${a2 * 0.8})`); rg.addColorStop(1, 'rgba(10,10,10,0)');
        ctx.fillStyle = rg; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
        continue;
      }
      if (s.side === 'patch') { // faixa escura com borda suave: esconde uma legenda queimada atrás de um texto novo
        const a = clamp(s.strength ?? 0.95, 0, 1); const f = s.feather ?? 26; const N = 10; let cum = 0;
        for (let i = N; i >= 1; i -= 1) { // de fora para dentro; o alfa acumulado sobe até `a` no miolo
          const target = a * ((N - i + 1) / N); const layerA = (target - cum) / (1 - cum || 1); cum = target;
          const g = (f * i) / N;
          ctx.fillStyle = `rgba(10,10,10,${clamp(layerA, 0, 1).toFixed(4)})`;
          ctx.fillRect(s.rect.x - g, s.rect.y - g, s.rect.w + 2 * g, s.rect.h + 2 * g);
        }
        continue;
      }
      if (s.side === 'panel') { // faixa escura que sobe com degradê: cobre o que estiver abaixo (ex.: legenda queimada) e dá fundo à frase
        const pa = clamp(s.strength ?? 0.94, 0, 1); const fade = s.fade || 60;
        const pg = ctx.createLinearGradient(0, s.y - fade, 0, s.y);
        pg.addColorStop(0, 'rgba(10,10,10,0)'); pg.addColorStop(1, `rgba(10,10,10,${pa})`);
        ctx.fillStyle = pg; ctx.fillRect(0, s.y - fade, W, fade);
        ctx.fillStyle = `rgba(10,10,10,${pa})`; ctx.fillRect(0, s.y, W, H - s.y);
        continue;
      }
      const a = clamp(s.strength ?? 0.5, 0, 0.92);
      let g;
      if (s.side === 'bottom') { g = ctx.createLinearGradient(0, H, 0, H - H * (s.size || 0.5)); } else if (s.side === 'top') { g = ctx.createLinearGradient(0, 0, 0, H * (s.size || 0.5)); } else if (s.side === 'left') { g = ctx.createLinearGradient(0, 0, W * (s.size || 0.6), 0); } else if (s.side === 'right') { g = ctx.createLinearGradient(W, 0, W - W * (s.size || 0.6), 0); } else if (s.rect) {
        ctx.fillStyle = `rgba(10,10,10,${a})`; ctx.fillRect(s.rect.x, s.rect.y, s.rect.w, s.rect.h); continue;
      } else continue;
      g.addColorStop(0, `rgba(10,10,10,${a})`); g.addColorStop(1, 'rgba(10,10,10,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
  }

  function drawWordmark(ctx, layer) {
    setFont(ctx, FONTS.display, layer.size, -0.06);
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillStyle = layer.color || BRAND.white; ctx.fillText('pulso', layer.x, layer.y);
    const w = ctx.measureText('pulso').width;
    ctx.fillStyle = layer.dotColor || BRAND.lime; ctx.fillText('.', layer.x + w, layer.y);
  }

  // Desenha o spec inteiro. images: { [ref]: Image/Canvas }. makeCanvas(w,h) cria canvas auxiliar (desfoque).
  function render(ctx, spec, images, { makeCanvas } = {}) {
    drawBackground(ctx, spec, images, makeCanvas);
    if (spec.dim) { ctx.fillStyle = `rgba(10,10,10,${spec.dim})`; ctx.fillRect(0, 0, spec.width, spec.height); }
    drawScrims(ctx, spec);
    const boxes = {};
    for (const layer of spec.layers || []) {
      if (layer.hidden) continue;
      if (layer.type === 'text') boxes[layer.id] = drawText(ctx, layer);
      else if (layer.type === 'wordmark') { drawWordmark(ctx, layer); boxes[layer.id] = layerBox(ctx, layer); } else if (layer.type === 'rect') {
        ctx.fillStyle = layer.color || BRAND.lime;
        if (layer.radius && ctx.roundRect) { ctx.beginPath(); ctx.roundRect(layer.x, layer.y, layer.w, layer.h, layer.radius); ctx.fill(); } else ctx.fillRect(layer.x, layer.y, layer.w, layer.h);
        boxes[layer.id] = layerBox(ctx, layer);
      } else if (layer.type === 'arrow') { // seta → desenhada (a fonte da marca não tem esse glifo)
        const s = layer.size; ctx.save(); ctx.strokeStyle = layer.color || BRAND.white; ctx.lineWidth = Math.max(2, s * 0.09); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(layer.x, layer.y + s / 2); ctx.lineTo(layer.x + s, layer.y + s / 2); ctx.moveTo(layer.x + s * 0.62, layer.y + s * 0.12); ctx.lineTo(layer.x + s, layer.y + s / 2); ctx.lineTo(layer.x + s * 0.62, layer.y + s * 0.88); ctx.stroke(); ctx.restore();
        boxes[layer.id] = { x: layer.x, y: layer.y, w: s, h: s };
      } else if (layer.type === 'image' && images[layer.ref]) {
        const im = images[layer.ref]; ctx.drawImage(im, layer.x, layer.y, layer.w, layer.h); boxes[layer.id] = layerBox(ctx, layer);
      }
    }
    return boxes;
  }

  // ---------------------------------------------------------------- conferência
  // pixelsBehind: (rect) => { avgLum, p10Lum } medido no fundo ANTES do texto (opcional).
  // Legendas queimadas que uma faixa escura (patch ou panel) já esconde por inteiro: não contam como "legenda visível".
  function uncoveredBlocks(spec, blocks) {
    return (blocks || []).filter((b) => !(spec.scrims || []).some((s) => {
      if (s.side === 'patch' && s.rect && (s.strength ?? 0.95) >= 0.85) return overlap(s.rect, b) >= 0.9 * b.w * b.h;
      if (s.side === 'panel' && (s.strength ?? 0.94) >= 0.85) return b.y >= s.y - 4;
      return false;
    }));
  }

  function lint(ctx, spec, { faces = [], blocks: allBlocks = [], insets = [], behind = null } = {}) {
    const blocks = uncoveredBlocks(spec, allBlocks);
    const F = FORMATS[spec.format] || { w: spec.width, h: spec.height, safe: { l: 0, r: 0, t: 0, b: 0 }, avoid: [], kind: 'quote', maxLines: 6 };
    const issues = []; const warnings = [];
    const safe = { x: F.safe.l, y: F.safe.t, w: F.w - F.safe.l - F.safe.r, h: F.h - F.safe.t - F.safe.b };
    for (const layer of spec.layers || []) {
      if (layer.hidden || (layer.type !== 'text' && layer.type !== 'wordmark')) continue;
      const role = layer.role || (layer.type === 'wordmark' ? 'meta' : 'main');
      const b = layerBox(ctx, layer);
      const label = layer.type === 'wordmark' ? 'O logotipo' : `Texto “${String(layer.text).replace(/\n/g, ' ').slice(0, 28)}”`;
      if (layer.type === 'wordmark') {
        for (const f of faces) if (overlap(b, grow(f, 4)) > 0) { issues.push(`${label} cobre um rosto.`); break; }
        for (const blk of blocks) if (overlap(b, blk) > 0) { issues.push(`${label} cobre a legenda do vídeo.`); break; }
        continue;
      }
      if (b.lines.length > (F.maxLines || 6) && role === 'main') issues.push(`${label} tem ${b.lines.length} linhas (máximo ${F.maxLines}).`);
      const broken = b.lines.some((l) => ctx.measureText(l).width > layer.w + 1 && l.split(' ').length === 1);
      if (broken) issues.push(`${label} tem uma palavra mais larga que a caixa.`);
      if (b.x < 0 || b.y < 0 || b.x + b.w > spec.width || b.y + b.h > spec.height) issues.push(`${label} sai do quadro.`);
      else if (role === 'main' && (b.x < safe.x - 1 || b.y < safe.y - 1 || b.x + b.w > safe.x + safe.w + 1 || b.y + b.h > safe.y + safe.h + 1)) warnings.push(`${label} está fora da zona segura.`);
      for (const f of faces) {
        const ov = overlap(b, grow(f, 4));
        if (ov > 0) { issues.push(`${label} cobre um rosto (${Math.round((ov / (f.w * f.h)) * 100)}% do rosto).`); break; }
      }
      for (const blk of blocks) if (overlap(b, blk) > 0) { issues.push(`${label} cobre a legenda do vídeo.`); break; }
      if (role === 'main') for (const r of insets) if (overlap(b, r) > 0) { issues.push(`${label} invade a foto.`); break; }
      for (const a of F.avoid || []) if (overlap(b, a) > 0) { warnings.push(`${label} invade a área de ${a.why}.`); break; }
      const minSize = role === 'meta' ? 18 : role === 'deco' ? 0 : (F.kind === 'thumb' ? 64 : F.kind === 'cover' ? 56 : 40);
      if (layer.size < minSize) warnings.push(`${label} está pequeno (${Math.round(layer.size)} px; o mínimo recomendado é ${minSize}).`);
      if (behind && role !== 'deco' && !layer.chip) {
        const m = behind(b);
        const fg = luminance(...hexToRgb(layer.color || BRAND.white));
        const ratio = contrast(fg, m.p10Lum != null ? Math.max(m.p10Lum, m.avgLum) : m.avgLum);
        if (ratio < 3) issues.push(`${label} tem pouco contraste com o fundo (${ratio.toFixed(1)}:1).`);
        else if (ratio < 4.5) warnings.push(`${label} poderia ter mais contraste (${ratio.toFixed(1)}:1).`);
      }
    }
    return { ok: issues.length === 0, issues, warnings };
  }

  return {
    orientBox, orientedSize, photoFilter, BRAND, FONTS, FORMATS, fontString, setFont, wrap, balance, fitText, overlap, grow, mapBox, bgTransform, freeBands, autoText,
    emptyRects, layerBox, render, lint, uncoveredBlocks, visibleArea, framings, placeSmall, luminance, hexToRgb, contrast, clamp,
  };
}));
