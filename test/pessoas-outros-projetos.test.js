// "Em outros projetos" e "Convidar também": a mesma pessoa entra no outro projeto em um clique, sem digitar de novo.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const people = require('../src/services/people');

const novoConvidado = async (nome, projectId = 1, extra = {}) => {
  const cols = { name: nome, instagram: extra.instagram || null, phone: extra.phone || null, status: extra.status || 'prospect', project_id: projectId };
  const keys = Object.keys(cols);
  const { rows: [g] } = await h.db.query(
    `INSERT INTO guests (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, keys.map((k) => cols[k]));
  await people.sync(g.id);
  return g.id;
};

describe('pessoas: em outros projetos', () => {
  let srv; let dois; let soPulso;
  before(async () => {
    await h.resetDb();
    await h.createUser({ name: 'Gestora dos dois', email: 'dois@local.test', role: 'gestao', projects: [1, 2] });
    await h.createUser({ name: 'Gestor do Pulso', email: 'pulso@local.test', role: 'gestao', projects: [1] });
    srv = await h.startServer();
    dois = h.client(srv.base); await dois.login('dois@local.test');
    soPulso = h.client(srv.base); await soPulso.login('pulso@local.test');
  });
  after(async () => { await srv.close(); await h.db.close(); });

  it('convidar também cria a participação no outro projeto, com os dados da pessoa', async () => {
    const id = await novoConvidado('Dr. Márcio Martins', 1, { instagram: 'drmarcio', phone: '48999720273', status: 'gravado' });
    const r = await dois.act(`/convidados/${id}/tambem`, { project_id: '2' }, { from: `/convidados/${id}` });
    assert.ok([302, 303].includes(r.status), `esperava redirecionar, veio ${r.status}: ${r.text.slice(0, 200)}`);
    const novoId = Number(String(r.location).match(/\/convidados\/(\d+)/)[1]);
    const { rows: [novo] } = await h.db.query('SELECT name, instagram, phone, status, project_id, person_id FROM guests WHERE id = $1', [novoId]);
    const { rows: [velho] } = await h.db.query('SELECT person_id FROM guests WHERE id = $1', [id]);
    assert.deepEqual([novo.name, novo.instagram, novo.phone, novo.status, novo.project_id], ['Dr. Márcio Martins', 'drmarcio', '48999720273', 'prospect', 2]);
    assert.equal(novo.person_id, velho.person_id, 'é a mesma pessoa');
    // o histórico dos dois conta o que aconteceu
    const { rows: ev } = await h.db.query('SELECT guest_id, message FROM guest_events WHERE guest_id = ANY($1::int[])', [[id, novoId]]);
    assert.ok(ev.some((e) => e.guest_id === novoId && /Projeto 100|Pulso/.test(e.message)), 'o novo deveria contar de onde veio');
    assert.ok(ev.some((e) => e.guest_id === id && /Projeto 100/.test(e.message)), 'o cadastro de origem deveria registrar');
  });

  it('a página mostra o bloco com o projeto e a etapa da outra participação', async () => {
    const { rows: [par] } = await h.db.query(
      "SELECT min(id) AS a, max(id) AS b FROM guests WHERE name = 'Dr. Márcio Martins'");
    const r = await dois.get(`/convidados/${par.a}`);
    assert.match(r.text, /Em outros projetos/);
    assert.match(r.text, /Projeto 100/);
    assert.match(r.text, new RegExp(`/convidados/${par.b}`));
  });

  it('quem só tem um projeto não vê o bloco nem o botão', async () => {
    const { rows: [g] } = await h.db.query("SELECT min(id) AS id FROM guests WHERE name = 'Dr. Márcio Martins'");
    const r = await soPulso.get(`/convidados/${g.id}`);
    assert.doesNotMatch(r.text, /Em outros projetos/);
    assert.doesNotMatch(r.text, /Convidar também/);
  });

  it('não repete: pessoa que já participa do projeto não ganha outra participação', async () => {
    const { rows: [g] } = await h.db.query("SELECT min(id) AS id FROM guests WHERE name = 'Dr. Márcio Martins'");
    const antes = (await h.db.query('SELECT count(*)::int AS n FROM guests')).rows[0].n;
    await dois.act(`/convidados/${g.id}/tambem`, { project_id: '2' }, { from: `/convidados/${g.id}` });
    assert.equal((await h.db.query('SELECT count(*)::int AS n FROM guests')).rows[0].n, antes);
    const r = await dois.get(`/convidados/${g.id}`);
    assert.doesNotMatch(r.text, /Convidar também/); // já está lá: o botão sai
  });

  it('projeto fora do recorte de quem pede: 404', async () => {
    const id = await novoConvidado('Dra. Só Pulso', 1);
    const r = await soPulso.act(`/convidados/${id}/tambem`, { project_id: '2' }, { from: `/convidados/${id}` });
    assert.equal(r.status, 404);
    assert.equal((await h.db.query('SELECT count(*)::int AS n FROM guests WHERE project_id = 2')).rows[0].n, 1);
  });

  it('projeto que não usa Convidados não recebe participação', async () => {
    await h.db.query(`UPDATE projects SET modules = modules - 'convidados' WHERE id = 2`);
    await require('../src/services/projects').refresh(true);
    const id = await novoConvidado('Dr. Sem Módulo', 1);
    const r = await dois.act(`/convidados/${id}/tambem`, { project_id: '2' }, { from: `/convidados/${id}` });
    assert.ok([302, 303, 400, 404].includes(r.status));
    assert.equal((await h.db.query("SELECT count(*)::int AS n FROM guests WHERE name = 'Dr. Sem Módulo'")).rows[0].n, 1);
    await h.db.query(`UPDATE projects SET modules = modules || '{"convidados": true}'::jsonb WHERE id = 2`);
    await require('../src/services/projects').refresh(true);
  });

  it('participação na lixeira não aparece em "Em outros projetos"', async () => {
    const id = await novoConvidado('Dra. Lixeira', 1);
    const r = await dois.act(`/convidados/${id}/tambem`, { project_id: '2' }, { from: `/convidados/${id}` });
    const novoId = Number(String(r.location).match(/\/convidados\/(\d+)/)[1]);
    await dois.act(`/convidados/${novoId}/excluir`, {}, { from: `/convidados/${novoId}` });
    const page = await dois.get(`/convidados/${id}`);
    assert.doesNotMatch(page.text, new RegExp(`/convidados/${novoId}"`));
    assert.match(page.text, /Convidar também/); // vaga aberta de novo
  });
});
