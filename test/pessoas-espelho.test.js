// O espelho da pessoa: a identidade é uma só, em qualquer participação. Mexer num lado mexe no outro, inclusive para esvaziar.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const people = require('../src/services/people');

const IDENT = 'name, email, phone, instagram, company, job_title, bio, gender, is_plural, photo_key, reach';

describe('pessoas: espelho', () => {
  before(async () => { await h.resetDb(); });
  after(async () => { await h.db.close(); });

  let a; let b; // duas participações da mesma pessoa, em projetos diferentes
  beforeEach(async () => {
    await h.db.query('DELETE FROM guests');
    await h.db.query('DELETE FROM people');
    const { rows: [g] } = await h.db.query(
      `INSERT INTO guests (name, email, phone, instagram, project_id, status) VALUES ('Dr. Márcio', 'marcio@exemplo.com', '48999720273', 'drmarcio', 1, 'gravado') RETURNING id`);
    a = g.id;
    const { personId } = await people.sync(a);
    const { rows: [g2] } = await h.db.query(
      'INSERT INTO guests (name, project_id, status, person_id) VALUES ($1, 2, $2, $3) RETURNING id', ['Dr. Márcio', 'prospect', personId]);
    b = g2.id;
  });

  it('a participação sem pessoa ganha uma, com os dados dela', async () => {
    const { rows: [g] } = await h.db.query("INSERT INTO guests (name, instagram, project_id) VALUES ('Dra. Solta', 'drasolta', 2) RETURNING id");
    const { personId } = await people.sync(g.id);
    assert.ok(personId);
    const p = await people.get(personId);
    assert.deepEqual([p.name, p.instagram], ['Dra. Solta', 'drasolta']);
    assert.equal((await h.db.query('SELECT person_id FROM guests WHERE id = $1', [g.id])).rows[0].person_id, personId);
  });

  it('editar a participação leva para a pessoa e para a irmã', async () => {
    await h.db.query("UPDATE guests SET phone = '48988887777', company = 'Clínica Martins' WHERE id = $1", [a]);
    await people.sync(a);
    const { rows } = await h.db.query(`SELECT ${IDENT} FROM people`);
    assert.deepEqual([rows[0].phone, rows[0].company], ['48988887777', 'Clínica Martins']);
    const { rows: [irma] } = await h.db.query('SELECT phone, company FROM guests WHERE id = $1', [b]);
    assert.deepEqual([irma.phone, irma.company], ['48988887777', 'Clínica Martins']);
  });

  it('editar a pessoa leva para todas as participações', async () => {
    const { personId } = await people.sync(a);
    await people.save(personId, { name: 'Dr. Márcio Martins', job_title: 'Cardiologista' });
    const { rows } = await h.db.query('SELECT id, name, job_title FROM guests ORDER BY id');
    assert.deepEqual(rows.map((r) => r.name), ['Dr. Márcio Martins', 'Dr. Márcio Martins']);
    assert.deepEqual(rows.map((r) => r.job_title), ['Cardiologista', 'Cardiologista']);
  });

  it('esvaziar um campo esvazia nas duas (identidade é cópia, não "preenche o que falta")', async () => {
    const { personId } = await people.sync(a);
    await people.save(personId, { email: '', phone: null });
    const { rows } = await h.db.query('SELECT email, phone FROM guests ORDER BY id');
    assert.deepEqual(rows, [{ email: null, phone: null }, { email: null, phone: null }]);
    assert.deepEqual((await h.db.query('SELECT email, phone FROM people')).rows, [{ email: null, phone: null }]);
  });

  it('save só mexe no que foi mandado, e nunca no funil', async () => {
    const { personId } = await people.sync(a);
    await people.save(personId, { phone: '4830000000' });
    const { rows: [g] } = await h.db.query('SELECT name, phone, status, topic FROM guests WHERE id = $1', [a]);
    assert.deepEqual([g.name, g.phone, g.status], ['Dr. Márcio', '4830000000', 'gravado']);
    const { rows: [outra] } = await h.db.query('SELECT status FROM guests WHERE id = $1', [b]);
    assert.equal(outra.status, 'prospect'); // a etapa é da participação
  });

  it('participations: as outras participações da pessoa, só nos projetos de quem olha', async () => {
    const { personId } = await people.sync(a);
    const lista = await people.participations(personId, { pids: [1, 2], exceptGuestId: a });
    assert.equal(lista.length, 1);
    assert.deepEqual([lista[0].guest_id, lista[0].project_id, lista[0].project_name, lista[0].status], [b, 2, 'Projeto 100', 'prospect']);
    assert.equal(lista[0].stage_label, 'Prospecção');
    assert.deepEqual(await people.participations(personId, { pids: [1], exceptGuestId: a }), []);
  });

  it('link: as participações da pessoa que sai passam para a que fica', async () => {
    const { personId: pa } = await people.sync(a);
    const { rows: [outra] } = await h.db.query("INSERT INTO guests (name, project_id) VALUES ('Marcio Martins', 2) RETURNING id");
    const { personId: pb } = await people.sync(outra.id);
    await people.link(pa, pb);
    assert.equal((await h.db.query('SELECT count(*)::int AS n FROM guests WHERE person_id = $1', [pa])).rows[0].n, 3);
    assert.equal((await h.db.query('SELECT count(*)::int AS n FROM people WHERE id = $1', [pb])).rows[0].n, 0);
    const { rows: [movida] } = await h.db.query('SELECT name FROM guests WHERE id = $1', [outra.id]);
    assert.equal(movida.name, 'Dr. Márcio'); // quem chega passa a usar a identidade da pessoa que ficou
  });
});
