// Rotinas que se repetem (Gestão > Rotinas com "Repete", ou "Repetir" ao criar uma tarefa): todo dia útil, toda semana (nos dias
// escolhidos) ou todo mês (no dia escolhido; num mês mais curto, no último dia). A cada volta do agendador, a rotina ativa que cai hoje
// e ainda não rodou hoje cria a tarefa ou o pedido de conteúdo do dia, com o vencimento no próprio dia (e a hora, se tiver).
// A rotina é "reservada" com last_run_on antes de criar: com dois processos rodando, só um cria.
const db = require('../db/pool');
const catalog = require('./catalog');

const TZ = 'America/Sao_Paulo';
const REPEATS = { dia_util: 'Todo dia útil', semana: 'Toda semana', mes: 'Todo mês' };
const WEEKDAYS = { 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sáb', 7: 'dom' };
const START_HOUR = 5; // cria a partir das 5h: de manhã a tarefa do dia já está lá

const todayISO = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
const hourOf = (now = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(now));
const isoWeekday = (iso) => { const d = new Date(`${iso}T12:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };
const lastDayOf = (iso) => { const d = new Date(`${iso.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.getUTCDate(); };

function fallsOn(r, iso) {
  const wd = isoWeekday(iso);
  if (r.repeat === 'dia_util') return wd <= 5;
  if (r.repeat === 'semana') return (r.weekdays || []).map(Number).includes(wd);
  if (r.repeat === 'mes') {
    const day = Number(iso.slice(8, 10)); const want = Number(r.month_day); const last = lastDayOf(iso);
    return day === want || (want > last && day === last);
  }
  return false;
}

const hm = (t) => { const m = String(t || '').match(/^(\d{2}):(\d{2})/); return m ? (m[2] === '00' ? `${Number(m[1])}h` : `${Number(m[1])}h${m[2]}`) : ''; };
// "Toda semana: seg e qua · até 14h"
function describe(r) {
  let s = REPEATS[r.repeat] || '';
  if (r.repeat === 'semana') {
    const days = (r.weekdays || []).map(Number).sort().map((d) => WEEKDAYS[d]).filter(Boolean);
    s += days.length ? `: ${days.length > 1 ? `${days.slice(0, -1).join(', ')} e ${days.at(-1)}` : days[0]}` : '';
  }
  if (r.repeat === 'mes') s += `, dia ${r.month_day}`;
  if (r.due_time) s += ` · até ${hm(r.due_time)}`;
  return s;
}

// Cria o item do dia da rotina (tarefa ou pedido de conteúdo).
async function createFor(r, day, user = null) {
  const assignee = r.assignee_mode === 'usuario' ? r.assignee_id : null;
  if (r.target === 'pedido') {
    return require('./contentRequests').create({
      kind: catalog.isVideoType(r.request_kind, { active: false }) ? r.request_kind : 'outro', title: r.title, briefing: r.description || null, format: null,
      episode_id: null, assignee_id: assignee, due_on: day, priority: Boolean(r.priority), routine_id: r.id,
    }, user);
  }
  return require('./tasks').create({
    values: { title: r.title, description: r.description, kind: r.kind, status: 'a_fazer', due_on: day, due_time: r.due_time ? String(r.due_time).slice(0, 5) : null },
    user, assigneeId: assignee, routineId: r.id,
  });
}

// Volta do agendador (a cada 15 min).
async function tick(now = new Date()) {
  if (hourOf(now) < START_HOUR) return 0;
  const today = todayISO(now);
  await catalog.refresh();
  const { rows } = await db.query("SELECT * FROM task_routines WHERE active AND trigger = 'recorrente' AND (last_run_on IS NULL OR last_run_on < $1) ORDER BY position, id", [today]);
  let made = 0;
  for (const r of rows) {
    if (!fallsOn(r, today)) continue;
    const { rows: [mine] } = await db.query('UPDATE task_routines SET last_run_on = $2 WHERE id = $1 AND (last_run_on IS NULL OR last_run_on < $2) RETURNING id', [r.id, today]);
    if (!mine) continue;
    try { if (await createFor(r, today)) made += 1; } catch (err) { console.error(`[rotina ${r.id}]`, err.message); }
  }
  return made;
}

// "Repetir" no formulário de tarefa nova: a tarefa de agora é a primeira; a rotina cria as próximas. Semanal: no dia da semana do
// prazo (sem prazo, no de hoje); mensal: no dia do mês do prazo.
async function fromTask(task, repeat, user) {
  if (!REPEATS[repeat]) return null;
  const base = task.due_on ? (task.due_on instanceof Date ? task.due_on.toISOString().slice(0, 10) : String(task.due_on).slice(0, 10)) : todayISO();
  const { rows: [r] } = await db.query(
    `INSERT INTO task_routines (trigger, kind, title, description, anchor, offset_days, assignee_mode, assignee_id, active, target, default_on, priority, position,
                                repeat, weekdays, month_day, due_time, last_run_on, created_by)
     VALUES ('recorrente', $1, $2, $3, 'gatilho', 0, $4, $5, true, 'tarefa', false, false, (SELECT coalesce(max(position), 0) + 1 FROM task_routines),
             $6, $7, $8, $9, $10, $11) RETURNING *`,
    [task.kind, task.title, task.description || null, task.assignee_id ? 'usuario' : 'ninguem', task.assignee_id || null,
      repeat, repeat === 'semana' ? [isoWeekday(base)] : null, repeat === 'mes' ? Number(base.slice(8, 10)) : null, task.due_time || null, base, user?.id || null]);
  await db.query('UPDATE tasks SET routine_id = $2 WHERE id = $1', [task.id, r.id]);
  return r;
}

module.exports = { REPEATS, WEEKDAYS, fallsOn, describe, createFor, tick, fromTask, isoWeekday, todayISO };
