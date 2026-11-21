// Sessão de gravação: vários vídeos gravados numa ida ao estúdio (o Projeto 100 grava ~10 de uma vez).
// Jornada: a produção marca a sessão (dia, hora, duração prevista, local) e escolhe os vídeos em Pré-produção; no dia, pelo
// celular, abre a fila, lê o roteiro aprovado de cada um e toca em "Gravado"; no fim, encerra com a duração real.
// O estúdio é da sessão: cada vídeo gravado leva a parte dele em minutos inteiros que somam a sessão (episodes.recording_minutes,
// que o custo de estúdio e o banco de horas já usam). Antes de encerrar, a parte vem da duração prevista.
const db = require('../db/pool');

const TZ = 'America/Sao_Paulo';
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const dayOf = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d));
const STATUS = { planejada: { label: 'planejada', badge: 'b-st-agendado' }, encerrada: { label: 'encerrada', badge: 'b-green' }, cancelada: { label: 'cancelada', badge: 'b-st-cancelado' } };

// Minutos inteiros por vídeo que somam o total (o resto vai para os primeiros da fila). Nunca menos de 1.
function shares(total, n) {
  if (!n) return [];
  const base = Math.max(1, Math.floor(total / n));
  const out = Array(n).fill(base);
  let rest = total - base * n;
  for (let i = 0; rest > 0 && i < n; i += 1, rest -= 1) out[i] += 1;
  return out;
}

// "2 h 10", "45 min"
const fmtMinutes = (m) => { const h = Math.floor(m / 60); const r = m % 60; return h ? `${h} h${r ? ` ${String(r).padStart(2, '0')}` : ''}` : `${r} min`; };

const SELECT = `SELECT s.*, u.name AS created_by_name,
    (SELECT count(*)::int FROM episodes e WHERE e.session_id = s.id) AS videos,
    (SELECT count(*)::int FROM episodes e WHERE e.session_id = s.id AND e.status <> 'pre_producao') AS recorded
  FROM recording_sessions s LEFT JOIN users u ON u.id = s.created_by`;

const get = (id) => db.query(`${SELECT} WHERE s.id = $1`, [id]).then((r) => r.rows[0] || null);

// Para a lista: as próximas primeiro, depois as que passaram (as mais recentes).
async function list({ pids = null, limit = 60 } = {}) {
  const p = []; let w = 'true';
  if (pids) { p.push(pids); w = `s.project_id = ANY($${p.length}::int[])`; }
  const { rows } = await db.query(
    `${SELECT} WHERE ${w} ORDER BY (s.status = 'planejada') DESC, CASE WHEN s.status = 'planejada' THEN s.starts_at END ASC, s.starts_at DESC LIMIT ${Number(limit)}`, p);
  return rows;
}

// Os vídeos da sessão, na ordem, com a pauta e o roteiro (o roteiro aprovado é o que se lê no dia).
async function videos(sessionId) {
  const { rows } = await db.query(
    `SELECT e.id, e.number, e.title, e.status, e.project_id, e.session_position, e.session_note, e.recording_minutes,
            (SELECT state FROM pautas WHERE episode_id = e.id AND kind = 'pauta') AS pauta_state,
            (SELECT state FROM pautas WHERE episode_id = e.id AND kind = 'roteiro') AS roteiro_state,
            (SELECT coalesce(body_html, '') FROM pautas WHERE episode_id = e.id AND kind = 'roteiro') AS roteiro_html,
            (SELECT body FROM pautas WHERE episode_id = e.id AND kind = 'roteiro') AS roteiro_body,
            (SELECT link FROM pautas WHERE episode_id = e.id AND kind = 'roteiro') AS roteiro_link,
            (SELECT coalesce(body_html, '') FROM pautas WHERE episode_id = e.id AND kind = 'pauta') AS pauta_html,
            (SELECT body FROM pautas WHERE episode_id = e.id AND kind = 'pauta') AS pauta_body,
            (SELECT link FROM pautas WHERE episode_id = e.id AND kind = 'pauta') AS pauta_link
       FROM episodes e WHERE e.session_id = $1 ORDER BY e.session_position NULLS LAST, e.number, e.id`, [sessionId]);
  return rows;
}

