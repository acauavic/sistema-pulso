// Conteúdo derivado do episódio, fora do card do episódio: cortes (o editor sobe vários vídeos, o sistema lê e o editor atribui a um
// episódio já gravado), posts e carrosséis; e a publicação nas redes (Upload-Post). Cortar/atribuir: gestão e editor. Publicar: só gestão.
const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const b2 = require('../services/b2');
const jobs = require('../services/jobs');
const clips = require('../services/clips');
const publishing = require('../services/publishing');
const up = require('../services/uploadPost');
const L = require('../services/platformLimits');
const fmt = require('../utils/format');
const C = require('../constants');
const { audit } = require('../services/audit');
const recordChanges = require('../services/recordChanges');
const { requirePerm } = require('../middleware');
const { can } = require('../permissions');
const { wrap, isIntId } = require('../utils/wrap');

const router = express.Router();
const MAX_PART = 70 * 1024 * 1024;
const POST_KINDS = ['post_quote', 'post_split', 'carousel'];
const canCut = (role) => can(role, 'production.review') || can(role, 'production.edit');
const canPublish = (role) => can(role, 'production.review');
const wantsJson = (req) => /json/.test(req.get('accept') || '');
const notFound = (res) => res.status(404).render('error', { title: 'Não encontrado', message: 'Não encontrado.' });
const deny = (req, res, msg = 'Seu perfil não faz isso.') => (wantsJson(req) ? res.status(403).json({ ok: false, error: msg }) : res.status(403).render('error', { title: 'Sem permissão', message: msg }));
const uploadError = (res, status, error) => res.status(status).json({ ok: false, error });
const extOf = (name) => String(name).match(/\.([A-Za-z0-9]{1,6})$/)?.[1]?.toLowerCase() || '';
const clockMs = (s) => L.parseClock(String(s || '').trim());

async function findClip(req) {
  if (!isIntId(req.params.id)) return null;
  const { rows: [c] } = await db.query('SELECT * FROM episode_clips WHERE id = $1', [req.params.id]);
  return c || null;
}

// Episódios que já foram gravados: os únicos que aceitam cortes.
const eligibleEpisodes = () => db.query(
  `SELECT e.id, e.number, e.title, e.status, g.name AS guest_name FROM episodes e LEFT JOIN guests g ON g.id = e.guest_id
    WHERE e.status = ANY($1) ORDER BY e.number DESC NULLS LAST, e.id DESC`, [clips.ELIGIBLE_STATUSES]);

// ---------------------------------------------------------------- tela de conteúdo
router.get('/conteudo', requirePerm('episodes.read'), wrap(async (req, res) => {
  const only = isIntId(req.query.episodio) ? Number(req.query.episodio) : null;
  const [clipRows, covers, episodes, posts, withFrames] = await Promise.all([
    db.query(
      `SELECT c.*, e.number AS ep_number, e.title AS ep_title, g.name AS guest_name FROM episode_clips c
         LEFT JOIN episodes e ON e.id = c.episode_id LEFT JOIN guests g ON g.id = e.guest_id
        ${only ? 'WHERE c.episode_id = $1' : ''} ORDER BY (c.episode_id IS NULL) DESC, c.created_at DESC, c.id DESC`, only ? [only] : []),
    db.query('SELECT id, clip_id, updated_at FROM episode_covers WHERE clip_id IS NOT NULL ORDER BY position'),
    eligibleEpisodes(),
    db.query(
      `SELECT c.id, c.episode_id, c.kind, c.group_key, c.position, c.label, c.lint, c.approved, c.auto, c.width, c.height, c.size_bytes, c.updated_at
         FROM episode_covers c WHERE c.clip_id IS NULL AND c.kind = ANY($1) ${only ? 'AND c.episode_id = $2' : ''} ORDER BY c.episode_id DESC, c.kind, c.group_key, c.position, c.id`, only ? [POST_KINDS, only] : [POST_KINDS]),
    db.query('SELECT DISTINCT episode_id FROM episode_frames WHERE clip_id IS NULL AND episode_id IS NOT NULL'),
  ]);
  const list = clipRows.rows.map((c) => ({ ...c, covers: covers.rows.filter((x) => x.clip_id === c.id) }));
  const byEpisode = {};
  for (const e of episodes.rows) byEpisode[e.id] = e;
  const hasFrames = new Set(withFrames.rows.map((r) => r.episode_id));
  const postGroups = [];
  for (const e of episodes.rows) {
    const mine = posts.rows.filter((p) => p.episode_id === e.id);
    if ((only && e.id !== only) || (!mine.length && !hasFrames.has(e.id))) continue;
    postGroups.push({ episode: e, covers: mine, canGenerate: hasFrames.has(e.id) });
  }
  const moments = only ? await clips.momentsFor(only) : [];
  const running = list.some((c) => ['enviando', 'processando'].includes(c.status));
  res.render('content/index', {
    title: 'Conteúdo', clips: list, episodes: episodes.rows, postGroups, only, onlyEpisode: only ? byEpisode[only] || null : null,
    moments, running, storageReady: config.storageConfigured, aiReady: config.groqConfigured && config.geminiConfigured && config.storageConfigured,
    perm: { cut: canCut(req.user.role), publish: canPublish(req.user.role) || can(req.user.role, 'social.request'), direct: canPublish(req.user.role) }, C,
  });
}));

