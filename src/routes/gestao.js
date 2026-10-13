// Painel de gestão: usuários, logs (auditoria), notificações, rotinas de tarefas, busca global e integrações num lugar só.
const express = require('express');
const db = require('../db/pool');
const C = require('../constants');
const search = require('../services/search');
const { ROLES, PERMISSIONS, can } = require('../permissions');
const { requirePerm } = require('../middleware');
const { audit } = require('../services/audit');
const { clean } = require('../utils/format');
const { wrap, isIntId, isUuid } = require('../utils/wrap');

const router = express.Router();
const anyGestao = (req, res, next) => (['users.read', 'audit.read', 'notifications.manage', 'routines.manage', 'search.manage', 'integrations.manage', 'plans.manage'].some((p) => can(req.user.role, p))
  ? next() : res.status(403).render('error', { title: 'Sem permissão', message: 'Seu perfil não acessa o painel de gestão.' }));

router.get('/gestao', anyGestao, wrap(async (req, res) => {
  const [users, audit24, routines, shortcuts, tips] = await Promise.all([
    db.query('SELECT count(*) FILTER (WHERE active)::int AS active, count(*) FILTER (WHERE active AND password_hash IS NULL)::int AS pending FROM users'),
    db.query("SELECT count(*)::int AS n FROM audit_log WHERE created_at > now() - interval '24 hours'"),
    db.query('SELECT count(*) FILTER (WHERE active)::int AS n FROM task_routines'),
    db.query('SELECT count(*)::int AS n FROM search_shortcuts'),
    can(req.user.role, 'search.manage') ? search.suggestions(req.app) : [],
  ]);
  res.render('gestao/index', { title: 'Gestão', stats: { users: users.rows[0], audit: audit24.rows[0].n, routines: routines.rows[0].n, shortcuts: shortcuts.rows[0].n, tips: tips.length } });
}));

// ---------------------------------------------------------------- notificações (configuração geral)
router.get('/gestao/notificacoes', requirePerm('notifications.manage'), wrap(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM notification_settings');
  const { rows: last } = await db.query('SELECT type, count(*)::int AS n FROM notifications WHERE created_at > now() - interval \'7 days\' GROUP BY type');
  res.render('gestao/notifications', { title: 'Notificações', settings: Object.fromEntries(rows.map((r) => [r.type, r])), types: C.NOTIFICATION_TYPES, roles: ROLES, week: Object.fromEntries(last.map((r) => [r.type, r.n])) });
}));

router.post('/gestao/notificacoes', requirePerm('notifications.manage'), wrap(async (req, res) => {
  for (const type of Object.keys(C.NOTIFICATION_TYPES)) {
    const inApp = req.body[`${type}_in_app`] === '1'; const email = req.body[`${type}_email`] === '1';
    const roles = [].concat(req.body[`${type}_roles`] || []).filter((r) => ROLES[r]);
    await db.query('UPDATE notification_settings SET in_app = $2, email = $3, roles = $4, updated_at = now(), updated_by = $5 WHERE type = $1', [type, inApp, email, roles, req.user.id]);
  }
  await audit(req, 'notificacoes.configuradas', 'settings', null, {});
  await req.flash('ok', 'Configuração das notificações salva.');
  res.redirect('/gestao/notificacoes');
}));

// ---------------------------------------------------------------- rotinas de tarefas
function parseRoutine(body) {
  const v = {
    trigger: C.ROUTINE_TRIGGERS[body.trigger] ? body.trigger : null,
    kind: C.TASK_KINDS[body.kind] ? body.kind : 'geral',
    title: clean(body.title, 200),
    description: String(body.description || '').trim().slice(0, 2000) || null,
    anchor: C.ROUTINE_ANCHORS[body.anchor] ? body.anchor : 'gatilho',
    offset_days: Math.max(-365, Math.min(365, Number.parseInt(body.offset_days, 10) || 0)),
    assignee_mode: C.ROUTINE_ASSIGNEES[body.assignee_mode] ? body.assignee_mode : 'ninguem',
    assignee_id: isUuid(body.assignee_id) ? body.assignee_id : null,
    active: body.active === '1',
  };
  if (!v.trigger) return { error: 'Escolha quando a tarefa é criada.' };
  if (!v.title) return { error: 'Dê um título para a tarefa.' };
  if (v.assignee_mode === 'usuario' && !v.assignee_id) return { error: 'Escolha a pessoa fixa.' };
  if (v.assignee_mode !== 'usuario') v.assignee_id = null;
  return { values: v };
}

