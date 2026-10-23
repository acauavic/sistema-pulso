// Financeiro do podcast: contas a pagar e a receber, custos que nascem sozinhos com o episódio (estúdio, regras e custos
// mensais), parcelas de patrocínio e estoque com previsão de reposição. Tudo que é automático usa `auto_key` (único):
// rodar de novo nunca lança duas vezes.
const db = require('../db/pool');
const C = require('../constants');

const TZ = 'America/Sao_Paulo';
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const dayOf = (d) => (d ? new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d instanceof Date ? d : new Date(d)) : null);
const iso = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : (v ? String(v).slice(0, 10) : null));

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Soma meses mantendo o dia (31 -> último dia do mês seguinte).
function addMonths(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
const monthOf = (isoDate) => isoDate.slice(0, 7);
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} de ${y}`; };
const monthShortLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1].slice(0, 3).toUpperCase()}/${String(y).slice(2)}`; };
const shiftMonth = (ym, n) => addMonths(`${ym}-01`, n).slice(0, 7);

// ---------------------------------------------------------------- ajustes
async function settings() {
  const { rows: [s] } = await db.query('SELECT * FROM fin_settings WHERE id = 1');
  return {
    ...s,
    studio_hour_cents: Number(s.studio_hour_cents), studio_deposit_cents: Number(s.studio_deposit_cents),
    opening_balance_cents: Number(s.opening_balance_cents), episodes_per_month: Number(s.episodes_per_month),
    opening_on: iso(s.opening_on),
  };
}

// ---------------------------------------------------------------- lançamentos automáticos
// Cria o lançamento automático; se já existe, só reativa o que o próprio sistema cancelou e (opcional) refaz o vencimento.
async function upsertAuto(e) {
  const { rows: [row] } = await db.query(
    `INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, supplier, episode_id, guest_id, sponsor_id, stock_item_id, rule_id, recurring_id, source, auto_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (auto_key) DO UPDATE SET
       status = CASE WHEN fin_entries.status = 'cancelado' AND fin_entries.cancel_reason = 'sistema' THEN 'previsto' ELSE fin_entries.status END,
       cancel_reason = CASE WHEN fin_entries.status = 'cancelado' AND fin_entries.cancel_reason = 'sistema' THEN NULL ELSE fin_entries.cancel_reason END,
       due_on = CASE WHEN $15 AND fin_entries.status IN ('previsto') THEN EXCLUDED.due_on ELSE fin_entries.due_on END,
       episode_id = coalesce(EXCLUDED.episode_id, fin_entries.episode_id), updated_at = now()
     RETURNING *`,
    [e.direction || 'saida', e.category, String(e.description).slice(0, 200), e.amount, e.due, e.supplier || null, e.episodeId || null, e.guestId || null, e.sponsorId || null,
      e.stockItemId || null, e.ruleId || null, e.recurringId || null, e.source || 'regra', e.key, Boolean(e.refreshDue)]);
  return row;
}

const cancelBySystem = (where, params) => db.query(
  `UPDATE fin_entries SET status = 'cancelado', cancel_reason = 'sistema', updated_at = now() WHERE status = 'previsto' AND ${where}`, params);

// Quando vence uma regra: âncora + dias. Sem a data da âncora, vale o dia do gatilho.
function dueFor(rule, { recordedOn = null, airedOn = null } = {}) {
  const base = rule.anchor === 'gravacao' ? recordedOn : rule.anchor === 'veiculacao' ? airedOn : null;
  return addDays(base || todayISO(), Number(rule.offset_days) || 0);
}

async function rulesFor(trigger) {
  const { rows } = await db.query('SELECT * FROM fin_rules WHERE active AND trigger = $1 ORDER BY id', [trigger]);
  return rows.map((r) => ({ ...r, amount_cents: Number(r.amount_cents) }));
}

