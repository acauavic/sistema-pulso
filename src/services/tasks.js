// Tarefas de todo o sistema: soltas ou ligadas a um episódio, convidado ou patrocinador. Status: a fazer, fazendo, feito e bloqueada
// (com motivo). Rotinas criam tarefas sozinhas em momentos da produção, com vencimento padrão (sempre alterável).
const db = require('../db/pool');
const C = require('../constants');
const { can } = require('../permissions');
const { notify } = require('./notify');
const { clean, parseInputDate } = require('../utils/format');

const STATUSES = Object.keys(C.TASK_STATUSES);
const TZ = 'America/Sao_Paulo';
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); // AAAA-MM-DD no horário de Brasília

const SELECT = `SELECT t.*, a.name AS assignee_name, cb.name AS creator_name,
    e.title AS episode_title, e.number AS episode_number, g.name AS guest_name, s.company AS sponsor_name,
    (SELECT count(*)::int FROM comments c WHERE c.entity_type = 'task' AND c.entity_id = t.id) AS comments
  FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users cb ON cb.id = t.created_by
  LEFT JOIN episodes e ON e.id = t.episode_id LEFT JOIN guests g ON g.id = t.guest_id LEFT JOIN sponsors s ON s.id = t.sponsor_id`;

const get = (id) => db.query(`${SELECT} WHERE t.id = $1`, [id]).then((r) => r.rows[0] || null);

// Pode mexer: quem gerencia tarefas, quem criou ou quem é o responsável.
const canEdit = (user, task) => can(user.role, 'tasks.manage') || [task.created_by, task.assignee_id].map(String).includes(String(user.id));

