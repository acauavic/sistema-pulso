// Pedidos de conteúdo (Conteúdo > Pedidos): pedir, começar, entregar (vídeo ou imagens), revisar (aprovar ou pedir ajustes).
// Quem pede: gestão e produtora. Quem faz: o responsável (ou um editor, se ninguém foi escolhido). Quem aprova: gestão.
const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const clips = require('../services/clips');
const R = require('../services/contentRequests');
const attachments = require('../services/attachments');
const richText = require('../services/richText');
const { audit } = require('../services/audit');
const { requirePerm } = require('../middleware');
const { can } = require('../permissions');
const { wrap, isIntId } = require('../utils/wrap');

const router = express.Router();
const wantsJson = (req) => /json/.test(req.get('accept') || '');
const notFound = (res) => res.status(404).render('error', { title: 'Não encontrado', message: 'Pedido não encontrado.' });
const deny = (req, res, msg = 'Seu perfil não faz isso neste pedido.') => (wantsJson(req) ? res.status(403).json({ ok: false, error: msg }) : res.status(403).render('error', { title: 'Sem permissão', message: msg }));
const extOf = (name) => String(name).match(/\.([A-Za-z0-9]{1,6})$/)?.[1]?.toLowerCase() || '';
const canEdit = (user, r) => R.canReview(user.role) || String(r.created_by || '') === String(user.id);

async function load(req) { return isIntId(req.params.id || req.params.pid) ? R.get(req.params.id || req.params.pid) : null; }

// Quem pode receber um pedido (quem edita) e os episódios para ligar (os mais recentes primeiro).
const people = () => db.query("SELECT id, name, role FROM users WHERE active AND role IN ('editor_video','gestao','superadmin') ORDER BY (role = 'editor_video') DESC, name").then((r) => r.rows);
const episodeOptions = () => db.query("SELECT id, number, title FROM episodes ORDER BY number DESC NULLS LAST, id DESC LIMIT 80").then((r) => r.rows);

router.post('/conteudo/pedidos', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!R.canRequest(req.user.role)) return deny(req, res, 'Seu perfil não pede conteúdo.');
  const { values, error } = R.parse(req.body);
  if (error) { await req.flash('error', error); return res.redirect('/conteudo?pedir=1'); }
  const r = await R.create(values, req.user);
  await attachments.link([...(values.attachmentIds || []), ...[].concat(req.body.attachment_ids || [])], 'content_request', r.id, req.user);
  await audit(req, 'pedido.criado', 'content_request', r.id, { tipo: r.kind, titulo: r.title });
  await req.flash('ok', r.assignee_id ? `Pedido enviado para ${r.assignee_name}.` : 'Pedido criado. Qualquer editor pode começar.');
  res.redirect(R.url(r.id));
}));

router.get('/conteudo/pedidos/:id', requirePerm('episodes.read'), wrap(async (req, res) => {
  const r = await load(req); if (!r) return notFound(res);
  const [d, thread, files, ppl, eps] = await Promise.all([R.deliveries(r.id), require('../services/comments').list('content_request', r.id), attachments.forEntity('content_request', r.id), people(), episodeOptions()]);
  const board = require('../services/contentBoard');
  const idx = r.status === 'aprovado' ? await board.publicationIndex() : null;
  const pubOf = (v) => (idx ? board.stateOf(idx.byClip.get(v.id)) : null);
  const imagesPub = idx && d.images.length ? (R.KINDS[r.kind].publish === 'carrossel' ? board.stateOfCovers(idx, d.images.map((i) => i.id)) : null) : null;
  res.render('content/request', {
    title: r.title, r, videos: d.videos.map((v) => ({ ...v, pub: pubOf(v) })), images: d.images.map((i) => ({ ...i, pub: idx && !imagesPub ? board.stateOf(idx.byCover.get(i.id)) : imagesPub })),
    comments: thread, docs: files.filter((a) => a.kind === 'file'), people: ppl, episodeList: eps, K: R.KINDS, S: R.STATUSES, F: R.FORMATS,
    today: new Date().toISOString().slice(0, 10), storageReady: config.storageConfigured,
    perm: { edit: canEdit(req.user, r), work: R.canWork(req.user, r), mine: R.isMine(req.user, r), review: R.canReview(req.user.role), publish: can(req.user.role, 'social.request') },
    running: d.videos.some((v) => ['enviando', 'processando'].includes(v.status)),
  });
}));

router.post('/conteudo/pedidos/:id', requirePerm('episodes.read'), wrap(async (req, res) => {
  const r = await load(req); if (!r) return notFound(res);
  if (!canEdit(req.user, r)) return deny(req, res, 'Só quem pediu e a gestão mudam o pedido.');
  const { values, error } = R.parse({ ...r, due_on: r.due_on ? new Date(r.due_on).toISOString().slice(0, 10) : '', briefing_html: r.briefing_html || richText.fromPlain(r.briefing || ''), ...req.body });
  if (error) { await req.flash('error', error); return res.redirect(R.url(r.id)); }
  await R.update(r, values, req.user);
  await attachments.link([...(values.attachmentIds || []), ...[].concat(req.body.attachment_ids || [])], 'content_request', r.id, req.user);
  await audit(req, 'pedido.editado', 'content_request', r.id, { titulo: values.title });
  await req.flash('ok', 'Pedido salvo.');
  res.redirect(R.url(r.id));
}));

