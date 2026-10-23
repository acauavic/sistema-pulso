// Social: publicações (ver e editar), novo post a partir do que ainda não foi usado, ideias por episódio, insights e automações
// de comentários e directs. Ver: equipe de conteúdo. Publicar e automatizar: gestão. Nada sai para as redes sem UPLOAD_POST_LIVE.
const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const social = require('../services/social');
const publishing = require('../services/publishing');
const up = require('../services/uploadPost');
const socialApi = require('../services/socialApi');
const tasksSvc = require('../services/tasks');
const jobs = require('../services/jobs');
const fmt = require('../utils/format');
const { audit } = require('../services/audit');
const { requirePerm } = require('../middleware');
const { can } = require('../permissions');
const { wrap, isIntId } = require('../utils/wrap');

const router = express.Router();
const MEDIA = { video: 'Vídeo', imagem: 'Post', carrossel: 'Carrossel', story: 'Story' };
const notFound = (res) => res.status(404).render('error', { title: 'Não encontrado', message: 'Não encontrado.' });
const live = () => config.uploadPost.live; // automações e respostas (sempre pelo Upload-Post)
const pubLive = async () => (await socialApi.active()).live(); // publicar (provedor escolhido)

router.get('/social', requirePerm('social.read'), (req, res) => res.redirect('/social/publicacoes'));

// ---------------------------------------------------------------- publicações
router.get('/social/publicacoes', requirePerm('social.read'), wrap(async (req, res) => {
  const status = social.STATUS_LABEL[req.query.status] ? req.query.status : '';
  const media = MEDIA[req.query.tipo] ? req.query.tipo : '';
  const [pubs, counts] = await Promise.all([
    social.listPublications({ status, media }),
    db.query('SELECT status, count(*)::int AS n FROM episode_publications GROUP BY status'),
  ]);
  res.render('social/publications', {
    title: 'Social', tab: 'publicacoes', pubs, status, media, MEDIA, statusLabel: social.STATUS_LABEL, platforms: up.PLATFORMS, live: await pubLive(),
    counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
  });
}));

async function findPub(id) {
  if (!isIntId(id)) return null;
  const { rows: [p] } = await db.query(
    `SELECT p.*, e.number AS episode_number, e.title AS episode_title, c.title AS clip_title, u.name AS created_by_name
       FROM episode_publications p JOIN episodes e ON e.id = p.episode_id LEFT JOIN episode_clips c ON c.id = p.clip_id LEFT JOIN users u ON u.id = p.created_by WHERE p.id = $1`, [id]);
  return p || null;
}

router.get('/social/publicacoes/:id', requirePerm('social.read'), wrap(async (req, res) => {
  const pub = await findPub(req.params.id);
  if (!pub) return notFound(res);
  const okPlatforms = (pub.results || []).filter((r) => r.ok).map((r) => r.platform);
  res.render('social/publication', {
    title: pub.title, tab: 'publicacoes', pub, MEDIA, statusLabel: social.STATUS_LABEL, platforms: up.PLATFORMS, live: socialApi.get(pub.provider).live(), provider: socialApi.get(pub.provider),
    editable: socialApi.get(pub.provider).canEdit ? okPlatforms.filter((p) => up.EDITABLE[p]) : [], notEditable: socialApi.get(pub.provider).canEdit ? okPlatforms.filter((p) => !up.EDITABLE[p]) : okPlatforms,
    canPublish: can(req.user.role, 'social.publish'), mine: String(pub.created_by) === String(req.user.id),
  });
}));

// Quem pode mexer: a gestão em tudo; quem pediu, no próprio pedido enquanto ele não saiu (em revisão ou devolvido).
const canTouch = (req, pub) => can(req.user.role, 'social.publish') || (String(pub.created_by) === String(req.user.id) && ['revisao', 'recusado'].includes(pub.status));
const forbidden = (res) => res.status(403).render('error', { title: 'Sem permissão', message: 'Só a gestão mexe nesta publicação.' });

