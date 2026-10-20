// Área Tarefas: minhas, hoje e todas; em lista, quadro (Kanban) ou calendário. Status: a fazer, fazendo, feito e bloqueada (com motivo).
const express = require('express');
const config = require('../config');
const groq = require('../services/groq');
const taskVoice = require('../services/taskVoice');
const { createLimiter } = require('../auth/rateLimit');
const db = require('../db/pool');
const tasks = require('../services/tasks');
const comments = require('../services/comments');
const C = require('../constants');
const { can } = require('../permissions');
const { requirePerm } = require('../middleware');
const { audit } = require('../services/audit');
const { wrap, isIntId, isUuid } = require('../utils/wrap');

const router = express.Router();
const voiceLimiter = createLimiter({ name: 'tarefa-voz', max: 30, windowMs: 10 * 60_000 });
const MAX_AUDIO = 8 * 1024 * 1024; // ~2 min de voz
const voiceReady = () => config.groqConfigured && config.geminiConfigured;
const SCOPES = { minhas: 'Minhas tarefas', hoje: 'Hoje', todas: 'Todas' };
const VIEWS = { lista: 'Lista', quadro: 'Quadro', calendario: 'Calendário' };
const wantsJson = (req) => /json/.test(req.get('accept') || '');
const notFound = (res) => res.status(404).render('error', { title: 'Não encontrado', message: 'Tarefa não encontrada.' });
const backTo = (req, fallback) => { const v = String(req.body.voltar || ''); return /^\/(?!\/)[\w\-/?=&#.%]*$/.test(v) ? v : fallback; };

// Calendário do mês (semanas de segunda a domingo).
function monthGrid(ym) {
  const [y, m] = (/^\d{4}-\d{2}$/.test(ym || '') ? ym : tasks.todayISO().slice(0, 7)).split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first); start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  const days = [];
  for (let i = 0; i < 42; i += 1) { const d = new Date(start); d.setUTCDate(start.getUTCDate() + i); days.push({ iso: d.toISOString().slice(0, 10), day: d.getUTCDate(), inMonth: d.getUTCMonth() === m - 1 }); }
  const weeks = []; for (let i = 0; i < 42; i += 7) weeks.push(days.slice(i, i + 7));
  if (!weeks[5].some((d) => d.inMonth)) weeks.pop();
  const shift = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const raw = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  const label = raw.charAt(0).toUpperCase() + raw.slice(1); // "Outubro de 2026"
  return { ym: `${y}-${String(m).padStart(2, '0')}`, label, weeks, from: weeks[0][0].iso, to: weeks.at(-1)[6].iso, prev: shift(-1), next: shift(1) };
}

const isoOf = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

async function linkOptions() {
  const [eps, guests, sponsors, users] = await Promise.all([
    db.query("SELECT id, number, title FROM episodes WHERE status <> 'publicado' ORDER BY number DESC NULLS LAST, id DESC LIMIT 100"),
    db.query("SELECT id, name FROM guests WHERE status NOT IN ('perdido','cancelado') ORDER BY updated_at DESC LIMIT 200"),
    db.query("SELECT id, company FROM sponsors WHERE stage NOT IN ('perdido') ORDER BY company LIMIT 200"),
    db.query('SELECT id, name FROM users WHERE active ORDER BY lower(name)'),
  ]);
  return { episodes: eps.rows, guests: guests.rows, sponsors: sponsors.rows, users: users.rows };
}

// Liga a tarefa a um item (episódio, convidado, patrocinador), se existir.
async function readLinks(body) {
  const links = {};
  for (const [field, table, key] of [['episode_id', 'episodes', 'episodeId'], ['guest_id', 'guests', 'guestId'], ['sponsor_id', 'sponsors', 'sponsorId']]) {
    if (isIntId(body[field])) { const { rows } = await db.query(`SELECT 1 FROM ${table} WHERE id = $1`, [body[field]]); if (rows.length) links[key] = Number(body[field]); }
  }
  return links;
}

router.get('/tarefas', requirePerm('tasks.read'), wrap(async (req, res) => {
  const scope = SCOPES[req.query.escopo] ? req.query.escopo : 'minhas';
  const view = VIEWS[req.query.visao] ? req.query.visao : 'lista';
  const q = String(req.query.q || '').trim().slice(0, 80);
  const cal = view === 'calendario' ? monthGrid(req.query.mes) : null;
  const items = await tasks.list({ user: req.user, scope, q, ...(cal ? { from: cal.from, to: cal.to } : {}) });
  const [opts, counts] = await Promise.all([
    linkOptions(),
    db.query(`SELECT count(*) FILTER (WHERE assignee_id = $1 AND status <> 'feito')::int AS minhas,
                     count(*) FILTER (WHERE assignee_id = $1 AND status <> 'feito' AND due_on <= $2)::int AS hoje,
                     count(*) FILTER (WHERE status <> 'feito')::int AS todas FROM tasks`, [req.user.id, tasks.todayISO()]),
  ]);
  const prefill = { episode_id: req.query.episodio || '', guest_id: req.query.convidado || '', sponsor_id: req.query.patrocinador || '' };
  res.render('tasks/index', {
    title: 'Tarefas', items, scope, view, q, cal, scopes: SCOPES, views: VIEWS, counts: counts.rows[0], ...opts, prefill, openNew: req.query.nova === '1',
    voiceReady: voiceReady(), today: tasks.todayISO(), lateOf: (t) => tasks.isLate(t), isoOf, C, canEdit: (t) => tasks.canEdit(req.user, t),
  });
}));

// Tarefa por voz: o navegador manda o áudio, o servidor transcreve e organiza em um rascunho de tarefa (nada é criado aqui).
router.post('/tarefas/voz', requirePerm('tasks.write'), express.raw({ type: () => true, limit: MAX_AUDIO }), wrap(async (req, res) => {
  const fail = (status, error) => res.status(status).json({ ok: false, error });
  if (!voiceReady()) return fail(503, 'A tarefa por voz precisa da transcrição (Groq) e da IA (Gemini) configuradas neste servidor.');
  const type = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!type.startsWith('audio/') && type !== 'video/webm') return fail(400, 'Formato de áudio não aceito.');
  if (!Buffer.isBuffer(req.body) || req.body.length < 500) return fail(400, 'A gravação ficou vazia. Tente de novo.');
  if (!await voiceLimiter.hit(req.user.id)) return fail(429, 'Muitas gravações seguidas. Espere alguns minutos.');
  let text;
  try { text = await groq.transcribe(req.body, { filename: `tarefa.${type.split('/')[1] || 'webm'}`, contentType: type }); } catch (err) {
    console.error('[tarefa por voz] transcrição:', err.message);
    return fail(502, 'Não consegui entender o áudio agora. Tente de novo ou escreva a tarefa.');
  }
  if (!text) return fail(422, 'Não ouvi nada na gravação. Tente de novo mais perto do microfone.');
  let r;
  try { r = await taskVoice.organize({ text, user: req.user }); } catch (err) {
    console.error('[tarefa por voz] organização:', err.message);
    return fail(502, 'Entendi o áudio, mas não consegui organizar a tarefa agora. Tente de novo.');
  }
  if (r.error) return res.status(422).json({ ok: false, error: r.error, transcript: text });
  await audit(req, 'tarefa.voz', 'task', null, { caracteres: text.length });
  res.json({ ok: true, transcript: text, draft: r.draft, warnings: r.warnings });
}));

