// Financeiro do podcast: contas a pagar e a receber, custos que nascem sozinhos com o episódio (estúdio, regras e custos
// mensais), parcelas de patrocínio e estoque com previsão de reposição. Tudo que é automático usa `auto_key` (único):
// rodar de novo nunca lança duas vezes.
const db = require('../db/pool');
const C = require('../constants');
const owner = require('./finOwner');
const projects = require('./projects');

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
    opening_on: iso(s.opening_on), studio_bank_alert_hours: Number(s.studio_bank_alert_hours), studio_bank_start_on: iso(s.studio_bank_start_on),
  };
}

// ---------------------------------------------------------------- lançamentos automáticos
// Cria o lançamento automático; se já existe, só reativa o que o próprio sistema cancelou e (opcional) refaz o vencimento.
// `projectId` é de quem é o custo: vem do episódio ou do convidado que disparou (quem chama já sabe).
async function upsertAuto(e) {
  const { rows: [row] } = await db.query(
    `INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, supplier, episode_id, guest_id, sponsor_id, stock_item_id, rule_id, recurring_id, source, auto_key, project_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$16)
     ON CONFLICT (auto_key) DO UPDATE SET
       status = CASE WHEN fin_entries.status = 'cancelado' AND fin_entries.cancel_reason = 'sistema' THEN 'previsto' ELSE fin_entries.status END,
       cancel_reason = CASE WHEN fin_entries.status = 'cancelado' AND fin_entries.cancel_reason = 'sistema' THEN NULL ELSE fin_entries.cancel_reason END,
       due_on = CASE WHEN $15 AND fin_entries.status IN ('previsto') THEN EXCLUDED.due_on ELSE fin_entries.due_on END,
       episode_id = coalesce(EXCLUDED.episode_id, fin_entries.episode_id),
       project_id = CASE WHEN fin_entries.project_id IS NULL THEN fin_entries.project_id ELSE coalesce(EXCLUDED.project_id, fin_entries.project_id) END, updated_at = now()
     RETURNING *`,
    [e.direction || 'saida', e.category, String(e.description).slice(0, 200), e.amount, e.due, e.supplier || null, e.episodeId || null, e.guestId || null, e.sponsorId || null,
      e.stockItemId || null, e.ruleId || null, e.recurringId || null, e.source || 'regra', e.key, Boolean(e.refreshDue), e.projectId || projects.defaultId()]);
  return row;
}

const cancelBySystem = (where, params) => db.query(
  `UPDATE fin_entries SET status = 'cancelado', cancel_reason = 'sistema', updated_at = now() WHERE status = 'previsto' AND ${where}`, params);

// Quando vence uma regra: âncora + dias. Sem a data da âncora, vale o dia do gatilho.
function dueFor(rule, { recordedOn = null, airedOn = null } = {}) {
  const base = rule.anchor === 'gravacao' ? recordedOn : rule.anchor === 'veiculacao' ? airedOn : null;
  return addDays(base || todayISO(), Number(rule.offset_days) || 0);
}

// Regra sem projeto vale em todos; com projeto, só nos vídeos e convidados dele.
async function rulesFor(trigger, projectId = null) {
  const { rows } = await db.query(
    'SELECT * FROM fin_rules WHERE active AND trigger = $1 AND (project_id IS NULL OR project_id = $2) ORDER BY id', [trigger, projectId]);
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
  if (s.studio_mode === 'banco') { // banco de horas: a gravação marcada só reserva horas; sinal em aberto sai
    await cancelBySystem('auto_key = $1', [`estudio-sinal-g${guestId}`]);
  } else if (s.studio_deposit_cents > 0) {
    await upsertAuto({ key: `estudio-sinal-g${guestId}`, category: 'estudio', description: `Estúdio · sinal da reserva (${guest.name})`, amount: s.studio_deposit_cents, due: todayISO(), guestId, source: 'estudio', projectId: guest.project_id });
  }
  for (const r of await rulesFor('gravacao_agendada', guest.project_id)) {
    await upsertAuto({ key: `regra-${r.id}-g${guestId}`, category: r.category, description: `${r.name} (${guest.name})`, amount: r.amount_cents, due: dueFor(r, { recordedOn }), supplier: r.supplier, guestId, ruleId: r.id, refreshDue: r.anchor === 'gravacao', projectId: guest.project_id });
  }
}

