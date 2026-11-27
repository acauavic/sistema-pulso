// Capas e posts: renderiza specs do motor de design (src/public/design/engine.js) com @napi-rs/canvas e as fontes da marca.
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const engine = require('../public/design/engine');

const FONT_DIR = path.join(__dirname, '..', 'public', 'fonts');
let fontsReady = false;
// Todos os pesos hospedados, cada um na família de verdade: o editor de capas deixa escolher o peso (specSanitizer.FONT_WEIGHTS),
// e o servidor precisa desenhar a mesma letra que o navegador mostrou.
function ensureFonts() {
  if (fontsReady) return;
  for (const [file, family] of [
    ...[400, 500, 600, 700].map((w) => [`space-grotesk-latin-${w}-normal.woff2`, 'Space Grotesk']),
    ['instrument-serif-latin-400-italic.woff2', 'Instrument Serif'],
    ...[400, 500, 600].map((w) => [`inter-latin-${w}-normal.woff2`, 'Inter']),
    ...[400, 500].map((w) => [`jetbrains-mono-latin-${w}-normal.woff2`, 'JetBrains Mono']),
  ]) GlobalFonts.registerFromPath(path.join(FONT_DIR, file), family);
  fontsReady = true;
}

const makeCanvas = (w, h) => createCanvas(w, h);

// Faixas de pixels para medir contraste: luminância média e 10º percentil do fundo atrás de um retângulo.
function sampler(canvas, k = 1) {
  const ctx = canvas.getContext('2d');
  return (r) => {
    const x = Math.max(0, Math.floor(r.x * k)); const y = Math.max(0, Math.floor(r.y * k));
    const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(r.w * k))); const h = Math.max(1, Math.min(canvas.height - y, Math.ceil(r.h * k)));
    const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 4000)));
    const data = ctx.getImageData(x, y, w, h).data; const lums = [];
    for (let j = 0; j < h; j += step) for (let i = 0; i < w; i += step) { const o = (j * w + i) * 4; lums.push(engine.luminance(data[o], data[o + 1], data[o + 2])); }
    lums.sort((a, b) => a - b);
    return { avgLum: lums.reduce((s, v) => s + v, 0) / lums.length, p10Lum: lums[Math.floor(lums.length * 0.9)] }; // pior caso = trecho mais claro
  };
}

async function loadImages(refs) {
  const out = {};
  for (const [ref, source] of Object.entries(refs || {})) out[ref] = await loadImage(source);
  return out;
}

// Renderiza e confere. `ctxData`: { faces, blocks } em pixels do canvas. Devolve { buffer, lint, boxes }.
async function renderSpec(spec, imageSources, ctxData = {}, { type = 'image/jpeg', quality = 0.92 } = {}) {
  ensureFonts();
  const images = await loadImages(imageSources);
  const k = spec.scale || 1; // a capa do Spotify é desenhada em base 1000 e sai em 3000×3000
  const canvas = createCanvas(spec.width * k, spec.height * k);
  const ctx = canvas.getContext('2d');
  if (k !== 1) ctx.scale(k, k);
  // 1) fundo + faixas, sem texto: para medir o contraste real atrás de cada texto
  const bareSpec = { ...spec, layers: (spec.layers || []).filter((l) => l.type !== 'text' && l.type !== 'tarja') };
  engine.render(ctx, bareSpec, images, { makeCanvas });
  const behind = sampler(canvas, k);
  const linted = engine.lint(ctx, spec, { ...ctxData, behind });
  // 2) render final
  engine.render(ctx, spec, images, { makeCanvas });
  const buffer = type === 'image/png' ? canvas.toBuffer('image/png') : canvas.toBuffer('image/jpeg', Math.round(quality * 100));
  return { buffer, lint: linted, width: spec.width * k, height: spec.height * k, mime: type };
}

// Mede texto (para quem precisa de layout sem renderizar).
function measureContext() {
  ensureFonts();
  return createCanvas(10, 10).getContext('2d');
}

module.exports = { ensureFonts, renderSpec, measureContext, engine, makeCanvas };
