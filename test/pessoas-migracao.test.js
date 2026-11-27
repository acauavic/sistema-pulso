// Migração da pessoa: cada convidado de hoje ganha uma pessoa com os mesmos dados e o mesmo id, e nada se perde.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { migrate } = require('../src/db/migrate');

describe('pessoas: migração', () => {
  before(async () => {
    await h.db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate({ until: '097' });
    await h.db.query(
      `INSERT INTO guests (name, email, phone, instagram, company, job_title, bio, gender, is_plural, reach, status, topic)
       VALUES ('Dr. Márcio Martins', 'marcio@exemplo.com', '48999720273', 'drmarcio', 'Clínica Martins', 'Cardiologista',
               'Bio do Márcio', 'm', false, 120000, 'gravado', 'Longevidade'),
              ('Dupla Saúde', NULL, NULL, NULL, NULL, NULL, NULL, 'f', true, NULL, 'prospect', NULL)`);
  });
  after(async () => { await h.db.close(); });

  it('uma pessoa por convidado, com o mesmo id e os mesmos dados', async () => {
    assert.ok((await migrate()).includes('098_pessoas.sql'));
    const { rows: [n] } = await h.db.query('SELECT (SELECT count(*) FROM people)::int AS pessoas, (SELECT count(*) FROM guests)::int AS convidados');
    assert.equal(n.pessoas, n.convidados);
    const { rows } = await h.db.query(
      `SELECT g.id, g.person_id, p.name, p.email, p.phone, p.instagram, p.company, p.job_title, p.bio, p.gender, p.is_plural, p.reach
         FROM guests g JOIN people p ON p.id = g.person_id ORDER BY g.id`);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.person_id === r.id)); // mesmo id: o espelho se confere a olho
    assert.deepEqual(
      [rows[0].name, rows[0].email, rows[0].phone, rows[0].instagram, rows[0].company, rows[0].job_title, rows[0].bio, rows[0].gender, rows[0].is_plural, rows[0].reach],
      ['Dr. Márcio Martins', 'marcio@exemplo.com', '48999720273', 'drmarcio', 'Clínica Martins', 'Cardiologista', 'Bio do Márcio', 'm', false, '120000']);
    assert.deepEqual([rows[1].name, rows[1].email, rows[1].gender, rows[1].is_plural], ['Dupla Saúde', null, 'f', true]);
  });

  it('participação sem pessoa é aceita (o serviço liga depois), e a pessoa nova continua a sequência', async () => {
    const { rows: [solta] } = await h.db.query("INSERT INTO guests (name, project_id) VALUES ('Sem pessoa', 1) RETURNING person_id");
    assert.equal(solta.person_id, null);
    const { rows: [p] } = await h.db.query("INSERT INTO people (name) VALUES ('Pessoa nova') RETURNING id");
    assert.ok(p.id > 2, `a sequência de people deveria continuar depois dos migrados (veio ${p.id})`);
    await h.db.query("INSERT INTO guests (name, project_id, person_id) VALUES ('Pessoa nova', 2, $1)", [p.id]);
  });

  it('apagar a participação não apaga a pessoa (a lixeira devolve a ligação)', async () => {
    const { rows: [g] } = await h.db.query("SELECT id, person_id FROM guests WHERE name = 'Dupla Saúde'");
    await h.db.query('DELETE FROM guests WHERE id = $1', [g.id]);
    assert.equal((await h.db.query('SELECT count(*)::int AS n FROM people WHERE id = $1', [g.person_id])).rows[0].n, 1);
  });
});
