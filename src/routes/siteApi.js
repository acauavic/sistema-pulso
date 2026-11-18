// API pública do site (podcastpulso.com). Sem login nem CSRF: o que protege é a assinatura (imagens) e o segredo do site (dados e formulários).
const express = require('express');
const db = require('../db/pool');
const b2 = require('../services/b2');
const guestPhotos = require('../services/guestPhotos');
const siteImages = require('../services/siteImages');
const webImage = require('../services/webImage');
const { wrap } = require('../utils/wrap');

const router = express.Router();
const CACHE = 'public, max-age=3600';
const notFound = (res) => res.status(404).type('text').send('Imagem não encontrada.'); // a mesma resposta para assinatura ruim, vencida ou sem imagem

// Logo e capa: WebP quando o navegador aceita; senão o original pelo servidor (o bucket é privado).
async function sendKey(req, res, { key, mime, version, maxSide }) {
  const headers = { 'Cache-Control': CACHE, 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'cross-origin' };
  let sent = true;
  await webImage.send(req, res, {
    key, mime, version, maxSide, headers,
    fallback: async () => {
      const obj = await b2.getObject(key).catch(() => null);
      if (!obj) { sent = false; return; }
      res.set({ ...headers, 'Content-Type': mime || obj.headers.get('content-type') || 'image/png', 'X-Content-Type-Options': 'nosniff' });
      res.send(Buffer.from(await obj.arrayBuffer()));
    },
  });
  return sent;
}

const SOURCES = {
  foto: async (req, res, id) => guestPhotos.send(res, id, req, CACHE),
  logo: async (req, res, id) => {
    const { rows: [f] } = await db.query("SELECT id, storage_key, content_type FROM sponsor_files WHERE sponsor_id = $1 AND kind = 'logo' ORDER BY created_at DESC, id DESC LIMIT 1", [id]);
    return f ? sendKey(req, res, { key: f.storage_key, mime: f.content_type, version: String(f.id), maxSide: 800 }) : false;
  },
  capa: async (req, res, id) => {
    const { rows: [c] } = await db.query('SELECT storage_key, mime, updated_at FROM episode_covers WHERE id = $1', [id]);
    return c ? sendKey(req, res, { key: c.storage_key, mime: c.mime, version: String(new Date(c.updated_at).getTime()), maxSide: 640 }) : false;
  },
};

router.get('/api/site/v1/imagem/:kind/:id', wrap(async (req, res) => {
  const { kind, id } = req.params;
  if (!Object.hasOwn(SOURCES, kind) || !siteImages.verify(kind, id, req.query.e, req.query.s)) return notFound(res);
  if (!await SOURCES[kind](req, res, Number(id))) return notFound(res);
}));

module.exports = router;