// ---- estúdio: sinal + saldo (duração × hora) + horas extras se a gravação passou do combinado.
// Com o banco de horas ligado, episódio do banco não gera nada (as horas saem do pacote, services/hourBank.js).
async function recomputeStudio(episodeId) {
  const { rows: [ep] } = await db.query('SELECT * FROM episodes WHERE id = $1', [episodeId]);
  if (!ep) return;
  const s = await settings();
  if (s.studio_mode === 'banco' && await require('./hourBank').isBankEpisode(ep)) { // gravação do banco de horas: nada por episódio
    await cancelBySystem("episode_id = $1 AND auto_key LIKE 'estudio-%'", [episodeId]);
    return;
  }
  if (s.studio_mode === 'banco') { // saiu do banco (a data mudou para antes do início): o sinal que o sistema cancelou volta
    await db.query("UPDATE fin_entries SET status = 'previsto', cancel_reason = NULL, updated_at = now() WHERE episode_id = $1 AND auto_key LIKE 'estudio-sinal-%' AND status = 'cancelado' AND cancel_reason = 'sistema'", [episodeId]);
  }
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
    if (balance > 0) await upsertAuto({ key: `estudio-saldo-e${episodeId}`, category: 'estudio', description: `Estúdio · saldo da gravação (${label})`, amount: balance, due, episodeId, source: 'estudio', projectId: ep.project_id });
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
      else await upsertAuto({ key: `estudio-extra-e${episodeId}`, category: 'estudio', description: `Estúdio · horas extras (${label})`, amount: extra, due: todayISO(), episodeId, source: 'estudio', projectId: ep.project_id });
    } else {
      await cancelBySystem('auto_key = $1', [`estudio-extra-e${episodeId}`]);
    }
  }
}

// ---- estoque: o episódio gravado consome o que cada item gasta por episódio
// Só o que é do projeto do vídeo, ou compartilhado (a caneca do Pulso não sai num vídeo do Projeto 100).
async function consumeStock(episodeId) {
  const { rows: items } = await db.query(
    `SELECT i.* FROM fin_stock_items i, episodes e WHERE e.id = $1 AND i.active AND i.per_episode > 0
        AND (i.project_id IS NULL OR i.project_id = e.project_id)`, [episodeId]);
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
  for (const r of await rulesFor('episodio_gravado', ep.project_id)) {
    await upsertAuto({ key: `regra-${r.id}-e${ep.id}`, category: r.category, description: `${r.name} · ${epLabel(ep)}`, amount: r.amount_cents, due: dueFor(r, { recordedOn, airedOn: iso(ep.aired_on) }), supplier: r.supplier, episodeId: ep.id, ruleId: r.id, refreshDue: r.anchor !== 'gatilho', projectId: ep.project_id });
  }
  await consumeStock(ep.id);
  await syncHourBank();
}

const epLabel = (ep) => `${ep.number ? `EP.${String(ep.number).padStart(3, '0')}` : 'Episódio'} ${ep.title || ''}`.trim();

// O que cada projeto gravou mudou: a divisão da compra de horas segue o uso, então ela é refeita (idempotente).
async function syncHourBank() {
  const bank = require('./hourBank');
  if (await bank.bankActive()) await bank.recomputeSplits();
}

