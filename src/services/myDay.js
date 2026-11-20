// Seu dia: o Início da produtora. O plano do dia (o que estava previsto e o que ela já fez: abordagens novas de patrocinadores e
// convites contra a meta, follow-ups marcados para o dia, tarefas), o que o dia rendeu (aceites, perdidos e o motivo, interessados,
// reuniões marcadas, fechados), por que os convidados dela foram perdidos nos últimos 30 dias e as metas que não estão no plano.
// "Agora" (não depende do dia escolhido): o que está quente (media kit aberto, pedido de conversa, convite aberto sem resposta), os
// aceitos ainda sem data, as próximas gravações e reuniões e as tarefas.
// O que é dela: convidados e patrocinadores de que ela é responsável (nos follow-ups e no que está quente, também os sem responsável,
// como no cartão Hoje); abordagens novas, por quem registrou; reuniões, por quem marcou; tarefas, pela pessoa da tarefa.
const db = require('../db/pool');
const outreach = require('./outreach');
const goals = require('./goals');
const ds = require('./daySummary');
const { isLate, isoDate } = require('./tasks');

const { BOUNDS } = ds;
const startOf = (day) => new Date(`${day}T00:00:00-03:00`); // Brasília, sem horário de verão desde 2019

// Recorte por projeto: trecho SQL com os ids (inteiros conferidos aqui). Sem ids, não filtra.
const inProject = (ids, col) => {
  const list = (ids || []).map(Number).filter(Number.isInteger);
  return ids ? ` AND ${col} = ANY('{${list.join(',')}}'::int[])` : '';
};
const inProjectOrNull = (ids, col) => (ids ? ` AND (${col} IS NULL OR${inProject(ids, col).slice(4)})` : '');

const LOGS = {
  guest: { table: 'guest_stage_log', id: 'guest_id', to: 'to_status', from: 'from_status' },
  sponsor: { table: 'sponsor_stage_log', id: 'sponsor_id', to: 'to_stage', from: 'from_stage' },
};

// Quem abre o Início no "Seu dia" (as outras pessoas abrem no Resumo do dia da equipe).
const isProducer = (user) => Boolean(user) && user.role === 'produtora';

