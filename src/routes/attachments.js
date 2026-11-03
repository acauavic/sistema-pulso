// Anexos (imagem, PDF, HTML, ZIP e áudio com transcrição) e miniatura de links, usados nas tarefas e nos comentários.
const express = require('express');
const attachments = require('../services/attachments');
const linkPreview = require('../services/linkPreview');
const { createLimiter } = require('../auth/rateLimit');
const { can } = require('../permissions');
const { wrap, isIntId } = require('../utils/wrap');

const router = express.Router();
const uploadLimiter = createLimiter({ name: 'anexos', max: 80, windowMs: 10 * 60_000 });
const previewLimiter = createLimiter({ name: 'previa-link', max: 240, windowMs: 10 * 60_000 });
const fail = (res, status, error) => res.status(status).json({ ok: false, error });
const canUpload = (user) => can(user.role, 'tasks.write') || can(user.role, 'comments.write');
const view = (a) => ({ id: a.id, kind: a.kind, name: a.filename, type: a.content_type, size: Number(a.size_bytes), url: `/anexos/${a.id}`, transcript: a.transcript || null, duration_ms: a.duration_ms || null });

// Envio: o corpo é o arquivo cru; o nome vai em X-Filename (codificado) e, para áudio, a duração em X-Duration-Ms.
router.post('/anexos', express.raw({ type: () => true, limit: attachments.MAX_BODY }), wrap(async (req, res) => {
  if (!canUpload(req.user)) return fail(res, 403, 'Seu perfil não envia anexos.');
  if (!await uploadLimiter.hit(req.user.id)) return fail(res, 429, 'Muitos envios seguidos. Espere alguns minutos.');
  let filename = '';
  try { filename = decodeURIComponent(String(req.get('x-filename') || '')); } catch { filename = ''; }
  const r = await attachments.store({ buf: req.body, filename, contentType: req.get('content-type'), user: req.user, durationMs: Number(req.get('x-duration-ms')) });
  if (r.error) return fail(res, r.status || 400, r.error);
  res.json({ ok: true, attachment: view(r.attachment), transcribeError: r.transcribeError || null });
}));

// Leitura: endereço assinado e curto do bucket. Imagem e áudio abrem na tela; documento sempre baixa.
const open = (forceDownload) => wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return res.status(404).send('Não encontrado.');
  const { rows: [att] } = await require('../db/pool').query('SELECT * FROM attachments WHERE id = $1', [req.params.id]);
  if (!att || !await attachments.canView(req.user, att)) return res.status(404).send('Não encontrado.');
  res.set('Cache-Control', 'private, max-age=300').redirect(302, await attachments.presign(att, { download: forceDownload }));
});
router.get('/anexos/:id', open(false));
router.get('/anexos/:id/baixar', open(true));

router.post('/anexos/:id/excluir', wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return fail(res, 404, 'Não encontrado.');
  const { rows: [att] } = await require('../db/pool').query('SELECT * FROM attachments WHERE id = $1', [req.params.id]);
  if (!att) return fail(res, 404, 'Não encontrado.');
  if (!attachments.canRemove(req.user, att)) return fail(res, 403, 'Só quem enviou (ou a gestão) apaga o anexo.');
  await attachments.remove(att);
  res.json({ ok: true });
}));

router.get('/previa-link', wrap(async (req, res) => {
  if (!await previewLimiter.hit(req.user.id)) return fail(res, 429, 'Muitas consultas seguidas.');
  const p = await linkPreview.preview(req.query.url);
  res.set('Cache-Control', 'private, max-age=600').json(p);
}));

module.exports = router;