// ---------------------------------------------------------------- envio dos cortes (vários vídeos de uma vez)
router.post('/cortes/iniciar', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return uploadError(res, 403, 'Só o editor e a gestão enviam cortes.');
  if (!config.storageConfigured) return uploadError(res, 503, 'Armazenamento (Backblaze) não configurado.');
  const filename = String(req.body.nome || '');
  const size = Number(req.body.tamanho);
  if (!Number.isSafeInteger(size) || size <= 0) return uploadError(res, 400, 'Arquivo vazio.');
  if (size > clips.MAX_BYTES) return uploadError(res, 400, 'Arquivo grande demais para um corte.');
  if (!clips.VIDEO_EXT.includes(extOf(filename))) return uploadError(res, 400, `Envie vídeo (${clips.VIDEO_EXT.join(', ')}).`);
  const { clip, partSize, totalParts } = await clips.startUpload({ filename, size, contentType: req.body.tipo, userId: req.user.id });
  res.json({ ok: true, id: clip.id, partSize, totalParts });
}));

async function uploadingClip(req) {
  const c = await findClip(req);
  return c && c.status === 'enviando' ? c : null;
}
router.put('/cortes/:id/parte/:n', requirePerm('episodes.read'), express.raw({ type: () => true, limit: MAX_PART }), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return uploadError(res, 403, 'Sem permissão.');
  const clip = await uploadingClip(req);
  if (!clip) return uploadError(res, 404, 'Envio não encontrado ou já concluído.');
  const n = Number.parseInt(req.params.n, 10);
  const total = Math.max(1, Math.ceil(Number(clip.size_bytes) / clip.part_size));
  if (!Number.isInteger(n) || n < 1 || n > total) return uploadError(res, 400, 'Parte inválida.');
  const expected = n < total ? clip.part_size : Number(clip.size_bytes) - clip.part_size * (total - 1);
  if (!Buffer.isBuffer(req.body) || req.body.length !== expected) return uploadError(res, 400, `A parte ${n} deveria ter ${expected} bytes e chegou com ${Buffer.isBuffer(req.body) ? req.body.length : 0}.`);
  await clips.receivePart(clip, n, req.body);
  res.json({ ok: true });
}));
router.post('/cortes/:id/concluir', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return uploadError(res, 403, 'Sem permissão.');
  const clip = await findClip(req);
  if (!clip) return uploadError(res, 404, 'Corte não encontrado.');
  if (clip.status !== 'enviando') return res.json({ ok: true, id: clip.id });
  const result = await clips.finishUpload(clip);
  if (result.error) return uploadError(res, 409, result.error);
  await audit(req, 'corte.enviado', 'clip', clip.id, { arquivo: clip.filename });
  res.json({ ok: true, id: clip.id });
}));
router.post('/cortes/:id/cancelar', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return uploadError(res, 403, 'Sem permissão.');
  const clip = await uploadingClip(req);
  if (!clip) return uploadError(res, 404, 'Envio não encontrado.');
  await clips.cancelUpload(clip);
  res.json({ ok: true });
}));

