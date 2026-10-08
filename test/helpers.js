// Ambiente de teste: banco isolado (*_test), e-mail em dry-run e YOURLS simulado.
process.env.NODE_ENV = 'test';
process.env.PODCAST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://pulso:pulso_dev@localhost:5432/pulso_test';
process.env.MAIL_DRY_RUN = 'true';
process.env.APP_BASE_URL = 'http://localhost';
process.env.SESSION_SECRET = 'test-secret-test-secret';
process.env.YOURLS_LINK = 'yourls.test';
process.env.YOURLS_KEY = 'fake-signature';

const http = require('http');
const config = require('../src/config');

if (!/_test$/.test(new URL(config.databaseUrl).pathname.slice(1))) {
  throw new Error('Os testes apagam o schema: use um banco cujo nome termine em _test.');
}
config.assertConfig();

const db = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const { seedDefaultTemplate } = require('../src/db/seed');
const { hashPassword } = require('../src/auth/password');
const { createApp } = require('../src/app');
const mailer = require('../src/services/mailer');

// ---- YOURLS simulado (nunca toca o encurtador real) ----
const yourlsCalls = [];
let collideNext = 0;
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).startsWith('https://yourls.test/')) {
    const params = new URLSearchParams(String(opts.body));
    yourlsCalls.push(Object.fromEntries(params));
    if (params.get('action') === 'db-stats') return Response.json({ 'db-stats': { total_links: '7', total_clicks: '33' }, statusCode: 200 });
    if (collideNext > 0) {
      collideNext -= 1;
      return Response.json({ status: 'fail', code: 'error:keyword', message: 'Short URL already exists in database or is reserved', statusCode: 200 });
    }
    const keyword = params.get('keyword') || 'auto123';
    return Response.json({ status: 'success', url: { keyword }, shorturl: `https://yourls.test/${keyword}`, statusCode: 200 });
  }
  return realFetch(url, opts);
};

async function resetDb() {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  await seedDefaultTemplate();
  mailer.outbox.length = 0;
}

async function createUser({ name, email, role, password = 'SenhaForte-123', active = true }) {
  const { rows } = await db.query(
    'INSERT INTO users (name, email, role, password_hash, active) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [name, email, role, password ? await hashPassword(password) : null, active]);
  return rows[0];
}

async function startServer() {
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, close: () => new Promise((r) => server.close(r)) };
}

// Cliente HTTP mínimo com cookie jar, sem seguir redirects.
function client(base) {
  const jar = {};
  const api = {
    async req(method, path, { form, headers = {}, ua } = {}) {
      const h = { ...headers, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), 'user-agent': ua || 'Mozilla/5.0 (test)' };
      let body;
      if (form) { body = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
      const res = await fetch(base + path, { method, headers: h, body, redirect: 'manual' });
      for (const c of res.headers.getSetCookie?.() || []) {
        const [pair] = c.split(';');
        const idx = pair.indexOf('=');
        const val = pair.slice(idx + 1);
        if (/Max-Age=0/i.test(c) || val === '') delete jar[pair.slice(0, idx)]; else jar[pair.slice(0, idx)] = val;
      }
      const text = await res.text();
      return { status: res.status, headers: res.headers, text, location: res.headers.get('location') };
    },
    get: (p, o) => api.req('GET', p, o),
    post: (p, form, o = {}) => api.req('POST', p, { ...o, form }),
    // GET + extrai o token CSRF da página
    async csrf(path = '/') {
      const r = await api.get(path);
      const m = r.text.match(/name="csrf" content="([a-f0-9]+)"/);
      return m ? m[1] : null;
    },
    // POST com CSRF automático
    async act(path, form = {}, o = {}) {
      return api.post(path, { _csrf: await api.csrf(o.from || '/'), ...form }, o);
    },
    async login(email, password = 'SenhaForte-123') {
      return api.post('/login', { email, password });
    },
  };
  return api;
}

module.exports = { db, config, mailer, resetDb, createUser, startServer, client, yourlsCalls, setCollisions: (n) => { collideNext = n; } };