router.post('/tarefas', requirePerm('tasks.write'), wrap(async (req, res) => {
  const { values, error } = tasks.parse(req.body);
  if (error) { if (wantsJson(req)) return res.status(422).json({ ok: false, error }); await req.flash('error', error); return res.redirect(backTo(req, '/tarefas')); }
  let assignee = isUuid(req.body.assignee_id) ? req.body.assignee_id : null;
  if (assignee && assignee !== req.user.id && !can(req.user.role, 'tasks.write')) assignee = null;
  const task = await tasks.create({ values, user: req.user, assigneeId: assignee, links: await readLinks(req.body) });
  await audit(req, 'tarefa.criada', 'task', task.id, { titulo: task.title });
  if (wantsJson(req)) return res.json({ ok: true, task });
  await req.flash('ok', 'Tarefa criada.');
  res.redirect(backTo(req, `/tarefas/${task.id}`));
}));

router.get('/tarefas/:id', requirePerm('tasks.read'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return notFound(res);
  const task = await tasks.get(req.params.id);
  if (!task) return notFound(res);
  const [opts, thread] = await Promise.all([linkOptions(), comments.list('task', task.id)]);
  res.render('tasks/show', { title: task.title, task, ...opts, comments: thread, C, isoOf, editable: tasks.canEdit(req.user, task), today: tasks.todayISO(), lateOf: (t) => tasks.isLate(t) });
}));

