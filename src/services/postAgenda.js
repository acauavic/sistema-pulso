// Agendados (Conteúdo > Agendados): o que sai, ou saiu, num dia ou numa semana, com o horário de cada post, se o Instagram vai
// como Reel de teste e o mapa de horários (uma régua de 0h a 24h por dia). O momento do post é o agendado ou, se saiu na hora, o
// do pedido. Horário de Brasília. Simulado e devolvido ficam de fora (não saem nas redes).
const db = require('../db/pool');
const up = require('./uploadPost');
const { pubProject } = require('./social');

const TZ = 'America/Sao_Paulo';
const STATUSES = ['revisao', 'agendado', 'enviando', 'publicado', 'parcial', 'erro'];
const MEDIA = { video: ['video'], imagem: ['imagem', 'carrossel', 'story'] };
const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
// dia em aritmética de calendário (meio-dia UTC, para não escorregar de dia)
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekdayOf = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const mondayOf = (iso) => addDays(iso, -((weekdayOf(iso) + 6) % 7));
const dayLabel = (iso) => `${WEEKDAY[weekdayOf(iso)]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const validDay = (v) => ISO.test(String(v || '')) && !Number.isNaN(new Date(`${v}T12:00:00Z`).getTime()) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;

// O que a página pede: o dia (padrão hoje), o período (dia ou semana) e o tipo (tudo, vídeos, imagens).
function readQuery(q = {}) {
  const today = todayIso();
  const day = validDay(q.dia) ? q.dia : today;
  const period = q.periodo === 'semana' ? 'semana' : 'dia';
  const media = MEDIA[q.tipo] ? q.tipo : '';
  const from = period === 'semana' ? mondayOf(day) : day;
  const to = addDays(from, period === 'semana' ? 7 : 1); // exclusivo
  const step = period === 'semana' ? 7 : 1;
  return { today, day, period, media, from, to, isToday: day === today, prev: addDays(day, -step), next: addDays(day, step) };
}

const trialOf = (p) => Boolean(p.options?.instagram?.trial) && (p.platforms || []).includes('instagram');

// As publicações do período (do recorte pids), em ordem de horário, já com o que a tela mostra.
async function list({ from, to, media = '', pids = null }) {
  const params = [from, to, STATUSES];
  let where = `p.status = ANY($3) AND coalesce(p.scheduled_at, p.created_at) >= ($1::date)::timestamp AT TIME ZONE '${TZ}'
    AND coalesce(p.scheduled_at, p.created_at) < ($2::date)::timestamp AT TIME ZONE '${TZ}'`;
  if (MEDIA[media]) { params.push(MEDIA[media]); where += ` AND p.media = ANY($${params.length})`; }
  if (pids) where += ` AND ${pubProject(pids)}`;
  const { rows } = await db.query(
    `SELECT p.id, p.title, p.media, p.status, p.platforms, p.options, p.clip_id, p.retry_at, p.episode_id,
            coalesce(p.scheduled_at, p.created_at) AS at, p.scheduled_at IS NOT NULL AS scheduled,
            to_char(coalesce(p.scheduled_at, p.created_at) AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS day,
            to_char(coalesce(p.scheduled_at, p.created_at) AT TIME ZONE '${TZ}', 'HH24:MI') AS hhmm,
            e.number AS episode_number, e.title AS episode_title, coalesce(c.project_id, e.project_id) AS project_id,
            c.title AS clip_title, c.post_title, cv.id AS thumb_id, cv.updated_at AS thumb_at
       FROM episode_publications p LEFT JOIN episodes e ON e.id = p.episode_id LEFT JOIN episode_clips c ON c.id = p.clip_id
       LEFT JOIN episode_covers cv ON cv.id = coalesce(p.cover_id, p.cover_ids[1], c.cover_id)
      WHERE ${where}
      ORDER BY coalesce(p.scheduled_at, p.created_at), p.id`, params);
  return rows.map((p) => {
    const [h, m] = p.hhmm.split(':').map(Number);
    return {
      ...p, minute: h * 60 + m, trial: trialOf(p),
      networks: (p.platforms || []).map((k) => up.PLATFORMS[k]?.label || k),
      thumb: p.thumb_id ? `/capas/${p.thumb_id}/imagem?v=${new Date(p.thumb_at).getTime()}&w=640` : null,
    };
  });
}

// Marcas da régua de um dia: posts no mesmo minuto viram uma marca só (com todos na dica). x em minutos (0 a 1440).
function marksOf(items) {
  const byMinute = new Map();
  for (const it of items) {
    const mk = byMinute.get(it.minute) || { minute: it.minute, hhmm: it.hhmm, items: [] };
    mk.items.push(it); byMinute.set(it.minute, mk);
  }
  return [...byMinute.values()].map((mk) => ({
    ...mk, count: mk.items.length,
    trial: mk.items.every((i) => i.trial), someTrial: mk.items.some((i) => i.trial),
    bad: mk.items.some((i) => i.status === 'erro'),
    tip: mk.items.map((i) => `${i.hhmm} · ${i.title || i.post_title}${i.trial ? ' · Reel de teste' : ''}`).join('\n'),
  }));
}

// A página inteira: um bloco por dia do período (vazio também, na semana), as marcas da régua e o resumo.
async function agenda(query, { pids = null } = {}) {
  const q = readQuery(query);
  const items = await list({ ...q, pids });
  const days = [];
  for (let d = q.from; d < q.to; d = addDays(d, 1)) {
    const mine = items.filter((i) => i.day === d);
    days.push({ day: d, label: dayLabel(d), isToday: d === q.today, items: mine, marks: marksOf(mine) });
  }
  const summary = {
    total: items.length, trials: items.filter((i) => i.trial).length,
    first: items[0]?.hhmm || null, last: items.length ? items[items.length - 1].hhmm : null,
  };
  return { ...q, days, items, summary, title: q.period === 'semana' ? `Semana de ${dayLabel(q.from).slice(4)} a ${dayLabel(addDays(q.to, -1)).slice(4)}` : dayLabel(q.day) };
}

// Contagem da aba: o que está agendado (ou esperando aprovação) daqui para frente.
async function upcomingCount(pids = null) {
  const { rows: [r] } = await db.query(
    `SELECT count(*)::int AS n FROM episode_publications p LEFT JOIN episodes e ON e.id = p.episode_id LEFT JOIN episode_clips c ON c.id = p.clip_id
      WHERE p.status IN ('agendado', 'revisao') AND coalesce(p.scheduled_at, p.created_at) >= now()${pids ? ` AND ${pubProject(pids)}` : ''}`);
  return r.n;
}

module.exports = { readQuery, list, marksOf, agenda, upcomingCount, addDays, mondayOf, STATUSES };
