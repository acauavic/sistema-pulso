// Portal do convidado, lado público: /convidado/<token>. Sem login: o token secreto na URL é a chave (como no convite).
// Só leitura, mais o pedido de collab do episódio no YouTube. Mídias saem por redirecionamento assinado (Backblaze) ou do disco (prévias).
const express = require('express');
const config = require('../config');
const portal = require('../services/guestPortal');
const b2 = require('../services/b2');
const db = require('../db/pool');
const tpl = require('../services/inviteTemplate');
const pages = require('../services/publicPages');
const { createLimiter } = require('../auth/rateLimit');
const { icon } = require('../utils/icons');
const { brand } = require('../utils/brandIcons');
const fmt = require('../utils/format');
const { wrap, isIntId } = require('../utils/wrap');

const router = express.Router();
const viewLimiter = createLimiter({ name: 'portal_convidado', max: 300, windowMs: 10 * 60_000 });
const writeLimiter = createLimiter({ name: 'portal_convidado_pedido', max: 10, windowMs: 10 * 60_000 });

// Capas e cortes saem do sistema e são redirecionados para o Backblaze: as duas origens precisam valer. Os players do YouTube e do
// Spotify entram por iframe. O YouTube recusa o player sem a origem de quem incorpora, por isso só a origem vai como referência.
// O do YouTube só carrega no clique (capa do i.ytimg.com até lá): carregado junto, ele travava o play do Spotify.
function headers(mediaOrigin) {
  const media = ["'self'"]; if (mediaOrigin) media.push(mediaOrigin);
  const img = ["'self'", 'data:', 'https://i.ytimg.com']; if (mediaOrigin) img.push(mediaOrigin);
  return {
    'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self'; img-src ${img.join(' ')}; media-src ${media.join(' ')}; frame-src https://www.youtube-nocookie.com https://open.spotify.com; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}
const expiredPage = (res) => res.status(410).set(tpl.publicHeaders()).type('html')
  .send(pages.messageHtml('Este material não está mais disponível', 'O portal fica no ar por 60 dias. Se precisar de algum arquivo, fale com a produção do Pulso.'));
const gone = (res) => res.status(404).set(tpl.publicHeaders()).type('html')
  .send(pages.messageHtml('Link não encontrado', 'Este link não é válido ou foi substituído por um mais recente. Fale com a produção do Pulso para receber o novo.'));

async function load(req, res) {
  if (!await viewLimiter.hit(req.ip)) { res.status(429).send('Muitas requisições.'); return null; }
  const g = await portal.byToken(req.params.token);
  if (!g) { gone(res); return null; }
  if (portal.expired(g)) { expiredPage(res); return null; }
  return g;
}

router.get('/convidado/:token', wrap(async (req, res) => {
  const g = await load(req, res); if (!g) return;
  const c = await portal.content(g);
  const origin = config.storageConfigured ? await b2.endpoint().then((e) => new URL(e).origin).catch(() => null) : null;
  res.set(headers(origin)).render('portal/guest', {
    g, c, steps: portal.schedule(g), dayLabel: portal.dayLabel, base: `/convidado/${g.portal_token}`, icon, fmt, brand,
    ytEmbed: portal.youtubeEmbed(c.episode.youtube), spEmbed: portal.spotifyEmbed(c.episode.spotify), validDays: portal.VALID_DAYS,
    epNo: g.episode_number ? `EP.${String(g.episode_number).padStart(3, '0')}` : null, first: fmt.firstName(g.name),
    ytSent: req.query.youtube === 'ok', ytError: req.query.youtube === 'erro', ytUrl: portal.youtubeUrl(g.portal_yt_channel),
    assetV: res.locals.assetV, title: `Seu portal no ${config.podcastName}`,
  });
}));

// Capa de um post ou de um corte que está no portal (nada além disso).
router.get('/convidado/:token/capa/:cid', wrap(async (req, res) => {
  const g = await load(req, res); if (!g) return;
  if (!isIntId(req.params.cid)) return res.status(404).end();
  const c = await portal.content(g);
  const allowed = new Set([...c.posts.map((p) => p.cover), ...(c.exclusiveOpen ? c.exclusive.map((x) => x.cover_id) : [])].filter(Boolean).map(Number));
  if (!allowed.has(Number(req.params.cid))) return res.status(404).end();
  const { rows: [cv] } = await db.query('SELECT storage_key FROM episode_covers WHERE id = $1', [req.params.cid]);
  if (!cv?.storage_key) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=600').redirect(302, await b2.presignGet(cv.storage_key, { expires: 3600 }));
}));

// Corte exclusivo: assistir (inline) ou baixar.
router.get(['/convidado/:token/cortes/:id', '/convidado/:token/cortes/:id/baixar'], wrap(async (req, res) => {
  const g = await load(req, res); if (!g) return;
  if (!isIntId(req.params.id)) return res.status(404).end();
  const c = await portal.content(g);
  const clip = c.exclusiveOpen ? c.exclusive.find((x) => x.id === Number(req.params.id)) : null;
  if (!clip) return res.status(404).end();
  const { rows: [row] } = await db.query('SELECT storage_key FROM episode_clips WHERE id = $1', [clip.id]);
  const download = req.path.endsWith('/baixar') ? `${fmt.slugify(clip.post_title || clip.title) || `corte-${clip.id}`}.mp4` : null;
  res.set('Cache-Control', 'private, max-age=60').redirect(302, await b2.presignGet(row.storage_key, { expires: 6 * 3600, download }));
}));

// Fotos escolhidas: prévia (t = miniatura, p = grande) do disco do servidor, ou o arquivo original para baixar.
router.get(['/convidado/:token/fotos/:fid', '/convidado/:token/fotos/:fid/baixar'], wrap(async (req, res) => {
  const g = await load(req, res); if (!g) return;
  if (!isIntId(req.params.fid)) return res.status(404).end();
  const c = await portal.content(g);
  if (!c.photos.some((f) => f.id === Number(req.params.fid))) return res.status(404).end();
  const { rows: [file] } = await db.query('SELECT * FROM episode_files WHERE id = $1', [req.params.fid]);
  if (req.path.endsWith('/baixar')) return res.set('Cache-Control', 'no-store').redirect(302, await b2.presignGet(file.storage_key, { expires: 3600, download: file.filename }));
  const disk = await require('../services/previews').get(file, req.query.t === 'p' ? 'p' : 't');
  if (!disk) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=86400').type('image/jpeg').sendFile(disk);
}));

// Todas as fotos num ZIP só (em vez de dezenas de downloads), montado enquanto baixa.
router.get('/convidado/:token/fotos.zip', wrap(async (req, res) => {
  const g = await load(req, res); if (!g) return;
  const c = await portal.content(g);
  if (!c.photos.length) return res.status(404).end();
  const name = `pulso-${g.episode_number ? `ep${String(g.episode_number).padStart(3, '0')}-` : ''}${fmt.slugify(g.name) || 'fotos'}-fotos.zip`;
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
  const zip = require('../utils/zipStream').zipStream(res);
  try {
    for (const f of c.photos) {
      const { rows: [file] } = await db.query('SELECT storage_key, filename, created_at FROM episode_files WHERE id = $1', [f.id]);
      const obj = file && await b2.getObject(file.storage_key);
      if (!obj) continue;
      await zip.add(file.filename, Buffer.from(await obj.arrayBuffer()), new Date(file.created_at));
    }
    await zip.end();
  } catch (err) {
    if (err.message !== 'cancelado') { console.error(`[portal ${g.id}] zip das fotos:`, err.message); res.destroy(err); }
  }
}));

// "Falar com a produção": WhatsApp da produção com a mensagem do portal.
router.get('/convidado/:token/producao', wrap(async (req, res) => {
  const g = await load(req, res); if (!g) return;
  res.redirect(302, await require('../services/contacts').waUrl('producao', 'portal', g.name));
}));

// Pedido do convidado: o episódio no YouTube em collab com o canal dele.
router.post('/convidado/:token/youtube', wrap(async (req, res) => {
  const g = await load(req, res); if (!g) return;
  const back = `/convidado/${g.portal_token}`;
  if (!await writeLimiter.hit(req.ip)) return res.status(429).send('Muitas requisições. Tente de novo em alguns minutos.');
  const channel = portal.parseChannel(req.body.canal);
  if (!channel) return res.redirect(303, `${back}?youtube=erro#youtube`);
  await portal.requestYoutube(g, channel);
  res.redirect(303, `${back}?youtube=ok#youtube`);
}));

module.exports = router;