async function onEpisodeStage(episodeId, stage) {
  if (stage !== 'publicado') return;
  const { rows: [ep] } = await db.query('SELECT * FROM episodes WHERE id = $1', [episodeId]);
  if (!ep) return;
  for (const r of await rulesFor('episodio_publicado', ep.project_id)) {
    await upsertAuto({ key: `regra-${r.id}-e${ep.id}`, category: r.category, description: `${r.name} · ${epLabel(ep)}`, amount: r.amount_cents, due: dueFor(r, { recordedOn: iso(ep.recorded_on), airedOn: iso(ep.aired_on) }), supplier: r.supplier, episodeId: ep.id, ruleId: r.id, refreshDue: true, projectId: ep.project_id });
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
  // Banco de horas ligado: a data pode ter levado o episódio para dentro ou para fora do banco, então refaz o estúdio (idempotente).
  // Só para quem já tem conta de estúdio (episódio importado do histórico continua sem nenhuma); no modo por hora nada muda.
  if ((await settings()).studio_mode !== 'banco') return;
  const { rows: [hasStudio] } = await db.query("SELECT 1 FROM fin_entries WHERE episode_id = $1 AND auto_key LIKE 'estudio-%' LIMIT 1", [ep.id]);
  if (hasStudio) await recomputeStudio(ep.id);
  await syncHourBank(); // a data pode ter trocado a ordem das gravações no banco
}

async function setDuration(episodeId, minutes) {
  await db.query('UPDATE episodes SET recording_minutes = $2, updated_at = now() WHERE id = $1', [episodeId, minutes]);
  await recomputeStudio(episodeId);
  await syncHourBank();
}

// Apagou o convidado, o episódio ou o patrocinador: o que ainda não foi pago e era automático sai da lista; o estoque volta.
const onGuestDeleted = (id) => cancelBySystem('guest_id = $1 AND episode_id IS NULL AND auto_key IS NOT NULL', [id]);
async function onEpisodeDeleted(id) {
  await cancelBySystem('episode_id = $1 AND auto_key IS NOT NULL', [id]);
  await db.query("DELETE FROM fin_stock_moves WHERE episode_id = $1 AND reason = 'episodio'", [id]);
  await syncHourBank();
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
      // o custo mensal não tem vínculo de onde herdar: o dono (ou a divisão) guardado nele vai para cada mês que nasce
      const { rows: [made1] } = await db.query(
        `INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, supplier, recurring_id, source, auto_key, project_id, account, account_person)
         VALUES ('saida',$1,$2,$3,$4,$5,$6,'mensal',$7,$8,$9,$10) ON CONFLICT (auto_key) DO NOTHING RETURNING id`,
        [r.category, `${r.name} · ${monthShortLabel(ym)}`, r.amount_cents, date, r.supplier, r.id, `mensal-${r.id}-${ym}`, r.project_id || (r.split ? null : projects.defaultId()),
          r.account || 'casa', r.account_person || null]);
      if (made1 && r.split) await owner.save(made1.id, { weights: r.split, amount: Number(r.amount_cents) });
      made += made1 ? 1 : 0;
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
      `INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, sponsor_id, installment_no, installments, source, created_by, project_id)
       VALUES ('entrada','patrocinio',$1,$2,$3,$4,$5,$6,'patrocinio',$7,$8)`,
      [`Patrocínio ${sponsor.company} · ${label}`, amount, addMonths(firstDue, i), sponsor.id, done.n + i + 1, done.n + n, userId, sponsor.project_id]);
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
// pids: só os itens desses projetos e os compartilhados (null = todos).
async function stockItems({ pids = null } = {}) {
  const s = await settings();
  const ids = pids ? pids.map(Number).filter(Number.isInteger) : null;
  const { rows } = await db.query(
    `SELECT i.*, coalesce((SELECT sum(qty) FROM fin_stock_moves m WHERE m.item_id = i.id), 0)::float AS qty,
            coalesce((SELECT sum(-qty) FROM fin_stock_moves m WHERE m.item_id = i.id AND m.reason = 'episodio' AND m.created_at > now() - interval '90 days'), 0)::float AS used90
       FROM fin_stock_items i ${ids ? 'WHERE i.project_id IS NULL OR i.project_id = ANY($1::int[])' : ''} ORDER BY i.active DESC, lower(i.name)`, ids ? [ids] : []);
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

// As últimas movimentações de vários itens numa consulta só: { itemId: [movs] } (a tela de estoque fazia uma por item).
async function stockMovesFor(itemIds, limit = 8) {
  const out = Object.fromEntries(itemIds.map((id) => [id, []]));
  if (!itemIds.length) return out;
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT m.*, e.number AS ep_number, e.title AS ep_title, e.project_id AS ep_project_id, u.name AS user_name,
              row_number() OVER (PARTITION BY m.item_id ORDER BY m.created_at DESC, m.id DESC) AS rn
         FROM fin_stock_moves m LEFT JOIN episodes e ON e.id = m.episode_id LEFT JOIN users u ON u.id = m.user_id
        WHERE m.item_id = ANY($1)) x
      WHERE rn <= $2 ORDER BY item_id, created_at DESC, id DESC`, [itemIds, limit]);
  for (const { rn, ...m } of rows) (out[m.item_id] ||= []).push({ ...m, qty: Number(m.qty) });
  return out;
}

async function stockMoves(itemId, limit = 8) {
  const { rows } = await db.query(
    `SELECT m.*, e.number AS ep_number, e.title AS ep_title, e.project_id AS ep_project_id, u.name AS user_name FROM fin_stock_moves m LEFT JOIN episodes e ON e.id = m.episode_id LEFT JOIN users u ON u.id = m.user_id
      WHERE m.item_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT $2`, [itemId, limit]);
  return rows.map((m) => ({ ...m, qty: Number(m.qty) }));
}

// Compra: entra no estoque (custo médio) e vira conta a pagar (à vista ou parcelada).
async function buyStock({ item, qty, totalCents, category = 'brindes', supplier = null, firstDue, installments = 1, paidNow = false, userId = null, projectId = null, weights = null }) {
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
      `INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, paid_on, status, supplier, stock_item_id, installment_no, installments, source, created_by, project_id)
       VALUES ('saida',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'estoque',$11,$12) RETURNING id`,
      [category, `Compra · ${item.name} (${q} ${item.unit})${n > 1 ? ` · parcela ${i + 1}/${n}` : ''}`, amount, addMonths(firstDue, i), paid ? todayISO() : null, paid ? 'pago' : 'previsto', supplier || item.supplier, item.id, n > 1 ? i + 1 : null, n > 1 ? n : null, userId, weights ? null : (projectId || projects.defaultId())]);
    if (weights) await owner.save(e.id, { weights, amount }); // compartilhado: cada parcela mantém a proporção
    if (i === 0) first = e.id;
  }
  await db.query("INSERT INTO fin_stock_moves (item_id, qty, reason, entry_id, unit_cost_cents, note, user_id) VALUES ($1,$2,'compra',$3,$4,$5,$6)", [item.id, q, first, unit, supplier || null, userId]);
  await db.query('UPDATE fin_stock_items SET unit_cost_cents = $2, supplier = coalesce($3, supplier) WHERE id = $1', [item.id, avg, supplier || null]);
}

// ---------------------------------------------------------------- consultas
// `share_cents` é quanto do lançamento conta no recorte: igual ao valor, menos no compartilhado visto por um projeto só.
const toEntry = (r) => ({
  ...r, amount_cents: Number(r.amount_cents), share_cents: Number(r.share_cents ?? r.amount_cents),
  due_on: iso(r.due_on), paid_on: iso(r.paid_on), shared: r.project_id == null,
});

// `pids`: projetos do recorte de quem está olhando. null = a casa toda (rotinas e páginas que já conferiram o acesso).
async function entries({ scope = 'pagar', month = null, q = '', category = '', episodeId = null, limit = 300, pids = null } = {}) {
  const p = []; const where = [];
  const add = (v) => { p.push(v); return `$${p.length}`; };
  const ph = pids ? add(pids) : null;
  if (ph) where.push(owner.where('e', ph));
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
    `SELECT e.*, ${ph ? owner.share('e', ph) : 'e.amount_cents'} AS share_cents,
            s.company AS sponsor_name, ep.number AS episode_number, ep.title AS episode_title, g.name AS guest_name
       FROM fin_entries e LEFT JOIN sponsors s ON s.id = e.sponsor_id LEFT JOIN episodes ep ON ep.id = e.episode_id LEFT JOIN guests g ON g.id = e.guest_id
      WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${Math.min(1000, limit)}`, p);
  return rows.map(toEntry);
}

async function counts({ pids = null } = {}) {
  const { rows: [r] } = await db.query(
    `SELECT count(*) FILTER (WHERE e.direction = 'saida' AND e.status = 'previsto')::int AS pagar,
            count(*) FILTER (WHERE e.direction = 'entrada' AND e.status = 'previsto')::int AS receber,
            count(*) FILTER (WHERE e.status = 'previsto' AND e.due_on < CURRENT_DATE)::int AS atrasados
       FROM fin_entries e WHERE ${pids ? owner.where('e', '$1') : 'true'}`, pids ? [pids] : []);
  return r;
}

// Caixa de hoje: saldo inicial + o que entrou e saiu desde a data do saldo inicial. O saldo inicial é da casa: num
// recorte de um projeto só ele não entra (o caixa que aparece é o movimento do projeto).
async function cashNow(s, { pids = null } = {}) {
  const p = [s.opening_on]; if (pids) p.push(pids);
  const whole = !pids || projects.all().every((pr) => pids.includes(pr.id)); // saldo inicial só no consolidado da casa
  const { rows: [r] } = await db.query(
    `SELECT coalesce(sum(CASE WHEN e.direction = 'entrada' THEN ${pids ? owner.share('e', '$2') : 'e.amount_cents'} ELSE -${pids ? owner.share('e', '$2') : 'e.amount_cents'} END), 0)::bigint AS v
       FROM fin_entries e WHERE e.status = 'pago' AND e.account = 'casa' AND ($1::date IS NULL OR e.paid_on >= $1::date) AND ${pids ? owner.where('e', '$2') : 'true'}`, p);
  return (whole ? s.opening_balance_cents : 0) + Number(r.v);
}

// Resumo: números do mês, o que pede atenção e a projeção dos próximos meses.
async function overview({ months = 4, pids = null } = {}) {
  const s = await settings();
  const today = todayISO();
  const ym = monthOf(today);
  const v = pids ? owner.share('e', '$3') : 'e.amount_cents';
  const only = pids ? ` AND ${owner.where('e', '$3')}` : '';
  const p3 = pids ? [ym, today, pids] : [ym, today];
  const [{ rows: [m] }, { rows: attention }, { rows: pend }, cash, perEp, byProject] = await Promise.all([
    db.query(
      `SELECT coalesce(sum(${v}) FILTER (WHERE e.direction = 'entrada' AND e.status = 'pago' AND e.category <> 'acerto' AND to_char(e.paid_on,'YYYY-MM') = $1), 0)::bigint AS in_paid,
              coalesce(sum(${v}) FILTER (WHERE e.direction = 'saida' AND e.status = 'pago' AND e.category <> 'acerto' AND to_char(e.paid_on,'YYYY-MM') = $1), 0)::bigint AS out_paid,
              coalesce(sum(${v}) FILTER (WHERE e.direction = 'entrada' AND e.status = 'previsto' AND e.account = 'casa' AND e.due_on <= (date_trunc('month', $2::date) + interval '1 month - 1 day')::date), 0)::bigint AS in_open,
              coalesce(sum(${v}) FILTER (WHERE e.direction = 'saida' AND e.status = 'previsto' AND e.account = 'casa' AND e.due_on <= (date_trunc('month', $2::date) + interval '1 month - 1 day')::date), 0)::bigint AS out_open,
              coalesce(sum(${v}) FILTER (WHERE e.status = 'previsto' AND e.account = 'casa' AND e.due_on < $2::date AND e.direction = 'saida'), 0)::bigint AS late_out,
              coalesce(sum(${v}) FILTER (WHERE e.status = 'previsto' AND e.account = 'casa' AND e.due_on < $2::date AND e.direction = 'entrada'), 0)::bigint AS late_in,
              coalesce(sum(${v}) FILTER (WHERE e.status = 'previsto' AND e.account = 'casa' AND e.direction = 'saida' AND e.due_on BETWEEN $2::date AND ($2::date + 7)), 0)::bigint AS out_7
         FROM fin_entries e WHERE true${only}`, p3),
    db.query(
      `SELECT e.*, ${pids ? owner.share('e', '$2') : 'e.amount_cents'} AS share_cents, s.company AS sponsor_name, ep.number AS episode_number, ep.title AS episode_title, g.name AS guest_name FROM fin_entries e
         LEFT JOIN sponsors s ON s.id = e.sponsor_id LEFT JOIN episodes ep ON ep.id = e.episode_id LEFT JOIN guests g ON g.id = e.guest_id
        WHERE e.status = 'previsto' AND e.account = 'casa' AND e.due_on <= ($1::date + 7)${pids ? ` AND ${owner.where('e', '$2')}` : ''} ORDER BY e.due_on, e.id LIMIT 6`, pids ? [today, pids] : [today]),
    db.query(`SELECT e.direction, ${pids ? owner.share('e', '$1') : 'e.amount_cents'} AS amount_cents, e.due_on FROM fin_entries e WHERE e.status = 'previsto' AND e.account = 'casa'${pids ? ` AND ${owner.where('e', '$1')}` : ''}`, pids ? [pids] : []),
    cashNow(s, { pids }),
    costPerEpisode(6, { pids }),
    resultByProject({ pids, ym }),
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
  const stock = (await stockItems({ pids })).filter((i) => i.active && ['comprar', 'acabou', 'atencao'].includes(i.state));
  return {
    month: { ym, label: monthLabel(ym), in_paid: Number(m.in_paid), out_paid: Number(m.out_paid), in_open: Number(m.in_open), out_open: Number(m.out_open), result: Number(m.in_paid) - Number(m.out_paid) },
    late: { out: Number(m.late_out), in: Number(m.late_in) }, out7: Number(m.out_7), cash, attention: attention.map(toEntry), forecast: forecastRows, stock, perEpisode: perEp, settings: s, byProject,
  };
}

// Resultado do mês por projeto: o que é dele mais a parte dele nos compartilhados. Só aparece com mais de um projeto à vista.
async function resultByProject({ pids = null, ym = monthOf(todayISO()) } = {}) {
  const ids = pids || projects.all().map((p) => p.id);
  if (ids.length < 2) return [];
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.sigla,
            coalesce(sum(part.cents) FILTER (WHERE part.direction = 'entrada'), 0)::bigint AS in_paid,
            coalesce(sum(part.cents) FILTER (WHERE part.direction = 'saida'), 0)::bigint AS out_paid,
            coalesce(sum(part.cents) FILTER (WHERE part.direction = 'saida' AND part.shared), 0)::bigint AS shared_out
       FROM projects p
       LEFT JOIN (
         SELECT e.project_id AS pid, e.direction, e.amount_cents AS cents, false AS shared FROM fin_entries e
          WHERE e.status = 'pago' AND e.category <> 'acerto' AND to_char(e.paid_on, 'YYYY-MM') = $1 AND e.project_id IS NOT NULL
         UNION ALL
         SELECT s.project_id AS pid, e.direction, s.amount_cents AS cents, true AS shared
           FROM fin_entry_splits s JOIN fin_entries e ON e.id = s.entry_id
          WHERE e.status = 'pago' AND e.category <> 'acerto' AND to_char(e.paid_on, 'YYYY-MM') = $1
       ) part ON part.pid = p.id
      WHERE p.id = ANY($2::int[]) GROUP BY p.id, p.name, p.sigla, p.position ORDER BY p.position, p.id`, [ym, ids]);
  return rows.map((r) => ({
    ...r, in_paid: Number(r.in_paid), out_paid: Number(r.out_paid), shared_out: Number(r.shared_out), result: Number(r.in_paid) - Number(r.out_paid),
  }));
}

