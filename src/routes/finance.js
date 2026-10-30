// Financeiro: resumo e caixa, contas a pagar e a receber, estoque e regras de custo automático.
const express = require('express');
const db = require('../db/pool');
const C = require('../constants');
const fin = require('../services/finance');
const { audit } = require('../services/audit');
const { requirePerm } = require('../middleware');
const { can } = require('../permissions');
const { clean, parseBRL, parseInputDate, formatBRL, formatDay } = require('../utils/format');
const { wrap, isIntId } = require('../utils/wrap');

const router = express.Router();
const notFound = (res, what = 'Registro') => res.status(404).render('error', { title: 'Não encontrado', message: `${what} não encontrado.` });
const text = (v, n) => String(v ?? '').replace(/\r/g, '').trim().slice(0, n) || null;
const num = (v) => { const raw = String(v ?? '').trim(); const n = Number(/,/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw); return Number.isFinite(n) ? n : NaN; };
// Só volta para caminhos do próprio painel.
const backTo = (req, fallback) => { const b = String(req.body.voltar || ''); return /^\/[A-Za-z0-9\-_/?=&%.#]*$/.test(b) && !b.startsWith('//') ? b : fallback; };
const money = (c) => formatBRL(c);

// ---------------------------------------------------------------- resumo
router.get('/financeiro', requirePerm('finance.read'), wrap(async (req, res) => {
  await fin.ensureRecurring(3);
  const [ov, counts] = await Promise.all([fin.overview(), fin.counts()]);
  res.render('finance/index', { title: 'Financeiro', ov, counts, fin, C, money, today: fin.todayISO(), here: req.originalUrl, ...(await pickers()) });
}));

// Listas usadas nos modais (episódios recentes e patrocinadores).
async function pickers() {
  const [episodes, sponsors, suppliers] = await Promise.all([
    db.query('SELECT id, number, title FROM episodes ORDER BY number DESC NULLS LAST, id DESC LIMIT 80'),
    db.query("SELECT id, company FROM sponsors WHERE stage <> 'perdido' ORDER BY lower(company)"),
    db.query('SELECT DISTINCT supplier FROM fin_entries WHERE supplier IS NOT NULL ORDER BY supplier LIMIT 100'),
  ]);
  return { episodes: episodes.rows, sponsors: sponsors.rows, suppliers: suppliers.rows.map((r) => r.supplier) };
}

// ---------------------------------------------------------------- lançamentos
const SCOPES = { pagar: 'A pagar', receber: 'A receber', historico: 'Histórico' };

router.get('/financeiro/lancamentos', requirePerm('finance.read'), wrap(async (req, res) => {
  const scope = SCOPES[req.query.escopo] ? req.query.escopo : 'pagar';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.mes || '')) ? req.query.mes : fin.monthOf(fin.todayISO());
  const q = String(req.query.q || '').slice(0, 80);
  const category = C.FIN_CATEGORIES[req.query.cat] ? req.query.cat : '';
  const [items, counts, pick] = await Promise.all([
    fin.entries({ scope, month: scope === 'historico' ? month : null, q, category }), fin.counts(), pickers(),
  ]);
  const totals = items.reduce((a, e) => { if (e.status !== 'cancelado') a[e.direction === 'entrada' ? 'in' : 'out'] += e.amount_cents; return a; }, { in: 0, out: 0 });
  res.render('finance/entries', { title: 'Contas a pagar e receber', here: req.originalUrl, scope, scopes: SCOPES, month, q, category, items, counts, totals, today: fin.todayISO(), fin, C, money, ...pick });
}));

