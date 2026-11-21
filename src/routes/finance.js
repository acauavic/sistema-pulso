// Financeiro: resumo e caixa, contas a pagar e a receber, estoque e regras de custo automático.
const express = require('express');
const db = require('../db/pool');
const C = require('../constants');
const fin = require('../services/finance');
const hourBank = require('../services/hourBank');
const scope = require('../services/scope');
const owner = require('../services/finOwner');
const projects = require('../services/projects');
const attachments = require('../services/attachments');
// Os comprovantes que a janela enviou (ids dos anexos, um campo por arquivo).
// Célula de planilha: texto que começa com = + - @ vira texto (não roda fórmula no Excel); número (-150,00) continua número.
// Número do vídeo pelo prefixo do projeto (EP.012 no Pulso, V.003 no Projeto 100).
const fmtEpNo = (n, projectId) => require('../utils/format').epNo(n, (projects.get(projectId) || projects.get(projects.defaultId()) || {}).number_prefix || 'EP.');
const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = `'${s}`; return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const receiptIds = (body) => [].concat(body.comprovante || []).map(Number).filter(Number.isInteger);
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
const money = (c) => (Number(c) < 0 ? `−\u00a0${formatBRL(-Number(c))}` : formatBRL(c)); // negativo no mesmo formato das linhas: "− R$ 150,00"

// Projetos cujo dinheiro a pessoa vê agora (recorte do menu ∩ "Vê o financeiro").
const pidsOf = (req) => scope.financeIdsOf(req);
// Projetos que ela pode escolher em "De quem é".
const pickProjects = (req) => pidsOf(req).map((id) => projects.get(id)).filter(Boolean);
const partnership = require('../services/partnership');

// Em todas as telas do Financeiro: quem pode ter pago do bolso (o campo "Quem pagou") e se a aba Parceria aparece.
router.use('/financeiro', wrap(async (req, res, next) => {
  if (!req.user || !req.scope) return next();
  const ids = await partnership.ofProjects(pidsOf(req));
  const parts = await Promise.all(ids.map((id) => partnership.get(id)));
  res.locals.partnerPeople = parts.filter(Boolean).map((p) => ({ projectId: p.project_id, projectName: (projects.get(p.project_id) || {}).name || '', people: p.partner_people }));
  res.locals.partnerTab = ids.length > 0;
  return next();
}));

// "Quem pagou" do formulário vira a conta do lançamento. Gasto do parceiro é de um projeto com parceria, nunca compartilhado.
async function accountOf(req, own) {
  const v = String(req.body.pago_por || 'casa');
  if (v === 'casa') return { account: 'casa', person: null };
  if (!own || own.weights) return { error: 'Gasto do parceiro é de um projeto só (o do acordo), não compartilhado.' };
  return partnership.accountFrom(v, own.projectId);
}

// ---------------------------------------------------------------- resumo
router.get('/financeiro', requirePerm('finance.read'), wrap(async (req, res) => {
  const pids = pidsOf(req);
  await fin.ensureRecurring(3);
  const [ov, counts, bank] = await Promise.all([fin.overview({ pids }), fin.counts({ pids }), hourBank.status({ pids })]);
  res.render('finance/index', {
    title: 'Financeiro', ov, counts, bank, hourBank, fin, C, money, today: fin.todayISO(), here: req.originalUrl,
    finProjects: pickProjects(req), receipts: await attachments.forEntries(ov.attention.map((e) => e.id)), ...(await pickers(pids)),
  });
}));

// Listas usadas nos modais (episódios recentes e patrocinadores), sempre no recorte.
async function pickers(pids) {
  const [episodes, sponsors, suppliers] = await Promise.all([
    db.query('SELECT id, number, title, project_id FROM episodes WHERE project_id = ANY($1::int[]) ORDER BY number DESC NULLS LAST, id DESC LIMIT 80', [pids]),
    db.query("SELECT id, company, project_id FROM sponsors WHERE stage <> 'perdido' AND project_id = ANY($1::int[]) ORDER BY lower(company)", [pids]),
    db.query(`SELECT DISTINCT e.supplier FROM fin_entries e WHERE e.supplier IS NOT NULL AND ${owner.where('e', '$1')} ORDER BY e.supplier LIMIT 100`, [pids]),
  ]);
  return { episodes: episodes.rows, sponsors: sponsors.rows, suppliers: suppliers.rows.map((r) => r.supplier) };
}

// ---------------------------------------------------------------- parceria (Projeto 100): custo volta primeiro, depois o lucro
// O projeto da tela: o pedido em ?projeto (se for de parceria e a pessoa vê o dinheiro dele), senão o primeiro do recorte.
async function partnerProjectOf(req) {
  const pids = pidsOf(req);
  const want = Number(req.query.projeto || req.body.projeto);
  if (pids.includes(want)) return want;
  const ids = await partnership.ofProjects(pids);
  return ids[0] || (req.scope.current && pids.includes(req.scope.current.id) ? req.scope.current.id : null);
}

