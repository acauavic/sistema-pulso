// API pública do site (podcastpulso.com): campos novos, leitura e formulários.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { NOTIFICATION_TYPES } = require('../src/constants');

describe('Site: campos novos', () => {
  before(async () => { await h.resetDb(); });
  after(async () => { await h.db.close(); });

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
});
