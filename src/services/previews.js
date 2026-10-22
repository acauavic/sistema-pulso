// Miniaturas e visualizações da galeria do material (fotos e vídeos do episódio).
// t = miniatura (480 px) para a grade; p = visualização (1600 px) para ver grande sem baixar a foto original (10-20 MB).
// Foto: lida com @napi-rs/canvas (respeita a rotação EXIF do celular/câmera). Vídeo: um quadro pelo ffmpeg, lido direto do
// link assinado (só os pedaços necessários). A imagem gerada fica no bucket (preview_keys) para não gerar de novo; se o bucket
// recusar (ex.: armazenamento cheio), a imagem é entregue mesmo assim e o navegador guarda em cache.
const fs = require('fs');
const path = require('path');
const db = require('../db/pool');
const b2 = require('./b2');
const media = require('./media');

const SIZES = { t: 480, p: 1600 };
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mts', 'm2ts', 'mpg', 'mpeg', 'wmv', 'mxf'];
const AUDIO_EXT = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'aif', 'aiff', 'ogg', 'opus'];
const MAX_IMAGE_BYTES = 80 * 1024 * 1024;

const extOf = (name) => (String(name).match(/\.([A-Za-z0-9]{1,6})$/)?.[1] || '').toLowerCase();
// O que a galeria sabe mostrar: image (miniatura + foto grande), video (miniatura + player), audio (player), file (só baixar).
function mediaType(file) {
  const ext = extOf(file.filename);
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext) || file.kind === 'editado') return 'video';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  return 'file';
}
const hasPreview = (file) => ['image', 'video'].includes(mediaType(file));

// Rotação gravada pela câmera (EXIF Orientation, 1 a 8). Só JPEG; qualquer coisa estranha = 1 (sem girar).
function jpegOrientation(buf) {
  try {
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return 1;
    let i = 2;
    while (i + 4 < buf.length) {
      if (buf[i] !== 0xFF) return 1;
      const marker = buf[i + 1]; const len = buf.readUInt16BE(i + 2);
      if (marker === 0xE1 && buf.toString('ascii', i + 4, i + 8) === 'Exif') {
        const t = i + 10; const le = buf.toString('ascii', t, t + 2) === 'II';
        const r16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
        const r32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
        const ifd = t + r32(t + 4); const n = r16(ifd);
        for (let k = 0; k < n; k += 1) { const e = ifd + 2 + k * 12; if (r16(e) === 0x0112) { const o = r16(e + 8); return o >= 1 && o <= 8 ? o : 1; } }
        return 1;
      }
      if (marker === 0xDA) return 1; // começou a imagem: não há EXIF
      i += 2 + len;
    }
  } catch { /* JPEG truncado ou EXIF quebrado */ }
  return 1;
}

// Reduz para caber em `side` (sem aumentar), aplica a rotação e devolve JPEG.
async function shrink(buf, side, orientation = 1) {
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const img = await loadImage(buf);
  const turned = orientation >= 5;
  const srcW = turned ? img.height : img.width; const srcH = turned ? img.width : img.height;
  const k = Math.min(1, side / Math.max(srcW, srcH));
  const cw = Math.max(1, Math.round(srcW * k)); const ch = Math.max(1, Math.round(srcH * k));
  const w = turned ? ch : cw; const h = turned ? cw : ch; // tamanho de desenho antes de girar
  const canvas = createCanvas(cw, ch); const ctx = canvas.getContext('2d');
  const T = { 2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h], 5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, h, 0], 7: [0, -1, -1, 0, h, w], 8: [0, -1, 1, 0, 0, w] }[orientation];
  if (T) ctx.transform(...T);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.encode('jpeg', 82);
}

async function imagePreview(file, side) {
  const res = await b2.getObject(file.storage_key);
  if (!res) throw new Error('Arquivo não está no armazenamento.');
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_IMAGE_BYTES) throw new Error('Foto grande demais para a miniatura.');
  const buf = Buffer.from(await res.arrayBuffer());
  return shrink(buf, side, jpegOrientation(buf));
}

async function videoPreview(file, side) {
  if (!(await media.available())) throw new Error('ffmpeg indisponível.');
  const url = await b2.presignGet(file.storage_key, { expires: 900 });
  const dir = await media.tempDir('pulso-previa-');
  try {
    const out = path.join(dir, 'q.jpg');
    try { await media.extractFrame(url, 2000, out, { maxSide: side, quality: 4 }); } catch { await media.extractFrame(url, 0, out, { maxSide: side, quality: 4 }); }
    if (!fs.existsSync(out) || !fs.statSync(out).size) await media.extractFrame(url, 0, out, { maxSide: side, quality: 4 }); // vídeo com menos de 2 s
    return fs.readFileSync(out);
  } finally { await media.rmDir(dir); }
}

// Fila curta: no máximo 2 gerações ao mesmo tempo (foto grande decodificada ocupa memória; ffmpeg ocupa CPU).
let running = 0; const waiting = [];
const slot = () => (running < 2 ? (running += 1, Promise.resolve()) : new Promise((r) => waiting.push(r)));
const free = () => { const next = waiting.shift(); if (next) next(); else running -= 1; };
const inflight = new Map(); // mesma imagem pedida duas vezes ao mesmo tempo: gera uma vez
const failed = new Map(); // falhou há pouco: não tenta de novo por 10 min

// Devolve { url } (já guardada no bucket) ou { buf } (acabou de gerar) ou null (não dá para visualizar este arquivo).
async function get(file, size) {
  const side = SIZES[size];
  if (!side || file.status !== 'pronto' || !hasPreview(file)) return null;
  const saved = file.preview_keys?.[size];
  if (saved) return { url: await b2.presignGet(saved, { expires: 6 * 3600 }) };
  const id = `${file.id}:${size}`;
  if ((failed.get(id) || 0) > Date.now()) return null;
  if (inflight.has(id)) return inflight.get(id);
  const job = (async () => {
    await slot();
    try {
      const buf = mediaType(file) === 'image' ? await imagePreview(file, side) : await videoPreview(file, side);
      const key = `${file.storage_key}.previa-${size}.jpg`;
      try {
        await b2.putObject(key, buf, 'image/jpeg');
        await db.query("UPDATE episode_files SET preview_keys = preview_keys || jsonb_build_object($2::text, $3::text) WHERE id = $1", [file.id, size, key]);
      } catch (err) { console.error('[galeria] guardar miniatura:', err.message); }
      return { buf };
    } catch (err) {
      console.error(`[galeria] miniatura ${file.id}:`, err.message);
      failed.set(id, Date.now() + 10 * 60_000);
      return null;
    } finally { free(); inflight.delete(id); }
  })();
  inflight.set(id, job);
  return job;
}

module.exports = { SIZES, mediaType, hasPreview, jpegOrientation, shrink, get };