function parseEntry(body, { create = false } = {}) {
  const direction = body.direction === 'entrada' ? 'entrada' : 'saida';
  const cats = direction === 'entrada' ? C.FIN_IN : C.FIN_OUT;
  const amount = parseBRL(body.amount);
  const due = parseInputDate(body.due_on);
  const v = {
    direction, category: cats[body.category] ? body.category : (direction === 'entrada' ? 'outros_in' : 'outros'),
    description: clean(body.description, 200), amount, due, supplier: text(body.supplier, 120), notes: text(body.notes, 1000),
    episode_id: isIntId(body.episode_id) ? Number(body.episode_id) : null,
    sponsor_id: isIntId(body.sponsor_id) ? Number(body.sponsor_id) : null,
    installments: create ? Math.max(1, Math.min(24, Number.parseInt(body.installments, 10) || 1)) : 1,
    paid: body.paid === '1',
  };
  if (v.description.length < 2) return { error: 'Escreva o que é este lançamento.' };
  if (amount == null || Number.isNaN(amount) || amount <= 0) return { error: 'Valor inválido. Use algo como 150,00.' };
  if (!due || Number.isNaN(due)) return { error: 'Informe a data de vencimento.' };
  return { v };
}

router.post('/financeiro/lancamentos', requirePerm('finance.write'), wrap(async (req, res) => {
  const { v, error } = parseEntry(req.body, { create: true });
  const to = backTo(req, '/financeiro/lancamentos');
  if (error) { await req.flash('error', error); return res.redirect(to); }
  const base = Math.floor(v.amount / v.installments);
  for (let i = 0; i < v.installments; i += 1) {
    const amount = i === v.installments - 1 ? v.amount - base * (v.installments - 1) : base;
    const paidNow = v.paid && i === 0;
    await db.query(
      `INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, paid_on, status, supplier, notes, episode_id, sponsor_id, installment_no, installments, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'manual',$14)`,
      [v.direction, v.category, v.installments > 1 ? `${v.description} · parcela ${i + 1}/${v.installments}` : v.description, amount, fin.addMonths(v.due, i),
        paidNow ? fin.todayISO() : null, paidNow ? 'pago' : 'previsto', v.supplier, v.notes, v.episode_id, v.sponsor_id, v.installments > 1 ? i + 1 : null, v.installments > 1 ? v.installments : null, req.user.id]);
  }
  await audit(req, 'financeiro.lancado', 'fin_entry', null, { description: v.description, amount: v.amount, parcelas: v.installments });
  await req.flash('ok', v.installments > 1 ? `${v.installments} parcelas lançadas.` : 'Lançamento criado.');
  res.redirect(to);
}));

async function findEntry(id) {
  if (!isIntId(id)) return null;
  const { rows: [e] } = await db.query('SELECT * FROM fin_entries WHERE id = $1', [id]);
  return e || null;
}

router.post('/financeiro/lancamentos/:id', requirePerm('finance.write'), wrap(async (req, res) => {
  const e = await findEntry(req.params.id);
  if (!e) return notFound(res, 'Lançamento');
  const { v, error } = parseEntry({ ...req.body, direction: e.direction });
  const to = backTo(req, '/financeiro/lancamentos');
  if (error) { await req.flash('error', error); return res.redirect(to); }
  await db.query(
    `UPDATE fin_entries SET category=$2, description=$3, amount_cents=$4, due_on=$5, supplier=$6, notes=$7, episode_id=$8, sponsor_id=$9, updated_at=now() WHERE id=$1`,
    [e.id, v.category, v.description, v.amount, v.due, v.supplier, v.notes, v.episode_id, v.sponsor_id]);
  await audit(req, 'financeiro.editado', 'fin_entry', e.id, { description: v.description });
  await req.flash('ok', 'Lançamento atualizado.');
  res.redirect(to);
}));

