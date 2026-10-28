// Conteúdo > ações em massa: marcar vários cortes, posts ou pedidos e atribuir, aprovar, mudar responsável/prazo, cancelar ou
// mandar para a lixeira de uma vez. Cada item passa pela mesma regra de permissão da ação individual; o que não pode, fica de fora.
const express = require('express');
const db = require('../db/pool');
const clips = require('../services/clips');
const prod = require('../services/production');
const trash = require('../services/trash');
const R = require('../services/contentRequests');
const recordChanges = require('../services/recordChanges');
const { audit } = require('../services/audit');
const { requirePerm } = require('../middleware');
const { can } = require('../permissions');
const { wrap, isIntId } = require('../utils/wrap');
const fmt = require('../utils/format');

const router = express.Router();
const POST_KINDS = ['post_quote', 'post_split', 'carousel'];
const MAX = 200;
const canCut = (role) => can(role, 'production.review') || can(role, 'production.edit');
const canApprove = (role) => can(role, 'production.review') || can(role, 'production.manage');
const canEditRequest = (user, r) => R.canReview(user.role) || String(r.created_by || '') === String(user.id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const idsOf = (body) => [...new Set([].concat(body.ids || []).map(String).filter(isIntId))].slice(0, MAX).map(Number);

const back = (req, tab) => {
  const ep = isIntId(req.body.episodio) ? `&episodio=${req.body.episodio}` : '';
  return `/conteudo?vista=${tab}${ep}`;
};
const deny = (res, msg) => res.status(403).render('error', { title: 'Sem permissão', message: msg });

// Manda para a lixeira num lote só ("Desfazer" devolve todos). Devolve { batch, n }.
async function toTrash(kind, ids, user, onEach = null) {
  const batch = require('crypto').randomUUID();
  let n = 0;
  for (const id of ids) {
    const gone = onEach ? await onEach.before(id) : null;
    if (await trash.remove(kind, id, { user, batch })) { n += 1; if (onEach) await onEach.after(gone); }
  }
  return { batch, n };
}

// ---------------------------------------------------------------- cortes: atribuir ao episódio, lixeira
router.post('/conteudo/em-massa/cortes', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return deny(res, 'Seu perfil não mexe nos cortes.');
  const ids = idsOf(req.body); const to = back(req, 'cortes');
  if (!ids.length) { await req.flash('error', 'Marque pelo menos um corte.'); return res.redirect(to); }
  const { rows: list } = await db.query('SELECT id, title, status, episode_id FROM episode_clips WHERE id = ANY($1)', [ids]);
  if (req.body.acao === 'atribuir') {
    if (!isIntId(req.body.episode_id)) { await req.flash('error', 'Escolha o episódio.'); return res.redirect(to); }
    let ok = 0; let lastError = null;
    for (const c of list) {
      const out = await clips.assign(c.id, req.body.episode_id, req.user.id);
      if (out.error) lastError = out.error;
      else { ok += 1; await audit(req, 'corte.atribuido', 'clip', c.id, { episodio: out.episode.id, em_massa: true }); }
    }
    if (!ok) { await req.flash('error', lastError || 'Nenhum corte foi atribuído.'); return res.redirect(to); }
    const { rows: [e] } = await db.query('SELECT number, title FROM episodes WHERE id = $1', [req.body.episode_id]);
    await req.flash('ok', `${plural(ok, 'corte atribuído', 'cortes atribuídos')} ao ${e.number ? `EP.${String(e.number).padStart(3, '0')}` : 'episódio'} ${e.title}.${list.length - ok ? ` ${list.length - ok} ficou de fora: ${lastError}` : ''}`);
    return res.redirect(to);
  }
  if (req.body.acao === 'excluir') {
    const ready = list.filter((c) => c.status !== 'enviando'); // envio pela metade se cancela na bandeja de envios
    const { batch, n } = await toTrash('clip', ready.map((c) => c.id), req.user, {
      before: (id) => recordChanges.snapshot('clip', id),
      after: (gone) => recordChanges.deleted({ type: 'clip', row: gone, actor: req.user }),
    });
    await audit(req, 'corte.excluido', 'clip', null, { ids: ready.map((c) => c.id), em_massa: true });
    await req.flash('ok', `${plural(n, 'corte foi', 'cortes foram')} para a lixeira.${list.length - ready.length ? ' Os que ainda estão sendo enviados ficaram.' : ''}`, n ? { undo: batch } : null);
    return res.redirect(to);
  }
  return res.redirect(to);
}));

