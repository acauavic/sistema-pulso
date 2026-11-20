// Identidade do painel nas páginas servidas: marca Health Scale Studio no login, no menu e na página sem conexão.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('identidade: marca do painel nas páginas', () => {
  let app; let anon; let gestao;
  before(async () => {
    await h.resetDb(); app = await h.startServer(); anon = h.client(app.base);
    await h.createUser({ name: 'Gil Gestão', email: 'gestao@t.com', role: 'gestao' }); gestao = h.client(app.base); await gestao.login('gestao@t.com');
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('login: título, assinatura com o logotipo e a paleta nova; nada do wordmark do Pulso', async () => {
    const t = (await anon.get('/login')).text;
    assert.match(t, /<title>[^<]*· Health Scale Studio<\/title>/);
    assert.match(t, /class="brand brand-sign"/); assert.match(t, /\/static\/brand\/studio\/health-scale-logo\.png/);
    assert.match(t, /<meta name="theme-color" content="#0E0F0D">/);
    assert.match(t, /archivo-latin-wght-normal\.woff2" as="font"/, 'a fonte do painel começa a baixar junto com o CSS');
    assert.doesNotMatch(t, /class="wordmark"|pulso<span class="dot">|movimentando a saúde/);
    assert.match(t, /class="signal/);
  });

  it('painel logado: marca no menu (ícone + HEALTH SCALE / STUDIO), que some no menu recolhido só pelo CSS', async () => {
    const t = (await gestao.get('/')).text;
    assert.match(t, /class="brand brand-menu"/); assert.match(t, /HEALTH SCALE/); assert.match(t, />STUDIO</);
    assert.match(t, /aria-label="Health Scale Studio: início"/);
    assert.match(t, /<meta name="apple-mobile-web-app-title" content="Studio">/);
    assert.doesNotMatch(t, /wm-rest|class="wordmark"/);
  });

  it('esqueci a senha e página sem conexão seguem o login', async () => {
    const f = (await anon.get('/esqueci-senha')).text;
    assert.match(f, /class="brand brand-sign"/); assert.doesNotMatch(f, /class="wordmark"/);
    const off = (await anon.get('/static/offline.html')).text;
    assert.match(off, /class="brand brand-sign"/); assert.match(off, /Sem conexão/); assert.match(off, /Health Scale Studio/);
    assert.doesNotMatch(off, /wordmark|O Pulso está|style=|#333333/);
  });
});
