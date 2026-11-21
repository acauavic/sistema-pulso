// O espelho da empresa: a identidade é uma só, em qualquer contrato. Mexer num lado mexe no outro, inclusive para esvaziar.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const companies = require('../src/services/companies');

describe('empresas: espelho', () => {
  before(async () => { await h.resetDb(); });
  after(async () => { await h.db.close(); });

  let a; let b;
  beforeEach(async () => {
    await h.db.query('DELETE FROM sponsors');
    await h.db.query('DELETE FROM companies');
    const { rows: [s] } = await h.db.query(
      `INSERT INTO sponsors (company, website, kind, contact_name, contact_email, stage, project_id)
       VALUES ('Clínica Vida', 'https://clinicavida.com.br', 'negocio', 'Rita Souza', 'rita@clinicavida.com.br', 'ativo', 1) RETURNING id`);
    a = s.id;
    const { companyId } = await companies.sync(a);
    const { rows: [s2] } = await h.db.query(
      "INSERT INTO sponsors (company, kind, stage, project_id, company_id) VALUES ('Clínica Vida', 'negocio', 'prospect', 2, $1) RETURNING id", [companyId]);
    b = s2.id;
  });

  it('o contrato sem empresa ganha uma, com os dados dele', async () => {
    const { rows: [s] } = await h.db.query("INSERT INTO sponsors (company, website, kind, stage, project_id) VALUES ('Nova Marca', 'https://nova.com', 'negocio', 'prospect', 2) RETURNING id");
    const { companyId } = await companies.sync(s.id);
    const e = await companies.get(companyId);
    assert.deepEqual([e.name, e.website], ['Nova Marca', 'https://nova.com']);
  });

  it('editar o contrato leva para a empresa e para o outro contrato', async () => {
    await h.db.query("UPDATE sponsors SET contact_phone = '48912345678', website = 'https://vida.com.br' WHERE id = $1", [a]);
    await companies.sync(a);
    const { rows: [e] } = await h.db.query('SELECT contact_phone, website FROM companies');
    assert.deepEqual([e.contact_phone, e.website], ['48912345678', 'https://vida.com.br']);
    const { rows: [outro] } = await h.db.query('SELECT contact_phone, website FROM sponsors WHERE id = $1', [b]);
    assert.deepEqual([outro.contact_phone, outro.website], ['48912345678', 'https://vida.com.br']);
  });

  it('editar a empresa leva para todos os contratos, e esvaziar esvazia', async () => {
    const { companyId } = await companies.sync(a);
    await companies.save(companyId, { company: 'Clínica Vida Saúde', contact_email: '' });
    const { rows } = await h.db.query('SELECT company, contact_email, stage FROM sponsors ORDER BY id');
    assert.deepEqual(rows.map((r) => r.company), ['Clínica Vida Saúde', 'Clínica Vida Saúde']);
    assert.deepEqual(rows.map((r) => r.contact_email), [null, null]);
    assert.deepEqual(rows.map((r) => r.stage), ['ativo', 'prospect']); // a etapa é do contrato
  });

  it('participations: os outros contratos da empresa, só nos projetos de quem olha', async () => {
    const { companyId } = await companies.sync(a);
    const lista = await companies.participations(companyId, { pids: [1, 2], exceptSponsorId: a });
    assert.equal(lista.length, 1);
    assert.deepEqual([lista[0].sponsor_id, lista[0].project_id, lista[0].project_name], [b, 2, 'Projeto 100']);
    assert.equal(lista[0].stage_label, 'Prospecção');
    assert.deepEqual(await companies.participations(companyId, { pids: [1], exceptSponsorId: a }), []);
  });

  it('join: une duas empresas de projetos diferentes e mantém os dois contratos', async () => {
    const { rows: [outra] } = await h.db.query("INSERT INTO sponsors (company, kind, stage, project_id) VALUES ('Clinica Vida', 'negocio', 'prospect', 2) RETURNING id");
    await companies.sync(outra.id);
    const r = await companies.join(a, outra.id, { company: String(a) }, { id: null, name: 'Teste' });
    assert.ok(!r.error, r.error);
    const { rows } = await h.db.query('SELECT id, company, company_id FROM sponsors WHERE id = ANY($1::int[]) ORDER BY id', [[a, outra.id]]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].company_id, rows[1].company_id);
    assert.deepEqual(rows.map((x) => x.company), ['Clínica Vida', 'Clínica Vida']);
  });
});