router.get('/gestao/rotinas', requirePerm('routines.manage'), wrap(async (req, res) => {
  const [routines, users] = await Promise.all([
    db.query(`SELECT r.*, u.name AS assignee_name, (SELECT count(*)::int FROM tasks t WHERE t.routine_id = r.id) AS created FROM task_routines r
               LEFT JOIN users u ON u.id = r.assignee_id ORDER BY r.trigger, r.position, r.id`),
    db.query('SELECT id, name FROM users WHERE active ORDER BY lower(name)'),
  ]);
  res.render('gestao/routines', { title: 'Rotinas de tarefas', routines: routines.rows, users: users.rows, C, editing: isIntId(req.query.editar) ? Number(req.query.editar) : null });
}));

router.post('/gestao/rotinas', requirePerm('routines.manage'), wrap(async (req, res) => {
  const { values: v, error } = parseRoutine({ active: '1', ...req.body });
  if (error) { await req.flash('error', error); return res.redirect('/gestao/rotinas'); }
  const { rows: [r] } = await db.query(
    `INSERT INTO task_routines (trigger, kind, title, description, anchor, offset_days, assignee_mode, assignee_id, active, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, (SELECT coalesce(max(position),0)+1 FROM task_routines)) RETURNING id`,
    [v.trigger, v.kind, v.title, v.description, v.anchor, v.offset_days, v.assignee_mode, v.assignee_id, v.active]);
  await audit(req, 'rotina.criada', 'routine', r.id, { titulo: v.title });
  await req.flash('ok', 'Rotina criada. Vale para os próximos episódios que passarem por esse momento.');
  res.redirect('/gestao/rotinas');
}));

router.post('/gestao/rotinas/:id', requirePerm('routines.manage'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return res.redirect('/gestao/rotinas');
  const { values: v, error } = parseRoutine(req.body);
  if (error) { await req.flash('error', error); return res.redirect(`/gestao/rotinas?editar=${req.params.id}`); }
  await db.query(`UPDATE task_routines SET trigger=$2, kind=$3, title=$4, description=$5, anchor=$6, offset_days=$7, assignee_mode=$8, assignee_id=$9, active=$10, updated_at=now() WHERE id=$1`,
    [req.params.id, v.trigger, v.kind, v.title, v.description, v.anchor, v.offset_days, v.assignee_mode, v.assignee_id, v.active]);
  await audit(req, 'rotina.editada', 'routine', req.params.id, { titulo: v.title });
  await req.flash('ok', 'Rotina salva. Tarefas já criadas não mudam (o vencimento delas é editado na própria tarefa).');
  res.redirect('/gestao/rotinas');
}));

router.post('/gestao/rotinas/:id/excluir', requirePerm('routines.manage'), wrap(async (req, res) => {
  if (isIntId(req.params.id)) { await db.query('DELETE FROM task_routines WHERE id = $1', [req.params.id]); await audit(req, 'rotina.excluida', 'routine', req.params.id, {}); }
  res.redirect('/gestao/rotinas');
}));

// ---------------------------------------------------------------- busca global: atalhos e sugestões
router.get('/gestao/busca', requirePerm('search.manage'), wrap(async (req, res) => {
  const [tips, shortcuts, top, misses] = await Promise.all([
    search.suggestions(req.app),
    db.query('SELECT s.*, u.name AS author FROM search_shortcuts s LEFT JOIN users u ON u.id = s.created_by ORDER BY s.label'),
    db.query("SELECT lower(q) AS q, count(*)::int AS n FROM search_log WHERE created_at > now() - interval '30 days' GROUP BY lower(q) ORDER BY count(*) DESC LIMIT 12"),
    db.query("SELECT count(*)::int AS n FROM search_log WHERE results = 0 AND created_at > now() - interval '30 days'"),
  ]);
  res.render('gestao/search', {
    title: 'Busca global', tips, shortcuts: shortcuts.rows, top: top.rows, misses: misses.rows[0].n,
    actions: search.ACTIONS, providers: search.PROVIDERS.map((p) => ({ label: p.label, tables: p.tables })), perms: Object.keys(PERMISSIONS),
    prefill: { label: String(req.query.label || ''), url: String(req.query.url || ''), keywords: String(req.query.keywords || ''), sugestao: String(req.query.sugestao || '') },
  });
}));

