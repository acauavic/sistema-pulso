// "Trazer do outro projeto": o material da marca que já está num contrato entra no outro sem ninguém subir de novo.
// Cada contrato fica com o arquivo dele no armazenamento (cópia no próprio bucket), então apagar num lado não quebra o outro.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const companies = require('../src/services/companies');
const material = require('../src/services/sponsorMaterial');

describe('empresas: trazer material do outro projeto', () => {
  let srv; let dois; let a; let b; let logo; let pdf;
  before(async () => {
    await h.resetDb();
    await h.db.query(`UPDATE projects SET modules = modules || '{"patrocinio": true}'::jsonb WHERE id = 2`);
    await require('../src/services/projects').refresh(true);
    await h.createUser({ name: 'Gestora dos dois', email: 'dois@local.test', role: 'gestao', projects: [1, 2] });
    srv = await h.startServer();
    dois = h.client(srv.base); await dois.login('dois@local.test');
    const { rows: [s1] } = await h.db.query("INSERT INTO sponsors (company, kind, stage, project_id) VALUES ('Clínica Vida', 'negocio', 'ativo', 1) RETURNING id");
    a = s1.id;
    const { companyId } = await companies.sync(a);
    const { rows: [s2] } = await h.db.query("INSERT INTO sponsors (company, kind, stage, project_id, company_id) VALUES ('Clínica Vida', 'negocio', 'ativo', 2, $1) RETURNING id", [companyId]);
    b = s2.id;
    // dois arquivos prontos no contrato do Pulso
    h.b2Store.set('pp/patrocinadores/logo.png', { body: Buffer.from('PNG-logo'), contentType: 'image/png' });
    h.b2Store.set('pp/patrocinadores/manual.pdf', { body: Buffer.from('PDF-manual'), contentType: 'application/pdf' });
    ({ rows: [logo] } = await h.db.query(
      `INSERT INTO sponsor_files (sponsor_id, kind, storage_key, filename, content_type, size_bytes, status, is_main)
       VALUES ($1, 'logo', 'pp/patrocinadores/logo.png', 'logo.png', 'image/png', 8, 'pronto', true) RETURNING id, storage_key`, [a]));
    ({ rows: [pdf] } = await h.db.query(
      `INSERT INTO sponsor_files (sponsor_id, kind, storage_key, filename, content_type, size_bytes, status)
       VALUES ($1, 'material', 'pp/patrocinadores/manual.pdf', 'manual.pdf', 'application/pdf', 10, 'pronto') RETURNING id, storage_key`, [a]));
  });
  after(async () => { await srv.close(); await h.db.close(); });

  it('a aba Material do outro contrato oferece os arquivos da empresa', async () => {
    const lista = await material.otherProjectFiles(b, { pids: [1, 2] });
    assert.equal(lista.length, 2);
    assert.deepEqual(lista.map((f) => f.filename).sort(), ['logo.png', 'manual.pdf']);
    assert.equal(lista[0].project_name, 'Pulso');
    const page = await dois.get(`/patrocinadores/${b}`);
    assert.match(page.text, /Trazer do outro projeto/);
  });

  it('traz os escolhidos: arquivo próprio no armazenamento, sem subir de novo', async () => {
    const r = await dois.act(`/patrocinadores/${b}/material/trazer`, { arquivo: [String(logo.id), String(pdf.id)] }, { from: `/patrocinadores/${b}` });
    assert.ok([302, 303].includes(r.status), `esperava redirecionar, veio ${r.status}`);
    const { rows } = await h.db.query("SELECT kind, filename, storage_key, status, is_main FROM sponsor_files WHERE sponsor_id = $1 ORDER BY filename", [b]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((f) => f.filename), ['logo.png', 'manual.pdf']);
    assert.ok(rows.every((f) => f.status === 'pronto'));
    assert.ok(rows.every((f) => f.storage_key !== logo.storage_key && f.storage_key !== pdf.storage_key), 'cada contrato tem a sua chave');
    assert.ok(rows.every((f) => h.b2Store.has(f.storage_key)), 'o arquivo foi copiado no armazenamento');
    assert.equal(h.b2Store.get(rows[0].storage_key).body.toString(), 'PNG-logo');
    assert.ok(rows.find((f) => f.kind === 'logo').is_main, 'a primeira logo do contrato vira a principal');
  });

  it('apagar num contrato não apaga o arquivo do outro', async () => {
    const { rows: [novo] } = await h.db.query("SELECT id, storage_key FROM sponsor_files WHERE sponsor_id = $1 AND kind = 'material'", [b]);
    await dois.act(`/patrocinadores/${b}/arquivos/${novo.id}/excluir`, {}, { from: `/patrocinadores/${b}` });
    assert.ok(h.b2Store.has(pdf.storage_key), 'o arquivo do contrato de origem continua lá');
  });

  it('não traz de contrato fora do recorte nem o que já veio', async () => {
    const soPulso = h.client(srv.base);
    await h.createUser({ name: 'Gestor do Pulso', email: 'pulso@local.test', role: 'gestao', projects: [1] });
    await soPulso.login('pulso@local.test');
    const r = await soPulso.act(`/patrocinadores/${a}/material/trazer`, { arquivo: [String(logo.id)] }, { from: `/patrocinadores/${a}` });
    assert.ok([302, 303, 404].includes(r.status));
    // a logo já trazida não aparece de novo na lista do contrato de destino
    const lista = await material.otherProjectFiles(b, { pids: [1, 2] });
    assert.deepEqual(lista.map((f) => f.filename), ['manual.pdf']);
  });
});
