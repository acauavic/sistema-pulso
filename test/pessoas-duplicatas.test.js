// Duplicata com projetos: a mesma pessoa em dois projetos não é duplicata; duas pessoas parecidas em projetos
// diferentes se resolvem unindo as pessoas (as duas participações ficam); no mesmo projeto, continua indo uma para a lixeira.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const people = require('../src/services/people');
const dup = require('../src/services/duplicates');

const criar = async (nome, projectId, extra = {}) => {
  const { rows: [g] } = await h.db.query(
    'INSERT INTO guests (name, instagram, email, phone, project_id, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [nome, extra.instagram || null, extra.email || null, extra.phone || null, projectId, extra.status || 'prospect']);
  await people.sync(g.id);
  return g.id;
};

describe('pessoas: duplicatas', () => {
  let srv; let dois;
  before(async () => {
    await h.resetDb();
    await h.createUser({ name: 'Gestora dos dois', email: 'dois@local.test', role: 'gestao', projects: [1, 2] });
    srv = await h.startServer();
    dois = h.client(srv.base); await dois.login('dois@local.test');
  });
  after(async () => { await srv.close(); await h.db.close(); });

  it('a mesma pessoa em dois projetos não é duplicata', async () => {
    const a = await criar('Dr. Márcio Martins', 1, { instagram: 'drmarcio', email: 'marcio@exemplo.com' });
    const r = await dois.act(`/convidados/${a}/tambem`, { project_id: '2' }, { from: `/convidados/${a}` });
    const b = Number(String(r.location).match(/\/convidados\/(\d+)/)[1]);
    const { rows: [ga] } = await h.db.query('SELECT * FROM guests WHERE id = $1', [a]);
    assert.deepEqual(await dup.findFor('guest', ga, { excludeId: a }), []);
    const { pairs } = await dup.pairs('guest');
    assert.deepEqual(pairs.filter((p) => [p.a.id, p.b.id].includes(b)), []);
    const page = await dois.get(`/convidados/${a}`);
    assert.doesNotMatch(page.text, /Possível duplicata|>Duplicata</);
  });

  it('pessoas parecidas em projetos diferentes: a ação é unir, e as duas participações ficam', async () => {
    const a = await criar('Dra. Ana Prado', 1, { instagram: 'dra.anaprado', email: 'ana@exemplo.com', status: 'gravado' });
    const b = await criar('Ana Prado', 2, { instagram: 'dra.anaprado' }); // mesmo @: duplicata certa
    const achados = await dup.findFor('guest', (await h.db.query('SELECT * FROM guests WHERE id = $1', [a])).rows[0], { excludeId: a });
    assert.equal(achados.length, 1);
    assert.equal(achados[0].id, b);
    assert.equal(achados[0].cross, true, 'candidato de outro projeto é marcado como "outro projeto"');

    const cmp = await dois.get(`/duplicatas/convidados/${a}/${b}`);
    assert.match(cmp.text, /É a mesma pessoa/);
    assert.match(cmp.text, /Nada vai para a lixeira/);
    assert.doesNotMatch(cmp.text, /O cadastro que sai vai para a lixeira/);

    const r = await dois.act(`/duplicatas/convidados/${a}/${b}/mesma-pessoa`, { manter: String(a), campo_name: String(a) }, { from: `/duplicatas/convidados/${a}/${b}` });
    assert.ok([302, 303].includes(r.status), `esperava redirecionar, veio ${r.status}`);
    const { rows } = await h.db.query('SELECT id, name, email, person_id, project_id FROM guests WHERE id = ANY($1::int[]) ORDER BY id', [[a, b]]);
    assert.equal(rows.length, 2, 'ninguém vai para a lixeira ao unir entre projetos');
    assert.equal(rows[0].person_id, rows[1].person_id, 'uma pessoa só');
    assert.deepEqual(rows.map((x) => x.name), ['Dra. Ana Prado', 'Dra. Ana Prado']);
    assert.deepEqual(rows.map((x) => x.email), ['ana@exemplo.com', 'ana@exemplo.com']);
    assert.equal((await h.db.query('SELECT count(*)::int AS n FROM trash_items')).rows[0].n, 0);
  });

  it('no mesmo projeto, juntar continua mandando um para a lixeira', async () => {
    const a = await criar('Dr. João Silva', 1, { instagram: 'drjoaosilva', status: 'gravado' });
    const b = await criar('Joao Silva', 1, { instagram: 'drjoaosilva' });
    const cmp = await dois.get(`/duplicatas/convidados/${a}/${b}`);
    assert.match(cmp.text, /Juntar os dois cadastros/);
    const r = await dois.act(`/duplicatas/convidados/${a}/${b}/juntar`, { manter: String(a) }, { from: `/duplicatas/convidados/${a}/${b}` });
    assert.ok([302, 303].includes(r.status));
    assert.equal((await h.db.query('SELECT count(*)::int AS n FROM guests WHERE id = $1', [b])).rows[0].n, 0);
  });

  it('o par dispensado continua dispensado', async () => {
    const a = await criar('Dra. Bia Costa', 1, { phone: '48900001111' });
    const b = await criar('Bia Costa', 2, { phone: '48900001111' });
    await dup.dismiss('guest', a, b, null);
    const achados = await dup.findFor('guest', (await h.db.query('SELECT * FROM guests WHERE id = $1', [a])).rows[0], { excludeId: a });
    assert.deepEqual(achados, []);
  });

  it('um par por pessoa na lista da gestão, mesmo com várias participações', async () => {
    const a = await criar('Dr. Caio Lima', 1, { instagram: 'drcaiolima' });
    await dois.act(`/convidados/${a}/tambem`, { project_id: '2' }, { from: `/convidados/${a}` });
    const b = await criar('Caio Lima', 1, { instagram: 'drcaiolima' }); // outra pessoa, parecida com as duas participações
    const { pairs } = await dup.pairs('guest');
    const comCaio = pairs.filter((p) => /Caio/.test(p.a.name) && /Caio/.test(p.b.name));
    assert.equal(comCaio.length, 1, `esperava um par só, veio ${comCaio.length}`);
    assert.ok([comCaio[0].a.id, comCaio[0].b.id].includes(b));
  });
});