// Horas para a tela, em Brasília: "qui 20/11 · 15:00" (a próxima reunião) e "14:32", "ontem 18:10" ou "16/11 09:05" (o que está quente).
const TZ = 'America/Sao_Paulo';
const whenFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const hourMin = (d) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
function whenShort(ts) {
  if (!ts) return '';
  const p = Object.fromEntries(whenFmt.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return `${String(p.weekday).replace('.', '')} ${p.day}/${p.month} · ${p.hour}:${p.minute}`;
}
function sinceWhen(ts, now = new Date()) {
  const d = new Date(ts);
  if (dayKey(d) === dayKey(now)) return hourMin(d);
  if (dayKey(d) === dayKey(new Date(now.getTime() - 86400000))) return `ontem ${hourMin(d)}`;
  const k = dayKey(d);
  return `${k.slice(8, 10)}/${k.slice(5, 7)} ${hourMin(d)}`;
}

// Follow-ups marcados para o dia: a cadência como estava quando o dia começou (com as abordagens registradas antes dele) diz de quem
// o follow-up vencia naquele dia. Feito = recebeu contato no dia, ou saiu da etapa nele (respondeu, avançou ou foi perdido).
// Atrasados = os que já vinham atrasados de antes e seguiram sem contato até o fim do dia (hoje: até agora).
async function followPlan(kind, userId, day, pids = null) {
  const k = outreach.KINDS[kind]; const log = LOGS[kind];
  const out = { due: 0, done: 0, late: 0 };
  const { rows: subjects } = await db.query(`WITH ${BOUNDS},
    st0 AS (SELECT DISTINCT ON (l.${log.id}) l.${log.id} AS id, l.${log.to} AS stage, l.changed_at FROM ${log.table} l, b
             WHERE l.changed_at < b.s ORDER BY l.${log.id}, l.changed_at DESC, l.id DESC)
    SELECT st0.id, st0.changed_at AS entered,
           EXISTS (SELECT 1 FROM ${log.table} l WHERE l.${log.id} = st0.id AND l.changed_at >= b.s AND l.changed_at < b.e AND l.${log.from} = $3) AS moved
      FROM st0 JOIN ${k.table} s ON s.id = st0.id, b
     WHERE st0.stage = $3 AND (s.owner_id = $2 OR s.owner_id IS NULL)${inProject(pids, 's.project_id')}`, [day, userId, k.stage]);
  if (!subjects.length) return out;
  const { rows: attempts } = await db.query(`WITH ${BOUNDS}
    SELECT a.subject_id, a.channel, a.result, a.at, a.created_at FROM outreach_attempts a, b
     WHERE a.subject_type = $2 AND a.subject_id = ANY($3::int[]) AND a.at < b.e`, [day, kind, subjects.map((x) => x.id)]);
  const cfg = await outreach.config();
  const start = startOf(day);
  for (const x of subjects) {
    const cycle = attempts.filter((a) => a.subject_id === x.id && new Date(a.created_at) >= new Date(x.entered)); // as do ciclo, como a cadência conta
    const { state } = outreach.evaluate(kind, x.entered, cycle.filter((a) => new Date(a.at) < start), cfg, day);
    const touched = x.moved || cycle.some((a) => new Date(a.at) >= start);
    if (state === 'hoje') { out.due += 1; if (touched) out.done += 1; } else if (state === 'atrasado' && !touched) out.late += 1;
  }
  return out;
}

// Abordagens novas (a primeira de cada patrocinador no ciclo) que a pessoa registrou no dia: é o que a meta conta.
async function newApproaches(userId, day, pids = null) {
  const { rows: [r] } = await db.query(`WITH ${BOUNDS}, ${outreach.SPONSOR_SENDS}
    SELECT count(*)::int AS n FROM firsts, b WHERE firsts.user_id = $2 AND firsts.at >= b.s${pids ? ` AND EXISTS (SELECT 1 FROM sponsors s WHERE s.id = firsts.sponsor_id${inProject(pids, 's.project_id')})` : ''}`, [day, userId]);
  return r.n;
}

// Tarefas da pessoa com prazo no dia (feitas até o fim dele) e as atrasadas de antes que seguiam abertas no fim do dia.
async function taskPlan(userId, day, pids = null) {
  const { rows: [r] } = await db.query(`WITH ${BOUNDS},
    t AS (SELECT t.due_on, (t.status = 'feito' AND coalesce(t.completed_at, t.created_at) < b.e) AS done FROM tasks t, b
           WHERE t.assignee_id = $2 AND t.created_at < b.e${inProjectOrNull(pids, 't.project_id')})
    SELECT count(*) FILTER (WHERE due_on = $1::date)::int AS due, count(*) FILTER (WHERE due_on = $1::date AND done)::int AS done,
           count(*) FILTER (WHERE due_on < $1::date AND NOT done)::int AS late
      FROM t`, [day, userId]);
  return r;
}

// Reuniões com patrocinador marcadas pela pessoa no dia (como a meta conta) e a próxima reunião dela.
async function meetings(userId, day, pids = null) {
  const { rows: [r] } = await db.query(`WITH ${BOUNDS}
    SELECT (SELECT count(*) FROM sponsor_meetings m JOIN sponsors s ON s.id = m.sponsor_id, b WHERE coalesce(m.created_by, m.owner_id) = $2 AND m.status = 'marcada'
              AND m.created_at >= b.s AND m.created_at < b.e${inProject(pids, 's.project_id')})::int AS booked,
           (SELECT min(m.starts_at) FROM sponsor_meetings m JOIN sponsors s ON s.id = m.sponsor_id WHERE m.status = 'marcada' AND m.starts_at >= now()
              AND (m.owner_id = $2 OR m.created_by = $2 OR $2 = ANY(m.team_ids))${inProject(pids, 's.project_id')}) AS next`, [day, userId]);
  return r;
}

// O dia escolhido. Metas diárias de abordagens novas e de convites viram o "de N · meta" do plano (no fim de semana não há meta
// diária); as outras metas da pessoa aparecem embaixo, em "Minhas metas".
// pids: o recorte de projeto de quem está olhando (services/scope).
async function plan(user, day, isToday, pids = null) {
  const [g, sp, cad, approaches, sponsorFollow, guestFollow, tasks, mt, lostToday, losses, list, progress] = await Promise.all([
    ds.guests(day, user.id, pids), ds.sponsorStages(day, user.id, pids), ds.sponsorCadence(day, isToday, user.id, pids), newApproaches(user.id, day, pids),
    followPlan('sponsor', user.id, day, pids), followPlan('guest', user.id, day, pids), taskPlan(user.id, day, pids), meetings(user.id, day, pids),
    ds.lossReasons(day, { ownerId: user.id, days: 1, pids }), ds.lossReasons(day, { ownerId: user.id, pids }), goals.listFor(user.id), goals.progressFor(user.id, day),
  ]);
  const weekend = Boolean(goals.periodOf('dia', day).weekend);
  const daily = (metric) => (weekend ? null : list.find((x) => x.metric === metric && x.period === 'dia') || null);
  const shown = new Set(['abordagens_patrocinadores', 'convites_enviados'].map(daily).filter(Boolean).map((x) => x.id));
  const target = (metric) => (daily(metric) ? Number(daily(metric).target) : null);
  return {
    approaches: { n: approaches, target: target('abordagens_patrocinadores'), toApproach: cad.toApproach },
    sponsorFollow, guestFollow,
    invites: { n: g.sent, target: target('convites_enviados'), waiting: g.waiting },
    tasks,
    results: {
      accepted: g.accepted, scheduling: g.scheduling, lost: g.lost, lostReasons: lostToday.list.map((r) => r.label),
      interested: sp.interested, negotiating: sp.negotiating, booked: mt.booked, nextMeeting: whenShort(mt.next), closed: sp.closed, active: sp.active,
    },
    losses, weekend,
    otherGoals: progress.filter((p) => !shown.has(p.id)),
  };
}

// O que está quente agora (últimas 48 h, sem abordagem registrada depois): patrocinador que abriu o media kit ou pediu uma conversa
// (sem reunião marcada depois), convidado que abriu o convite e não respondeu. Os 5 mais recentes.
async function hot(userId, pids = null) {
  const { rows } = await db.query(`SELECT * FROM (
      SELECT 'sponsor' AS kind, s.id, s.company AS name, x.signal, x.at FROM sponsors s
        JOIN LATERAL (SELECT * FROM (
            SELECT 'kit' AS signal, e.created_at AS at FROM sponsor_events e WHERE e.sponsor_id = s.id AND e.type = 'kit_visto' AND e.created_at > now() - interval '48 hours'
            UNION ALL
            SELECT 'conversa', c.created_at FROM sponsor_clicks c WHERE c.sponsor_id = s.id AND c.kind = 'quero' AND c.created_at > now() - interval '48 hours'
          ) y ORDER BY at DESC LIMIT 1) x ON true
       WHERE (s.owner_id = $1 OR s.owner_id IS NULL) AND s.stage IN ('prospect', 'negociacao', 'perdido')${inProject(pids, 's.project_id')}
         AND NOT EXISTS (SELECT 1 FROM outreach_attempts a WHERE a.subject_type = 'sponsor' AND a.subject_id = s.id AND a.created_at > x.at)
         AND NOT EXISTS (SELECT 1 FROM sponsor_meetings m WHERE m.sponsor_id = s.id AND m.created_at > x.at)
      UNION ALL
      SELECT 'guest', g.id, g.name, 'convite', x.at FROM guests g
        JOIN LATERAL (SELECT e.created_at AS at FROM guest_events e WHERE e.guest_id = g.id AND e.type = 'convite_visto' AND e.created_at > now() - interval '48 hours'
                       ORDER BY e.created_at DESC LIMIT 1) x ON true
       WHERE (g.owner_id = $1 OR g.owner_id IS NULL) AND g.status = 'convite_enviado'${inProject(pids, 'g.project_id')}
         AND NOT EXISTS (SELECT 1 FROM outreach_attempts a WHERE a.subject_type = 'guest' AND a.subject_id = g.id AND a.created_at > x.at)
    ) h ORDER BY at DESC LIMIT 5`, [userId]);
  return rows;
}

// Agora: o quente, os aceitos ainda sem data (Em agendamento: aceitaram e a gravação ainda não foi marcada), as próximas gravações
// (todas: a produção cuida de todas) e reuniões dela, e as tarefas abertas dela que vencem até daqui a 7 dias (ou já venceram).
// pids: o recorte de projeto de quem está olhando (services/scope).
async function now(user, today, pids = null) {
  const [h, { rows: [waiting] }, { rows: agenda }, { rows: tasks }] = await Promise.all([
    hot(user.id, pids),
    db.query(`SELECT count(*)::int AS n, coalesce(round(avg(extract(epoch FROM now() - stage_entered_at) / 86400)), 0)::int AS days
                FROM guests WHERE status = 'em_agendamento' AND (owner_id = $1 OR owner_id IS NULL)${inProject(pids, 'project_id')}`, [user.id]),
    db.query(`SELECT * FROM (
        SELECT 'gravacao' AS kind, g.id, g.name AS title, g.topic AS detail, g.proposed_at AS at FROM guests g WHERE g.status = 'agendado' AND g.proposed_at >= now()${inProject(pids, 'g.project_id')}
        UNION ALL
        SELECT 'reuniao', m.sponsor_id, s.company, m.title, m.starts_at FROM sponsor_meetings m JOIN sponsors s ON s.id = m.sponsor_id
         WHERE m.status = 'marcada' AND m.starts_at >= now() AND (m.owner_id = $1 OR m.created_by = $1 OR $1 = ANY(m.team_ids))${inProject(pids, 's.project_id')}
      ) x ORDER BY at LIMIT 6`, [user.id]),
    db.query(`SELECT id, title, status, due_on, due_time, project_id FROM tasks
               WHERE assignee_id = $1 AND status <> 'feito' AND due_on IS NOT NULL AND due_on <= ($2::date + 7)${inProjectOrNull(pids, 'project_id')}
               ORDER BY due_on, due_time NULLS LAST, id LIMIT 6`, [user.id, today]),
  ]);
  return { hot: h.map((x) => ({ ...x, when: sinceWhen(x.at) })), waiting, agenda, tasks: tasks.map((t) => ({ ...t, due: isoDate(t.due_on), late: isLate(t), today: isoDate(t.due_on) === today })) };
}

// A frase do topo: o que falta hoje (follow-ups pendentes do cartão Hoje e abordagens novas para a meta do dia).
function line(outToday, myGoals) {
  const pending = (outToday?.items || []).filter((x) => x.state === 'hoje' || x.state === 'atrasado').length;
  const goal = (myGoals || []).find((g) => g.metric === 'abordagens_patrocinadores' && g.period === 'dia' && !/fim de semana/.test(g.pace || ''));
  const left = goal && !goal.met && goal.value !== null ? Math.max(0, goal.target - goal.value) : 0;
  const fu = (n) => `${n} follow-up${n === 1 ? '' : 's'}`;
  const ap = (n) => `${n} ${n === 1 ? 'abordagem nova' : 'abordagens novas'}`;
  if (pending && left) return `Faltam ${fu(pending)} e ${ap(left)} para a meta de hoje.`;
  if (pending) return `Faltam ${fu(pending)} hoje${goal && goal.met ? ', e a meta de abordagens já foi batida' : ''}.`;
  if (left) return `Follow-ups em dia. Faltam ${ap(left)} para a meta de hoje.`;
  return goal && goal.met ? 'Follow-ups em dia e meta de abordagens batida.' : 'Follow-ups em dia.';
}

module.exports = { isProducer, plan, now, line, followPlan, newApproaches, taskPlan, hot, whenShort, sinceWhen };
