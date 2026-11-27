// Dinheiro por projeto: todo lançamento tem dono ou divisão (nunca os dois), o vínculo manda, quem é de um projeto vê
// só o dele mais a parte dele nos compartilhados, a soma dos projetos é o consolidado, e o banco de horas tem cota por projeto.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const fin = require('../src/services/finance');
const owner = require('../src/services/finOwner');
const hourBank = require('../src/services/hourBank');

const PULSO = 1; const P100 = 2;

describe('dinheiro por projeto', () => {
  const as = {}; let app;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const one = (sql, p) => q(sql, p).then((r) => r[0]);
  const splitsOf = (id) => q('SELECT project_id, amount_cents::int AS cents FROM fin_entry_splits WHERE entry_id = $1 ORDER BY project_id', [id]);

  before(async () => {
    await h.resetDb();
    // a gestão da casa vê os dois projetos; a do Projeto 100 vê só o dela (com o financeiro ligado)
    await h.createUser({ name: 'Casa', email: 'casa@local.test', role: 'gestao', projects: [PULSO, P100] });
    await h.createUser({ name: 'Cem', email: 'cem@local.test', role: 'gestao', projects: [P100] });
    app = await h.startServer();
    for (const k of ['casa', 'cem']) { as[k] = h.client(app.base); await as[k].login(`${k}@local.test`); }
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('migração: o que existia é do Pulso, e a cota do pacote de horas também', async () => {
    const e = await one("INSERT INTO fin_entries (direction, category, description, amount_cents, due_on) VALUES ('saida','outros','Herdado',1000,'2026-12-01') RETURNING *");
    assert.equal(Number(e.project_id), PULSO, 'lançamento sem projeto informado cai no Pulso (rede de segurança)');
    const r = await hourBank.addPack({ boughtOn: '2026-11-01', hours: 20, amountCents: 600000 });
    assert.ok(r.ok);
    const cota = await q('SELECT project_id, hours::float AS hours FROM fin_hour_quotas WHERE pack_id = $1', [r.pack.id]);
    assert.deepEqual(cota, [{ project_id: PULSO, hours: 20 }], 'a primeira compra entra inteira no projeto padrão');
    await h.db.query('DELETE FROM fin_hour_quotas'); await h.db.query('DELETE FROM fin_hour_packs'); await h.db.query('DELETE FROM fin_entries');
  });

  it('o vínculo manda: o custo do vídeo e a receita do contrato caem no projeto deles', async () => {
    const g = await one("INSERT INTO guests (name, status, project_id) VALUES ('Dr. Cem','gravado',$1) RETURNING id", [P100]);
    const ep = await one("INSERT INTO episodes (title, guest_id, project_id, number, status, recorded_on) VALUES ('Vídeo 1',$1,$2,1,'gravado','2026-11-10') RETURNING id", [g.id, P100]);
    const sp = await one("INSERT INTO sponsors (company, stage, project_id, value_cents) VALUES ('Marca X','ganho',$1,500000) RETURNING *", [P100]);

    const r = await as.casa.act('/financeiro/lancamentos', {
      description: 'Edição do vídeo', amount: '400,00', due_on: '2026-12-05', direction: 'saida', episode_id: String(ep.id), de_quem: String(PULSO),
    }, { from: '/financeiro/lancamentos' });
    assert.ok([302, 303].includes(r.status));
    const custo = await one("SELECT * FROM fin_entries WHERE description = 'Edição do vídeo'");
    assert.equal(Number(custo.project_id), P100, 'o episódio é do Projeto 100: o custo também, mesmo com outra escolha na tela');

    await fin.planSponsorPayment({ ...sp, value_cents: 500000 }, { installments: 2, firstDue: '2026-12-01' });
    const parcelas = await q("SELECT project_id FROM fin_entries WHERE sponsor_id = $1 AND direction = 'entrada'", [sp.id]);
    assert.equal(parcelas.length, 2);
    assert.ok(parcelas.every((p) => Number(p.project_id) === P100), 'a receita do patrocínio é do projeto do contrato');
  });

  it('compartilhado: a divisão soma o valor, nunca com projeto, e a soma dos projetos é o consolidado', async () => {
    await h.db.query('DELETE FROM fin_entries');
    const r = await as.casa.act('/financeiro/lancamentos', {
      description: 'Contador da casa', amount: '300,00', due_on: '2026-12-10', direction: 'saida', de_quem: 'compartilhado', parte_1: '200,00', parte_2: '100,00',
    }, { from: '/financeiro/lancamentos' });
    assert.ok([302, 303].includes(r.status));
    const e = await one("SELECT * FROM fin_entries WHERE description = 'Contador da casa'");
    assert.equal(e.project_id, null, 'compartilhado não tem projeto');
    assert.deepEqual(await splitsOf(e.id), [{ project_id: PULSO, cents: 20000 }, { project_id: P100, cents: 10000 }]);

    // divisão que não soma o valor volta com erro e não cria nada
    const bad = await as.casa.act('/financeiro/lancamentos', {
      description: 'Não deve existir', amount: '300,00', due_on: '2026-12-10', direction: 'saida', de_quem: 'compartilhado', parte_1: '200,00', parte_2: '50,00',
    }, { from: '/financeiro/lancamentos' });
    assert.ok([302, 303].includes(bad.status));
    assert.equal((await q("SELECT 1 FROM fin_entries WHERE description = 'Não deve existir'")).length, 0);

    // consolidado = soma das partes
    const todos = await fin.entries({ scope: 'pagar', pids: [PULSO, P100] });
    const soPulso = await fin.entries({ scope: 'pagar', pids: [PULSO] });
    const soCem = await fin.entries({ scope: 'pagar', pids: [P100] });
    const soma = (list) => list.reduce((a, x) => a + x.share_cents, 0);
    assert.equal(soma(todos), 30000);
    assert.equal(soma(soPulso) + soma(soCem), soma(todos), 'a soma dos projetos é o consolidado');
    assert.equal(soma(soCem), 10000);
  });

  it('quem é de um projeto só vê a parte dele, e o que é do outro responde 404', async () => {
    await h.db.query('DELETE FROM fin_entries');
    const soPulso = await one("INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, project_id) VALUES ('saida','outros','Café do Pulso',5000,'2026-12-02',$1) RETURNING *", [PULSO]);
    const dividido = await one("INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, project_id) VALUES ('saida','outros','Contador',30000,'2026-12-03',NULL) RETURNING *");
    await owner.save(dividido.id, { weights: { [PULSO]: 2, [P100]: 1 }, amount: 30000 });

    const page = await as.cem.get('/financeiro/lancamentos');
    assert.equal(page.status, 200);
    assert.doesNotMatch(page.text, /Café do Pulso/, 'nada do outro projeto aparece');
    assert.match(page.text, /Contador/);
    assert.match(page.text, /parte deste projeto|compartilhado/);
    assert.match(page.text, /100,00/, 'o valor que aparece é a parte dele (1 de 3 de R$ 300)');

    // ação num lançamento de outro projeto: 404, e nada muda
    const r = await as.cem.act(`/financeiro/lancamentos/${soPulso.id}/pagar`, { amount: '50,00', paid_on: '2026-12-02' }, { from: '/financeiro/lancamentos' });
    assert.equal(r.status, 404);
    assert.equal((await one('SELECT status FROM fin_entries WHERE id = $1', [soPulso.id])).status, 'previsto');
  });

  it('custo mensal guarda o dono e repassa a cada mês; a regra do projeto só vale nele', async () => {
    await h.db.query('DELETE FROM fin_entries'); await h.db.query('DELETE FROM fin_recurring'); await h.db.query('DELETE FROM fin_rules');
    const hoje = fin.todayISO();
    await as.casa.act('/financeiro/mensais', {
      name: 'Hospedagem', category: 'outros', amount: '100,00', day_of_month: '5', starts_on: hoje, de_quem: 'compartilhado', parte_1: '60,00', parte_2: '40,00',
    }, { from: '/financeiro/regras#mensais' });
    const rec = await one("SELECT * FROM fin_recurring WHERE name = 'Hospedagem'");
    assert.equal(rec.project_id, null);
    assert.deepEqual(rec.split, { 1: 6000, 2: 4000 });
    const meses = await q("SELECT id FROM fin_entries WHERE recurring_id = $1 ORDER BY due_on", [rec.id]);
    assert.ok(meses.length >= 1, 'o custo mensal já nasceu nos próximos meses');
    for (const m of meses) assert.deepEqual(await splitsOf(m.id), [{ project_id: PULSO, cents: 6000 }, { project_id: P100, cents: 4000 }]);

    // regra que vale só no Projeto 100 não nasce em episódio do Pulso
    await as.casa.act('/financeiro/regras', { name: 'Edição vertical', category: 'edicao', trigger: 'episodio_gravado', amount: '200,00', anchor: 'gatilho', offset_days: '0', vale_para: String(P100) }, { from: '/financeiro/regras' });
    const regra = await one("SELECT * FROM fin_rules WHERE name = 'Edição vertical'");
    assert.equal(Number(regra.project_id), P100);
    const epPulso = await one("INSERT INTO episodes (title, project_id, number, status, recorded_on) VALUES ('Ep do Pulso',$1,90,'gravado','2026-11-11') RETURNING id", [PULSO]);
    const epCem = await one("INSERT INTO episodes (title, project_id, number, status, recorded_on) VALUES ('Vídeo do Cem',$1,90,'gravado','2026-11-11') RETURNING id", [P100]);
    await fin.onEpisodeCreated(epPulso.id); await fin.onEpisodeCreated(epCem.id);
    assert.equal((await q('SELECT 1 FROM fin_entries WHERE rule_id = $1 AND episode_id = $2', [regra.id, epPulso.id])).length, 0);
    const nasceu = await q('SELECT project_id FROM fin_entries WHERE rule_id = $1 AND episode_id = $2', [regra.id, epCem.id]);
    assert.equal(nasceu.length, 1);
    assert.equal(Number(nasceu[0].project_id), P100);
  });

  it('banco de horas: cota por projeto, aviso de quem passou e a compra dividida pelo uso', async () => {
    await h.db.query('DELETE FROM fin_entries'); await h.db.query('DELETE FROM fin_hour_packs');
    await h.db.query('DELETE FROM episodes'); await h.db.query('DELETE FROM guests');
    // liga o banco num episódio do Pulso e compra 20 h por R$ 6.000 (R$ 300/h)
    const ep0 = await one("INSERT INTO episodes (title, project_id, number, status, recorded_on, recording_minutes) VALUES ('Início',$1,1,'gravado','2026-11-01',120) RETURNING id", [PULSO]);
    const on = await hourBank.activate({ startEpisodeId: ep0.id, pack: { hours: 20, amountCents: 600000 } });
    assert.ok(on.ok, on.error);
    // o Projeto 100 grava 3 h
    const epCem = await one("INSERT INTO episodes (title, project_id, number, status, recorded_on, recording_minutes) VALUES ('Vídeo',$1,1,'gravado','2026-11-05',180) RETURNING id", [P100]);
    await fin.onEpisodeCreated(epCem.id);

    const st = await hourBank.status({ pids: [PULSO, P100] });
    assert.equal(st.usedHours, 5, '2 h do Pulso + 3 h do Projeto 100');
    const linha = (id) => st.byProject.find((l) => l.project.id === id);
    assert.equal(linha(PULSO).used, 2); assert.equal(linha(P100).used, 3);
    assert.equal(linha(PULSO).quota, 20, 'a compra nasceu com a cota inteira no projeto padrão');

    // ajustar cotas: 10 e 10, e o Projeto 100 passa da cota quando grava 12 h
    const pack = st.lastPack;
    const r = await as.casa.act('/financeiro/banco/cotas', { pack_id: String(pack.id), cota_1: '10', cota_2: '10' }, { from: '/financeiro' });
    assert.ok([302, 303].includes(r.status));
    const st2 = await hourBank.status({ pids: [PULSO, P100] });
    assert.equal(st2.byProject.find((l) => l.project.id === P100).quota, 10);

    // a despesa da compra: 2 h do Pulso + 3 h do Cem usadas, 15 h a usar seguem a cota (10/10 -> 7,5 e 7,5)
    const compra = await one('SELECT * FROM fin_entries WHERE id = (SELECT entry_id FROM fin_hour_packs WHERE id = $1)', [pack.id]);
    assert.equal(compra.project_id, null, 'a compra de horas é compartilhada');
    const partes = await splitsOf(compra.id);
    const soma = partes.reduce((a, p) => a + p.cents, 0);
    assert.equal(soma, 600000, 'a divisão soma o valor da compra');
    const parte = (id) => partes.find((p) => p.project_id === id).cents;
    assert.equal(parte(PULSO), Math.round(600000 * (2 + 7.5) / 20));
    assert.equal(parte(P100), 600000 - parte(PULSO));

    // passou da cota: o cartão avisa
    await h.db.query('UPDATE episodes SET recording_minutes = 720 WHERE id = $1', [epCem.id]);
    await fin.setDuration(epCem.id, 720);
    const st3 = await hourBank.status({ pids: [PULSO, P100] });
    assert.equal(st3.byProject.find((l) => l.project.id === P100).over, 2, '12 h usadas contra 10 de cota');
    const page = await as.casa.get('/financeiro');
    assert.match(page.text, /passou 2 h da cota/);
  });

  it('a tela pergunta de quem é, com a divisão escondida até escolher compartilhado', async () => {
    const page = await as.casa.get('/financeiro/lancamentos');
    assert.equal(page.status, 200);
    assert.match(page.text, /De quem é/);
    assert.match(page.text, /name="de_quem" value="1"/);
    assert.match(page.text, /name="de_quem" value="compartilhado"/);
    assert.match(page.text, /data-when="de_quem=compartilhado"/, 'a divisão só aparece no compartilhado');
    assert.match(page.text, /name="parte_1"[\s\S]*name="parte_2"/, 'um valor por projeto');
    // o custo mensal e a compra de estoque perguntam o mesmo
    assert.match((await as.casa.get('/financeiro/regras')).text, /name="de_quem"/);
    assert.match((await as.casa.get('/financeiro/estoque')).text, /name="de_quem"/);
    // e a regra por episódio pergunta em que projeto ela vale
    assert.match((await as.casa.get('/financeiro/regras')).text, /name="vale_para"[\s\S]*Todos os projetos/);
  });

  it('um projeto só: nenhuma tela mostra seletor nem campo de projeto', async () => {
    const page = await as.cem.get('/financeiro/lancamentos');
    assert.doesNotMatch(page.text, /De quem é/, 'quem vê um projeto só não escolhe projeto');
    assert.doesNotMatch(page.text, /name="de_quem"/);
  });
});
