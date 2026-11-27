// De quem é o dinheiro. Todo lançamento tem um dono (`fin_entries.project_id`) OU linhas em `fin_entry_splits` que somam
// o valor (compartilhado). Nunca os dois, nunca nenhum. Aqui ficam: o dono que vem do vínculo, a divisão em centavos, os
// trechos de SQL do recorte e a leitura para as telas. Único lugar que decide isso.
const db = require('../db/pool');
const projects = require('./projects');

const asQuery = (c) => (typeof c === 'function' ? c : (text, params) => c.query(text, params));

// Reparte `amount` conforme os pesos e **sempre** soma `amount`: o que sobra do arredondamento vai para o maior peso.
function distribute(amount, weights) {
  const ids = Object.keys(weights).map(Number).filter((id) => Number(weights[id]) >= 0);
  const total = ids.reduce((a, id) => a + Number(weights[id]), 0);
  const out = {};
  if (!ids.length) return out;
  if (!(total > 0)) { // sem peso nenhum: divide igual
    const base = Math.floor(amount / ids.length);
    ids.forEach((id, i) => { out[id] = i === ids.length - 1 ? amount - base * (ids.length - 1) : base; });
    return out;
  }
  let used = 0; let bigId = ids[0];
  for (const id of ids) {
    if (Number(weights[id]) > Number(weights[bigId])) bigId = id;
    out[id] = Math.floor((amount * Number(weights[id])) / total);
    used += out[id];
  }
  out[bigId] += amount - used;
  return out;
}

// ---------------------------------------------------------------- recorte (SQL)
// O lançamento conta no recorte quando é de um dos projetos ou quando tem parte neles.
const where = (alias, ph) => `(${alias}.project_id = ANY(${ph}::int[]) OR EXISTS (SELECT 1 FROM fin_entry_splits s WHERE s.entry_id = ${alias}.id AND s.project_id = ANY(${ph}::int[])))`;
// Quanto desse lançamento é do recorte: o compartilhado entra só com a parte dele (em "todos", a soma das partes = o valor).
const share = (alias, ph) => `(CASE WHEN ${alias}.project_id IS NULL THEN coalesce((SELECT sum(s.amount_cents) FROM fin_entry_splits s WHERE s.entry_id = ${alias}.id AND s.project_id = ANY(${ph}::int[])), 0) ELSE ${alias}.amount_cents END)`;

// Página de detalhe e ação: quem não vê nenhum dos projetos do lançamento não o alcança.
async function canSee(pids, entry) {
  if (!entry) return false;
  if (entry.project_id != null) return pids.includes(Number(entry.project_id));
  const { rows: [r] } = await db.query('SELECT 1 FROM fin_entry_splits WHERE entry_id = $1 AND project_id = ANY($2::int[]) LIMIT 1', [entry.id, pids]);
  return Boolean(r);
}

// ---------------------------------------------------------------- dono
// O vínculo manda (episódio > convidado > contrato); sem vínculo, vale o que a tela escolheu.
async function ownerFor({ episodeId = null, guestId = null, sponsorId = null, projectId = null, weights = null } = {}, client = null) {
  const q = asQuery(client || db.query);
  const link = [['episodes', episodeId], ['guests', guestId], ['sponsors', sponsorId]].find(([, id]) => id);
  if (link) {
    const { rows: [r] } = await q(`SELECT project_id FROM ${link[0]} WHERE id = $1`, [link[1]]);
    if (r) return { projectId: Number(r.project_id), weights: null, inherited: true };
  }
  if (weights) return { projectId: null, weights, inherited: false };
  return { projectId: Number(projectId) || projects.defaultId(), weights: null, inherited: false };
}

