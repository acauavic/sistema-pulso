// Valida e limpa o "spec" de design enviado pelo editor antes de o servidor renderizá-lo. O spec é entrada do usuário:
// só aceita formatos, fontes, tipos de camada e quadros do próprio episódio, com números limitados.
// As capas dos modelos do guia (base.model) também passam por aqui: o que é do modelo (modelo, ângulo, ficha, zona segura,
// escala do arquivo) vem da capa guardada, nunca do navegador.
const { engine } = require('./covers');

// Pesos hospedados de cada fonte (o servidor registra os mesmos em services/covers.js): pedir outro faria o navegador e o servidor
// desenharem letras diferentes.
const FONT_WEIGHTS = { 'Space Grotesk': [400, 500, 600, 700], 'Instrument Serif': [400], Inter: [400, 500, 600], 'JetBrains Mono': [400, 500] };
const FONT_DEFAULT = { 'Space Grotesk': 700, 'Instrument Serif': 400, Inter: 500, 'JetBrains Mono': 500 };
const LAYER_TYPES = new Set(['text', 'wordmark', 'rect', 'arrow', 'tarja', 'photo', 'gradient', 'dots', 'pulse']);
const SCRIM_SIDES = new Set(['bottom', 'top', 'left', 'right', 'panel', 'spot', 'patch']);
const GRADIENT_DIRS = new Set(['right', 'left', 'up', 'down']);
const HEX = /^#[0-9a-fA-F]{6}$/;
const RGBA = /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\)$/;
const ID = /^[A-Za-z0-9_-]{1,24}$/;
const MAX_LAYERS = 40;

const num = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const color = (v, def) => (typeof v === 'string' && (HEX.test(v) || RGBA.test(v)) ? v : def);
const bool = (v) => v === true;
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').slice(0, max);

// Fonte: família conhecida e o peso hospedado mais perto do pedido.
function fontOf(f) {
  const family = FONT_WEIGHTS[f?.family] ? f.family : 'Space Grotesk';
  const want = num(f?.weight, 100, 900, FONT_DEFAULT[family]);
  const weight = FONT_WEIGHTS[family].reduce((best, w) => (Math.abs(w - want) < Math.abs(best - want) ? w : best), FONT_WEIGHTS[family][0]);
  return { family, weight, italic: family === 'Instrument Serif' ? true : bool(f?.italic) };
}

// Giro, espelho e ajustes da foto (iguais para o fundo inteiro e para cada painel).
function orientation(b) {
  const out = {};
  const rot = ((Math.round(Number(b?.rot) / 90) * 90) % 360 + 360) % 360;
  if (rot) out.rot = rot;
  if (b?.flipX === true) out.flipX = true;
  if (b?.flipY === true) out.flipY = true;
  const a = b?.adjust;
  if (a && typeof a === 'object') {
    const adj = { brightness: num(a.brightness, 0.4, 1.8, 1), contrast: num(a.contrast, 0.4, 1.8, 1), saturate: num(a.saturate, 0, 2, 1), blur: num(a.blur, 0, 24, 0) };
    if (adj.brightness !== 1 || adj.contrast !== 1 || adj.saturate !== 1 || adj.blur) out.adjust = adj;
  }
  return out;
}

