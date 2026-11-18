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
  const all = await R.getMany(ids);
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

// ---------------------------------------------------------------- cortes: publicar em massa (agenda) e capas em lote
const bulk = require('../services/bulkPublish');
const up = require('../services/uploadPost');
const canPublishNow = (role) => can(role, 'production.review');
const canAskPublish = (role) => canPublishNow(role) || can(role, 'social.request');
const canCover = (role) => can(role, 'covers.edit');
const platformsOf = (body) => [...new Set([].concat(body.platforms || []).map(String).filter((p) => up.PLATFORMS[p]?.clip))];
const coverList = (ids) => db.query('SELECT id, clip_id, label, spec, updated_at, approved FROM episode_covers WHERE clip_id = ANY($1) AND kind = \'reel_cover\' ORDER BY clip_id, position, id', [ids]).then((r) => r.rows);

// 1) Agenda para conferir: horários distribuídos, quais vão como Reel de teste e o que ficou de fora (e por quê).
router.post('/conteudo/em-massa/publicar/previa', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canAskPublish(req.user.role)) return deny(res, 'Seu perfil não publica nas redes.');
  const ids = idsOf(req.body); const to = back(req, 'cortes');
  if (!ids.length) { await req.flash('error', 'Marque pelo menos um corte.'); return res.redirect(to); }
  const platforms = platformsOf(req.body);
  if (!platforms.length) { await req.flash('error', 'Escolha pelo menos uma rede.'); return res.redirect(to); }
  const opts = bulk.readOptions(req.body);
  if (opts.error) { await req.flash('error', opts.error); return res.redirect(to); }
  const { ok, skipped } = await bulk.eligible(ids);
  const slots = bulk.plan(ok.map((c) => c.id), opts);
  const byId = new Map(ok.map((c) => [c.id, c]));
  const covers = await coverList(ok.map((c) => c.id));
  const rows = slots.map((s) => ({ ...s, clip: byId.get(s.clipId), cover: covers.find((v) => v.id === byId.get(s.clipId).cover_id) || covers.find((v) => v.clip_id === s.clipId) || null }));
  const days = [...new Set(rows.map((r) => fmt.formatDateTime(r.at).slice(0, 5)))];
  const auto = platforms.includes('instagram') ? require('../services/commentAutomation').readForm(req.body) : null;
  const automation = require('../services/commentAutomation');
  res.render('content/bulk-publish', {
    title: 'Publicar em massa', rows, skipped, platforms, opts, days, auto, keywordOf: (c) => (auto ? auto.keyword || automation.keywordFor(c.guest_name || 'Episódio') : null), labelOf: (p) => up.PLATFORMS[p]?.clipLabel || up.PLATFORMS[p]?.label || p,
    review: !canPublishNow(req.user.role), episodio: isIntId(req.body.episodio) ? req.body.episodio : '', hhmm: bulk.hhmm,
  });
}));

// 2) Confirmado: uma publicação agendada por corte (a produtora manda para a revisão da gestão).
router.post('/conteudo/em-massa/publicar', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canAskPublish(req.user.role)) return deny(res, 'Seu perfil não publica nas redes.');
  const review = !canPublishNow(req.user.role);
  const to = back(req, 'cortes');
  if (!review && req.body.confirmar !== '1') { await req.flash('error', 'Confirme marcando "Entendi que isto agenda as publicações nas redes escolhidas".'); return res.redirect(to); }
  const platforms = platformsOf(req.body);
  const items = idsOf(req.body).map((id) => {
    const d = fmt.parseInputDateTime(String(req.body[`at_${id}`] || ''));
    return d ? { clipId: id, at: d.toISOString(), trial: req.body[`teste_${id}`] === '1' } : null;
  }).filter(Boolean);
  if (!items.length || !platforms.length) { await req.flash('error', 'Nada para agendar.'); return res.redirect(to); }
  const auto = require('../services/commentAutomation').readForm(req.body);
  const { created, failed } = await bulk.schedule(items, { platforms, trialMode: req.body.teste_modo === 'manual' ? 'manual' : 'auto', userId: req.user.id, review, auto });
  await audit(req, review ? 'publicacao.pedida' : 'publicacao.criada', 'publication', null, { em_massa: true, ids: created.map((x) => x.pub.id), redes: platforms });
  const trials = created.filter((x) => x.trial).length;
  const msg = created.length
    ? `${plural(created.length, review ? 'publicação foi para a revisão' : 'publicação agendada', review ? 'publicações foram para a revisão' : 'publicações agendadas')}${trials ? ` (${trials} como Reel de teste no Instagram)` : ''}.${created.some((x) => x.keyword) ? ` A automação do Instagram responde no direct quem comentar ${[...new Set(created.map((x) => x.keyword).filter(Boolean))].slice(0, 4).join(', ')}.` : ''}`
    : 'Nenhuma publicação foi agendada.';
  const why = failed.length ? ` ${plural(failed.length, 'ficou de fora', 'ficaram de fora')}: ${failed.slice(0, 3).map((f) => `${f.title || `corte ${f.clipId}`} (${f.why})`).join('; ')}${failed.length > 3 ? '…' : ''}` : '';
  await req.flash(created.length ? 'ok' : 'error', msg + why);
  return res.redirect(`/conteudo?vista=quadro${isIntId(req.body.episodio) ? `&episodio=${req.body.episodio}` : ''}`);
}));

