// Colaboração: comentários, responsável ("bolinha"), notificações e busca global.
const express = require('express');
const db = require('../db/pool');
const comments = require('../services/comments');
const responsible = require('../services/responsible');
const push = require('../services/push');
const reminders = require('../services/reminders');
const { can } = require('../permissions');
const notifySvc = require('../services/notify');
const search = require('../services/search');
const C = require('../constants');
const { requirePerm } = require('../middleware');
const { wrap, isIntId, isUuid } = require('../utils/wrap');

const router = express.Router();
const wantsJson = (req) => /json/.test(req.get('accept') || '');
// volta para a página de origem (só caminhos internos)
const backTo = (req, fallback) => { const v = String(req.body.voltar || ''); return /^\/(?!\/)[\w\-/?=&#.%]*$/.test(v) ? v : fallback; };

// ---------------------------------------------------------------- comentários
router.post('/comentarios', requirePerm('comments.write'), wrap(async (req, res) => {
  const type = String(req.body.tipo || ''); const id = req.body.id;
  if (!comments.isEntity(type) || !isIntId(id)) return wantsJson(req) ? res.status(400).json({ ok: false, error: 'Item inválido.' }) : res.status(400).send('Item inválido.');
  const result = await comments.add({ type, id: Number(id), author: req.user, body: req.body.texto });
  if (result.error) {
    if (wantsJson(req)) return res.status(result.status || 422).json({ ok: false, error: result.error });
    await req.flash('error', result.error);
  }
  if (wantsJson(req)) return res.json({ ok: true, comment: result.comment });
  res.redirect(backTo(req, comments.ENTITIES[type].url(id)));
}));

router.post('/comentarios/:id/excluir', requirePerm('comments.write'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return res.status(404).send('Não encontrado.');
  const result = await comments.remove(req.params.id, req.user);
  if (result.error) { await req.flash('error', result.error); return res.redirect(backTo(req, '/')); }
  res.redirect(backTo(req, comments.ENTITIES[result.comment.entity_type].url(result.comment.entity_id)));
}));

// ---------------------------------------------------------------- responsável (bolinha)
router.post('/responsavel', wrap(async (req, res) => {
  const type = String(req.body.tipo || ''); const id = req.body.id;
  const userId = req.body.user_id ? String(req.body.user_id) : null;
  if (!isIntId(id) || (userId && !isUuid(userId))) return res.status(400).json({ ok: false, error: 'Dados inválidos.' });
  const result = await responsible.setResponsible({ type, id: Number(id), userId, actor: req.user });
  if (result.error) return res.status(result.status || 422).json({ ok: false, error: result.error });
  res.json({ ok: true, user: result.user ? { id: result.user.id, name: result.user.name } : null });
}));

// ---------------------------------------------------------------- notificações
router.get('/notificacoes', wrap(async (req, res) => {
  const type = notifySvc.TYPES.includes(req.query.tipo) ? req.query.tipo : null;
  const unread = req.query.filtro === 'nao-lidas';
  const [items, counts, mutes] = await Promise.all([
    notifySvc.list(req.user.id, { type, unread, limit: 100 }),
    db.query('SELECT type, count(*) FILTER (WHERE read_at IS NULL)::int AS unread FROM notifications WHERE user_id = $1 GROUP BY type', [req.user.id]),
    db.query('SELECT type FROM notification_mutes WHERE user_id = $1', [req.user.id]),
  ]);
  res.render('notifications/index', {
    title: 'Notificações', items, type, unread, types: C.NOTIFICATION_TYPES,
    unreadBy: Object.fromEntries(counts.rows.map((r) => [r.type, r.unread])), muted: mutes.rows.map((r) => r.type),
    pushKey: push.publicKey(), tab: 'avisos', dueNow: (await reminders.queue()).now.length,
  });
}));

// ---- aba Lembretes da gravação: a fila de quem a produtora precisa avisar ----
router.get('/notificacoes/lembretes', requirePerm('guests.read'), wrap(async (req, res) => {
  const q = await reminders.queue();
  res.render('notifications/reminders', { title: 'Lembretes da gravação', q, tab: 'lembretes', dueNow: q.now.length, canSend: can(req.user.role, 'guests.write'), canConfig: can(req.user.role, 'reminders.manage') });
}));

// ---- alertas neste aparelho (Web Push) ----
router.post('/notificacoes/push/inscrever', wrap(async (req, res) => {
  if (!push.configured()) return res.status(503).json({ ok: false, error: 'Alertas com o painel fechado ainda não estão configurados no servidor.' });
  const row = await push.subscribe(req.user.id, req.body.subscription, req.get('user-agent'));
  if (!row) return res.status(400).json({ ok: false, error: 'Inscrição inválida.' });
  res.json({ ok: true });
}));

router.post('/notificacoes/push/sair', wrap(async (req, res) => {
  await push.unsubscribe(req.user.id, req.body.endpoint);
  res.json({ ok: true });
}));

router.post('/notificacoes/push/teste', wrap(async (req, res) => {
  const r = await push.sendToUser(req.user.id, { id: `teste-${Date.now()}`, title: 'Alertas ligados', body: 'É assim que os avisos do Pulso chegam neste aparelho.', url: '/notificacoes', tag: 'teste' });
  if (!r.sent) return res.status(422).json({ ok: false, error: 'Nenhum aparelho recebeu. Ative os alertas de novo neste aparelho.' });
  res.json({ ok: true, sent: r.sent });
}));

// avisos em tempo real (Server-Sent Events)
router.get('/eventos', (req, res) => require('../services/realtime').handler(req, res));

router.get('/notificacoes/resumo', wrap(async (req, res) => {
  const [count, latest] = await Promise.all([notifySvc.unreadCount(req.user.id), notifySvc.list(req.user.id, { limit: 8 })]);
  res.set('Cache-Control', 'no-store').json({ ok: true, unread: count, latest: latest.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, url: n.url, read: Boolean(n.read_at), at: n.created_at })) });
}));

