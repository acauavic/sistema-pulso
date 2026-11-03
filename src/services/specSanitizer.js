// Valida e limpa o "spec" de design enviado pelo editor antes de o servidor renderizá-lo. O spec é entrada do usuário:
// só aceita formatos, fontes, tipos de camada e quadros do próprio episódio, com números limitados.
const { engine } = require('./covers');

const FONT_FAMILIES = new Set(['Space Grotesk', 'Instrument Serif', 'Inter', 'JetBrains Mono']);
const LAYER_TYPES = new Set(['text', 'wordmark', 'rect', 'arrow']);
const SCRIM_SIDES = new Set(['bottom', 'top', 'left', 'right', 'panel', 'spot', 'patch']);
const HEX = /^#[0-9a-fA-F]{6}$/;
const RGBA = /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\)$/;
const ID = /^[A-Za-z0-9_-]{1,24}$/;

const num = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const color = (v, def) => (typeof v === 'string' && (HEX.test(v) || RGBA.test(v)) ? v : def);
const bool = (v) => v === true;

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

function sanitizeSpec(input, { allowedRefs }) {
  const errors = [];
  if (!input || typeof input !== 'object') throw new Error('Spec inválido.');
  const F = engine.FORMATS[input.format];
  if (!F) throw new Error('Formato desconhecido.');
  const W = F.w; const H = F.h;
  const refOk = (r) => typeof r === 'string' && allowedRefs.has(r);

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

  const layers = [];
  for (const l of (Array.isArray(input.layers) ? input.layers : []).slice(0, 24)) {
    if (!l || !LAYER_TYPES.has(l.type)) continue;
    const base = { id: ID.test(l.id) ? l.id : `l${layers.length + 1}`, type: l.type, hidden: bool(l.hidden), role: ['main', 'meta', 'deco'].includes(l.role) ? l.role : undefined };
    if (l.type === 'text') {
      const text = String(l.text ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').slice(0, 700);
      const fam = l.font?.family;
      layers.push({
        ...base, text, x: num(l.x, -W, 2 * W, 0), y: num(l.y, -H, 2 * H, 0), w: num(l.w, 40, 2 * W, W / 2), size: num(l.size, 12, 420, 64),
        font: { family: FONT_FAMILIES.has(fam) ? fam : 'Space Grotesk', weight: num(l.font?.weight, 300, 900, 700), italic: bool(l.font?.italic) },
        color: color(l.color, engine.BRAND.white), align: ['left', 'center', 'right'].includes(l.align) ? l.align : 'left', lineHeight: num(l.lineHeight, 0.8, 2, 1.05),
        tracking: num(l.tracking, -0.1, 0.4, 0), upper: bool(l.upper), shadow: num(l.shadow, 0, 1, 0),
        ...(l.shadowAngle != null && Number.isFinite(Number(l.shadowAngle)) ? { shadowAngle: num(l.shadowAngle, -360, 360, 90), shadowDistance: num(l.shadowDistance, 0, 1, 0.4) } : {}),
        ...(l.stroke && num(l.stroke.width, 0, 0.25, 0) > 0 ? { stroke: { width: num(l.stroke.width, 0, 0.25, 0), color: color(l.stroke.color, engine.BRAND.black) } } : {}),
        highlight: l.highlight && color(l.highlight.color, null) ? { color: l.highlight.color, lines: l.highlight.lines === 'last' ? 'last' : Math.round(num(l.highlight.lines, 0, 20, 0)) } : null,
        chip: l.chip ? { color: color(l.chip.color, 'rgba(10,10,10,0.62)'), padX: num(l.chip.padX, 0, 60, 14), padY: num(l.chip.padY, 0, 60, 8), radius: num(l.chip.radius, 0, 40, 8) } : undefined,
      });
    } else if (l.type === 'wordmark') {
      layers.push({ ...base, x: num(l.x, -W, 2 * W, 0), y: num(l.y, -H, 2 * H, 0), size: num(l.size, 16, 300, 52), color: color(l.color, engine.BRAND.white), dotColor: color(l.dotColor, engine.BRAND.lime) });
    } else if (l.type === 'rect') {
      layers.push({ ...base, x: num(l.x, -W, 2 * W, 0), y: num(l.y, -H, 2 * H, 0), w: num(l.w, 1, 2 * W, 100), h: num(l.h, 1, 2 * H, 10), color: color(l.color, engine.BRAND.lime), radius: num(l.radius, 0, 200, 0) });
    } else if (l.type === 'arrow') {
      layers.push({ ...base, x: num(l.x, -W, 2 * W, 0), y: num(l.y, -H, 2 * H, 0), size: num(l.size, 12, 300, 44), color: color(l.color, engine.BRAND.white) });
    }
  }
  if (errors.length) throw new Error(errors[0]);
  return { format: input.format, width: W, height: H, bg, dim: num(input.dim, 0, 0.8, 0), scrims, layers };
}

module.exports = { sanitizeSpec };