// Grava o dono de um lançamento que já existe: ou o projeto (e nenhuma divisão), ou a divisão (e nenhum projeto).
async function save(entryId, { projectId = null, weights = null, amount = null }, client = null) {
  const q = asQuery(client || db.query);
  if (!weights) {
    await q('DELETE FROM fin_entry_splits WHERE entry_id = $1', [entryId]);
    await q('UPDATE fin_entries SET project_id = $2, updated_at = now() WHERE id = $1', [entryId, projectId]);
    return;
  }
  const { rows: [e] } = await q('SELECT amount_cents FROM fin_entries WHERE id = $1', [entryId]);
  const total = amount == null ? Number(e && e.amount_cents) : Number(amount);
  const parts = distribute(total, weights);
  await q('UPDATE fin_entries SET project_id = NULL, updated_at = now() WHERE id = $1', [entryId]);
  await q('DELETE FROM fin_entry_splits WHERE entry_id = $1', [entryId]);
  for (const [pid, cents] of Object.entries(parts)) {
    await q('INSERT INTO fin_entry_splits (entry_id, project_id, amount_cents) VALUES ($1, $2, $3)', [entryId, Number(pid), cents]);
  }
}

// O valor mudou num lançamento compartilhado: a divisão acompanha, mantendo a proporção.
async function rescale(entryId, amount, client = null) {
  const q = asQuery(client || db.query);
  const { rows } = await q('SELECT project_id, amount_cents FROM fin_entry_splits WHERE entry_id = $1', [entryId]);
  if (!rows.length) return;
  const weights = Object.fromEntries(rows.map((r) => [r.project_id, Number(r.amount_cents)]));
  await save(entryId, { weights, amount }, client);
}

// ---------------------------------------------------------------- telas
// Divisão de vários lançamentos numa consulta só: { entryId: [{ project_id, amount_cents }] }.
async function splitsOf(entryIds) {
  const ids = (entryIds || []).filter(Boolean);
  const out = {};
  if (!ids.length) return out;
  const { rows } = await db.query(
    `SELECT s.entry_id, s.project_id, s.amount_cents FROM fin_entry_splits s WHERE s.entry_id = ANY($1::int[])
      ORDER BY s.entry_id, s.project_id`, [ids]);
  for (const r of rows) (out[r.entry_id] ||= []).push({ project_id: r.project_id, amount_cents: Number(r.amount_cents) });
  return out;
}

// O que a tela manda em "De quem é": um projeto, ou "compartilhado" com um valor por projeto (em reais).
// `ids` são os projetos que a pessoa pode escolher. Sem escolha e com um projeto só, cai nele.
function parse(body = {}, amount, { ids = [], parseBRL = null } = {}) {
  const sent = String(body.de_quem || '').trim();
  if (sent !== 'compartilhado') {
    const pid = Number(sent);
    if (ids.includes(pid)) return { projectId: pid };
    if (ids.length === 1) return { projectId: ids[0] };
    if (!sent) return { projectId: null }; // herda do vínculo ou cai no padrão
    return { error: 'Escolha de quem é este lançamento.' };
  }
  if (ids.length < 2) return { error: 'Compartilhado só com mais de um projeto.' };
  // tudo em branco: a divisão de hoje fica (na mesma proporção); na criação, meio a meio
  if (ids.every((id) => String(body[`parte_${id}`] ?? '').trim() === '')) return { keep: true };
  const weights = {}; let sum = 0;
  for (const id of ids) {
    const raw = body[`parte_${id}`];
    const cents = parseBRL ? parseBRL(raw) : Math.round(Number(String(raw || '').replace(',', '.')) * 100);
    if (cents == null || Number.isNaN(cents) || cents < 0) return { error: 'Confira os valores da divisão.' };
    weights[id] = cents; sum += cents;
  }
  if (sum !== Number(amount)) return { error: 'A divisão precisa somar o valor do lançamento.' };
  return { weights };
}

// Divisão meio a meio para a tela começar preenchida.
const halves = (amount, ids) => distribute(Number(amount) || 0, Object.fromEntries(ids.map((id) => [id, 1])));

module.exports = { distribute, where, share, canSee, ownerFor, save, rescale, splitsOf, parse, halves };
