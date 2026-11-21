// As cinco telas de trabalho seguem o seletor de projeto: Convidados, Patrocinadores, Episódios, Conteúdo e Tarefas.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const PAGES = [
  ['/convidados', 'Convidada'], ['/convidados?view=lista', 'Convidada'],
  ['/patrocinadores', 'Marca'], ['/patrocinadores?view=lista', 'Marca'],
  ['/episodios', 'Episodio'], ['/episodios?view=lista', 'Episodio'],
  ['/conteudo', 'Corte'], ['/conteudo?vista=cortes', 'Corte'], ['/conteudo?vista=pedidos', 'Pedido'], ['/conteudo', 'Pedido'],
  ['/tarefas?escopo=todas', 'Tarefa'], ['/tarefas?escopo=todas&visao=quadro', 'Tarefa'],
];
const main = (html) => html.slice(html.indexOf('<main'));
const tags = (html) => (main(html).match(/class="project-tag mono"[^>]*>\[ [A-Z0-9]+ \]/g) || []).map((t) => t.replace(/.*\[ (\w+) \]/, '$1'));

describe('projetos: as listas seguem o seletor', () => {
  let app; let sara; let paula;

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    await h.createUser({ name: 'Sara Super', email: 's@t.com', role: 'superadmin', projects: [1, 2] });
    await h.createUser({ name: 'Paula Produtora', email: 'p@t.com', role: 'produtora' });
    for (const [pid, mark] of [[1, 'AAA'], [2, 'BBB']]) {
      await h.db.query('INSERT INTO guests (name, project_id) VALUES ($1, $2)', [`Convidada ${mark}`, pid]);
      await h.db.query('INSERT INTO sponsors (company, project_id) VALUES ($1, $2)', [`Marca ${mark}`, pid]);
      const { rows: [ep] } = await h.db.query('INSERT INTO episodes (title, number, project_id) VALUES ($1, $2, $3) RETURNING id', [`Episodio ${mark}`, pid, pid]);
      await h.db.query("INSERT INTO episode_clips (title, status, source, storage_key, episode_id, project_id) VALUES ($1, 'pronto', 'upload', $2, $3, $4)", [`Corte ${mark}`, `pp/cortes/${pid}/a.mp4`, ep.id, pid]);
      await h.db.query("INSERT INTO content_requests (kind, title, project_id) VALUES ('video', $1, $2)", [`Pedido ${mark}`, pid]);
      await h.db.query("INSERT INTO tasks (title, kind, status, project_id) VALUES ($1, 'geral', 'a_fazer', $2)", [`Tarefa ${mark}`, pid]);
    }
    await h.db.query("INSERT INTO tasks (title, kind, status) VALUES ('Tarefa GERAL', 'geral', 'a_fazer')");
    sara = h.client(app.base); await sara.login('s@t.com');
    paula = h.client(app.base); await paula.login('p@t.com');
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('em "Todos os projetos": os dois aparecem, cada um com a sua sigla', async () => {
    for (const [path, word] of PAGES) {
      const html = main((await sara.get(path)).text);
      assert.ok(html.includes(`${word} AAA`), `${path}: falta o do Pulso`);
      assert.ok(html.includes(`${word} BBB`), `${path}: falta o do Projeto 100`);
      const t = tags(html);
      assert.ok(t.includes('PULSO') && t.includes('P100'), `${path}: siglas ${t.join(',') || '(nenhuma)'}`);
    }
  });

  it('com o Pulso escolhido: só o do Pulso, sem sigla', async () => {
    await sara.act('/projeto', { project: '1', voltar: '/' });
    for (const [path, word] of PAGES) {
      const html = main((await sara.get(path)).text);
      assert.ok(html.includes(`${word} AAA`), `${path}: falta o do Pulso`);
      assert.ok(!html.includes(`${word} BBB`), `${path}: vazou o do Projeto 100`);
      assert.deepEqual(tags(html), [], `${path}: não devia ter sigla`);
    }
  });

  it('com o Projeto 100 escolhido: só o dele', async () => {
    await sara.act('/projeto', { project: '2', voltar: '/' });
    for (const [path, word] of PAGES) {
      const html = main((await sara.get(path)).text);
      assert.ok(html.includes(`${word} BBB`), `${path}: falta o do Projeto 100`);
      assert.ok(!html.includes(`${word} AAA`), `${path}: vazou o do Pulso`);
      assert.deepEqual(tags(html), [], `${path}: não devia ter sigla`);
    }
    await sara.act('/projeto', { project: '', voltar: '/' });
  });

  it('quem participa só do Pulso nunca vê o que é do Projeto 100, nem sigla', async () => {
    for (const [path, word] of PAGES) {
      const html = main((await paula.get(path)).text);
      assert.ok(html.includes(`${word} AAA`), `${path}: falta o do Pulso`);
      assert.ok(!html.includes(`${word} BBB`), `${path}: vazou o do Projeto 100`);
      assert.deepEqual(tags(html), [], `${path}: não devia ter sigla`);
    }
  });

  it('tarefa geral (sem projeto) aparece em qualquer recorte, sem sigla', async () => {
    for (const project of ['', '1', '2']) {
      await sara.act('/projeto', { project, voltar: '/' });
      const html = main((await sara.get('/tarefas?escopo=todas')).text);
      assert.ok(html.includes('Tarefa GERAL'), `recorte ${project || 'todos'}`);
    }
    await sara.act('/projeto', { project: '', voltar: '/' });
    const html = main((await sara.get('/tarefas?escopo=todas')).text);
    const row = html.slice(html.indexOf('Tarefa GERAL'), html.indexOf('Tarefa GERAL') + 400);
    assert.doesNotMatch(row.split('</li>')[0], /project-tag/);
    assert.ok(main((await paula.get('/tarefas?escopo=todas')).text).includes('Tarefa GERAL'));
  });

  it('busca, filtros e seletor de episódio continuam valendo junto com o recorte', async () => {
    await sara.act('/projeto', { project: '2', voltar: '/' });
    assert.ok(!main((await sara.get('/convidados?view=lista&q=AAA')).text).includes('Convidada AAA'), 'a busca não fura o recorte');
    assert.ok(main((await sara.get('/convidados?view=lista&q=BBB')).text).includes('Convidada BBB'));
    assert.ok(!main((await sara.get('/patrocinadores?view=lista&q=Marca')).text).includes('Marca AAA'));
    assert.ok(!main((await sara.get('/tarefas?escopo=todas&q=AAA')).text).includes('Tarefa AAA'));
    const conteudo = main((await sara.get('/conteudo?vista=cortes')).text);
    assert.ok(conteudo.includes('Episodio BBB') && !conteudo.includes('Episodio AAA'), 'a lista de episódios do Conteúdo segue o recorte');
    await sara.act('/projeto', { project: '', voltar: '/' });
  });
});
