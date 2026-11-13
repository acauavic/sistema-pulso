// Imagens para VER no sistema em WebP; para BAIXAR, o arquivo original (JPG, PNG…), como foi enviado.
// A versão WebP é feita uma vez a partir do original no Backblaze e fica no disco do servidor (config.previewDir/webp,
// volume no Docker), então ver a mesma foto de novo não baixa nada do bucket. Quem não pede WebP (robô do WhatsApp ou do
// Facebook lendo o og:image, navegador antigo) recebe o original: a decisão é pelo cabeçalho Accept do próprio pedido.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const b2 = require('./b2');

const MAX_BYTES = 40 * 1024 * 1024; // original maior que isso não vira WebP (vai o original)
const CONVERTIBLE = /\.(jpe?g|png|webp)$/i; // GIF (pode ser animado), SVG, HEIC e o resto: original
const dir = () => path.join(config.previewDir, 'webp');

const wantsWebp = (req) => /image\/webp/i.test(req.get('accept') || '');
const convertible = (key, mime) => CONVERTIBLE.test(String(key || '')) || /^image\/(jpeg|png|webp)$/i.test(String(mime || ''));
const fileFor = (key, version, side) => path.join(dir(), `${crypto.createHash('sha1').update(`${key}|${version || ''}`).digest('hex')}-${side}.webp`);

// No máximo 2 conversões ao mesmo tempo (foto grande decodificada ocupa memória); o mesmo pedido em paralelo gera uma vez.
let running = 0; const waiting = [];
const slot = () => (running < 2 ? (running += 1, Promise.resolve()) : new Promise((r) => waiting.push(r)));
const free = () => { const next = waiting.shift(); if (next) next(); else running -= 1; };
const inflight = new Map();
const failed = new Map(); // falhou há pouco (arquivo estranho): manda o original por 10 min sem tentar de novo

async function originalBytes(key) {
  const res = await b2.getObject(key);
  if (!res) throw new Error('Imagem não está no armazenamento.');
  if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('Imagem grande demais para converter.');
  return Buffer.from(await res.arrayBuffer());
}

// Caminho do WebP no disco (gera agora se faltar). version: muda quando o conteúdo muda sem trocar a chave (ex.: capa refeita).
async function cached(key, { version = '', maxSide = 2000, quality = 80, load = originalBytes } = {}) {
  const f = fileFor(key, version, maxSide);
  try { if (fs.statSync(f).size > 0) return f; } catch { /* ainda não existe */ }
  const id = `${key}|${version}|${maxSide}`;
  if ((failed.get(id) || 0) > Date.now()) return null;
  if (inflight.has(id)) return inflight.get(id);
  const job = (async () => {
    await slot();
    try {
      const { shrink, jpegOrientation } = require('./previews');
      const original = await load(key);
      const out = await shrink(original, maxSide, jpegOrientation(original), quality, 'webp');
      await fs.promises.mkdir(path.dirname(f), { recursive: true });
      const tmp = `${f}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, out);
      await fs.promises.rename(tmp, f); // troca de uma vez: quem lê nunca pega meio arquivo
      return f;
    } catch (err) {
      console.error('[webp]', key, err.message);
      failed.set(id, Date.now() + 10 * 60_000);
      return null;
    } finally { free(); inflight.delete(id); }
  })();
  inflight.set(id, job);
  return job;
}

// Responde com o WebP se der; senão chama fallback() (o jeito de sempre: original pelo servidor ou link do Backblaze).
// headers: os da rota (Cache-Control, CSP, CORP…), aplicados também ao WebP.
async function send(req, res, { key, mime = null, version = '', maxSide = 2000, headers = {}, fallback }) {
  if (!key || !wantsWebp(req) || !convertible(key, mime)) return fallback();
  const f = await cached(key, { version, maxSide });
  if (!f) return fallback();
  res.set({ ...headers, Vary: 'Accept', 'X-Content-Type-Options': 'nosniff' });
  res.type('image/webp');
  return res.sendFile(f);
}

// Limpeza (rotina de 6 h): WebP sem uso há 90 dias sai do disco; se alguém pedir de novo, é refeito.
async function purge(days = 90) {
  let removed = 0;
  let names = [];
  try { names = await fs.promises.readdir(dir()); } catch { return 0; }
  const limit = Date.now() - days * 86400_000;
  for (const n of names) {
    const f = path.join(dir(), n);
    try { const st = await fs.promises.stat(f); if (st.atimeMs < limit && st.mtimeMs < limit) { await fs.promises.rm(f, { force: true }); removed += 1; } } catch { /* sumiu no meio */ }
  }
  return removed;
}

module.exports = { send, cached, wantsWebp, convertible, purge, fileFor };
