// Seletor de projeto no topo do menu: só para quem participa de mais de um; o menu acompanha os módulos do projeto escolhido.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('projetos: seletor no menu', () => {
  let app; let sara; let paula;

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    await h.createUser({ name: 'Sara Super', email: 's@t.com', role: 'superadmin', projects: [1, 2] });
    await h.createUser({ name: 'Paula Produtora', email: 'p@t.com', role: 'produtora' });
    sara = h.client(app.base); await sara.login('s@t.com');
    paula = h.client(app.base); await paula.login('p@t.com');
  });
  after(async () => { await app.close(); await h.db.close(); });

  const menu = (html) => html.slice(html.indexOf('<aside class="sidebar"'), html.indexOf('</aside>'));

  it('quem participa de um projeto só não vê seletor nem sigla: o menu é o de sempre', async () => {
    const html = (await paula.get('/')).text;
    assert.doesNotMatch(html, /project-switch|project-tag|project-now/);
    const m = menu(html);
    for (const item of ['Convidados', 'Patrocinadores', 'Episódios', 'Conteúdo', 'Social', 'Plateia']) assert.match(m, new RegExp(`<span>${item}</span>`), item);
  });

  it('quem participa dos dois vê o seletor com as três opções, em "Todos os projetos"', async () => {
    const m = menu((await sara.get('/convidados?view=lista')).text);
    assert.match(m, /<details class="row-menu project-switch">/);
    assert.match(m, /<strong>Todos os projetos<\/strong>/);
    assert.match(m, /<form method="post" action="\/projeto"[^>]*>\s*<input type="hidden" name="_csrf" value="[a-f0-9]+"><input type="hidden" name="voltar" value="\/convidados\?view=lista">/);
    assert.match(m, /name="project" value="" class="on" aria-current="true"><span>Todos os projetos<\/span>/);
    assert.match(m, /name="project" value="1"><span>Pulso<\/span><span class="mono project-switch-code">PULSO<\/span>/);
    assert.match(m, /name="project" value="2"><span>Projeto 100<\/span><span class="mono project-switch-code">P100<\/span>/);
    assert.match(m, /<span>Episódios e vídeos<\/span>/);
    assert.match(m, /<span class="project-now mono">Todos<\/span>/);
  });

  it('com o Projeto 100 escolhido, o menu mostra só o que ele usa', async () => {
    await sara.act('/projeto', { project: '2', voltar: '/' });
    const m = menu((await sara.get('/')).text);
    assert.match(m, /<strong>Projeto 100<\/strong>/);
    assert.match(m, /name="project" value="2" class="on" aria-current="true">/);
    assert.match(m, /<span class="project-now mono">P100<\/span>/);
    // o Projeto 100 trabalha com vídeos, convidados e conteúdo; patrocínio, redes, plateia e financeiro ainda não são dele
    for (const item of ['Patrocinadores', 'Social', 'Plateia', 'Financeiro']) assert.doesNotMatch(m, new RegExp(`<span>${item}</span>`), item);
    for (const item of ['Painel', 'Tarefas', 'Calendário', 'Mensagens', 'Painel de gestão', 'Convidados', 'Conteúdo']) assert.match(m, new RegExp(`<span>${item}</span>`), item);
    assert.match(m, /<span>Vídeos<\/span>/, 'o item usa o nome que o projeto dá aos seus vídeos');
    assert.match(m, />Operação</, 'com Convidados e Conteúdo, o grupo aparece');
  });

  it('com o Pulso escolhido, o menu é o do Pulso e o item volta a ser "Episódios"', async () => {
    await sara.act('/projeto', { project: '1', voltar: '/' });
    const m = menu((await sara.get('/')).text);
    assert.match(m, /<strong>Pulso<\/strong>/);
    assert.match(m, /<span>Episódios<\/span>/); assert.doesNotMatch(m, /Episódios e vídeos/);
    for (const item of ['Convidados', 'Patrocinadores', 'Social', 'Plateia', 'Financeiro']) assert.match(m, new RegExp(`<span>${item}</span>`), item);
  });
});
