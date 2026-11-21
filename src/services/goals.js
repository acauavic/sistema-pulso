// Metas por pessoa (Gestão > Equipe > Metas): até 3 por pessoa, contadas sozinhas com o que o sistema já registra.
// Cada meta: o que contar (METRICS), o período (dia útil, semana de segunda a domingo, mês), o alvo e como aparece no Início
// ("12 de 20" ou a porcentagem da meta). Taxas (aceite, tarefas no prazo) são porcentagem e aparecem sempre assim.
// Quem conta o quê: convites, aceites e gravações marcadas contam pelo responsável do convidado; abordagens, por quem registrou (as de
// patrocinador, só a primeira de cada um: follow-up não é abordagem nova);
// reuniões, por quem marcou; patrocínios fechados, pelo responsável do patrocinador; cortes e versões novas, por quem subiu;
// posts, por quem publicou; entregas de episódio, por quem enviou para revisão; tarefas, pela pessoa da tarefa. As "da equipe"
// dão o mesmo número para quem tiver a meta.
const db = require('../db/pool');
const C = require('../constants');
const cal = require('./calendar');

const TZ = 'America/Sao_Paulo';
const MAX_PER_PERSON = 3;
// $2 = primeiro dia do período, $3 = primeiro dia depois dele (datas de Brasília)
const B = `b AS (SELECT ($2::date)::timestamp AT TIME ZONE '${TZ}' AS s, ($3::date)::timestamp AT TIME ZONE '${TZ}' AS e, $1::uuid AS who)`; // who: as métricas da equipe não usam a pessoa
const one = async (sql, params) => { const { rows: [r] } = await db.query(sql, params); return r || {}; };
const count = async (sql, params) => { const v = (await one(sql, params)).n; return v === null || v === undefined ? null : Number(v); };

// Convidados de que a pessoa é responsável que se moveram no período; a etapa no fim do período decide (mudança desfeita não conta).
const guestFlow = (where) => `WITH ${B},
  st AS (SELECT DISTINCT ON (l.guest_id) l.guest_id, l.to_status AS status FROM guest_stage_log l, b WHERE l.changed_at < b.e ORDER BY l.guest_id, l.changed_at DESC, l.id DESC),
  mv AS (SELECT l.guest_id, l.from_status, l.to_status, st.status AS end_status FROM guest_stage_log l JOIN st USING (guest_id) JOIN guests g ON g.id = l.guest_id, b
          WHERE l.changed_at >= b.s AND l.changed_at < b.e AND l.from_status IS NOT NULL AND g.owner_id = $1)
  SELECT count(DISTINCT guest_id)::int AS n FROM mv WHERE ${where}`;
const SENT = "to_status = 'convite_enviado' AND end_status <> 'prospect'";
const ACCEPTED = "from_status = ANY($4::text[]) AND to_status IN ('em_agendamento', 'agendado') AND NOT (end_status = ANY($4::text[]))";
const outreach = (kind) => `WITH ${B} SELECT count(*)::int AS n FROM outreach_attempts a, b
  WHERE a.subject_type = '${kind}' AND a.result = 'enviado' AND a.user_id = $1 AND a.at >= b.s AND a.at < b.e`;
// publicação no ar: a hora da rede (lida com os números do post), senão a agendada, senão a do envio
const LIVE = `coalesce((SELECT min(m.published_at) FROM post_metrics m WHERE m.publication_id = p.id), p.scheduled_at, p.created_at)`;
const followers = (net) => `SELECT (SELECT (data->>'followers')::numeric FROM social_snapshots WHERE platform = '${net}' AND taken_on < $3::date ORDER BY taken_on DESC LIMIT 1)
  - (SELECT (data->>'followers')::numeric FROM social_snapshots WHERE platform = '${net}' AND taken_on < $2::date ORDER BY taken_on DESC LIMIT 1) AS n, $1::uuid AS who`;
const DELIVERED = `Etapa: ${C.EPISODE_STATUSES.em_edicao} → ${C.EPISODE_STATUSES.em_revisao}`;

