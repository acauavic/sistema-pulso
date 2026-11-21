// Comprovante nos lançamentos: ao registrar o custo (a nota, o boleto), ao marcar como pago (o comprovante do pagamento) e
// depois, pelo clipe na linha. O arquivo vai pelo envio de anexos; quem vê é quem vê o financeiro daquele projeto.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const PULSO = 1; const P100 = 2;
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);

describe('comprovante nos lançamentos', () => {
  const as = {}; let app; let entry;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const one = (sql, p) => q(sql, p).then((r) => r[0]);
  const upload = async (client, body, name, type) => {
    const res = await fetch(`${app.base}/anexos`, { method: 'POST', redirect: 'manual', headers: { cookie: client.cookie(), accept: 'application/json', 'x-csrf-token': await client.csrf('/financeiro/lancamentos'), 'content-type': type, 'x-filename': encodeURIComponent(name) }, body });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  before(async () => {
    await h.resetDb();
    await h.createUser({ name: 'Casa', email: 'casa@local.test', role: 'gestao', projects: [PULSO, P100] });
    await h.createUser({ name: 'Cem', email: 'cem@local.test', role: 'gestao', projects: [P100] });
    app = await h.startServer();
    for (const k of ['casa', 'cem']) { as[k] = h.client(app.base); await as[k].login(`${k}@local.test`); }
    // quem só mexe no financeiro (sem tarefas nem comentários) também anexa
    const { rows: [r] } = await h.db.query("INSERT INTO roles (name, base, perms) VALUES ('Só financeiro', 'gestao', '{finance.read,finance.write}') RETURNING id");
    const fu = await h.createUser({ name: 'Fin', email: 'fin@local.test', role: 'gestao', projects: [PULSO] });
    await h.db.query('UPDATE users SET role_id = $2 WHERE id = $1', [fu.id, r.id]);
    await require('../src/services/roles').refresh(true);
    as.fin = h.client(app.base); await as.fin.login('fin@local.test');
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('a janela de novo lançamento e a de pagar têm o campo do comprovante', async () => {
    const page = (await as.casa.get('/financeiro/lancamentos')).text;
    assert.match(page, /data-receipt/); assert.match(page, /Comprovante/);
    assert.match(page, /src="\/static\/comprovante\.js\?v=/);
  });

  it('ao registrar o custo: o arquivo enviado fica ligado ao lançamento, como "conta"', async () => {
    const f = (await upload(as.fin, PDF, 'Nota fiscal.pdf', 'application/pdf'));
    assert.equal(f.status, 200, 'quem só tem o financeiro também envia');
    await as.fin.act('/financeiro/lancamentos', { direction: 'saida', description: 'Caixas de presente', amount: '320,00', due_on: '2026-12-05', category: 'brindes', comprovante: String(f.json.attachment.id) }, { from: '/financeiro/lancamentos' });
    entry = await one("SELECT * FROM fin_entries WHERE description = 'Caixas de presente'");
    const att = await q("SELECT * FROM attachments WHERE entity_type = 'fin_entry' AND entity_id = $1", [entry.id]);
    assert.equal(att.length, 1); assert.equal(att[0].purpose, 'conta'); assert.equal(att[0].filename, 'Nota fiscal.pdf');
    const page = (await as.fin.get('/financeiro/lancamentos')).text;
    assert.match(page, /Nota fiscal\.pdf/, 'a linha mostra o comprovante'); assert.match(page, new RegExp(`/anexos/${att[0].id}`));
  });

  it('ao marcar como pago: o comprovante do pagamento entra junto', async () => {
    const f = (await upload(as.fin, PNG, 'pix.png', 'image/png')).json.attachment;
    await as.fin.act(`/financeiro/lancamentos/${entry.id}/pagar`, { amount: '320,00', paid_on: '2026-12-05', comprovante: String(f.id) }, { from: '/financeiro/lancamentos' });
    const att = await q("SELECT purpose FROM attachments WHERE entity_type = 'fin_entry' AND entity_id = $1 ORDER BY id", [entry.id]);
    assert.deepEqual(att.map((a) => a.purpose), ['conta', 'pagamento']);
    assert.equal((await one('SELECT status FROM fin_entries WHERE id = $1', [entry.id])).status, 'pago');
  });

  it('depois, pelo clipe da linha (mesmo já pago); e tirar um comprovante', async () => {
    const f = (await upload(as.fin, PDF, 'recibo.pdf', 'application/pdf')).json.attachment;
    await as.fin.act(`/financeiro/lancamentos/${entry.id}/comprovantes`, { comprovante: String(f.id), voltar: '/financeiro/lancamentos?escopo=historico' }, { from: '/financeiro/lancamentos?escopo=historico' });
    assert.equal((await q("SELECT 1 FROM attachments WHERE entity_type = 'fin_entry' AND entity_id = $1", [entry.id])).length, 3);
    await as.fin.act(`/financeiro/lancamentos/${entry.id}/comprovantes/${f.id}/excluir`, {}, { from: '/financeiro/lancamentos?escopo=historico' });
    assert.equal((await q("SELECT 1 FROM attachments WHERE entity_type = 'fin_entry' AND entity_id = $1", [entry.id])).length, 2);
  });

  it('quem vê: o financeiro do projeto do lançamento; de outro projeto, 404; arquivo de outra pessoa não é roubado', async () => {
    const att = await one("SELECT * FROM attachments WHERE entity_type = 'fin_entry' AND entity_id = $1 ORDER BY id LIMIT 1", [entry.id]);
    assert.equal((await as.casa.get(`/anexos/${att.id}`)).status, 302, 'a gestão da casa vê');
    assert.equal((await as.cem.get(`/anexos/${att.id}`)).status, 404, 'quem é só do Projeto 100 não vê o comprovante do Pulso');
    assert.equal((await as.cem.act(`/financeiro/lancamentos/${entry.id}/comprovantes`, { comprovante: '1' }, { from: '/financeiro/lancamentos' })).status, 404);
    // o anexo solto de outra pessoa não vai para o lançamento
    const alheio = (await upload(as.casa, PDF, 'da-casa.pdf', 'application/pdf')).json.attachment;
    await as.fin.act(`/financeiro/lancamentos/${entry.id}/comprovantes`, { comprovante: String(alheio.id) }, { from: '/financeiro/lancamentos' });
    assert.equal((await one('SELECT entity_id FROM attachments WHERE id = $1', [alheio.id])).entity_id, null);
  });

  it('excluir o lançamento leva os comprovantes junto (na limpeza)', async () => {
    const e2 = await one("INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, project_id) VALUES ('saida','outros','Some',1000,'2026-12-01',1) RETURNING id");
    const f = (await upload(as.fin, PDF, 'x.pdf', 'application/pdf')).json.attachment;
    await as.fin.act(`/financeiro/lancamentos/${e2.id}/comprovantes`, { comprovante: String(f.id) }, { from: '/financeiro/lancamentos' });
    await h.db.query('DELETE FROM fin_entries WHERE id = $1', [e2.id]);
    await require('../src/services/attachments').purge();
    assert.equal((await q('SELECT 1 FROM attachments WHERE id = $1', [f.id])).length, 0);
  });
});
