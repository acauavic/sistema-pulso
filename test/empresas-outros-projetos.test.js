// Patrocinador: todo caminho que escreve identidade espelha na empresa, e "Abrir negociação também no…" cria o
// contrato no outro projeto com os dados da empresa.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const companies = require('../src/services/companies');

const COLS = ['company', 'website', 'kind', 'contact_name', 'contact_email', 'contact_phone'];
const PAR = { company: 'name', website: 'website', kind: 'kind', contact_name: 'contact_name', contact_email: 'contact_email', contact_phone: 'contact_phone' };

async function espelhado(sponsorId, msg) {
  const { rows: [r] } = await h.db.query(
    `SELECT s.company_id, ${COLS.map((c) => `s.${c} AS s_${c}, e.${PAR[c]} AS e_${c}`).join(', ')}
       FROM sponsors s LEFT JOIN companies e ON e.id = s.company_id WHERE s.id = $1`, [sponsorId]);
  assert.ok(r, `contrato ${sponsorId} não existe (${msg})`);
  assert.ok(r.company_id, `contrato sem empresa: ${msg}`);
  for (const c of COLS) assert.deepEqual(r[`e_${c}`], r[`s_${c}`], `${c} não espelhou: ${msg}`);
  return r;
}

describe('empresas: escritores e outros projetos', () => {
  let srv; let dois; let soPulso;
  before(async () => {
    await h.resetDb();
    await h.db.query(`UPDATE projects SET modules = modules || '{"patrocinio": true}'::jsonb WHERE id = 2`);
    await require('../src/services/projects').refresh(true);
    await h.createUser({ name: 'Gestora dos dois', email: 'dois@local.test', role: 'gestao', projects: [1, 2] });
    await h.createUser({ name: 'Gestor do Pulso', email: 'pulso@local.test', role: 'gestao', projects: [1] });
    srv = await h.startServer();
    dois = h.client(srv.base); await dois.login('dois@local.test');
    soPulso = h.client(srv.base); await soPulso.login('pulso@local.test');
  });
  after(async () => { await srv.close(); await h.db.close(); });

  it('formulário: cadastrar e editar', async () => {
    const r = await dois.act('/patrocinadores', {
      company: 'Clínica Vida', kind: 'negocio', stage: 'prospect', website: 'https://clinicavida.com.br',
      contact_name: 'Rita Souza', contact_email: 'rita@clinicavida.com.br', project_id: '1', confirmar_duplicata: '1',
    }, { from: '/patrocinadores/novo' });
    const id = Number(String(r.location || '').match(/\/patrocinadores\/(\d+)/)[1]);
    await espelhado(id, 'cadastro novo');
    await dois.act(`/patrocinadores/${id}`, {
      company: 'Clínica Vida Saúde', kind: 'negocio', stage: 'prospect', website: 'https://clinicavida.com.br',
      contact_name: 'Rita Souza', contact_email: '', contact_phone: '48988887777',
    }, { from: `/patrocinadores/${id}/editar` });
    const e = await espelhado(id, 'edição');
    assert.deepEqual([e.e_company, e.e_contact_email, e.e_contact_phone], ['Clínica Vida Saúde', null, '48988887777']);
  });

  it('janela do próximo passo (contato) espelha', async () => {
    const { rows: [s] } = await h.db.query("INSERT INTO sponsors (company, kind, stage, project_id) VALUES ('Marca Avança', 'negocio', 'negociacao', 1) RETURNING id");
    await companies.sync(s.id);
    await dois.act(`/patrocinadores/${s.id}/avancar`, { contact_name: 'Caio Dias', contact_email: 'caio@marca.com', contact_phone: '48911112222' }, { from: `/patrocinadores/${s.id}` });
    const e = await espelhado(s.id, 'próximo passo');
    assert.deepEqual([e.e_contact_name, e.e_contact_email], ['Caio Dias', 'caio@marca.com']);
  });

  it('lead do site espelha', async () => {
    const leads = require('../src/services/siteLeads');
    const { id } = await leads.createSponsor({ company: 'Marca do Site', name: 'Ana Lima', email: 'ana@site.com', phone: '+5548955556666', website: 'https://marcadosite.com', role: 'Marketing', goal: 'Alcance', utm: null });
    await espelhado(id, 'lead do site');
  });

  it('patrocinador criado junto com o episódio espelha', async () => {
    const r = await dois.act('/episodios', {
      origem: 'hosts', patrocinador: 'novo', sponsor_company: 'Marca do Episódio', sponsor_kind: 'negocio', papel: 'insercao',
      title: 'Episódio só com os hosts', recorded_on: '2026-11-11', project_id: '1',
    }, { from: '/episodios/novo' });
    assert.ok([302, 303].includes(r.status), `esperava redirecionar, veio ${r.status}`);
    const { rows: [s] } = await h.db.query("SELECT id FROM sponsors WHERE company = 'Marca do Episódio'");
    await espelhado(s.id, 'patrocinador do episódio');
  });

  it('abrir negociação também no outro projeto, com os dados da empresa', async () => {
    const { rows: [s] } = await h.db.query("SELECT id FROM sponsors WHERE company = 'Clínica Vida Saúde'");
    const r = await dois.act(`/patrocinadores/${s.id}/tambem`, { project_id: '2' }, { from: `/patrocinadores/${s.id}` });
    assert.ok([302, 303].includes(r.status), `esperava redirecionar, veio ${r.status}`);
    const novoId = Number(String(r.location).match(/\/patrocinadores\/(\d+)/)[1]);
    const { rows: [novo] } = await h.db.query('SELECT company, website, contact_name, stage, project_id, company_id FROM sponsors WHERE id = $1', [novoId]);
    const { rows: [velho] } = await h.db.query('SELECT company_id FROM sponsors WHERE id = $1', [s.id]);
    assert.deepEqual([novo.company, novo.stage, novo.project_id], ['Clínica Vida Saúde', 'prospect', 2]);
    assert.equal(novo.company_id, velho.company_id, 'é a mesma empresa');
    assert.equal(novo.contact_name, 'Rita Souza');
    // a página mostra o bloco e some com o botão daquele projeto
    const page = await dois.get(`/patrocinadores/${s.id}`);
    assert.match(page.text, /Em outros projetos/);
    assert.match(page.text, new RegExp(`/patrocinadores/${novoId}`));
    assert.doesNotMatch(page.text, /Abrir negociação também/);
  });

  it('quem só tem um projeto não vê o bloco; projeto fora do recorte é 404', async () => {
    const { rows: [s] } = await h.db.query("SELECT id FROM sponsors WHERE company = 'Marca Avança'");
    const page = await soPulso.get(`/patrocinadores/${s.id}`);
    assert.doesNotMatch(page.text, /Em outros projetos/);
    const r = await soPulso.act(`/patrocinadores/${s.id}/tambem`, { project_id: '2' }, { from: `/patrocinadores/${s.id}` });
    assert.equal(r.status, 404);
  });

  it('a mesma empresa nos dois projetos não é duplicata', async () => {
    const dup = require('../src/services/duplicates');
    const { rows: [s] } = await h.db.query("SELECT * FROM sponsors WHERE company = 'Clínica Vida Saúde' AND project_id = 1");
    assert.deepEqual(await dup.findFor('sponsor', s, { excludeId: s.id }), []);
  });

  it('empresas parecidas em projetos diferentes: a ação é unir e os dois contratos ficam', async () => {
    const { rows: [a] } = await h.db.query("INSERT INTO sponsors (company, website, kind, stage, project_id) VALUES ('Lab Norte', 'https://labnorte.com.br', 'negocio', 'ativo', 1) RETURNING id");
    const { rows: [b] } = await h.db.query("INSERT INTO sponsors (company, website, kind, stage, project_id) VALUES ('Lab Norte', 'https://labnorte.com.br', 'negocio', 'prospect', 2) RETURNING id");
    await companies.sync(a.id); await companies.sync(b.id);
    const cmp = await dois.get(`/duplicatas/patrocinadores/${a.id}/${b.id}`);
    assert.match(cmp.text, /É a mesma empresa/);
    const r = await dois.act(`/duplicatas/patrocinadores/${a.id}/${b.id}/mesma-pessoa`, { manter: String(a.id) }, { from: `/duplicatas/patrocinadores/${a.id}/${b.id}` });
    assert.ok([302, 303].includes(r.status));
    const { rows } = await h.db.query('SELECT id, company_id FROM sponsors WHERE id = ANY($1::int[]) ORDER BY id', [[a.id, b.id]]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].company_id, rows[1].company_id);
  });
});