// abrir uma notificação: marca como lida e vai para o item
router.get('/notificacoes/:id/abrir', wrap(async (req, res) => {
  if (!/^\d{1,18}$/.test(req.params.id)) return res.redirect('/notificacoes');
  const n = await notifySvc.markRead(req.user.id, req.params.id);
  res.redirect(n?.url && /^\/(?!\/)/.test(n.url) ? n.url : '/notificacoes'); // só caminho do próprio painel (nada de //outro-site)
}));

router.post('/notificacoes/:id/lida', wrap(async (req, res) => {
  if (/^\d{1,18}$/.test(req.params.id)) await notifySvc.markRead(req.user.id, req.params.id);
  if (wantsJson(req)) return res.json({ ok: true, unread: await notifySvc.unreadCount(req.user.id) });
  res.redirect(backTo(req, '/notificacoes'));
}));

router.post('/notificacoes/lidas', wrap(async (req, res) => {
  await notifySvc.markAllRead(req.user.id, req.body.tipo || null);
  res.redirect(backTo(req, '/notificacoes'));
}));

// preferência pessoal: silenciar tipos
router.post('/notificacoes/preferencias', wrap(async (req, res) => {
  const muted = [].concat(req.body.silenciar || []).filter((t) => notifySvc.TYPES.includes(t));
  await db.query('DELETE FROM notification_mutes WHERE user_id = $1', [req.user.id]);
  for (const t of muted) await db.query('INSERT INTO notification_mutes (user_id, type) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, t]);
  await req.flash('ok', muted.length ? `Silenciado: ${muted.map((t) => C.NOTIFICATION_TYPES[t].label).join(', ')}.` : 'Você recebe todos os tipos de notificação.');
  res.redirect('/notificacoes');
}));

// ---------------------------------------------------------------- busca global
router.get('/busca', wrap(async (req, res) => {
  const result = await search.search(req.query.q, req.user);
  if (result.q.length >= 2 && req.query.registrar !== '0') await search.log(req.user, result.q, result.total);
  let tips = 0;
  if (!result.q && require('../permissions').can(req.user.role, 'search.manage')) tips = (await search.suggestions(req.app)).length;
  res.set('Cache-Control', 'no-store').json({ ok: true, ...result, tips });
}));

// o que a pessoa escolheu (melhora as sugestões de atalhos)
router.post('/busca/escolha', wrap(async (req, res) => {
  const q = String(req.body.q || '').trim(); const url = String(req.body.url || '');
  if (q.length >= 2 && url.startsWith('/')) await db.query('UPDATE search_log SET picked = $3 WHERE id = (SELECT id FROM search_log WHERE user_id = $1 AND lower(q) = lower($2) ORDER BY id DESC LIMIT 1)', [req.user.id, q.slice(0, 80), url.slice(0, 300)]);
  res.json({ ok: true });
}));

module.exports = router;
