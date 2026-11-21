// Aprovação por link (/aprovar/:token): a página pública que quem aprova abre pelo WhatsApp. Sem login e sem a sessão do
// painel; abre no endereço e com a marca do projeto. Mostra a pauta (ou o roteiro), o vídeo editado ou as capas, e recebe uma
// resposta só: Aprovar ou Pedir ajustes, com o nome de quem respondeu, um recado geral e, no vídeo, comentários na minutagem.
const express = require('express');
const config = require('../config');
const b2 = require('../services/b2');
const approvals = require('../services/approvals');
const host = require('../services/hostContext');
const { createLimiter } = require('../auth/rateLimit');
const { icon } = require('../utils/icons');
const fmt = require('../utils/format');
const { wrap, isIntId } = require('../utils/wrap');

const router = express.Router();
const viewLimiter = createLimiter({ name: 'aprovacao_ver', max: 300, windowMs: 10 * 60_000 });
const answerLimiter = createLimiter({ name: 'aprovacao_responder', max: 20, windowMs: 10 * 60_000 });

function headers(mediaOrigin) {
  const media = ["'self'"]; const img = ["'self'", 'data:'];
  if (mediaOrigin) { media.push(mediaOrigin); img.push(mediaOrigin); }
  return {
    'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self'; img-src ${img.join(' ')}; media-src ${media.join(' ')}; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Cache-Control': 'no-store',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}
const mediaOrigin = async () => (config.storageConfigured ? b2.endpoint().then((e) => new URL(e).origin).catch(() => null) : null);
const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

// Os comentários do vídeo chegam como listas paralelas (c_at, c_end, c_body): uma linha por comentário.
function commentsFrom(body) {
  const at = list(body.c_at); const end = list(body.c_end); const text = list(body.c_body);
  return text.map((t, i) => ({ at_ms: at[i] === '' ? null : at[i], end_ms: end[i] === '' ? null : end[i], body: t }));
}

async function render(req, res, l, { status = 200, error = null, form = {} } = {}) {
  const state = await approvals.stateOf(l);
  const content = state === 'aberto' || state === 'respondido' ? await approvals.content(l) : {};
  res.status(status).set(headers(await mediaOrigin())).render('approval/page', {
    title: `${approvals.headline(l)} · ${l.public_name || l.project_name}`, l, state, content, error, form,
    base: `/aprovar/${l.token}`, headline: approvals.headline(l), publicName: l.public_name || l.project_name,
    icon, fmt, assetV: res.locals.assetV,
  });
}

async function load(req, res) {
  const l = await approvals.byToken(req.params.token);
  if (!l) {
    res.status(404).set(headers(null)).render('approval/missing', { title: 'Link não encontrado', icon, assetV: res.locals.assetV });
    return null;
  }
  const go = host.wrongHost(req, l.project_id); // link de um projeto aberto em outro domínio: leva para o certo
  if (go) { res.redirect(302, go); return null; }
  return l;
}

router.get('/aprovar/:token', wrap(async (req, res) => {
  if (!await viewLimiter.hit(req.ip)) return res.status(429).send('Muitas requisições.');
  const l = await load(req, res); if (!l) return;
  return render(req, res, l);
}));

router.post('/aprovar/:token', wrap(async (req, res) => {
  if (!await answerLimiter.hit(req.ip)) return res.status(429).send('Muitas requisições. Tente de novo em instantes.');
  const l = await load(req, res); if (!l) return;
  const approved = req.body.resposta === 'aprovar';
  const covers = list(req.body.capa);
  const form = { name: req.body.nome || '', note: req.body.recado || '', covers: covers.map(String), comments: commentsFrom(req.body) };
  if (approvals.needsCover(l, approved, covers)) return render(req, res, l, { status: 422, error: 'Marque a capa (ou as capas) que você aprova.', form });
  const out = await approvals.answer(l.token, { approved, name: req.body.nome, note: req.body.recado, comments: form.comments, covers });
  if (out.error) return render(req, res, l, { status: out.state ? 409 : 422, error: out.state ? null : out.error, form });
  return res.redirect(303, `/aprovar/${l.token}`);
}));

// O vídeo da versão enviada: a versão leve quando existe (abre rápido no celular), ou o original. ?original=1 força o original.
router.get('/aprovar/:token/video', wrap(async (req, res) => {
  if (!await viewLimiter.hit(req.ip)) return res.status(429).send('Muitas requisições.');
  const l = await approvals.byToken(req.params.token);
  if (!l || l.kind !== 'video' || l.revoked_at || new Date(l.expires_at) < new Date()) return res.status(404).end();
  const { rows: [file] } = await require('../db/pool').query('SELECT storage_key FROM episode_files WHERE id = $1', [l.file_id]);
  if (!file) return res.status(404).end();
  const views = require('../services/videoViews');
  const url = req.query.original !== '1' && await views.viewKeyFor(file.storage_key)
    ? await views.playUrl(file.storage_key)
    : await b2.presignGet(file.storage_key, { expires: 6 * 3600 });
  return res.set('Cache-Control', 'no-store').redirect(302, url);
}));

// Imagem de uma capa do link (só as do episódio dele).
router.get('/aprovar/:token/capa/:cid', wrap(async (req, res) => {
  if (!await viewLimiter.hit(req.ip)) return res.status(429).send('Muitas requisições.');
  const l = await approvals.byToken(req.params.token);
  if (!l || l.kind !== 'capas' || l.revoked_at || new Date(l.expires_at) < new Date() || !isIntId(req.params.cid)) return res.status(404).end();
  const { rows: [c] } = await require('../db/pool').query(
    "SELECT storage_key, updated_at FROM episode_covers WHERE id = $1 AND episode_id = $2 AND clip_id IS NULL AND kind = 'youtube_thumb'", [req.params.cid, l.episode_id]);
  if (!c) return res.status(404).end();
  const sent = await require('../services/webImage').send(req, res, {
    key: c.storage_key, version: String(new Date(c.updated_at).getTime()), maxSide: 1280, headers: { 'Cache-Control': 'private, max-age=600' }, fallback: () => false,
  });
  if (sent !== false) return sent;
  return res.set('Cache-Control', 'no-store').redirect(302, await b2.presignGet(c.storage_key, { expires: 3600 }));
}));

module.exports = router;