const CATEGORIES = { convidados: 'Convidados', patrocinadores: 'Patrocinadores', conteudo: 'Conteúdo', producao: 'Produção', tarefas: 'Tarefas', equipe: 'Da equipe' };

// kind: count (número) | rate (porcentagem, com numerador e denominador). unit: [singular, plural] para "12 de 20 cortes".
const METRICS = {
  convites_enviados: { cat: 'convidados', label: 'Convites enviados', unit: ['convite', 'convites'], kind: 'count', hint: 'convidados de que a pessoa é responsável que entraram em Convite enviado',
    value: (u, f, t) => count(guestFlow(SENT), [u, f, t]) },
  convites_aceitos: { cat: 'convidados', label: 'Convites aceitos', unit: ['aceite', 'aceites'], kind: 'count', hint: 'convidados da pessoa que aceitaram (foram para Em agendamento ou Agendado)',
    value: (u, f, t) => count(guestFlow(ACCEPTED), [u, f, t, C.ACCEPT_FROM]) },
  gravacoes_marcadas: { cat: 'convidados', label: 'Gravações marcadas', unit: ['gravação', 'gravações'], kind: 'count', hint: 'convidados da pessoa que entraram em Agendado',
    value: (u, f, t) => count(guestFlow("to_status = 'agendado' AND end_status IN ('agendado', 'gravado')"), [u, f, t]) },
  taxa_aceite: { cat: 'convidados', label: 'Taxa de aceite', kind: 'rate', hint: 'aceites ÷ convites enviados no período, dos convidados da pessoa',
    value: async (u, f, t) => {
      const [num, den] = await Promise.all([count(guestFlow(ACCEPTED), [u, f, t, C.ACCEPT_FROM]), count(guestFlow(SENT), [u, f, t])]);
      return { num, den };
    } },
  abordagens_convidados: { cat: 'convidados', label: 'Abordagens de convidados', unit: ['abordagem', 'abordagens'], kind: 'count', hint: 'abordagens registradas pela pessoa (Registrar abordagem)',
    value: (u, f, t) => count(outreach('guest'), [u, f, t]) },
  abordagens_patrocinadores: { cat: 'patrocinadores', label: 'Abordagens novas de patrocinadores', unit: ['abordagem nova', 'abordagens novas'], kind: 'count', hint: 'primeiras abordagens de patrocinadores registradas pela pessoa (Registrar abordagem); follow-up não conta',
    value: (u, f, t) => count(`WITH ${B}, ${require('./outreach').SPONSOR_SENDS} SELECT count(*)::int AS n FROM firsts, b WHERE firsts.user_id = $1 AND firsts.at >= b.s`, [u, f, t]) },
  reunioes_agendadas: { cat: 'patrocinadores', label: 'Reuniões agendadas', unit: ['reunião', 'reuniões'], kind: 'count', hint: 'reuniões com patrocinador marcadas pela pessoa',
    value: (u, f, t) => count(`WITH ${B} SELECT count(*)::int AS n FROM sponsor_meetings m, b
      WHERE coalesce(m.created_by, m.owner_id) = $1 AND m.status = 'marcada' AND m.created_at >= b.s AND m.created_at < b.e`, [u, f, t]) },
  patrocinios_fechados: { cat: 'patrocinadores', label: 'Patrocínios fechados', unit: ['patrocínio', 'patrocínios'], kind: 'count', hint: 'patrocinadores da pessoa que entraram em Ganho',
    value: (u, f, t) => count(`WITH ${B} SELECT count(DISTINCT e.sponsor_id)::int AS n FROM sponsor_events e JOIN sponsors s ON s.id = e.sponsor_id, b
      WHERE e.type = 'etapa' AND e.message LIKE '%→ Ganho%' AND coalesce(s.owner_id, e.user_id) = $1 AND e.created_at >= b.s AND e.created_at < b.e`, [u, f, t]) },
  // param = o tipo de vídeo (Gestão > Categorias). Conta a primeira vez que cada vídeo foi enviado para revisão, por quem enviou.
  videos_entregues: { cat: 'conteudo', label: 'Vídeos entregues', unit: ['vídeo', 'vídeos'], kind: 'count', param: 'video_type', hint: 'pedidos de vídeo do tipo escolhido que a pessoa enviou para revisão (cada vídeo conta uma vez, na primeira entrega)',
    value: (u, f, t, param) => count(`WITH ${B} SELECT count(*)::int AS n FROM content_requests r, b
      WHERE r.delivered_by = $1 AND r.kind = $4 AND r.first_delivered_at >= b.s AND r.first_delivered_at < b.e`, [u, f, t, param || '']) },
  cortes_subidos: { cat: 'conteudo', label: 'Cortes subidos', unit: ['corte', 'cortes'], kind: 'count', hint: 'cortes que a pessoa subiu',
    value: (u, f, t) => count(`WITH ${B} SELECT count(*)::int AS n FROM episode_clips c, b
      WHERE c.created_by = $1 AND c.source = 'upload' AND c.created_at >= b.s AND c.created_at < b.e`, [u, f, t]) },
  revisoes_corte: { cat: 'conteudo', label: 'Revisões de corte', unit: ['revisão', 'revisões'], kind: 'count', hint: 'versões novas de cortes que a pessoa subiu',
    value: (u, f, t) => count(`WITH ${B} SELECT count(*)::int AS n FROM clip_versions v JOIN episode_clips c ON c.id = v.clip_id, b
      WHERE v.replaced_at >= b.s AND v.replaced_at < b.e
        AND coalesce((SELECT v2.uploaded_by FROM clip_versions v2 WHERE v2.clip_id = v.clip_id AND v2.version = v.version + 1), c.video_by, c.created_by) = $1`, [u, f, t]) },
  posts_publicados: { cat: 'conteudo', label: 'Posts publicados', unit: ['post', 'posts'], kind: 'count', hint: 'publicações da pessoa que foram ao ar',
    value: (u, f, t) => count(`WITH ${B} SELECT count(*)::int AS n FROM episode_publications p, b
      WHERE p.created_by = $1 AND p.status IN ('publicado', 'parcial') AND ${LIVE} >= b.s AND ${LIVE} < b.e`, [u, f, t]) },
  episodios_entregues: { cat: 'producao', label: 'Episódios entregues para revisão', unit: ['entrega', 'entregas'], kind: 'count', hint: 'vídeos de episódio que a pessoa enviou para revisão (contam as reentregas depois de ajustes)',
    value: (u, f, t) => count(`WITH ${B} SELECT count(*)::int AS n FROM episode_events ev, b
      WHERE ev.type = 'etapa' AND ev.user_id = $1 AND ev.message = $4 AND ev.created_at >= b.s AND ev.created_at < b.e`, [u, f, t, DELIVERED]) },
  episodios_publicados: { cat: 'producao', label: 'Episódios publicados', unit: ['episódio', 'episódios'], kind: 'count', team: true, hint: 'episódios que foram ao ar (da equipe)',
    value: (u, f, t) => count(`WITH ${B} SELECT count(*)::int AS n FROM episodes e, b WHERE e.published_at >= b.s AND e.published_at < b.e`, [u, f, t]) },
  tarefas_concluidas: { cat: 'tarefas', label: 'Tarefas concluídas', unit: ['tarefa', 'tarefas'], kind: 'count', hint: 'tarefas da pessoa marcadas como feitas',
    value: (u, f, t) => count(`WITH ${B} SELECT count(*)::int AS n FROM tasks t, b
      WHERE t.assignee_id = $1 AND t.status = 'feito' AND t.completed_at >= b.s AND t.completed_at < b.e`, [u, f, t]) },
  tarefas_no_prazo: { cat: 'tarefas', label: 'Tarefas no prazo', kind: 'rate', hint: 'tarefas com prazo feitas até o prazo ÷ tarefas com prazo feitas no período',
    value: async (u, f, t) => {
      const r = await one(`WITH ${B} SELECT count(*) FILTER (WHERE (t.completed_at AT TIME ZONE '${TZ}') <= (t.due_on + coalesce(t.due_time, time '23:59:59')))::int AS num, count(*)::int AS den
        FROM tasks t, b WHERE t.assignee_id = $1 AND t.status = 'feito' AND t.due_on IS NOT NULL AND t.completed_at >= b.s AND t.completed_at < b.e`, [u, f, t]);
      return { num: r.num, den: r.den };
    } },
  seguidores_instagram: { cat: 'equipe', label: 'Seguidores no Instagram', unit: ['seguidor', 'seguidores'], kind: 'count', team: true, hint: 'saldo de seguidores no período (da equipe)',
    value: (u, f, t) => count(followers('instagram'), [u, f, t]) },
  inscritos_youtube: { cat: 'equipe', label: 'Inscritos no YouTube', unit: ['inscrito', 'inscritos'], kind: 'count', team: true, hint: 'saldo de inscritos no período (da equipe)',
    value: (u, f, t) => count(followers('youtube'), [u, f, t]) },
  cortes_postados: { cat: 'equipe', label: 'Cortes postados', unit: ['corte', 'cortes'], kind: 'count', team: true, hint: 'cortes que foram ao ar em alguma rede (da equipe)',
    value: (u, f, t) => count(`WITH ${B} SELECT count(DISTINCT p.clip_id)::int AS n FROM episode_publications p, b
      WHERE p.clip_id IS NOT NULL AND p.status IN ('publicado', 'parcial') AND ${LIVE} >= b.s AND ${LIVE} < b.e`, [u, f, t]) },
  reels_teste: { cat: 'equipe', label: 'Reels de teste', unit: ['Reel de teste', 'Reels de teste'], kind: 'count', team: true, hint: 'Reels de teste que foram ao ar no Instagram (da equipe)',
    value: (u, f, t) => count(`WITH ${B} SELECT count(*)::int AS n FROM episode_publications p, b
      WHERE p.status IN ('publicado', 'parcial') AND coalesce(p.options->'instagram'->>'trial', '') NOT IN ('', 'false', '0')
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.results) = 'array' THEN p.results ELSE '[]'::jsonb END) x WHERE x->>'platform' = 'instagram' AND x->>'ok' = 'true')
        AND ${LIVE} >= b.s AND ${LIVE} < b.e`, [u, f, t]) },
};

