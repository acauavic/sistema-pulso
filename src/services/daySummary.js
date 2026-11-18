// Resumo do dia no Painel: o que aconteceu num dia (convites enviados, aceitos e perdidos, patrocinadores que entraram em
// prospecção, foram abordados e receberam follow-up, gravações e publicações, cortes subidos pelo editor, revisões, cortes
// postados, Reels de teste, seguidores) e como as coisas estavam no fim dele (etapas, cadência, episódios a publicar, tarefas
// atrasadas). O dia vai de 00:00 a 24:00 em Brasília; hoje é "até agora".
const db = require('../db/pool');
const { ROLES, can } = require('../permissions');
const { ACCEPT_FROM, LOSS_REASONS } = require('../constants');
const cal = require('./calendar');
const outreach = require('./outreach');
const { nowTime } = require('./tasks');

const TZ = 'America/Sao_Paulo';
// "O editor": quem edita mas não gerencia a produção (o mesmo corte que decide a tela inicial do editor).
const EDITOR_ROLES = Object.keys(ROLES).filter((r) => can(r, 'production.edit') && !can(r, 'production.manage'));
// Começo e fim do dia $1 em Brasília.
const BOUNDS = `b AS (SELECT ($1::date)::timestamp AT TIME ZONE '${TZ}' AS s, ($1::date + 1)::timestamp AT TIME ZONE '${TZ}' AS e)`;
const NETWORKS = ['instagram', 'youtube'];

// O dia pedido no endereço (?dia=AAAA-MM-DD), dentro do que o sistema tem: do primeiro convidado cadastrado até hoje.
async function pick(raw) {
  const today = cal.todayISO();
  const { rows: [r] } = await db.query(`SELECT to_char(min(created_at) AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS d FROM guests`);
  const min = r?.d && r.d < today ? r.d : today;
  let day = cal.isISO(raw) ? raw : today;
  if (day > today) day = today;
  if (day < min) day = min;
  return {
    day, today, min, isToday: day === today, weekday: cal.dayLabel(day).split(',')[0],
    prev: day > min ? cal.addDays(day, -1) : null, next: day < today ? cal.addDays(day, 1) : null,
  };
}

// Convidados. A etapa de cada um no fim do dia é a última mudança até ali; uma mudança desfeita no mesmo dia (arrastou errado e
// voltou) não conta, porque no fim do dia a pessoa não está mais onde a mudança a pôs. ownerId: só os convidados da pessoa.
async function guests(day, ownerId = null) {
  const { rows: [r] } = await db.query(`WITH ${BOUNDS},
    st AS (SELECT DISTINCT ON (l.guest_id) l.guest_id, l.to_status AS status FROM guest_stage_log l JOIN guests gg ON gg.id = l.guest_id, b
            WHERE l.changed_at < b.e AND ($3::uuid IS NULL OR gg.owner_id = $3) ORDER BY l.guest_id, l.changed_at DESC, l.id DESC),
    mv AS (SELECT l.guest_id, l.from_status, l.to_status, st.status AS end_status FROM guest_stage_log l JOIN st USING (guest_id), b
            WHERE l.changed_at >= b.s AND l.changed_at < b.e AND l.from_status IS NOT NULL)
    SELECT count(*) FILTER (WHERE st.status = 'convite_enviado')::int AS waiting,
           count(*) FILTER (WHERE st.status = 'em_agendamento')::int AS scheduling,
           count(*) FILTER (WHERE st.status = 'agendado')::int AS scheduled,
           (SELECT count(DISTINCT guest_id) FROM mv WHERE to_status = 'convite_enviado' AND end_status <> 'prospect')::int AS sent,
           (SELECT count(DISTINCT guest_id) FROM mv WHERE from_status = ANY($2::text[]) AND to_status IN ('em_agendamento', 'agendado')
                AND NOT (end_status = ANY($2::text[])))::int AS accepted,
           (SELECT count(DISTINCT guest_id) FROM mv WHERE to_status = 'perdido' AND end_status = 'perdido')::int AS lost,
           (SELECT count(DISTINCT guest_id) FROM mv WHERE to_status = 'em_agendamento' AND end_status IN ('em_agendamento', 'agendado', 'gravado'))::int AS scheduling_in,
           (SELECT count(DISTINCT guest_id) FROM mv WHERE to_status = 'agendado' AND end_status IN ('agendado', 'gravado'))::int AS scheduled_in
      FROM st`, [day, ACCEPT_FROM, ownerId]);
  return { sent: r.sent, accepted: r.accepted, lost: r.lost, waiting: r.waiting, scheduling: r.scheduling, schedulingIn: r.scheduling_in, scheduled: r.scheduled, scheduledIn: r.scheduled_in };
}

