// Mensagens da equipe: a página e a API que ela usa (JSON).
const express = require('express');
const chat = require('../services/chat');
const { requirePerm } = require('../middleware');
const { createLimiter } = require('../auth/rateLimit');
const { wrap, isIntId, isUuid } = require('../utils/wrap');

const router = express.Router();
const sendLimiter = createLimiter({ name: 'mensagens', max: 240, windowMs: 60_000 });
const summaryLimiter = createLimiter({ name: 'resumo-chat', max: 30, windowMs: 60 * 60_000 });
const use = requirePerm('chat.use');
const out = (res, r) => (r.error ? res.status(r.status || 400).json({ ok: false, error: r.error }) : res.json({ ok: true, ...r }));
const nope = (res) => res.status(404).json({ ok: false, error: 'Não encontrado.' });
const intOr = (v, d = null) => (isIntId(String(v ?? '')) ? Number(v) : d);

// Só segue quem participa da conversa.
const member = wrap(async (req, res, next) => {
  if (!isIntId(req.params.id) || !await chat.memberOf(require('../db/pool'), req.params.id, req.user.id)) return nope(res);
  return next();
});

const page = wrap(async (req, res) => {
  const open = req.params.id && isIntId(req.params.id) ? Number(req.params.id) : null;
  const conversations = await chat.listConversations(req.user.id);
  if (req.params.id && (!open || !await chat.memberOf(require('../db/pool'), open, req.user.id))) return res.status(404).render('error', { title: 'Conversa não encontrada', message: 'Esta conversa não existe ou você não participa dela.' });
  // conversa individual que acabou de ser aberta ainda pode não estar na lista
  if (open && !conversations.some((c) => c.id === open)) conversations.unshift(await chat.detail(open, req.user.id));
  return res.render('messages/index', { title: 'Mensagens', conversations, openId: open, reactionEmojis: chat.EMOJIS, aiOn: require('../config').geminiConfigured });
});
router.get('/mensagens', use, page);
router.get('/mensagens/nao-lidas', use, wrap(async (req, res) => res.json({ ok: true, n: await chat.unreadCount(req.user.id) })));
router.get('/mensagens/conversas', use, wrap(async (req, res) => res.json({ ok: true, conversations: await chat.listConversations(req.user.id) })));
router.get('/mensagens/:id(\\d+)', use, page);

router.post('/mensagens/conversas', use, wrap(async (req, res) => {
  if (req.body.tipo === 'grupo') return out(res, await chat.createGroup(req.user, req.body.nome, req.body.pessoas));
  if (!isUuid(String(req.body.pessoa || ''))) return out(res, { error: 'Escolha uma pessoa.', status: 400 });
  return out(res, await chat.openDirect(req.user, req.body.pessoa));
}));

router.get('/mensagens/conversas/:id', use, member, wrap(async (req, res) => res.json({ ok: true, conversation: await chat.detail(req.params.id, req.user.id) })));
router.post('/mensagens/conversas/:id/nome', use, member, wrap(async (req, res) => out(res, await chat.renameGroup(req.params.id, req.user, req.body.nome))));
router.post('/mensagens/conversas/:id/pessoas', use, member, wrap(async (req, res) => out(res, await chat.addMembers(req.params.id, req.user, req.body.pessoas))));
router.post('/mensagens/conversas/:id/pessoas/:uid/remover', use, member, wrap(async (req, res) => (isUuid(req.params.uid) ? out(res, await chat.removeMember(req.params.id, req.user, req.params.uid)) : nope(res))));
router.post('/mensagens/conversas/:id/pessoas/:uid/papel', use, member, wrap(async (req, res) => (isUuid(req.params.uid) ? out(res, await chat.setRole(req.params.id, req.user, req.params.uid, req.body.papel)) : nope(res))));
router.post('/mensagens/conversas/:id/sair', use, member, wrap(async (req, res) => out(res, await chat.leaveGroup(req.params.id, req.user))));

router.get('/mensagens/conversas/:id/mensagens', use, member, wrap(async (req, res) => res.json({ ok: true, ...await chat.history(req.params.id, { before: intOr(req.query.antes), limit: intOr(req.query.limite, 50) }) })));
router.get('/mensagens/conversas/:id/novidades', use, member, wrap(async (req, res) => res.json({ ok: true, ...await chat.changes(req.params.id, intOr(req.query.desde, 0)) })));
router.post('/mensagens/conversas/:id/mensagens', use, member, wrap(async (req, res) => {
  if (!await sendLimiter.hit(req.user.id)) return res.status(429).json({ ok: false, error: 'Muitas mensagens seguidas. Espere um instante.' });
  return out(res, await chat.send({ user: req.user, conversationId: req.params.id, clientId: req.body.client_id, html: req.body.html, attachmentIds: req.body.anexos, parentId: intOr(req.body.parent_id) }));
}));
router.post('/mensagens/conversas/:id/lida', use, member, wrap(async (req, res) => out(res, await chat.markRead(req.params.id, req.user, intOr(req.body.ate, 0)))));
router.post('/mensagens/conversas/:id/resumo', use, member, wrap(async (req, res) => {
  if (!await summaryLimiter.hit(req.user.id)) return res.status(429).json({ ok: false, error: 'Muitos resumos seguidos. Tente mais tarde.' });
  return out(res, await chat.requestSummary({ user: req.user, conversationId: req.params.id, scope: req.body.alcance, fromId: intOr(req.body.desde_id), parentId: intOr(req.body.parent_id) }));
}));
router.get('/mensagens/resumos/:id', use, wrap(async (req, res) => {
  const summary = isIntId(req.params.id) ? await chat.getSummary(req.params.id, req.user.id) : null;
  return summary ? res.json({ ok: true, summary }) : nope(res);
}));

// Ações sobre uma mensagem: quem não participa recebe 403 do serviço.
const mid = (fn) => wrap(async (req, res) => (isIntId(req.params.mid) ? out(res, await fn(req)) : nope(res)));
router.get('/mensagens/m/:mid/respostas', use, wrap(async (req, res) => {
  if (!isIntId(req.params.mid)) return nope(res);
  const conversationId = await chat.conversationOf(req.params.mid);
  if (!conversationId || !await chat.memberOf(require('../db/pool'), conversationId, req.user.id)) return nope(res);
  const t = await chat.thread(req.params.mid);
  return t ? res.json({ ok: true, ...t }) : nope(res);
}));
router.post('/mensagens/m/:mid/editar', use, mid((req) => chat.edit(req.params.mid, req.user, req.body.html)));
router.post('/mensagens/m/:mid/apagar', use, mid((req) => chat.remove(req.params.mid, req.user)));
router.post('/mensagens/m/:mid/reagir', use, mid((req) => chat.react(req.params.mid, req.user, req.body.emoji)));

module.exports = router;