router.get('/financeiro/parceria', requirePerm('finance.read'), wrap(async (req, res) => {
  const projectId = await partnerProjectOf(req);
  if (!projectId) return notFound(res, 'Projeto');
  const part = await partnership.get(projectId);
  const L = part ? await partnership.ledger(projectId) : null;
  const [months, settled, proj, link] = part ? await Promise.all([
    partnership.months(projectId), partnership.settlements(projectId), partnership.projection(projectId, L), partnership.currentLink(projectId),
  ]) : [[], [], null, null];
  const counts = await fin.counts({ pids: pidsOf(req) });
  res.render('finance/partnership', {
    title: 'Parceria', project: projects.get(projectId), part, L, months, settled, proj, preview: L ? partnership.preview(L) : null,
    link: link ? partnership.linkUrl(link) : null, money, counts, today: fin.todayISO(), P: partnership,
    otherProjects: (await partnership.ofProjects(pidsOf(req))).filter((id) => id !== projectId).map((id) => projects.get(id)).filter(Boolean),
  });
}));

const back = (projectId, hash = '') => `/financeiro/parceria?projeto=${projectId}${hash}`;
const partnerAct = (path, fn) => router.post(`/financeiro/parceria${path}`, requirePerm('finance.write'), wrap(async (req, res) => {
  const projectId = await partnerProjectOf(req);
  if (!projectId) return notFound(res, 'Projeto');
  const out = await fn(req, projectId);
  await req.flash(out.error ? 'error' : 'ok', out.error || out.ok);
  return res.redirect(back(projectId, out.hash || ''));
}));

partnerAct('/acordo', async (req, projectId) => {
  const out = await partnership.setTerms(projectId, req.body, req.user);
  if (out.error) return out;
  await audit(req, 'parceria.acordo', 'project', projectId, { parceiro: req.body.partner_name, casa: req.body.house_pct, desde: req.body.start_on });
  return { ok: 'Acordo salvo.' };
});

partnerAct('/acerto', async (req, projectId) => {
  const profit = String(req.body.lucro || '').trim() === '' ? null : parseBRL(req.body.lucro);
  if (profit != null && Number.isNaN(profit)) return { error: 'Valor do lucro inválido. Use algo como 2.000,00.' };
  const out = await partnership.settle(projectId, { profit, note: req.body.note, user: req.user });
  if (out.error) return out;
  await audit(req, 'parceria.acerto', 'project', projectId, { lucro: out.preview.profit, transferencia: out.preview.transfer });
  const t = out.preview.transfer;
  return { ok: t > 0 ? `Acerto registrado: a conta de ${money(t)} ao parceiro está em "A pagar".` : t < 0 ? `Acerto registrado: o repasse de ${money(-t)} do parceiro está em "A receber".` : 'Acerto registrado.' };
});

partnerAct('/meses/:ym/fechar', async (req, projectId) => {
  const out = await partnership.close(projectId, req.params.ym, req.user);
  if (out.error) return out;
  await audit(req, 'parceria.mes_fechado', 'project', projectId, { mes: req.params.ym });
  return { ok: `Mês ${partnership.monthShort(req.params.ym)} fechado: o que foi pago nele não muda mais.`, hash: '#meses' };
});

partnerAct('/meses/:ym/reabrir', async (req, projectId) => {
  const out = await partnership.reopen(projectId, req.params.ym, req.body.reason, req.user);
  if (out.error) return { ...out, hash: '#meses' };
  await audit(req, 'parceria.mes_reaberto', 'project', projectId, { mes: req.params.ym, motivo: req.body.reason });
  return { ok: `Mês ${partnership.monthShort(req.params.ym)} reaberto.`, hash: '#meses' };
});

partnerAct('/link', async (req, projectId) => {
  await partnership.link(projectId, req.user);
  await audit(req, 'parceria.link', 'project', projectId, {});
  return { ok: 'Link do extrato pronto. Copie e mande ao parceiro.' };
});

partnerAct('/link/cancelar', async (req, projectId) => {
  await partnership.revokeLink(projectId, req.user);
  await audit(req, 'parceria.link_cancelado', 'project', projectId, {});
  return { ok: 'Link do extrato cancelado.' };
});

// ---------------------------------------------------------------- lançamentos
const SCOPES = { pagar: 'A pagar', receber: 'A receber', historico: 'Histórico' };

