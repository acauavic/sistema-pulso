// Acerto da parceria (Projeto 100). A regra do dono: todo custo do projeto é guardado; quando entra dinheiro, o custo volta
// primeiro — para quem pagou (a casa ou o parceiro), na proporção do que cada um gastou — e o que sobra é lucro, dividido
// (50/50) só quando a casa decide distribuir.
//
// A conta corrente vai desde `start_on` e usa só o que foi PAGO ou RECEBIDO: o que é do projeto, mais a parte dele nos
// compartilhados (estúdio), separado por conta (`fin_entries.account`: casa | parceiro). O acerto (categoria "acerto") é
// transferência entre os lados: não é custo nem receita.
//
// Um acerto zera as contas numa transferência só. Quem tem direito a quê: a devolução do custo + a parte do lucro distribuído.
// Quem já tem o quê: o que recebeu na conta dele (menos o que já foi transferido). A diferença é a frase da tela.
const crypto = require('crypto');
const db = require('../db/pool');
const owner = require('./finOwner');
const projects = require('./projects');

const TZ = 'America/Sao_Paulo';
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const monthOf = (d) => String(d).slice(0, 7);
const iso = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : (v ? String(v).slice(0, 10) : null));
const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const endOfMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} de ${y}`; };
const monthShort = (ym) => { const [y, m] = ym.split('-'); return `${m}/${y}`; };

async function get(projectId) {
  const { rows: [p] } = await db.query('SELECT * FROM partnerships WHERE project_id = $1', [projectId]);
  return p ? { ...p, house_pct: Number(p.house_pct), start_on: iso(p.start_on) } : null;
}
const ofProjects = async (ids) => (ids.length ? (await db.query('SELECT project_id FROM partnerships WHERE active AND project_id = ANY($1::int[])', [ids])).rows.map((r) => r.project_id) : []);

// O que foi pago/recebido no período, por conta e por mês (a parte do projeto nos compartilhados).
async function movements(projectId, { from, until = null }) {
  const p = [[projectId], from]; let w = '';
  if (until) { p.push(until); w = ` AND e.paid_on <= $${p.length}::date`; }
  const { rows } = await db.query(
    `SELECT e.direction, e.account, coalesce(e.account_person, '') AS person, to_char(e.paid_on, 'YYYY-MM') AS ym, sum(${owner.share('e', '$1')})::bigint AS cents
       FROM fin_entries e
      WHERE e.status = 'pago' AND e.category <> 'acerto' AND e.paid_on >= $2::date${w} AND ${owner.where('e', '$1')}
      GROUP BY 1, 2, 3, 4`, p);
  return rows.map((r) => ({ ...r, cents: Number(r.cents) }));
}

// A conta corrente com totais acumulados (custos e receitas por conta) — o coração do acerto.
function compute(part, sums, settled) {
  const housePct = part.house_pct / 100; const partnerPct = 1 - housePct;
  const C = sums.costCasa + sums.costParceiro; const V = sums.revCasa + sums.revParceiro;
  const recovered = Math.min(V, C);
  const recCasa = C > 0 ? Math.round((recovered * sums.costCasa) / C) : 0;
  const recParceiro = recovered - recCasa;
  const profitTotal = Math.max(0, V - C);
  const available = profitTotal - settled.profit; // pode ficar negativo se entrou custo depois de uma distribuição
  return {
    costs: { casa: sums.costCasa, parceiro: sums.costParceiro, total: C, byPerson: sums.byPerson },
    revenue: { casa: sums.revCasa, parceiro: sums.revParceiro, total: V },
    recovered: { casa: recCasa, parceiro: recParceiro, total: recovered },
    toRecover: { casa: sums.costCasa - recCasa, parceiro: sums.costParceiro - recParceiro, total: C - recovered },
    profit: { total: profitTotal, distributed: settled.profit, available: Math.max(0, available), over: Math.max(0, -available) },
    transferred: settled.transfer, housePct, partnerPct,
  };
}

const sumUp = (moves) => moves.reduce((a, m) => {
  if (m.direction === 'saida') {
    if (m.account === 'parceiro') { a.costParceiro += m.cents; a.byPerson[m.person || 'parceiro'] = (a.byPerson[m.person || 'parceiro'] || 0) + m.cents; } else a.costCasa += m.cents;
  } else if (m.account === 'parceiro') a.revParceiro += m.cents; else a.revCasa += m.cents;
  return a;
}, { costCasa: 0, costParceiro: 0, revCasa: 0, revParceiro: 0, byPerson: {} });

async function settledUntil(projectId, until = null) {
  const { rows: [s] } = await db.query(
    `SELECT coalesce(sum(profit_cents), 0)::bigint AS profit, coalesce(sum(transfer_cents), 0)::bigint AS transfer
       FROM partnership_settlements WHERE project_id = $1 AND ($2::date IS NULL OR settled_on <= $2::date)`, [projectId, until]);
  return { profit: Number(s.profit), transfer: Number(s.transfer) };
}

async function ledger(projectId, { until = null } = {}) {
  const part = await get(projectId);
  if (!part) return null;
  const moves = await movements(projectId, { from: part.start_on, until });
  return { partnership: part, ...compute(part, sumUp(moves), await settledUntil(projectId, until)) };
}

// A transferência que zera as contas se a casa distribuir `profit` agora. > 0: a casa paga ao parceiro; < 0: o parceiro repassa.
function transferFor(L, profit = 0) {
  const partnerProfit = Math.round((L.profit.distributed + profit) * L.partnerPct);
  return L.recovered.parceiro + partnerProfit - L.revenue.parceiro - L.transferred;
}
function preview(L, profit = null) {
  const amount = profit == null ? L.profit.available : Math.max(0, Math.min(L.profit.available, Math.round(profit)));
  const transfer = transferFor(L, amount);
  return { profit: amount, houseProfit: amount - Math.round(amount * L.partnerPct), partnerProfit: Math.round(amount * L.partnerPct), transfer };
}

// Mês a mês desde o começo, com o acumulado no fim de cada mês (o que falta recuperar e o lucro).
async function months(projectId) {
  const part = await get(projectId);
  if (!part) return [];
  const moves = await movements(projectId, { from: part.start_on });
  const { rows: closings } = await db.query('SELECT * FROM partnership_closings WHERE project_id = $1', [projectId]);
  const closed = Object.fromEntries(closings.map((c) => [c.month, c]));
  const { rows: sets } = await db.query('SELECT to_char(settled_on, \'YYYY-MM\') AS ym, profit_cents, transfer_cents FROM partnership_settlements WHERE project_id = $1', [projectId]);
  const out = []; const acc = []; const settled = { profit: 0, transfer: 0 };
  for (let ym = monthOf(part.start_on); ym <= monthOf(todayISO()); ym = shiftMonth(ym, 1)) {
    const mine = moves.filter((m) => m.ym === ym);
    acc.push(...mine);
    for (const s of sets.filter((x) => x.ym === ym)) { settled.profit += Number(s.profit_cents); settled.transfer += Number(s.transfer_cents); }
    const month = sumUp(mine);
    const L = compute(part, sumUp(acc), { ...settled });
    out.push({
      ym, label: monthLabel(ym), short: monthShort(ym),
      costCasa: month.costCasa, costParceiro: month.costParceiro, revCasa: month.revCasa, revParceiro: month.revParceiro,
      toRecover: L.toRecover.total, profitAvailable: L.profit.available,
      closing: closed[ym] || null, closed: Boolean(closed[ym] && !closed[ym].reopened_at),
    });
  }
  return out.reverse(); // o mês atual primeiro
}

// "Com o que está previsto, o custo volta em 03/2027": soma o previsto (custos e receitas do projeto) mês a mês.
async function projection(projectId, L) {
  if (!L || L.toRecover.total <= 0) return { done: true };
  const { rows } = await db.query(
    `SELECT to_char(greatest(e.due_on, $2::date), 'YYYY-MM') AS ym, e.direction, sum(${owner.share('e', '$1')})::bigint AS cents
       FROM fin_entries e WHERE e.status = 'previsto' AND e.category <> 'acerto' AND ${owner.where('e', '$1')}
      GROUP BY 1, 2 ORDER BY 1`, [[projectId], todayISO()]);
  let C = L.costs.total; let V = L.revenue.total; let last = null;
  for (const ym of [...new Set(rows.map((r) => r.ym))].sort()) {
    for (const r of rows.filter((x) => x.ym === ym)) { if (r.direction === 'saida') C += Number(r.cents); else V += Number(r.cents); }
    last = ym;
    if (V >= C) return { done: false, month: ym, short: monthShort(ym) };
  }
  return { done: false, month: null, until: last ? monthShort(last) : null, missing: C - V };
}

// ---------------------------------------------------------------- fazer o acerto
async function settle(projectId, { profit = null, note = '', user }) {
  const L = await ledger(projectId);
  if (!L) return { error: 'Este projeto não tem acordo de parceria.' };
  if (profit != null && (!(Number(profit) >= 0) || Number(profit) > L.profit.available)) return { error: 'O valor a distribuir passa do lucro disponível.' };
  const pv = preview(L, profit);
  if (!pv.transfer && !pv.profit) return { error: 'Não há nada a acertar agora.' };
  const part = L.partnership;
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    let entryId = null;
    if (pv.transfer) {
      const toPartner = pv.transfer > 0;
      const { rows: [e] } = await client.query(
        `INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, status, supplier, source, created_by, project_id, account, notes)
         VALUES ($1, 'acerto', $2, $3, $4, 'previsto', $5, 'acerto', $6, $7, 'casa', $8) RETURNING id`,
        [toPartner ? 'saida' : 'entrada', `Acerto da parceria · ${toPartner ? 'a casa paga a' : 'repasse de'} ${part.partner_name}`, Math.abs(pv.transfer), todayISO(),
          part.partner_name, user.id, projectId, String(note || '').slice(0, 500) || null]);
      entryId = e.id;
    }
    const { rows: [s] } = await client.query(
      `INSERT INTO partnership_settlements (project_id, settled_on, profit_cents, transfer_cents, entry_id, note, snapshot, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [projectId, todayISO(), pv.profit, pv.transfer, entryId, String(note || '').slice(0, 500) || null, JSON.stringify({ ...L, partnership: undefined }), user.id]);
    await client.query('COMMIT');
    return { ok: true, settlement: s, preview: pv };
  } catch (err) {
    await client.query('ROLLBACK'); throw err;
  } finally { client.release(); }
}

