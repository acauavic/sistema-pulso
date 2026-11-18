// Resumo do dia, patrocínio: o registro automático das etapas do patrocinador, o passado refeito pela linha do tempo e cada número
// do dia (entrou em prospecção, foi abordado, recebeu follow-up, mostrou interesse, fechou, foi perdido) e a cadência no fim dele.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const cal = require('../src/services/calendar');
const ds = require('../src/services/daySummary');

describe('Resumo do dia: patrocínio', () => {
  const today = cal.todayISO();
  const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
  let D = cal.addDays(today, -14);
  while (weekday(D) !== 3) D = cal.addDays(D, -1); // uma quarta-feira no passado: os follow-ups não dependem do dia em que a suíte roda
  const at = (d, hm = '10:00') => `${d} ${hm}:00-03`; // hora de Brasília
  const q = (sql, p) => h.db.query(sql, p);
  let app; const as = {};
  const sponsor = async (company, stage, created = at(cal.addDays(D, -10))) => (await q(
    'INSERT INTO sponsors (company, stage, created_at, stage_entered_at) VALUES ($1, $2, $3, $3) RETURNING id', [company, stage, created])).rows[0].id;
  const log = (id, from, to, when) => q('INSERT INTO sponsor_stage_log (sponsor_id, from_stage, to_stage, changed_at) VALUES ($1, $2, $3, $4)', [id, from, to, when]);
  const moves = async (id) => (await q('SELECT from_stage, to_stage FROM sponsor_stage_log WHERE sponsor_id = $1 ORDER BY changed_at, id', [id])).rows.map((r) => `${r.from_stage || '·'}>${r.to_stage}`);
  const send = (id, when, { channel = 'whatsapp', result = 'enviado', created = when } = {}) => q(
    "INSERT INTO outreach_attempts (subject_type, subject_id, channel, result, at, created_at) VALUES ('sponsor', $1, $2, $3, $4, $5)", [id, channel, result, when, created]);
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
  const STAGES = ['entered', 'interested', 'closed', 'lost', 'prospecting', 'negotiating', 'active'];

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    for (const [k, name, role] of [['gestao', 'Gil Gestão', 'gestao'], ['prod', 'Paula Produtora', 'produtora'], ['editor', 'Edu Editor', 'editor_video']]) {
      await h.createUser({ name, email: `${k}@t.com`, role });
      as[k] = h.client(app.base); assert.equal((await as[k].login(`${k}@t.com`)).status, 302);
    }
    // o Resumo do dia começa no primeiro convidado cadastrado
    await q("INSERT INTO guests (name, instagram, email, phone, profile, status, created_at) VALUES ('Primeiro convidado', 'insta.x', 'x@ex.com', '+5511999990000', 'medico', 'prospect', $1)", [at(cal.addDays(D, -30))]);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('toda mudança de etapa do patrocinador vira uma linha, venha de onde vier; mexer em outra coisa, não', async () => {
    const { rows: [{ id }] } = await q("INSERT INTO sponsors (company, stage) VALUES ('Gatilho', 'prospect') RETURNING id");
    await q("UPDATE sponsors SET stage = 'negociacao' WHERE id = $1", [id]);
    await q("UPDATE sponsors SET notes = 'só uma nota' WHERE id = $1", [id]);
    await q("UPDATE sponsors SET stage = 'negociacao', updated_at = now() WHERE id = $1", [id]);
    assert.deepEqual(await moves(id), ['·>prospect', 'prospect>negociacao']);
    await q('DELETE FROM sponsors WHERE id = $1', [id]);
    assert.equal((await q('SELECT 1 FROM sponsor_stage_log WHERE sponsor_id = $1', [id])).rowCount, 0, 'apagar leva o registro junto');
  });

  it('etapas: entrou em prospecção, mostrou interesse, fechou e foi perdido no dia; mexida desfeita, já estar lá e voltar da lixeira não contam', async () => {
    await q('DELETE FROM sponsors');
    const old = at(cal.addDays(D, -10));
    const s = {};
    for (const [k, stage, created] of [['novo', 'prospect', at(D, '09:00')], ['avanca', 'negociacao', at(D, '09:30')], ['volta', 'prospect'], ['desfaz', 'negociacao'],
      ['engano', 'prospect'], ['lixeira', 'prospect'], ['fecha', 'ganho'], ['paga', 'ativo'], ['direto', 'ativo'], ['perde', 'perdido'], ['parado', 'prospect'],
      ['depois', 'prospect', at(cal.addDays(D, 1), '10:00')]]) s[k] = await sponsor(`Marca ${k}`, stage, created || old);
    await q('TRUNCATE sponsor_stage_log');
    await log(s.novo, null, 'prospect', at(D, '09:00'));
    await log(s.avanca, null, 'prospect', at(D, '09:30')); await log(s.avanca, 'prospect', 'negociacao', at(D, '11:00'));
    await log(s.volta, null, 'perdido', old); await log(s.volta, 'perdido', 'prospect', at(D, '10:00'));
    await log(s.desfaz, null, 'negociacao', old); await log(s.desfaz, 'negociacao', 'prospect', at(D, '11:00')); await log(s.desfaz, 'prospect', 'negociacao', at(D, '11:05'));
    await log(s.engano, null, 'prospect', old); await log(s.engano, 'prospect', 'negociacao', at(D, '12:00')); await log(s.engano, 'negociacao', 'prospect', at(D, '12:05'));
    await log(s.lixeira, null, 'prospect', old); await log(s.lixeira, null, 'prospect', at(D, '13:00')); // restaurado da lixeira no dia: o gatilho grava de novo
    await log(s.fecha, null, 'negociacao', old); await log(s.fecha, 'negociacao', 'ganho', at(D, '14:00'));
    await log(s.paga, null, 'ganho', old); await log(s.paga, 'ganho', 'ativo', at(D, '15:00'));
    await log(s.direto, null, 'negociacao', old); await log(s.direto, 'negociacao', 'ativo', at(D, '16:00'));
    await log(s.perde, null, 'prospect', old); await log(s.perde, 'prospect', 'perdido', at(D, '17:00'));
    await log(s.parado, null, 'prospect', old);
    await log(s.depois, null, 'prospect', at(cal.addDays(D, 1), '10:00'));

    assert.deepEqual(pick((await ds.summary(D)).sponsors, STAGES),
      { entered: 3, interested: 1, closed: 2, lost: 1, prospecting: 5, negotiating: 2, active: 2 },
      'entraram: novo, avanca (cadastrado e já em negociação) e volta; interesse: avanca; fecharam: fecha e direto (pagou, de Ganho para Ativo, não conta de novo)');
    assert.deepEqual(pick((await ds.summary(cal.addDays(D, -1))).sponsors, STAGES),
      { entered: 0, interested: 0, closed: 0, lost: 0, prospecting: 4, negotiating: 3, active: 0 }, 'na véspera, como estava');
    assert.equal((await ds.summary(cal.addDays(D, 1))).sponsors.entered, 1, 'no dia seguinte: depois');
  });

  it('abordagens: a 1ª do ciclo é "abordado" no dia (outro canal no mesmo dia também); falar de novo num dia seguinte é follow-up, um por patrocinador', async () => {
    await q('DELETE FROM sponsors');
    const old = at(cal.addDays(D, -20));
    const s = {};
    for (const k of ['primeira', 'doisCanais', 'segue', 'segueDuas', 'retro', 'volta', 'resposta', 'vespera']) s[k] = await sponsor(`Contato ${k}`, 'prospect', old);
    await q('TRUNCATE sponsor_stage_log');
    for (const id of Object.values(s)) await log(id, null, 'prospect', old);
    await send(s.primeira, at(D, '10:00'));
    await send(s.doisCanais, at(D, '10:00')); await send(s.doisCanais, at(D, '10:30'), { channel: 'email' });
    await send(s.segue, at(cal.addDays(D, -3))); await send(s.segue, at(D, '11:00'));
    await send(s.segueDuas, at(cal.addDays(D, -5))); await send(s.segueDuas, at(D, '09:00')); await send(s.segueDuas, at(D, '15:00'), { channel: 'instagram' });
    await send(s.retro, at(D, '12:00'), { created: at(cal.addDays(D, 2), '09:00') }); // registrada depois, com a data do dia
    // perdido e de volta à Prospecção: ciclo novo, a abordagem do dia é de novo a primeira
    await send(s.volta, at(cal.addDays(D, -15)));
    await log(s.volta, 'prospect', 'perdido', at(cal.addDays(D, -12))); await log(s.volta, 'perdido', 'prospect', at(cal.addDays(D, -2)));
    await send(s.volta, at(D, '16:00'));
    await send(s.resposta, at(D, '10:00'), { result: 'respondeu' }); // resposta não é abordagem
    await send(s.vespera, at(cal.addDays(D, -1)));

    const day = (await ds.summary(D)).sponsors;
    assert.deepEqual([day.approached, day.followed], [4, 2], 'abordados: primeira, doisCanais, retro e volta; follow-up: segue e segueDuas (uma vez, mesmo por dois canais)');
    const eve = (await ds.summary(cal.addDays(D, -1))).sponsors;
    assert.deepEqual([eve.approached, eve.followed], [1, 0], 'na véspera: vespera; a abordagem de retro ainda não tinha acontecido');
  });

  it('cadência no fim do dia: a abordar, follow-up do dia e atrasados, refeitos com a etapa e as abordagens daquele dia; hoje é a própria cadência', async () => {
    await q('DELETE FROM sponsors');
    const old = at(cal.addDays(D, -70));
    const s = {};
    for (const [k, stage] of [['aAbordar', 'prospect'], ['venceNoDia', 'prospect'], ['atrasado', 'prospect'], ['feitoNoDia', 'prospect'], ['emDia', 'prospect'],
      ['possivelPerdido', 'prospect'], ['negocia', 'negociacao'], ['saiuDepois', 'negociacao']]) s[k] = await sponsor(`Cadência ${k}`, stage, old);
    await q('TRUNCATE sponsor_stage_log');
    for (const [k, id] of Object.entries(s)) await log(id, null, k === 'negocia' ? 'negociacao' : 'prospect', old);
    await log(s.saiuDepois, 'prospect', 'negociacao', at(cal.addDays(D, 1)));
    await q('UPDATE sponsors SET stage_entered_at = $2 WHERE id = $1', [s.saiuDepois, at(cal.addDays(D, 1))]);
    await send(s.venceNoDia, at(cal.addDays(D, -3))); // +3 dias: vence no próprio dia
    await send(s.atrasado, at(cal.addDays(D, -6))); // +3 dias cai no domingo: venceu na segunda
    await send(s.feitoNoDia, at(cal.addDays(D, -3))); await send(s.feitoNoDia, at(D, '11:00'));
    await send(s.emDia, at(cal.addDays(D, -1)));
    for (const n of [60, 55, 50, 45, 40]) await send(s.possivelPerdido, at(cal.addDays(D, -n))); // a cadência acabou: possível perdido, não atrasado
    await send(s.negocia, at(cal.addDays(D, -6)));

    const day = (await ds.summary(D)).sponsors;
    assert.deepEqual(pick(day, ['toApproach', 'due', 'late']), { toApproach: 2, due: 1, late: 1 },
      'a abordar: aAbordar e saiuDepois (ainda em Prospecção naquele dia); o do dia: venceNoDia; atrasado: atrasado');
    const asToday = pick((await ds.summary(today, { isToday: true })).sponsors, ['toApproach', 'due', 'late']);
    assert.deepEqual(pick((await ds.summary(today, { isToday: false })).sponsors, ['toApproach', 'due', 'late']), asToday,
      'refeita para hoje, a cadência dá o mesmo que a própria cadência');
    assert.equal(asToday.toApproach, 1, 'hoje: saiuDepois já está em negociação');
  });

  it('o passado é refeito pela linha do tempo: "Etapa: A → B", o pedido de conversa pelo media kit, o cadastro e a etapa atual', async () => {
    await q('DELETE FROM sponsors');
    const X = cal.addDays(D, -9);
    const s = {};
    for (const [k, stage] of [['quadro', 'perdido'], ['kit', 'negociacao'], ['semtexto', 'inativo'], ['parado', 'prospect'], ['direto', 'ativo']]) s[k] = await sponsor(`Passado ${k}`, stage);
    const ev = (id, type, message, when) => q('INSERT INTO sponsor_events (sponsor_id, type, message, created_at) VALUES ($1, $2, $3, $4)', [id, type, message, when]);
    await ev(s.quadro, 'etapa', 'Etapa: Prospecção → Em negociação', at(X, '09:00'));
    await ev(s.quadro, 'etapa', 'Etapa: Em negociação → Perdido', at(X, '15:00'));
    await ev(s.kit, 'etapa', 'Pediu uma conversa pelo media kit (“Agendar uma conversa”): Prospecção → Em negociação', at(X, '10:00'));
    await ev(s.semtexto, 'etapa', 'Etapa: Ganho → Ativo', at(X, '09:00'));
    await q('UPDATE sponsors SET stage_entered_at = $2 WHERE id = $1', [s.semtexto, at(X, '16:00')]);
    await ev(s.parado, 'nota', 'Só uma nota → sem etapa', at(X, '09:00'));
    await ev(s.direto, 'criado', 'Patrocinador cadastrado por Ana', at(cal.addDays(D, -10)));
    await q('TRUNCATE sponsor_stage_log');
    await q('SELECT sponsor_stage_backfill()');
    assert.deepEqual(await moves(s.quadro), ['·>prospect', 'prospect>negociacao', 'negociacao>perdido']);
    assert.deepEqual(await moves(s.kit), ['·>prospect', 'prospect>negociacao']);
    assert.deepEqual(await moves(s.semtexto), ['·>ganho', 'ganho>ativo', 'ativo>inativo'], 'a última mudança vem da etapa atual');
    assert.deepEqual(await moves(s.parado), ['·>prospect']);
    assert.deepEqual(await moves(s.direto), ['·>ativo']);
    const [{ changed_at: last }] = (await q("SELECT changed_at FROM sponsor_stage_log WHERE sponsor_id = $1 AND to_stage = 'inativo'", [s.semtexto])).rows;
    assert.equal(new Date(last).toISOString(), new Date(at(X, '16:00')).toISOString());
    assert.deepEqual(pick((await ds.summary(X)).sponsors, ['interested', 'lost', 'closed']), { interested: 2, lost: 1, closed: 0 },
      'quadro e kit mostraram interesse no dia, quadro foi perdido; de Ganho para Ativo não é fechar de novo');
  });

  it('o Início mostra o caminho do patrocínio no dia escolhido; a cadência é link para quem cuida dela', async () => {
    await q('DELETE FROM sponsors');
    const old = at(cal.addDays(D, -10));
    const novo = await sponsor('Marca nova', 'prospect', at(D, '09:00'));
    const abordada = await sponsor('Marca abordada', 'prospect', old);
    const atrasada = await sponsor('Marca atrasada', 'prospect', old);
    const perdida = await sponsor('Marca perdida', 'perdido', old);
    await q('TRUNCATE sponsor_stage_log');
    await log(novo, null, 'prospect', at(D, '09:00'));
    for (const id of [abordada, atrasada]) await log(id, null, 'prospect', old);
    await log(perdida, null, 'prospect', old); await log(perdida, 'prospect', 'perdido', at(D, '15:00'));
    await send(abordada, at(D, '10:00'));
    await send(atrasada, at(cal.addDays(D, -6)));

    const tile = (label, n) => new RegExp(`day-l">${label}</span>\\s*<span class="day-n">${n}<`);
    let page = (await as.gestao.get(`/?dia=${D}`)).text;
    assert.match(page, /Da prospecção ao patrocínio/);
    assert.match(page, tile('Entraram em prospecção', 1)); assert.match(page, /<b class="">3<\/b> em prospecção/);
    assert.match(page, tile('Abordados', 1)); assert.match(page, /<b class="">1<\/b> a abordar/);
    assert.match(page, tile('Follow-ups', 0)); assert.match(page, /<b class="bad">1<\/b> ficou atrasado/);
    assert.match(page, tile('Interessados', 0)); assert.match(page, tile('Fechados', 0)); assert.match(page, /<b class="">0<\/b> patrocínios ativos/);
    assert.match(page, /<b>1<\/b> perdido no dia/);
    assert.match(page, /href="\/gestao\/cadencia"[^>]*>\s*<span class="day-dot"[^>]*><\/span>\s*<span class="day-l">Follow-ups/, 'a gestão vai para a cadência');
    assert.ok(page.indexOf('Do convite ao episódio') < page.indexOf('Da prospecção ao patrocínio') && page.indexOf('Da prospecção ao patrocínio') < page.indexOf('id="day-b2">Conteúdo'),
      'logo depois do caminho dos convidados');

    page = (await as.gestao.get('/')).text; // hoje: o que falta fazer agora
    assert.match(page, /<b class="">\d+<\/b> para hoje/);

    page = (await as.prod.get(`/?dia=${D}&visao=equipe`)).text;
    assert.match(page, /Da prospecção ao patrocínio/, 'a produtora também vê, no resumo da equipe');
    assert.match(page, /href="\/patrocinadores\?view=lista&amp;stage=prospect"[^>]*>\s*<span class="day-dot"[^>]*><\/span>\s*<span class="day-l">Follow-ups/, 'sem a cadência, a lista da Prospecção');
    assert.doesNotMatch((await as.editor.get('/')).text, /Da prospecção ao patrocínio/, 'o editor continua com o Início dele');
  });
});
