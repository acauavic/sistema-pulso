// Acerto da parceria (Projeto 100): o custo volta primeiro para quem pagou (na proporção do que gastou); o resto é lucro,
// dividido quando a casa decide. Um acerto = uma transferência. Mês fechado não muda.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const P = require('../src/services/partnership');

const one = async (sql, params) => (await h.db.query(sql, params)).rows[0];
const pay = (direction, cents, { account = 'casa', person = null, day = '2026-11-10', project = 2, category = null } = {}) => one(
  `INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, paid_on, status, project_id, account, account_person)
   VALUES ($1, $2, 'teste', $3, $4, $4, 'pago', $5, $6, $7) RETURNING id`,
  [direction, category || (direction === 'saida' ? 'equipe' : 'youtube'), cents, day, project, account, person]);

describe('acerto da parceria', () => {
  let app; let gestao; let pulsoFin;

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    await h.createUser({ name: 'Gil Gestão', email: 'g@t.com', role: 'gestao', projects: [1, 2] });
    await h.createUser({ name: 'Pia Pulso', email: 'p@t.com', role: 'gestao', projects: [1] });
    await require('../src/services/projects').refresh(true);
    gestao = h.client(app.base); await gestao.login('g@t.com');
    pulsoFin = h.client(app.base); await pulsoFin.login('p@t.com');
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('o Projeto 100 nasce com o acordo: custo volta primeiro, depois 50/50', async () => {
    const part = await P.get(2);
    assert.equal(part.partner_name, 'Dr. José Bento');
    assert.deepEqual(part.partner_people, ['Dr. José Bento', 'Pedro']);
    assert.equal(part.house_pct, 50);
    assert.equal(await P.get(1), null, 'o Pulso não tem parceria');
  });

  it('receita menor que o custo: tudo é devolução, na proporção de quem gastou', async () => {
    await pay('saida', 800000);
    await pay('saida', 200000, { account: 'parceiro', person: 'Pedro' });
    await pay('entrada', 600000);
    const L = await P.ledger(2);
    assert.equal(L.costs.total, 1000000); assert.equal(L.costs.parceiro, 200000); assert.deepEqual(L.costs.byPerson, { Pedro: 200000 });
    assert.deepEqual([L.recovered.casa, L.recovered.parceiro], [480000, 120000]);
    assert.equal(L.toRecover.total, 400000); assert.equal(L.profit.available, 0);
    assert.equal(P.preview(L).transfer, 120000, 'a casa recebeu a receita: devolve ao parceiro a parte dele');
  });

  it('receita maior que o custo: o excedente é lucro; distribuir tudo divide meio a meio', async () => {
    await pay('entrada', 800000);
    const L = await P.ledger(2);
    assert.equal(L.toRecover.total, 0); assert.equal(L.profit.available, 400000);
    const pv = P.preview(L);
    assert.equal(pv.partnerProfit, 200000); assert.equal(pv.transfer, 400000, 'devolução de 2.000 + metade do lucro');
    assert.equal(P.preview(L, 0).transfer, 200000, 'sem distribuir o lucro, só a devolução');
  });

  it('fazer o acerto gera uma conta só, que não é custo nem receita, e zera a transferência', async () => {
    const r = await gestao.act('/financeiro/parceria/acerto', { projeto: 2, lucro: '4.000,00', note: 'acerto de novembro' }, { from: '/financeiro/parceria?projeto=2' });
    assert.equal(r.status, 302);
    const s = await one('SELECT * FROM partnership_settlements ORDER BY id DESC LIMIT 1');
    assert.equal(Number(s.profit_cents), 400000); assert.equal(Number(s.transfer_cents), 400000);
    const e = await one('SELECT * FROM fin_entries WHERE id = $1', [s.entry_id]);
    assert.equal(e.direction, 'saida'); assert.equal(e.category, 'acerto'); assert.equal(Number(e.amount_cents), 400000); assert.equal(e.status, 'previsto'); assert.equal(e.project_id, 2);
    await h.db.query("UPDATE fin_entries SET status = 'pago', paid_on = '2026-11-20' WHERE id = $1", [e.id]);
    const L = await P.ledger(2);
    assert.equal(L.costs.total, 1000000, 'o acerto pago não virou custo'); assert.equal(L.profit.available, 0);
    assert.equal(P.preview(L).transfer, 0);
    const byProject = await require('../src/services/finance').resultByProject({ pids: [1, 2], ym: '2026-11' });
    assert.equal(byProject.find((x) => x.id === 2).out_paid, 1000000, 'no resultado do projeto entram os gastos da casa e do bolso; o acerto não');
  });

  it('receita que caiu na conta do parceiro: ele repassa à casa', async () => {
    await pay('entrada', 100000, { account: 'parceiro', person: 'Dr. José Bento' });
    const L = await P.ledger(2);
    assert.equal(L.profit.available, 100000);
    assert.equal(P.preview(L).transfer, -50000);
    const page = (await gestao.get('/financeiro/parceria?projeto=2')).text;
    assert.match(page, /Dr\. José Bento repassa R\$\s?500,00 à casa/);
  });

  it('o que o parceiro paga do bolso não entra no caixa da casa', async () => {
    const fin = require('../src/services/finance');
    const s = await fin.settings();
    const cash = await fin.cashNow(s, { pids: [2] });
    // casa: −8.000 +6.000 +8.000 −4.000 (acerto) = +2.000; o gasto do Pedro (2.000) e a receita do Dr. José (1.000) ficam de fora
    assert.equal(cash, 200000);
  });

  it('no formulário, "Quem pagou" grava a conta; gasto do parceiro em projeto sem parceria é recusado', async () => {
    const page = (await gestao.get('/financeiro/lancamentos')).text;
    assert.match(page, /name="pago_por"/); assert.match(page, /value="parceiro:Pedro"/);
    await gestao.act('/financeiro/lancamentos', { direction: 'saida', description: 'Uber do Pedro', amount: '50,00', due_on: '2026-11-21', paid: '1', de_quem: '2', pago_por: 'parceiro:Pedro' }, { from: '/financeiro/lancamentos' });
    const e = await one("SELECT * FROM fin_entries WHERE description = 'Uber do Pedro'");
    assert.equal(e.account, 'parceiro'); assert.equal(e.account_person, 'Pedro'); assert.equal(e.project_id, 2);
    await gestao.act('/financeiro/lancamentos', { direction: 'saida', description: 'Errado', amount: '50,00', due_on: '2026-11-21', de_quem: '1', pago_por: 'parceiro:Pedro' }, { from: '/financeiro/lancamentos' });
    assert.equal(await one("SELECT id FROM fin_entries WHERE description = 'Errado'"), undefined);
    assert.match((await gestao.get('/financeiro/lancamentos?escopo=historico')).text, /pago por Pedro/);
  });

  it('mês fechado: o que foi pago nele não muda; reabrir pede o motivo', async () => {
    const paid = await one("SELECT id FROM fin_entries WHERE description = 'Uber do Pedro'");
    const open = await one(`INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, status, project_id) VALUES ('saida', 'outros', 'Aberta', 1000, '2026-11-15', 'previsto', 2) RETURNING id`);
    await gestao.act('/financeiro/parceria/meses/2026-11/fechar', { projeto: 2 }, { from: '/financeiro/parceria?projeto=2' });
    const c = await one("SELECT * FROM partnership_closings WHERE project_id = 2 AND month = '2026-11'");
    assert.ok(c && !c.reopened_at); assert.ok(c.statement.month);
    await gestao.act(`/financeiro/lancamentos/${paid.id}`, { description: 'Mudou', amount: '60,00', due_on: '2026-11-21', category: 'outros' }, { from: '/financeiro/lancamentos' });
    assert.equal((await one('SELECT description FROM fin_entries WHERE id = $1', [paid.id])).description, 'Uber do Pedro');
    await gestao.act(`/financeiro/lancamentos/${paid.id}/desfazer`, {}, { from: '/financeiro/lancamentos' });
    assert.equal((await one('SELECT status FROM fin_entries WHERE id = $1', [paid.id])).status, 'pago');
    await gestao.act(`/financeiro/lancamentos/${open.id}/pagar`, { paid_on: '2026-11-15', amount: '10,00' }, { from: '/financeiro/lancamentos' });
    assert.equal((await one('SELECT status FROM fin_entries WHERE id = $1', [open.id])).status, 'previsto', 'pagar com data no mês fechado é recusado');
    // o Pulso não tem mês fechado: segue normal
    const pulso = await one(`INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, paid_on, status, project_id) VALUES ('saida', 'outros', 'Do Pulso', 1000, '2026-11-15', '2026-11-15', 'pago', 1) RETURNING id`);
    await gestao.act(`/financeiro/lancamentos/${pulso.id}/desfazer`, {}, { from: '/financeiro/lancamentos' });
    assert.equal((await one('SELECT status FROM fin_entries WHERE id = $1', [pulso.id])).status, 'previsto');
    await gestao.act('/financeiro/parceria/meses/2026-11/reabrir', { projeto: 2, reason: '' }, { from: '/financeiro/parceria?projeto=2' });
    assert.equal((await one("SELECT reopened_at FROM partnership_closings WHERE month = '2026-11'")).reopened_at, null);
    await gestao.act('/financeiro/parceria/meses/2026-11/reabrir', { projeto: 2, reason: 'faltou a nota do estúdio' }, { from: '/financeiro/parceria?projeto=2' });
    assert.ok((await one("SELECT reopened_at FROM partnership_closings WHERE month = '2026-11'")).reopened_at);
    await gestao.act(`/financeiro/lancamentos/${open.id}/pagar`, { paid_on: '2026-11-15', amount: '10,00' }, { from: '/financeiro/lancamentos' });
    assert.equal((await one('SELECT status FROM fin_entries WHERE id = $1', [open.id])).status, 'pago');
  });

  it('a aba Parceria aparece só para quem vê o dinheiro de um projeto com parceria', async () => {
    assert.match((await gestao.get('/financeiro')).text, /href="\/financeiro\/parceria"/);
    assert.doesNotMatch((await pulsoFin.get('/financeiro')).text, /href="\/financeiro\/parceria"/);
    const other = (await pulsoFin.get('/financeiro/parceria?projeto=2')).text; // o projeto pedido não é dela: abre o dela, sem acordo
    assert.match(other, /Este projeto não tem acordo de parceria/); assert.doesNotMatch(other, /Dr\. José Bento/);
    const page = (await gestao.get('/financeiro/parceria?projeto=2')).text;
    assert.match(page, /Custo a recuperar/); assert.match(page, /Mês a mês/); assert.match(page, /novembro de 2026/);
  });

  it('extrato por link: só leitura, sem nada do painel; cancelado não abre', async () => {
    await gestao.act('/financeiro/parceria/link', { projeto: 2 }, { from: '/financeiro/parceria?projeto=2' });
    const l = await one('SELECT * FROM partnership_links WHERE project_id = 2 AND revoked_at IS NULL');
    const anon = h.client(app.base);
    const r = await anon.get(`/extrato/${l.token}`);
    assert.equal(r.status, 200);
    assert.match(r.text, /Como está a conta/); assert.match(r.text, /Lucro a distribuir/);
    assert.doesNotMatch(r.text, /<form|name="csrf"/);
    assert.match(r.headers.get('x-robots-tag'), /noindex/);
    await gestao.act('/financeiro/parceria/link/cancelar', { projeto: 2 }, { from: '/financeiro/parceria?projeto=2' });
    assert.equal((await anon.get(`/extrato/${l.token}`)).status, 404);
  });

  it('editar o acordo muda a divisão do lucro', async () => {
    await gestao.act('/financeiro/parceria/acordo', { projeto: 2, partner_name: 'Dr. José Bento', partner_people: 'Dr. José Bento, Pedro, Ana', house_pct: '60', start_on: '2026-11-01' }, { from: '/financeiro/parceria?projeto=2' });
    const part = await P.get(2);
    assert.equal(part.house_pct, 60); assert.deepEqual(part.partner_people, ['Dr. José Bento', 'Pedro', 'Ana']);
  });
});
