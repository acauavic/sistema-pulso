// Estoque por projeto: cada item é de um projeto ou compartilhado. Com um projeto escolhido, aparecem só os itens dele e os
// compartilhados; o vídeo gravado só desconta o que é do projeto dele; item de outro projeto responde 404; a compra já vem com
// o projeto do item em "De quem é".
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const fin = require('../src/services/finance');

const PULSO = 1; const P100 = 2;

describe('estoque por projeto', () => {
  const as = {}; let app; let caneca; let cafe; let garrafa;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const one = (sql, p) => q(sql, p).then((r) => r[0]);
  const qtyOf = async (id) => Number((await one('SELECT coalesce(sum(qty),0)::float AS n FROM fin_stock_moves WHERE item_id = $1', [id])).n);

  before(async () => {
    await h.resetDb();
    await h.createUser({ name: 'Casa', email: 'casa@local.test', role: 'gestao', projects: [PULSO, P100] });
    await h.createUser({ name: 'Cem', email: 'cem@local.test', role: 'gestao', projects: [P100] });
    app = await h.startServer();
    for (const k of ['casa', 'cem']) { as[k] = h.client(app.base); await as[k].login(`${k}@local.test`); }
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('item novo: em "Todos" escolhe o projeto ou compartilhado; com um projeto escolhido, nasce nele', async () => {
    let page = (await as.casa.get('/financeiro/estoque')).text;
    assert.match(page, /name="project_id" value="compartilhado"/, 'em Todos: a opção Compartilhado');
    await as.casa.act('/financeiro/estoque', { name: 'Caneca do Pulso', qty: '10', per_episode: '1', project_id: String(PULSO) }, { from: '/financeiro/estoque' });
    await as.casa.act('/financeiro/estoque', { name: 'Café do estúdio', qty: '20', per_episode: '1', project_id: 'compartilhado' }, { from: '/financeiro/estoque' });
    await as.casa.act('/projeto', { project: String(P100), voltar: '/financeiro/estoque' });
    page = (await as.casa.get('/financeiro/estoque')).text;
    assert.doesNotMatch(page, /name="project_id" value="compartilhado"[^>]*required/, 'com um projeto escolhido não pede o projeto');
    await as.casa.act('/financeiro/estoque', { name: 'Garrafa do 100', qty: '5', per_episode: '1' }, { from: '/financeiro/estoque' });
    await as.casa.act('/projeto', { project: '', voltar: '/financeiro/estoque' });
    caneca = await one("SELECT * FROM fin_stock_items WHERE name = 'Caneca do Pulso'");
    cafe = await one("SELECT * FROM fin_stock_items WHERE name = 'Café do estúdio'");
    garrafa = await one("SELECT * FROM fin_stock_items WHERE name = 'Garrafa do 100'");
    assert.equal(Number(caneca.project_id), PULSO); assert.equal(cafe.project_id, null); assert.equal(Number(garrafa.project_id), P100);
  });

  it('com o Projeto 100 escolhido (ou para quem só é dele), a lista mostra o dele e o compartilhado, nunca o do Pulso', async () => {
    const cem = (await as.cem.get('/financeiro/estoque')).text;
    assert.match(cem, /Garrafa do 100/); assert.match(cem, /Café do estúdio/); assert.doesNotMatch(cem, /Caneca do Pulso/);
    await as.casa.act('/projeto', { project: String(P100), voltar: '/financeiro/estoque' });
    const casa100 = (await as.casa.get('/financeiro/estoque')).text;
    assert.doesNotMatch(casa100, /Caneca do Pulso/); assert.match(casa100, /Garrafa do 100/);
    await as.casa.act('/projeto', { project: '', voltar: '/financeiro/estoque' });
    const todos = (await as.casa.get('/financeiro/estoque')).text;
    assert.match(todos, /Caneca do Pulso/); assert.match(todos, /Garrafa do 100/); assert.match(todos, /compartilhado/);
  });

  it('item de outro projeto não existe para quem não é dele (editar, comprar, acertar)', async () => {
    for (const url of [`/financeiro/estoque/${caneca.id}`, `/financeiro/estoque/${caneca.id}/ajustar`, `/financeiro/estoque/${caneca.id}/comprar`]) {
      const r = await as.cem.act(url, { name: 'Mudou', per_episode: '0', acao: 'perda', qty: '1', total: '10,00', due_on: '2026-12-01' }, { from: '/financeiro/estoque' });
      assert.equal(r.status, 404, url);
    }
    assert.equal((await one('SELECT name FROM fin_stock_items WHERE id = $1', [caneca.id])).name, 'Caneca do Pulso');
    assert.equal(await qtyOf(caneca.id), 10);
  });

  it('o vídeo gravado só desconta o que é do projeto dele (e o compartilhado)', async () => {
    const epCem = await one("INSERT INTO episodes (title, project_id, number, status, recorded_on) VALUES ('Vídeo do Cem',$1,1,'gravado','2026-11-11') RETURNING id", [P100]);
    await fin.onEpisodeCreated(epCem.id);
    assert.equal(await qtyOf(caneca.id), 10, 'a caneca do Pulso não sai num vídeo do Projeto 100');
    assert.equal(await qtyOf(garrafa.id), 4); assert.equal(await qtyOf(cafe.id), 19);
    const epPulso = await one("INSERT INTO episodes (title, project_id, number, status, recorded_on) VALUES ('Ep do Pulso',$1,1,'gravado','2026-11-12') RETURNING id", [PULSO]);
    await fin.onEpisodeCreated(epPulso.id);
    assert.equal(await qtyOf(caneca.id), 9); assert.equal(await qtyOf(garrafa.id), 4); assert.equal(await qtyOf(cafe.id), 18);
  });

  it('editar o item troca o dono; a compra já vem com o projeto do item em "De quem é"', async () => {
    let page = (await as.casa.get('/financeiro/estoque')).text;
    assert.match(page, /&quot;de_quem&quot;:&quot;1&quot;/, 'a compra da caneca já vem marcada no Pulso');
    assert.match(page, /&quot;de_quem&quot;:&quot;compartilhado&quot;/, 'a do café, compartilhada');
    await as.casa.act(`/financeiro/estoque/${cafe.id}`, { name: 'Café do estúdio', per_episode: '1', unit: 'un', lead_days: '15', min_qty: '0', project_id: String(P100) }, { from: '/financeiro/estoque' });
    assert.equal(Number((await one('SELECT project_id FROM fin_stock_items WHERE id = $1', [cafe.id])).project_id), P100);
    // quem só é do Projeto 100 não consegue passar um item para o Pulso
    await as.cem.act(`/financeiro/estoque/${garrafa.id}`, { name: 'Garrafa do 100', per_episode: '1', unit: 'un', lead_days: '15', min_qty: '0', project_id: String(PULSO) }, { from: '/financeiro/estoque' });
    assert.equal(Number((await one('SELECT project_id FROM fin_stock_items WHERE id = $1', [garrafa.id])).project_id), P100);
    page = (await as.cem.get('/financeiro/estoque')).text;
    assert.doesNotMatch(page, /name="project_id"/, 'com um projeto só, a pessoa não escolhe o dono');
  });
});