router.post('/social/publicacoes/:id', requirePerm('social.request'), wrap(async (req, res) => {
  const pub = await findPub(req.params.id);
  if (!pub) return notFound(res);
  if (!canTouch(req, pub)) return forbidden(res);
  let scheduledAt = null;
  if (req.body.agendar) { const d = fmt.parseInputDateTime(String(req.body.agendar)); if (!d) { await req.flash('error', 'Data de agendamento inválida.'); return res.redirect(`/social/publicacoes/${pub.id}`); } scheduledAt = d.toISOString(); }
  const r = await social.editPublication(pub, { title: fmt.clean(req.body.title, 300), description: String(req.body.description ?? '').replace(/\r/g, '').trim(), scheduledAt }, req.user);
  if (r.error) await req.flash('error', r.error);
  else {
    await audit(req, 'publicacao.editada', 'publication', pub.id);
    if (pub.status === 'recusado' && req.body.reenviar === '1') { await publishing.resubmit(pub.id, req.user); await req.flash('ok', 'Ajustado e reenviado para a revisão da gestão.'); } else await req.flash('ok', r.message);
  }
  res.redirect(`/social/publicacoes/${pub.id}`);
}));

// revisão da gestão
router.post('/social/publicacoes/:id/aprovar', requirePerm('social.publish'), wrap(async (req, res) => {
  const pub = await findPub(req.params.id);
  if (!pub) return notFound(res);
  const done = await publishing.approve(pub.id, req.user);
  if (!done) await req.flash('error', 'Este pedido já foi revisado.');
  else {
    await audit(req, 'publicacao.aprovada', 'publication', pub.id);
    await req.flash(done.status === 'erro' ? 'error' : 'ok', done.status === 'agendado' ? 'Aprovado e agendado.' : done.status === 'simulado' ? 'Aprovado. Modo de teste: nada foi enviado às redes.' : done.status === 'erro' ? `Aprovado, mas o envio falhou: ${done.error}` : 'Aprovado e enviado às redes.');
  }
  res.redirect(`/social/publicacoes/${pub.id}`);
}));
router.post('/social/publicacoes/:id/recusar', requirePerm('social.publish'), wrap(async (req, res) => {
  const pub = await findPub(req.params.id);
  if (!pub) return notFound(res);
  const note = fmt.clean(req.body.note, 1000);
  if (note.length < 3) { await req.flash('error', 'Diga o que precisa mudar: a nota vai para quem pediu.'); return res.redirect(`/social/publicacoes/${pub.id}`); }
  if (!(await publishing.reject(pub.id, req.user, note))) await req.flash('error', 'Este pedido já foi revisado.');
  else { await audit(req, 'publicacao.devolvida', 'publication', pub.id); await req.flash('ok', 'Devolvido com a sua nota.'); }
  res.redirect(`/social/publicacoes/${pub.id}`);
}));

router.post('/social/publicacoes/:id/:acao(atualizar|repetir|cancelar)', requirePerm('social.read'), wrap(async (req, res) => {
  const pub = await findPub(req.params.id);
  if (!pub) return notFound(res);
  if (req.params.acao === 'repetir' && !can(req.user.role, 'social.publish')) return forbidden(res);
  if (req.params.acao === 'cancelar' && !canTouch(req, pub)) return forbidden(res);
  if (req.params.acao === 'atualizar') await publishing.refresh(pub.id);
  if (req.params.acao === 'repetir') await publishing.retry(pub.id);
  if (req.params.acao === 'cancelar') { await publishing.cancel(pub.id); await req.flash('ok', pub.status === 'agendado' ? 'Agendamento cancelado.' : 'Pedido retirado.'); return res.redirect('/social/publicacoes'); }
  res.redirect(`/social/publicacoes/${pub.id}`);
}));

// ---------------------------------------------------------------- novo post (só o que ainda não foi usado)
router.get('/social/novo', requirePerm('social.read'), wrap(async (req, res) => {
  const tipo = MEDIA[req.query.tipo] ? req.query.tipo : 'video';
  const provider = await socialApi.active();
  const [clips, images, conn] = await Promise.all([social.unusedClips(), social.unusedImages(), provider.configured() ? provider.connected() : { ok: false, platforms: {} }]);
  res.render('social/new', {
    title: 'Novo post', tab: 'novo', tipo, MEDIA, clips, images, platforms: up.PLATFORMS, photoPlatforms: up.PHOTO_PLATFORMS, defaults: up.DEFAULTS,
    connected: conn.platforms || {}, live: provider.live(), provider, canPublish: can(req.user.role, 'social.request'), direct: can(req.user.role, 'social.publish'), pick: req.query.item || '',
  });
}));

