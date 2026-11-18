// Resumo do dia no Início: registro automático das mudanças de etapa, o passado refeito pela linha do tempo, e cada número do
// dia (convidados, episódios, cortes, posts, Reels de teste, tarefas, seguidores) contado do jeito combinado.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const cal = require('../src/services/calendar');
const ds = require('../src/services/daySummary');
const insights = require('../src/services/socialInsights');

describe('Resumo do dia no Início', () => {
  const today = cal.todayISO();
  const D = cal.addDays(today, -3); // o dia medido (sempre no passado, para o resultado não depender da hora em que a suíte roda)
  const at = (d, hm = '10:00') => `${d} ${hm}:00-03`; // hora de Brasília
  const q = (sql, p) => h.db.query(sql, p);
  let app; const as = {}; const u = {};
  const guest = async (name, status) => (await q("INSERT INTO guests (name, instagram, email, phone, profile, status, loss_reason, created_at) VALUES ($1, 'insta.x', 'x@ex.com', '+5511999990000', 'medico', $2, $3, $4) RETURNING id",
    [name, status, status === 'perdido' ? 'recusado' : null, at(cal.addDays(D, -10))])).rows[0].id;
  const log = (id, from, to, when) => q('INSERT INTO guest_stage_log (guest_id, from_status, to_status, changed_at) VALUES ($1, $2, $3, $4)', [id, from, to, when]);
  const moves = async (id) => (await q('SELECT from_status, to_status FROM guest_stage_log WHERE guest_id = $1 ORDER BY changed_at, id', [id])).rows.map((r) => `${r.from_status || '·'}>${r.to_status}`);

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    for (const [k, name, role] of [['admin', 'Ana Admin', 'superadmin'], ['gestao', 'Gil Gestão', 'gestao'], ['prod', 'Paula Produtora', 'produtora'], ['editor', 'Edu Editor', 'editor_video']]) {
      u[k] = await h.createUser({ name, email: `${k}@t.com`, role });
      as[k] = h.client(app.base); assert.equal((await as[k].login(`${k}@t.com`)).status, 302);
    }
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('toda mudança de etapa vira uma linha, venha de onde vier (cadastro, quadro, link, SQL direto); sem mudança, nada', async () => {
    const id = await guest('Gatilho Teste', 'prospect');
    await q("UPDATE guests SET status = 'convite_enviado' WHERE id = $1", [id]);
    await q("UPDATE guests SET name = 'Gatilho Teste 2' WHERE id = $1", [id]);
    await q("UPDATE guests SET status = 'convite_enviado', updated_at = now() WHERE id = $1", [id]);
    assert.deepEqual(await moves(id), ['·>prospect', 'prospect>convite_enviado']);
    await q('DELETE FROM guests WHERE id = $1', [id]);
  });

  it('convidados: enviados, aceitos e perdidos no dia; mexida desfeita no mesmo dia não conta; etapas como no fim do dia', async () => {
    const before10 = at(cal.addDays(D, -10));
    const g = {};
    for (const [k, status] of [['envia', 'convite_enviado'], ['aceita', 'em_agendamento'], ['perde', 'perdido'], ['desfaz', 'prospect'], ['agenda', 'agendado'], ['espera', 'convite_enviado'], ['amanha', 'em_agendamento'], ['novo', 'prospect']]) g[k] = await guest(`Convidado ${k}`, status);
    await q('TRUNCATE guest_stage_log');
    await log(g.envia, null, 'prospect', before10); await log(g.envia, 'prospect', 'convite_enviado', at(D, '09:00'));
    await log(g.aceita, null, 'convite_enviado', before10); await log(g.aceita, 'convite_enviado', 'em_agendamento', at(D, '11:00'));
    await log(g.perde, null, 'convite_enviado', before10); await log(g.perde, 'convite_enviado', 'perdido', at(D, '12:00'));
    await log(g.desfaz, null, 'prospect', before10); await log(g.desfaz, 'prospect', 'convite_enviado', at(D, '13:00')); await log(g.desfaz, 'convite_enviado', 'prospect', at(D, '13:05'));
    await log(g.agenda, null, 'em_agendamento', before10); await log(g.agenda, 'em_agendamento', 'agendado', at(D, '14:00'));
    await log(g.espera, null, 'convite_enviado', before10);
    await log(g.amanha, null, 'convite_enviado', before10); await log(g.amanha, 'convite_enviado', 'em_agendamento', at(cal.addDays(D, 1), '10:00'));
    await log(g.novo, null, 'prospect', at(cal.addDays(D, 1), '08:00')); // cadastrado depois do dia: não existia no fim dele

    assert.deepEqual((await ds.summary(D)).guests,
      { sent: 1, accepted: 1, lost: 1, waiting: 3, scheduling: 1, schedulingIn: 1, scheduled: 1, scheduledIn: 1 },
      'envia (enviado), aceita (aceito e entrou em agendamento), perde (perdido), agenda (agendado no dia); quem voltou para Prospecção na hora não conta; aguardando = envia, espera e amanha');
    const next = (await ds.summary(cal.addDays(D, 1))).guests;
    assert.deepEqual([next.sent, next.accepted, next.waiting, next.scheduling], [0, 1, 2, 2], 'no dia seguinte: amanha aceitou');
    // o dia de antes de tudo: todos na etapa de cadastro, nenhuma mudança
    const prev = (await ds.summary(cal.addDays(D, -1))).guests;
    assert.deepEqual([prev.sent, prev.waiting, prev.scheduling], [0, 4, 1]);
  });

  it('episódios: gravados ainda sem publicar no fim do dia, gravados no dia e publicados', async () => {
    const ep = (n, status, rec, pub = null) => q('INSERT INTO episodes (number, title, status, recorded_on, published_at) VALUES ($1, $2, $3, $4, $5)', [n, `EP ${n}`, status, rec, pub]);
    await ep(101, 'publicado', cal.addDays(D, -5), at(D, '15:00')); // publicado no dia
    await ep(102, 'gravado', D); // gravado no dia
    await ep(103, 'em_edicao', cal.addDays(D, -2));
    await ep(104, 'gravado', cal.addDays(D, 1)); // gravado depois: não estava gravado no fim do dia
    await ep(105, 'publicado', cal.addDays(D, -30), at(cal.addDays(D, -20)));
    assert.deepEqual((await ds.summary(D)).episodes, { recordedIn: 1, toPublish: 2, publishedIn: 1, published: 2 });
    assert.deepEqual((await ds.summary(cal.addDays(D, -1))).episodes, { recordedIn: 0, toPublish: 2, publishedIn: 0, published: 1 }, 'na véspera, o 101 ainda não tinha saído');
  });

  it('cortes: subidos pelo editor (os da gestão à parte), revisões (versões novas) e postados no dia, com os Reels de teste', async () => {
    const [{ id: epId }] = (await q("INSERT INTO episodes (number, title, status, recorded_on) VALUES (201, 'EP cortes', 'gravado', $1) RETURNING id", [cal.addDays(D, -4)])).rows;
    const clip = async (title, by, when) => (await q("INSERT INTO episode_clips (title, source, status, episode_id, storage_key, size_bytes, content_type, created_by, created_at) VALUES ($1, 'upload', 'pronto', $2, 'pp/c.mp4', 10, 'video/mp4', $3, $4) RETURNING id", [title, epId, by, when])).rows[0].id;
    const c1 = await clip('Corte um', u.editor.id, at(D, '10:00'));
    const c2 = await clip('Corte dois', u.editor.id, at(D, '11:00'));
    const c3 = await clip('Corte da gestão', u.admin.id, at(D, '12:00'));
    const c4 = await clip('Corte de ontem', u.editor.id, at(cal.addDays(D, -1), '18:00'));
    await q("INSERT INTO clip_versions (clip_id, version, storage_key, replaced_at) VALUES ($1, 1, 'pp/v1.mp4', $2), ($1, 2, 'pp/v2.mp4', $3), ($4, 1, 'pp/v1b.mp4', $5)",
      [c1, at(D, '16:00'), at(D, '17:00'), c2, at(cal.addDays(D, -1), '20:00')]);
    const ok = (...nets) => JSON.stringify(nets.map(([platform, good]) => ({ platform, ok: good })));
    const pub = async (clipId, status, { sched = null, created = at(cal.addDays(D, -1), '22:00'), results = '[]', trial = null } = {}) => (await q(
      "INSERT INTO episode_publications (episode_id, clip_id, platforms, title, status, scheduled_at, created_at, results, options) VALUES ($1, $2, '{instagram,youtube}', 'Post', $3, $4, $5, $6, $7) RETURNING id",
      [epId, clipId, status, sched, created, results, JSON.stringify(trial ? { instagram: { trial } } : {})])).rows[0].id;
    await pub(c1, 'publicado', { sched: at(D, '18:00'), results: ok(['instagram', true], ['youtube', true]), trial: 'auto' }); // Reel de teste no ar
    await pub(c2, 'parcial', { created: at(D, '09:00'), results: ok(['instagram', false], ['youtube', true]), trial: 'auto' }); // o Instagram falhou: não é Reel de teste no ar
    await pub(c1, 'publicado', { sched: at(D, '20:00'), results: ok(['tiktok', true]) }); // o mesmo corte em outra rede: conta uma vez
    await pub(c4, 'agendado', { sched: at(D, '19:00') }); // ainda não saiu
    const late = await pub(c3, 'publicado', { sched: at(cal.addDays(D, -1), '23:00'), results: ok(['instagram', true]) });
    await q('INSERT INTO post_metrics (publication_id, platform, views, published_at) VALUES ($1, $2, 10, $3)', [late, 'instagram', at(D, '00:30')]); // a rede pôs no ar depois da meia-noite
    await pub(null, 'publicado', { created: at(D, '08:00'), results: ok(['instagram', true]) }); // post de imagem: não é corte

    const c = (await ds.summary(D)).clips;
    assert.deepEqual(c, { uploaded: 2, uploadedByTeam: 1, uploadedEpisodes: 1, versions: 2, revised: 1, posted: 3, networkPosts: 5, trials: 1 });
    const before = (await ds.summary(cal.addDays(D, -1))).clips;
    assert.deepEqual([before.uploaded, before.versions, before.posted], [1, 1, 0], 'na véspera: o corte de ontem, a versão nova do corte dois e nada no ar (o agendado das 23h saiu depois da meia-noite)');
  });

  it('tarefas atrasadas no fim do dia: prazo vencido e não feito naquele momento; o dia com hora conta, sem hora não', async () => {
    const task = (title, status, due, { time = null, done = null, created = at(cal.addDays(D, -5)) } = {}) => q(
      "INSERT INTO tasks (title, kind, status, due_on, due_time, completed_at, created_at) VALUES ($1, 'geral', $2, $3, $4, $5, $6)", [title, status, due, time, done, created]);
    await task('Vencida e aberta', 'a_fazer', cal.addDays(D, -2));
    await task('Feita antes', 'feito', cal.addDays(D, -2), { done: at(cal.addDays(D, -1)) });
    await task('Feita depois', 'feito', cal.addDays(D, -2), { done: at(cal.addDays(D, 1)) });
    await task('Vence no dia sem hora', 'a_fazer', D);
    await task('Vence no dia com hora', 'fazendo', D, { time: '10:00' });
    await task('Criada depois', 'a_fazer', cal.addDays(D, -2), { created: at(cal.addDays(D, 1)) });
    assert.deepEqual((await ds.summary(D)).tasks, { late: 3, open: 4 });
    assert.deepEqual((await ds.summary(today)).tasks, { late: 4, open: 4 }, 'hoje: as abertas agora, todas vencidas (a criada depois do dia também)');
  });

  it('seguidores: saldo pela leitura do dia menos a do anterior; sem a nossa leitura, a série de totais do provedor; sem nada, vazio', async () => {
    const snap = (d, net, data) => q('INSERT INTO social_snapshots (taken_on, platform, data, updated_at) VALUES ($1, $2, $3, $4)', [d, net, JSON.stringify(data), at(d, '23:50')]);
    await snap(cal.addDays(D, -1), 'instagram', { provider: 'outstand', followers: 100 });
    await snap(D, 'instagram', { provider: 'outstand', followers: 112, series: { kind: 'novos', points: [{ d: D, v: 40 }] } });
    await snap(D, 'youtube', { provider: 'zernio', followers: 50, series: { kind: 'total', points: [{ d: cal.addDays(D, -1), v: 47 }, { d: D, v: 50 }] } });
    const s = (await ds.summary(D)).social;
    assert.equal(s.instagram.gain, 12); assert.equal(s.instagram.total, 112); assert.ok(s.instagram.readAt);
    assert.equal(s.youtube.gain, 3, 'a véspera veio da série de totais da Zernio');
    const older = (await ds.summary(cal.addDays(D, -2))).social;
    assert.deepEqual([older.instagram.gain, older.instagram.total, older.youtube.gain], [null, null, null], 'sem leitura');
  });

  it('o Início mostra o resumo do dia escolhido, com setas e calendário; o funil de etapas saiu', async () => {
    let page = (await as.gestao.get(`/?dia=${D}`)).text;
    assert.match(page, /id="resumo"/);
    assert.match(page, new RegExp(`name="dia" value="${D}"`));
    assert.match(page, new RegExp(`href="/\\?dia=${cal.addDays(D, -1)}#resumo" aria-label="Dia anterior"`));
    assert.match(page, new RegExp(`href="/\\?dia=${cal.addDays(D, 1)}#resumo" aria-label="Próximo dia"`));
    assert.match(page, /Convites enviados<\/span><span class="stat-n">1</);
    assert.match(page, /Cortes subidos<\/span><span class="stat-n">2</);
    assert.match(page, /\+1 da gestão/);
    assert.match(page, /Instagram<\/span><span class="stat-n">\+12</);
    assert.match(page, /Tarefas atrasadas<\/span><span class="stat-n hl-bad">3</);
    assert.match(page, />Hoje<\/a>/, 'fora de hoje, o atalho para voltar');
    assert.doesNotMatch(page, /stat-grid funnel/);

    page = (await as.gestao.get('/?dia=2999-01-01')).text; // depois de hoje: hoje
    assert.match(page, new RegExp(`name="dia" value="${today}"`)); assert.match(page, /HOJE, ATÉ AGORA/);
    assert.match(page, /<span class="btn sm" aria-disabled="true">/, 'hoje: a seta do próximo dia fica apagada');
    assert.doesNotMatch(page, new RegExp(`href="/\\?dia=${cal.addDays(today, 1)}`));
    assert.match((await as.gestao.get('/?dia=abc')).text, new RegExp(`name="dia" value="${today}"`), 'data inválida: hoje');
    assert.match((await as.gestao.get('/?dia=1990-01-01')).text, new RegExp(`name="dia" value="${cal.addDays(D, -10)}"`), 'antes do primeiro convidado: o primeiro dia');

    assert.match((await as.prod.get('/')).text, /id="resumo"/, 'a produtora também vê');
    assert.doesNotMatch((await as.editor.get('/')).text, /id="resumo"/, 'o editor continua com o Início dele');
  });

  it('o passado é refeito pela linha do tempo: texto das etapas, edição em massa, aceite zerado, respostas pelo link e convite por e-mail', async () => {
    const X = cal.addDays(D, -9);
    const g = {};
    for (const [k, status] of [['link', 'em_agendamento'], ['massa', 'perdido'], ['semtexto', 'agendado'], ['email', 'convite_enviado'], ['zerado', 'convite_enviado'], ['parado', 'prospect']]) g[k] = await guest(`Passado ${k}`, status);
    const ev = (id, type, message, when) => q('INSERT INTO guest_events (guest_id, type, message, created_at) VALUES ($1, $2, $3, $4)', [id, type, message, when]);
    await ev(g.link, 'status', 'Etapa: Prospecção → Convite enviado', at(X, '09:00'));
    await ev(g.link, 'resposta', 'Aceitou o convite (clicou em “Aceitar o convite”)', at(X, '10:00'));
    await ev(g.massa, 'status', 'Edição em massa por Ana Admin: etapa Convite enviado → Perdido (motivo: Recusado); responsável → Gil Gestão', at(X, '09:00'));
    await ev(g.semtexto, 'status', 'Etapa: Convite enviado → Em agendamento', at(X, '09:00'));
    await q('UPDATE guests SET stage_entered_at = $2 WHERE id = $1', [g.semtexto, at(X, '15:00')]);
    await ev(g.email, 'convite_enviado', 'Convite enviado por e-mail para x@ex.com', at(X, '09:00'));
    await ev(g.zerado, 'status', 'Aceite zerado por Ana Admin: 1 clique(s) apagado(s); etapa Em agendamento → Prospecção', at(X, '09:00'));
    await ev(g.zerado, 'status', 'Etapa: Prospecção → Convite enviado (motivo: teste)', at(X, '11:00'));
    await ev(g.parado, 'nota', 'Só uma nota', at(X, '09:00'));
    await q('TRUNCATE guest_stage_log');
    await q('SELECT guest_stage_backfill()');
    assert.deepEqual(await moves(g.link), ['·>prospect', 'prospect>convite_enviado', 'convite_enviado>em_agendamento']);
    assert.deepEqual(await moves(g.massa), ['·>convite_enviado', 'convite_enviado>perdido']);
    assert.deepEqual(await moves(g.semtexto), ['·>convite_enviado', 'convite_enviado>em_agendamento', 'em_agendamento>agendado'], 'a última mudança vem da etapa atual');
    assert.deepEqual(await moves(g.email), ['·>prospect', 'prospect>convite_enviado']);
    assert.deepEqual(await moves(g.zerado), ['·>em_agendamento', 'em_agendamento>prospect', 'prospect>convite_enviado']);
    assert.deepEqual(await moves(g.parado), ['·>prospect']);
    const [{ changed_at: last }] = (await q("SELECT changed_at FROM guest_stage_log WHERE guest_id = $1 AND to_status = 'agendado'", [g.semtexto])).rows;
    assert.equal(new Date(last).toISOString(), new Date(at(X, '15:00')).toISOString());
    assert.equal((await ds.summary(X)).guests.accepted, 2, 'link (aceitou pelo link) e semtexto (Convite enviado → Em agendamento)');
  });

  it('a leitura de seguidores do fim do dia só roda depois das 23:40 e uma vez', async () => {
    assert.equal(await insights.endOfDay(new Date(`${today}T15:00:00Z`)), null, 'meio-dia: não');
    const late = new Date(`${today}T02:45:00Z`); // 23:45 da véspera em Brasília
    const eve = cal.addDays(today, -1);
    await q('DELETE FROM social_snapshots WHERE taken_on = $1', [eve]);
    await q("INSERT INTO social_snapshots (taken_on, platform, data, updated_at) VALUES ($1, 'instagram', '{\"followers\": 1}', $2), ($1, 'youtube', '{\"followers\": 1}', $2)", [eve, at(eve, '23:42')]);
    assert.equal(await insights.endOfDay(late), null, 'já lido depois das 23:40');
  });
});