router.post('/financeiro/lancamentos/:id/pagar', requirePerm('finance.write'), wrap(async (req, res) => {
  const e = await findEntry(req.params.id);
  if (!e) return notFound(res, 'Lançamento');
  const to = backTo(req, '/financeiro/lancamentos');
  if (e.status === 'pago') { await req.flash('error', 'Este lançamento já está quitado.'); return res.redirect(to); }
  let paidOn = parseInputDate(req.body.paid_on) || fin.todayISO();
  if (Number.isNaN(paidOn)) paidOn = fin.todayISO();
  let amount = parseBRL(req.body.amount);
  if (amount == null) amount = Number(e.amount_cents);
  if (Number.isNaN(amount) || amount < 0) { await req.flash('error', 'Valor inválido.'); return res.redirect(to); }
  const { rows: [done] } = await db.query("UPDATE fin_entries SET status='pago', paid_on=$2, amount_cents=$3, cancel_reason=NULL, updated_at=now() WHERE id=$1 RETURNING *", [e.id, paidOn, amount]);
  await fin.afterPaid(done, req.user.id);
  if (done.auto_key && /^estudio-saldo-e/.test(done.auto_key) && done.episode_id) await fin.recomputeStudio(done.episode_id); // pode ter sobrado hora extra
  await audit(req, e.direction === 'entrada' ? 'financeiro.recebido' : 'financeiro.pago', 'fin_entry', e.id, { amount });
  await req.flash('ok', e.direction === 'entrada' ? 'Recebimento registrado.' : 'Pagamento registrado.');
  res.redirect(to);
}));

router.post('/financeiro/lancamentos/:id/desfazer', requirePerm('finance.write'), wrap(async (req, res) => {
  const e = await findEntry(req.params.id);
  if (!e) return notFound(res, 'Lançamento');
  await db.query("UPDATE fin_entries SET status='previsto', paid_on=NULL, cancel_reason=NULL, updated_at=now() WHERE id=$1", [e.id]);
  await audit(req, 'financeiro.reaberto', 'fin_entry', e.id);
  await req.flash('ok', 'Lançamento voltou para em aberto.');
  res.redirect(backTo(req, '/financeiro/lancamentos?escopo=historico'));
}));

router.post('/financeiro/lancamentos/:id/cancelar', requirePerm('finance.write'), wrap(async (req, res) => {
  const e = await findEntry(req.params.id);
  if (!e) return notFound(res, 'Lançamento');
  if (e.status === 'pago') { await req.flash('error', 'Desfaça o pagamento antes de cancelar.'); return res.redirect(backTo(req, '/financeiro/lancamentos')); }
  await db.query("UPDATE fin_entries SET status='cancelado', cancel_reason='usuario', updated_at=now() WHERE id=$1", [e.id]);
  await audit(req, 'financeiro.cancelado', 'fin_entry', e.id);
  await req.flash('ok', 'Lançamento cancelado.');
  res.redirect(backTo(req, '/financeiro/lancamentos'));
}));

router.post('/financeiro/lancamentos/:id/excluir', requirePerm('finance.write'), wrap(async (req, res) => {
  const e = await findEntry(req.params.id);
  if (!e) return notFound(res, 'Lançamento');
  const to = backTo(req, '/financeiro/lancamentos');
  if (e.status === 'pago' || e.auto_key) { await req.flash('error', e.status === 'pago' ? 'Desfaça o pagamento antes de excluir.' : 'Lançamento automático não se exclui: cancele.'); return res.redirect(to); }
  const t = await require('../services/trash').remove('fin_entry', e.id, { user: req.user });
  await audit(req, 'financeiro.excluido', 'fin_entry', e.id, { description: e.description });
  await req.flash('ok', 'Lançamento na lixeira.', t && { undo: t.batch });
  res.redirect(to);
}));