router.post('/gestao/busca/atalhos', requirePerm('search.manage'), wrap(async (req, res) => {
  const label = clean(req.body.label, 80); const url = String(req.body.url || '').trim().slice(0, 300);
  const keywords = clean(req.body.keywords, 300) || null; const perm = PERMISSIONS[req.body.perm] ? req.body.perm : null;
  if (!label || !/^\/(?!\/)/.test(url)) { await req.flash('error', 'Dê um nome e um endereço do próprio painel (começando com /).'); return res.redirect('/gestao/busca'); }
  const { rows: [s] } = await db.query('INSERT INTO search_shortcuts (label, url, keywords, perm, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [label, url, keywords, perm, req.user.id]);
  if (req.body.sugestao) await db.query('INSERT INTO search_dismissed (key) VALUES ($1) ON CONFLICT DO NOTHING', [String(req.body.sugestao).slice(0, 300)]);
  await audit(req, 'busca.atalho_criado', 'shortcut', s.id, { label, url });
  await req.flash('ok', `Atalho “${label}” criado: já aparece no Ctrl+K.`);
  res.redirect('/gestao/busca');
}));

router.post('/gestao/busca/atalhos/:id/excluir', requirePerm('search.manage'), wrap(async (req, res) => {
  if (isIntId(req.params.id)) await db.query('DELETE FROM search_shortcuts WHERE id = $1', [req.params.id]);
  res.redirect('/gestao/busca');
}));

router.post('/gestao/busca/dispensar', requirePerm('search.manage'), wrap(async (req, res) => {
  const key = String(req.body.key || '').slice(0, 300);
  if (key) await db.query('INSERT INTO search_dismissed (key) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
  res.redirect('/gestao/busca');
}));

// ---- Sistema: fila de trabalhos, processos (workers) e rotinas ----
const JOB_LABEL = { corte: 'Ler corte', finalizacao: 'Análise por IA do episódio', social_ideias: 'Ideias para as redes', email_notificacao: 'E-mail de notificação' };
router.get('/gestao/sistema', requirePerm('integrations.manage'), wrap(async (req, res) => {
  const [counts, failed, running, workers, runs] = await Promise.all([
    db.query("SELECT status, count(*)::int AS n FROM jobs WHERE status <> 'done' OR finished_at > now() - interval '24 hours' GROUP BY status"),
    db.query("SELECT * FROM jobs WHERE status = 'error' ORDER BY finished_at DESC NULLS LAST LIMIT 30"),
    db.query("SELECT * FROM jobs WHERE status IN ('running','queued') ORDER BY status DESC, run_after LIMIT 30"),
    db.query("SELECT *, seen_at > now() - interval '90 seconds' AS alive FROM worker_heartbeats WHERE seen_at > now() - interval '1 hour' ORDER BY seen_at DESC LIMIT 10"),
    db.query('SELECT * FROM scheduler_runs ORDER BY name'),
  ]);
  res.render('gestao/system', {
    title: 'Sistema', counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])), failed: failed.rows, running: running.rows,
    workers: workers.rows, runs: runs.rows, jobLabel: JOB_LABEL, sse: require('../services/realtime').connectedCount(),
  });
}));

router.post('/gestao/sistema/trabalhos/:id/repetir', requirePerm('integrations.manage'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return res.redirect('/gestao/sistema');
  const job = await require('../services/jobs').retryJob(Number(req.params.id));
  await audit(req, 'trabalho.repetido', 'job', req.params.id);
  await req.flash(job ? 'ok' : 'error', job ? 'Trabalho de volta na fila.' : 'Esse trabalho não está com erro.');
  res.redirect('/gestao/sistema');
}));

module.exports = router;
