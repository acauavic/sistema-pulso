const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const fin = require('../src/services/finance');
const prod = require('../src/services/production');
const bank = require('../src/services/hourBank');

// Banco de horas do estúdio: a partir do episódio de início, as gravações saem de um pacote de horas comprado
// (sem sinal, saldo ou hora extra por episódio). Convidado agendado reserva, episódio gravado usa.
describe('banco de horas do estúdio', () => {
  const as = {}; let app;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const one = (sql, p) => q(sql, p).then((r) => r[0]);
  const byKey = (k) => one('SELECT * FROM fin_entries WHERE auto_key = $1', [k]);
  const mkGuest = async (name, status = 'agendado', at = '2026-12-10T18:00:00Z') => (await one(
    "INSERT INTO guests (name, status, proposed_at, email, scheduled_studio, scheduled_hosts, scheduled_guest) VALUES ($1,$2,$3,'a@b.com',true,true,true) RETURNING *", [name, status, at])).id;
  // convidado agendado (lança o sinal no modelo antigo) que depois grava na data dada
  const record = async (guestId, recordedOn) => {
    await h.db.query("UPDATE guests SET status = 'gravado' WHERE id = $1", [guestId]);
    return prod.createEpisode({ title: `Conversa ${guestId}`, guestId, recordedOn });
  };
  const pay = (id) => as.gestao.act(`/financeiro/lancamentos/${id}/pagar`, {}, { from: '/financeiro' });
  const ids = {};

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }

    // modelo antigo (por hora): A gravou antes do corte com sinal pago; B antes do corte sem pagar nada
    ids.gA = await mkGuest('Dra. Antes'); await prod.syncFromGuest(ids.gA);
    await pay((await byKey(`estudio-sinal-g${ids.gA}`)).id);
    ids.A = (await record(ids.gA, '2026-11-01')).id;
    ids.gB = await mkGuest('Dr. Bento'); await prod.syncFromGuest(ids.gB);
    ids.B = (await record(ids.gB, '2026-11-05')).id;
    // S = episódio de início (sinal pago, saldo em aberto); T gravou depois (tudo em aberto)
    ids.gS = await mkGuest('Sandro Ferraz'); await prod.syncFromGuest(ids.gS);
    await pay((await byKey(`estudio-sinal-g${ids.gS}`)).id);
    ids.S = (await record(ids.gS, '2026-11-14')).id;
    ids.gT = await mkGuest('Dra. Teresa'); await prod.syncFromGuest(ids.gT);
    ids.T = (await record(ids.gT, '2026-11-16')).id;
    // F: gravação marcada, ainda sem episódio (sinal em aberto)
    ids.gF = await mkGuest('Dr. Futuro'); await prod.syncFromGuest(ids.gF);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('desligado: o Financeiro não mostra o cartão e os ajustes oferecem "Ligar banco de horas"', async () => {
    assert.equal((await bank.status()).active, false);
    const page = await as.gestao.get('/financeiro');
    assert.equal(page.status, 200);
    assert.doesNotMatch(page.text, /bank-card|Registrar compra/); // (o aviso de novidades da versão também cita o banco: confere o cartão)
    const rules = (await as.gestao.get('/financeiro/regras')).text;
    assert.match(rules, /Ligar banco de horas/);
    assert.match(rules, /Por hora: <span class="mono">R\$\s300,00\/h<\/span>, sinal <span class="mono">R\$\s150,00<\/span>/);
    assert.match(rules, /O que já foi pago fica como está/);
    // no modelo antigo, nada mudou: saldo de S e de T em aberto
    assert.equal((await byKey(`estudio-saldo-e${ids.S}`)).status, 'previsto');
    assert.equal((await byKey(`estudio-saldo-e${ids.T}`)).status, 'previsto');
  });

  it('permissões: só quem escreve no Financeiro liga o banco e registra compra; a produtora não vê', async () => {
    const before = await fin.settings();
    assert.equal((await as.prod.act('/financeiro/banco/ligar', { start_episode_id: String(ids.S), bought_on: '2026-11-14', hours: '20', amount: '5.000,00' }, { from: '/' })).status, 403);
    assert.equal((await as.prod.act('/financeiro/banco/compras', { bought_on: '2026-11-14', hours: '20', amount: '5.000,00' }, { from: '/' })).status, 403);
    assert.equal((await fin.settings()).studio_mode, before.studio_mode);
    assert.equal((await q('SELECT 1 FROM fin_hour_packs')).length, 0);
    assert.equal((await as.prod.get('/financeiro')).status, 403);
  });

  it('ligar valida os dados e não deixa compra sem horas', async () => {
    for (const bad of [{ start_episode_id: '999999', hours: '20' }, { start_episode_id: String(ids.S), hours: '0' }, { start_episode_id: String(ids.S), hours: 'abc' }]) {
      const r = await as.gestao.act('/financeiro/banco/ligar', { bought_on: '2026-11-14', amount: '5.000,00', ...bad }, { from: '/financeiro/regras' });
      assert.equal(r.status, 302); assert.match(r.location, /\/financeiro\/regras/);
      assert.equal((await fin.settings()).studio_mode, 'hora', JSON.stringify(bad));
    }
    assert.equal((await q('SELECT 1 FROM fin_hour_packs')).length, 0);
  });

  it('ligar: cancela só o estúdio em aberto do banco (episódios a partir do início e convidados agendados); o pago fica', async () => {
    const r = await as.gestao.act('/financeiro/banco/ligar', { start_episode_id: String(ids.S), bought_on: '2026-11-14', hours: '20', amount: '5.000,00', note: 'Primeiro pacote' }, { from: '/financeiro/regras' });
    assert.equal(r.status, 302); assert.equal(r.location, '/financeiro');
    const s = await fin.settings();
    assert.equal(s.studio_mode, 'banco'); assert.equal(s.studio_bank_start_episode_id, ids.S);
    // antes do corte: intocado
    assert.equal((await byKey(`estudio-sinal-g${ids.gA}`)).status, 'pago');
    assert.equal((await byKey(`estudio-saldo-e${ids.A}`)).status, 'previsto');
    assert.equal((await byKey(`estudio-saldo-e${ids.B}`)).status, 'previsto');
    assert.equal((await byKey(`estudio-sinal-g${ids.gB}`)).status, 'previsto');
    // no banco: o previsto sai pelo sistema, o pago fica
    const saldoS = await byKey(`estudio-saldo-e${ids.S}`);
    assert.equal(saldoS.status, 'cancelado'); assert.equal(saldoS.cancel_reason, 'sistema');
    assert.equal((await byKey(`estudio-sinal-g${ids.gS}`)).status, 'pago', 'sinal pago não vira crédito nem é cancelado');
    assert.equal((await byKey(`estudio-saldo-e${ids.T}`)).status, 'cancelado');
    assert.equal((await byKey(`estudio-sinal-g${ids.gT}`)).status, 'cancelado');
    const sinalF = await byKey(`estudio-sinal-g${ids.gF}`);
    assert.equal(sinalF.status, 'cancelado'); assert.equal(sinalF.cancel_reason, 'sistema');
    // a compra: despesa paga de estúdio, ligada ao pacote
    const pack = await one('SELECT * FROM fin_hour_packs');
    assert.equal(Number(pack.hours), 20); assert.equal(Number(pack.amount_cents), 500000); assert.equal(pack.note, 'Primeiro pacote');
    const entry = await one('SELECT * FROM fin_entries WHERE id = $1', [pack.entry_id]);
    assert.equal(entry.direction, 'saida'); assert.equal(entry.category, 'estudio'); assert.equal(entry.status, 'pago');
    assert.equal(fin.iso(entry.paid_on), '2026-11-14'); assert.equal(Number(entry.amount_cents), 500000);
    assert.equal(entry.description, 'Estúdio · banco de horas (20 h)');
    assert.ok(await one("SELECT 1 FROM audit_log WHERE action = 'financeiro.banco_ligado'"), 'auditoria');
    // ligar de novo não faz nada
    await as.gestao.act('/financeiro/banco/ligar', { start_episode_id: String(ids.T), bought_on: '2026-11-14', hours: '20', amount: '5.000,00' }, { from: '/financeiro/regras' });
    assert.equal((await fin.settings()).studio_bank_start_episode_id, ids.S);
    assert.equal((await q('SELECT 1 FROM fin_hour_packs')).length, 1);
  });

  it('o episódio de início conta (60 min = 1 h); T usa, F reserva; disponível = comprado − usado − reservado', async () => {
    const st = await bank.status();
    assert.equal(st.active, true);
    assert.equal(st.purchasedHours, 20);
    assert.deepEqual(st.used.map((u) => u.id).sort(), [ids.S, ids.T].sort());
    assert.equal(st.used.find((u) => u.id === ids.S).minutes, 60);
    assert.equal(st.usedHours, 2);
    assert.deepEqual(st.reserved.map((g) => g.id), [ids.gF]);
    assert.equal(st.reservedHours, 1);
    assert.equal(st.availableHours, 17);
    assert.equal(st.alertHours, 3); assert.equal(st.low, false);
    assert.equal(st.packs.length, 1);
    assert.equal(await bank.isBankEpisode(ids.S), true);
    assert.equal(await bank.isBankEpisode(ids.B), false);
  });

  it('episódios antes do início continuam no modelo antigo (saldo refeito, sinal e saldo para gravação antiga lançada agora)', async () => {
    await fin.setDuration(ids.B, 120);
    const saldoB = await byKey(`estudio-saldo-e${ids.B}`);
    assert.equal(saldoB.status, 'previsto'); assert.equal(Number(saldoB.amount_cents), 60000 - 15000, '2 h × R$ 300 − sinal');
    // gravação antiga registrada só agora (10/11, antes do Sandro): ganha sinal e saldo como antes
    const gOld = await mkGuest('Dr. Atrasado', 'agendado', '2026-11-10T18:00:00Z');
    await fin.syncGuest(gOld);
    assert.equal((await byKey(`estudio-sinal-g${gOld}`)), undefined, 'convidado agendado sem episódio é do banco: sem sinal');
    const old = await record(gOld, '2026-11-10');
    assert.equal((await byKey(`estudio-saldo-e${old.id}`)).status, 'previsto', 'episódio antes do corte: saldo do modelo antigo');
    assert.equal(Number((await byKey(`estudio-saldo-e${old.id}`)).amount_cents), 30000);
    assert.equal((await bank.status()).used.some((u) => u.id === old.id), false, 'não entra no banco');
  });

  it('com o banco ligado, agendar não lança sinal e reserva a duração esperada', async () => {
    ids.gN = await mkGuest('Dra. Nova', 'agendado', '2026-12-20T18:00:00Z');
    await prod.syncFromGuest(ids.gN); await prod.syncFromGuest(ids.gN);
    assert.equal((await q("SELECT 1 FROM fin_entries WHERE guest_id = $1 AND auto_key LIKE 'estudio-%' AND status <> 'cancelado'", [ids.gN])).length, 0);
    const st = await bank.status();
    assert.ok(st.reserved.some((g) => g.id === ids.gN && g.minutes === 60 && g.name === 'Dra. Nova'));
    assert.equal(st.reservedHours, 2); assert.equal(st.availableHours, 16);
  });

  it('gravar no banco não lança saldo nem hora extra e move as horas de reservadas para usadas (duração real ou 60 min)', async () => {
    const ep = await record(ids.gN, '2026-12-20');
    ids.N = ep.id;
    assert.equal((await q("SELECT 1 FROM fin_entries WHERE episode_id = $1 AND auto_key LIKE 'estudio-%' AND status <> 'cancelado'", [ep.id])).length, 0);
    let st = await bank.status();
    assert.equal(st.reservedHours, 1); assert.equal(st.usedHours, 3); assert.equal(st.availableHours, 16);
    await as.gestao.act(`/episodios/${ep.id}/duracao`, { hours: '1', minutes: '30' }, { from: `/episodios/${ep.id}` });
    assert.equal((await q("SELECT 1 FROM fin_entries WHERE episode_id = $1 AND auto_key LIKE 'estudio-%' AND status <> 'cancelado'", [ep.id])).length, 0, 'sem hora extra');
    st = await bank.status();
    assert.equal(st.used.find((u) => u.id === ep.id).minutes, 90);
    assert.equal(st.usedHours, 3.5); assert.equal(st.availableHours, 15.5);
    // recalcular o episódio de início não ressuscita o saldo cancelado
    await fin.recomputeStudio(ids.S);
    assert.equal((await byKey(`estudio-saldo-e${ids.S}`)).status, 'cancelado');
  });

  it('convidado agendado que desiste (perdido ou cancelado) devolve a reserva', async () => {
    await h.db.query("UPDATE guests SET status = 'perdido', loss_reason = 'outros', loss_note = 'desistiu' WHERE id = $1", [ids.gF]);
    await prod.syncFromGuest(ids.gF);
    const st = await bank.status();
    assert.equal(st.reserved.some((g) => g.id === ids.gF), false);
    assert.equal(st.reservedHours, 0); assert.equal(st.availableHours, 16.5);
    assert.equal((await byKey(`estudio-sinal-g${ids.gF}`)).status, 'cancelado');
  });

  it('o Financeiro mostra o cartão com horas, barra sem estilo inline e "Registrar compra"', async () => {
    const page = (await as.gestao.get('/financeiro')).text;
    assert.match(page, /<section class="card bank-card" id="banco-de-horas"[\s\S]*?Banco de horas do estúdio<\/h2>/);
    assert.match(page, /16,5 h/);
    assert.match(page, /<span class="mono muted">de 20 h<\/span>/);
    assert.match(page, /USADAS 3,5 H · RESERVADAS 0 H/);
    assert.match(page, /Registrar compra/);
    assert.match(page, /<svg class="goal-bar bank-bar[^"]*"[^>]*><rect class="bg"[^>]*\/><rect class="fg" width="83"/);
    assert.doesNotMatch(page, /bank-bar[^>]*style=/);
    assert.match(page, /Ver uso/); assert.match(page, /Sandro Ferraz|Conversa/);
    assert.doesNotMatch(page, /class="notice[^"]*"[^>]*>[^<]*Banco de horas/, 'sem aviso enquanto sobra');
    const rules = (await as.gestao.get('/financeiro/regras')).text;
    assert.doesNotMatch(rules, /Ligar banco de horas/);
    assert.match(rules, /Avisar quando restarem \(horas\)/);
  });

  it('registrar compra lança a despesa paga e aumenta as horas compradas', async () => {
    const bad = await as.gestao.act('/financeiro/banco/compras', { bought_on: '2026-11-20', hours: '-1', amount: '100,00' }, { from: '/financeiro' });
    assert.equal(bad.status, 302);
    assert.equal((await q('SELECT 1 FROM fin_hour_packs')).length, 1);
    const r = await as.gestao.act('/financeiro/banco/compras', { bought_on: '2026-11-20', hours: '10,5', amount: '2.625,00' }, { from: '/financeiro' });
    assert.equal(r.status, 302); assert.equal(r.location, '/financeiro');
    const st = await bank.status();
    assert.equal(st.purchasedHours, 30.5); assert.equal(st.availableHours, 27);
    const pack = await one('SELECT * FROM fin_hour_packs ORDER BY id DESC LIMIT 1');
    const e = await one('SELECT * FROM fin_entries WHERE id = $1', [pack.entry_id]);
    assert.equal(e.status, 'pago'); assert.equal(Number(e.amount_cents), 262500); assert.equal(e.description, 'Estúdio · banco de horas (10,5 h)');
  });

  it('aviso de renovar: limite ajustável, faixa no Financeiro e no Início, rotina avisa a gestão uma vez por dia e faixa', async () => {
    const notes = () => q("SELECT * FROM notifications WHERE type = 'financeiro' AND title LIKE 'Banco de horas%' ORDER BY id");
    await fin.tick();
    assert.equal((await notes()).length, 0, 'sobra: sem aviso');
    // limite ajustável nos ajustes do Financeiro
    const base = { studio_hour: '300,00', studio_deposit: '150,00', studio_minutes: '60', episodes_per_month: '4' };
    await as.gestao.act('/financeiro/regras/ajustes', { ...base, studio_bank_alert_hours: 'x' }, { from: '/financeiro/regras' });
    assert.equal((await bank.status()).alertHours, 3, 'valor inválido não salva');
    await as.gestao.act('/financeiro/regras/ajustes', { ...base, studio_bank_alert_hours: '27' }, { from: '/financeiro/regras' });
    let st = await bank.status();
    assert.equal(st.alertHours, 27); assert.equal(st.low, true, 'disponível 27 <= 27');
    await fin.tick(); await fin.tick();
    let n = await notes();
    assert.equal(n.length, 1, 'uma vez por dia e faixa');
    assert.equal(n[0].title, 'Banco de horas do estúdio: restam 27 h (com as gravações marcadas). Hora de renovar.');
    assert.equal(n[0].url, '/financeiro');
    let page = (await as.gestao.get('/financeiro')).text;
    assert.match(page, /<div class="notice"[^>]*>[\s\S]*?restam 27 h/);
    assert.match(page, /bank-bar is-low/);
    const home = (await as.gestao.get('/')).text;
    assert.match(home, /class="notice"[\s\S]*?Banco de horas do estúdio: restam 27 h/);
    assert.doesNotMatch((await as.prod.get('/')).text, /Banco de horas do estúdio: restam/, 'a produtora não vê o dinheiro');
    // acabou: gravações continuam e o disponível fica negativo (saldo devedor)
    await as.gestao.act('/financeiro/regras/ajustes', { ...base, studio_bank_alert_hours: '3' }, { from: '/financeiro/regras' });
    await fin.setDuration(ids.T, 1440); await fin.setDuration(ids.N, 600);
    st = await bank.status();
    assert.equal(st.availableHours, 30.5 - (1 + 24 + 10) - 0);
    assert.ok(st.availableHours < 0); assert.equal(st.low, true);
    assert.equal((await q("SELECT 1 FROM fin_entries WHERE episode_id IN ($1,$2) AND auto_key LIKE 'estudio-%' AND status = 'previsto'", [ids.T, ids.N])).length, 0);
    await fin.tick();
    n = await notes();
    assert.equal(n.length, 2, 'nova faixa (acabou) avisa de novo no mesmo dia');
    assert.match(n[1].title, /Banco de horas do estúdio: acabou, 4,5 h além do comprado/);
    page = (await as.gestao.get('/financeiro')).text;
    assert.match(page, /<div class="notice notice-bad"/);
    assert.match(page, /bank-bar is-neg/);
    assert.match(page, /−4,5 h/);
    // a próxima compra cobre o devedor primeiro
    await as.gestao.act('/financeiro/banco/compras', { bought_on: '2026-11-21', hours: '20', amount: '5.000,00' }, { from: '/financeiro' });
    assert.equal((await bank.status()).availableHours, 15.5);
  });
});