// Planilha para o contador: UTF-8 com BOM e ";" (abre direto no Excel em português).
router.get('/financeiro/exportar.csv', requirePerm('finance.read'), wrap(async (req, res) => {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.mes || '')) ? req.query.mes : null;
  const { rows } = await db.query(
    `SELECT e.*, s.company AS sponsor_name, ep.number AS episode_number, ep.title AS episode_title FROM fin_entries e
       LEFT JOIN sponsors s ON s.id = e.sponsor_id LEFT JOIN episodes ep ON ep.id = e.episode_id
      WHERE e.status <> 'cancelado' AND ($1::text IS NULL OR to_char(coalesce(e.paid_on, e.due_on), 'YYYY-MM') = $1)
      ORDER BY coalesce(e.paid_on, e.due_on), e.id`, [month]);
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t]/.test(s)) s = `'${s}`; return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [['Data', 'Vencimento', 'Situação', 'Tipo', 'Categoria', 'Descrição', 'Fornecedor', 'Valor (R$)', 'Episódio', 'Patrocinador'].join(';')];
  for (const r of rows) {
    const e = fin.toEntry(r);
    lines.push([formatDay(e.paid_on || e.due_on), formatDay(e.due_on), e.status === 'pago' ? (e.direction === 'entrada' ? 'Recebido' : 'Pago') : 'Em aberto',
      e.direction === 'entrada' ? 'Entrada' : 'Saída', C.FIN_CATEGORIES[e.category] || e.category, e.description, e.supplier || '',
      ((e.direction === 'entrada' ? 1 : -1) * e.amount_cents / 100).toFixed(2).replace('.', ','), e.episode_number ? `EP.${String(e.episode_number).padStart(3, '0')}` : '', e.sponsor_name || ''].map(cell).join(';'));
  }
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="financeiro-${month || 'tudo'}.csv"` });
  res.send(`﻿${lines.join('\r\n')}\r\n`);
}));

// ---------------------------------------------------------------- estoque
router.get('/financeiro/estoque', requirePerm('stock.read'), wrap(async (req, res) => {
  const items = await fin.stockItems();
  for (const i of items) i.moves = await fin.stockMoves(i.id, 6);
  const showItems = req.query.arquivados === '1' ? items : items.filter((i) => i.active);
  res.render('finance/stock', { title: 'Estoque', items: showItems, archived: items.filter((i) => !i.active).length, showArchived: req.query.arquivados === '1', settings: await fin.settings(), fin, C, money, counts: can(req.user.role, 'finance.read') ? await fin.counts() : null });
}));

function parseItem(body) {
  const per = num(body.per_episode || 0); const min = num(body.min_qty || 0); const lead = Number.parseInt(body.lead_days, 10);
  const v = {
    name: clean(body.name, 80), unit: clean(body.unit, 20) || 'un', per_episode: per, min_qty: min,
    lead_days: Number.isInteger(lead) && lead >= 0 && lead <= 365 ? lead : 15, supplier: text(body.supplier, 120), notes: text(body.notes, 500),
  };
  if (v.name.length < 2) return { error: 'Dê um nome ao item.' };
  if (!(per >= 0) || !(min >= 0) || per > 9999 || min > 99999) return { error: 'Quantidades inválidas.' };
  return { v };
}

router.post('/financeiro/estoque', requirePerm('stock.write'), wrap(async (req, res) => {
  const { v, error } = parseItem(req.body);
  if (error) { await req.flash('error', error); return res.redirect('/financeiro/estoque'); }
  const cost = parseBRL(req.body.unit_cost);
  const qty = req.body.qty ? num(req.body.qty) : 0;
  if (!(qty >= 0) || (cost != null && Number.isNaN(cost))) { await req.flash('error', 'Quantidade ou custo inválido.'); return res.redirect('/financeiro/estoque'); }
  const { rows: [it] } = await db.query(
    'INSERT INTO fin_stock_items (name, unit, per_episode, min_qty, lead_days, supplier, notes, unit_cost_cents) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [v.name, v.unit, v.per_episode, v.min_qty, v.lead_days, v.supplier, v.notes, cost || 0]);
  if (qty > 0) await db.query("INSERT INTO fin_stock_moves (item_id, qty, reason, unit_cost_cents, note, user_id) VALUES ($1,$2,'ajuste',$3,'Saldo inicial',$4)", [it.id, qty, cost || 0, req.user.id]);
  await audit(req, 'estoque.item_criado', 'fin_stock_item', it.id, { name: v.name });
  await req.flash('ok', `${v.name} adicionado ao estoque.`);
  res.redirect('/financeiro/estoque');
}));

async function findItem(id) {
  if (!isIntId(id)) return null;
  const { rows: [i] } = await db.query('SELECT * FROM fin_stock_items WHERE id = $1', [id]);
  return i || null;
}

router.post('/financeiro/estoque/:id', requirePerm('stock.write'), wrap(async (req, res) => {
  const it = await findItem(req.params.id);
  if (!it) return notFound(res, 'Item');
  const { v, error } = parseItem(req.body);
  if (error) { await req.flash('error', error); return res.redirect('/financeiro/estoque'); }
  await db.query('UPDATE fin_stock_items SET name=$2, unit=$3, per_episode=$4, min_qty=$5, lead_days=$6, supplier=$7, notes=$8, active=$9 WHERE id=$1',
    [it.id, v.name, v.unit, v.per_episode, v.min_qty, v.lead_days, v.supplier, v.notes, req.body.active !== '0']);
  await audit(req, 'estoque.item_editado', 'fin_stock_item', it.id, { name: v.name });
  await req.flash('ok', 'Item atualizado.');
  res.redirect('/financeiro/estoque');
}));

router.post('/financeiro/estoque/:id/comprar', requirePerm('finance.write'), wrap(async (req, res) => {
  const it = await findItem(req.params.id);
  if (!it) return notFound(res, 'Item');
  const qty = num(req.body.qty); const total = parseBRL(req.body.total); let due = parseInputDate(req.body.due_on) || fin.todayISO();
  if (Number.isNaN(due)) due = fin.todayISO();
  if (!(qty > 0) || total == null || Number.isNaN(total) || total <= 0) { await req.flash('error', 'Informe a quantidade e o valor total da compra.'); return res.redirect('/financeiro/estoque'); }
  await fin.buyStock({
    item: { ...it, unit_cost_cents: Number(it.unit_cost_cents) }, qty, totalCents: total, category: C.FIN_OUT[req.body.category] ? req.body.category : 'brindes',
    supplier: text(req.body.supplier, 120), firstDue: due, installments: req.body.installments, paidNow: req.body.paid === '1', userId: req.user.id,
  });
  await audit(req, 'estoque.compra', 'fin_stock_item', it.id, { qty, total });
  await req.flash('ok', `Compra de ${qty} ${it.unit} de ${it.name} registrada: entrou no estoque e foi para as contas a pagar.`);
  res.redirect('/financeiro/estoque');
}));

router.post('/financeiro/estoque/:id/ajustar', requirePerm('stock.write'), wrap(async (req, res) => {
  const it = await findItem(req.params.id);
  if (!it) return notFound(res, 'Item');
  const qty = num(req.body.qty);
  const action = ['contagem', 'perda', 'brinde', 'entrada'].includes(req.body.acao) ? req.body.acao : null;
  if (!action || !(qty >= 0) || (action !== 'contagem' && qty === 0)) { await req.flash('error', 'Informe a quantidade.'); return res.redirect('/financeiro/estoque'); }
  const { rows: [{ have }] } = await db.query('SELECT coalesce(sum(qty),0)::float AS have FROM fin_stock_moves WHERE item_id = $1', [it.id]);
  let delta = 0; let reason = 'ajuste';
  if (action === 'contagem') delta = qty - have;
  else if (action === 'entrada') delta = qty;
  else { delta = -qty; reason = action; }
  if (Math.abs(delta) < 0.005) { await req.flash('ok', 'O saldo já estava certo.'); return res.redirect('/financeiro/estoque'); }
  await db.query('INSERT INTO fin_stock_moves (item_id, qty, reason, unit_cost_cents, note, user_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [it.id, Math.round(delta * 100) / 100, reason, it.unit_cost_cents, text(req.body.note, 200) || (action === 'contagem' ? 'Contagem do estoque' : null), req.user.id]);
  await audit(req, 'estoque.ajuste', 'fin_stock_item', it.id, { action, qty });
  await req.flash('ok', 'Estoque atualizado.');
  res.redirect('/financeiro/estoque');
}));

// ---------------------------------------------------------------- regras e custos mensais
router.get('/financeiro/regras', requirePerm('finance.read'), wrap(async (req, res) => {
  const [rules, recurring, settings] = await Promise.all([
    db.query('SELECT * FROM fin_rules ORDER BY active DESC, trigger, id'),
    db.query('SELECT * FROM fin_recurring ORDER BY active DESC, day_of_month, id'),
    fin.settings(),
  ]);
  res.render('finance/rules', { title: 'Custos automáticos', rules: rules.rows.map((r) => ({ ...r, amount_cents: Number(r.amount_cents) })), recurring: recurring.rows.map((r) => ({ ...r, amount_cents: Number(r.amount_cents), starts_on: fin.iso(r.starts_on), ends_on: fin.iso(r.ends_on) })), settings, fin, C, money, counts: await fin.counts() });
}));

router.post('/financeiro/regras/ajustes', requirePerm('finance.write'), wrap(async (req, res) => {
  const hour = parseBRL(req.body.studio_hour); const deposit = parseBRL(req.body.studio_deposit); const opening = parseBRL(req.body.opening_balance) ?? 0;
  const minutes = Number.parseInt(req.body.studio_minutes, 10); const epm = num(req.body.episodes_per_month);
  let openingOn = parseInputDate(req.body.opening_on) || null; if (Number.isNaN(openingOn)) openingOn = null;
  if ([hour, deposit, opening].some((x) => x != null && Number.isNaN(x)) || hour == null || deposit == null || !(minutes > 0 && minutes <= 1440) || !(epm > 0 && epm <= 60)) {
    await req.flash('error', 'Confira os valores: hora e sinal do estúdio, duração, episódios por mês e saldo.'); return res.redirect('/financeiro/regras');
  }
  await db.query('UPDATE fin_settings SET studio_hour_cents=$1, studio_deposit_cents=$2, studio_minutes=$3, episodes_per_month=$4, opening_balance_cents=$5, opening_on=$6, updated_at=now() WHERE id=1',
    [hour, deposit, minutes, epm, opening, openingOn]);
  await audit(req, 'financeiro.ajustes', 'fin_settings', 1, { hour, deposit });
  await req.flash('ok', 'Ajustes salvos. Valem para as próximas gravações.');
  res.redirect('/financeiro/regras');
}));

function parseRule(body) {
  const amount = parseBRL(body.amount);
  const offset = Number.parseInt(body.offset_days, 10);
  const v = {
    name: clean(body.name, 120), category: C.FIN_OUT[body.category] ? body.category : 'outros', trigger: C.FIN_TRIGGERS[body.trigger] ? body.trigger : null,
    amount, anchor: C.FIN_ANCHORS[body.anchor] ? body.anchor : 'gatilho', offset_days: Number.isInteger(offset) ? Math.max(-365, Math.min(365, offset)) : 0,
    supplier: text(body.supplier, 120), active: body.active !== '0',
  };
  if (v.name.length < 2) return { error: 'Dê um nome ao custo.' };
  if (!v.trigger) return { error: 'Escolha quando o custo nasce.' };
  if (amount == null || Number.isNaN(amount)) return { error: 'Valor inválido. Use algo como 150,00.' };
  return { v };
}

router.post('/financeiro/regras', requirePerm('finance.write'), wrap(async (req, res) => {
  const { v, error } = parseRule(req.body);
  if (error) { await req.flash('error', error); return res.redirect('/financeiro/regras'); }
  await db.query('INSERT INTO fin_rules (name, category, trigger, amount_cents, anchor, offset_days, supplier, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [v.name, v.category, v.trigger, v.amount, v.anchor, v.offset_days, v.supplier, v.active]);
  await audit(req, 'financeiro.regra_criada', 'fin_rule', null, { name: v.name });
  await req.flash('ok', 'Custo automático criado. Vale para os próximos episódios.');
  res.redirect('/financeiro/regras');
}));

router.post('/financeiro/regras/:id', requirePerm('finance.write'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return notFound(res, 'Regra');
  const { v, error } = parseRule(req.body);
  if (error) { await req.flash('error', error); return res.redirect('/financeiro/regras'); }
  const { rowCount } = await db.query('UPDATE fin_rules SET name=$2, category=$3, trigger=$4, amount_cents=$5, anchor=$6, offset_days=$7, supplier=$8, active=$9 WHERE id=$1',
    [req.params.id, v.name, v.category, v.trigger, v.amount, v.anchor, v.offset_days, v.supplier, v.active]);
  if (!rowCount) return notFound(res, 'Regra');
  await audit(req, 'financeiro.regra_editada', 'fin_rule', req.params.id, { name: v.name });
  await req.flash('ok', 'Custo automático salvo. Vale para os próximos episódios.');
  res.redirect('/financeiro/regras');
}));

router.post('/financeiro/regras/:id/excluir', requirePerm('finance.write'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return notFound(res, 'Regra');
  await db.query("DELETE FROM fin_entries WHERE rule_id = $1 AND status = 'previsto' AND auto_key IS NOT NULL", [req.params.id]); // o que ainda não foi pago some junto
  await db.query('DELETE FROM fin_rules WHERE id = $1', [req.params.id]);
  await audit(req, 'financeiro.regra_excluida', 'fin_rule', req.params.id);
  await req.flash('ok', 'Custo automático removido. O que já foi pago continua nos lançamentos.');
  res.redirect('/financeiro/regras');
}));

function parseRecurring(body) {
  const amount = parseBRL(body.amount); const day = Number.parseInt(body.day_of_month, 10);
  let starts = parseInputDate(body.starts_on) || fin.todayISO(); if (Number.isNaN(starts)) starts = fin.todayISO();
  let ends = parseInputDate(body.ends_on) || null; if (Number.isNaN(ends)) ends = null;
  const v = { name: clean(body.name, 120), category: C.FIN_OUT[body.category] ? body.category : 'outros', amount, day: day >= 1 && day <= 28 ? day : 5, starts, ends, supplier: text(body.supplier, 120), active: body.active !== '0' };
  if (v.name.length < 2) return { error: 'Dê um nome ao custo mensal.' };
  if (amount == null || Number.isNaN(amount) || amount <= 0) return { error: 'Valor inválido. Use algo como 2.500,00.' };
  return { v };
}

// O que ainda não foi pago é refeito com os dados novos; o que foi pago fica.
async function regenerate(id) {
  await db.query("DELETE FROM fin_entries WHERE recurring_id = $1 AND status = 'previsto'", [id]);
  await fin.ensureRecurring(3);
}

router.post('/financeiro/mensais', requirePerm('finance.write'), wrap(async (req, res) => {
  const { v, error } = parseRecurring(req.body);
  if (error) { await req.flash('error', error); return res.redirect('/financeiro/regras#mensais'); }
  const { rows: [r] } = await db.query('INSERT INTO fin_recurring (name, category, amount_cents, day_of_month, starts_on, ends_on, supplier, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [v.name, v.category, v.amount, v.day, v.starts, v.ends, v.supplier, v.active]);
  await fin.ensureRecurring(3);
  await audit(req, 'financeiro.mensal_criado', 'fin_recurring', r.id, { name: v.name });
  await req.flash('ok', 'Custo mensal criado; as próximas contas já estão em "A pagar".');
  res.redirect('/financeiro/regras#mensais');
}));

router.post('/financeiro/mensais/:id', requirePerm('finance.write'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return notFound(res, 'Custo mensal');
  const { v, error } = parseRecurring(req.body);
  if (error) { await req.flash('error', error); return res.redirect('/financeiro/regras#mensais'); }
  const { rowCount } = await db.query('UPDATE fin_recurring SET name=$2, category=$3, amount_cents=$4, day_of_month=$5, starts_on=$6, ends_on=$7, supplier=$8, active=$9 WHERE id=$1',
    [req.params.id, v.name, v.category, v.amount, v.day, v.starts, v.ends, v.supplier, v.active]);
  if (!rowCount) return notFound(res, 'Custo mensal');
  await regenerate(req.params.id);
  await audit(req, 'financeiro.mensal_editado', 'fin_recurring', req.params.id, { name: v.name });
  await req.flash('ok', 'Custo mensal salvo; as contas em aberto foram refeitas.');
  res.redirect('/financeiro/regras#mensais');
}));

router.post('/financeiro/mensais/:id/excluir', requirePerm('finance.write'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return notFound(res, 'Custo mensal');
  await db.query("DELETE FROM fin_entries WHERE recurring_id = $1 AND status = 'previsto'", [req.params.id]);
  await db.query('DELETE FROM fin_recurring WHERE id = $1', [req.params.id]);
  await audit(req, 'financeiro.mensal_excluido', 'fin_recurring', req.params.id);
  await req.flash('ok', 'Custo mensal removido. O que já foi pago continua nos lançamentos.');
  res.redirect('/financeiro/regras#mensais');
}));

// ---------------------------------------------------------------- episódio e patrocinador
router.post('/episodios/:id/duracao', requirePerm('episodes.write'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return notFound(res, 'Episódio');
  const { rows: [ep] } = await db.query('SELECT id FROM episodes WHERE id = $1', [req.params.id]);
  if (!ep) return notFound(res, 'Episódio');
  const hours = Number.parseInt(req.body.hours, 10) || 0; const mins = Number.parseInt(req.body.minutes, 10) || 0;
  const total = hours * 60 + mins;
  if (!(total > 0 && total <= 1440)) { await req.flash('error', 'Informe a duração da gravação (horas e minutos).'); return res.redirect(`/episodios/${ep.id}#financeiro`); }
  await fin.setDuration(ep.id, total);
  await audit(req, 'episodio.duracao', 'episode', ep.id, { minutos: total });
  await req.flash('ok', 'Duração registrada. O estúdio foi recalculado.');
  res.redirect(`/episodios/${ep.id}#financeiro`);
}));