function sanitizeSpec(input, { allowedRefs, base = null }) {
  const errors = [];
  if (!input || typeof input !== 'object') throw new Error('Spec inválido.');
  const F = engine.FORMATS[input.format];
  if (!F) throw new Error('Formato desconhecido.');
  const W = F.w; const H = F.h;
  const refOk = (r) => typeof r === 'string' && allowedRefs.has(r);
  const pos = (l) => ({ x: num(l.x, -W, 2 * W, 0), y: num(l.y, -H, 2 * H, 0) });

  const bgIn = input.bg || {};
  let bg;
  if (bgIn.kind === 'solid') bg = { kind: 'solid', color: color(bgIn.color, engine.BRAND.black) };
  else if (bgIn.kind === 'panels') {
    const panels = (Array.isArray(bgIn.panels) ? bgIn.panels : []).slice(0, 3).filter((p) => refOk(p.ref) && p.rect).map((p) => ({
      ref: p.ref, rect: { x: num(p.rect.x, 0, W, 0), y: num(p.rect.y, 0, H, 0), w: num(p.rect.w, 10, W, W), h: num(p.rect.h, 10, H, H) },
      bg: { kind: 'frame', fit: p.bg?.fit === 'contain' ? 'contain' : 'cover', zoom: num(p.bg?.zoom, 1, 3, 1), cx: num(p.bg?.cx, 0, 1, 0.5), cy: num(p.bg?.cy, 0, 1, 0.5), align: ['left', 'right', 'center'].includes(p.bg?.align) ? p.bg.align : 'center', ...orientation(p.bg) },
    }));
    if (!panels.length) errors.push('Nenhum quadro válido nos painéis.');
    bg = { kind: 'panels', panels };
  } else {
    if (!refOk(bgIn.ref)) throw new Error('O fundo usa um quadro que não é deste episódio.');
    bg = { kind: 'frame', ref: bgIn.ref, fit: bgIn.fit === 'contain' ? 'contain' : 'cover', zoom: num(bgIn.zoom, 1, 3, 1), cx: num(bgIn.cx, 0, 1, 0.5), cy: num(bgIn.cy, 0, 1, 0.5), align: ['left', 'right', 'center'].includes(bgIn.align) ? bgIn.align : 'center', ...orientation(bgIn) };
  }

  const scrims = (Array.isArray(input.scrims) ? input.scrims : []).slice(0, 6).filter((s) => SCRIM_SIDES.has(s.side)).map((s) => {
    const out = { side: s.side, strength: num(s.strength, 0, 1, 0.5) };
    if (s.size != null) out.size = num(s.size, 0.05, 1, 0.5);
    if (s.side === 'panel') { out.y = num(s.y, 0, H, H / 2); out.fade = num(s.fade, 0, 300, 60); }
    if (s.auto && ID.test(String(s.auto))) out.auto = String(s.auto);
    if (s.side === 'patch') out.feather = num(s.feather, 0, 80, 26);
    if (s.side === 'spot' || s.side === 'patch' || s.rect) out.rect = { x: num(s.rect?.x, -W, 2 * W, 0), y: num(s.rect?.y, -H, 2 * H, 0), w: num(s.rect?.w, 1, 2 * W, W), h: num(s.rect?.h, 1, 2 * H, H) };
    return out;
  });

  const layers = []; const ids = new Set();
  for (const l of (Array.isArray(input.layers) ? input.layers : []).slice(0, MAX_LAYERS)) {
    if (!l || !LAYER_TYPES.has(l.type)) continue;
    let id = ID.test(l.id) && !ids.has(l.id) ? l.id : `l${layers.length + 1}`;
    while (ids.has(id)) id = `${id.slice(0, 20)}${Math.random().toString(36).slice(2, 5)}`;
    ids.add(id);
    const base0 = { id, type: l.type, hidden: bool(l.hidden), role: ['main', 'meta', 'deco'].includes(l.role) ? l.role : undefined };
    if (l.alpha != null && num(l.alpha, 0, 1, 1) < 1) base0.alpha = num(l.alpha, 0, 1, 1); // opacidade da camada
    if (l.type === 'text') {
      const marks = l.marks && Array.isArray(l.marks.words)
        ? [...new Set(l.marks.words.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 200))].slice(0, 60) : [];
      const chip = l.chip && typeof l.chip === 'object' ? {
        color: l.chip.color === 'none' ? 'none' : color(l.chip.color, 'rgba(10,10,10,0.62)'), padX: num(l.chip.padX, 0, 60, 14), padY: num(l.chip.padY, 0, 60, 8), radius: num(l.chip.radius, 0, 40, 8),
        ...(color(l.chip.stroke, null) ? { stroke: l.chip.stroke, strokeWidth: num(l.chip.strokeWidth, 0.5, 20, 2) } : {}),
      } : undefined;
      layers.push({
        ...base0, text: cleanText(l.text, 700), ...pos(l), w: num(l.w, 40, 2 * W, W / 2), size: num(l.size, 12, 420, 64),
        font: fontOf(l.font), color: color(l.color, engine.BRAND.white), align: ['left', 'center', 'right'].includes(l.align) ? l.align : 'left', lineHeight: num(l.lineHeight, 0.8, 2, 1.05),
        tracking: num(l.tracking, -0.1, 0.4, 0), upper: bool(l.upper), shadow: num(l.shadow, 0, 1, 0),
        ...(bool(l.css) ? { css: true } : {}),
        ...(l.shadowAngle != null && Number.isFinite(Number(l.shadowAngle)) ? { shadowAngle: num(l.shadowAngle, -360, 360, 90), shadowDistance: num(l.shadowDistance, 0, 1, 0.4) } : {}),
        ...(l.stroke && num(l.stroke.width, 0, 0.25, 0) > 0 ? { stroke: { width: num(l.stroke.width, 0, 0.25, 0), color: color(l.stroke.color, engine.BRAND.black) } } : {}),
        highlight: l.highlight && color(l.highlight.color, null) ? { color: l.highlight.color, lines: l.highlight.lines === 'last' ? 'last' : Math.round(num(l.highlight.lines, 0, 20, 0)) } : null,
        ...(marks.length ? { marks: { words: marks, color: color(l.marks.color, engine.BRAND.lime) } } : {}),
        ...(l.minSize != null ? { minSize: num(l.minSize, 0, 200, 0) } : {}),
        ...(l.maxLines != null ? { maxLines: Math.round(num(l.maxLines, 1, 20, 4)) } : {}),
        chip,
      });
    } else if (l.type === 'tarja') { // palavra dentro da tarja: uma linha só
      const p = l.pad || {};
      layers.push({
        ...base0, text: cleanText(l.text, 120).replace(/\s+/g, ' ').trim(), ...pos(l), size: num(l.size, 12, 360, 116), font: fontOf(l.font),
        color: color(l.color, engine.BRAND.black), bg: color(l.bg, engine.BRAND.lime), pad: { t: num(p.t, 0, 160, 12), r: num(p.r, 0, 160, 30), b: num(p.b, 0, 160, 26), l: num(p.l, 0, 160, 20) },
        tracking: num(l.tracking, -0.12, 0.4, -0.065), lineHeight: num(l.lineHeight, 0.6, 2, 0.85), upper: bool(l.upper),
      });
    } else if (l.type === 'photo') { // a foto recortada num painel (modelos do guia)
      if (l.ref != null && !refOk(l.ref)) throw new Error('A foto usa um quadro que não é deste episódio.');
      const box = { ...pos(l), w: num(l.w, 1, 2 * W, W), h: num(l.h, 1, 2 * H, H) };
      const f = l.filter && typeof l.filter === 'object' ? l.filter : {};
      const filter = {};
      if (f.saturate != null) filter.saturate = num(f.saturate, 0, 2, 1);
      if (f.contrast != null) filter.contrast = num(f.contrast, 0.4, 1.8, 1);
      if (f.brightness != null) filter.brightness = num(f.brightness, 0.4, 1.8, 1);
      layers.push({
        ...base0, ...(l.ref != null ? { ref: l.ref } : {}), ...box,
        ...(l.img && typeof l.img === 'object' ? { img: { x: num(l.img.x, -20 * W, 20 * W, 0), y: num(l.img.y, -20 * H, 20 * H, 0), w: num(l.img.w, 1, 40 * W, box.w), h: num(l.img.h, 1, 40 * H, box.h) } } : {}),
        fade: num(l.fade, 0, 800, 0), shape: l.shape === 'circle' ? 'circle' : 'rect', bgColor: color(l.bgColor, engine.BRAND.black), filter,
        ...(l.border && color(l.border.color, null) ? { border: { color: l.border.color, width: num(l.border.width, 0, 60, 8) } } : {}),
        ...(bool(l.mirror) ? { mirror: true } : {}),
      });
    } else if (l.type === 'gradient') {
      const stops = (Array.isArray(l.stops) ? l.stops : []).slice(0, 10).filter((s) => Array.isArray(s) && s.length === 2 && color(s[1], null)).map(([at, c]) => [num(at, 0, 1, 0), c]);
      if (stops.length < 2) continue;
      layers.push({ ...base0, ...pos(l), w: num(l.w, 1, 2 * W, W), h: num(l.h, 1, 2 * H, H), dir: GRADIENT_DIRS.has(l.dir) ? l.dir : 'down', stops });
    } else if (l.type === 'dots') {
      layers.push({ ...base0, ...pos(l), w: num(l.w, 1, 2 * W, W), h: num(l.h, 1, 2 * H, H), step: num(l.step, 20, 200, 40), r: num(l.r, 0.5, 30, 3), color: color(l.color, '#3a2663') });
    } else if (l.type === 'pulse') {
      layers.push({ ...base0, ...pos(l), w: num(l.w, 10, 2 * W, 300), color: color(l.color, engine.BRAND.lime), width: num(l.width, 0.5, 16, 2), beat: num(l.beat, 2, 80, 10), at: num(l.at, 0, 1, 0.5) });
    } else if (l.type === 'wordmark') {
      layers.push({ ...base0, ...pos(l), size: num(l.size, 16, 300, 52), color: color(l.color, engine.BRAND.white), dotColor: color(l.dotColor, engine.BRAND.lime), ...(bool(l.css) ? { css: true } : {}) });
    } else if (l.type === 'rect') {
      layers.push({ ...base0, ...pos(l), w: num(l.w, 1, 2 * W, 100), h: num(l.h, 1, 2 * H, 10), color: color(l.color, engine.BRAND.lime), radius: num(l.radius, 0, 200, 0) });
    } else if (l.type === 'arrow') {
      layers.push({ ...base0, ...pos(l), size: num(l.size, 12, 300, 44), color: color(l.color, engine.BRAND.white) });
    }
  }
  if (errors.length) throw new Error(errors[0]);
  const out = { format: input.format, width: W, height: H, bg, dim: num(input.dim, 0, 0.8, 0), scrims, layers };
  if (base && base.model) { // capa de um modelo do guia mexida no editor completo
    for (const k of ['model', 'angle', 'flip', 'sheet', 'safe', 'avoid', 'scale']) if (base[k] !== undefined) out[k] = base[k];
    const ph = layers.find((l) => l.type === 'photo' && l.ref);
    if (ph) out.photo = base.photo && base.photo.ref === ph.ref ? { ...base.photo } : { ref: ph.ref }; // foto trocada: o rosto é o da análise
    out.edited = true;
  }
  return out;
}

module.exports = { sanitizeSpec, FONT_WEIGHTS };
