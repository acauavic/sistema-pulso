// Página de detalhe: item de projeto de que a pessoa não participa responde 404; para quem vê os dois, a sigla ao lado do título.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('projetos: páginas de detalhe', () => {
  let app; let sara; let paula; const urls = { 1: [], 2: [] }; let generalTask;

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    await h.createUser({ name: 'Sara Super', email: 's@t.com', role: 'superadmin', projects: [1, 2] });
    await h.createUser({ name: 'Paula Produtora', email: 'p@t.com', role: 'produtora' });
    for (const pid of [1, 2]) {
      const id = async (sql, params) => (await h.db.query(sql, params)).rows[0].id;
      const ep = await id('INSERT INTO episodes (title, number, project_id) VALUES ($1, $2, $2) RETURNING id', [`Episodio ${pid}`, pid]);
      urls[pid] = [
        `/convidados/${await id('INSERT INTO guests (name, project_id) VALUES ($1, $2) RETURNING id', [`Convidada ${pid}`, pid])}`,
        `/patrocinadores/${await id('INSERT INTO sponsors (company, project_id) VALUES ($1, $2) RETURNING id', [`Marca ${pid}`, pid])}`,
        `/episodios/${ep}`,
        `/cortes/${await id("INSERT INTO episode_clips (title, status, source, storage_key, episode_id, project_id) VALUES ($1, 'pronto', 'upload', 'pp/c.mp4', $2, $3) RETURNING id", [`Corte ${pid}`, ep, pid])}`,
        `/conteudo/pedidos/${await id("INSERT INTO content_requests (kind, title, project_id) VALUES ('video', $1, $2) RETURNING id", [`Pedido ${pid}`, pid])}`,
        `/tarefas/${await id("INSERT INTO tasks (title, kind, status, project_id) VALUES ($1, 'geral', 'a_fazer', $2) RETURNING id", [`Tarefa ${pid}`, pid])}`,
      ];
    }
    generalTask = `/tarefas/${(await h.db.query("INSERT INTO tasks (title, kind, status) VALUES ('Tarefa geral', 'geral', 'a_fazer') RETURNING id")).rows[0].id}`;
    sara = h.client(app.base); await sara.login('s@t.com');
    paula = h.client(app.base); await paula.login('p@t.com');
  });
  after(async () => { await app.close(); await h.db.close(); });

  const h1 = (html) => (html.match(/<h1>[\s\S]*?<\/h1>/) || [''])[0];

  it('quem é só do Pulso abre o que é do Pulso e recebe 404 no que é do Projeto 100', async () => {
    for (const url of urls[1]) { const r = await paula.get(url); assert.equal(r.status, 200, url); assert.doesNotMatch(r.text, /project-tag/, url); }
    for (const url of urls[2]) {
      const r = await paula.get(url);
      assert.equal(r.status, 404, url); assert.match(r.text, /Página não encontrada/); assert.doesNotMatch(r.text, / 2<\/|Convidada 2|Marca 2|Episodio 2/, url);
    }
  });

  it('quem vê os dois: em "Todos", a sigla ao lado do título; com o projeto do item escolhido, sem sigla', async () => {
    for (const [pid, sigla] of [[1, 'PULSO'], [2, 'P100']]) {
      for (const url of urls[pid]) { const r = await sara.get(url); assert.equal(r.status, 200, url); assert.match(h1(r.text), new RegExp(`\\[ ${sigla} \\]`), url); }
    }
    await sara.act('/projeto', { project: '2', voltar: '/' });
    for (const url of urls[2]) assert.doesNotMatch(h1((await sara.get(url)).text), /project-tag/, url);
    // item de outro projeto continua abrindo, e a página diz de onde ele é
    for (const url of urls[1]) { const r = await sara.get(url); assert.equal(r.status, 200, url); assert.match(h1(r.text), /\[ PULSO \]/, url); }
    await sara.act('/projeto', { project: '', voltar: '/' });
  });

  it('tarefa geral abre para todos, sem sigla', async () => {
    for (const c of [sara, paula]) { const r = await c.get(generalTask); assert.equal(r.status, 200); assert.doesNotMatch(h1(r.text), /project-tag/); }
  });
});
