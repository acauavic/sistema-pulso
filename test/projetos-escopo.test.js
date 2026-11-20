// Recorte por projeto: quem participa do quê, o projeto escolhido no menu e a troca.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const scope = require('../src/services/scope');
const projects = require('../src/services/projects');

// executa o middleware como o app faz e devolve { scope, locals }
async function scopeOf(user) {
  const req = { user }; const res = { locals: {} };
  await new Promise((resolve, reject) => { scope.attach(req, res, (err) => (err ? reject(err) : resolve())); });
  return { req, scope: req.scope, locals: res.locals };
}

describe('projetos: recorte (scope)', () => {
  let app; let sara; let paula; let solo;

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    sara = await h.createUser({ name: 'Sara Super', email: 's@t.com', role: 'superadmin', projects: [1, 2] });
    paula = await h.createUser({ name: 'Paula Produtora', email: 'p@t.com', role: 'produtora' });
    solo = await h.createUser({ name: 'Zé Sem Projeto', email: 'z@t.com', role: 'editor_video', projects: [] });
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('quem participa de um projeto só: é ele, sem seletor e sem sigla', async () => {
    const { scope: s, locals } = await scopeOf(paula);
    assert.equal(s.multi, false); assert.equal(s.current.slug, 'pulso'); assert.deepEqual(s.ids, [1]); assert.equal(s.house, true);
    assert.equal(locals.projectTag(1), ''); assert.equal(locals.projectTag(2), '');
    assert.equal(locals.videoLabel, 'Episódios'); assert.equal(locals.hasModule('plateia'), true);
  });

  it('quem participa dos dois começa em "Todos os projetos", com a sigla de cada item', async () => {
    const { scope: s, locals } = await scopeOf(sara);
    assert.equal(s.multi, true); assert.equal(s.current, null); assert.deepEqual(s.ids, [1, 2]); assert.deepEqual(s.financeIds, [1, 2]);
    assert.equal(locals.projectTag(2), 'P100'); assert.equal(locals.projectTag(1), 'PULSO'); assert.equal(locals.projectTag(null), '');
    assert.equal(locals.videoLabel, 'Episódios e vídeos');
    assert.equal(locals.hasModule('plateia'), true, 'em Todos, vale o que qualquer projeto da pessoa usa');
  });

  it('pessoa sem nenhum projeto: recorte vazio, nada quebra', async () => {
    const { req, scope: s, locals } = await scopeOf(solo);
    assert.deepEqual(s.ids, []); assert.equal(s.current, null); assert.equal(s.multi, false);
    assert.equal(locals.hasModule('convidados'), true); assert.equal(locals.videoLabel, 'Episódios');
    assert.equal(scope.target(req, { project_id: '1' }), null);
    const c = h.client(app.base); await c.login('z@t.com');
    assert.equal((await c.get('/')).status, 200);
  });

  it('where: encaixa nos filtros que já existem e numera o parâmetro certo', async () => {
    const { req } = await scopeOf(sara);
    const clauses = ['g.name ILIKE $1']; const params = ['%a%'];
    scope.where(req, clauses, params, 'g');
    assert.deepEqual(clauses, ['g.name ILIKE $1', 'g.project_id = ANY($2::int[])']); assert.deepEqual(params, ['%a%', [1, 2]]);
    scope.where(req, clauses, params, 't', { orNull: true });
    assert.equal(clauses[2], '(t.project_id IS NULL OR t.project_id = ANY($3::int[]))');
    const { req: one } = await scopeOf(paula);
    const p2 = []; scope.where(one, [], p2, 'e'); assert.deepEqual(p2, [[1]]);
  });

  it('target e assert', async () => {
    const { req } = await scopeOf(sara);
    assert.equal(scope.target(req, {}), null, 'em Todos, sem escolher, falta o projeto');
    assert.equal(scope.target(req, { project_id: '2' }), 2);
    assert.equal(scope.target(req, { project_id: '9' }), null);
    const { req: one } = await scopeOf(paula);
    assert.equal(scope.target(one, { project_id: '2' }), 1, 'quem tem um projeto só cria nele, venha o que vier no formulário');
    assert.doesNotThrow(() => scope.assert(one, 1)); assert.doesNotThrow(() => scope.assert(one, null));
    assert.throws(() => scope.assert(one, 2), (e) => e.status === 404);
  });

  it('trocar de projeto guarda a escolha e volta para a mesma tela', async () => {
    const c = h.client(app.base); await c.login('s@t.com');
    const r = await c.act('/projeto', { project: '2', voltar: '/tarefas?visao=quadro' });
    assert.equal(r.status, 302); assert.equal(r.location, '/tarefas?visao=quadro');
    assert.equal((await scopeOf(sara)).scope.current.slug, 'projeto-100');
    assert.equal((await scopeOf(sara)).locals.projectTag(2), '', 'com o projeto escolhido, a sigla dele some');
    assert.equal((await scopeOf(sara)).locals.projectTag(1), 'PULSO', 'item de outro projeto continua marcado');
    assert.equal((await scopeOf(sara)).locals.hasModule('plateia'), false, 'o Projeto 100 não usa plateia');
    assert.equal((await scopeOf(sara)).locals.videoLabel, 'Vídeos');
    // voltar para "Todos"
    assert.equal((await c.act('/projeto', { project: '', voltar: '/' })).status, 302);
    assert.equal((await scopeOf(sara)).scope.current, null);
  });

  it('trocar para um projeto que não usa a tela aberta leva ao Início', async () => {
    const c = h.client(app.base); await c.login('s@t.com');
    assert.equal((await c.act('/projeto', { project: '2', voltar: '/plateia/painel' })).location, '/', 'o Projeto 100 não usa plateia');
    assert.equal((await c.act('/projeto', { project: '2', voltar: '/convidados?view=lista' })).location, '/');
    assert.equal((await c.act('/projeto', { project: '2', voltar: '/tarefas?escopo=todas' })).location, '/tarefas?escopo=todas');
    assert.equal((await c.act('/projeto', { project: '1', voltar: '/plateia/painel' })).location, '/plateia/painel');
    assert.equal((await c.act('/projeto', { project: '', voltar: '/plateia/painel' })).location, '/plateia/painel');
  });

  it('nunca redireciona para fora; projeto de que a pessoa não participa é recusado', async () => {
    const c = h.client(app.base); await c.login('s@t.com');
    for (const bad of ['https://fora.example/x', '//fora.example', '/\\fora.example', 'convidados', '']) {
      assert.equal((await c.act('/projeto', { project: '1', voltar: bad })).location, '/', bad);
    }
    const p = h.client(app.base); await p.login('p@t.com');
    const r = await p.act('/projeto', { project: '2', voltar: '/' });
    assert.equal(r.status, 400);
    assert.equal((await h.db.query('SELECT last_project_id FROM users WHERE id = $1', [paula.id])).rows[0].last_project_id, null);
  });

  it('escolha que deixou de valer (saiu do projeto ou ele foi desativado) cai em Todos', async () => {
    await projects.setLast(sara.id, 2);
    await h.db.query('UPDATE projects SET active = false WHERE id = 2'); await projects.refresh(true);
    let s = (await scopeOf(sara)).scope;
    assert.equal(s.multi, false); assert.equal(s.current.slug, 'pulso');
    await h.db.query('UPDATE projects SET active = true WHERE id = 2'); await projects.refresh(true);
    await h.db.query('DELETE FROM project_members WHERE user_id = $1 AND project_id = 2', [sara.id]);
    s = (await scopeOf(sara)).scope;
    assert.equal(s.current.slug, 'pulso'); assert.deepEqual(s.ids, [1]);
  });
});
