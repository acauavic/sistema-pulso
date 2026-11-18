// Metas por pessoa: cada métrica conta o que deve (por quem e no período), a gestão define até 3 metas por pessoa em Gestão > Metas,
// cada pessoa vê as dela no Início, e o editor vê o ritmo dele (cortes, revisões, entregas, próxima entrega).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const cal = require('../src/services/calendar');
const goals = require('../src/services/goals');

describe('Metas', () => {
  // dia medido fixo numa quarta-feira já passada: a semana (segunda a domingo) e o mês não dependem de quando a suíte roda
  let W = cal.addDays(cal.todayISO(), -7); while (new Date(`${W}T12:00:00Z`).getUTCDay() !== 3) W = cal.addDays(W, -1);
  const at = (d, hm = '10:00') => `${d} ${hm}:00-03`;
  const q = (sql, p) => h.db.query(sql, p);
  let app; const as = {}; const u = {};
  const goal = (user, metric, period, target, display = 'numero') => goals.progress({ user_id: u[user].id, metric, period, target, display }, W);

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    for (const [k, name, role] of [['admin', 'Ana Admin', 'superadmin'], ['gestao', 'Gil Gestão', 'gestao'], ['prod', 'Paula Produtora', 'produtora'], ['editor', 'Edu Editor', 'editor_video']]) {
      u[k] = await h.createUser({ name, email: `${k}@t.com`, role });
      as[k] = h.client(app.base); assert.equal((await as[k].login(`${k}@t.com`)).status, 302);
    }
    const [{ id: ep }] = (await q("INSERT INTO episodes (number, title, status, recorded_on) VALUES (40, 'EP metas', 'em_revisao', $1) RETURNING id", [W])).rows;
    // cortes: 3 do editor no dia, 1 dele na segunda da mesma semana, 1 da gestão
    const clip = async (by, when, videoBy = null) => (await q("INSERT INTO episode_clips (title, source, status, episode_id, storage_key, size_bytes, content_type, created_by, video_by, created_at) VALUES ('Corte', 'upload', 'pronto', $1, 'pp/c.mp4', 10, 'video/mp4', $2, $3, $4) RETURNING id", [ep, by, videoBy, when])).rows[0].id;
    const c1 = await clip(u.editor.id, at(W, '09:00'), u.editor.id); await clip(u.editor.id, at(W, '10:00')); await clip(u.editor.id, at(W, '11:00'));
    await clip(u.editor.id, at(cal.addDays(W, -2))); const cg = await clip(u.gestao.id, at(W), u.gestao.id);
    // revisões: versão nova do c1 subida pelo editor; versão nova do corte da gestão subida pela gestão
    await q("INSERT INTO clip_versions (clip_id, version, storage_key, uploaded_by, replaced_at) VALUES ($1, 1, 'pp/v1', $2, $3), ($4, 1, 'pp/v1b', $5, $6)", [c1, u.editor.id, at(W, '12:00'), cg, u.gestao.id, at(W, '13:00')]);
    await q("UPDATE episode_clips SET version = 2 WHERE id = ANY($1)", [[c1, cg]]);
    // abordagens da produtora: patrocinadores A e B abordados pela 1ª vez no dia (A também por outro canal, ainda a mesma abordagem),
    // C já abordado na véspera (o contato do dia é follow-up, não abordagem nova) e uma resposta (não conta); e 1 a convidado
    const spIds = [];
    for (const name of ['Marca A', 'Marca B', 'Marca C']) spIds.push((await q("INSERT INTO sponsors (company, stage, owner_id, created_at, stage_entered_at) VALUES ($1, 'prospect', $2, $3, $3) RETURNING id", [name, u.prod.id, at(cal.addDays(W, -20))])).rows[0].id);
    const att = (kind, id, result, when) => q("INSERT INTO outreach_attempts (subject_type, subject_id, channel, result, at, created_at, user_id) VALUES ($1, $2, 'whatsapp', $3, $4, $4, $5)", [kind, id, result, when, u.prod.id]);
    await att('sponsor', spIds[0], 'enviado', at(W, '09:30')); await att('sponsor', spIds[0], 'enviado', at(W, '09:40'));
    await att('sponsor', spIds[1], 'enviado', at(W, '10:00')); await att('sponsor', spIds[1], 'respondeu', at(W, '12:00'));
    await att('sponsor', spIds[2], 'enviado', at(cal.addDays(W, -1), '10:00')); await att('sponsor', spIds[2], 'enviado', at(W, '11:00'));
    await att('guest', 1, 'enviado', at(W, '09:30'));
    // convidados: da produtora, 2 convites enviados, 1 aceite, 1 gravação marcada; da gestão, 1 convite (não conta para a produtora)
    const guest = async (owner, status) => (await q("INSERT INTO guests (name, instagram, profile, status, owner_id, created_at) VALUES ('G', 'g', 'medico', $1, $2, $3) RETURNING id", [status, owner, at(cal.addDays(W, -20))])).rows[0].id;
    await q('TRUNCATE guest_stage_log');
    const moves = [[u.prod.id, 'prospect', 'convite_enviado', '09:00'], [u.prod.id, 'convite_enviado', 'em_agendamento', '10:00'], [u.prod.id, 'prospect', 'convite_enviado', '11:00'], [u.prod.id, 'em_agendamento', 'agendado', '12:00'], [u.gestao.id, 'prospect', 'convite_enviado', '09:00']];
    for (const [owner, from, to, hm] of moves) {
      const id = await guest(owner, to);
      await q('INSERT INTO guest_stage_log (guest_id, from_status, to_status, changed_at) VALUES ($1, NULL, $2, $3), ($1, $2, $4, $5)', [id, from, at(cal.addDays(W, -20)), to, at(W, hm)]);
    }
    // patrocinador da gestão fechado no dia; reunião marcada pela produtora (e uma cancelada)
    const [{ id: sp }] = (await q("INSERT INTO sponsors (company, stage, owner_id) VALUES ('Marca Meta', 'ganho', $1) RETURNING id", [u.gestao.id])).rows;
    await q("INSERT INTO sponsor_events (sponsor_id, user_id, type, message, created_at) VALUES ($1, $2, 'etapa', 'Etapa: Em negociação → Ganho', $3)", [sp, u.gestao.id, at(W, '16:00')]);
    await q("INSERT INTO sponsor_meetings (sponsor_id, title, starts_at, owner_id, created_by, status, created_at) VALUES ($1, 'Conversa', $2, $3, $3, 'marcada', $4), ($1, 'Cancelada', $2, $3, $3, 'cancelada', $4)", [sp, at(cal.addDays(W, 3)), u.prod.id, at(W, '10:00')]);
    // entrega do editor: voltou com ajustes ao meio-dia e foi reentregue às 15h
    await q("INSERT INTO episode_events (episode_id, user_id, type, message, created_at) VALUES ($1, $2, 'etapa', 'Etapa: Em revisão → Em edição', $3), ($1, $4, 'etapa', 'Etapa: Em edição → Em revisão', $5)", [ep, u.gestao.id, at(W, '12:00'), u.editor.id, at(W, '15:00')]);
    // tarefas da produtora: uma no prazo, uma atrasada, uma sem prazo
    for (const [due, hm] of [[W, '10:00'], [cal.addDays(W, -1), '10:00'], [null, '10:00']]) {
      await q("INSERT INTO tasks (title, kind, status, assignee_id, due_on, completed_at) VALUES ('T', 'geral', 'feito', $1, $2, $3)", [u.prod.id, due, at(W, hm)]);
    }
    // post da gestão no ar no dia (um corte); seguidores: 100 na véspera e 112 no dia
    await q("INSERT INTO episode_publications (episode_id, clip_id, platforms, title, status, scheduled_at, created_by, results) VALUES ($1, $2, '{instagram}', 'P', 'publicado', $3, $4, '[{\"platform\":\"instagram\",\"ok\":true}]')", [ep, c1, at(W, '18:00'), u.gestao.id]);
    await q("INSERT INTO social_snapshots (taken_on, platform, data) VALUES ($1, 'instagram', '{\"followers\": 100}'), ($2, 'instagram', '{\"followers\": 112}')", [cal.addDays(W, -1), W]);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('cada métrica conta o que é dela, de quem é e no período', async () => {
    const v = async (...a) => (await goal(...a)).value;
    assert.equal(await v('editor', 'cortes_subidos', 'dia', 5), 3);
    assert.equal(await v('editor', 'cortes_subidos', 'semana', 5), 4, 'a segunda da mesma semana entra');
    assert.equal(await v('editor', 'revisoes_corte', 'dia', 5), 1); assert.equal(await v('gestao', 'revisoes_corte', 'dia', 5), 1);
    assert.equal(await v('prod', 'abordagens_patrocinadores', 'dia', 5), 2, 'só a abordagem nova: A e B (o follow-up de C, o segundo canal de A e a resposta não contam)');
    assert.equal(await v('prod', 'abordagens_convidados', 'dia', 5), 1);
    assert.equal(await v('prod', 'convites_enviados', 'dia', 5), 2, 'o convite do convidado da gestão não conta');
    assert.equal(await v('prod', 'convites_aceitos', 'dia', 5), 1);
    assert.equal(await v('prod', 'gravacoes_marcadas', 'dia', 5), 1);
    assert.equal(await v('prod', 'taxa_aceite', 'dia', 40), 50);
    assert.equal(await v('prod', 'reunioes_agendadas', 'dia', 1), 1, 'a cancelada não conta');
    assert.equal(await v('gestao', 'patrocinios_fechados', 'mes', 1), 1); assert.equal(await v('prod', 'patrocinios_fechados', 'mes', 1), 0);
    assert.equal(await v('editor', 'episodios_entregues', 'semana', 1), 1);
    assert.equal(await v('prod', 'tarefas_concluidas', 'dia', 3), 3);
    assert.equal(await v('prod', 'tarefas_no_prazo', 'dia', 80), 50, 'sem prazo fica de fora da taxa');
    assert.equal(await v('gestao', 'posts_publicados', 'dia', 1), 1);
    assert.equal(await v('prod', 'cortes_postados', 'dia', 1), 1, 'da equipe: o mesmo número para qualquer pessoa');
    assert.equal(await v('prod', 'seguidores_instagram', 'dia', 10), 12);
  });

  it('como a meta aparece: número, porcentagem, taxa, quanto falta e meta batida', async () => {
    let g = await goal('editor', 'cortes_subidos', 'dia', 5);
    assert.deepEqual([g.main, g.rest, g.note, g.pace, g.bar, g.met, g.periodLabel], ['3', 'de 5', 'cortes', 'faltam 2 hoje', 60, false, 'hoje']);
    g = await goal('editor', 'cortes_subidos', 'semana', 4);
    assert.deepEqual([g.main, g.pace, g.bar, g.met], ['4', 'meta batida', 100, true]);
    g = await goal('editor', 'cortes_subidos', 'semana', 6, 'porcentagem');
    assert.deepEqual([g.main, g.note, g.pace], ['67%', '4 de 6 cortes', 'faltam 2 até domingo']);
    g = await goal('prod', 'taxa_aceite', 'dia', 40, 'numero');
    assert.deepEqual([g.main, g.note, g.met], ['50%', 'meta 40% · 1 de 2', true], 'taxa aparece em porcentagem mesmo com "número"');
    g = await goal('prod', 'reunioes_agendadas', 'mes', 4);
    assert.match(g.pace, /^faltam 3 até \d{2}\/\d{2}$/);
    const sat = cal.addDays(W, 3);
    g = await goals.progress({ user_id: u.prod.id, metric: 'abordagens_patrocinadores', period: 'dia', target: 5, display: 'numero' }, sat);
    assert.equal(g.pace, 'fim de semana: sem meta hoje');
  });

  it('o formulário: até 3 metas, linha vazia ignorada, taxa até 100%, alvo maior que zero', () => {
    const ok = goals.parseSlots({ metric_1: 'cortes_subidos', period_1: 'semana', target_1: '20', display_1: 'porcentagem', metric_2: '', metric_3: 'taxa_aceite', period_3: 'mes', target_3: '35,5', display_3: 'numero' });
    assert.deepEqual(ok.goals, [{ metric: 'cortes_subidos', period: 'semana', target: 20, display: 'porcentagem', position: 0 }, { metric: 'taxa_aceite', period: 'mes', target: 35.5, display: 'porcentagem', position: 1 }]);
    assert.match(goals.parseSlots({ metric_1: 'taxa_aceite', period_1: 'mes', target_1: '120' }).error, /vai até 100%/);
    assert.match(goals.parseSlots({ metric_1: 'cortes_subidos', period_1: 'semana', target_1: '0' }).error, /maior que zero/);
    assert.match(goals.parseSlots({ metric_1: 'cortes_subidos', period_1: 'ano', target_1: '3' }).error, /período/);
    assert.match(goals.parseSlots({ metric_1: 'inventada', period_1: 'semana', target_1: '3' }).error, /o que contar/);
  });

  it('Gestão > Metas: só a gestão; salva até 3 metas por pessoa e a pessoa vê as dela no Início', async () => {
    assert.equal((await as.prod.get('/gestao/metas')).status, 403);
    assert.equal((await as.editor.get('/gestao/metas')).status, 403);
    let page = (await as.gestao.get('/gestao/metas')).text;
    for (const name of ['Ana Admin', 'Gil Gestão', 'Paula Produtora', 'Edu Editor']) assert.match(page, new RegExp(name));
    assert.match(page, /O que cada métrica conta/);
    const r = await as.gestao.act(`/gestao/metas/${u.prod.id}`, { metric_1: 'abordagens_patrocinadores', period_1: 'dia', target_1: '5', display_1: 'numero', metric_2: 'convites_enviados', period_2: 'semana', target_2: '10', display_2: 'porcentagem' }, { from: '/gestao/metas' });
    assert.equal(r.status, 302);
    assert.deepEqual((await goals.listFor(u.prod.id)).map((g) => [g.metric, g.period, Number(g.target), g.display]), [['abordagens_patrocinadores', 'dia', 5, 'numero'], ['convites_enviados', 'semana', 10, 'porcentagem']]);
    page = (await as.gestao.get('/gestao/metas')).text;
    assert.match(page, /Abordagens novas de patrocinadores · hoje/); assert.match(page, /Convites enviados · esta semana/);
    // no Início da produtora (Seu dia), a meta diária de abordagens novas vira o "de 5 · meta" do plano; a semanal fica em Minhas metas
    const home = (await as.prod.get('/')).text;
    assert.match(home, /Minhas metas/); assert.match(home, /Convites enviados · esta semana/);
    if ([0, 6].includes(new Date(`${cal.todayISO()}T12:00:00Z`).getUTCDay())) assert.match(home, /Abordagens novas de patrocinadores · hoje/, 'fim de semana: sem meta diária no plano');
    else assert.match(home, /plan-of">de 5 · meta</);
    assert.doesNotMatch((await as.gestao.get('/')).text, /Minhas metas/, 'quem não tem meta não vê o bloco');
    // erro: volta com a janela da pessoa aberta e nada muda
    const bad = await as.gestao.act(`/gestao/metas/${u.prod.id}`, { metric_1: 'taxa_aceite', period_1: 'mes', target_1: '150' }, { from: '/gestao/metas' });
    assert.match(bad.location, new RegExp(`pessoa=${u.prod.id}`));
    assert.match((await as.gestao.get(bad.location)).text, new RegExp(`id="metas-${u.prod.id}-janela"[^>]*data-open-on-load`));
    assert.equal((await goals.listFor(u.prod.id)).length, 2);
    // tirar todas
    await as.gestao.act(`/gestao/metas/${u.prod.id}`, { metric_1: '', metric_2: '', metric_3: '' }, { from: '/gestao/metas' });
    assert.equal((await goals.listFor(u.prod.id)).length, 0);
  });

  it('o Início do editor mostra o ritmo dele (cortes, revisões, entregas, próxima entrega) e as metas dele', async () => {
    const [{ id: ep2 }] = (await q("INSERT INTO episodes (number, title, status, aired_on) VALUES (41, 'Próximo', 'disponivel_edicao', $1) RETURNING id", [cal.addDays(cal.todayISO(), 2)])).rows;
    await q("INSERT INTO episode_clips (title, source, status, episode_id, storage_key, size_bytes, content_type, created_by) VALUES ('Hoje', 'upload', 'pronto', $1, 'pp/h.mp4', 10, 'video/mp4', $2)", [ep2, u.editor.id]);
    await as.gestao.act(`/gestao/metas/${u.editor.id}`, { metric_1: 'cortes_subidos', period_1: 'semana', target_1: '10', display_1: 'numero' }, { from: '/gestao/metas' });
    const page = (await as.editor.get('/')).text;
    assert.match(page, /Seu ritmo/);
    assert.match(page, /day-l">Cortes subidos hoje<\/span><span class="day-n">1</);
    assert.match(page, /day-l">Próxima entrega<\/span><span class="day-n day-n-text">EP\.041</);
    assert.match(page, /Minhas metas/); assert.match(page, /Cortes subidos · esta semana/);
    const r = await goals.rhythmFor(u.editor.id, W);
    assert.deepEqual([r.clipsToday, r.clipsWeek, r.revToday, r.deliveries.length, r.deliveries[0].again], [3, 4, 1, 1, true], 'a entrega da semana foi uma reentrega depois de ajustes');
  });
});