// escopo: 'minhas' (sou o responsável), 'hoje' (minhas que vencem hoje ou estão atrasadas), 'todas'.
async function list({ user, scope = 'minhas', status = null, from = null, to = null, q = '' }) {
  const params = []; const where = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (scope === 'minhas' || scope === 'hoje') where.push(`t.assignee_id = ${p(user.id)}`);
  if (scope === 'hoje') where.push(`t.status <> 'feito' AND t.due_on <= ${p(todayISO())}`);
  if (status && STATUSES.includes(status)) where.push(`t.status = ${p(status)}`);
  if (from) where.push(`t.due_on >= ${p(from)}`);
  if (to) where.push(`t.due_on <= ${p(to)}`);
  if (q) where.push(`(t.title ILIKE ${p(`%${q.replace(/[\\%_]/g, '\\$&')}%`)} OR t.description ILIKE $${params.length})`);
  const { rows } = await db.query(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY (t.status = 'feito'), t.due_on NULLS LAST, t.id DESC LIMIT 1000`, params);
  return rows;
}

// Lê o formulário (criar/editar). partial: só o que veio.
function parse(body, { partial = false } = {}) {
  const v = {}; const errors = [];
  if (!partial || body.title !== undefined) { v.title = clean(body.title, 200); if (!v.title) errors.push('Dê um título para a tarefa.'); }
  if (!partial || body.description !== undefined) v.description = String(body.description || '').replace(/\r/g, '').trim().slice(0, 4000) || null;
  if (!partial || body.kind !== undefined) v.kind = Object.prototype.hasOwnProperty.call(C.TASK_KINDS, body.kind) ? body.kind : 'geral';
  if (!partial || body.status !== undefined) v.status = STATUSES.includes(body.status) ? body.status : 'a_fazer';
  if (!partial || body.block_reason !== undefined) v.block_reason = clean(body.block_reason, 500) || null;
  if (!partial || body.due_on !== undefined) {
    if (body.due_on && !parseInputDate(body.due_on)) errors.push('Data de vencimento inválida.');
    v.due_on = body.due_on && parseInputDate(body.due_on) ? body.due_on : null;
  }
  if (!partial || body.notes !== undefined) v.notes = clean(body.notes, 1000) || null;
  if (v.status === 'bloqueada' && !v.block_reason) errors.push('Diga o motivo do bloqueio.');
  return { values: v, error: errors[0] || null };
}

// autoKey: tarefa do sistema que não pode repetir (se já existe uma com a mesma chave, não cria e devolve null).
async function create({ values, user, assigneeId = null, links = {}, routineId = null, notifyAssignee = true, autoKey = null }) {
  const { rows: [t] } = await db.query(
    `INSERT INTO tasks (title, description, kind, status, block_reason, due_on, notes, assignee_id, created_by, episode_id, guest_id, sponsor_id, routine_id, completed_at, auto_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, CASE WHEN $4 = 'feito' THEN now() END, $14)
     ON CONFLICT (auto_key) WHERE auto_key IS NOT NULL DO NOTHING RETURNING *`,
    [values.title, values.description || null, values.kind || 'geral', values.status || 'a_fazer', values.status === 'bloqueada' ? values.block_reason : null, values.due_on || null,
      values.notes || null, assigneeId || null, user?.id || null, links.episodeId || null, links.guestId || null, links.sponsorId || null, routineId, autoKey]);
  if (!t) return null;
  if (notifyAssignee && assigneeId) {
    await notify({ type: 'tarefa', users: [assigneeId], title: `${user ? `${user.name} criou uma tarefa para você` : 'Nova tarefa para você'}: ${t.title}`, body: t.due_on ? `Vence em ${formatDay(t.due_on)}.` : null, url: `/tarefas/${t.id}`, actorId: user?.id || null, entity: { type: 'task', id: t.id } });
  }
  return t;
}

const formatDay = (d) => { const s = typeof d === 'string' ? d : new Date(d).toISOString().slice(0, 10); const [y, m, dd] = s.slice(0, 10).split('-'); return `${dd}/${m}/${y}`; };

// Atualiza e avisa: concluída (avisa quem criou), bloqueada (avisa quem criou e a gestão), responsável novo (avisa ele).
async function update(task, values, user, { assigneeId } = {}) {
  const next = { ...task, ...values };
  if (next.status === 'bloqueada' && !next.block_reason) return { error: 'Diga o motivo do bloqueio.' };
  if (next.status !== 'bloqueada') next.block_reason = null;
  const reassign = assigneeId !== undefined && String(assigneeId || '') !== String(task.assignee_id || '');
  if (reassign && !can(user.role, 'tasks.manage') && ![task.created_by, task.assignee_id].map(String).includes(String(user.id))) return { error: 'Você não pode reatribuir esta tarefa.', status: 403 };
  const { rows: [t] } = await db.query(
    `UPDATE tasks SET title = $2, description = $3, kind = $4, status = $5, block_reason = $6, due_on = $7, notes = $8, assignee_id = $9,
       completed_at = CASE WHEN $5 = 'feito' THEN coalesce(completed_at, now()) ELSE NULL END, updated_at = now() WHERE id = $1 RETURNING *`,
    [task.id, next.title, next.description, next.kind, next.status, next.block_reason, next.due_on, next.notes, reassign ? (assigneeId || null) : task.assignee_id]);
  const url = `/tarefas/${t.id}`;
  if (t.status !== task.status) {
    if (t.status === 'feito') await notify({ type: 'tarefa', users: [task.created_by], title: `${user.name} concluiu: ${t.title}`, url, actorId: user.id, entity: { type: 'task', id: t.id } });
    if (t.status === 'bloqueada') await notify({ type: 'tarefa', users: [task.created_by, task.assignee_id], title: `Tarefa bloqueada: ${t.title}`, body: `Motivo: ${t.block_reason}`, url, actorId: user.id, entity: { type: 'task', id: t.id } });
  }
  if (reassign && t.assignee_id) await notify({ type: 'tarefa', users: [t.assignee_id], title: `${user.name} atribuiu uma tarefa a você: ${t.title}`, body: t.due_on ? `Vence em ${formatDay(t.due_on)}.` : null, url, actorId: user.id, entity: { type: 'task', id: t.id } });
  return { task: t };
}

// ---------------------------------------------------------------- rotinas
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Cria as tarefas das rotinas ativas para este gatilho no episódio (não repete a mesma rotina no mesmo episódio).
async function applyRoutines(trigger, episodeId, user = null) {
  const { rows: routines } = await db.query('SELECT * FROM task_routines WHERE active AND trigger = $1 ORDER BY position, id', [trigger]);
  if (!routines.length) return [];
  const { rows: [ep] } = await db.query(
    `SELECT e.*, g.owner_id AS guest_owner, coalesce(e.recorded_on, (g.proposed_at AT TIME ZONE 'America/Sao_Paulo')::date) AS recording_on FROM episodes e LEFT JOIN guests g ON g.id = e.guest_id WHERE e.id = $1`, [episodeId]);
  if (!ep) return [];
  const made = [];
  for (const r of routines) {
    const { rows: dup } = await db.query('SELECT 1 FROM tasks WHERE episode_id = $1 AND routine_id = $2', [episodeId, r.id]);
    if (dup.length) continue;
    const base = r.anchor === 'gravacao' ? ep.recording_on : r.anchor === 'veiculacao' ? ep.aired_on : null;
    const baseIso = base ? (base instanceof Date ? base.toISOString().slice(0, 10) : String(base).slice(0, 10)) : todayISO();
    const assignee = { editor: ep.editor_id, responsavel_convidado: ep.guest_owner, usuario: r.assignee_id }[r.assignee_mode] || null;
    made.push(await create({
      values: { title: r.title, description: r.description, kind: r.kind, status: 'a_fazer', due_on: addDays(baseIso, r.offset_days) },
      user, assigneeId: assignee, links: { episodeId }, routineId: r.id,
    }));
  }
  return made;
}

// Rotina do sistema (roda junto com o agendador): avisa o responsável das tarefas que vencem hoje e das atrasadas, uma vez por dia.
async function dueTick() {
  const today = todayISO();
  const { rows } = await db.query("SELECT id, title, due_on, assignee_id FROM tasks WHERE status <> 'feito' AND assignee_id IS NOT NULL AND due_on <= $1", [today]);
  let sent = 0;
  for (const t of rows) {
    const due = t.due_on instanceof Date ? t.due_on.toISOString().slice(0, 10) : String(t.due_on).slice(0, 10);
    const late = due < today;
    sent += (await notify({ type: 'tarefa', users: [t.assignee_id], title: late ? `Tarefa atrasada: ${t.title}` : `Tarefa vence hoje: ${t.title}`, body: late ? `Venceu em ${formatDay(due)}.` : null, url: `/tarefas/${t.id}`, entity: { type: 'task', id: t.id }, dedupe: `${late ? 'late' : 'due'}-${t.id}-${today}` })).length;
  }
  return sent;
}

module.exports = { STATUSES, todayISO, addDays, get, list, parse, create, update, canEdit, applyRoutines, dueTick, formatDay };