const settlements = (projectId) => db.query(
  `SELECT s.*, u.name AS user_name, e.status AS entry_status FROM partnership_settlements s LEFT JOIN users u ON u.id = s.created_by
     LEFT JOIN fin_entries e ON e.id = s.entry_id WHERE s.project_id = $1 ORDER BY s.settled_on DESC, s.id DESC`, [projectId]).then((r) => r.rows);

// ---------------------------------------------------------------- mês fechado
async function closedMonths(projectIds) {
  if (!projectIds.length) return new Set();
  const { rows } = await db.query('SELECT project_id, month FROM partnership_closings WHERE reopened_at IS NULL AND project_id = ANY($1::int[])', [projectIds]);
  return new Set(rows.map((r) => `${r.project_id}:${r.month}`));
}

// O lançamento (ou o pagamento com data `paidOn`) cai num mês fechado de algum projeto com parceria? Devolve a frase ou null.
async function lockedReason(entry, { paidOn = null } = {}) {
  const day = paidOn || (entry && entry.status === 'pago' ? iso(entry.paid_on) : null);
  if (!day) return null;
  const pids = entry && entry.project_id != null ? [entry.project_id]
    : entry && entry.id ? (await db.query('SELECT project_id FROM fin_entry_splits WHERE entry_id = $1', [entry.id])).rows.map((r) => r.project_id) : [];
  const closed = await closedMonths(pids);
  const hit = pids.find((pid) => closed.has(`${pid}:${monthOf(day)}`));
  return hit ? `O mês ${monthShort(monthOf(day))} do ${projects.get(hit) ? projects.get(hit).name : 'projeto'} está fechado: lance no mês atual como ajuste.` : null;
}

