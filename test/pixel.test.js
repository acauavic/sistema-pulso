const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('Meta Pixel nas páginas públicas (plateia, patrocinador, convidado)', () => {
  let app; const ID = '1442878457199798';
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const one = (sql, p) => q(sql, p).then((r) => r[0]);
  // o fetch do Node descarta os cabeçalhos Sec-Fetch-* (só navegador manda): a abertura "pelo navegador" vai por http.request
  const navigate = (path, ua = 'Mozilla/5.0 (test)') => new Promise((resolve, reject) => {
    const u = new URL(app.base + path);
    require('http').get({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'user-agent': ua } }, (res) => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, cookie: [].concat(res.headers['set-cookie'] || []).join('; ') }));
    }).on('error', reject);
  });
  // o cliente de teste usa o próprio pote de cookies: aqui o cookie vai à mão
  const withCookie = (path, cookie) => fetch(app.base + path, { headers: { cookie: cookie.split(';')[0], 'user-agent': 'Mozilla/5.0 (test)' }, redirect: 'manual' })
    .then(async (res) => ({ status: res.status, headers: res.headers, text: await res.text() }));
  const hasPixel = (r, content) => {
    assert.match(r.text, new RegExp(`pixel\\.js[^"]*" data-pixel="${ID}" data-content="${content}"`));
    assert.match(r.headers.get('content-security-policy'), /https:\/\/connect\.facebook\.net/);
    assert.match(r.headers.get('content-security-policy'), /connect-src[^;]*https:\/\/www\.facebook\.com/);
  };

  before(async () => { await h.resetDb(); app = await h.startServer(); });
  after(async () => { await app.close(); await h.db.close(); });

  it('o script dispara PageView e ViewContent com o nome da página', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../src/public/pixel.js'), 'utf8');
    assert.match(src, /fbq\('init', id\)/); assert.match(src, /'PageView'/); assert.match(src, /'ViewContent'/);
    const plateia = require('fs').readFileSync(require('path').join(__dirname, '../src/public/plateia.js'), 'utf8');
    assert.match(plateia, /fire\('ViewContent'/); assert.match(plateia, /fire\('Lead', 'generate_lead'/, 'enviar o formulário de interesse é a conversão');
  });

  it('plateia: o Pixel do sistema vale sem configurar nada (e a plateia pode trocar o dela)', async () => {
    const r = await h.client(app.base).get('/plateia');
    assert.match(r.text, new RegExp(`data-meta-pixel="${ID}"`));
    assert.match(r.headers.get('content-security-policy'), /https:\/\/connect\.facebook\.net/);
    await q("INSERT INTO app_settings (key, value) VALUES ('plateia_meta_pixel', '999999999') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");
    assert.match((await h.client(app.base).get('/plateia')).text, /data-meta-pixel="999999999"/);
    await q("DELETE FROM app_settings WHERE key = 'plateia_meta_pixel'");
  });

  it('patrocinador: media kit, cadastro e portal com o Pixel (o endereço já é limpo)', async () => {
    const s = await one("INSERT INTO sponsors (company, stage, public_token) VALUES ('Clínica Px', 'ativo', 'tok-patrocinador-pixel-123456') RETURNING id");
    const c = h.client(app.base);
    assert.equal((await c.get('/patrocinador/tok-patrocinador-pixel-123456')).location, '/patrocinador/kit');
    hasPixel(await c.get('/patrocinador/kit'), 'Media kit');
    hasPixel(await c.get('/patrocinador/cadastro'), 'Cadastro do patrocinador');
    const portal = await c.get('/patrocinador/portal');
    assert.equal(portal.status, 200, `sponsor ${s.id}`); hasPixel(portal, 'Portal do patrocinador');
  });

  it('convite: pelo navegador vira /convite/abrir (o código sai do endereço e vai para um cookie); a página tem o Pixel', async () => {
    const g = await one("INSERT INTO guests (name, status, invite_token) VALUES ('Ana Px', 'convite_enviado', 'tok-convite-pixel-1234567') RETURNING id");
    const r = await navigate('/convite/tok-convite-pixel-1234567?utm_source=wa');
    assert.equal(r.status, 302); assert.equal(r.location, '/convite/abrir?utm_source=wa');
    assert.match(r.cookie, /pulso_convite=tok-convite-pixel-1234567; Path=\/convite;.*HttpOnly/);
    const page = await withCookie('/convite/abrir?utm_source=wa', r.cookie);
    assert.equal(page.status, 200); hasPixel(page, 'Convite');
    assert.ok((await one('SELECT invite_viewed_at FROM guests WHERE id = $1', [g.id])).invite_viewed_at, 'a abertura conta');
    assert.equal((await h.client(app.base).get('/convite/abrir')).status, 401, 'sem o cookie, pede o link');
    // robô de pré-visualização e chamada direta: página no próprio link, sem redirecionar
    assert.equal((await h.client(app.base).get('/convite/tok-convite-pixel-1234567')).status, 200);
    assert.equal((await navigate('/convite/tok-convite-pixel-1234567', 'WhatsApp/2.23')).status, 200);
  });

  it('portal do convidado: pelo navegador vira /convidado/meu-portal; a página tem o Pixel', async () => {
    const g = await one("INSERT INTO guests (name, status, portal_enabled, portal_token) VALUES ('Bia Px', 'gravado', true, 'tok-portal-pixel-123456789') RETURNING id");
    await q("INSERT INTO episodes (number, title, guest_id, status) VALUES (77, 'Px', $1, 'publicado')", [g.id]);
    const r = await navigate('/convidado/tok-portal-pixel-123456789?youtube=ok');
    assert.equal(r.status, 302); assert.equal(r.location, '/convidado/meu-portal?youtube=ok');
    assert.match(r.cookie, /pulso_portal=tok-portal-pixel-123456789; Path=\/convidado;/);
    const page = await withCookie('/convidado/meu-portal', r.cookie);
    assert.equal(page.status, 200); hasPixel(page, 'Portal do convidado');
    assert.match(page.text, /<h1>Olá, Bia\.<\/h1>/);
    assert.equal((await h.client(app.base).get('/convidado/meu-portal')).status, 401);
  });
});
