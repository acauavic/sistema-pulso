// Categorias de tarefa e tipos de vídeo (Gestão > Categorias), a meta "Vídeos entregues" por tipo e as rotinas que se repetem (em
// Gestão > Rotinas e no "Repetir" da tarefa nova), criando tarefa ou pedido de conteúdo.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const catalog = require('../src/services/catalog');
const recurring = require('../src/services/recurring');
const goals = require('../src/services/goals');
const R = require('../src/services/contentRequests');

describe('Categorias, tipos de vídeo e rotinas que se repetem', () => {
  const as = {}; const u = {}; let app;
  const q = (sql, p) => h.db.query(sql, p);
  const today = recurring.todayISO();
  const morning = new Date(`${today}T13:00:00Z`); // 10h em Brasília

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora'], ['editor', 'editor_video']]) {
      u[k] = await h.createUser({ name: `Pessoa ${k}`, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`);
    }
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('Gestão > Categorias: os que já existiam vêm como padrão; criar, renomear e desativar (só a gestão)', async () => {
    assert.equal((await as.prod.get('/gestao/categorias')).status, 403);
    let page = (await as.gestao.get('/gestao/categorias')).text;
    for (const label of ['Cortes do episódio', 'Trailer do canal', 'Bastidores', 'Geral', 'Q&amp;A']) assert.match(page, new RegExp(label));
    let r = await as.gestao.act('/gestao/categorias/video', { label: 'Vídeo de bastidor' }, { from: '/gestao/categorias' });
    assert.equal(r.status, 302);
    await as.gestao.act('/gestao/categorias/video', { label: 'vídeo de BASTIDOR' }, { from: '/gestao/categorias' });
    assert.equal((await q("SELECT count(*)::int AS n FROM video_types WHERE lower(label) = 'vídeo de bastidor'")).rows[0].n, 1, 'nome repetido não entra');
    await as.gestao.act('/gestao/categorias/tarefa', { label: 'Financeiro' }, { from: '/gestao/categorias' });
    const vt = (await q("SELECT key FROM video_types WHERE label = 'Vídeo de bastidor'")).rows[0].key;
    const tc = (await q("SELECT key FROM task_categories WHERE label = 'Financeiro'")).rows[0].key;
    assert.match(vt, /^t_/); assert.match(tc, /^c_/);
    page = (await as.prod.get('/conteudo')).text;
    assert.match(page, new RegExp(`name="kind" value="${vt}"`), 'o tipo novo aparece em Pedir conteúdo');
    page = (await as.prod.get('/tarefas')).text;
    assert.match(page, new RegExp(`<option value="${tc}">Financeiro</option>`), 'a categoria nova aparece na tarefa nova');
    r = await as.gestao.act(`/gestao/categorias/tarefa/${tc}`, { label: 'Financeiro e contas' }, { from: '/gestao/categorias' });
    assert.equal((await q('SELECT label FROM task_categories WHERE key = $1', [tc])).rows[0].label, 'Financeiro e contas');
    await as.gestao.act(`/gestao/categorias/tarefa/${tc}`, { ativo: '0' }, { from: '/gestao/categorias' });
    assert.doesNotMatch((await as.prod.get('/tarefas')).text, new RegExp(`<option value="${tc}">`), 'desativada some da lista');
    await as.gestao.act(`/gestao/categorias/tarefa/${tc}`, { ativo: '1' }, { from: '/gestao/categorias' });
  });

  it('pedido com o tipo novo; tipo desativado não serve para pedido novo', async () => {
    const vt = (await q("SELECT key FROM video_types WHERE label = 'Vídeo de bastidor'")).rows[0].key;
    await as.prod.act('/conteudo/pedidos', { kind: vt, title: 'Bastidor da gravação', assignee_id: u.editor.id }, { from: '/conteudo' });
    assert.equal((await q('SELECT count(*)::int AS n FROM content_requests WHERE kind = $1', [vt])).rows[0].n, 1);
    await as.gestao.act('/gestao/categorias/video/extra', { ativo: '0' }, { from: '/gestao/categorias' });
    await as.prod.act('/conteudo/pedidos', { kind: 'extra', title: 'Não pode' }, { from: '/conteudo' });
    assert.equal((await q("SELECT count(*)::int AS n FROM content_requests WHERE title = 'Não pode'")).rows[0].n, 0);
    await as.gestao.act('/gestao/categorias/video/extra', { ativo: '1' }, { from: '/gestao/categorias' });
  });

  it('meta "Vídeos entregues" por tipo: conta a primeira entrega de cada vídeo, de quem enviou para revisão', async () => {
    const vt = (await q("SELECT key FROM video_types WHERE label = 'Vídeo de bastidor'")).rows[0].key;
    assert.match(goals.parseSlots({ metric_1: 'videos_entregues', period_1: 'semana', target_1: '3' }).error, /tipo de vídeo/);
    assert.match(goals.parseSlots({ metric_1: 'videos_entregues', period_1: 'semana', target_1: '3', param_1: 'cortes' }).error, /tipo de vídeo/, 'cortes do episódio contam em Cortes subidos');
    assert.deepEqual(goals.parseSlots({ metric_1: 'videos_entregues', period_1: 'semana', target_1: '3', param_1: vt }).goals[0].param, vt);
    const [req] = (await q('SELECT * FROM content_requests WHERE kind = $1', [vt])).rows;
    await q("UPDATE content_requests SET status = 'producao' WHERE id = $1", [req.id]);
    await q("INSERT INTO episode_clips (title, source, status, request_id, storage_key, size_bytes, content_type, created_by) VALUES ('Bastidor', 'upload', 'pronto', $1, 'pp/b.mp4', 10, 'video/mp4', $2)", [req.id, u.editor.id]);
    assert.ok((await R.deliver(await R.get(req.id), u.editor)).ok);
    await q("UPDATE content_requests SET status = 'producao' WHERE id = $1", [req.id]); // voltou com ajustes
    assert.ok((await R.deliver(await R.get(req.id), u.editor)).ok);
    const g = await goals.progress({ user_id: u.editor.id, metric: 'videos_entregues', param: vt, period: 'semana', target: 3, display: 'numero' });
    assert.equal(g.value, 1, 'a reentrega não conta de novo'); assert.equal(g.label, 'Vídeos entregues · Vídeo de bastidor');
    await as.gestao.act(`/gestao/metas/${u.editor.id}`, { metric_1: 'videos_entregues', period_1: 'semana', target_1: '3', display_1: 'numero', param_1: vt }, { from: '/gestao/metas' });
    assert.deepEqual((await goals.listFor(u.editor.id)).map((x) => [x.metric, x.param]), [['videos_entregues', vt]]);
  });

  it('rotina que se repete: cria a tarefa ou o pedido do dia uma vez; dia útil, semana e mês caem nos dias certos', async () => {
    const wd = recurring.isoWeekday(today);
    let r = await as.gestao.act('/gestao/rotinas', { trigger: 'recorrente', repeat: 'semana', title: 'Conferir as metas', kind: 'geral', assignee_mode: 'ninguem', active: '1' }, { from: '/gestao/rotinas' });
    assert.equal((await q("SELECT count(*)::int AS n FROM task_routines WHERE title = 'Conferir as metas'")).rows[0].n, 0, 'semana sem dia marcado não entra');
    r = await as.gestao.act('/gestao/rotinas', { trigger: 'recorrente', repeat: 'semana', weekdays: [String(wd)], due_time: '14:00', title: 'Postar o bastidor da semana', kind: 'geral', assignee_mode: 'usuario', assignee_id: u.prod.id, active: '1' }, { from: '/gestao/rotinas' });
    assert.equal(r.status, 302);
    const vt = (await q("SELECT key FROM video_types WHERE label = 'Vídeo de bastidor'")).rows[0].key;
    await as.gestao.act('/gestao/rotinas', { trigger: 'recorrente', repeat: 'semana', weekdays: [String(wd)], title: 'Bastidor da semana', target: 'pedido', request_kind: vt, assignee_mode: 'usuario', assignee_id: u.editor.id, active: '1' }, { from: '/gestao/rotinas' });
    assert.equal(await recurring.tick(new Date(`${today}T06:00:00Z`)), 0, 'às 3h ainda não cria');
    assert.equal(await recurring.tick(morning), 2);
    assert.equal(await recurring.tick(morning), 0, 'no mesmo dia não repete');
    const [task] = (await q("SELECT * FROM tasks WHERE title = 'Postar o bastidor da semana'")).rows;
    assert.equal(task.assignee_id, u.prod.id); assert.equal(String(task.due_time).slice(0, 5), '14:00');
    assert.equal(new Date(task.due_on).toISOString().slice(0, 10) <= today, true);
    const [pedido] = (await q("SELECT * FROM content_requests WHERE title = 'Bastidor da semana'")).rows;
    assert.deepEqual([pedido.kind, pedido.assignee_id], [vt, u.editor.id]);
    assert.match((await as.gestao.get('/gestao/rotinas')).text, /Toda semana: /);
    // dias certos
    assert.equal(recurring.fallsOn({ repeat: 'dia_util' }, '2026-11-21'), false, 'sábado');
    assert.equal(recurring.fallsOn({ repeat: 'dia_util' }, '2026-11-20'), true);
    assert.equal(recurring.fallsOn({ repeat: 'mes', month_day: 31 }, '2026-11-30'), true, 'mês de 30 dias: o 31 cai no último dia');
    assert.equal(recurring.fallsOn({ repeat: 'mes', month_day: 5 }, '2026-11-30'), false);
  });

  it('"Repetir" na tarefa nova: a tarefa é a primeira e a rotina cria as próximas; quem criou pode parar', async () => {
    await as.prod.act('/tarefas', { title: 'Relatório da semana', kind: 'geral', assignee_id: u.prod.id, due_on: today, repete: 'semana' }, { from: '/tarefas' });
    const [t] = (await q("SELECT * FROM tasks WHERE title = 'Relatório da semana'")).rows;
    const [rt] = (await q('SELECT * FROM task_routines WHERE id = $1', [t.routine_id])).rows;
    assert.deepEqual([rt.trigger, rt.repeat, rt.weekdays.map(Number), rt.assignee_id], ['recorrente', 'semana', [recurring.isoWeekday(today)], u.prod.id]);
    assert.equal(await recurring.tick(morning), 0, 'hoje já tem a primeira');
    const page = (await as.prod.get(`/tarefas/${t.id}`)).text;
    assert.match(page, /Repete: Toda semana: /); assert.match(page, /parar de repetir/);
    assert.equal((await as.editor.act(`/tarefas/${t.id}/parar-de-repetir`, {}, { from: `/tarefas/${t.id}` })).status, 403);
    await as.prod.act(`/tarefas/${t.id}/parar-de-repetir`, {}, { from: `/tarefas/${t.id}` });
    assert.equal((await q('SELECT active FROM task_routines WHERE id = $1', [rt.id])).rows[0].active, false);
  });

  it('o catálogo vale também fora de uma página (agendador e serviços)', async () => {
    await catalog.refresh(true);
    assert.ok(catalog.isVideoType('bastidores'));
    assert.ok(catalog.taskOptions().includes('geral'));
  });
});