// Patrocinadores. A etapa de cada um no fim do dia é a última mudança até ali (sponsor_stage_log). Entrou numa etapa no dia quem
// chegou nela pelo cadastro (só no dia em que nasceu: voltar da lixeira não é entrada nova) ou por uma mudança que não foi desfeita
// no mesmo dia, sem já estar nela quando o dia começou. Fechado = entrou em Ganho, ou em Ativo sem passar por Ganho.
// ownerId: só os patrocinadores da pessoa.
async function sponsorStages(day, ownerId = null) {
  const { rows: [r] } = await db.query(`WITH ${BOUNDS},
    st AS (SELECT DISTINCT ON (l.sponsor_id) l.sponsor_id, l.to_stage AS stage FROM sponsor_stage_log l JOIN sponsors ss ON ss.id = l.sponsor_id, b
            WHERE l.changed_at < b.e AND ($2::uuid IS NULL OR ss.owner_id = $2) ORDER BY l.sponsor_id, l.changed_at DESC, l.id DESC),
    st0 AS (SELECT DISTINCT ON (l.sponsor_id) l.sponsor_id, l.to_stage AS stage FROM sponsor_stage_log l, b
             WHERE l.changed_at < b.s ORDER BY l.sponsor_id, l.changed_at DESC, l.id DESC),
    mv AS (SELECT l.sponsor_id, l.from_stage, l.to_stage, st.stage AS end_stage
             FROM sponsor_stage_log l JOIN st USING (sponsor_id) LEFT JOIN st0 USING (sponsor_id) JOIN sponsors s ON s.id = l.sponsor_id, b
            WHERE l.changed_at >= b.s AND l.changed_at < b.e
              AND (l.from_stage IS NOT NULL OR (s.created_at >= b.s AND s.created_at < b.e))
              AND l.from_stage IS DISTINCT FROM st.stage AND st0.stage IS DISTINCT FROM l.to_stage)
    SELECT count(*) FILTER (WHERE st.stage = 'prospect')::int AS prospecting,
           count(*) FILTER (WHERE st.stage = 'negociacao')::int AS negotiating,
           count(*) FILTER (WHERE st.stage = 'ativo')::int AS active,
           (SELECT count(DISTINCT sponsor_id) FROM mv WHERE to_stage = 'prospect')::int AS entered,
           (SELECT count(DISTINCT sponsor_id) FROM mv WHERE to_stage = 'negociacao')::int AS interested,
           (SELECT count(DISTINCT sponsor_id) FROM mv WHERE to_stage = 'ganho' OR (to_stage = 'ativo' AND from_stage IS DISTINCT FROM 'ganho'))::int AS closed,
           (SELECT count(DISTINCT sponsor_id) FROM mv WHERE to_stage = 'perdido' AND end_stage = 'perdido')::int AS lost
      FROM st`, [day, ownerId]);
  return r;
}

// Abordagens de patrocinadores, a mesma base da cadência (Registrar abordagem) e da meta de abordagens (outreach.SPONSOR_SENDS).
// A 1ª abordagem do ciclo faz dele "abordado" no dia em que aconteceu (outro canal no mesmo dia ainda é essa abordagem); falar de
// novo num dia seguinte é follow-up, e cada patrocinador conta um por dia, mesmo por mais de um canal.
async function sponsorContacts(day) {
  const { rows: [r] } = await db.query(`WITH ${BOUNDS}, ${outreach.SPONSOR_SENDS}
    SELECT (SELECT count(DISTINCT sponsor_id) FROM firsts, b WHERE firsts.at >= b.s)::int AS approached,
           (SELECT count(DISTINCT x.sponsor_id) FROM sends x JOIN firsts f USING (sponsor_id, cycle), b
             WHERE x.at >= b.s AND f.at < b.s)::int AS followed`, [day]);
  return r;
}