// andamento (a tela consulta enquanto algum corte está enviando/processando)
router.get('/cortes/status', requirePerm('episodes.read'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.status, c.error, j.message, j.progress FROM episode_clips c
       LEFT JOIN LATERAL (SELECT message, progress FROM jobs WHERE kind = 'corte' AND ref_id = c.id ORDER BY id DESC LIMIT 1) j ON true
      WHERE c.status IN ('enviando', 'processando') OR c.updated_at > now() - interval '2 minutes'`);
  const { rows: pubs } = await db.query("SELECT id, status FROM episode_publications WHERE status = 'enviando' OR updated_at > now() - interval '2 minutes'");
  res.json({ ok: true, clips: rows, publications: pubs });
}));

// ---------------------------------------------------------------- um corte
router.get('/cortes/:id', requirePerm('episodes.read'), wrap(async (req, res) => {
  const c = await findClip(req);
  if (!c) return notFound(res);
  const [covers, pubs, episodes, ep] = await Promise.all([
    db.query('SELECT id, kind, position, label, lint, approved, auto, updated_at FROM episode_covers WHERE clip_id = $1 ORDER BY position', [c.id]),
    db.query('SELECT * FROM episode_publications WHERE clip_id = $1 ORDER BY created_at DESC, id DESC', [c.id]),
    eligibleEpisodes(),
    c.episode_id ? db.query('SELECT e.id, e.number, e.title, g.name AS guest_name FROM episodes e LEFT JOIN guests g ON g.id = e.guest_id WHERE e.id = $1', [c.episode_id]) : { rows: [] },
  ]);
  const social = canPublish(req.user.role) && config.uploadPostConfigured ? await up.connected() : null;
  const thread = await require('../services/comments').list('clip', c.id);
  res.render('content/clip', {
    comments: thread,
    title: c.title, clip: c, covers: covers.rows, publications: pubs.rows, episodes: episodes.rows, episode: ep.rows[0] || null, social,
    uploadPost: up, uploadLive: config.uploadPost.live, L, C,
    running: ['enviando', 'processando'].includes(c.status) || pubs.rows.some((p) => p.status === 'enviando'),
    perm: { cut: canCut(req.user.role), publish: canPublish(req.user.role) || can(req.user.role, 'social.request'), direct: canPublish(req.user.role) },
  });
}));

router.post('/cortes/:id', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return deny(req, res);
  const c = await findClip(req); if (!c) return notFound(res);
  const title = fmt.clean(req.body.title, 80) || c.title;
  const postTitle = fmt.clean(req.body.post_title, 100) || null;
  const caption = String(req.body.caption ?? c.caption ?? '').replace(/\r/g, '').slice(0, 2200);
  const before = await recordChanges.snapshot('clip', c.id);
  await db.query('UPDATE episode_clips SET title = $2, post_title = $3, caption = $4, updated_at = now() WHERE id = $1', [c.id, title, postTitle, caption]);
  await recordChanges.updated({ type: 'clip', before, actor: req.user });
  await req.flash('ok', 'Corte salvo.');
  res.redirect(`/cortes/${c.id}`);
}));

router.post('/cortes/:id/atribuir', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return deny(req, res);
  const c = await findClip(req); if (!c) return notFound(res);
  const back = req.body.voltar === 'lista' ? '/conteudo' : `/cortes/${c.id}`;
  const result = await clips.assign(c.id, req.body.episode_id, req.user.id);
  if (result.error) await req.flash('error', result.error);
  else {
    await audit(req, 'corte.atribuido', 'clip', c.id, { episodio: result.episode.id });
    await req.flash('ok', `Atribuído ao ${result.episode.number ? `EP.${String(result.episode.number).padStart(3, '0')}` : 'episódio'} ${result.episode.title}.`);
  }
  res.redirect(back);
}));

router.post('/cortes/:id/reprocessar', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return deny(req, res);
  const c = await findClip(req); if (!c) return notFound(res);
  if (!['pronto', 'erro'].includes(c.status) || !c.storage_key) { await req.flash('error', 'Este corte ainda não pode ser lido de novo.'); return res.redirect(`/cortes/${c.id}`); }
  await db.query("UPDATE episode_clips SET status = 'processando', error = NULL, updated_at = now() WHERE id = $1", [c.id]);
  await jobs.enqueue('corte', { refId: c.id });
  await req.flash('ok', 'Lendo o corte de novo. Isso leva alguns minutos.');
  res.redirect(`/cortes/${c.id}`);
}));

router.post('/cortes/:id/excluir', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return deny(req, res);
  const c = await findClip(req); if (!c) return notFound(res);
  const gone = await recordChanges.snapshot('clip', c.id);
  await clips.removeClip(c.id);
  await recordChanges.deleted({ type: 'clip', row: gone, actor: req.user });
  await audit(req, 'corte.excluido', 'clip', c.id, { episodio: c.episode_id });
  res.redirect('/conteudo');
}));

router.get('/cortes/:id/video', requirePerm('episodes.read'), wrap(async (req, res) => {
  const c = await findClip(req); if (!c || !c.storage_key || c.status === 'enviando') return notFound(res);
  const url = await b2.presignGet(c.storage_key, { expires: 3600, download: req.query.baixar === '1' ? `${fmt.slugify(c.title) || `corte-${c.id}`}.mp4` : null });
  res.set('Cache-Control', 'private, max-age=60').redirect(302, url);
}));

router.post('/cortes/:id/capa', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return deny(req, res);
  const c = await findClip(req); if (!c) return notFound(res);
  if (!isIntId(req.body.cover_id)) return notFound(res);
  const { rows: [cv] } = await db.query("SELECT id FROM episode_covers WHERE id = $1 AND clip_id = $2 AND kind = 'reel_cover'", [req.body.cover_id, c.id]);
  if (!cv) return notFound(res);
  await db.query('UPDATE episode_clips SET cover_id = $2, updated_at = now() WHERE id = $1', [c.id, cv.id]);
  await db.query('UPDATE episode_covers SET approved = (id = $2) WHERE clip_id = $1', [c.id, cv.id]);
  res.redirect(`/cortes/${c.id}`);
}));

// ---------------------------------------------------------------- publicação
function readPublishForm(req) {
  const platforms = [].concat(req.body.platforms || []).map(String).filter((p) => up.PLATFORMS[p]);
  const title = fmt.clean(req.body.title);
  const description = String(req.body.description || '').replace(/\r/g, '').trim();
  let scheduledAt = null;
  if (req.body.agendar) { const d = fmt.parseInputDateTime(String(req.body.agendar)); scheduledAt = d ? d.toISOString() : 'invalid'; }
  return { platforms, title, description, scheduledAt };
}

async function publish(req, res, { episodeId, clipId }) {
  const home = clipId ? `/cortes/${clipId}` : `/episodios/${episodeId}#publicacao`;
  // corte: a produtora pode pedir (vai para a revisão da gestão); o episódio inteiro só a gestão publica
  const review = !canPublish(req.user.role) && Boolean(clipId) && can(req.user.role, 'social.request');
  if (!canPublish(req.user.role) && !review) return deny(req, res, 'Só a gestão publica nas redes.');
  const form = readPublishForm(req);
  const fail = async (msg) => { if (wantsJson(req)) return res.status(422).json({ ok: false, error: msg }); await req.flash('error', msg); return res.redirect(home); };
  if (form.scheduledAt === 'invalid') return fail('Data de agendamento inválida.');
  if (req.body.confirmar !== '1' && !review) return fail('Confirme o envio marcando "Entendi que isto publica nas redes escolhidas".');
  try {
    const pub = await publishing.create({ episodeId, clipId, ...form, userId: req.user.id, review });
    await audit(req, 'publicacao.criada', 'publication', pub.id, { redes: pub.platforms, simulado: pub.status === 'simulado' });
    if (wantsJson(req)) return res.json({ ok: true, publication: pub });
    await req.flash(pub.status === 'erro' ? 'error' : 'ok',
      pub.status === 'revisao' ? 'Enviado para a revisão da gestão. Você recebe um aviso quando for aprovado ou devolvido.'
        : pub.status === 'simulado' ? 'Modo de teste: o pedido foi montado e conferido, mas NADA foi enviado (UPLOAD_POST_LIVE não está ligado).'
        : pub.status === 'agendado' ? 'Publicação agendada.' : pub.status === 'erro' ? `Não foi possível enviar: ${pub.error}` : 'Enviado ao Upload-Post. O andamento aparece abaixo.');
  } catch (err) {
    return fail(err.message);
  }
  return res.redirect(home);
}
router.post('/episodios/:id/publicar', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return notFound(res);
  return publish(req, res, { episodeId: req.params.id, clipId: null });
}));
router.post('/cortes/:id/publicar', requirePerm('episodes.read'), wrap(async (req, res) => {
  const c = await findClip(req); if (!c) return notFound(res);
  return publish(req, res, { episodeId: c.episode_id, clipId: c.id });
}));