const ACTIONS = {
  comecar: { who: 'work', run: (r, u) => R.start(r, u), ok: 'Pedido em produção. Quando terminar, envie a entrega aqui.', audit: 'pedido.comecado' },
  entregar: { who: 'work', run: (r, u) => R.deliver(r, u), ok: 'Entrega enviada para a revisão da gestão.', audit: 'pedido.entregue' },
  aprovar: { who: 'review', run: (r, u) => R.approve(r, u), ok: 'Aprovado. A entrega já aparece no Social para publicar.', audit: 'pedido.aprovado' },
  ajustes: { who: 'review', run: (r, u, b) => R.askChanges(r, u, b.nota), ok: 'Ajustes pedidos. O editor foi avisado.', audit: 'pedido.ajustes' },
  cancelar: { who: 'edit', run: (r) => R.cancel(r), ok: 'Pedido cancelado.', audit: 'pedido.cancelado' },
  reabrir: { who: 'edit', run: (r) => R.reopen(r), ok: 'Pedido reaberto.', audit: 'pedido.reaberto' },
};
router.post('/conteudo/pedidos/:id/:acao(comecar|entregar|aprovar|ajustes|cancelar|reabrir)', requirePerm('episodes.read'), wrap(async (req, res) => {
  const r = await load(req); if (!r) return notFound(res);
  const a = ACTIONS[req.params.acao];
  const allowed = { work: R.canWork(req.user, r), review: R.canReview(req.user.role), edit: canEdit(req.user, r) }[a.who];
  if (!allowed) return deny(req, res);
  const out = await a.run(r, req.user, req.body);
  if (out.error) { await req.flash('error', out.error); return res.redirect(R.url(r.id)); }
  await audit(req, a.audit, 'content_request', r.id, { titulo: r.title, ...(req.params.acao === 'ajustes' ? { nota: String(req.body.nota || '').slice(0, 200) } : {}) });
  await req.flash('ok', a.ok);
  res.redirect(req.params.acao === 'cancelar' ? '/conteudo?vista=pedidos' : R.url(r.id));
}));

// ---------------------------------------------------------------- entrega em vídeo (mesma fila de envio dos cortes)
router.post('/conteudo/pedidos/:pid/cortes/iniciar', requirePerm('episodes.read'), wrap(async (req, res) => {
  const r = await load(req);
  if (!r) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
  if (!R.canWork(req.user, r) || !can(req.user.role, 'production.edit')) return res.status(403).json({ ok: false, error: 'Só quem faz o pedido envia a entrega.' });
  if (r.status !== 'producao') return res.status(409).json({ ok: false, error: r.status === 'pedido' ? 'Comece o pedido antes de enviar.' : 'O pedido não está em produção.' });
  if (!config.storageConfigured) return res.status(503).json({ ok: false, error: 'Armazenamento (Backblaze) não configurado.' });
  const filename = String(req.body.nome || ''); const size = Number(req.body.tamanho);
  if (!Number.isSafeInteger(size) || size <= 0) return res.status(400).json({ ok: false, error: 'Arquivo vazio.' });
  if (size > clips.MAX_BYTES) return res.status(400).json({ ok: false, error: 'Arquivo grande demais.' });
  if (!clips.VIDEO_EXT.includes(extOf(filename))) return res.status(400).json({ ok: false, error: `Envie vídeo (${clips.VIDEO_EXT.join(', ')}).` });
  const { clip, partSize, totalParts } = await clips.startUpload({ filename, size, contentType: req.body.tipo, userId: req.user.id, requestId: r.id, episodeId: await R.clipEpisode(r) });
  await db.query('UPDATE episode_clips SET title = $2 WHERE id = $1', [clip.id, r.title.slice(0, 80)]);
  res.json({ ok: true, id: clip.id, partSize, totalParts });
}));

// ---------------------------------------------------------------- entrega em imagem (uma por envio; a tela manda várias em sequência)
router.post('/conteudo/pedidos/:id/imagens', requirePerm('episodes.read'), express.raw({ type: () => true, limit: R.MAX_IMAGE + 1024 }), wrap(async (req, res) => {
  const r = await load(req);
  if (!r) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
  if (!R.canWork(req.user, r)) return res.status(403).json({ ok: false, error: 'Só quem faz o pedido envia a entrega.' });
  if (r.status !== 'producao') return res.status(409).json({ ok: false, error: r.status === 'pedido' ? 'Comece o pedido antes de enviar.' : 'O pedido não está em produção.' });
  if (!config.storageConfigured) return res.status(503).json({ ok: false, error: 'Armazenamento (Backblaze) não configurado.' });
  const out = await R.addImage(r, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
  if (out.error) return res.status(400).json({ ok: false, error: out.error });
  res.json({ ok: true, image: out.image });
}));

router.post('/conteudo/pedidos/:id/imagens/:cid/excluir', requirePerm('episodes.read'), wrap(async (req, res) => {
  const r = await load(req); if (!r) return notFound(res);
  if (!R.canWork(req.user, r) || r.status !== 'producao' || !isIntId(req.params.cid)) return deny(req, res, 'Só dá para tirar imagens enquanto o pedido está em produção.');
  await R.removeImage(r, Number(req.params.cid));
  res.redirect(R.url(r.id));
}));

module.exports = router;