async function close(projectId, ym, user) {
  const part = await get(projectId);
  if (!part) return { error: 'Este projeto não tem acordo de parceria.' };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym)) || ym < monthOf(part.start_on) || ym > monthOf(todayISO())) return { error: 'Escolha um mês do acordo.' };
  const row = (await months(projectId)).find((m) => m.ym === ym);
  const L = await ledger(projectId, { until: endOfMonth(ym) });
  const statement = { month: row, ledger: { ...L, partnership: undefined } };
  await db.query(
    `INSERT INTO partnership_closings (project_id, month, statement, closed_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, month) DO UPDATE SET statement = EXCLUDED.statement, closed_by = EXCLUDED.closed_by, closed_at = now(),
       reopened_at = NULL, reopened_by = NULL, reopen_reason = NULL`, [projectId, ym, JSON.stringify(statement), user.id]);
  return { ok: true };
}

async function reopen(projectId, ym, reason, user) {
  const why = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!why) return { error: 'Diga por que o mês precisa ser reaberto.' };
  const { rowCount } = await db.query(
    'UPDATE partnership_closings SET reopened_at = now(), reopened_by = $3, reopen_reason = $4 WHERE project_id = $1 AND month = $2 AND reopened_at IS NULL', [projectId, ym, user.id, why]);
  return rowCount ? { ok: true } : { error: 'Este mês não está fechado.' };
}