// Custo de cada episódio (lançamentos ligados a ele + material de estoque usado) e a média.
async function costPerEpisode(limit = 6, { pids = null } = {}) {
  const p = [limit]; if (pids) p.push(pids);
  const { rows } = await db.query(
    `SELECT e.id, e.number, e.title, e.recorded_on, e.project_id,
            coalesce((SELECT sum(${pids ? owner.share('f', '$2') : 'f.amount_cents'}) FROM fin_entries f WHERE f.episode_id = e.id AND f.direction = 'saida' AND f.status <> 'cancelado'), 0)::bigint AS costs,
            coalesce((SELECT sum(-m.qty * m.unit_cost_cents) FROM fin_stock_moves m WHERE m.episode_id = e.id AND m.reason = 'episodio'), 0)::float AS stock
       FROM episodes e ${pids ? 'WHERE e.project_id = ANY($2::int[])' : ''} ORDER BY e.number DESC NULLS LAST, e.id DESC LIMIT $1`, p);
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
// Um aviso por projeto (quem vê o financeiro dele recebe), mais os da casa: estoque e banco de horas.
async function tick() {
  const today = todayISO();
  await ensureRecurring(3);
  const notify = require('./notify').notify;
  for (const p of projects.all()) {
    const { rows: due } = await db.query(
      `SELECT e.direction, count(*)::int AS n, coalesce(sum(${owner.share('e', '$2')}),0)::bigint AS total, count(*) FILTER (WHERE e.due_on < $1)::int AS late
         FROM fin_entries e WHERE e.status = 'previsto' AND e.due_on <= ($1::date + 3) AND ${owner.where('e', '$2')} GROUP BY e.direction`, [today, [p.id]]);
    const sigla = projects.all().length > 1 ? ` · ${p.sigla}` : '';
    const out = due.find((d) => d.direction === 'saida');
    if (out && out.n) {
      const late = out.late ? `${out.late} atrasada${out.late > 1 ? 's' : ''} · ` : '';
      await notify({ type: 'financeiro', broadcast: true, projectId: p.id, title: `${out.n} conta${out.n > 1 ? 's' : ''} a pagar até 3 dias${sigla}`, body: `${late}${(Number(out.total) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, url: '/financeiro/lancamentos', dedupe: `fin-pagar-${p.id}-${today}` });
    }
    const inn = due.find((d) => d.direction === 'entrada' && d.late > 0);
    if (inn) await notify({ type: 'financeiro', broadcast: true, projectId: p.id, title: `${inn.late} recebimento${inn.late > 1 ? 's' : ''} em atraso${sigla}`, body: 'Confira os patrocínios com parcela vencida.', url: '/financeiro/lancamentos?escopo=receber', dedupe: `fin-receber-${p.id}-${today}` });
  }
  try { await require('./hourBank').tick(); } catch (err) { console.error('Banco de horas (aviso):', err.message); }
  for (const i of (await stockItems()).filter((x) => x.active && ['comprar', 'acabou'].includes(x.state))) {
    await require('./notify').notify({ type: 'financeiro', broadcast: true, ...(i.project_id ? { projectId: i.project_id } : { house: true }), title: `Estoque: ${i.name} ${i.state === 'acabou' ? 'acabou' : 'precisa ser reposto'}`, body: i.runs_out ? `Dura até ~${i.runs_out.split('-').reverse().join('/')} (${i.qty} ${i.unit}).` : `Restam ${i.qty} ${i.unit}.`, url: '/financeiro/estoque', dedupe: `fin-estoque-${i.id}-${monthOf(today)}` });
  }
}

module.exports = {
  todayISO, addDays, addMonths, monthOf, monthLabel, monthShortLabel, shiftMonth, iso, settings,
  syncGuest, onGuestDeleted, onEpisodeDeleted, onSponsorDeleted, onEpisodeCreated, onEpisodeStage, onEpisodeDates, recomputeStudio, setDuration, consumeStock,
  ensureRecurring, planSponsorPayment, sponsorSummary, afterPaid,
  stockItems, stockMoves, stockMovesFor, buyStock, forecast, STOCK_STATE,
  entries, counts, overview, cashNow, costPerEpisode, episodeFinance, resultByProject, tick, toEntry, syncHourBank,
};
