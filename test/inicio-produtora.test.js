// Início da produtora (Seu dia): o plano do dia (abordagens novas e convites contra a meta, follow-ups marcados para o dia, tarefas),
// o que o dia rendeu, os motivos de perda (dela e, no resumo da equipe, de todos), o que está quente, os aceitos sem data, a agenda,
// as tarefas e a troca entre o Seu dia e o resumo da equipe.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const cal = require('../src/services/calendar');
const myDay = require('../src/services/myDay');
const ds = require('../src/services/daySummary');

describe('Início da produtora (Seu dia)', () => {
  let D = cal.addDays(cal.todayISO(), -14);
  while (new Date(`${D}T12:00:00Z`).getUTCDay() !== 3) D = cal.addDays(D, -1); // uma quarta-feira no passado
  const at = (d, hm = '10:00') => `${d} ${hm}:00-03`; // hora de Brasília
  const old = at(cal.addDays(D, -30));
  const q = (sql, p) => h.db.query(sql, p);
  let app; const as = {}; const u = {}; const s = {}; const g = {};
  const sponsor = async (k, stage, owner) => { s[k] = (await q('INSERT INTO sponsors (company, stage, owner_id, created_at, stage_entered_at) VALUES ($1, $2, $3, $4, $4) RETURNING id', [`Marca ${k}`, stage, owner, old])).rows[0].id; };
  const guest = async (k, status, owner, reason = null) => { g[k] = (await q("INSERT INTO guests (name, instagram, profile, status, owner_id, loss_reason, created_at) VALUES ($1, 'insta.x', 'medico', $2, $3, $4, $5) RETURNING id", [`Convidado ${k}`, status, owner, reason, old])).rows[0].id; };
  const slog = (id, from, to, when) => q('INSERT INTO sponsor_stage_log (sponsor_id, from_stage, to_stage, changed_at) VALUES ($1, $2, $3, $4)', [id, from, to, when]);
  const glog = (id, from, to, when) => q('INSERT INTO guest_stage_log (guest_id, from_status, to_status, changed_at) VALUES ($1, $2, $3, $4)', [id, from, to, when]);
  const send = (kind, id, when, user, result = 'enviado') => q("INSERT INTO outreach_attempts (subject_type, subject_id, channel, result, at, created_at, user_id) VALUES ($1, $2, 'whatsapp', $3, $4, $4, $5)", [kind, id, result, when, user]);
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    for (const [k, name, role] of [['admin', 'Ana Admin', 'superadmin'], ['gestao', 'Gil Gestão', 'gestao'], ['prod', 'Paula Produtora', 'produtora'], ['editor', 'Edu Editor', 'editor_video']]) {
      u[k] = await h.createUser({ name, email: `${k}@t.com`, role });
      as[k] = h.client(app.base); assert.equal((await as[k].login(`${k}@t.com`)).status, 302);
    }
    const P = u.prod.id; const G = u.gestao.id;
    // patrocinadores, todos em Prospecção desde antes
    for (const [k, stage, owner] of [['vence', 'prospect', P], ['vence2', 'prospect', P], ['saiu', 'negociacao', P], ['atrasado', 'prospect', P], ['atrasadoFeito', 'prospect', P],
      ['outro', 'prospect', G], ['semDono', 'prospect', null], ['novo1', 'prospect', P], ['novo2', 'prospect', P], ['vazio', 'prospect', P], ['novoG', 'prospect', G]]) await sponsor(k, stage, owner);
    // convidados
    for (const [k, status, owner, reason] of [['vence', 'convite_enviado', P], ['vence2', 'convite_enviado', P], ['aceitou', 'em_agendamento', P], ['atrasado', 'convite_enviado', P],
      ['convite', 'convite_enviado', P], ['perdeu', 'perdido', P, 'nunca_respondeu'], ['perdeu2', 'perdido', P, 'sem_agenda'], ['perdeu3', 'perdido', P, 'nunca_respondeu'],
      ['perdeuG', 'perdido', G, 'conflito_de_interesse']]) await guest(k, status, owner, reason);
    await q('TRUNCATE sponsor_stage_log'); await q('TRUNCATE guest_stage_log');
    for (const id of Object.values(s)) await slog(id, null, 'prospect', old);
    await slog(s.saiu, 'prospect', 'negociacao', at(D, '11:00'));
    for (const id of Object.values(g)) await glog(id, null, 'prospect', old);
    for (const k of ['vence', 'vence2', 'aceitou']) await glog(g[k], 'prospect', 'convite_enviado', at(cal.addDays(D, -3))); // +3 dias: o 1º follow-up vence no dia
    await glog(g.aceitou, 'convite_enviado', 'em_agendamento', at(D, '11:00'));
    await q('UPDATE guests SET stage_entered_at = $2 WHERE id = $1', [g.aceitou, at(D, '11:00')]);
    await glog(g.atrasado, 'prospect', 'convite_enviado', at(cal.addDays(D, -10))); // venceu uma semana antes
    await glog(g.convite, 'prospect', 'convite_enviado', at(D, '10:00'));
    await glog(g.perdeu, 'prospect', 'convite_enviado', at(cal.addDays(D, -20))); await glog(g.perdeu, 'convite_enviado', 'perdido', at(D, '15:00'));
    await glog(g.perdeu2, 'prospect', 'perdido', at(cal.addDays(D, -10)));
    await glog(g.perdeu3, 'prospect', 'perdido', at(cal.addDays(D, -40)));
    await glog(g.perdeuG, 'prospect', 'perdido', at(cal.addDays(D, -5)));
    // abordagens
    for (const k of ['vence', 'vence2', 'saiu']) await send('sponsor', s[k], at(cal.addDays(D, -3)), P); // +3 dias: vence no dia
    await send('sponsor', s.vence, at(D, '10:00'), P); // follow-up feito
    for (const k of ['atrasado', 'atrasadoFeito']) await send('sponsor', s[k], at(cal.addDays(D, -6)), P); // +3 dias cai no domingo: venceu na segunda
    await send('sponsor', s.atrasadoFeito, at(D, '12:00'), P);
    await send('sponsor', s.outro, at(cal.addDays(D, -3)), G);
    await send('sponsor', s.semDono, at(cal.addDays(D, -3)), P);
    await send('sponsor', s.novo1, at(D, '09:00'), P);
    await send('sponsor', s.novo2, at(D, '09:30'), P); await send('sponsor', s.novo2, at(D, '09:40'), P); // outro canal no mesmo dia: a mesma abordagem
    await send('sponsor', s.novoG, at(D, '09:00'), G);
    await send('guest', g.vence, at(D, '10:30'), P);
    // tarefas
    for (const [title, assignee, due, status, done] of [['Hoje feita', P, D, 'feito', at(D, '12:00')], ['Hoje aberta', P, D, 'a_fazer', null], ['Antes aberta', P, cal.addDays(D, -2), 'a_fazer', null],
      ['Antes feita', P, cal.addDays(D, -2), 'feito', at(cal.addDays(D, -1))], ['Da gestão', G, D, 'a_fazer', null]]) {
      await q("INSERT INTO tasks (title, kind, status, assignee_id, due_on, completed_at, created_at) VALUES ($1, 'geral', $2, $3, $4, $5, $6)", [title, status, assignee, due, done, old]);
    }
    // reuniões: uma marcada por ela no dia (para daqui a 3 dias) e uma cancelada
    await q("INSERT INTO sponsor_meetings (sponsor_id, title, starts_at, owner_id, created_by, status, created_at) VALUES ($1, 'Conversa', now() + interval '3 days', $2, $2, 'marcada', $3), ($1, 'Cancelada', now() + interval '4 days', $2, $2, 'cancelada', $3)", [s.saiu, P, at(D, '14:00')]);
    // metas: abordagens novas e convites por dia (vão para o plano); reuniões por semana (fica em Minhas metas)
    await q("INSERT INTO user_goals (user_id, metric, period, target, position) VALUES ($1, 'abordagens_patrocinadores', 'dia', 5, 0), ($1, 'convites_enviados', 'dia', 3, 1), ($1, 'reunioes_agendadas', 'semana', 4, 2)", [P]);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('follow-ups marcados para o dia: previstos, feitos (contato no dia ou saiu da etapa) e os atrasados de antes; dela e sem responsável', async () => {
    assert.deepEqual(await myDay.followPlan('sponsor', u.prod.id, D), { due: 4, done: 2, late: 1 },
      'previstos: vence, vence2, saiu e semDono (o de outro dono não); feitos: vence (contato) e saiu (foi para negociação); atrasado: atrasado (atrasadoFeito teve contato)');
    assert.deepEqual(await myDay.followPlan('guest', u.prod.id, D), { due: 3, done: 2, late: 1 }, 'previstos: vence, vence2 e aceitou; feitos: vence e aceitou; atrasado: atrasado');
  });

  it('o plano do dia: abordagens novas e convites contra a meta, tarefas; o que o dia rendeu e os motivos de perda', async () => {
    const p = await myDay.plan(u.prod, D, false);
    assert.deepEqual(p.approaches, { n: 2, target: 5, toApproach: 1 }, 'novo1 e novo2 (o segundo canal e os follow-ups não contam; o de outra pessoa também não); a abordar: vazio');
    assert.deepEqual(p.invites, { n: 1, target: 3, waiting: 4 });
    assert.deepEqual(p.tasks, { due: 2, done: 1, late: 1 });
    assert.deepEqual(pick(p.results, ['accepted', 'scheduling', 'lost', 'lostReasons', 'interested', 'negotiating', 'booked', 'closed', 'active']),
      { accepted: 1, scheduling: 1, lost: 1, lostReasons: ['Nunca respondeu'], interested: 1, negotiating: 1, booked: 1, closed: 0, active: 0 });
    assert.match(p.results.nextMeeting, /^\p{L}{3} \d{2}\/\d{2} · \d{2}:\d{2}$/u, 'ex.: sáb 21/11 · 17:55');
    assert.deepEqual(p.losses.list.map((r) => [r.label, r.n, r.pct]), [['Nunca respondeu', 1, 50], ['Sem agenda próxima', 1, 50]], 'dela, em 30 dias (perdeu3 foi antes)');
    assert.deepEqual(p.otherGoals.map((x) => x.metric), ['reunioes_agendadas']);
    const team = await ds.lossReasons(D);
    assert.equal(team.total, 3); assert.equal(team.list[0].bar, 100); assert.ok(team.list.some((r) => r.label === 'Conflito de interesse'));
  });

  it('a frase do topo diz o que falta hoje', () => {
    const goal = (over) => [{ metric: 'abordagens_patrocinadores', period: 'dia', target: 5, value: 2, met: false, pace: 'faltam 3 hoje', ...over }];
    assert.equal(myDay.line({ items: [{ state: 'hoje' }, { state: 'atrasado' }, { state: 'possivel_perdido' }] }, goal()), 'Faltam 2 follow-ups e 3 abordagens novas para a meta de hoje.');
    assert.equal(myDay.line({ items: [{ state: 'hoje' }] }, []), 'Faltam 1 follow-up hoje.');
    assert.equal(myDay.line({ items: [] }, goal({ value: 5, met: true, pace: 'meta batida' })), 'Follow-ups em dia e meta de abordagens batida.');
    assert.equal(myDay.line({ items: [] }, goal()), 'Follow-ups em dia. Faltam 3 abordagens novas para a meta de hoje.');
    assert.equal(myDay.line({ items: [] }, goal({ pace: 'fim de semana: sem meta hoje' })), 'Follow-ups em dia.');
  });

  it('o Início da produtora abre no Seu dia; "Equipe" mostra o resumo da equipe e segue junto ao trocar de dia', async () => {
    const cell = (label, n, of) => new RegExp(`day-l">${label}</span>\\s*<span class="plan-n">\\s*<span class="plan-v"><span class="day-n">${n}</span><span class="plan-of">${of}</span>`);
    let page = (await as.prod.get(`/?dia=${D}`)).text;
    assert.match(page, /id="resumo-h">Seu dia/);
    assert.match(page, cell('Abordagens novas de patrocinadores', 2, 'de 5 · meta'));
    assert.match(page, cell('Follow-ups de patrocinadores', 2, 'de 4 previstos')); assert.match(page, /<b class="bad">2<\/b> ficaram sem fazer · <b class="bad">1<\/b> atrasado/);
    assert.match(page, cell('Convites enviados', 1, 'de 3 · meta')); assert.match(page, /<b class="">4<\/b> aguardando resposta/);
    assert.match(page, cell('Follow-ups de convidados', 2, 'de 3 previstos'));
    assert.match(page, cell('Tarefas', 1, 'de 2 para o dia')); assert.match(page, /<b class="bad">1<\/b> ficou para depois · <b class="bad">1<\/b> atrasada/);
    assert.match(page, /day-cell is-bad"[^>]*>\s*<span class="day-l">Convidados perdidos<\/span>\s*<span class="day-n">1<\/span>\s*<span class="day-sub">nunca respondeu/);
    assert.match(page, /Por que seus convidados foram perdidos · últimos 30 dias/); assert.match(page, /<b>2<\/b> perdidos · ver a lista/);
    assert.doesNotMatch(page, /Conflito de interesse/, 'só os dela');
    assert.match(page, /Minhas metas/); assert.match(page, /Reuniões agendadas · esta semana/);
    assert.match(page, new RegExp(`<a class="on" href="/\\?dia=${D}#resumo" aria-current="true">Seu dia</a>`));
    assert.match(page, new RegExp(`href="/\\?dia=${D}&amp;visao=equipe#resumo">Equipe</a>`));

    page = (await as.prod.get(`/?dia=${D}&visao=equipe`)).text;
    assert.match(page, /id="resumo-h">Resumo do dia/); assert.match(page, /Por que os convidados foram perdidos · últimos 30 dias/); assert.match(page, /<b>3<\/b> perdidos/);
    assert.match(page, new RegExp(`href="/\\?dia=${cal.addDays(D, -1)}&amp;visao=equipe#resumo" aria-label="Dia anterior"`));
    assert.match(page, /<input type="hidden" name="visao" value="equipe">/);
    assert.match(page, /<a class="on" href="[^"]*visao=equipe#resumo" aria-current="true">Equipe<\/a>/);

    page = (await as.admin.get(`/?dia=${D}`)).text;
    assert.match(page, /id="resumo-h">Resumo do dia/); assert.match(page, /Por que os convidados foram perdidos · últimos 30 dias/, 'o superadmin vê os motivos de perda');
    assert.doesNotMatch(page, /De quem são os números/, 'sem a troca: é sempre o resumo da equipe');
    assert.doesNotMatch((await as.editor.get('/')).text, /id="resumo-h">Seu dia/, 'o editor continua com o Início dele (o aviso de novidades pode citar o Seu dia)');
  });

  it('agora: o que está quente, os aceitos sem data, as próximas gravações e reuniões e as tarefas', async () => {
    const P = u.prod.id;
    const later = at(cal.addDays(D, 2));
    const add = async (k, stage, owner) => { await sponsor(k, stage, owner); await slog(s[k], null, stage, later); };
    for (const [k, stage, owner] of [['kit', 'prospect', P], ['quer', 'negociacao', null], ['respondida', 'prospect', P], ['antiga', 'prospect', P], ['deOutra', 'prospect', u.gestao.id]]) await add(k, stage, owner);
    const kit = (id, ago) => q(`INSERT INTO sponsor_events (sponsor_id, type, message, created_at) VALUES ($1, 'kit_visto', 'Abriu o media kit', now() - interval '${ago}')`, [id]);
    await kit(s.kit, '1 hour'); await kit(s.respondida, '3 hours'); await kit(s.antiga, '3 days'); await kit(s.deOutra, '1 hour');
    await q("INSERT INTO sponsor_clicks (sponsor_id, kind, created_at) VALUES ($1, 'quero', now() - interval '2 hours')", [s.quer]);
    await q("INSERT INTO outreach_attempts (subject_type, subject_id, channel, result, user_id) VALUES ('sponsor', $1, 'email', 'enviado', $2)", [s.respondida, P]); // já chamou depois de ver
    await guest('quente', 'convite_enviado', P); await glog(g.quente, null, 'convite_enviado', later);
    await guest('jaAceitou', 'em_agendamento', P); await glog(g.jaAceitou, null, 'em_agendamento', later);
    for (const id of [g.quente, g.jaAceitou]) await q("INSERT INTO guest_events (guest_id, type, message, created_at) VALUES ($1, 'convite_visto', 'Convidado abriu o convite', now() - interval '30 minutes')", [id]);
    await guest('grava', 'agendado', P); await q("UPDATE guests SET proposed_at = now() + interval '2 days' WHERE id = $1", [g.grava]);

    const n = await myDay.now(u.prod, cal.todayISO());
    assert.deepEqual(n.hot.map((x) => [x.kind, x.name, x.signal]), [['guest', 'Convidado quente', 'convite'], ['sponsor', 'Marca kit', 'kit'], ['sponsor', 'Marca quer', 'conversa']]);
    assert.match(n.hot[0].when, /^\d{2}:\d{2}$|^ontem \d{2}:\d{2}$/);
    assert.equal(n.waiting.n, 2, 'aceitou e jaAceitou estão em agendamento'); assert.ok(n.waiting.days >= 0);
    assert.deepEqual(n.agenda.map((x) => [x.kind, x.title]), [['gravacao', 'Convidado grava'], ['reuniao', 'Marca saiu']]);
    assert.deepEqual(n.tasks.map((t) => [t.title, t.late]), [['Antes aberta', true], ['Hoje aberta', true]]);

    const page = (await as.prod.get('/')).text;
    assert.match(page, /class="voz">(Faltam|Follow-ups em dia)/);
    assert.match(page, /Quentes agora/); assert.match(page, /ABRIU O CONVITE · /); assert.match(page, /PEDIU UMA CONVERSA · /);
    assert.match(page, /<b>2 aceitos sem data<\/b> de gravação/);
    assert.match(page, /Próximas gravações e reuniões/); assert.match(page, /Reunião com Marca saiu/); assert.match(page, /badge b-st-agendado">gravação/);
    assert.match(page, /Suas tarefas/); assert.match(page, /outreach-chip bad small">atrasada/);
    assert.doesNotMatch(page, /Atividade recente/, 'o Início dela troca a atividade recente pelas tarefas');
  });
});