// ---- convidado agendado: sinal do estúdio e regras "quando a gravação é agendada"
async function syncGuest(guestId) {
  const { rows: [guest] } = await db.query('SELECT * FROM guests WHERE id = $1', [guestId]);
  if (!guest) return;
  const { rows: [ep] } = await db.query('SELECT id FROM episodes WHERE guest_id = $1', [guestId]);
  if (ep) return; // depois do episódio, quem manda é o episódio
  if (guest.status !== 'agendado') { // desistiu ou voltou para a negociação: o que ainda não foi pago sai da lista
    if (['perdido', 'cancelado', 'prospect', 'convite_enviado'].includes(guest.status)) await cancelBySystem('guest_id = $1 AND episode_id IS NULL', [guestId]);
    return;
  }
  const s = await settings();
  const recordedOn = dayOf(guest.proposed_at);
  if (s.studio_deposit_cents > 0) {
    await upsertAuto({ key: `estudio-sinal-g${guestId}`, category: 'estudio', description: `Estúdio · sinal da reserva (${guest.name})`, amount: s.studio_deposit_cents, due: todayISO(), guestId, source: 'estudio' });
  }
  for (const r of await rulesFor('gravacao_agendada')) {
    await upsertAuto({ key: `regra-${r.id}-g${guestId}`, category: r.category, description: `${r.name} (${guest.name})`, amount: r.amount_cents, due: dueFor(r, { recordedOn }), supplier: r.supplier, guestId, ruleId: r.id, refreshDue: r.anchor === 'gravacao' });
  }
}

// ---- estúdio: sinal + saldo (duração × hora) + horas extras se a gravação passou do combinado
async function recomputeStudio(episodeId) {
  const { rows: [ep] } = await db.query('SELECT * FROM episodes WHERE id = $1', [episodeId]);
  if (!ep) return;
  const s = await settings();
  if (!s.studio_hour_cents) return;
  const minutes = ep.recording_minutes || s.studio_minutes;
  const total = Math.round((minutes / 60) * s.studio_hour_cents);
  const { rows: [sinal] } = await db.query("SELECT coalesce(sum(amount_cents),0)::bigint AS v FROM fin_entries WHERE episode_id = $1 AND auto_key LIKE 'estudio-sinal-%' AND status <> 'cancelado'", [episodeId]);
  const deposit = Number(sinal.v);
  const balance = Math.max(0, total - deposit);
  const due = iso(ep.recorded_on) || todayISO();
  const label = `${ep.number ? `EP.${String(ep.number).padStart(3, '0')}` : 'Episódio'} · ${minutes} min`;
  const { rows: [saldo] } = await db.query('SELECT * FROM fin_entries WHERE auto_key = $1', [`estudio-saldo-e${episodeId}`]);
  if (!saldo) {
    if (balance > 0) await upsertAuto({ key: `estudio-saldo-e${episodeId}`, category: 'estudio', description: `Estúdio · saldo da gravação (${label})`, amount: balance, due, episodeId, source: 'estudio' });
    return;
  }
  if (saldo.status === 'previsto' || (saldo.status === 'cancelado' && saldo.cancel_reason === 'sistema')) {
    if (balance > 0) {
      await db.query("UPDATE fin_entries SET amount_cents = $2, description = $3, status = 'previsto', cancel_reason = NULL, updated_at = now() WHERE id = $1", [saldo.id, balance, `Estúdio · saldo da gravação (${label})`]);
    } else {
      await cancelBySystem('id = $1', [saldo.id]);
    }
    await cancelBySystem("auto_key = $1", [`estudio-extra-e${episodeId}`]);
    return;
  }
  if (saldo.status === 'pago') { // o saldo já foi pago: o que passou disso vira horas extras
    const extra = Math.max(0, total - deposit - Number(saldo.amount_cents));
    if (extra > 0) {
      const { rows: [ex] } = await db.query('SELECT * FROM fin_entries WHERE auto_key = $1', [`estudio-extra-e${episodeId}`]);
      if (ex && ex.status === 'pago') return;
      if (ex) await db.query("UPDATE fin_entries SET amount_cents = $2, status = 'previsto', cancel_reason = NULL, updated_at = now() WHERE id = $1", [ex.id, extra]);
      else await upsertAuto({ key: `estudio-extra-e${episodeId}`, category: 'estudio', description: `Estúdio · horas extras (${label})`, amount: extra, due: todayISO(), episodeId, source: 'estudio' });
    } else {
      await cancelBySystem('auto_key = $1', [`estudio-extra-e${episodeId}`]);
    }
  }
}