// ---------------------------------------------------------------- posts e carrosséis: aprovar, tirar aprovação, lixeira
router.post('/conteudo/em-massa/posts', requirePerm('episodes.read'), wrap(async (req, res) => {
  const ids = idsOf(req.body); const to = back(req, 'posts');
  if (!ids.length) { await req.flash('error', 'Marque pelo menos um post.'); return res.redirect(to); }
  const { rows: list } = await db.query('SELECT id, episode_id, kind, label FROM episode_covers WHERE id = ANY($1) AND kind = ANY($2) AND clip_id IS NULL', [ids, POST_KINDS]);
  if (['aprovar', 'desaprovar'].includes(req.body.acao)) {
    if (!canApprove(req.user.role)) return deny(res, 'Seu perfil não aprova posts.');
    const approve = req.body.acao === 'aprovar';
    await db.query('UPDATE episode_covers SET approved = $2 WHERE id = ANY($1)', [list.map((c) => c.id), approve]);
    for (const epId of [...new Set(list.map((c) => c.episode_id).filter(Boolean))]) {
      const n = list.filter((c) => c.episode_id === epId).length;
      await prod.addEvent(epId, req.user.id, 'capas', `${approve ? 'Aprovados' : 'Aprovação removida de'} ${plural(n, 'post', 'posts')} de uma vez`);
    }
    await req.flash('ok', approve ? `${plural(list.length, 'post aprovado', 'posts aprovados')}.` : `Aprovação removida de ${plural(list.length, 'post', 'posts')}.`);
    return res.redirect(to);
  }
  if (req.body.acao === 'excluir') {
    if (!canCut(req.user.role)) return deny(res, 'Seu perfil não apaga posts.');
    const { batch, n } = await toTrash('cover', list.map((c) => c.id), req.user);
    await req.flash('ok', `${plural(n, 'post foi', 'posts foram')} para a lixeira.`, n ? { undo: batch } : null);
    return res.redirect(to);
  }
  return res.redirect(to);
}));

// ---------------------------------------------------------------- pedidos: responsável, prazo, prioridade, cancelar, lixeira
router.post('/conteudo/em-massa/pedidos', requirePerm('episodes.read'), wrap(async (req, res) => {
  const ids = idsOf(req.body); const to = back(req, 'pedidos');
  if (!ids.length) { await req.flash('error', 'Marque pelo menos um pedido.'); return res.redirect(to); }
  const all = (await Promise.all(ids.map((id) => R.get(id)))).filter(Boolean);
  const mine = all.filter((r) => canEditRequest(req.user, r));
  const left = all.length - mine.length;
  const outside = left ? ` ${plural(left, 'pedido ficou', 'pedidos ficaram')} de fora: só quem pediu e a gestão mudam o pedido.` : '';
  if (!mine.length) return deny(res, 'Só quem pediu e a gestão mudam estes pedidos.');

  if (req.body.acao === 'alterar') {
    const who = String(req.body.assignee_id || '');
    let assignee; // undefined = manter
    if (who === 'ninguem') assignee = null;
    else if (UUID.test(who)) {
      const { rows: [u] } = await db.query("SELECT id FROM users WHERE id = $1 AND active AND role IN ('editor_video','gestao','superadmin')", [who]);
      if (!u) { await req.flash('error', 'Essa pessoa não recebe pedidos.'); return res.redirect(to); }
      assignee = u.id;
    }
    let due; // undefined = manter
    if (req.body.sem_prazo === '1') due = null;
    else if (req.body.due_on) {
      const d = fmt.parseInputDate(String(req.body.due_on));
      if (!d || Number.isNaN(d)) { await req.flash('error', 'Data de prazo inválida.'); return res.redirect(to); }
      due = d;
    }
    const priority = req.body.priority === '1' ? true : req.body.priority === '0' ? false : undefined;
    if (assignee === undefined && due === undefined && priority === undefined) { await req.flash('error', 'Escolha o que mudar: responsável, prazo ou prioridade.'); return res.redirect(to); }
    for (const r of mine) {
      if (assignee !== undefined || due !== undefined) {
        await R.update(r, {
          kind: r.kind, title: r.title, briefing: r.briefing, briefing_html: r.briefing_html, format: r.format, episode_id: r.episode_id,
          assignee_id: assignee !== undefined ? assignee : r.assignee_id, due_on: due !== undefined ? due : (fmt.toInputDate(r.due_on) || null),
        }, req.user);
      }
      if (priority !== undefined) await db.query('UPDATE content_requests SET priority = $2, updated_at = now() WHERE id = $1', [r.id, priority]);
      await audit(req, 'pedido.editado', 'content_request', r.id, { titulo: r.title, em_massa: true });
    }
    await req.flash('ok', `${plural(mine.length, 'pedido atualizado', 'pedidos atualizados')}.${outside}`);
    return res.redirect(to);
  }
  if (req.body.acao === 'cancelar') {
    let n = 0;
    for (const r of mine) if ((await R.cancel(r)).ok) { n += 1; await audit(req, 'pedido.cancelado', 'content_request', r.id, { titulo: r.title, em_massa: true }); }
    const skipped = mine.length - n;
    await req.flash(n ? 'ok' : 'error', `${n ? `${plural(n, 'pedido cancelado', 'pedidos cancelados')}.` : 'Nenhum pedido cancelado.'}${skipped ? ` ${plural(skipped, 'já estava aprovado ou cancelado', 'já estavam aprovados ou cancelados')}.` : ''}${outside}`);
    return res.redirect(to);
  }
  if (req.body.acao === 'excluir') {
    const { batch, n } = await toTrash('request', mine.map((r) => r.id), req.user);
    await audit(req, 'pedido.excluido', 'content_request', null, { ids: mine.map((r) => r.id), em_massa: true });
    await req.flash('ok', `${plural(n, 'pedido foi', 'pedidos foram')} para a lixeira.${outside}`, n ? { undo: batch } : null);
    return res.redirect(to);
  }
  return res.redirect(to);
}));

module.exports = router;