router.get('/financeiro/lancamentos', requirePerm('finance.read'), wrap(async (req, res) => {
  const scope = SCOPES[req.query.escopo] ? req.query.escopo : 'pagar';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.mes || '')) ? req.query.mes : fin.monthOf(fin.todayISO());
  const q = String(req.query.q || '').slice(0, 80);
  const category = C.FIN_CATEGORIES[req.query.cat] ? req.query.cat : '';
  const pids = pidsOf(req);
  const [items, counts, pick] = await Promise.all([
    fin.entries({ scope, month: scope === 'historico' ? month : null, q, category, pids }), fin.counts({ pids }), pickers(pids),
  ]);
  const splits = await owner.splitsOf(items.filter((e) => e.shared).map((e) => e.id));
  const receipts = await attachments.forEntries(items.map((e) => e.id));
  const totals = items.reduce((a, e) => { if (e.status !== 'cancelado') a[e.direction === 'entrada' ? 'in' : 'out'] += e.share_cents; return a; }, { in: 0, out: 0 });
  res.render('finance/entries', {
    title: 'Contas a pagar e receber', here: req.originalUrl, scope, scopes: SCOPES, month, q, category, items, counts, totals,
    today: fin.todayISO(), fin, C, money, splits, receipts, finProjects: pickProjects(req), ...pick,
  });
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

// De quem é o lançamento: o vínculo manda; sem vínculo, o que a tela escolheu. Vínculo de fora do recorte não passa.
async function ownerOfBody(req, v, amount, { keepAs = null } = {}) {
  const pids = pidsOf(req);
  const sent = owner.parse(req.body, amount, { ids: pids, parseBRL });
  if (sent.error) return sent;
  // "compartilhado" sem valores: mantém a divisão que já existe; na criação, meio a meio
  if (sent.keep) return keepAs === 'keep' ? { keep: true } : { projectId: null, weights: owner.halves(amount, pids) };
  const own = await owner.ownerFor({ episodeId: v.episode_id, sponsorId: v.sponsor_id, projectId: sent.projectId, weights: sent.weights });
  if (!own.weights && !pids.includes(own.projectId)) return { error: 'Esse episódio ou patrocinador é de outro projeto.' };
  return own;
}

router.post('/financeiro/lancamentos', requirePerm('finance.write'), wrap(async (req, res) => {
  const { v, error } = parseEntry(req.body, { create: true });
  const to = backTo(req, '/financeiro/lancamentos');
  if (error) { await req.flash('error', error); return res.redirect(to); }
  const own = await ownerOfBody(req, v, v.amount);
  if (own.error) { await req.flash('error', own.error); return res.redirect(to); }
  const acc = await accountOf(req, own);
  if (acc.error) { await req.flash('error', acc.error); return res.redirect(to); }
  const base = Math.floor(v.amount / v.installments);
  let firstId = null;
  for (let i = 0; i < v.installments; i += 1) {
    const amount = i === v.installments - 1 ? v.amount - base * (v.installments - 1) : base;
    const paidNow = v.paid && i === 0;
    const { rows: [novo] } = await db.query(
      `INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, paid_on, status, supplier, notes, episode_id, sponsor_id, installment_no, installments, source, created_by, project_id, account, account_person)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'manual',$14,$15,$16,$17) RETURNING id`,
      [v.direction, v.category, v.installments > 1 ? `${v.description} · parcela ${i + 1}/${v.installments}` : v.description, amount, fin.addMonths(v.due, i),
        paidNow ? fin.todayISO() : null, paidNow ? 'pago' : 'previsto', v.supplier, v.notes, v.episode_id, v.sponsor_id, v.installments > 1 ? i + 1 : null, v.installments > 1 ? v.installments : null, req.user.id,
        own.weights ? null : own.projectId, acc.account, acc.person]);
    if (own.weights) await owner.save(novo.id, { weights: own.weights, amount }); // cada parcela mantém a proporção
    firstId = firstId || novo.id;
  }
  // o comprovante fica na primeira parcela (já paga: é do pagamento; senão, da conta)
  await attachments.linkReceipts(receiptIds(req.body), firstId, req.user, v.paid ? 'pagamento' : 'conta');
  await audit(req, 'financeiro.lancado', 'fin_entry', null, { description: v.description, amount: v.amount, parcelas: v.installments });
  await req.flash('ok', v.installments > 1 ? `${v.installments} parcelas lançadas.` : 'Lançamento criado.');
  res.redirect(to);
}));

// Lançamento de projeto que a pessoa não alcança responde como se não existisse.
async function findEntry(req, id) {
  if (!isIntId(id)) return null;
  const { rows: [e] } = await db.query('SELECT * FROM fin_entries WHERE id = $1', [id]);
  if (!e || !(await owner.canSee(pidsOf(req), e))) return null;
  return e;
}

router.post('/financeiro/lancamentos/:id', requirePerm('finance.write'), wrap(async (req, res) => {
  const e = await findEntry(req, req.params.id);
  if (!e) return notFound(res, 'Lançamento');
  const { v, error } = parseEntry({ ...req.body, direction: e.direction });
  const to = backTo(req, '/financeiro/lancamentos');
  if (error) { await req.flash('error', error); return res.redirect(to); }
  // "De quem é" só vem quando a tela mandou; sem isso, o lançamento continua de quem era (e o valor novo redivide o compartilhado)
  const locked = await partnership.lockedReason(e);
  if (locked) { await req.flash('error', locked); return res.redirect(to); }
  const own = req.body.de_quem ? await ownerOfBody(req, v, v.amount, { keepAs: 'keep' }) : null;
  if (own && own.error) { await req.flash('error', own.error); return res.redirect(to); }
  const acc = req.body.pago_por != null ? await accountOf(req, own || (e.project_id != null ? { projectId: e.project_id } : { weights: true })) : null;
  if (acc && acc.error) { await req.flash('error', acc.error); return res.redirect(to); }
  if (acc) await db.query('UPDATE fin_entries SET account = $2, account_person = $3 WHERE id = $1', [e.id, acc.account, acc.person]);
  await db.query(
    `UPDATE fin_entries SET category=$2, description=$3, amount_cents=$4, due_on=$5, supplier=$6, notes=$7, episode_id=$8, sponsor_id=$9, updated_at=now() WHERE id=$1`,
    [e.id, v.category, v.description, v.amount, v.due, v.supplier, v.notes, v.episode_id, v.sponsor_id]);
  if (own && !own.keep) await owner.save(e.id, { projectId: own.projectId, weights: own.weights, amount: v.amount });
  else if (own && own.keep && e.project_id != null) await owner.save(e.id, { weights: owner.halves(v.amount, pidsOf(req)), amount: v.amount }); // virou compartilhado sem valores: meio a meio
  else if (e.project_id == null) await owner.rescale(e.id, v.amount); // compartilhado que fica: a divisão acompanha o valor
  await attachments.linkReceipts(receiptIds(req.body), e.id, req.user, 'conta');
  await audit(req, 'financeiro.editado', 'fin_entry', e.id, { description: v.description });
  await req.flash('ok', 'Lançamento atualizado.');
  res.redirect(to);
}));

router.post('/financeiro/lancamentos/:id/pagar', requirePerm('finance.write'), wrap(async (req, res) => {
  const e = await findEntry(req, req.params.id);
  if (!e) return notFound(res, 'Lançamento');
  const to = backTo(req, '/financeiro/lancamentos');
  if (e.status === 'pago') { await req.flash('error', 'Este lançamento já está quitado.'); return res.redirect(to); }
  let paidOn = parseInputDate(req.body.paid_on) || fin.todayISO();
  if (Number.isNaN(paidOn)) paidOn = fin.todayISO();
  let amount = parseBRL(req.body.amount);
  if (amount == null) amount = Number(e.amount_cents);
  if (Number.isNaN(amount) || amount < 0) { await req.flash('error', 'Valor inválido.'); return res.redirect(to); }
  const locked = await partnership.lockedReason(e, { paidOn });
  if (locked) { await req.flash('error', locked); return res.redirect(to); }
  const { rows: [done] } = await db.query("UPDATE fin_entries SET status='pago', paid_on=$2, amount_cents=$3, cancel_reason=NULL, updated_at=now() WHERE id=$1 RETURNING *", [e.id, paidOn, amount]);
  if (done.project_id == null) await owner.rescale(done.id, amount); // pagou outro valor: a divisão acompanha
  await attachments.linkReceipts(receiptIds(req.body), done.id, req.user, 'pagamento');
  await fin.afterPaid(done, req.user.id);
  if (done.auto_key && /^estudio-saldo-e/.test(done.auto_key) && done.episode_id) await fin.recomputeStudio(done.episode_id); // pode ter sobrado hora extra
  await audit(req, e.direction === 'entrada' ? 'financeiro.recebido' : 'financeiro.pago', 'fin_entry', e.id, { amount });
  await req.flash('ok', e.direction === 'entrada' ? 'Recebimento registrado.' : 'Pagamento registrado.');
  res.redirect(to);
}));

// Comprovante depois (pelo clipe da linha), em qualquer situação do lançamento; e tirar um.
router.post('/financeiro/lancamentos/:id/comprovantes', requirePerm('finance.write'), wrap(async (req, res) => {
  const e = await findEntry(req, req.params.id);
  if (!e) return notFound(res, 'Lançamento');
  const n = await attachments.linkReceipts(receiptIds(req.body), e.id, req.user, e.status === 'pago' ? 'pagamento' : 'conta');
  if (n) await audit(req, 'financeiro.comprovante', 'fin_entry', e.id, { arquivos: n });
  await req.flash(n ? 'ok' : 'error', n ? (n > 1 ? `${n} comprovantes anexados.` : 'Comprovante anexado.') : 'Não consegui anexar o comprovante. Envie o arquivo de novo.');
  res.redirect(backTo(req, '/financeiro/lancamentos'));
}));

router.post('/financeiro/lancamentos/:id/comprovantes/:aid/excluir', requirePerm('finance.write'), wrap(async (req, res) => {
  const e = await findEntry(req, req.params.id);
  if (!e || !isIntId(req.params.aid)) return notFound(res, 'Lançamento');
  const { rows: [att] } = await db.query("SELECT * FROM attachments WHERE id = $1 AND entity_type = 'fin_entry' AND entity_id = $2", [req.params.aid, e.id]);
  if (!att) return notFound(res, 'Comprovante');
  await attachments.remove(att);
  await audit(req, 'financeiro.comprovante_tirado', 'fin_entry', e.id, { arquivo: att.filename });
  await req.flash('ok', 'Comprovante tirado.');
  res.redirect(backTo(req, '/financeiro/lancamentos'));
}));

router.post('/financeiro/lancamentos/:id/desfazer', requirePerm('finance.write'), wrap(async (req, res) => {
  const e = await findEntry(req, req.params.id);
  if (!e) return notFound(res, 'Lançamento');
  const locked = await partnership.lockedReason(e);
  if (locked) { await req.flash('error', locked); return res.redirect(backTo(req, '/financeiro/lancamentos?escopo=historico')); }
  await db.query("UPDATE fin_entries SET status='previsto', paid_on=NULL, cancel_reason=NULL, updated_at=now() WHERE id=$1", [e.id]);
  await audit(req, 'financeiro.reaberto', 'fin_entry', e.id);
  await req.flash('ok', 'Lançamento voltou para em aberto.');
  res.redirect(backTo(req, '/financeiro/lancamentos?escopo=historico'));
}));

router.post('/financeiro/lancamentos/:id/cancelar', requirePerm('finance.write'), wrap(async (req, res) => {
  const e = await findEntry(req, req.params.id);
  if (!e) return notFound(res, 'Lançamento');
  if (e.status === 'pago') { await req.flash('error', 'Desfaça o pagamento antes de cancelar.'); return res.redirect(backTo(req, '/financeiro/lancamentos')); }
  await db.query("UPDATE fin_entries SET status='cancelado', cancel_reason='usuario', updated_at=now() WHERE id=$1", [e.id]);
  await audit(req, 'financeiro.cancelado', 'fin_entry', e.id);
  await req.flash('ok', 'Lançamento cancelado.');
  res.redirect(backTo(req, '/financeiro/lancamentos'));
}));

router.post('/financeiro/lancamentos/:id/excluir', requirePerm('finance.write'), wrap(async (req, res) => {
  const e = await findEntry(req, req.params.id);
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
  // período: o mês (?mes=AAAA-MM) ou o ano todo (?ano=AAAA), que é o que o contador costuma pedir; mais a busca e a categoria da tela
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.mes || '')) ? req.query.mes : null;
  const year = !month && /^\d{4}$/.test(String(req.query.ano || '')) ? req.query.ano : null;
  const term = clean(req.query.q, 80);
  const category = C.FIN_CATEGORIES[req.query.cat] ? req.query.cat : null;
  const pids = pidsOf(req);
  const { rows } = await db.query(
    `SELECT e.*, ${owner.share('e', '$2')} AS share_cents, s.company AS sponsor_name, ep.number AS episode_number, ep.title AS episode_title, ep.project_id AS episode_project FROM fin_entries e
       LEFT JOIN sponsors s ON s.id = e.sponsor_id LEFT JOIN episodes ep ON ep.id = e.episode_id
      WHERE e.status <> 'cancelado' AND ($1::text IS NULL OR to_char(coalesce(e.paid_on, e.due_on), 'YYYY-MM') = $1) AND ${owner.where('e', '$2')}
        AND ($3::text IS NULL OR to_char(coalesce(e.paid_on, e.due_on), 'YYYY') = $3)
        AND ($4::text IS NULL OR e.description ILIKE $4 OR e.supplier ILIKE $4 OR s.company ILIKE $4) AND ($5::text IS NULL OR e.category = $5)
      ORDER BY coalesce(e.paid_on, e.due_on), e.id`, [month, pids, year, term ? `%${term.replace(/[\\%_]/g, '\\$&')}%` : null, category]);
  const multi = req.scope.multi;
  const lines = [['Data (pagamento ou vencimento)', 'Vencimento', 'Situação', 'Tipo', 'Categoria', 'Descrição', 'Fornecedor', 'Valor (R$)', ...(multi ? ['Projeto'] : []), 'Episódio', 'Patrocinador'].join(';')];
  for (const r of rows) {
    const e = fin.toEntry(r);
    const p = e.project_id ? projects.get(e.project_id) : null;
    lines.push([formatDay(e.paid_on || e.due_on), formatDay(e.due_on), e.status === 'pago' ? (e.direction === 'entrada' ? 'Recebido' : 'Pago') : 'Em aberto',
      e.direction === 'entrada' ? 'Entrada' : 'Saída', C.FIN_CATEGORIES[e.category] || e.category, e.description, e.supplier || '',
      ((e.direction === 'entrada' ? 1 : -1) * e.share_cents / 100).toFixed(2).replace('.', ','),
      ...(multi ? [p ? p.name : 'Compartilhado (parte deste recorte)'] : []),
      e.episode_number ? fmtEpNo(e.episode_number, e.episode_project) : '', e.sponsor_name || ''].map(csvCell).join(';'));
  }
  const slug = req.scope.current ? `-${req.scope.current.slug}` : '';
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="financeiro${slug}-${month || year || 'tudo'}.csv"` });
  res.send(`﻿${lines.join('\r\n')}\r\n`);
}));

// ---------------------------------------------------------------- estoque
// De quem é o item: um projeto do recorte, ou compartilhado (null). Com um projeto escolhido no menu, o item novo nasce nele.
// Na edição, sem o campo (ou com um projeto que a pessoa não alcança), continua de quem era. -> { projectId } | { keep } | { error }
function stockOwner(req, raw, { create = false } = {}) {
  const ids = scope.idsOf(req);
  const multi = req.scope.ids.length > 1;
  if (create && req.scope.current) return ids.includes(req.scope.current.id) ? { projectId: req.scope.current.id } : { error: 'Sua função neste projeto não cadastra estoque.' };
  if (raw === 'compartilhado' && multi) return { projectId: null };
  if (ids.includes(Number(raw))) return { projectId: Number(raw) };
  if (!create) return { keep: true };
  if (ids.length === 1) return { projectId: ids[0] };
  return { error: 'Diga de que projeto é o item (ou se é compartilhado).' };
}

router.get('/financeiro/estoque', requirePerm('stock.read'), wrap(async (req, res) => {
  const items = await fin.stockItems({ pids: scope.idsOf(req) }); // os itens do recorte e os compartilhados
  const moves = await fin.stockMovesFor(items.map((i) => i.id), 6);
  for (const i of items) i.moves = moves[i.id] || [];
  const showItems = req.query.arquivados === '1' ? items : items.filter((i) => i.active);
  res.render('finance/stock', {
    title: 'Estoque', items: showItems, archived: items.filter((i) => !i.active).length, showArchived: req.query.arquivados === '1',
    settings: await fin.settings(), fin, C, money, finProjects: pickProjects(req),
    stockProjects: req.scope.ids.length > 1 ? scope.idsOf(req).map((id) => projects.get(id)).filter(Boolean) : [],
    counts: can(req.user, 'finance.read') ? await fin.counts({ pids: pidsOf(req) }) : null,
  });
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
  const own = stockOwner(req, req.body.project_id, { create: true });
  if (own.error) { await req.flash('error', own.error); return res.redirect('/financeiro/estoque'); }
  const { rows: [it] } = await db.query(
    'INSERT INTO fin_stock_items (name, unit, per_episode, min_qty, lead_days, supplier, notes, unit_cost_cents, project_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [v.name, v.unit, v.per_episode, v.min_qty, v.lead_days, v.supplier, v.notes, cost || 0, own.projectId]);
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
  const own = stockOwner(req, req.body.project_id);
  await db.query('UPDATE fin_stock_items SET name=$2, unit=$3, per_episode=$4, min_qty=$5, lead_days=$6, supplier=$7, notes=$8, active=$9, project_id=$10 WHERE id=$1',
    [it.id, v.name, v.unit, v.per_episode, v.min_qty, v.lead_days, v.supplier, v.notes, req.body.active !== '0', own.keep ? it.project_id : own.projectId]);
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
  const own = owner.parse(req.body, total, { ids: pidsOf(req), parseBRL });
  if (own.error) { await req.flash('error', own.error); return res.redirect('/financeiro/estoque'); }
  await fin.buyStock({
    item: { ...it, unit_cost_cents: Number(it.unit_cost_cents) }, qty, totalCents: total, category: C.FIN_OUT[req.body.category] ? req.body.category : 'brindes',
    supplier: text(req.body.supplier, 120), firstDue: due, installments: req.body.installments, paidNow: req.body.paid === '1', userId: req.user.id,
    projectId: own.projectId, weights: own.weights,
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
  const pids = pidsOf(req);
  const [rules, recurring, settings, bankEpisodes] = await Promise.all([
    // regra sem projeto vale em todos; com projeto, só aparece para quem vê aquele projeto
    db.query('SELECT * FROM fin_rules WHERE project_id IS NULL OR project_id = ANY($1::int[]) ORDER BY active DESC, trigger, id', [pids]),
    db.query(
      `SELECT * FROM fin_recurring r
        WHERE r.project_id = ANY($1::int[])
           OR (r.project_id IS NULL AND EXISTS (SELECT 1 FROM jsonb_object_keys(coalesce(r.split, '{}'::jsonb)) k WHERE k ~ '^[0-9]+$' AND k::int = ANY($1::int[])))
        ORDER BY active DESC, day_of_month, id`, [pids]),
    fin.settings(),
    // episódio de início do banco de horas: os gravados, do mais novo para o mais antigo
    db.query('SELECT id, number, title, recorded_on, project_id FROM episodes WHERE recorded_on IS NOT NULL AND project_id = ANY($1::int[]) ORDER BY recorded_on DESC, number DESC NULLS LAST LIMIT 200', [pids]),
  ]);
  const startEp = settings.studio_bank_start_episode_id ? (await db.query('SELECT id, number, title, project_id FROM episodes WHERE id = $1', [settings.studio_bank_start_episode_id])).rows[0] || null : null;
  res.render('finance/rules', {
    title: 'Custos automáticos', rules: rules.rows.map((r) => ({ ...r, amount_cents: Number(r.amount_cents) })),
    recurring: recurring.rows.map((r) => ({ ...r, amount_cents: Number(r.amount_cents), starts_on: fin.iso(r.starts_on), ends_on: fin.iso(r.ends_on) })),
    settings, bankEpisodes: bankEpisodes.rows.map((e) => ({ ...e, recorded_on: fin.iso(e.recorded_on) })), startEp, hourBank, fin, C, money,
    finProjects: pickProjects(req), counts: await fin.counts({ pids }),
  });
}));

router.post('/financeiro/regras/ajustes', requirePerm('finance.write'), wrap(async (req, res) => {
  const hour = parseBRL(req.body.studio_hour); const deposit = parseBRL(req.body.studio_deposit); const opening = parseBRL(req.body.opening_balance) ?? 0;
  const minutes = Number.parseInt(req.body.studio_minutes, 10); const epm = num(req.body.episodes_per_month);
  let openingOn = parseInputDate(req.body.opening_on) || null; if (Number.isNaN(openingOn)) openingOn = null;
  if ([hour, deposit, opening].some((x) => x != null && Number.isNaN(x)) || hour == null || deposit == null || !(minutes > 0 && minutes <= 1440) || !(epm > 0 && epm <= 60)) {
    await req.flash('error', 'Confira os valores: hora e sinal do estúdio, duração, episódios por mês e saldo.'); return res.redirect('/financeiro/regras');
  }
  let alert = null; // "Avisar quando restarem (horas)": só vem com o banco de horas ligado
  if (req.body.studio_bank_alert_hours !== undefined) {
    alert = String(req.body.studio_bank_alert_hours).trim() === '' ? NaN : num(req.body.studio_bank_alert_hours); // em branco não vira 0
    if (!(alert >= 0 && alert <= 999)) { await req.flash('error', 'Confira as horas do aviso do banco de horas.'); return res.redirect('/financeiro/regras'); }
  }
  await db.query('UPDATE fin_settings SET studio_hour_cents=$1, studio_deposit_cents=$2, studio_minutes=$3, episodes_per_month=$4, opening_balance_cents=$5, opening_on=$6, updated_at=now() WHERE id=1',
    [hour, deposit, minutes, epm, opening, openingOn]);
  if (alert !== null) await hourBank.setAlertHours(alert);
  await audit(req, 'financeiro.ajustes', 'fin_settings', 1, { hour, deposit });
  await req.flash('ok', 'Ajustes salvos. Valem para as próximas gravações.');
  res.redirect('/financeiro/regras');
}));

// "Vale para": em todos os projetos (vazio) ou só em um. O lançamento que a regra gera é do projeto do episódio ou do convidado.
function parseRule(body, pids) {
  const amount = parseBRL(body.amount);
  const offset = Number.parseInt(body.offset_days, 10);
  const sent = Number(body.vale_para);
  const v = {
    name: clean(body.name, 120), category: C.FIN_OUT[body.category] ? body.category : 'outros', trigger: C.FIN_TRIGGERS[body.trigger] ? body.trigger : null,
    amount, anchor: C.FIN_ANCHORS[body.anchor] ? body.anchor : 'gatilho', offset_days: Number.isInteger(offset) ? Math.max(-365, Math.min(365, offset)) : 0,
    supplier: text(body.supplier, 120), active: body.active !== '0',
    project_id: pids.includes(sent) ? sent : null,
  };
  if (v.name.length < 2) return { error: 'Dê um nome ao custo.' };
  if (!v.trigger) return { error: 'Escolha quando o custo nasce.' };
  if (amount == null || Number.isNaN(amount)) return { error: 'Valor inválido. Use algo como 150,00.' };
  return { v };
}

router.post('/financeiro/regras', requirePerm('finance.write'), wrap(async (req, res) => {
  const { v, error } = parseRule(req.body, pidsOf(req));
  if (error) { await req.flash('error', error); return res.redirect('/financeiro/regras'); }
  await db.query('INSERT INTO fin_rules (name, category, trigger, amount_cents, anchor, offset_days, supplier, active, project_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [v.name, v.category, v.trigger, v.amount, v.anchor, v.offset_days, v.supplier, v.active, v.project_id]);
  await audit(req, 'financeiro.regra_criada', 'fin_rule', null, { name: v.name });
  await req.flash('ok', 'Custo automático criado. Vale para os próximos episódios.');
  res.redirect('/financeiro/regras');
}));

router.post('/financeiro/regras/:id', requirePerm('finance.write'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return notFound(res, 'Regra');
  const pids = pidsOf(req);
  const { v, error } = parseRule(req.body, pids);
  if (error) { await req.flash('error', error); return res.redirect('/financeiro/regras'); }
  const { rowCount } = await db.query(
    `UPDATE fin_rules SET name=$2, category=$3, trigger=$4, amount_cents=$5, anchor=$6, offset_days=$7, supplier=$8, active=$9, project_id=$10
      WHERE id=$1 AND (project_id IS NULL OR project_id = ANY($11::int[]))`,
    [req.params.id, v.name, v.category, v.trigger, v.amount, v.anchor, v.offset_days, v.supplier, v.active, v.project_id, pids]);
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

// O custo mensal não tem vínculo de onde herdar: guarda o dono (ou os pesos da divisão) e repassa a cada mês que nasce.
function parseRecurring(body, pids) {
  const amount = parseBRL(body.amount); const day = Number.parseInt(body.day_of_month, 10);
  let starts = parseInputDate(body.starts_on) || fin.todayISO(); if (Number.isNaN(starts)) starts = fin.todayISO();
  let ends = parseInputDate(body.ends_on) || null; if (Number.isNaN(ends)) ends = null;
  const v = { name: clean(body.name, 120), category: C.FIN_OUT[body.category] ? body.category : 'outros', amount, day: day >= 1 && day <= 28 ? day : 5, starts, ends, supplier: text(body.supplier, 120), active: body.active !== '0' };
  if (v.name.length < 2) return { error: 'Dê um nome ao custo mensal.' };
  if (amount == null || Number.isNaN(amount) || amount <= 0) return { error: 'Valor inválido. Use algo como 2.500,00.' };
  const own = owner.parse(body, amount, { ids: pids, parseBRL });
  if (own.error) return { error: own.error };
  v.project_id = own.weights ? null : (own.projectId || projects.defaultId());
  v.split = own.weights || null;
  return { v };
}

// O que ainda não foi pago é refeito com os dados novos; o que foi pago fica.
async function regenerate(id) {
  await db.query("DELETE FROM fin_entries WHERE recurring_id = $1 AND status = 'previsto'", [id]);
  await fin.ensureRecurring(3);
}

router.post('/financeiro/mensais', requirePerm('finance.write'), wrap(async (req, res) => {
  const { v, error } = parseRecurring(req.body, pidsOf(req));
  if (error) { await req.flash('error', error); return res.redirect('/financeiro/regras#mensais'); }
  const acc = await accountOf(req, v.split ? { weights: v.split } : { projectId: v.project_id });
  if (acc.error) { await req.flash('error', acc.error); return res.redirect('/financeiro/regras#mensais'); }
  const { rows: [r] } = await db.query(
    'INSERT INTO fin_recurring (name, category, amount_cents, day_of_month, starts_on, ends_on, supplier, active, project_id, split, account, account_person) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',
    [v.name, v.category, v.amount, v.day, v.starts, v.ends, v.supplier, v.active, v.project_id, v.split, acc.account, acc.person]);
  await fin.ensureRecurring(3);
  await audit(req, 'financeiro.mensal_criado', 'fin_recurring', r.id, { name: v.name });
  await req.flash('ok', 'Custo mensal criado; as próximas contas já estão em "A pagar".');
  res.redirect('/financeiro/regras#mensais');
}));

router.post('/financeiro/mensais/:id', requirePerm('finance.write'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return notFound(res, 'Custo mensal');
  const { v, error } = parseRecurring(req.body, pidsOf(req));
  if (error) { await req.flash('error', error); return res.redirect('/financeiro/regras#mensais'); }
  const acc = await accountOf(req, v.split ? { weights: v.split } : { projectId: v.project_id });
  if (acc.error) { await req.flash('error', acc.error); return res.redirect('/financeiro/regras#mensais'); }
  const { rowCount } = await db.query(
    'UPDATE fin_recurring SET name=$2, category=$3, amount_cents=$4, day_of_month=$5, starts_on=$6, ends_on=$7, supplier=$8, active=$9, project_id=$10, split=$11, account=$12, account_person=$13 WHERE id=$1',
    [req.params.id, v.name, v.category, v.amount, v.day, v.starts, v.ends, v.supplier, v.active, v.project_id, v.split, acc.account, acc.person]);
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

// ---------------------------------------------------------------- banco de horas do estúdio
function parsePack(body) {
  const hours = num(body.hours); const amount = parseBRL(body.amount);
  const date = parseInputDate(String(body.bought_on || '').trim()); // vazio = hoje; data inválida é erro (não vira hoje)
  if (Number.isNaN(date)) return { error: 'Data da compra inválida.' };
  if (amount == null || Number.isNaN(amount) || amount < 0) return { error: 'Valor inválido. Use algo como 5.000,00.' };
  const v = { hours, amountCents: amount, boughtOn: date || fin.todayISO(), note: text(body.note, 300) };
  const bad = hourBank.checkPack(v); // horas que arredondam para 0 não passam
  return bad ? { error: bad } : { v };
}

// Liga o banco: episódio de início + primeira compra. O estúdio em aberto do banco é cancelado pelo sistema; o pago fica.
router.post('/financeiro/banco/ligar', requirePerm('finance.write'), wrap(async (req, res) => {
  const back = '/financeiro/regras';
  if (await hourBank.bankActive()) { await req.flash('error', 'O banco de horas já está ligado.'); return res.redirect(back); }
  if (!isIntId(req.body.start_episode_id)) { await req.flash('error', 'Escolha o episódio de início.'); return res.redirect(back); }
  const { v, error } = parsePack(req.body);
  if (error) { await req.flash('error', error); return res.redirect(back); }
  const r = await hourBank.activate({ startEpisodeId: Number(req.body.start_episode_id), pack: v, userId: req.user.id }); // liga + primeira compra, tudo junto
  if (r.error) { await req.flash('error', r.error); return res.redirect(back); }
  await audit(req, 'financeiro.banco_ligado', 'fin_settings', 1, { episodio_inicio: Number(req.body.start_episode_id), cancelados: r.canceled, horas: v.hours, valor: v.amountCents });
  await req.flash('ok', `Banco de horas ligado com ${hourBank.fmtHours(v.hours)}.${r.canceled ? ` ${r.canceled} conta${r.canceled > 1 ? 's' : ''} de estúdio em aberto saí${r.canceled > 1 ? 'ram' : 'u'} da lista.` : ''}`);
  res.redirect('/financeiro');
}));

router.post('/financeiro/banco/compras', requirePerm('finance.write'), wrap(async (req, res) => {
  if (!(await hourBank.bankActive())) { await req.flash('error', 'Ligue o banco de horas antes de registrar uma compra.'); return res.redirect('/financeiro/regras'); }
  const { v, error } = parsePack(req.body);
  if (error) { await req.flash('error', error); return res.redirect('/financeiro'); }
  const r = await hourBank.addPack({ ...v, userId: req.user.id, quotas: quotasFromBody(req) });
  if (r.error) { await req.flash('error', r.error); return res.redirect('/financeiro'); }
  await audit(req, 'financeiro.banco_compra', 'fin_hour_pack', r.pack.id, { horas: v.hours, valor: v.amountCents });
  await req.flash('ok', `Compra de ${hourBank.fmtHours(v.hours)} registrada e lançada como despesa paga.`);
  res.redirect('/financeiro');
}));

// Cotas de horas por projeto que a tela mandou: { projeto: horas }. Em branco = o sistema decide (proporção da compra anterior).
function quotasFromBody(req) {
  const out = {};
  for (const id of pidsOf(req)) {
    const raw = String(req.body[`cota_${id}`] ?? '').trim();
    if (raw === '') continue;
    const h = num(raw);
    if (!(h >= 0)) return null;
    out[id] = h;
  }
  return Object.keys(out).length ? out : null;
}

// Ajustar cotas: orçamento e aviso por projeto numa compra de horas. Não mexe em dinheiro (a divisão da despesa segue o uso).
router.post('/financeiro/banco/cotas', requirePerm('finance.write'), wrap(async (req, res) => {
  const back = '/financeiro#banco-de-horas';
  if (!isIntId(req.body.pack_id)) { await req.flash('error', 'Escolha a compra.'); return res.redirect(back); }
  const quotas = quotasFromBody(req);
  if (!quotas) { await req.flash('error', 'Confira as horas de cada projeto.'); return res.redirect(back); }
  const r = await hourBank.setQuotas(Number(req.body.pack_id), quotas);
  if (r.error) { await req.flash('error', r.error); return res.redirect(back); }
  await audit(req, 'financeiro.banco_cotas', 'fin_hour_pack', Number(req.body.pack_id), { cotas: quotas });
  await req.flash('ok', r.rest > 0 ? `Cotas salvas. Ficaram ${hourBank.fmtHours(r.rest)} sem cota.` : 'Cotas salvas.');
  res.redirect(back);
}));

// ---------------------------------------------------------------- episódio e patrocinador
router.post('/episodios/:id/duracao', requirePerm('episodes.write'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return notFound(res, 'Episódio');
  const { rows: [ep] } = await db.query('SELECT id, project_id FROM episodes WHERE id = $1', [req.params.id]);
  if (!ep || !scope.canSee(req, ep.project_id)) return notFound(res, 'Episódio');
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
  if (!sp || !scope.canSee(req, sp.project_id)) return notFound(res, 'Patrocinador');
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