// Como a cadência estava no fim do dia: quantos em Prospecção ainda sem abordagem, com follow-up para o dia e atrasados. Hoje é a
// própria cadência (a mesma conta do cartão Hoje e de Gestão > Cadência); num dia que passou, ela é refeita com a etapa daquele
// dia e as abordagens até o fim dele. ownerId: só os patrocinadores da pessoa.
async function sponsorCadence(day, isToday, ownerId = null) {
  let list;
  if (isToday) list = [...(await outreach.evaluateAll('sponsor', { ownerId })).values()];
  else {
    const { rows: subjects } = await db.query(`WITH ${BOUNDS},
      st AS (SELECT DISTINCT ON (l.sponsor_id) l.sponsor_id, l.to_stage, l.changed_at FROM sponsor_stage_log l, b
              WHERE l.changed_at < b.e ORDER BY l.sponsor_id, l.changed_at DESC, l.id DESC)
      SELECT st.sponsor_id AS id, st.changed_at AS entered FROM st JOIN sponsors s ON s.id = st.sponsor_id
       WHERE st.to_stage = 'prospect' AND ($2::uuid IS NULL OR s.owner_id = $2)`, [day, ownerId]);
    const { rows: attempts } = subjects.length ? await db.query(`WITH ${BOUNDS}
      SELECT a.subject_id, a.channel, a.result, a.at, a.created_at FROM outreach_attempts a, b
       WHERE a.subject_type = 'sponsor' AND a.subject_id = ANY($2::int[]) AND a.at < b.e`, [day, subjects.map((x) => x.id)]) : { rows: [] };
    const cfg = await outreach.config();
    const by = new Map();
    for (const a of attempts) { if (!by.has(a.subject_id)) by.set(a.subject_id, []); by.get(a.subject_id).push(a); }
    list = subjects.map((x) => outreach.evaluate('sponsor', x.entered, (by.get(x.id) || []).filter((a) => new Date(a.created_at) >= new Date(x.entered)), cfg, day));
  }
  const count = (state) => list.filter((x) => x.state === state).length;
  return { toApproach: count('a_abordar'), due: count('hoje'), late: count('atrasado') };
}

// Por que os convidados foram perdidos: quem entrou em Perdido nos últimos `days` dias até o dia (inclusive) e ainda estava lá no fim
// dele, pelo motivo marcado no cadastro. ownerId: só os convidados da pessoa. { total, list: [{ key, label, n, pct, bar }] }, do
// motivo mais comum para o menos; a barra é proporcional ao mais comum.
async function lossReasons(day, { ownerId = null, days = 30 } = {}) {
  const { rows } = await db.query(`WITH b AS (SELECT ($1::date - ($3::int - 1))::timestamp AT TIME ZONE '${TZ}' AS s, ($1::date + 1)::timestamp AT TIME ZONE '${TZ}' AS e),
    st AS (SELECT DISTINCT ON (l.guest_id) l.guest_id, l.to_status AS status FROM guest_stage_log l, b
            WHERE l.changed_at < b.e ORDER BY l.guest_id, l.changed_at DESC, l.id DESC)
    SELECT g.loss_reason AS reason, count(DISTINCT g.id)::int AS n
      FROM guest_stage_log l JOIN st USING (guest_id) JOIN guests g ON g.id = l.guest_id, b
     WHERE l.to_status = 'perdido' AND l.from_status IS NOT NULL AND st.status = 'perdido' AND l.changed_at >= b.s AND l.changed_at < b.e
       AND ($2::uuid IS NULL OR g.owner_id = $2)
     GROUP BY g.loss_reason`, [day, ownerId, days]);
  const total = rows.reduce((n, r) => n + r.n, 0);
  const max = rows.reduce((m, r) => Math.max(m, r.n), 0);
  const list = rows.map((r) => ({ key: r.reason || '', label: LOSS_REASONS[r.reason] || 'Sem motivo', n: r.n, pct: total ? Math.round((r.n / total) * 100) : 0, bar: max ? Math.max(2, Math.round((r.n / max) * 100)) : 0 }))
    .sort((x, y) => y.n - x.n || x.label.localeCompare(y.label, 'pt-BR'));
  return { total, list };
}

