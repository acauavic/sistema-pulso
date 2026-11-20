// Gestão > Sistema > Projetos: nome, sigla e quem participa de cada projeto.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('Gestão > Projetos', () => {
  let app; let gil; let paula; const u = {};

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    u.gil = await h.createUser({ name: 'Gil Gestão', email: 'g@t.com', role: 'gestao', projects: [1, 2] });
    u.paula = await h.createUser({ name: 'Paula Produtora', email: 'p@t.com', role: 'produtora' });
    u.edu = await h.createUser({ name: 'Edu Editor', email: 'e@t.com', role: 'editor_video' });
    gil = h.client(app.base); await gil.login('g@t.com');
    paula = h.client(app.base); await paula.login('p@t.com');
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('só a gestão entra; a aba fica em Sistema', async () => {
    assert.equal((await paula.get('/gestao/projetos')).status, 403);
    const r = await gil.get('/gestao/projetos');
    assert.equal(r.status, 200);
    assert.match(r.text, /<a href="\/gestao\/projetos" class="on" aria-current="page">Projetos<\/a>/);
    assert.match(r.text, /<strong>Pulso<\/strong>\s*<span class="mono small muted">PULSO · Episódios · EP\.001<\/span>/);
    assert.match(r.text, /<strong>Projeto 100<\/strong>\s*<span class="mono small muted">P100 · Vídeos · V\.001<\/span>/);
    assert.match(r.text, /<span class="mono small muted">3 pessoas<\/span>/); assert.match(r.text, /<span class="mono small muted">1 pessoa<\/span>/);
    assert.doesNotMatch(r.text.slice(r.text.indexOf('<main')), /class="btn primary"(?![^<]*Salvar)/, 'sem ação principal na página: só dentro das janelas');
  });

  it('marcar a produtora no Projeto 100: ela passa a ver o seletor', async () => {
    assert.doesNotMatch((await paula.get('/')).text, /project-switch/);
    const r = await gil.act('/gestao/projetos/2/pessoas', { users: [u.gil.id, u.paula.id] }, { from: '/gestao/projetos' });
    assert.equal(r.status, 302);
    assert.match((await gil.get('/gestao/projetos')).text, /2 pessoas participam do Projeto 100\./);
    assert.match((await paula.get('/')).text, /<details class="row-menu project-switch">/);
    const { rows } = await h.db.query('SELECT finance FROM project_members WHERE project_id = 2 AND user_id = $1', [u.paula.id]);
    assert.equal(rows[0].finance, false, 'quem entra nasce sem o financeiro do projeto');
  });

  it('ninguém fica sem projeto', async () => {
    const r = await gil.act('/gestao/projetos/1/pessoas', { users: [u.gil.id, u.paula.id] }, { from: '/gestao/projetos' }); // tira o Edu do único projeto dele
    assert.equal(r.status, 302);
    assert.match((await gil.get('/gestao/projetos')).text, /Toda pessoa participa de pelo menos um projeto\. Edu Editor só participa deste\./);
    assert.equal((await h.db.query('SELECT 1 FROM project_members WHERE project_id = 1 AND user_id = $1', [u.edu.id])).rows.length, 1);
  });

  it('editar nome e sigla: vale nos cartões e no seletor; sigla repetida é recusada', async () => {
    const base = { name: 'Projeto 100', video_label: 'Vídeo', video_label_plural: 'Vídeos', number_prefix: 'V.' };
    assert.equal((await gil.act('/gestao/projetos/2', { ...base, sigla: 'cem' }, { from: '/gestao/projetos' })).status, 302);
    await h.db.query("INSERT INTO guests (name, project_id) VALUES ('Dra. Sigla', 2)");
    assert.match((await gil.get('/convidados')).text, /class="project-tag mono"[^>]*>\[ CEM \]/);
    assert.match((await gil.get('/')).text, /<span class="mono project-switch-code">CEM<\/span>/);
    await gil.act('/gestao/projetos/2', { ...base, sigla: 'PULSO' }, { from: '/gestao/projetos' });
    assert.match((await gil.get('/gestao/projetos')).text, /Já existe um projeto com esta sigla\./);
    assert.equal((await gil.act('/gestao/projetos/99', { ...base, sigla: 'X9' }, { from: '/gestao/projetos' })).location, '/gestao/projetos');
  });

  it('as mudanças entram na auditoria em português', async () => {
    const html = (await gil.get('/auditoria')).text;
    assert.match(html, /Pessoas do projeto alteradas/); assert.match(html, /Projeto · editado/);
  });
});
