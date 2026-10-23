const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const list = require('../src/releases');
const pkg = require('../package.json');

describe('versões e novidades', () => {
  let app; let c;

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    await h.createUser({ name: 'Paula Produtora', email: 'p@t.com', role: 'produtora' });
    c = h.client(app.base); assert.equal((await c.login('p@t.com')).status, 302);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('a versão do package.json é a da primeira entrada; versões em ordem decrescente e completas', () => {
    assert.equal(pkg.version, list[0].version, 'ao lançar: suba o package.json junto com src/releases.js');
    const n = (v) => v.split('.').map(Number);
    for (const r of list) {
      assert.match(r.version, /^\d+\.\d+\.\d+$/); assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(r.title && r.items.length, `v${r.version} sem título ou itens`);
      for (const it of r.items) { assert.ok(['novo', 'ajuste', 'correcao'].includes(it.kind)); assert.ok(it.text.length > 10); }
    }
    for (let i = 1; i < list.length; i += 1) {
      const [a, b] = [n(list[i - 1].version), n(list[i].version)];
      assert.ok(a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2]))), 'versões repetidas ou fora de ordem');
    }
  });

  it('cada pessoa vê o aviso uma vez por versão; abrir as novidades ou dispensar apaga o aviso', async () => {
    const v = list[0].version;
    let t = (await c.get('/')).text;
    assert.match(t, /release-toast/); assert.match(t, new RegExp(`Sistema atualizado · v${v.replace(/\./g, '\\.')}`));
    assert.match(t, new RegExp(`class="version-link[^>]*>v${v.replace(/\./g, '\\.')}`), 'versão no menu');

    const page = await c.get('/novidades');
    assert.equal(page.status, 200); assert.match(page.text, /Novidades/); assert.match(page.text, /Primeira versão numerada/);
    assert.doesNotMatch(page.text, /release-toast/, 'na própria página o aviso não aparece');
    assert.doesNotMatch((await c.get('/')).text, /release-toast/, 'já viu');

    await h.db.query("UPDATE users SET release_seen = '0.0.1'");
    assert.match((await c.get('/tarefas')).text, /release-toast/, 'versão nova volta a avisar');
    const r = await c.act('/novidades/visto', { voltar: '/tarefas' }, { from: '/tarefas' });
    assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/tarefas');
    assert.doesNotMatch((await c.get('/tarefas')).text, /release-toast/);
    const evil = await c.act('/novidades/visto', { voltar: '//evil.com' }, { from: '/' });
    assert.equal(evil.headers.get('location'), '/', 'só volta para caminhos do painel');
  });

  it('sem login, as novidades pedem entrada', async () => {
    const anon = h.client(app.base);
    const r = await anon.get('/novidades');
    assert.ok([302, 401].includes(r.status));
  });
});
