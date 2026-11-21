// As telas que juntavam tudo passam a seguir o projeto escolhido: Início, Resumo do dia, Seu dia, Calendário, Busca e Avisos.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const main = (html) => html.slice(html.indexOf('<main'));
const hoje = new Date().toISOString().slice(0, 10);

describe('projetos: as telas do dia a dia seguem o projeto', () => {
  let app; let sara; let paula; let u = {};

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    u.sara = await h.createUser({ name: 'Sara Super', email: 's@t.com', role: 'superadmin', projects: [1, 2] });
    u.paula = await h.createUser({ name: 'Paula Produtora', email: 'p@t.com', role: 'produtora' }); // só o Pulso
    await h.db.query("UPDATE projects SET modules = modules || '{\"producao\": true, \"convidados\": true}'::jsonb WHERE id = 2");
    await require('../src/services/projects').refresh(true);
    for (const [pid, marca] of [[1, 'AAA'], [2, 'BBB']]) {
      await h.db.query("INSERT INTO guests (name, status, project_id, owner_id, proposed_at) VALUES ($1, 'agendado', $2, $3, now() + interval '2 days')", [`Convidada ${marca}`, pid, u.sara.id]);
      const { rows: [ep] } = await h.db.query("INSERT INTO episodes (title, number, project_id, status, aired_on) VALUES ($1, $2, $3, 'disponivel_edicao', $4) RETURNING id", [`Episodio ${marca}`, pid, pid, hoje]);
      await h.db.query("INSERT INTO tasks (title, kind, status, assignee_id, created_by, due_on, project_id) VALUES ($1, 'geral', 'a_fazer', $2, $2, $3, $4)", [`Tarefa ${marca}`, u.sara.id, hoje, pid]);
      await h.db.query("INSERT INTO episode_clips (title, status, source, storage_key, episode_id, project_id, created_by) VALUES ($1, 'pronto', 'upload', $2, $3, $4, $5)", [`Corte ${marca}`, `pp/c/${pid}.mp4`, ep.id, pid, u.sara.id]);
    }
    sara = h.client(app.base); await sara.login('s@t.com');
    paula = h.client(app.base); await paula.login('p@t.com');
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('Início do editor: a ordem de edição é a do projeto escolhido', async () => {
    const edu = await h.createUser({ name: 'Edu Editor', email: 'e@t.com', role: 'editor_video', projects: [1, 2] });
    const c = h.client(app.base); await c.login('e@t.com');
    const todos = main((await c.get('/')).text);
    assert.ok(todos.includes('Episodio AAA') && todos.includes('Episodio BBB'), 'em Todos, a fila junta os projetos');
    await c.act('/projeto', { project: '2', voltar: '/' });
    const so100 = main((await c.get('/')).text);
    assert.ok(so100.includes('Episodio BBB') && !so100.includes('Episodio AAA'));
    assert.ok(edu.id);
  });

  it('Calendário: só os itens do projeto escolhido', async () => {
    const url = `/calendario?f=1&visao=lista&data=${hoje}&resp=todos&tipos=tarefa&tipos=gravacao&tipos=episodio`;
    const todos = main((await sara.get(url)).text);
    for (const t of ['Tarefa AAA', 'Tarefa BBB', 'Convidada AAA', 'Convidada BBB', 'Episodio AAA', 'Episodio BBB']) assert.ok(todos.includes(t), t);
    await sara.act('/projeto', { project: '1', voltar: '/' });
    const pulso = main((await sara.get(url)).text);
    for (const t of ['Tarefa AAA', 'Convidada AAA', 'Episodio AAA']) assert.ok(pulso.includes(t), t);
    for (const t of ['Tarefa BBB', 'Convidada BBB', 'Episodio BBB']) assert.ok(!pulso.includes(t), `vazou: ${t}`);
    assert.ok(!main((await paula.get(url)).text).includes('BBB'), 'quem é só do Pulso nunca vê o outro');
    await sara.act('/projeto', { project: '', voltar: '/' });
  });

  it('Busca global: só o que é do projeto escolhido', async () => {
    const achar = async (c, q) => JSON.stringify(JSON.parse((await c.get(`/busca?q=${encodeURIComponent(q)}`)).text));
    const tudo = await achar(sara, 'BBB');
    assert.ok(tudo.includes('Convidada BBB'), `em Todos a busca acha: ${tudo.slice(0, 300)}`);
    await sara.act('/projeto', { project: '1', voltar: '/' });
    const so1 = await achar(sara, 'BBB');
    for (const t of ['Convidada BBB', 'Episodio BBB', 'Tarefa BBB', 'Corte BBB']) assert.ok(!so1.includes(t), `vazou na busca: ${t}`);
    const so2 = await achar(sara, 'AAA');
    assert.ok(so2.includes('Convidada AAA'), `no Pulso acha o do Pulso: ${so2.slice(0, 300)}`);
    const dela = JSON.parse((await paula.get('/busca?q=BBB')).text);
    assert.equal(dela.groups.filter((g) => g.label !== 'Ações e atalhos').length, 0, `quem é só do Pulso não acha o do Projeto 100: ${JSON.stringify(dela.groups)}`);
    await sara.act('/projeto', { project: '', voltar: '/' });
  });

  it('Resumo do dia: os números são os do projeto escolhido', async () => {
    const { rows: [g] } = await h.db.query("SELECT id FROM guests WHERE name = 'Convidada BBB'");
    await h.db.query("INSERT INTO guest_stage_log (guest_id, from_status, to_status, changed_at) VALUES ($1, 'prospect', 'convite_enviado', now())", [g.id]);
    const conta = (html) => {
      const i = html.indexOf('>Convites enviados<');
      const trecho = html.slice(i, i + 400);
      const n = Number((trecho.match(/day-n">\s*(\d+)/) || [])[1]);
      assert.ok(Number.isFinite(n), `não achei o número: ${trecho.slice(0, 200)}`);
      return n;
    };
    const todos = (await sara.get('/?visao=equipe')).text;
    assert.equal(conta(todos), 1, 'em Todos, o convite do Projeto 100 conta');
    await sara.act('/projeto', { project: '1', voltar: '/' });
    assert.equal(conta((await sara.get('/?visao=equipe')).text), 0, 'no Pulso, ele não conta');
    await sara.act('/projeto', { project: '2', voltar: '/' });
    assert.equal(conta((await sara.get('/?visao=equipe')).text), 1);
    await sara.act('/projeto', { project: '', voltar: '/' });
  });

  it('Avisos: o aviso de um item fica no projeto dele', async () => {
    const { notify } = require('../src/services/notify');
    const { rows: [tarefa] } = await h.db.query("SELECT id FROM tasks WHERE title = 'Tarefa BBB'");
    await notify({ type: 'tarefa', users: [u.sara.id], title: 'Tarefa BBB mudou', entity: { type: 'task', id: tarefa.id } });
    const { rows: [n] } = await h.db.query("SELECT project_id FROM notifications WHERE title = 'Tarefa BBB mudou'");
    assert.equal(n.project_id, 2, 'o aviso guarda o projeto do item');
    assert.ok(main((await sara.get('/notificacoes')).text).includes('Tarefa BBB mudou'));
    await sara.act('/projeto', { project: '1', voltar: '/' });
    assert.ok(!main((await sara.get('/notificacoes')).text).includes('Tarefa BBB mudou'), 'no Pulso, o aviso do Projeto 100 não aparece');
    // aviso do sistema (sem item) aparece em qualquer recorte
    await notify({ type: 'tarefa', users: [u.sara.id], title: 'Aviso geral do sistema' });
    assert.ok(main((await sara.get('/notificacoes')).text).includes('Aviso geral do sistema'));
    await sara.act('/projeto', { project: '', voltar: '/' });
  });
});