// ---- estoque: o episódio gravado consome o que cada item gasta por episódio
async function consumeStock(episodeId) {
  const { rows: items } = await db.query('SELECT * FROM fin_stock_items WHERE active AND per_episode > 0');
  for (const it of items) {
    await db.query(
      `INSERT INTO fin_stock_moves (item_id, qty, reason, episode_id, unit_cost_cents, note) VALUES ($1, $2, 'episodio', $3, $4, 'Uso no episódio')
       ON CONFLICT (item_id, episode_id) WHERE reason = 'episodio' DO NOTHING`, [it.id, -Number(it.per_episode), episodeId, it.unit_cost_cents]);
  }
}

// ---- o episódio nasceu (conversa gravada)
async function onEpisodeCreated(episodeId) {
  const { rows: [ep] } = await db.query('SELECT * FROM episodes WHERE id = $1', [episodeId]);
  if (!ep) return;
  if (ep.guest_id) await db.query('UPDATE fin_entries SET episode_id = $1, updated_at = now() WHERE guest_id = $2 AND episode_id IS NULL', [ep.id, ep.guest_id]);
  await recomputeStudio(ep.id);
  const recordedOn = iso(ep.recorded_on);
  for (const r of await rulesFor('episodio_gravado')) {
    await upsertAuto({ key: `regra-${r.id}-e${ep.id}`, category: r.category, description: `${r.name} · ${epLabel(ep)}`, amount: r.amount_cents, due: dueFor(r, { recordedOn, airedOn: iso(ep.aired_on) }), supplier: r.supplier, episodeId: ep.id, ruleId: r.id, refreshDue: r.anchor !== 'gatilho' });
  }
  await consumeStock(ep.id);
}

const epLabel = (ep) => `${ep.number ? `EP.${String(ep.number).padStart(3, '0')}` : 'Episódio'} ${ep.title || ''}`.trim();

async function onEpisodeStage(episodeId, stage) {
  if (stage !== 'publicado') return;
  const { rows: [ep] } = await db.query('SELECT * FROM episodes WHERE id = $1', [episodeId]);
  if (!ep) return;
  for (const r of await rulesFor('episodio_publicado')) {
    await upsertAuto({ key: `regra-${r.id}-e${ep.id}`, category: r.category, description: `${r.name} · ${epLabel(ep)}`, amount: r.amount_cents, due: dueFor(r, { recordedOn: iso(ep.recorded_on), airedOn: iso(ep.aired_on) }), supplier: r.supplier, episodeId: ep.id, ruleId: r.id, refreshDue: true });
  }
}

// Datas do episódio mudaram: vencimentos ainda em aberto que dependem delas acompanham.
async function onEpisodeDates(episodeId) {
  const { rows: [ep] } = await db.query('SELECT * FROM episodes WHERE id = $1', [episodeId]);
  if (!ep) return;
  const { rows: rules } = await db.query(
    `SELECT r.*, e.id AS entry_id FROM fin_entries e JOIN fin_rules r ON r.id = e.rule_id WHERE e.episode_id = $1 AND e.status = 'previsto' AND r.anchor <> 'gatilho'`, [episodeId]);
  for (const r of rules) {
    const base = r.anchor === 'gravacao' ? iso(ep.recorded_on) : iso(ep.aired_on);
    if (base) await db.query('UPDATE fin_entries SET due_on = $2, updated_at = now() WHERE id = $1', [r.entry_id, addDays(base, r.offset_days)]);
  }
  if (ep.recorded_on) await db.query("UPDATE fin_entries SET due_on = $2, updated_at = now() WHERE auto_key = $1 AND status = 'previsto'", [`estudio-saldo-e${ep.id}`, iso(ep.recorded_on)]);
}

async function setDuration(episodeId, minutes) {
  await db.query('UPDATE episodes SET recording_minutes = $2, updated_at = now() WHERE id = $1', [episodeId, minutes]);
  await recomputeStudio(episodeId);
}