// Episódios: gravados no dia (a data da gravação), os que estavam gravados e ainda sem publicar no fim do dia, e os publicados.
async function episodes(day) {
  const { rows: [r] } = await db.query(`WITH ${BOUNDS},
    e AS (SELECT coalesce(recorded_on, (created_at AT TIME ZONE '${TZ}')::date) AS rec,
                 (published_at IS NOT NULL OR status = 'publicado') AS pub, coalesce(published_at, '-infinity'::timestamptz) AS pub_at
            FROM episodes)
    SELECT count(*) FILTER (WHERE e.rec = $1::date)::int AS recorded_in,
           count(*) FILTER (WHERE e.rec <= $1::date AND NOT (e.pub AND e.pub_at < b.e))::int AS to_publish,
           count(*) FILTER (WHERE e.pub AND e.pub_at >= b.s AND e.pub_at < b.e)::int AS published_in,
           count(*) FILTER (WHERE e.pub AND e.pub_at < b.e)::int AS published
      FROM e, b`, [day]);
  return { recordedIn: r.recorded_in, toPublish: r.to_publish, publishedIn: r.published_in, published: r.published };
}

// Cortes subidos no dia: os do editor; os que a gestão subiu (uma importação, por exemplo) ficam à parte.
// Revisão = versão nova de um corte que já existia (a versão anterior vai para clip_versions na hora da troca).
async function clips(day) {
  const [{ rows: [up] }, { rows: [rv] }] = await Promise.all([
    db.query(`WITH ${BOUNDS}
      SELECT count(*) FILTER (WHERE u.role = ANY($2::text[]))::int AS by_editor,
             count(*) FILTER (WHERE u.role IS NULL OR NOT (u.role = ANY($2::text[])))::int AS by_team,
             count(DISTINCT c.episode_id) FILTER (WHERE u.role = ANY($2::text[]))::int AS episodes
        FROM episode_clips c LEFT JOIN users u ON u.id = c.created_by, b
       WHERE c.source = 'upload' AND c.created_at >= b.s AND c.created_at < b.e`, [day, EDITOR_ROLES]),
    db.query(`WITH ${BOUNDS}
      SELECT count(*)::int AS versions, count(DISTINCT v.clip_id)::int AS revised FROM clip_versions v, b
       WHERE v.replaced_at >= b.s AND v.replaced_at < b.e`, [day]),
  ]);
  return { uploaded: up.by_editor, uploadedByTeam: up.by_team, uploadedEpisodes: up.episodes, versions: rv.versions, revised: rv.revised };
}

// Posts que foram ao ar no dia. A hora que vale é a da rede (lida com os números do post); sem ela, a hora agendada; sem
// agendamento, a do envio (ou a do post marcado à mão). Cada corte conta uma vez no dia, mesmo indo para várias redes.
async function posts(day) {
  const { rows: [r] } = await db.query(`WITH ${BOUNDS},
    p AS (SELECT p.id, p.clip_id, p.options, CASE WHEN jsonb_typeof(p.results) = 'array' THEN p.results ELSE '[]'::jsonb END AS results,
                 coalesce((SELECT min(m.published_at) FROM post_metrics m WHERE m.publication_id = p.id), p.scheduled_at, p.created_at) AS live_at
            FROM episode_publications p, b WHERE p.status IN ('publicado', 'parcial') AND p.created_at < b.e),
    d AS (SELECT p.* FROM p, b WHERE p.live_at >= b.s AND p.live_at < b.e)
    SELECT (SELECT count(DISTINCT clip_id) FROM d)::int AS posted,
           (SELECT count(*) FROM d, jsonb_array_elements(d.results) x WHERE d.clip_id IS NOT NULL AND x->>'ok' = 'true')::int AS network_posts,
           (SELECT count(*) FROM d WHERE coalesce(d.options->'instagram'->>'trial', '') NOT IN ('', 'false', '0')
               AND EXISTS (SELECT 1 FROM jsonb_array_elements(d.results) x WHERE x->>'platform' = 'instagram' AND x->>'ok' = 'true'))::int AS trials`, [day]);
  return { posted: r.posted, networkPosts: r.network_posts, trials: r.trials };
}

// Posts agendados para o dia (cortes, imagens, carrosséis, stories), pela hora marcada: já no ar, ainda a sair (agendados, em
// envio ou esperando aprovação) e com erro.
async function scheduled(day) {
  const { rows: [r] } = await db.query(`WITH ${BOUNDS}
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE p.clip_id IS NOT NULL)::int AS clips,
           count(*) FILTER (WHERE p.status IN ('publicado', 'parcial'))::int AS out,
           count(*) FILTER (WHERE p.status IN ('agendado', 'enviando', 'revisao'))::int AS pending,
           count(*) FILTER (WHERE p.status = 'erro')::int AS failed
      FROM episode_publications p, b
     WHERE p.scheduled_at >= b.s AND p.scheduled_at < b.e AND p.status IN ('agendado', 'enviando', 'revisao', 'publicado', 'parcial', 'erro')`, [day]);
  return { total: r.total, clips: r.clips, posts: r.total - r.clips, out: r.out, pending: r.pending, failed: r.failed };
}

