const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const fin = require('../src/services/finance');
const prod = require('../src/services/production');

describe('financeiro', () => {
  const as = {}; let app;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const one = (sql, p) => q(sql, p).then((r) => r[0]);
  const entries = (where, p = []) => q(`SELECT * FROM fin_entries WHERE ${where} ORDER BY id`, p);
  const mkGuest = async (name, status = 'agendado', at = '2026-12-10T18:00:00Z') => (await one(
    "INSERT INTO guests (name, status, proposed_at, email, scheduled_studio, scheduled_hosts, scheduled_guest) VALUES ($1,$2,$3,'a@b.com',true,true,true) RETURNING *", [name, status, at])).id;

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora'], ['editor', 'editor_video']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('permissões: só gestão vê o dinheiro; a produtora enxerga o estoque; o editor não vê nada', async () => {
    assert.equal((await as.gestao.get('/financeiro')).status, 200);
    for (const u of ['/financeiro', '/financeiro/lancamentos', '/financeiro/regras']) assert.equal((await as.prod.get(u)).status, 403, u);
    assert.equal((await as.prod.get('/financeiro/estoque')).status, 200);
    assert.equal((await as.editor.get('/financeiro/estoque')).status, 403);
    assert.equal((await as.prod.act('/financeiro/lancamentos', { description: 'x', amount: '1', due_on: '2026-12-01' }, { from: '/' })).status, 403);
    assert.match((await as.gestao.get('/')).text, /href="\/financeiro"/);
    assert.match((await as.prod.get('/')).text, /href="\/financeiro\/estoque"/);
  });

  it('gravação agendada lança o sinal do estúdio uma única vez; desistir cancela, voltar reativa', async () => {
    const id = await mkGuest('Dra. Ana');
    await prod.syncFromGuest(id); await prod.syncFromGuest(id);
    let rows = await entries('guest_id=$1', [id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].category, 'estudio'); assert.equal(Number(rows[0].amount_cents), 15000);
    assert.equal(rows[0].direction, 'saida'); assert.equal(rows[0].status, 'previsto');
    await h.db.query("UPDATE guests SET status='cancelado' WHERE id=$1", [id]); await prod.syncFromGuest(id);
    rows = await entries('guest_id=$1', [id]);
    assert.equal(rows[0].status, 'cancelado'); assert.equal(rows[0].cancel_reason, 'sistema');
    await h.db.query("UPDATE guests SET status='agendado' WHERE id=$1", [id]); await prod.syncFromGuest(id);
    assert.equal((await entries('guest_id=$1', [id]))[0].status, 'previsto', 'o sistema reativa o que ele mesmo cancelou');
    // o que a pessoa cancelou não volta sozinho
    await as.gestao.act(`/financeiro/lancamentos/${rows[0].id}/cancelar`, {}, { from: '/financeiro' });
    await prod.syncFromGuest(id);
    const r = (await entries('guest_id=$1', [id]))[0];
    assert.equal(r.status, 'cancelado'); assert.equal(r.cancel_reason, 'usuario');
  });

  it('gravar o episódio move as contas, lança o saldo do estúdio e refaz tudo quando a duração real é registrada', async () => {
    const id = await mkGuest('Dr. Bruno');
    await prod.syncFromGuest(id);
    await h.db.query("UPDATE guests SET status='gravado' WHERE id=$1", [id]);
    await prod.syncFromGuest(id);
    const ep = await one('SELECT * FROM episodes WHERE guest_id=$1', [id]);
    const rows = await entries('episode_id=$1', [ep.id]);
    assert.equal(rows.length, 2, 'sinal (movido do convidado) + saldo');
    const saldo = rows.find((r) => /saldo/.test(r.description));
    assert.equal(Number(saldo.amount_cents), 15000, '1 h × R$ 300 − R$ 150 de sinal');
    // gravou 2h30: saldo = 750 − 150
    assert.equal((await as.gestao.act(`/episodios/${ep.id}/duracao`, { hours: '2', minutes: '30' }, { from: `/episodios/${ep.id}` })).status, 302);
    assert.equal(Number((await one('SELECT amount_cents FROM fin_entries WHERE id=$1', [saldo.id])).amount_cents), 60000);
    // saldo pago e a gravação ainda passou de tempo: a diferença vira hora extra
    await as.gestao.act(`/financeiro/lancamentos/${saldo.id}/pagar`, { amount: '600,00', paid_on: '2026-12-10' }, { from: '/financeiro' });
    await as.gestao.act(`/episodios/${ep.id}/duracao`, { hours: '3', minutes: '0' }, { from: `/episodios/${ep.id}` });
    const extra = await one("SELECT * FROM fin_entries WHERE auto_key=$1", [`estudio-extra-e${ep.id}`]);
    assert.equal(Number(extra.amount_cents), 15000); assert.equal(extra.status, 'previsto');
    await as.gestao.act(`/episodios/${ep.id}/duracao`, { hours: '2', minutes: '30' }, { from: `/episodios/${ep.id}` });
    assert.equal((await one('SELECT status FROM fin_entries WHERE id=$1', [extra.id])).status, 'cancelado', 'voltou ao tempo pago: sem hora extra');
    assert.equal((await as.gestao.act(`/episodios/${ep.id}/duracao`, { hours: '0', minutes: '0' }, { from: `/episodios/${ep.id}` })).status, 302);
    const page = (await as.gestao.get(`/episodios/${ep.id}`)).text;
    assert.match(page, /data-tab-btn="financeiro"/); assert.match(page, /Custo total/); assert.match(page, /2 h 30 min/);
    assert.doesNotMatch((await as.editor.get(`/episodios/${ep.id}`)).text, /Custo total/, 'o editor não vê o financeiro do episódio');
  });

  it('custos automáticos por episódio: nascem no gatilho, vencem pela âncora e acompanham a data', async () => {
    const mk = (f) => as.gestao.act('/financeiro/regras', f, { from: '/financeiro/regras' });
    assert.equal((await mk({ name: 'Edição do episódio', amount: '400,00', category: 'edicao', trigger: 'episodio_gravado', anchor: 'gravacao', offset_days: '7' })).status, 302);
    assert.equal((await mk({ name: 'Pagar editora', amount: '300,00', category: 'edicao', trigger: 'episodio_publicado', anchor: 'gatilho', offset_days: '5' })).status, 302);
    assert.match((await mk({ name: '', amount: '1', trigger: 'episodio_gravado' })).location, /regras/);
    assert.equal((await q('SELECT 1 FROM fin_rules')).length, 2, 'regra sem nome não salva');
    const id = await mkGuest('Dra. Carla', 'gravado', '2026-12-20T18:00:00Z');
    await prod.syncFromGuest(id);
    const ep = await one('SELECT * FROM episodes WHERE guest_id=$1', [id]);
    const ed = await one("SELECT * FROM fin_entries WHERE episode_id=$1 AND category='edicao'", [ep.id]);
    assert.equal(Number(ed.amount_cents), 40000);
    assert.equal(fin.iso(ed.due_on), fin.addDays(fin.iso(ep.recorded_on), 7));
    await as.gestao.act(`/episodios/${ep.id}`, { number: String(ep.number), title: ep.title, recorded_on: '2027-01-10', aired_on: '', notes: '' }, { from: `/episodios/${ep.id}/editar` });
    assert.equal(fin.iso((await one('SELECT due_on FROM fin_entries WHERE id=$1', [ed.id])).due_on), '2027-01-17', 'a conta acompanha a nova data da gravação');
    await fin.onEpisodeStage(ep.id, 'publicado'); await fin.onEpisodeStage(ep.id, 'publicado');
    assert.equal((await entries("episode_id=$1 AND description LIKE 'Pagar editora%'", [ep.id])).length, 1, 'não duplica');
    await prod.syncFromGuest(id); // rodar de novo não repete nada
    assert.equal((await entries("episode_id=$1 AND category='edicao'", [ep.id])).length, 2);
  });

  it('lançamentos: criar parcelado, pagar com outro valor, desfazer, cancelar, excluir e proteger o automático', async () => {
    const r = await as.gestao.act('/financeiro/lancamentos', { direction: 'saida', description: 'Caixas de presente', amount: '900,00', due_on: '2026-11-05', installments: '3', category: 'brindes', supplier: 'Gráfica X' }, { from: '/financeiro/lancamentos' });
    assert.equal(r.status, 302);
    const ps = await entries("description LIKE 'Caixas de presente%'");
    assert.equal(ps.length, 3); assert.deepEqual(ps.map((x) => Number(x.amount_cents)), [30000, 30000, 30000]);
    assert.deepEqual(ps.map((x) => fin.iso(x.due_on)), ['2026-11-05', '2026-12-05', '2027-01-05']);
    assert.match(ps[0].description, /parcela 1\/3/);
    await as.gestao.act(`/financeiro/lancamentos/${ps[0].id}/pagar`, { amount: '310,00', paid_on: '2026-11-04' }, { from: '/financeiro/lancamentos' });
    let p0 = await one('SELECT * FROM fin_entries WHERE id=$1', [ps[0].id]);
    assert.equal(p0.status, 'pago'); assert.equal(Number(p0.amount_cents), 31000); assert.equal(fin.iso(p0.paid_on), '2026-11-04');
    assert.match((await as.gestao.act(`/financeiro/lancamentos/${ps[0].id}/excluir`, {}, { from: '/financeiro/lancamentos' })).location, /lancamentos/);
    assert.ok(await one('SELECT 1 FROM fin_entries WHERE id=$1', [ps[0].id]), 'pago não se exclui');
    await as.gestao.act(`/financeiro/lancamentos/${ps[0].id}/desfazer`, {}, { from: '/financeiro/lancamentos' });
    assert.equal((await one('SELECT status FROM fin_entries WHERE id=$1', [ps[0].id])).status, 'previsto');
    await as.gestao.act(`/financeiro/lancamentos/${ps[1].id}`, { description: 'Caixas (2ª)', amount: '350,00', due_on: '2026-12-10', category: 'brindes' }, { from: '/financeiro/lancamentos' });
    p0 = await one('SELECT * FROM fin_entries WHERE id=$1', [ps[1].id]);
    assert.equal(p0.description, 'Caixas (2ª)'); assert.equal(Number(p0.amount_cents), 35000);
    await as.gestao.act(`/financeiro/lancamentos/${ps[2].id}/excluir`, {}, { from: '/financeiro/lancamentos' });
    assert.equal(await one('SELECT 1 FROM fin_entries WHERE id=$1', [ps[2].id]), undefined);
    const auto = await one("SELECT id FROM fin_entries WHERE auto_key LIKE 'estudio-sinal%' LIMIT 1");
    await as.gestao.act(`/financeiro/lancamentos/${auto.id}/excluir`, {}, { from: '/financeiro/lancamentos' });
    assert.ok(await one('SELECT 1 FROM fin_entries WHERE id=$1', [auto.id]), 'automático só se cancela');
    for (const bad of [{ description: 'a', amount: '10', due_on: '2026-11-01' }, { description: 'Uber', amount: 'abc', due_on: '2026-11-01' }, { description: 'Uber', amount: '10', due_on: '' }]) {
      const before = (await q('SELECT count(*)::int n FROM fin_entries'))[0].n;
      await as.gestao.act('/financeiro/lancamentos', bad, { from: '/financeiro/lancamentos' });
      assert.equal((await q('SELECT count(*)::int n FROM fin_entries'))[0].n, before, JSON.stringify(bad));
    }
  });

  it('custos mensais: lançam os próximos meses sem repetir e se refazem quando mudam', async () => {
    await as.gestao.act('/financeiro/mensais', { name: 'Salário da produtora', amount: '3.500,00', day_of_month: '5', category: 'equipe', starts_on: fin.todayISO() }, { from: '/financeiro/regras' });
    const rec = await one('SELECT * FROM fin_recurring');
    await fin.ensureRecurring(3); await fin.ensureRecurring(3);
    const rows = await entries('recurring_id=$1', [rec.id]);
    assert.ok(rows.length >= 3 && rows.length <= 4, `meses à frente: ${rows.length}`);
    assert.equal(new Set(rows.map((r) => r.auto_key)).size, rows.length);
    await as.gestao.act(`/financeiro/lancamentos/${rows[0].id}/pagar`, {}, { from: '/financeiro' });
    await as.gestao.act(`/financeiro/mensais/${rec.id}`, { name: 'Salário da produtora', amount: '4.000,00', day_of_month: '10', category: 'equipe', starts_on: fin.todayISO() }, { from: '/financeiro/regras' });
    const after = await entries('recurring_id=$1', [rec.id]);
    assert.equal(after.find((r) => r.id === rows[0].id).status, 'pago', 'o que foi pago fica');
    assert.ok(after.filter((r) => r.status === 'previsto').every((r) => Number(r.amount_cents) === 400000));
    await as.gestao.act(`/financeiro/mensais/${rec.id}/excluir`, {}, { from: '/financeiro/regras' });
    assert.equal((await entries("recurring_id IS NOT NULL AND status='previsto'")).length, 0);
  });

  it('patrocínio: parcelas a receber, o primeiro recebimento confirma o pagamento e refazer só mexe no que falta', async () => {
    const sp = await one("INSERT INTO sponsors (company, kind, tier, value_cents, stage) VALUES ('Marca Z','negocio','ouro',600000,'ganho') RETURNING *");
    assert.equal((await as.prod.act(`/patrocinadores/${sp.id}/pagamento`, { installments: '3', first_due: '2026-11-10' }, { from: '/' })).status, 403);
    await as.gestao.act(`/patrocinadores/${sp.id}/pagamento`, { installments: '3', first_due: '2026-11-10' }, { from: `/patrocinadores/${sp.id}` });
    let rows = await entries('sponsor_id=$1', [sp.id]);
    assert.deepEqual(rows.map((r) => Number(r.amount_cents)), [200000, 200000, 200000]);
    assert.ok(rows.every((r) => r.direction === 'entrada' && r.category === 'patrocinio'));
    assert.deepEqual(rows.map((r) => fin.iso(r.due_on)), ['2026-11-10', '2026-12-10', '2027-01-10']);
    assert.equal((await one('SELECT paid_at FROM sponsors WHERE id=$1', [sp.id])).paid_at, null);
    await as.gestao.act(`/financeiro/lancamentos/${rows[0].id}/pagar`, { paid_on: '2026-11-11' }, { from: '/financeiro' });
    assert.equal(fin.iso((await one('SELECT paid_at FROM sponsors WHERE id=$1', [sp.id])).paid_at), '2026-11-11', 'primeiro recebimento confirma o pagamento');
    // refaz o que falta (R$ 4.000) em 2 parcelas
    await as.gestao.act(`/patrocinadores/${sp.id}/pagamento`, { installments: '2', first_due: '2027-01-15' }, { from: `/patrocinadores/${sp.id}` });
    rows = await entries('sponsor_id=$1', [sp.id]);
    assert.equal(rows.length, 3); assert.equal(rows[0].status, 'pago');
    assert.deepEqual(rows.slice(1).map((r) => Number(r.amount_cents)), [200000, 200000]);
    const page = (await as.gestao.get(`/patrocinadores/${sp.id}`)).text;
    assert.match(page, /Recebido/); assert.match(page, /id="modal-pgto"/);
    assert.doesNotMatch((await as.prod.get(`/patrocinadores/${sp.id}`)).text, /id="modal-pgto"/, 'produtora não mexe no financeiro');
    // sem valor, não há o que parcelar
    const sp2 = await one("INSERT INTO sponsors (company, kind, stage) VALUES ('Sem valor','negocio','prospect') RETURNING *");
    await as.gestao.act(`/patrocinadores/${sp2.id}/pagamento`, { installments: '2', first_due: '2026-11-10' }, { from: '/' });
    assert.equal((await entries('sponsor_id=$1', [sp2.id])).length, 0);
  });

  it('estoque: o episódio gravado consome, a previsão avisa antes de acabar e a compra vira conta a pagar', async () => {
    const mk = (f) => as.prod.act('/financeiro/estoque', f, { from: '/financeiro/estoque' });
    assert.equal((await mk({ name: 'Caneca Pulso', qty: '12', per_episode: '1', lead_days: '30', unit_cost: '40,00', supplier: 'Loja Caneca' })).status, 302);
    assert.equal((await mk({ name: 'Cartão de visita', qty: '100', per_episode: '0', min_qty: '20' })).status, 302);
    assert.match((await mk({ name: '' })).location, /estoque/);
    let items = await fin.stockItems();
    const mug = items.find((i) => i.name === 'Caneca Pulso');
    assert.equal(mug.qty, 12); assert.equal(Number(mug.unit_cost_cents), 4000);
    // 4 episódios por mês: 12 canecas = 12 episódios ≈ 90 dias; comprar até 30 dias antes
    assert.equal(mug.episodes, 12);
    assert.equal(mug.runs_out, fin.addDays(fin.todayISO(), 90)); assert.equal(mug.buy_by, fin.addDays(fin.todayISO(), 60)); assert.equal(mug.state, 'ok');
    const id = await mkGuest('Dr. Davi', 'gravado', '2026-12-22T18:00:00Z');
    await prod.syncFromGuest(id); await prod.syncFromGuest(id);
    const ep = await one('SELECT id FROM episodes WHERE guest_id=$1', [id]);
    items = await fin.stockItems();
    assert.equal(items.find((i) => i.name === 'Caneca Pulso').qty, 11, 'um episódio gasta uma caneca, uma vez só');
    assert.equal((await fin.episodeFinance(ep.id)).stockCost, 4000);
    // saldo baixo vira alerta
    await as.prod.act(`/financeiro/estoque/${mug.id}/ajustar`, { acao: 'contagem', qty: '2' }, { from: '/financeiro/estoque' });
    items = await fin.stockItems();
    assert.equal(items.find((i) => i.name === 'Caneca Pulso').qty, 2);
    assert.equal(items.find((i) => i.name === 'Caneca Pulso').state, 'comprar');
    await as.prod.act(`/financeiro/estoque/${mug.id}/ajustar`, { acao: 'perda', qty: '1', note: 'quebrou' }, { from: '/financeiro/estoque' });
    assert.equal((await fin.stockItems()).find((i) => i.name === 'Caneca Pulso').qty, 1);
    const cards = (await as.prod.get('/financeiro/estoque')).text;
    assert.match(cards, /Caneca Pulso/); assert.match(cards, /Comprar agora/);
    assert.doesNotMatch(cards, /Registrar compra/, 'comprar gera conta: só quem mexe no financeiro');
    assert.equal((await as.prod.act(`/financeiro/estoque/${mug.id}/comprar`, { qty: '50', total: '2000', due_on: '2026-12-01' }, { from: '/' })).status, 403);
    // compra de 50 em 2 parcelas
    await as.gestao.act(`/financeiro/estoque/${mug.id}/comprar`, { qty: '50', total: '1.800,00', installments: '2', due_on: '2026-12-01', paid: '1', category: 'brindes' }, { from: '/financeiro/estoque' });
    const buy = await entries('stock_item_id=$1', [mug.id]);
    assert.equal(buy.length, 2); assert.deepEqual(buy.map((r) => Number(r.amount_cents)), [90000, 90000]);
    assert.equal(buy[0].status, 'pago'); assert.equal(buy[1].status, 'previsto');
    const after = (await fin.stockItems()).find((i) => i.name === 'Caneca Pulso');
    assert.equal(after.qty, 51);
    assert.equal(Number(after.unit_cost_cents), Math.round((1 * 4000 + 50 * 3600) / 51), 'custo médio ponderado');
    assert.equal((await as.gestao.get('/financeiro/estoque')).status, 200);
  });

  it('resumo: caixa, atrasos, projeção e custo por episódio; avisos sem repetir; exportação para planilha', async () => {
    await h.db.query("UPDATE fin_settings SET opening_balance_cents=1000000, opening_on='2020-01-01'");
    const ov = await fin.overview();
    assert.equal(ov.forecast.length, 4);
    const { rows: [paid] } = await h.db.query("SELECT coalesce(sum(CASE WHEN direction='entrada' THEN amount_cents ELSE -amount_cents END),0)::bigint v FROM fin_entries WHERE status='pago'");
    assert.equal(ov.cash, 1000000 + Number(paid.v));
    assert.ok(ov.perEpisode.list.length >= 3 && ov.perEpisode.average > 0);
    await as.gestao.act('/financeiro/lancamentos', { direction: 'saida', description: 'Uber dos hosts', amount: '85,50', due_on: '2020-02-02' }, { from: '/financeiro' });
    assert.ok((await fin.overview()).late.out >= 8550, 'o que venceu e não foi pago aparece como atrasado');
    await fin.tick(); await fin.tick();
    const n = await q("SELECT count(*)::int n FROM notifications WHERE type='financeiro' AND title LIKE '%a pagar%'");
    assert.equal(n[0].n, 1, 'um aviso por dia por pessoa (gestão)');
    for (const u of ['/financeiro', '/financeiro/lancamentos', '/financeiro/lancamentos?escopo=receber', '/financeiro/lancamentos?escopo=historico&mes=2026-11', '/financeiro/lancamentos?q=caixas&cat=brindes', '/financeiro/regras']) {
      const r = await as.gestao.get(u); assert.equal(r.status, 200, u);
    }
    assert.match((await as.gestao.get('/financeiro')).text, /Caixa hoje/);
    await as.gestao.act('/financeiro/lancamentos', { direction: 'saida', description: '=SOMA(A1)', amount: '1,00', due_on: '2020-03-03' }, { from: '/financeiro' });
    const csv = await as.gestao.get('/financeiro/exportar.csv');
    assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.ok(csv.text.replace(/^\uFEFF/, '').startsWith('Data;Vencimento'), 'cabeçalho');
    assert.match(csv.text, /'=SOMA\(A1\)/, 'fórmulas não executam na planilha');
    assert.equal((await as.prod.get('/financeiro/exportar.csv')).status, 403);
  });

  it('ajustes do estúdio: valida e vale para as próximas gravações', async () => {
    assert.match((await as.gestao.act('/financeiro/regras/ajustes', { studio_hour: 'x', studio_deposit: '150', studio_minutes: '60', episodes_per_month: '4' }, { from: '/' })).location, /regras/);
    assert.equal((await fin.settings()).studio_hour_cents, 30000);
    await as.gestao.act('/financeiro/regras/ajustes', { studio_hour: '400,00', studio_deposit: '200,00', studio_minutes: '90', episodes_per_month: '2,5', opening_balance: '500,00', opening_on: '2026-01-01' }, { from: '/' });
    const s = await fin.settings();
    assert.equal(s.studio_hour_cents, 40000); assert.equal(s.studio_deposit_cents, 20000); assert.equal(s.studio_minutes, 90); assert.equal(s.episodes_per_month, 2.5);
    const id = await mkGuest('Dr. Eli');
    await prod.syncFromGuest(id);
    assert.equal(Number((await one('SELECT amount_cents FROM fin_entries WHERE guest_id=$1', [id])).amount_cents), 20000);
    await h.db.query("UPDATE guests SET status='gravado' WHERE id=$1", [id]); await prod.syncFromGuest(id);
    assert.equal(Number((await one("SELECT amount_cents FROM fin_entries WHERE description LIKE 'Estúdio · saldo%' AND episode_id=(SELECT id FROM episodes WHERE guest_id=$1)", [id])).amount_cents), 40000, '1h30 × 400 − 200');
  });

  it('busca global acha contas e estoque (só para quem pode ver), o painel inicial resume e apagar limpa o que era automático', async () => {
    const find = async (u, term) => JSON.parse((await u.get(`/busca?q=${encodeURIComponent(term)}`, { headers: { accept: 'application/json' } })).text);
    const flat = (r) => JSON.stringify(r);
    assert.match(flat(await find(as.gestao, 'uber')), /Uber dos hosts/);
    assert.match(flat(await find(as.gestao, 'caneca')), /Caneca Pulso/);
    assert.match(flat(await find(as.prod, 'caneca')), /Caneca Pulso/, 'a produtora enxerga o estoque');
    assert.doesNotMatch(flat(await find(as.prod, 'uber')), /Uber dos hosts/, 'mas não as contas');
    assert.doesNotMatch(flat(await find(as.editor, 'caneca')), /Caneca Pulso/);
    assert.match(flat(await find(as.gestao, 'contas a pagar')), /\/financeiro\/lancamentos/);
    assert.match((await as.gestao.get('/')).text, /money-strip/);
    assert.doesNotMatch((await as.prod.get('/')).text, /money-strip/);
    // apagar o convidado cancela o sinal que ainda não foi pago
    const gid = await mkGuest('Dra. Apagada'); await prod.syncFromGuest(gid);
    assert.equal((await entries('guest_id=$1', [gid])).length, 1);
    assert.equal((await as.gestao.act(`/convidados/${gid}/excluir`, {}, { from: '/convidados' })).status, 302);
    assert.equal((await q("SELECT status FROM fin_entries WHERE auto_key=$1", [`estudio-sinal-g${gid}`]))[0].status, 'cancelado');
    // apagar o episódio devolve o que ele gastou do estoque e cancela as contas automáticas em aberto
    const g2 = await mkGuest('Dr. Apagado', 'gravado', '2026-12-30T18:00:00Z'); await prod.syncFromGuest(g2);
    const ep = await one('SELECT id FROM episodes WHERE guest_id=$1', [g2]);
    const mug = () => fin.stockItems().then((l) => l.find((i) => i.name === 'Caneca Pulso').qty);
    const had = await mug();
    assert.equal((await as.gestao.act(`/episodios/${ep.id}/excluir`, {}, { from: `/episodios/${ep.id}` })).status, 302);
    assert.equal(await mug(), had + 1);
    assert.equal((await q("SELECT count(*)::int n FROM fin_entries WHERE auto_key LIKE '%-e'||$1 AND status='previsto'", [ep.id]))[0].n, 0);
    // apagar o patrocinador tira as parcelas ainda a receber
    const sp = await one("INSERT INTO sponsors (company, kind, tier, value_cents, stage) VALUES ('Marca Apagada','negocio','ouro',100000,'ganho') RETURNING id");
    await as.gestao.act(`/patrocinadores/${sp.id}/pagamento`, { installments: '2', first_due: '2027-03-01' }, { from: '/' });
    assert.equal((await entries('sponsor_id=$1', [sp.id])).length, 2);
    await as.gestao.act(`/patrocinadores/${sp.id}/excluir`, {}, { from: '/patrocinadores' });
    assert.equal((await q("SELECT count(*)::int n FROM fin_entries WHERE description LIKE 'Patrocínio Marca Apagada%'"))[0].n, 0);
  });
});
