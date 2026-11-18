// API pública do site (podcastpulso.com). Sem login nem CSRF: imagens por assinatura; dados só com o que já é público;
// formulários com origem conferida (originCheck aceita só as origens do site), isca, validação campo a campo e limite por IP.
const express = require('express');
const config = require('../config');
const db = require('../db/pool');
const b2 = require('../services/b2');
const guestPhotos = require('../services/guestPhotos');
const siteImages = require('../services/siteImages');
const siteData = require('../services/siteData');
const siteLeads = require('../services/siteLeads');
const webImage = require('../services/webImage');
const { createLimiter } = require('../auth/rateLimit');
const { wrap } = require('../utils/wrap');

const router = express.Router();
const dadosLimiter = createLimiter({ name: 'site_dados', max: 120, windowMs: 10 * 60_000 });
const pedidoLimiter = createLimiter({ name: 'site_pedido', max: 8, windowMs: 10 * 60_000 });

// CORS: só as origens do site (SITE_ORIGIN) recebem a permissão; a resposta varia pela origem.
function cors(req, res) {
  res.vary('Origin');
  const origin = req.get('origin');
  if (origin && config.siteOrigins.includes(origin)) { res.set('Access-Control-Allow-Origin', origin); return true; }
  return false;
}
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

// Tudo o que o site mostra, em um JSON só (contrato versionado: version 1).
router.get('/api/site/v1/dados', wrap(async (req, res) => {
  cors(req, res);
  if (!await dadosLimiter.hit(req.ip)) return res.status(429).json({ ok: false, error: 'Muitas leituras seguidas. Tente de novo em alguns minutos.' });
  const data = await siteData.build();
  res.set({ 'Cache-Control': 'public, max-age=60', 'Cross-Origin-Resource-Policy': 'cross-origin' }).json(data);
}));

// ---- formulários do site: "quero ser convidado" e "quero patrocinar" ----
// O originCheck (middleware.js) só deixa passar estes dois caminhos com Origin de uma das origens do site (ou sem Origin).
// JSON (fetch do site) responde { ok } / { ok: false, field, error }; formulário sem JavaScript volta ao site com 303.
// O 303 só leva o tipo e o nome do campo (da lista abaixo), nunca o que a pessoa digitou.
const FORMS = {
  convidado: { validate: siteLeads.validateGuest, create: siteLeads.createGuest },
  patrocinador: { validate: siteLeads.validateSponsor, create: siteLeads.createSponsor },
};
const FIELDS = new Set(['name', 'instagram', 'country', 'phone', 'email', 'profile', 'privacy', 'company', 'website', 'limite']);
const FORM_PATH = '/api/site/v1/:tipo(convidado|patrocinador)';

router.options(FORM_PATH, (req, res) => {
  if (cors(req, res)) res.set({ 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
  res.status(204).end();
});

router.post(FORM_PATH, wrap(async (req, res) => {
  cors(req, res);
  const { tipo } = req.params;
  const asJson = req.is('application/json');
  const ok = () => (asJson ? res.json({ ok: true }) : res.redirect(303, `${config.siteBaseUrl}/obrigado/?tipo=${tipo}`));
  const no = (status, field, error) => {
    if (asJson) return res.status(status).json(field ? { ok: false, field, error } : { ok: false, error });
    return res.redirect(303, `${config.siteBaseUrl}/ops/?tipo=${tipo}&erro=${FIELDS.has(field) ? field : 'limite'}`);
  };
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  if (typeof body.url_extra === 'string' ? body.url_extra.trim() : body.url_extra) return ok(); // isca para robôs: parece aceitar, não grava
  if (!await pedidoLimiter.hit(req.ip)) return no(429, null, 'Muitos envios seguidos. Aguarde alguns minutos e tente de novo.');
  const form = FORMS[tipo];
  const v = form.validate(body);
  if (v.error) return no(400, v.field, v.error);
  await form.create(v.values);
  return ok();
}));

module.exports = router;