const PERIODS = { dia: 'por dia útil', semana: 'por semana', mes: 'por mês' };
const DISPLAYS = { numero: 'Número (12 de 20)', porcentagem: 'Porcentagem da meta (60%)' };
const isWeekend = (iso) => [0, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay());
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// O período que contém o dia: { from, to (exclusivo), label, until }.
function periodOf(period, today = cal.todayISO()) {
  if (period === 'semana') {
    const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // segunda = 0
    const from = cal.addDays(today, -dow);
    return { from, to: cal.addDays(from, 7), label: 'esta semana', until: 'até domingo' };
  }
  if (period === 'mes') {
    const from = `${today.slice(0, 7)}-01`;
    const d = new Date(`${from}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1);
    const to = d.toISOString().slice(0, 10);
    return { from, to, label: 'este mês', until: `até ${ddmm(cal.addDays(to, -1))}` };
  }
  return { from: today, to: cal.addDays(today, 1), label: 'hoje', until: 'hoje', weekend: isWeekend(today) };
}

const fmtN = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const plural = (n, unit) => (unit ? (Math.abs(Number(n)) === 1 ? unit[0] : unit[1]) : '');

// O andamento de uma meta: o valor contado e como mostrar (principal, complemento, frase do prazo, barra).
async function progress(goal, today = cal.todayISO()) {
  const m = METRICS[goal.metric];
  if (!m) return null;
  const p = periodOf(goal.period, today);
  const target = Number(goal.target);
  const raw = await m.value(goal.user_id, p.from, p.to, goal.param);
  let value; let detail = '';
  if (m.kind === 'rate') {
    value = raw.den ? Math.round((raw.num / raw.den) * 100) : null;
    detail = raw.den ? `${fmtN(raw.num)} de ${fmtN(raw.den)}` : 'nada no período ainda';
  } else value = raw;
  const ratio = value === null || value === undefined ? 0 : Math.max(0, Math.min(1, value / target));
  const met = value !== null && value !== undefined && value >= target;
  const typeLabel = m.param ? (require('./contentRequests').KINDS[goal.param]?.label || 'tipo removido') : null;
  const out = { id: goal.id, metric: goal.metric, param: goal.param || null, label: typeLabel ? `${m.label} · ${typeLabel}` : m.label, period: goal.period, periodLabel: p.label, target, value, met, bar: Math.round(ratio * 100), team: Boolean(m.team), kind: m.kind };
  if (value === null || value === undefined) {
    out.main = '—'; out.rest = ''; out.note = m.kind === 'rate' ? detail : 'sem leitura no período';
  } else if (m.kind === 'rate') {
    out.main = `${value}%`; out.rest = ''; out.note = `meta ${fmtN(target)}% · ${detail}`;
  } else if (goal.display === 'porcentagem') {
    out.main = `${Math.round((value / target) * 100)}%`; out.rest = ''; out.note = `${fmtN(value)} de ${fmtN(target)} ${plural(target, m.unit)}`;
  } else {
    out.main = fmtN(value); out.rest = `de ${fmtN(target)}`; out.note = plural(target, m.unit);
  }
  if (p.weekend && goal.period === 'dia') out.pace = 'fim de semana: sem meta hoje';
  else if (met) out.pace = 'meta batida';
  else if (m.kind === 'rate' || value === null || value === undefined) out.pace = p.until === 'hoje' ? 'até o fim do dia' : p.until;
  else out.pace = `faltam ${fmtN(target - value)} ${p.until}`;
  return out;
}

async function listFor(userId) {
  const { rows } = await db.query('SELECT * FROM user_goals WHERE user_id = $1 ORDER BY position, id', [userId]);
  return rows.filter((g) => METRICS[g.metric]);
}
async function progressFor(userId, today = cal.todayISO()) {
  return (await Promise.all((await listFor(userId)).map((g) => progress(g, today)))).filter(Boolean);
}

// As metas de uma pessoa, vindas do formulário (até 3 linhas: metric_N, period_N, target_N, display_N). Linha sem "o que contar"
// é linha vazia. Devolve { error } ou { goals }.
function parseSlots(body) {
  const goals = [];
  for (let i = 1; i <= MAX_PER_PERSON; i += 1) {
    const metric = String(body[`metric_${i}`] || '');
    if (!metric) continue;
    const m = METRICS[metric];
    if (!m) return { error: `Meta ${i}: escolha o que contar.` };
    const period = PERIODS[body[`period_${i}`]] ? body[`period_${i}`] : null;
    if (!period) return { error: `Meta ${i}: escolha o período.` };
    const target = Number(String(body[`target_${i}`] || '').replace(',', '.'));
    if (!Number.isFinite(target) || target <= 0 || target > 100000) return { error: `Meta ${i} (${m.label}): o alvo precisa ser um número maior que zero.` };
    if (m.kind === 'rate' && target > 100) return { error: `Meta ${i} (${m.label}): uma taxa vai até 100%.` };
    const display = m.kind === 'rate' ? 'porcentagem' : (DISPLAYS[body[`display_${i}`]] ? body[`display_${i}`] : 'numero');
    let param = null;
    if (m.param === 'video_type') {
      param = String(body[`param_${i}`] || '');
      const K = require('./contentRequests').KINDS;
      if (!K[param] || K[param].media !== 'video' || K[param].continuous) return { error: `Meta ${i} (${m.label}): escolha o tipo de vídeo.` };
    }
    goals.push({ metric, period, target: Math.round(target * 100) / 100, display, position: goals.length, ...(param ? { param } : {}) });
  }
  return { goals };
}

async function saveFor(userId, goals, actorId) {
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_goals WHERE user_id = $1', [userId]);
    for (const g of goals.slice(0, MAX_PER_PERSON)) {
      await client.query('INSERT INTO user_goals (user_id, metric, period, target, display, position, created_by, param) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [userId, g.metric, g.period, g.target, g.display, g.position, actorId, g.param || null]);
    }
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

// A meta diária de abordagens de patrocinadores de cada pessoa (o cartão Hoje e o relatório da Cadência leem daqui).
async function dailySponsorTargets(userIds) {
  const { rows } = await db.query("SELECT DISTINCT ON (user_id) user_id, target FROM user_goals WHERE metric = 'abordagens_patrocinadores' AND period = 'dia' AND user_id = ANY($1::uuid[]) ORDER BY user_id, position", [userIds]);
  return new Map(rows.map((r) => [r.user_id, Number(r.target)]));
}

// O ritmo do editor no Início dele: cortes e revisões de hoje e da semana, as entregas da semana (com as reentregas depois de
// ajustes) e a próxima entrega (o 1º da ordem de edição).
async function rhythmFor(userId, today = cal.todayISO()) {
  const day = periodOf('dia', today); const week = periodOf('semana', today);
  const [clipsToday, clipsWeek, revToday, revWeek, { rows: deliveries }, next] = await Promise.all([
    METRICS.cortes_subidos.value(userId, day.from, day.to), METRICS.cortes_subidos.value(userId, week.from, week.to),
    METRICS.revisoes_corte.value(userId, day.from, day.to), METRICS.revisoes_corte.value(userId, week.from, week.to),
    db.query(`WITH ${B} SELECT e.id, e.number, e.title, ev.created_at,
                EXISTS (SELECT 1 FROM episode_events x WHERE x.episode_id = ev.episode_id AND x.type = 'etapa' AND x.created_at < ev.created_at AND x.message = $4) AS again
                FROM episode_events ev JOIN episodes e ON e.id = ev.episode_id, b
               WHERE ev.type = 'etapa' AND ev.user_id = $1 AND ev.message = $5 AND ev.created_at >= b.s AND ev.created_at < b.e
               ORDER BY ev.created_at`, [userId, week.from, week.to, `Etapa: ${C.EPISODE_STATUSES.em_revisao} → ${C.EPISODE_STATUSES.em_edicao}`, DELIVERED]),
    require('./editOrder').list().then((o) => o.find((e) => e.status === 'disponivel_edicao' || e.editor_id === userId) || null),
  ]);
  return { clipsToday, clipsWeek, revToday, revWeek, deliveries, next };
}

// Gestão > Metas: cada pessoa ativa com as metas e o andamento.
async function overview(today = cal.todayISO()) {
  const { rows: users } = await db.query("SELECT id, name, role FROM users WHERE active ORDER BY CASE role WHEN 'superadmin' THEN 0 WHEN 'gestao' THEN 1 WHEN 'produtora' THEN 2 ELSE 3 END, name");
  const { rows: all } = await db.query('SELECT * FROM user_goals ORDER BY position, id');
  const people = await Promise.all(users.map(async (u) => {
    const mine = all.filter((g) => g.user_id === u.id && METRICS[g.metric]);
    return { ...u, goals: mine, progress: (await Promise.all(mine.map((g) => progress(g, today)))).filter(Boolean) };
  }));
  return [...people.filter((p) => p.goals.length), ...people.filter((p) => !p.goals.length)]; // quem tem meta primeiro
}

module.exports = { MAX_PER_PERSON, CATEGORIES, METRICS, PERIODS, DISPLAYS, periodOf, progress, listFor, progressFor, parseSlots, saveFor, dailySponsorTargets, rhythmFor, overview };