router.post('/social/publicar', requirePerm('social.request'), wrap(async (req, res) => {
  const review = !can(req.user.role, 'social.publish'); // produtora: vai para a revisão da gestão
  const media = MEDIA[req.body.tipo] ? req.body.tipo : 'video';
  const back = `/social/novo?tipo=${media}`;
  const fail = async (msg) => { await req.flash('error', msg); return res.redirect(back); };
  if (req.body.confirmar !== '1' && !review) return fail('Confirme o envio marcando "Entendi que isto publica nas redes escolhidas".');
  const platforms = [].concat(req.body.platforms || []).map(String).filter((p) => up.PLATFORMS[p]);
  let scheduledAt = null;
  if (req.body.agendar) { const d = fmt.parseInputDateTime(String(req.body.agendar)); if (!d) return fail('Data de agendamento inválida.'); scheduledAt = d.toISOString(); }
  const title = fmt.clean(req.body.title, 300);
  const description = String(req.body.description || '').replace(/\r/g, '').trim();
  let target = {};
  if (media === 'video') {
    if (!isIntId(String(req.body.clip_id || ''))) return fail('Escolha o corte.');
    const { rows: [c] } = await db.query('SELECT id, episode_id FROM episode_clips WHERE id = $1', [req.body.clip_id]);
    if (!c) return fail('Corte não encontrado.');
    target = { episodeId: c.episode_id, clipId: c.id };
  } else {
    const ids = String(req.body.cover_ids || '').split(',').map(Number).filter(Number.isInteger);
    target = { coverIds: ids };
  }
  try {
    const pub = await publishing.create({ ...target, media, platforms, title, description, scheduledAt, userId: req.user.id, review });
    await audit(req, review ? 'publicacao.pedida' : 'publicacao.criada', 'publication', pub.id, { redes: pub.platforms, tipo: media, simulado: pub.status === 'simulado' });
    await req.flash(pub.status === 'erro' ? 'error' : 'ok', socialApi.sentMessage(pub));
    return res.redirect(`/social/publicacoes/${pub.id}`);
  } catch (err) {
    return fail(err.message);
  }
}));

// ---------------------------------------------------------------- ideias
router.get('/social/ideias', requirePerm('social.read'), wrap(async (req, res) => {
  const status = ['sugerida', 'aprovada', 'feita', 'descartada'].includes(req.query.status) ? req.query.status : 'sugerida';
  const [episodes, ideas, counts, pending] = await Promise.all([
    db.query(`SELECT e.id, e.number, e.title, e.status, g.name AS guest_name,
                     EXISTS (SELECT 1 FROM episode_transcripts t WHERE t.episode_id = e.id) OR EXISTS (SELECT 1 FROM episode_clips c WHERE c.episode_id = e.id AND coalesce(c.transcript, '') <> '') AS has_text,
                     (SELECT count(*)::int FROM social_ideas i WHERE i.episode_id = e.id) AS ideas
                FROM episodes e LEFT JOIN guests g ON g.id = e.guest_id ORDER BY e.number DESC NULLS LAST, e.id DESC LIMIT 200`),
    db.query(`SELECT i.*, e.number AS episode_number, e.title AS episode_title, t.status AS task_status
                FROM social_ideas i JOIN episodes e ON e.id = i.episode_id LEFT JOIN tasks t ON t.id = i.task_id
               WHERE i.status = $1 ORDER BY e.number DESC NULLS LAST, i.kind, i.id`, [status]),
    db.query('SELECT status, count(*)::int AS n FROM social_ideas GROUP BY status'),
    db.query("SELECT 1 FROM jobs WHERE kind = 'social_ideias' AND status IN ('queued','running') LIMIT 1"),
  ]);
  res.render('social/ideas', {
    title: 'Ideias', tab: 'ideias', episodes: episodes.rows, ideas: ideas.rows, status, kinds: social.IDEA_KINDS,
    counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])), running: pending.rowCount > 0,
    aiReady: config.geminiConfigured, canIdeas: can(req.user.role, 'social.ideas'),
  });
}));