// Apagou o convidado, o episódio ou o patrocinador: o que ainda não foi pago e era automático sai da lista; o estoque volta.
const onGuestDeleted = (id) => cancelBySystem('guest_id = $1 AND episode_id IS NULL AND auto_key IS NOT NULL', [id]);
async function onEpisodeDeleted(id) {
  await cancelBySystem('episode_id = $1 AND auto_key IS NOT NULL', [id]);
  await db.query("DELETE FROM fin_stock_moves WHERE episode_id = $1 AND reason = 'episodio'", [id]);
}
const onSponsorDeleted = (id) => db.query("DELETE FROM fin_entries WHERE sponsor_id = $1 AND direction = 'entrada' AND status = 'previsto' AND source = 'patrocinio'", [id]);

// ---------------------------------------------------------------- custos mensais
async function ensureRecurring(monthsAhead = 3) {
  const { rows } = await db.query('SELECT * FROM fin_recurring WHERE active');
  const today = todayISO();
  let made = 0;
  for (const r of rows) {
    for (let i = 0; i <= monthsAhead; i += 1) {
      const ym = shiftMonth(monthOf(today), i);
      const date = `${ym}-${String(r.day_of_month).padStart(2, '0')}`;
      if (date < iso(r.starts_on) || (r.ends_on && date > iso(r.ends_on))) continue;
      const { rowCount } = await db.query(
        `INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, supplier, recurring_id, source, auto_key)
         VALUES ('saida',$1,$2,$3,$4,$5,$6,'mensal',$7) ON CONFLICT (auto_key) DO NOTHING`,
        [r.category, `${r.name} · ${monthShortLabel(ym)}`, r.amount_cents, date, r.supplier, r.id, `mensal-${r.id}-${ym}`]);
      made += rowCount;
    }
  }
  return made;
}

// ---------------------------------------------------------------- patrocínio: parcelas a receber
// Refaz as parcelas ainda abertas para o que falta receber. n = 1 é à vista.
async function planSponsorPayment(sponsor, { installments, firstDue, userId = null }) {
  const total = Number(sponsor.value_cents);
  const { rows: [paid] } = await db.query("SELECT coalesce(sum(amount_cents),0)::bigint AS v FROM fin_entries WHERE sponsor_id = $1 AND direction = 'entrada' AND status = 'pago'", [sponsor.id]);
  const remaining = total - Number(paid.v);
  if (!(remaining > 0)) return { error: 'Esse patrocínio já foi todo recebido.' };
  const n = Math.max(1, Math.min(24, Number(installments) || 1));
  await db.query("DELETE FROM fin_entries WHERE sponsor_id = $1 AND direction = 'entrada' AND status <> 'pago' AND source = 'patrocinio'", [sponsor.id]);
  const { rows: [done] } = await db.query("SELECT count(*)::int AS n FROM fin_entries WHERE sponsor_id = $1 AND direction = 'entrada' AND status = 'pago'", [sponsor.id]);
  const base = Math.floor(remaining / n);
  for (let i = 0; i < n; i += 1) {
    const amount = i === n - 1 ? remaining - base * (n - 1) : base;
    const label = n === 1 && !done.n ? 'pagamento à vista' : `parcela ${done.n + i + 1}/${done.n + n}`;
    await db.query(
      `INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, sponsor_id, installment_no, installments, source, created_by)
       VALUES ('entrada','patrocinio',$1,$2,$3,$4,$5,$6,'patrocinio',$7)`,
      [`Patrocínio ${sponsor.company} · ${label}`, amount, addMonths(firstDue, i), sponsor.id, done.n + i + 1, done.n + n, userId]);
  }
  return { ok: true, n, remaining };
}

async function sponsorSummary(sponsorId) {
  const { rows } = await db.query("SELECT * FROM fin_entries WHERE sponsor_id = $1 AND direction = 'entrada' AND status <> 'cancelado' ORDER BY due_on, id", [sponsorId]);
  const received = rows.filter((r) => r.status === 'pago').reduce((a, r) => a + Number(r.amount_cents), 0);
  const pending = rows.filter((r) => r.status === 'previsto');
  return { entries: rows, received, open: pending.reduce((a, r) => a + Number(r.amount_cents), 0), next: pending[0] || null };
}