router.post('/tarefas/:id', requirePerm('tasks.write'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return notFound(res);
  const task = await tasks.get(req.params.id);
  if (!task) return notFound(res);
  if (!tasks.canEdit(req.user, task)) return res.status(403).render('error', { title: 'Sem permissão', message: 'Você só altera tarefas que criou ou que são suas.' });
  const { values, error } = tasks.parse({ ...task, due_on: isoOf(task.due_on) || '', due_time: task.due_time || '', ...req.body });
  if (error) { await req.flash('error', error); return res.redirect(`/tarefas/${task.id}`); }
  const links = await readLinks(req.body);
  const result = await tasks.update(task, values, req.user, { assigneeId: req.body.assignee_id !== undefined ? (isUuid(req.body.assignee_id) ? req.body.assignee_id : null) : undefined });
  if (result.error) { await req.flash('error', result.error); return res.redirect(`/tarefas/${task.id}`); }
  if (req.body.episode_id !== undefined) await db.query('UPDATE tasks SET episode_id = $2, guest_id = $3, sponsor_id = $4 WHERE id = $1', [task.id, links.episodeId || null, links.guestId || null, links.sponsorId || null]);
  await req.flash('ok', 'Tarefa salva.');
  res.redirect(backTo(req, `/tarefas/${task.id}`));
}));

// Mudança rápida de status (quadro e lista). Bloqueada exige motivo.
router.post('/tarefas/:id/status', requirePerm('tasks.write'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return res.status(404).json({ ok: false });
  const task = await tasks.get(req.params.id);
  if (!task) return res.status(404).json({ ok: false, error: 'Tarefa não encontrada.' });
  if (!tasks.canEdit(req.user, task)) return res.status(403).json({ ok: false, error: 'Você só altera tarefas que criou ou que são suas.' });
  const status = String(req.body.status || '');
  if (!tasks.STATUSES.includes(status)) return res.status(400).json({ ok: false, error: 'Status inválido.' });
  const reason = String(req.body.block_reason || '').trim().slice(0, 500);
  if (status === 'bloqueada' && !reason) return res.status(422).json({ ok: false, error: 'Diga o motivo do bloqueio.' });
  const result = await tasks.update(task, { status, block_reason: status === 'bloqueada' ? reason : null }, req.user);
  if (result.error) return res.status(result.status || 422).json({ ok: false, error: result.error });
  if (task.episode_id && result.task.status !== task.status) await require('../services/production').addEvent(task.episode_id, req.user.id, 'tarefa', `${task.title}: ${C.TASK_STATUSES[status]}`);
  if (wantsJson(req)) return res.json({ ok: true, task: result.task });
  res.redirect(backTo(req, `/tarefas/${task.id}`));
}));

router.post('/tarefas/:id/excluir', requirePerm('tasks.write'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return notFound(res);
  const task = await tasks.get(req.params.id);
  if (!task) return notFound(res);
  if (!can(req.user.role, 'tasks.manage') && String(task.created_by) !== String(req.user.id)) return res.status(403).render('error', { title: 'Sem permissão', message: 'Só quem criou (ou a gestão) apaga a tarefa.' });
  await db.query('DELETE FROM tasks WHERE id = $1', [task.id]);
  await db.query("DELETE FROM comments WHERE entity_type = 'task' AND entity_id = $1", [task.id]);
  await audit(req, 'tarefa.excluida', 'task', task.id, { titulo: task.title });
  res.redirect(backTo(req, '/tarefas'));
}));

module.exports = router;
