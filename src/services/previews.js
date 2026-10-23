// Miniaturas e visualizações da galeria do material (fotos e vídeos do episódio).
// t = miniatura (480 px) para a grade; p = visualização (1600 px) para ver a foto grande sem baixar o original (10-20 MB).
//
// Economia: cada imagem é feita UMA vez e fica no disco do servidor (config.previewDir, volume no Docker), nunca no Backblaze.
// 1) No envio, o próprio navegador gera a miniatura a partir do arquivo que já tem na mão e manda só alguns KB (receive):
//    nada é baixado do bucket.
// 2) O que faltar (arquivos antigos, formatos que o navegador não abre) o servidor gera uma vez: foto lida do bucket com
//    @napi-rs/canvas (respeita a rotação EXIF); vídeo com o ffmpeg pelo link assinado (lê só os pedaços necessários).
const fs = require('fs');
const path = require('path');
const config = require('../config');
const b2 = require('./b2');
const media = require('./media');

const SIZES = { t: 480, p: 1600 };
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'avif']; // HEIC/AVIF: o navegador (Safari) faz a miniatura no envio
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

async function imageBytes(file) {
  const res = await b2.getObject(file.storage_key);
  if (!res) throw new Error('Arquivo não está no armazenamento.');
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_IMAGE_BYTES) throw new Error('Foto grande demais para a miniatura.');
  return Buffer.from(await res.arrayBuffer());
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

// Arquivo no disco: <previewDir>/<episódio>/<arquivo>-<t|p>.jpg (o id do arquivo nunca se repete; substituir gera outro id).
const fileFor = (file, size) => path.join(config.previewDir, String(Number(file.episode_id)), `${Number(file.id)}-${size}.jpg`);
const stored = (file, size) => { const f = fileFor(file, size); try { return fs.statSync(f).size > 0 ? f : null; } catch { return null; } };
async function save(file, size, buf) {
  const f = fileFor(file, size);
  await fs.promises.mkdir(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, buf);
  await fs.promises.rename(tmp, f); // troca de uma vez: quem lê nunca pega meio arquivo
  return f;
}
// Apaga as miniaturas de um arquivo (removido ou substituído) ou de um episódio inteiro.
const removeFor = (file) => Promise.all(Object.keys(SIZES).map((k) => fs.promises.rm(fileFor(file, k), { force: true })));
const removeEpisode = (episodeId) => fs.promises.rm(path.join(config.previewDir, String(Number(episodeId))), { recursive: true, force: true });

// Fila curta: no máximo 2 gerações ao mesmo tempo (foto grande decodificada ocupa memória; ffmpeg ocupa CPU).
let running = 0; const waiting = [];
const slot = () => (running < 2 ? (running += 1, Promise.resolve()) : new Promise((r) => waiting.push(r)));
const free = () => { const next = waiting.shift(); if (next) next(); else running -= 1; };
const inflight = new Map(); // mesma imagem pedida duas vezes ao mesmo tempo: gera uma vez
const failed = new Map(); // falhou há pouco: não tenta de novo por 10 min

// Caminho do JPEG no disco (gerando agora, uma vez, se faltar) ou null (não dá para visualizar este arquivo).
async function get(file, size) {
  const side = SIZES[size];
  if (!side || file.status !== 'pronto' || !hasPreview(file)) return null;
  const have = stored(file, size);
  if (have) return have;
  if (size === 'p' && mediaType(file) === 'video') return get(file, 't'); // vídeo: o grande é o próprio player; a capa é a miniatura
  const id = `${file.id}:${size}`;
  if ((failed.get(id) || 0) > Date.now()) return null;
  if (inflight.has(id)) return inflight.get(id);
  const job = (async () => {
    await slot();
    try {
      if (mediaType(file) === 'image') {
        // um download da foto serve para os dois tamanhos
        const original = await imageBytes(file);
        const orientation = jpegOrientation(original);
        const out = {};
        for (const k of Object.keys(SIZES)) out[k] = stored(file, k) || await save(file, k, await shrink(original, SIZES[k], orientation));
        return out[size];
      }
      return save(file, size, await videoPreview(file, side));
    } catch (err) {
      console.error(`[galeria] miniatura ${file.id}:`, err.message);
      failed.set(id, Date.now() + 10 * 60_000);
      return null;
    } finally { free(); inflight.delete(id); }
  })();
  inflight.set(id, job);
  return job;
}

// Miniatura feita pelo navegador no envio. Não confia no que chega: decodifica, limita o tamanho e regrava como JPEG limpo.
const MAX_INCOMING = 3 * 1024 * 1024;
async function receive(file, size, buf) {
  const side = SIZES[size];
  if (!side) return { error: 'Tamanho inválido.', status: 400 };
  if (!hasPreview(file)) return { error: 'Este arquivo não tem miniatura.', status: 422 };
  if (!Buffer.isBuffer(buf) || !buf.length || buf.length > MAX_INCOMING) return { error: 'Imagem inválida.', status: 400 };
  let clean;
  try { clean = await shrink(buf, side, 1); } catch { return { error: 'Imagem inválida.', status: 400 }; }
  await save(file, size, clean);
  return { ok: true, bytes: clean.length };
}

module.exports = { SIZES, mediaType, hasPreview, jpegOrientation, shrink, get, receive, stored, removeFor, removeEpisode };