// Recebeu uma parcela: o primeiro recebimento confirma o pagamento do patrocinador (exigido para ficar Ativo).
async function afterPaid(entry, userId) {
  if (entry.direction !== 'entrada' || !entry.sponsor_id) return;
  const { rows: [sp] } = await db.query('SELECT * FROM sponsors WHERE id = $1', [entry.sponsor_id]);
  if (!sp || sp.paid_at) return;
  await db.query('UPDATE sponsors SET paid_at = $2, updated_at = now() WHERE id = $1', [sp.id, iso(entry.paid_on)]);
  await require('./sponsors').addEvent(sp.id, userId, 'pagamento', `Pagamento confirmado em ${iso(entry.paid_on).split('-').reverse().join('/')} (primeiro recebimento lançado no financeiro)`);
}

// ---------------------------------------------------------------- estoque
async function stockItems() {
  const s = await settings();
  const { rows } = await db.query(
    `SELECT i.*, coalesce((SELECT sum(qty) FROM fin_stock_moves m WHERE m.item_id = i.id), 0)::float AS qty,
            coalesce((SELECT sum(-qty) FROM fin_stock_moves m WHERE m.item_id = i.id AND m.reason = 'episodio' AND m.created_at > now() - interval '90 days'), 0)::float AS used90
       FROM fin_stock_items i ORDER BY i.active DESC, lower(i.name)`);
  return rows.map((i) => ({ ...i, per_episode: Number(i.per_episode), min_qty: Number(i.min_qty), unit_cost_cents: Number(i.unit_cost_cents), ...forecast(i, s) }));
}

// Quantos episódios o saldo cobre, quando acaba e até quando é preciso comprar (prazo de reposição incluso).
function forecast(item, s, today = todayISO()) {
  const qty = Number(item.qty);
  const epm = s.episodes_per_month > 0 ? s.episodes_per_month : 4;
  const per = Number(item.per_episode);
  let episodes = null; let runsOut = null; let buyBy = null;
  if (per > 0) {
    episodes = Math.floor((qty / per) * 10) / 10;
    runsOut = addDays(today, Math.max(0, Math.floor((qty / per) * (30 / epm))));
    buyBy = addDays(runsOut, -Number(item.lead_days));
  }
  const low = Number(item.min_qty) > 0 && qty <= Number(item.min_qty);
  let state = 'ok';
  if (qty <= 0) state = 'acabou';
  else if (low || (buyBy && buyBy <= today)) state = 'comprar';
  else if (buyBy && buyBy <= addDays(today, 21)) state = 'atencao';
  return { episodes, runs_out: runsOut, buy_by: buyBy, state };
}
const STOCK_STATE = { ok: 'Em dia', atencao: 'Comprar em breve', comprar: 'Comprar agora', acabou: 'Acabou' };

async function stockMoves(itemId, limit = 8) {
  const { rows } = await db.query(
    `SELECT m.*, e.number AS ep_number, e.title AS ep_title, u.name AS user_name FROM fin_stock_moves m LEFT JOIN episodes e ON e.id = m.episode_id LEFT JOIN users u ON u.id = m.user_id
      WHERE m.item_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT $2`, [itemId, limit]);
  return rows.map((m) => ({ ...m, qty: Number(m.qty) }));
}

// Compra: entra no estoque (custo médio) e vira conta a pagar (à vista ou parcelada).
async function buyStock({ item, qty, totalCents, category = 'brindes', supplier = null, firstDue, installments = 1, paidNow = false, userId = null }) {
  const q = Number(qty);
  const unit = Math.round(totalCents / q);
  const n = Math.max(1, Math.min(24, Number(installments) || 1));
  const { rows: [{ qty: have }] } = await db.query('SELECT coalesce(sum(qty),0)::float AS qty FROM fin_stock_moves WHERE item_id = $1', [item.id]);
  const avg = have > 0 ? Math.round((have * Number(item.unit_cost_cents) + q * unit) / (have + q)) : unit;
  const base = Math.floor(totalCents / n);
  let first = null;
  for (let i = 0; i < n; i += 1) {
    const amount = i === n - 1 ? totalCents - base * (n - 1) : base;
    const paid = paidNow && i === 0;
    const { rows: [e] } = await db.query(
      `INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, paid_on, status, supplier, stock_item_id, installment_no, installments, source, created_by)
       VALUES ('saida',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'estoque',$11) RETURNING id`,
      [category, `Compra · ${item.name} (${q} ${item.unit})${n > 1 ? ` · parcela ${i + 1}/${n}` : ''}`, amount, addMonths(firstDue, i), paid ? todayISO() : null, paid ? 'pago' : 'previsto', supplier || item.supplier, item.id, n > 1 ? i + 1 : null, n > 1 ? n : null, userId]);
    if (i === 0) first = e.id;
  }
  await db.query("INSERT INTO fin_stock_moves (item_id, qty, reason, entry_id, unit_cost_cents, note, user_id) VALUES ($1,$2,'compra',$3,$4,$5,$6)", [item.id, q, first, unit, supplier || null, userId]);
  await db.query('UPDATE fin_stock_items SET unit_cost_cents = $2, supplier = coalesce($3, supplier) WHERE id = $1', [item.id, avg, supplier || null]);
}