// Tarefas atrasadas no fim do dia (hoje: agora), com a mesma regra da lista de tarefas: prazo vencido, ou o dia de hoje com a
// hora já passada. Entram as que existiam e não estavam feitas naquele momento.
async function tasks(day, cut) {
  const { rows: [r] } = await db.query(`WITH ${BOUNDS},
    t AS (SELECT due_on, due_time FROM tasks, b WHERE created_at < b.e AND NOT (status = 'feito' AND coalesce(completed_at, created_at) < b.e))
    SELECT count(*)::int AS open,
           count(*) FILTER (WHERE due_on < $1::date OR (due_on = $1::date AND due_time IS NOT NULL AND due_time < $2::time))::int AS late
      FROM t`, [day, cut]);
  return { late: r.late, open: r.open };
}

// Seguidores: o saldo do dia é a última leitura do dia menos a do dia anterior (social_snapshots guarda a última de cada dia);
// o da semana, menos a de 7 dias antes.
// Dia sem leitura nossa usa a série diária do provedor, quando ela é de totais (a do YouTube pela Zernio). Sem as duas pontas,
// o saldo fica vazio ("sem leitura"). Nenhuma leitura guardada: as redes não estão ligadas aqui e o bloco não aparece.
async function followers(day) {
  const [{ rows: own }, { rows: series }, { rows: [any] }] = await Promise.all([
    db.query(`SELECT platform, to_char(taken_on, 'YYYY-MM-DD') AS d, (data->>'followers')::numeric AS n, updated_at
                FROM social_snapshots WHERE platform = ANY($2::text[]) AND taken_on IN ($1::date, $1::date - 1, $1::date - 7)`, [day, NETWORKS]),
    db.query(`SELECT DISTINCT ON (platform) platform, data->'series'->'points' AS points FROM social_snapshots
               WHERE platform = ANY($2::text[]) AND taken_on >= $1::date AND data->'series'->>'kind' = 'total' ORDER BY platform, taken_on`, [day, NETWORKS]),
    db.query('SELECT count(*)::int AS n FROM social_snapshots WHERE platform = ANY($1::text[])', [NETWORKS]),
  ]);
  if (!any.n) return null;
  const prev = cal.addDays(day, -1); const weekAgo = cal.addDays(day, -7);
  const out = {};
  for (const net of NETWORKS) {
    const mine = Object.fromEntries(own.filter((r) => r.platform === net && r.n !== null).map((r) => [r.d, r]));
    const points = series.find((r) => r.platform === net)?.points;
    const theirs = Object.fromEntries((Array.isArray(points) ? points : []).filter((p) => p && Number.isFinite(Number(p.v))).map((p) => [String(p.d).slice(0, 10), Number(p.v)]));
    const at = (d) => (mine[d] ? Number(mine[d].n) : d in theirs ? theirs[d] : null);
    const total = at(day); const before = at(prev); const week = at(weekAgo);
    out[net] = { total, gain: total !== null && before !== null ? total - before : null, week: total !== null && week !== null ? total - week : null, readAt: mine[day]?.updated_at || null };
  }
  return out;
}

// Tudo do dia. Hoje, as tarefas atrasadas seguem a hora de agora; num dia que já passou, o fim do dia.
async function summary(day, { isToday = day === cal.todayISO() } = {}) {
  const [g, losses, sp, spc, spk, e, c, p, sc, t, s] = await Promise.all([guests(day), lossReasons(day), sponsorStages(day), sponsorContacts(day), sponsorCadence(day, isToday),
    episodes(day), clips(day), posts(day), scheduled(day), tasks(day, isToday ? nowTime() : '24:00'), followers(day)]);
  return { guests: g, losses, sponsors: { ...sp, ...spc, ...spk }, episodes: e, clips: { ...c, ...p }, scheduled: sc, tasks: t, social: s };
}

module.exports = { pick, summary, guests, sponsorStages, sponsorCadence, lossReasons, BOUNDS, EDITOR_ROLES };