// Vídeos que podem entrar: do projeto da sessão, em Pré-produção, sem outra sessão marcada.
async function candidates(session) {
  const { rows } = await db.query(
    `SELECT e.id, e.number, e.title, e.session_id,
            (SELECT state FROM pautas WHERE episode_id = e.id AND kind = 'roteiro') AS roteiro_state,
            (SELECT state FROM pautas WHERE episode_id = e.id AND kind = 'pauta') AS pauta_state
       FROM episodes e
      WHERE e.project_id = $1 AND e.status = 'pre_producao'
        AND (e.session_id IS NULL OR e.session_id = $2 OR NOT EXISTS (SELECT 1 FROM recording_sessions x WHERE x.id = e.session_id AND x.status = 'planejada'))
      ORDER BY e.number`, [session.project_id, session.id]);
  return rows;
}

const readFields = (body) => {
  const startsAt = require('../utils/format').parseInputDateTime(String(body.starts_at || ''));
  const h = Number(String(body.horas ?? '').replace(',', '.')) || 0; const m = Number(body.minutos) || 0;
  const planned = body.planned_minutes != null && body.planned_minutes !== '' ? Number(body.planned_minutes) : Math.round(h * 60 + m);
  return { startsAt, planned, place: clean(body.place, 160) || null, notes: clean(body.notes, 1000) || null };
};