router.post('/patrocinadores/:id/pagamento', requirePerm('finance.write'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return notFound(res, 'Patrocinador');
  const { rows: [sp] } = await db.query('SELECT * FROM sponsors WHERE id = $1', [req.params.id]);
  if (!sp) return notFound(res, 'Patrocinador');
  const to = `/patrocinadores/${sp.id}#financeiro`;
  if (sp.value_cents == null) { await req.flash('error', 'Defina o valor do patrocínio antes de combinar o pagamento.'); return res.redirect(to); }
  let first = parseInputDate(req.body.first_due); if (!first || Number.isNaN(first)) first = fin.todayISO();
  const r = await fin.planSponsorPayment(sp, { installments: req.body.installments, firstDue: first, userId: req.user.id });
  if (r.error) { await req.flash('error', r.error); return res.redirect(to); }
  await require('../services/sponsors').addEvent(sp.id, req.user.id, 'financeiro', r.n === 1 ? `Pagamento à vista combinado para ${formatDay(first)}` : `Pagamento combinado em ${r.n} parcelas, a primeira em ${formatDay(first)}`);
  await audit(req, 'patrocinio.pagamento_combinado', 'sponsor', sp.id, { parcelas: r.n });
  await req.flash('ok', r.n === 1 ? 'Pagamento à vista lançado em "A receber".' : `${r.n} parcelas lançadas em "A receber".`);
  res.redirect(to);
}));

module.exports = router;
