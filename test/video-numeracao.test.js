// Numeração por projeto: EP.012 no Pulso e V.003 no Projeto 100 convivem, e cada tela mostra o prefixo do projeto do vídeo.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const fmt = require('../src/utils/format');
const production = require('../src/services/production');

describe('vídeo: numeração e prefixo por projeto', () => {
  let app; let c; let sara; const ep = {};

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    sara = await h.createUser({ name: 'Sara Super', email: 's@t.com', role: 'superadmin', projects: [1, 2] });
    await h.db.query("UPDATE projects SET modules = modules || '{\"producao\": true, \"convidados\": true}'::jsonb WHERE id = 2");
    await require('../src/services/projects').refresh(true);
    c = h.client(app.base); await c.login('s@t.com');
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('o helper escreve o número com o prefixo do projeto', () => {
    assert.equal(fmt.epNo(7, 'V.'), 'V.007');
    assert.equal(fmt.epNo(12), 'EP.012');
    assert.equal(fmt.epNo(null, 'V.'), '');
    assert.equal(fmt.epLabel(3, 'Teste', 'V.'), 'V.003 · Teste');
    assert.equal(fmt.epLabel(null, 'Sem número', 'V.'), 'Sem número');
  });

  it('cada projeto conta a partir do 1, sem esbarrar no outro', async () => {
    await h.db.query("INSERT INTO episodes (title, number, project_id) VALUES ('Antigo do Pulso', 30, 1)");
    ep.pulso = await production.createEpisode({ title: 'Conversa nova', userId: sara.id, projectId: 1 });
    assert.equal(ep.pulso.number, 31); assert.equal(ep.pulso.format, 'podcast');
    ep.cem = await production.createEpisode({ title: 'Vídeo do Cem', userId: sara.id, projectId: 2 });
    assert.equal(ep.cem.number, 1, 'o Projeto 100 começa do 1');
    assert.equal(ep.cem.format, 'video', 'o formato vem do padrão do projeto');
    const outro = await production.createEpisode({ title: 'Outro vídeo', userId: sara.id, projectId: 2 });
    assert.equal(outro.number, 2);
  });

  it('o episódio nasce no projeto do convidado, com o número daquele projeto', async () => {
    const { rows: [g] } = await h.db.query("INSERT INTO guests (name, status, project_id) VALUES ('Dra. Cem', 'gravado', 2) RETURNING id");
    const e = await production.syncFromGuest(g.id, sara.id);
    assert.equal(e.project_id, 2); assert.equal(e.number, 3);
  });

  it('as telas mostram V.001 no vídeo do Projeto 100 e EP.031 no episódio do Pulso', async () => {
    const lista = (await c.get('/episodios?view=lista')).text;
    assert.match(lista, /V\.001/); assert.match(lista, /EP\.031/);
    assert.doesNotMatch(lista, /EP\.001/, 'o vídeo do Projeto 100 não usa o prefixo do Pulso');
    const quadro = (await c.get('/episodios')).text;
    assert.match(quadro, /V\.001/); assert.match(quadro, /EP\.031/);
    assert.match((await c.get(`/episodios/${ep.cem.id}`)).text, /V\.001/);
    // tarefa ligada ao vídeo
    await h.db.query("INSERT INTO tasks (title, kind, status, assignee_id, created_by, episode_id, project_id) VALUES ('Gravar', 'geral', 'a_fazer', $1, $1, $2, 2)", [sara.id, ep.cem.id]);
    const tarefas = (await c.get('/tarefas?escopo=todas')).text;
    assert.match(tarefas, /V\.001/);
    // busca global
    const busca = JSON.parse((await c.get('/busca?q=Vídeo do Cem')).text);
    assert.ok(JSON.stringify(busca).includes('V.001'), 'a busca mostra o prefixo do projeto');
  });

  it('o número sugerido no formulário é o próximo do projeto escolhido', async () => {
    await c.act('/projeto', { project: '2', voltar: '/' });
    const form = (await c.get('/episodios/novo')).text;
    assert.match(form, /name="number"[^>]*value="4"/);
    assert.match(form, /Número \(V\.\)/, 'o rótulo mostra o prefixo do projeto');
    await c.act('/projeto', { project: '1', voltar: '/' });
    assert.match((await c.get('/episodios/novo')).text, /name="number"[^>]*value="32"/);
    await c.act('/projeto', { project: '', voltar: '/' });
    assert.match((await c.get('/episodios/novo')).text, /name="number"[^>]*value=""/, 'em Todos os projetos, o sistema numera ao salvar');
  });

  it('dois vídeos criados ao mesmo tempo no mesmo projeto recebem números diferentes', async () => {
    const feitos = await Promise.all([1, 2, 3].map((n) => production.createEpisode({ title: `Corrida ${n}`, userId: sara.id, projectId: 2 })));
    const numeros = feitos.map((e) => e.number).sort((a, b) => a - b);
    assert.equal(new Set(numeros).size, 3, `números repetidos: ${numeros}`);
  });
});