router.post('/social/ideias/gerar', requirePerm('social.ideas'), wrap(async (req, res) => {
  const ids = [...new Set([].concat(req.body.episodes || []).map(Number).filter(Number.isInteger))].slice(0, 30);
  const kinds = [].concat(req.body.kinds || []).filter((k) => social.IDEA_KINDS[k]);
  if (!ids.length) { await req.flash('error', 'Escolha pelo menos um episódio.'); return res.redirect('/social/ideias'); }
  if (!kinds.length) { await req.flash('error', 'Escolha o que sugerir: cortes, stories ou carrosséis.'); return res.redirect('/social/ideias'); }
  if (ids.length === 1) { // um episódio: na hora
    const r = await social.generateIdeas(ids[0], kinds, req.user.id);
    if (r.error) await req.flash('error', r.error);
    else await req.flash('ok', r.created ? `${r.created} ideia(s) nova(s).${r.skipped ? ` ${r.skipped} parecida(s) com o que já existe ficaram de fora.` : ''}` : 'Nenhuma ideia nova: o que a IA sugeriu já tinha sido feito ou sugerido.');
  } else {
    await jobs.enqueue('social_ideias', { refId: Date.now() % 2147483647, payload: { episodeIds: ids, kinds, userId: req.user.id } });
    await req.flash('ok', `Pedido de ideias para ${ids.length} episódios na fila. Você recebe uma notificação quando terminar.`);
  }
  res.redirect('/social/ideias');
}));

router.post('/social/ideias/:id/:acao(aprovar|feita|descartar|reabrir)', requirePerm('social.ideas'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return notFound(res);
  const { rows: [idea] } = await db.query('SELECT i.*, e.editor_id, e.title AS episode_title FROM social_ideas i JOIN episodes e ON e.id = i.episode_id WHERE i.id = $1', [req.params.id]);
  if (!idea) return notFound(res);
  const to = { aprovar: 'aprovada', feita: 'feita', descartar: 'descartada', reabrir: 'sugerida' }[req.params.acao];
  let taskId = idea.task_id;
  if (to === 'aprovada' && !taskId) { // vira tarefa: corte para o editor do episódio; story e carrossel ficam para quem pegar
    const b = idea.body || {};
    const lines = [idea.hook ? `Gancho: ${idea.hook}` : '', b.inicio_seg != null ? `Trecho: ${fmt.formatClock(b.inicio_seg * 1000)} a ${b.fim_seg != null ? fmt.formatClock(b.fim_seg * 1000) : '?'}` : '',
      b.frase ? `Frase: "${b.frase}"` : '', (b.slides || []).length ? `Slides:\n${b.slides.map((s, n) => `${n + 1}. ${s}`).join('\n')}` : '', b.legenda ? `Legenda sugerida: ${b.legenda}` : ''].filter(Boolean);
    const t = await tasksSvc.create({
      values: { title: `${{ corte: 'Corte', story: 'Story', carrossel: 'Carrossel' }[idea.kind]}: ${idea.title}`, description: lines.join('\n'), kind: idea.kind === 'corte' ? 'cortes' : 'geral', due_on: tasksSvc.addDays(tasksSvc.todayISO(), 3) },
      user: req.user, assigneeId: idea.kind === 'corte' ? idea.editor_id : null, links: { episodeId: idea.episode_id },
    });
    taskId = t.id;
  }
  await db.query('UPDATE social_ideas SET status = $2, task_id = $3, updated_at = now() WHERE id = $1', [idea.id, to, taskId]);
  await req.flash('ok', { aprovada: 'Ideia aprovada e virou tarefa.', feita: 'Marcada como feita: não será sugerida de novo.', descartada: 'Descartada: não será sugerida de novo.', sugerida: 'Ideia reaberta.' }[to]);
  res.redirect(`/social/ideias?status=${idea.status}`);
}));

// ---------------------------------------------------------------- insights
router.get('/social/insights', requirePerm('social.read'), wrap(async (req, res) => {
  const [data, ours] = await Promise.all([social.insights({ force: req.query.atualizar === '1' }), social.ourActivity()]);
  res.render('social/insights', { title: 'Insights', tab: 'insights', data, ours, platforms: up.PLATFORMS, MEDIA });
}));