// ---------------------------------------------------------------- consultas
const toEntry = (r) => ({ ...r, amount_cents: Number(r.amount_cents), due_on: iso(r.due_on), paid_on: iso(r.paid_on) });

async function entries({ scope = 'pagar', month = null, q = '', category = '', episodeId = null, limit = 300 } = {}) {
  const p = []; const where = [];
  const add = (v) => { p.push(v); return `$${p.length}`; };
  if (scope === 'pagar') where.push("e.direction = 'saida' AND e.status = 'previsto'");
  else if (scope === 'receber') where.push("e.direction = 'entrada' AND e.status = 'previsto'");
  else {
    where.push("e.status IN ('pago','cancelado')");
    if (month) where.push(`coalesce(e.paid_on, e.due_on) >= ${add(`${month}-01`)}::date AND coalesce(e.paid_on, e.due_on) < (${add(`${month}-01`)}::date + interval '1 month')`);
  }
  if (category && C.FIN_CATEGORIES[category]) where.push(`e.category = ${add(category)}`);
  if (episodeId) where.push(`e.episode_id = ${add(episodeId)}`);
  const term = String(q || '').trim();
  if (term) { const ph = add(`%${term}%`); where.push(`(e.description ILIKE ${ph} OR e.supplier ILIKE ${ph} OR s.company ILIKE ${ph})`); }
  const order = scope === 'historico' ? 'coalesce(e.paid_on, e.due_on) DESC, e.id DESC' : 'e.due_on, e.id';
  const { rows } = await db.query(
    `SELECT e.*, s.company AS sponsor_name, ep.number AS episode_number, ep.title AS episode_title, g.name AS guest_name
       FROM fin_entries e LEFT JOIN sponsors s ON s.id = e.sponsor_id LEFT JOIN episodes ep ON ep.id = e.episode_id LEFT JOIN guests g ON g.id = e.guest_id
      WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${Math.min(1000, limit)}`, p);
  return rows.map(toEntry);
}

async function counts() {
  const { rows: [r] } = await db.query(
    `SELECT count(*) FILTER (WHERE direction = 'saida' AND status = 'previsto')::int AS pagar,
            count(*) FILTER (WHERE direction = 'entrada' AND status = 'previsto')::int AS receber,
            count(*) FILTER (WHERE status = 'previsto' AND due_on < CURRENT_DATE)::int AS atrasados FROM fin_entries`);
  return r;
}

// Caixa de hoje: saldo inicial + o que entrou e saiu desde a data do saldo inicial.
async function cashNow(s) {
  const { rows: [r] } = await db.query(
    `SELECT coalesce(sum(CASE WHEN direction = 'entrada' THEN amount_cents ELSE -amount_cents END), 0)::bigint AS v
       FROM fin_entries WHERE status = 'pago' AND ($1::date IS NULL OR paid_on >= $1::date)`, [s.opening_on]);
  return s.opening_balance_cents + Number(r.v);
}