async function findPub(req) {
  if (!isIntId(req.params.id) || !isIntId(req.params.pid)) return null;
  const { rows: [p] } = await db.query('SELECT * FROM episode_publications WHERE id = $1 AND episode_id = $2', [req.params.pid, req.params.id]);
  return p || null;
}
const pubHome = (p) => (p.clip_id ? `/cortes/${p.clip_id}` : `/episodios/${p.episode_id}#publicacao`);
router.post('/episodios/:id/publicacoes/:pid/atualizar', requirePerm('episodes.read'), wrap(async (req, res) => {
  const p = await findPub(req); if (!p) return notFound(res);
  await publishing.refresh(p.id);
  res.redirect(pubHome(p));
}));
router.post('/episodios/:id/publicacoes/:pid/repetir', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canPublish(req.user.role)) return deny(req, res, 'Só a gestão publica nas redes.');
  const p = await findPub(req); if (!p) return notFound(res);
  await publishing.retry(p.id);
  res.redirect(pubHome(p));
}));
router.post('/episodios/:id/publicacoes/:pid/cancelar', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canPublish(req.user.role)) return deny(req, res, 'Só a gestão publica nas redes.');
  const p = await findPub(req); if (!p) return notFound(res);
  await publishing.cancel(p.id);
  res.redirect(pubHome(p));
}));

module.exports = router;
