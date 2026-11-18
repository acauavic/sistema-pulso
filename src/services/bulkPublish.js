// Publicar em massa (Conteúdo > Cortes, seleção): os cortes marcados viram uma agenda. A pessoa diz a partir de quando, a janela do
// dia (ex.: das 08:00 às 22:00), quantos por dia e quantos deles vão ao Instagram como Reel de teste; o sistema distribui os horários
// na ordem da lista, mostra a agenda para conferir e cria uma publicação agendada por corte, cada uma com o título, a legenda, a capa
// escolhida e as chamadas por rede do próprio corte.
const db = require('../db/pool');
const fmt = require('../utils/format');
const SC = require('./socialCopy');

const MAX_PER_DAY = 24;
const STEP_MIN = 5; // horários redondos (de 5 em 5 minutos)
const LEAD_MIN = 10; // o primeiro horário fica pelo menos 10 minutos à frente
const QUEUED = ['publicado', 'parcial', 'agendado', 'enviando', 'revisao'];

const toMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null; };
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Minutos do dia de cada vaga: uma só = no início; várias = do início ao fim, espaçadas por igual (arredondadas a 5 min).
function daySlots(fromMin, toMin_, perDay) {
  if (perDay <= 1 || toMin_ <= fromMin) return [fromMin];
  const step = (toMin_ - fromMin) / (perDay - 1);
  return [...new Set(Array.from({ length: perDay }, (_, i) => Math.round((fromMin + i * step) / STEP_MIN) * STEP_MIN))];
}

// Quais vagas do dia são Reel de teste: as normais ficam espalhadas pelo dia (ex.: 10 por dia com 7 de teste: normais na 2ª, 6ª e 9ª).
function trialMask(perDay, trialPerDay) {
  const trials = Math.max(0, Math.min(perDay, trialPerDay));
  const normals = perDay - trials;
  const normal = new Set(Array.from({ length: normals }, (_, k) => Math.round(((k + 0.5) * perDay) / normals - 0.5)));
  return Array.from({ length: perDay }, (_, i) => !normal.has(i));
}

// Lê e confere as opções da agenda. Devolve { error } ou as opções limpas.
const todayBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10); // dia de hoje em Brasília
function readOptions(body, { today = todayBR() } = {}) {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(body.inicio || '')) ? String(body.inicio) : today;
  const from = toMin(body.de || '08:00'); const to = toMin(body.ate || '22:00');
  const perDay = Math.floor(Number(body.por_dia));
  const trialPerDay = Math.floor(Number(body.teste_por_dia || 0));
  if (from === null || to === null) return { error: 'Horário inválido: use HH:MM.' };
  if (to < from) return { error: 'O fim do dia precisa vir depois do começo.' };
  if (!Number.isInteger(perDay) || perDay < 1 || perDay > MAX_PER_DAY) return { error: `Por dia: de 1 a ${MAX_PER_DAY}.` };
  if (!Number.isInteger(trialPerDay) || trialPerDay < 0 || trialPerDay > perDay) return { error: 'Reels de teste por dia: de 0 até o total por dia.' };
  return { start, from, to, perDay, trialPerDay, trialMode: body.teste_modo === 'manual' ? 'manual' : 'auto' };
}

// Distribui os cortes (na ordem dada) pelas vagas, a partir do dia de início, pulando o que já passou. Devolve [{ clipId, at, trial }].
function plan(clipIds, { start, from, to, perDay, trialPerDay }, now = new Date()) {
  const minutes = daySlots(from, to, perDay);
  const mask = trialMask(minutes.length, Math.min(trialPerDay, minutes.length));
  const earliest = now.getTime() + LEAD_MIN * 60_000;
  const out = [];
  for (let day = 0; out.length < clipIds.length && day < 400; day += 1) {
    const ymd = addDays(start, day);
    minutes.forEach((m, i) => {
      if (out.length >= clipIds.length) return;
      const at = fmt.parseInputDateTime(`${ymd}T${hhmm(m)}`);
      if (!at || at.getTime() < earliest) return;
      out.push({ clipId: clipIds[out.length], at: at.toISOString(), trial: mask[i] });
    });
  }
  return out;
}

// Cortes que podem entrar: prontos, com episódio (ou de um pedido) e que ainda não saíram nem estão na fila. Mantém a ordem pedida.
async function eligible(ids) {
  const { rows } = await db.query(
    `SELECT c.id, c.title, c.post_title, c.caption, c.ctas, c.status, c.episode_id, c.request_id, c.cover_id, c.duration_ms, e.number AS ep_number,
            (SELECT p.status FROM episode_publications p WHERE p.clip_id = c.id AND p.status = ANY($2) ORDER BY p.id DESC LIMIT 1) AS queued
       FROM episode_clips c LEFT JOIN episodes e ON e.id = c.episode_id WHERE c.id = ANY($1)`, [ids, QUEUED]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ok = []; const skipped = [];
  for (const id of ids) {
    const c = byId.get(id);
    if (!c) continue;
    if (c.status !== 'pronto') skipped.push({ clip: c, why: 'ainda não está pronto' });
    else if (!c.episode_id && !c.request_id) skipped.push({ clip: c, why: 'sem episódio' });
    else if (c.queued) skipped.push({ clip: c, why: c.queued === 'publicado' || c.queued === 'parcial' ? 'já publicado' : 'já está na fila' });
    else ok.push(c);
  }
  return { ok, skipped };
}

// Cria as publicações agendadas. items: [{ clipId, at, trial }]. Cada corte com o seu texto, capa e chamadas por rede.
// Falha num corte não para os outros: volta em `failed` com o motivo.
async function schedule(items, { platforms, trialMode = 'auto', userId, review = false }) {
  const publishing = require('./publishing');
  const { ok } = await eligible(items.map((i) => i.clipId));
  const byId = new Map(ok.map((c) => [c.id, c]));
  const created = []; const failed = [];
  for (const it of items) {
    const c = byId.get(it.clipId);
    if (!c) { failed.push({ clipId: it.clipId, why: 'não pode mais ser publicado (já saiu, está na fila ou mudou)' }); continue; }
    const trial = it.trial && platforms.includes('instagram');
    try {
      const pub = await publishing.create({
        episodeId: c.episode_id, clipId: c.id, platforms, title: c.post_title || c.title, description: c.caption || '', scheduledAt: it.at, userId, review,
        instagram: trial ? { collaborators: [], tags: [], trial: trialMode } : null, ctas: SC.forClip(c, platforms),
      });
      created.push({ clip: c, pub, trial });
    } catch (err) { failed.push({ clipId: c.id, title: c.post_title || c.title, why: err.message }); }
  }
  return { created, failed };
}

module.exports = { MAX_PER_DAY, todayBR, daySlots, trialMask, readOptions, plan, eligible, schedule, hhmm, toMin };
