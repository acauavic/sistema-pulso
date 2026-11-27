// Migração da empresa: cada patrocinador de hoje ganha uma empresa com os mesmos dados e o mesmo id.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { migrate } = require('../src/db/migrate');

describe('empresas: migração', () => {
  before(async () => {
    await h.db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate({ until: '098' });
    await h.db.query(
      `INSERT INTO sponsors (company, website, kind, contact_name, contact_email, contact_phone, stage)
       VALUES ('Clínica Vida', 'https://clinicavida.com.br', 'negocio', 'Rita Souza', 'rita@clinicavida.com.br', '48988887777', 'ativo'),
              ('Sem contato', NULL, 'negocio', NULL, NULL, NULL, 'prospect')`);
  });
  after(async () => { await h.db.close(); });

  it('uma empresa por contrato, com o mesmo id e os mesmos dados', async () => {
    assert.ok((await migrate()).includes('099_empresas.sql'));
    const { rows: [n] } = await h.db.query('SELECT (SELECT count(*) FROM companies)::int AS empresas, (SELECT count(*) FROM sponsors)::int AS contratos');
    assert.equal(n.empresas, n.contratos);
    const { rows } = await h.db.query(
      `SELECT s.id, s.company_id, c.name, c.website, c.kind, c.contact_name, c.contact_email, c.contact_phone
         FROM sponsors s JOIN companies c ON c.id = s.company_id ORDER BY s.id`);
    assert.ok(rows.every((r) => r.company_id === r.id));
    assert.deepEqual(
      [rows[0].name, rows[0].website, rows[0].kind, rows[0].contact_name, rows[0].contact_email, rows[0].contact_phone],
      ['Clínica Vida', 'https://clinicavida.com.br', 'negocio', 'Rita Souza', 'rita@clinicavida.com.br', '48988887777']);
    assert.deepEqual([rows[1].name, rows[1].contact_email], ['Sem contato', null]);
  });

  it('contrato sem empresa é aceito (o serviço liga depois) e apagar o contrato não apaga a empresa', async () => {
    const { rows: [solto] } = await h.db.query("INSERT INTO sponsors (company, kind, stage, project_id) VALUES ('Solta', 'negocio', 'prospect', 1) RETURNING id, company_id");
    assert.equal(solto.company_id, null);
    const { rows: [s] } = await h.db.query("SELECT id, company_id FROM sponsors WHERE company = 'Sem contato'");
    await h.db.query('DELETE FROM sponsors WHERE id = $1', [s.id]);
    assert.equal((await h.db.query('SELECT count(*)::int AS n FROM companies WHERE id = $1', [s.company_id])).rows[0].n, 1);
  });
});