// ---------------------------------------------------------------- o acordo
async function setTerms(projectId, body, user) {
  const name = String(body.partner_name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const people = String(body.partner_people || '').split(/[,\n]/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 10);
  const pct = Number(String(body.house_pct ?? '').replace(',', '.'));
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(body.start_on || '')) ? body.start_on : null;
  if (name.length < 2) return { error: 'Diga quem é o parceiro.' };
  if (!(pct >= 0 && pct <= 100)) return { error: 'A parte da casa vai de 0 a 100%.' };
  if (!start) return { error: 'Diga desde quando o acordo vale.' };
  await db.query(
    `INSERT INTO partnerships (project_id, partner_name, partner_people, house_pct, start_on, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (project_id) DO UPDATE SET partner_name = EXCLUDED.partner_name, partner_people = EXCLUDED.partner_people, house_pct = EXCLUDED.house_pct,
       start_on = EXCLUDED.start_on, active = true, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [projectId, name, people.length ? people : [name], pct, start, user.id]);
  return { ok: true };
}

// ---------------------------------------------------------------- extrato por link (só leitura)
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
async function link(projectId, user) {
  const { rows: [have] } = await db.query('SELECT * FROM partnership_links WHERE project_id = $1 AND revoked_at IS NULL ORDER BY id DESC LIMIT 1', [projectId]);
  if (have) return have;
  const { rows: [l] } = await db.query('INSERT INTO partnership_links (project_id, token, created_by) VALUES ($1, $2, $3) RETURNING *',
    [projectId, crypto.randomBytes(24).toString('base64url'), user.id]);
  return l;
}
const currentLink = (projectId) => db.query('SELECT * FROM partnership_links WHERE project_id = $1 AND revoked_at IS NULL ORDER BY id DESC LIMIT 1', [projectId]).then((r) => r.rows[0] || null);
const revokeLink = (projectId, user) => db.query('UPDATE partnership_links SET revoked_at = now() WHERE project_id = $1 AND revoked_at IS NULL', [projectId]).then((r) => r.rowCount);
async function byToken(token) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const { rows: [l] } = await db.query('SELECT * FROM partnership_links WHERE token = $1 AND revoked_at IS NULL', [token]);
  return l || null;
}
const linkUrl = (l) => require('./publicUrl').publicUrl(l.project_id, `/extrato/${l.token}`);

// Quem pagou, para o campo da tela: "casa" ou uma pessoa do parceiro. Devolve { account, person } ou { error }.
async function accountFrom(value, projectId) {
  const v = String(value || 'casa');
  if (v === 'casa') return { account: 'casa', person: null };
  const part = projectId ? await get(projectId) : null;
  if (!part) return { error: 'Só lançamento de projeto com parceria pode ser do parceiro.' };
  const person = v.replace(/^parceiro:/, '');
  if (!part.partner_people.includes(person)) return { error: 'Escolha quem pagou.' };
  return { account: 'parceiro', person };
}

module.exports = {
  get, ofProjects, ledger, compute, sumUp, transferFor, preview, months, projection, settle, settlements, closedMonths, lockedReason, close, reopen,
  setTerms, link, currentLink, revokeLink, byToken, linkUrl, accountFrom, monthLabel, monthShort, endOfMonth,
};