// Capas em lote: escolher a capa de cada corte e reescrever o texto (a IA sugere). Uma linha por corte.
router.get('/conteudo/capas-em-lote', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCover(req.user.role)) return deny(res, 'Seu perfil não mexe nas capas.');
  const ids = idsOf({ ids: req.query.ids });
  if (!ids.length) return res.redirect('/conteudo?vista=cortes');
  const { rows: list } = await db.query(
    `SELECT c.id, c.title, c.post_title, c.cover_id, c.cover_texts, c.status, e.number AS ep_number, g.name AS guest_name,
            EXISTS (SELECT 1 FROM episode_frames f WHERE f.clip_id = c.id) AS has_frames
       FROM episode_clips c LEFT JOIN episodes e ON e.id = c.episode_id LEFT JOIN guests g ON g.id = e.guest_id WHERE c.id = ANY($1)`, [ids]);
  const covers = await coverList(ids);
  const order = new Map(ids.map((id, i) => [id, i]));
  const rows = list.sort((a, b) => order.get(a.id) - order.get(b.id)).map((c) => {
    const mine = covers.filter((v) => v.clip_id === c.id);
    const chosen = mine.find((v) => v.id === c.cover_id) || mine[0] || null;
    return { ...c, covers: mine, chosen, text: clips.coverTextOf(chosen) };
  });
  res.render('content/bulk-covers', { title: 'Capas em lote', rows, episodio: isIntId(req.query.episodio) ? req.query.episodio : '', aiOn: require('../config').geminiConfigured });
}));

// IA para todos de uma vez: 3 textos de capa por corte, 5 cortes em paralelo (um pedido só conta no limite de uso da IA).
const coverAiLimiter = require('../auth/rateLimit').createLimiter({ name: 'ia-capas-lote', max: 10, windowMs: 10 * 60_000 });
router.post('/conteudo/capas-em-lote/sugerir', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCover(req.user.role)) return res.status(403).json({ ok: false, error: 'Seu perfil não mexe nas capas.' });
  if (!await coverAiLimiter.hit(req.user.id)) return res.status(429).json({ ok: false, error: 'Muitos pedidos seguidos. Espere alguns minutos.' });
  const ids = idsOf(req.body).slice(0, 60);
  const aiText = require('../services/aiText');
  const out = {}; let i = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (i < ids.length) {
      const id = ids[i]; i += 1;
      const r = await aiText.suggest({ field: 'capa', coverKind: 'reel_cover', current: String(req.body[`texto_${id}`] || ''), shortcut: 'impacto', clipId: id }).catch((err) => ({ error: err.message }));
      out[id] = r.opcoes || { error: r.error || 'A IA não respondeu.' };
    }
  }));
  res.json({ ok: true, sugestoes: out });
}));

router.post('/conteudo/capas-em-lote', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCover(req.user.role)) return deny(res, 'Seu perfil não mexe nas capas.');
  const ids = idsOf(req.body);
  const covers = await coverList(ids);
  let chosen = 0; let made = 0; const errors = [];
  for (const id of ids) {
    const mine = covers.filter((v) => v.clip_id === id);
    const pick = mine.find((v) => String(v.id) === String(req.body[`capa_${id}`]));
    const text = String(req.body[`texto_${id}`] || '').replace(/\s+/g, ' ').trim();
    const before = String(req.body[`antes_${id}`] || '').replace(/\s+/g, ' ').trim();
    if (text && text !== before) {
      const out = await clips.coverWithText(id, { baseCoverId: pick?.id || null, text, userId: req.user.id });
      if (out.error) errors.push(`corte ${id}: ${out.error}`); else made += 1;
    } else if (pick) {
      const { rows: [cur] } = await db.query('SELECT cover_id FROM episode_clips WHERE id = $1', [id]);
      if (cur && cur.cover_id !== pick.id) {
        await db.query('UPDATE episode_clips SET cover_id = $2, updated_at = now() WHERE id = $1', [id, pick.id]);
        await db.query('UPDATE episode_covers SET approved = (id = $2) WHERE clip_id = $1', [id, pick.id]);
        chosen += 1;
      }
    }
  }
  await audit(req, 'capas.em_lote', 'clip', null, { ids, novas: made, trocadas: chosen });
  const parts = [made && plural(made, 'capa nova com o texto novo', 'capas novas com o texto novo'), chosen && plural(chosen, 'capa trocada', 'capas trocadas')].filter(Boolean);
  await req.flash(errors.length && !parts.length ? 'error' : 'ok', `${parts.length ? `${parts.join(' e ')}.` : 'Nada mudou.'}${errors.length ? ` Não deu em ${errors.length}: ${errors.slice(0, 2).join('; ')}` : ''}`);
  const q = new URLSearchParams(); ids.forEach((id) => q.append('ids', id)); if (isIntId(req.body.episodio)) q.set('episodio', req.body.episodio);
  return res.redirect(`/conteudo/capas-em-lote?${q}`);
}));

module.exports = router;
