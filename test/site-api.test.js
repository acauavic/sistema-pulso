// API pública do site (podcastpulso.com): campos novos, leitura e formulários.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { NOTIFICATION_TYPES } = require('../src/constants');
const notify = require('../src/services/notify');

describe('Site: campos novos', () => {
  before(async () => { await h.resetDb(); });

  it('as colunas existem', async () => {
    await h.db.query('SELECT premiere_on, origin, utm FROM guests');
    await h.db.query('SELECT origin, utm, site_hidden, site_official FROM sponsors');
  });

  it('dois patrocinadores oficiais ao mesmo tempo são recusados', async () => {
    await h.db.query(`INSERT INTO sponsors (company, site_official) VALUES ('A', true)`);
    await assert.rejects(h.db.query(`INSERT INTO sponsors (company, site_official) VALUES ('B', true)`), { code: '23505' });
    await h.db.query(`INSERT INTO sponsors (company, site_official) VALUES ('C', false)`);
  });

  it('o aviso "Pedidos pelo site" existe', () => {
    assert.equal(NOTIFICATION_TYPES.site.label, 'Pedidos pelo site');
  });

  it('o aviso "site" é gravado e vai para a gestão por padrão', async () => {
    const g = await h.createUser({ name: 'Gil Gestão', email: 'g@t.com', role: 'gestao' });
    const { rows } = await h.db.query(`SELECT roles FROM notification_settings WHERE type = 'site'`);
    assert.deepEqual([...rows[0].roles].sort(), ['gestao', 'superadmin']);
    const out = await notify.notify({ type: 'site', broadcast: true, title: 'Novo pedido pelo site' });
    assert.equal(out.length, 1);
    const { rows: n } = await h.db.query(`SELECT user_id, type FROM notifications WHERE type = 'site'`);
    assert.equal(n.length, 1); assert.equal(String(n[0].user_id), String(g.id));
  });
});

describe('Site: patrocinador oficial e esconder do site', () => {
  let app; const as = {}; let a; let b;
  const flags = async (id) => (await h.db.query('SELECT site_official, site_hidden FROM sponsors WHERE id = $1', [id])).rows[0];
  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    await h.createUser({ name: 'Gil Gestão', email: 'gestao@t.com', role: 'gestao' });
    await h.createUser({ name: 'Edu Editor', email: 'edit@t.com', role: 'editor_video' });
    for (const [k, email] of [['gestao', 'gestao@t.com'], ['editor', 'edit@t.com']]) {
      as[k] = h.client(app.base);
      assert.equal((await as[k].login(email)).status, 302, `login ${k}`);
    }
    a = (await h.db.query(`INSERT INTO sponsors (company, stage) VALUES ('Marca A', 'ativo') RETURNING id`)).rows[0].id;
    b = (await h.db.query(`INSERT INTO sponsors (company, stage) VALUES ('Marca B', 'ativo') RETURNING id`)).rows[0].id;
  });
  after(async () => { await app.close?.(); });

  it('marcar um oficial desmarca o anterior', async () => {
    let r = await as.gestao.act(`/patrocinadores/${a}/site`, { official: 'on' });
    assert.equal(r.status, 302); assert.equal(r.location, `/patrocinadores/${a}`);
    assert.equal((await flags(a)).site_official, true);
    r = await as.gestao.act(`/patrocinadores/${b}/site`, { official: 'on' });
    assert.equal(r.status, 302);
    assert.equal((await flags(a)).site_official, false);
    assert.equal((await flags(b)).site_official, true);
    r = await as.gestao.act(`/patrocinadores/${b}/site`, {});
    assert.equal((await flags(b)).site_official, false);
  });

  it('esconder do site grava site_hidden', async () => {
    await as.gestao.act(`/patrocinadores/${a}/site`, { hidden: 'on' });
    assert.deepEqual(await flags(a), { site_official: false, site_hidden: true });
    await as.gestao.act(`/patrocinadores/${a}/site`, {});
    assert.equal((await flags(a)).site_hidden, false);
    const { rows } = await h.db.query(`SELECT 1 FROM sponsor_events WHERE sponsor_id = $1 AND type = 'site'`, [a]);
    assert.ok(rows.length >= 2);
  });

  it('quem só lê patrocinadores recebe 403', async () => {
    const r = await as.editor.act(`/patrocinadores/${a}/site`, { official: 'on' });
    assert.equal(r.status, 403);
    assert.equal((await flags(a)).site_official, false);
  });

  it('a página mostra os dois interruptores e a frase', async () => {
    const r = await as.gestao.get(`/patrocinadores/${a}`);
    assert.equal(r.status, 200);
    assert.match(r.text, /Patrocinador oficial no site/);
    assert.match(r.text, /Esconder do site/);
    assert.match(r.text, /O site mostra a logo das marcas que fecharam ou patrocinam\./);
    assert.equal((r.text.match(/role="switch"/g) || []).length >= 2, true);
    assert.match(r.text, /action="\/patrocinadores\/\d+\/site"/);
  });
});

after(async () => { await h.db.close(); });