// Resumo: números do mês, o que pede atenção e a projeção dos próximos meses.
async function overview({ months = 4 } = {}) {
  const s = await settings();
  const today = todayISO();
  const ym = monthOf(today);
  const [{ rows: [m] }, { rows: attention }, { rows: pend }, cash, perEp] = await Promise.all([
    db.query(
      `SELECT coalesce(sum(amount_cents) FILTER (WHERE direction = 'entrada' AND status = 'pago' AND to_char(paid_on,'YYYY-MM') = $1), 0)::bigint AS in_paid,
              coalesce(sum(amount_cents) FILTER (WHERE direction = 'saida' AND status = 'pago' AND to_char(paid_on,'YYYY-MM') = $1), 0)::bigint AS out_paid,
              coalesce(sum(amount_cents) FILTER (WHERE direction = 'entrada' AND status = 'previsto' AND due_on <= (date_trunc('month', $2::date) + interval '1 month - 1 day')::date), 0)::bigint AS in_open,
              coalesce(sum(amount_cents) FILTER (WHERE direction = 'saida' AND status = 'previsto' AND due_on <= (date_trunc('month', $2::date) + interval '1 month - 1 day')::date), 0)::bigint AS out_open,
              coalesce(sum(amount_cents) FILTER (WHERE status = 'previsto' AND due_on < $2::date AND direction = 'saida'), 0)::bigint AS late_out,
              coalesce(sum(amount_cents) FILTER (WHERE status = 'previsto' AND due_on < $2::date AND direction = 'entrada'), 0)::bigint AS late_in,
              coalesce(sum(amount_cents) FILTER (WHERE status = 'previsto' AND direction = 'saida' AND due_on BETWEEN $2::date AND ($2::date + 7)), 0)::bigint AS out_7
         FROM fin_entries`, [ym, today]),
    db.query(
      `SELECT e.*, s.company AS sponsor_name, ep.number AS episode_number, ep.title AS episode_title, g.name AS guest_name FROM fin_entries e
         LEFT JOIN sponsors s ON s.id = e.sponsor_id LEFT JOIN episodes ep ON ep.id = e.episode_id LEFT JOIN guests g ON g.id = e.guest_id
        WHERE e.status = 'previsto' AND e.due_on <= ($1::date + 7) ORDER BY e.due_on, e.id LIMIT 6`, [today]),
    db.query("SELECT direction, amount_cents, due_on FROM fin_entries WHERE status = 'previsto'"),
    cashNow(s),
    costPerEpisode(6),
  ]);
  // projeção: o que está em aberto cai no mês do vencimento (atrasado conta no mês atual)
  const rowsByMonth = {};
  for (let i = 0; i < months; i += 1) rowsByMonth[shiftMonth(ym, i)] = { ym: shiftMonth(ym, i), in: 0, out: 0 };
  for (const e of pend) {
    let key = monthOf(iso(e.due_on));
    if (key < ym) key = ym;
    if (!rowsByMonth[key]) continue;
    rowsByMonth[key][e.direction === 'entrada' ? 'in' : 'out'] += Number(e.amount_cents);
  }
  let run = cash;
  const forecastRows = Object.values(rowsByMonth).map((r) => { run += r.in - r.out; return { ...r, net: r.in - r.out, balance: run, label: monthShortLabel(r.ym) }; });
  const stock = (await stockItems()).filter((i) => i.active && ['comprar', 'acabou', 'atencao'].includes(i.state));
  return {
    month: { ym, label: monthLabel(ym), in_paid: Number(m.in_paid), out_paid: Number(m.out_paid), in_open: Number(m.in_open), out_open: Number(m.out_open), result: Number(m.in_paid) - Number(m.out_paid) },
    late: { out: Number(m.late_out), in: Number(m.late_in) }, out7: Number(m.out_7), cash, attention: attention.map(toEntry), forecast: forecastRows, stock, perEpisode: perEp, settings: s,
  };
}

// Custo de cada episódio (lançamentos ligados a ele + material de estoque usado) e a média.
async function costPerEpisode(limit = 6) {
  const { rows } = await db.query(
    `SELECT e.id, e.number, e.title, e.recorded_on,
            coalesce((SELECT sum(amount_cents) FROM fin_entries f WHERE f.episode_id = e.id AND f.direction = 'saida' AND f.status <> 'cancelado'), 0)::bigint AS costs,
            coalesce((SELECT sum(-m.qty * m.unit_cost_cents) FROM fin_stock_moves m WHERE m.episode_id = e.id AND m.reason = 'episodio'), 0)::float AS stock
       FROM episodes e ORDER BY e.number DESC NULLS LAST, e.id DESC LIMIT $1`, [limit]);
  const list = rows.map((r) => ({ ...r, costs: Number(r.costs), stock: Math.round(r.stock), total: Number(r.costs) + Math.round(r.stock) }));
  const withCost = list.filter((r) => r.total > 0);
  return { list, average: withCost.length ? Math.round(withCost.reduce((a, r) => a + r.total, 0) / withCost.length) : 0 };
}