async function create({ projectId, body, user }) {
  const f = readFields(body);
  if (!f.startsAt) return { error: 'Diga o dia e a hora da sessão.' };
  if (!(f.planned > 0 && f.planned <= 1440)) return { error: 'Diga quanto tempo a sessão deve durar.' };
  const { rows: [s] } = await db.query(
    `INSERT INTO recording_sessions (project_id, starts_at, planned_minutes, place, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [projectId, f.startsAt, f.planned, f.place, f.notes, user.id]);
  return { session: s };
}

async function update(session, body) {
  const f = readFields(body);
  if (!f.startsAt) return { error: 'Diga o dia e a hora da sessão.' };
  if (!(f.planned > 0 && f.planned <= 1440)) return { error: 'Diga quanto tempo a sessão deve durar.' };
  await db.query('UPDATE recording_sessions SET starts_at = $2, planned_minutes = $3, place = $4, notes = $5, updated_at = now() WHERE id = $1',
    [session.id, f.startsAt, f.planned, f.place, f.notes]);
  await reshare(session.id);
  return { ok: true };
}

// Escolher os vídeos (na ordem em que vieram). Quem saiu e ainda não foi gravado volta a ficar sem sessão.
async function setVideos(session, ids, user) {
  if (session.status !== 'planejada') return { error: 'A sessão já foi encerrada.' };
  const allowed = new Set((await candidates(session)).map((c) => c.id));
  const current = await videos(session.id);
  const recorded = current.filter((v) => v.status !== 'pre_producao').map((v) => v.id);
  const chosen = [...new Set(ids.map(Number).filter((id) => allowed.has(id) || recorded.includes(id)))];
  for (const id of recorded) if (!chosen.includes(id)) chosen.push(id); // vídeo já gravado não sai da sessão
  await db.query('UPDATE episodes SET session_id = NULL, session_position = NULL WHERE session_id = $1 AND NOT (id = ANY($2::int[]))', [session.id, chosen]);
  for (const [i, id] of chosen.entries()) {
    await db.query('UPDATE episodes SET session_id = $2, session_position = $3, updated_at = now() WHERE id = $1', [id, session.id, i + 1]);
  }
  const prod = require('./production');
  const added = chosen.filter((id) => !current.some((v) => v.id === id));
  for (const id of added) await prod.addEvent(id, user.id, 'sessao', `Entrou na sessão de gravação de ${dayOf(session.starts_at).split('-').reverse().join('/')}`);
  return { ok: true, count: chosen.length };
}

// Uma posição para cima ou para baixo na fila.
async function moveVideo(session, episodeId, dir) {
  const list = await videos(session.id);
  const i = list.findIndex((v) => v.id === Number(episodeId));
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  for (const [k, v] of list.entries()) await db.query('UPDATE episodes SET session_position = $2 WHERE id = $1', [v.id, k + 1]);
}

const setNote = (session, episodeId, note) => db.query(
  'UPDATE episodes SET session_note = $3, updated_at = now() WHERE id = $1 AND session_id = $2', [episodeId, session.id, clean(note, 500) || null]);

// Refaz a parte de cada vídeo gravado (duração real, ou a prevista enquanto não encerrou) e o custo de estúdio dele.
async function reshare(sessionId) {
  const s = await get(sessionId);
  if (!s || s.status === 'cancelada') return;
  const done = (await videos(sessionId)).filter((v) => v.status !== 'pre_producao');
  const total = s.actual_minutes || s.planned_minutes;
  const parts = shares(total, done.length);
  const finance = require('./finance');
  for (const [i, v] of done.entries()) {
    if (Number(v.recording_minutes) !== parts[i]) {
      await db.query('UPDATE episodes SET recording_minutes = $2, recorded_on = coalesce(recorded_on, $3::date), updated_at = now() WHERE id = $1', [v.id, parts[i], dayOf(s.starts_at)]);
      await finance.recomputeStudio(v.id);
    }
  }
  await finance.syncHourBank();
}

// "Gravado" na fila do dia: o vídeo sai da pré-produção (tarefas, custos) com a data da sessão e a parte dele no estúdio.
async function markRecorded(session, episodeId, user) {
  if (session.status === 'cancelada') return { error: 'A sessão foi cancelada.' };
  const { rows: [ep] } = await db.query('SELECT * FROM episodes WHERE id = $1 AND session_id = $2', [episodeId, session.id]);
  if (!ep) return { error: 'Este vídeo não está na sessão.' };
  if (ep.status !== 'pre_producao') return { ok: true, already: true };
  await db.query('UPDATE episodes SET recorded_on = $2 WHERE id = $1', [ep.id, dayOf(session.starts_at)]);
  const moved = await require('./production').move({ ...ep, recorded_on: dayOf(session.starts_at) }, 'gravado', user);
  if (moved.error) return moved;
  await reshare(session.id);
  return { ok: true };
}

// Encerrar: a duração real decide as horas. Quem não foi gravado sai da sessão (volta para a pré-produção sem data).
async function close(session, minutes, user) {
  if (session.status !== 'planejada') return { error: 'Esta sessão já foi encerrada.' };
  const m = Math.round(Number(minutes));
  if (!(m > 0 && m <= 1440)) return { error: 'Diga quanto tempo a sessão durou.' };
  const list = await videos(session.id);
  const done = list.filter((v) => v.status !== 'pre_producao');
  if (!done.length) return { error: 'Nenhum vídeo foi marcado como gravado. Marque os gravados antes de encerrar, ou cancele a sessão.' };
  const prod = require('./production');
  for (const v of list.filter((x) => x.status === 'pre_producao')) {
    await db.query('UPDATE episodes SET session_id = NULL, session_position = NULL, updated_at = now() WHERE id = $1', [v.id]);
    await prod.addEvent(v.id, user.id, 'sessao', 'Não foi gravado na sessão: voltou para a pré-produção');
  }
  await db.query("UPDATE recording_sessions SET status = 'encerrada', actual_minutes = $2, closed_at = now(), closed_by = $3, updated_at = now() WHERE id = $1",
    [session.id, m, user.id]);
  await reshare(session.id);
  const link = await studioLink(session, user);
  return { ok: true, recorded: done.length, link };
}

// Reabrir a duração (errou o número): só muda a conta, a sessão continua encerrada.
async function setActual(session, minutes) {
  const m = Math.round(Number(minutes));
  if (session.status !== 'encerrada') return { error: 'A sessão ainda não foi encerrada.' };
  if (!(m > 0 && m <= 1440)) return { error: 'Diga quanto tempo a sessão durou.' };
  await db.query('UPDATE recording_sessions SET actual_minutes = $2, updated_at = now() WHERE id = $1', [session.id, m]);
  await reshare(session.id);
  return { ok: true };
}

async function cancel(session, user) {
  if (session.status !== 'planejada') return { error: 'Só a sessão planejada pode ser cancelada.' };
  if (Number(session.recorded)) return { error: 'Já tem vídeo gravado nesta sessão: encerre com a duração real.' };
  await db.query('UPDATE episodes SET session_id = NULL, session_position = NULL WHERE session_id = $1', [session.id]);
  await db.query("UPDATE recording_sessions SET status = 'cancelada', closed_at = now(), closed_by = $2, updated_at = now() WHERE id = $1", [session.id, user.id]);
  return { ok: true };
}

// ---------------------------------------------------------------- link do estúdio da sessão
// Um link só: fica no primeiro vídeo gravado, marcado com a sessão. O que chega por ele espera a equipe dizer de qual vídeo é.
async function studioLink(session, user) {
  const { rows: [have] } = await db.query('SELECT * FROM episode_upload_links WHERE session_id = $1 ORDER BY id DESC LIMIT 1', [session.id]);
  const links = require('./studioLinks');
  if (have && links.isOpen(have)) return have;
  const holder = (await videos(session.id)).find((v) => v.status !== 'pre_producao');
  if (!holder) return null;
  const l = await links.create(holder.id, user ? user.id : null);
  await db.query('UPDATE episode_upload_links SET session_id = $2 WHERE id = $1', [l.id, session.id]);
  return { ...l, session_id: session.id };
}
const currentLink = (sessionId) => db.query('SELECT * FROM episode_upload_links WHERE session_id = $1 ORDER BY id DESC LIMIT 1', [sessionId]).then((r) => r.rows[0] || null);

// Arquivos que chegaram pelo link da sessão e ainda não têm vídeo.
const pendingFiles = (sessionId) => db.query(
  `SELECT f.id, f.filename, f.source_path, f.kind, f.size_bytes, f.status, f.created_at FROM episode_files f
    WHERE f.session_id = $1 AND f.session_pending ORDER BY coalesce(f.source_path, f.filename)`, [sessionId]).then((r) => r.rows);

// Distribuir: cada arquivo vai para o vídeo escolhido (dentro da sessão). `choices`: { fileId: episodeId }.
async function distribute(session, choices, user) {
  const ids = new Set((await videos(session.id)).map((v) => v.id));
  let moved = 0;
  for (const [fid, eid] of Object.entries(choices || {})) {
    if (!ids.has(Number(eid))) continue;
    const { rowCount } = await db.query(
      'UPDATE episode_files SET episode_id = $2, session_pending = false WHERE id = $1 AND session_id = $3 AND session_pending', [Number(fid), Number(eid), session.id]);
    moved += rowCount;
  }
  if (moved) await require('./production').addEvent((await videos(session.id))[0].id, user.id, 'arquivo', `${moved} arquivo(s) da sessão distribuído(s) entre os vídeos`);
  return { moved };
}

// ---------------------------------------------------------------- estúdio ocupado
// Outra sessão (de qualquer projeto) ou gravação de convidado agendada no mesmo horário. Só avisa: quem decide é a produção.
async function conflicts({ startsAt, minutes, excludeId = null }) {
  const from = new Date(startsAt); const to = new Date(from.getTime() + Number(minutes) * 60000);
  const { rows: sessions } = await db.query(
    `SELECT s.id, s.project_id, s.starts_at, s.planned_minutes FROM recording_sessions s
      WHERE s.status = 'planejada' AND s.id IS DISTINCT FROM $3
        AND s.starts_at < $2 AND s.starts_at + make_interval(mins => s.planned_minutes) > $1`, [from, to, excludeId]);
  const { rows: [st] } = await db.query('SELECT studio_minutes FROM fin_settings LIMIT 1');
  const guestMin = Number(st && st.studio_minutes) || 60;
  const { rows: guests } = await db.query(
    `SELECT g.id, g.name, g.project_id, g.proposed_at FROM guests g
      WHERE g.status IN ('em_agendamento', 'agendado') AND g.proposed_at IS NOT NULL
        AND g.proposed_at < $2 AND g.proposed_at + make_interval(mins => $3::int) > $1`, [from, to, guestMin]);
  return [
    ...sessions.map((s) => ({ kind: 'sessao', id: s.id, projectId: s.project_id, at: s.starts_at, label: `Sessão de gravação (${fmtMinutes(s.planned_minutes)})`, url: `/sessoes/${s.id}` })),
    ...guests.map((g) => ({ kind: 'convidado', id: g.id, projectId: g.project_id, at: g.proposed_at, label: `Gravação com ${g.name}`, url: `/convidados/${g.id}` })),
  ];
}

// Para o banco de horas: o que as sessões planejadas ainda vão gastar (a prevista menos a parte dos que já foram gravados).
async function reservations({ startOn = null } = {}) {
  const { rows } = await db.query(
    `SELECT s.id, s.project_id, (s.starts_at AT TIME ZONE '${TZ}')::date AS day, s.planned_minutes,
            coalesce((SELECT sum(e.recording_minutes) FROM episodes e WHERE e.session_id = s.id AND e.status <> 'pre_producao'), 0)::int AS spent
       FROM recording_sessions s WHERE s.status = 'planejada' AND ($1::date IS NULL OR (s.starts_at AT TIME ZONE '${TZ}')::date >= $1::date)`, [startOn]);
  return rows.map((r) => ({ id: `s${r.id}`, name: 'Sessão de gravação', project_id: r.project_id, proposed_on: r.day, minutes: Math.max(0, r.planned_minutes - r.spent) }))
    .filter((r) => r.minutes > 0);
}

module.exports = {
  STATUS, shares, fmtMinutes, get, list, videos, candidates, create, update, setVideos, moveVideo, setNote, reshare, markRecorded,
  close, setActual, cancel, studioLink, currentLink, pendingFiles, distribute, conflicts, reservations, dayOf,
};
