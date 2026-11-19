// Cloudflare Turnstile ("não sou robô"): login, recuperar senha, link do estúdio, plateia e formulários do site.
// O Cloudflare é simulado: o token "bom" passa, qualquer outro não; "fora" simula o Cloudflare sem responder.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const turnstile = require('../src/services/turnstile');
const links = require('../src/services/studioLinks');

describe('Turnstile nas telas públicas', () => {
  let app; let cfDown = false; const seen = [];
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const old = { ...h.config.turnstile };

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    await h.createUser({ name: 'Ana Gestão', email: 'ana@t.com', role: 'gestao' });
    Object.assign(h.config.turnstile, { siteKey: '0xCHAVE-PUBLICA', secret: 'segredo-de-teste' });
    turnstile.setFetcher(async (url, opts) => {
      seen.push({ url, secret: opts.body.get('secret'), response: opts.body.get('response'), ip: opts.body.get('remoteip') });
      if (cfDown) throw new Error('timeout');
      const response = opts.body.get('response');
      return { json: async () => (response === 'bom' ? { success: true } : { success: false, 'error-codes': [response ? 'invalid-input-response' : 'missing-input-response'] }) };
    });
  });
  after(async () => { Object.assign(h.config.turnstile, old); turnstile.setFetcher(null); await app.close(); await h.db.close(); });

  it('login: a página traz o widget e libera o Cloudflare só nela; sem a confirmação, não entra', async () => {
    const c = h.client(app.base);
    const page = await c.get('/login');
    assert.match(page.text, /data-turnstile="0xCHAVE-PUBLICA"/);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self' https:\/\/challenges\.cloudflare\.com/);
    assert.match(page.headers.get('content-security-policy'), /frame-src [^;]*https:\/\/challenges\.cloudflare\.com/);
    assert.doesNotMatch((await c.get('/')).headers.get('content-security-policy') || '', /challenges/, 'o resto do painel não muda');
    let r = await c.post('/login', { email: 'ana@t.com', password: 'SenhaForte-123' });
    assert.equal(r.status, 400); assert.match(r.text, /não é um robô/);
    r = await c.post('/login', { email: 'ana@t.com', password: 'SenhaForte-123', 'cf-turnstile-response': 'ruim' });
    assert.equal(r.status, 400);
    r = await c.post('/login', { email: 'ana@t.com', password: 'SenhaForte-123', 'cf-turnstile-response': 'bom' });
    assert.equal(r.status, 302);
    assert.equal(seen.at(-1).secret, 'segredo-de-teste'); assert.equal(seen.at(-1).ip, '127.0.0.1');
  });

  it('Cloudflare fora do ar: a equipe entra (os limites de tentativa continuam valendo)', async () => {
    cfDown = true;
    try {
      const r = await h.client(app.base).post('/login', { email: 'ana@t.com', password: 'SenhaForte-123' });
      assert.equal(r.status, 302);
    } finally { cfDown = false; }
  });

  it('recuperar senha: sem a confirmação não manda e-mail', async () => {
    const c = h.client(app.base);
    h.mailer.outbox.length = 0;
    let r = await c.post('/esqueci-senha', { email: 'ana@t.com' });
    assert.equal(r.status, 400); assert.match(r.text, /não é um robô/); assert.equal(h.mailer.outbox.length, 0);
    r = await c.post('/esqueci-senha', { email: 'ana@t.com', 'cf-turnstile-response': 'bom' });
    assert.equal(r.status, 200); assert.equal(h.mailer.outbox.length, 1);
  });

  it('link do estúdio: confere uma vez e vale para os envios seguintes daquele link', async () => {
    const u = (await q("SELECT id FROM users WHERE email = 'ana@t.com'"))[0];
    const [g] = await q("INSERT INTO guests (name, instagram, profile, status, owner_id) VALUES ('Dra. Turnstile', 'drats', 'medico', 'gravado', $1) RETURNING id", [u.id]);
    const ep = await require('../src/services/production').syncFromGuest(g.id, u.id);
    const link = await links.current(ep.id) || await links.create(ep.id, u.id);
    const base = `${app.base}/estudio/${link.token}`;
    const page = await fetch(base);
    assert.match(await page.text(), /data-turnstile="0xCHAVE-PUBLICA"[^>]*data-ts-manual/);
    const iniciar = (cookie) => fetch(`${base}/arquivos/iniciar`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ nome: 'a.mp4', caminho: 'a.mp4', tamanho: 10, tipo: 'video/mp4' }) });
    let r = await iniciar();
    assert.equal(r.status, 403); assert.equal((await r.json()).code, 'verificar');
    r = await fetch(`${base}/verificar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnstile: 'ruim' }) });
    assert.equal(r.status, 400);
    r = await fetch(`${base}/verificar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnstile: 'bom' }) });
    assert.equal(r.status, 200);
    const cookie = r.headers.get('set-cookie').split(';')[0];
    assert.match(r.headers.get('set-cookie'), new RegExp(`Path=/estudio/${link.token}; Max-Age=43200; HttpOnly`));
    r = await iniciar(cookie);
    assert.notEqual(r.status, 403, 'com o passe, o envio começa');
    assert.doesNotMatch(await (await fetch(base, { headers: { cookie } })).text(), /data-turnstile=/, 'com o passe, a página não pede de novo');
    r = await iniciar('pulso_est=9999999999.assinatura-falsa');
    assert.equal(r.status, 403, 'passe forjado não vale');
  });

  it('plateia e formulários do site: sem a confirmação, o pedido não entra', async () => {
    let r = await fetch(`${app.base}/plateia/inscricao`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guest_id: 1, name: 'Lucas Pereira', phone: '11912345678', terms: true }) });
    assert.equal(r.status, 400); assert.match((await r.json()).error, /não é um robô/);
    r = await fetch(`${app.base}/api/site/v1/convidado`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://podcastpulso.com' }, body: JSON.stringify({ name: 'Dra. Teste Site', email: 'site@t.com' }) });
    assert.equal(r.status, 400); assert.equal((await r.json()).field, 'robo');
    r = await fetch(`${app.base}/api/site/v1/convidado`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://podcastpulso.com' }, body: 'name=Dra.+Teste' });
    assert.equal(r.status, 303); assert.match(r.headers.get('location'), /\/ops\/\?tipo=convidado&erro=robo$/);
  });
});