async function episodeFinance(episodeId) {
  const [list, moves] = await Promise.all([
    db.query("SELECT e.* FROM fin_entries e WHERE e.episode_id = $1 AND e.status <> 'cancelado' ORDER BY e.due_on, e.id", [episodeId]).then((r) => r.rows.map(toEntry)),
    db.query("SELECT m.*, i.name, i.unit FROM fin_stock_moves m JOIN fin_stock_items i ON i.id = m.item_id WHERE m.episode_id = $1 AND m.reason = 'episodio' ORDER BY i.name", [episodeId]),
  ]);
  const stockCost = moves.rows.reduce((a, m) => a + Math.round(-Number(m.qty) * Number(m.unit_cost_cents)), 0);
  const costs = list.filter((e) => e.direction === 'saida');
  const out = costs.reduce((a, e) => a + e.amount_cents, 0);
  return { entries: list, stock: moves.rows.map((m) => ({ ...m, qty: -Number(m.qty) })), stockCost, total: out + stockCost, paid: costs.filter((e) => e.status === 'pago').reduce((a, e) => a + e.amount_cents, 0) };
}

// ---------------------------------------------------------------- avisos (rotina)
async function tick() {
  const today = todayISO();
  await ensureRecurring(3);
  const { rows: due } = await db.query(
    "SELECT direction, count(*)::int AS n, coalesce(sum(amount_cents),0)::bigint AS total, count(*) FILTER (WHERE due_on < $1)::int AS late FROM fin_entries WHERE status = 'previsto' AND due_on <= ($1::date + 3) GROUP BY direction", [today]);
  const out = due.find((d) => d.direction === 'saida');
  if (out && out.n) {
    const late = out.late ? `${out.late} atrasada${out.late > 1 ? 's' : ''} · ` : '';
    await require('./notify').notify({ type: 'financeiro', broadcast: true, title: `${out.n} conta${out.n > 1 ? 's' : ''} a pagar até 3 dias`, body: `${late}${(Number(out.total) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, url: '/financeiro/lancamentos', dedupe: `fin-pagar-${today}` });
  }
  const inn = due.find((d) => d.direction === 'entrada' && d.late > 0);
  if (inn) await require('./notify').notify({ type: 'financeiro', broadcast: true, title: `${inn.late} recebimento${inn.late > 1 ? 's' : ''} em atraso`, body: 'Confira os patrocínios com parcela vencida.', url: '/financeiro/lancamentos?escopo=receber', dedupe: `fin-receber-${today}` });
  for (const i of (await stockItems()).filter((x) => x.active && ['comprar', 'acabou'].includes(x.state))) {
    await require('./notify').notify({ type: 'financeiro', broadcast: true, title: `Estoque: ${i.name} ${i.state === 'acabou' ? 'acabou' : 'precisa ser reposto'}`, body: i.runs_out ? `Dura até ~${i.runs_out.split('-').reverse().join('/')} (${i.qty} ${i.unit}).` : `Restam ${i.qty} ${i.unit}.`, url: '/financeiro/estoque', dedupe: `fin-estoque-${i.id}-${monthOf(today)}` });
  }
}

module.exports = {
  todayISO, addDays, addMonths, monthOf, monthLabel, monthShortLabel, shiftMonth, iso, settings,
  syncGuest, onGuestDeleted, onEpisodeDeleted, onSponsorDeleted, onEpisodeCreated, onEpisodeStage, onEpisodeDates, recomputeStudio, setDuration, consumeStock,
  ensureRecurring, planSponsorPayment, sponsorSummary, afterPaid,
  stockItems, stockMoves, buyStock, forecast, STOCK_STATE,
  entries, counts, overview, cashNow, costPerEpisode, episodeFinance, tick, toEntry,
};