// ---------------------------------------------------------------- automações
const TRIGGERS = { comentario: 'Comentário', direct: 'Direct' };
const ACTIONS = { dm: 'Mandar direct para quem comentou', resposta: 'Responder o comentário publicamente', ambos: 'Os dois' };
const COMMENT_PLATFORMS = ['instagram', 'facebook', 'youtube'];

function parseRule(body) {
  const v = {
    name: fmt.clean(body.name, 120), trigger: TRIGGERS[body.trigger] ? body.trigger : 'comentario',
    platform: COMMENT_PLATFORMS.includes(body.platform) ? body.platform : 'instagram', scope: body.scope === 'post' ? 'post' : 'recentes',
    post_url: fmt.clean(body.post_url, 500) || null, keywords: String(body.keywords || '').split(/[,\n]/).map((k) => fmt.clean(k, 60)).filter(Boolean).slice(0, 20),
    action: ACTIONS[body.action] ? body.action : 'dm', message: String(body.message || '').replace(/\r/g, '').trim().slice(0, 1000),
    reply_text: String(body.reply_text || '').replace(/\r/g, '').trim().slice(0, 1000) || null,
    buttons: [0, 1, 2].map((n) => ({ title: fmt.clean(body[`button_title_${n}`], 20), url: fmt.clean(body[`button_url_${n}`], 500) })).filter((b) => b.title || b.url),
  };
  if (v.trigger === 'direct') { v.platform = 'instagram'; v.action = 'dm'; v.scope = 'recentes'; v.post_url = null; }
  let error = null;
  if (v.name.length < 2) error = 'Dê um nome para a automação.';
  else if (!v.message && v.action !== 'resposta') error = 'Escreva a mensagem do direct.';
  else if (v.action === 'resposta' && !v.reply_text && !v.message) error = 'Escreva a resposta pública.';
  else if (v.scope === 'post' && !/^https?:\/\//.test(v.post_url || '')) error = 'Cole o link do post a vigiar.';
  else if ((v.action === 'dm' || v.action === 'ambos') && v.platform !== 'instagram') error = 'Direct para quem comentou só funciona no Instagram.';
  else if (v.buttons.some((b) => !b.title || !/^https?:\/\//.test(b.url))) error = 'Cada botão precisa de um texto (até 20 letras) e de um link https://.';
  if (!v.message && v.action === 'resposta') v.message = v.reply_text;
  return { values: v, error };
}

router.get('/social/automacoes', requirePerm('social.read'), wrap(async (req, res) => {
  const { rows: rules } = await db.query(
    `SELECT r.*, (SELECT count(*)::int FROM social_events e WHERE e.rule_id = r.id AND e.status IN ('enviado','simulado')) AS answered,
            (SELECT count(*)::int FROM social_events e WHERE e.rule_id = r.id AND e.status = 'erro') AS errors
       FROM social_rules r ORDER BY r.active DESC, r.id DESC`);
  const { rows: igPosts } = await db.query(
    `SELECT DISTINCT ON (r->>'url') p.title, r->>'url' AS url FROM episode_publications p, jsonb_array_elements(p.results) r
      WHERE r->>'platform' = 'instagram' AND (r->>'ok')::boolean AND coalesce(r->>'url', '') <> '' ORDER BY r->>'url', p.created_at DESC LIMIT 30`);
  res.render('social/automations', {
    title: 'Automações', tab: 'automacoes', rules, triggers: TRIGGERS, actions: ACTIONS, commentPlatforms: COMMENT_PLATFORMS, platforms: up.PLATFORMS, igPosts,
    live: live(), configured: config.uploadPostConfigured, canAutomate: can(req.user.role, 'social.automate'), openNew: req.query.nova === '1',
  });
}));

router.post('/social/automacoes', requirePerm('social.automate'), wrap(async (req, res) => {
  const { values: v, error } = parseRule(req.body);
  if (error) { await req.flash('error', error); return res.redirect('/social/automacoes?nova=1'); }
  const { rows: [r] } = await db.query(
    `INSERT INTO social_rules (name, trigger, platform, scope, post_url, keywords, action, message, reply_text, buttons, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [v.name, v.trigger, v.platform, v.scope, v.post_url, v.keywords, v.action, v.message, v.reply_text, JSON.stringify(v.buttons), req.user.id]);
  await audit(req, 'automacao.criada', 'social_rule', r.id, { name: v.name });
  await req.flash('ok', 'Automação criada, ainda pausada. Revise e ative quando quiser.');
  res.redirect(`/social/automacoes/${r.id}`);
}));

async function findRule(id) {
  if (!isIntId(id)) return null;
  const { rows: [r] } = await db.query('SELECT * FROM social_rules WHERE id = $1', [id]);
  return r || null;
}

router.get('/social/automacoes/:id', requirePerm('social.read'), wrap(async (req, res) => {
  const rule = await findRule(req.params.id);
  if (!rule) return notFound(res);
  const { rows: events } = await db.query('SELECT * FROM social_events WHERE rule_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100', [rule.id]);
  res.render('social/automation', {
    title: rule.name, tab: 'automacoes', rule, events, triggers: TRIGGERS, actions: ACTIONS, commentPlatforms: COMMENT_PLATFORMS, platforms: up.PLATFORMS,
    live: live(), configured: config.uploadPostConfigured, canAutomate: can(req.user.role, 'social.automate'),
  });
}));

router.post('/social/automacoes/:id', requirePerm('social.automate'), wrap(async (req, res) => {
  const rule = await findRule(req.params.id);
  if (!rule) return notFound(res);
  const { values: v, error } = parseRule(req.body);
  if (error) { await req.flash('error', error); return res.redirect(`/social/automacoes/${rule.id}`); }
  await db.query(
    `UPDATE social_rules SET name=$2, trigger=$3, platform=$4, scope=$5, post_url=$6, keywords=$7, action=$8, message=$9, reply_text=$10, buttons=$11, updated_at=now() WHERE id=$1`,
    [rule.id, v.name, v.trigger, v.platform, v.scope, v.post_url, v.keywords, v.action, v.message, v.reply_text, JSON.stringify(v.buttons)]);
  await audit(req, 'automacao.editada', 'social_rule', rule.id);
  await req.flash('ok', 'Automação atualizada.');
  res.redirect(`/social/automacoes/${rule.id}`);
}));

router.post('/social/automacoes/:id/:acao(ativar|pausar|excluir|rodar)', requirePerm('social.automate'), wrap(async (req, res) => {
  const rule = await findRule(req.params.id);
  if (!rule) return notFound(res);
  const acao = req.params.acao;
  if (acao === 'ativar') {
    if (req.body.confirmar !== '1') { await req.flash('error', 'Confirme que a automação vai responder pessoas de verdade.'); return res.redirect(`/social/automacoes/${rule.id}`); }
    await db.query('UPDATE social_rules SET active = true, active_since = now(), last_error = NULL, updated_at = now() WHERE id = $1', [rule.id]);
    await req.flash('ok', live() ? 'Automação ativa. Ela responde o que chegar a partir de agora.' : 'Automação ativa em modo de teste: ela lê os comentários e registra o que responderia, sem enviar nada.');
  } else if (acao === 'pausar') {
    await db.query('UPDATE social_rules SET active = false, updated_at = now() WHERE id = $1', [rule.id]);
    await req.flash('ok', 'Automação pausada.');
  } else if (acao === 'excluir') {
    await db.query('DELETE FROM social_rules WHERE id = $1', [rule.id]);
    await audit(req, 'automacao.excluida', 'social_rule', rule.id, { name: rule.name });
    await req.flash('ok', 'Automação excluída.');
    return res.redirect('/social/automacoes');
  } else if (acao === 'rodar') {
    if (!rule.active) { await req.flash('error', 'Ative a automação antes de rodar.'); return res.redirect(`/social/automacoes/${rule.id}`); }
    const n = await social.runRules();
    const { rows: [fresh] } = await db.query('SELECT last_error FROM social_rules WHERE id = $1', [rule.id]);
    await req.flash(fresh.last_error ? 'error' : 'ok', fresh.last_error ? `Não rodou: ${fresh.last_error}` : `Rodou agora: ${n} resposta(s).`);
  }
  await audit(req, `automacao.${acao}`, 'social_rule', rule.id);
  res.redirect(`/social/automacoes/${rule.id}`);
}));

module.exports = router;
