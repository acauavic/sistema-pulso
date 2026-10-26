// Ambiente de teste: banco isolado (*_test), e-mail em dry-run e YOURLS simulado.
process.env.NODE_ENV = 'test';
process.env.PODCAST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://pulso:pulso_dev@localhost:5432/pulso_test';
process.env.MAIL_DRY_RUN = 'true';
process.env.APP_BASE_URL = 'http://localhost';
process.env.SESSION_SECRET = 'test-secret-test-secret';
process.env.YOURLS_LINK = 'yourls.test';
process.env.YOURLS_KEY = 'fake-signature';
// Backblaze e Groq SIMULADOS: chaves falsas e endereço/prefixo fixos (nada de descoberta pela rede).
process.env.BB_KEY_ID = 'test-key-id';
process.env.BB_APPLICATION_KEY = 'test-app-key';
process.env.BUCKET_NAME = 'test-bucket';
process.env.BB_ENDPOINT = 'https://s3.test-region.backblazeb2.com';
process.env.BB_PREFIX = 'pp';
process.env.GROQ_APIKEY = 'test-groq-key';
process.env.GEMINI_KEY = ''; // a suíte nunca fala com a IA de verdade (cada teste que precisa liga e simula)
process.env.UPLOAD_POST_KEY = 'test-upload-post-key';
process.env.UPLOAD_POST_LIVE = 'false';
process.env.VIDEO_FORMAT_CHECK = 'false'; // os testes enviam bytes falsos; o teste de formato liga a conferência
process.env.UPLOAD_PART_BYTES = String(64 * 1024); // partes pequenas: o teste exercita o envio em várias partes sem arquivos enormes
process.env.PATROCINIO_WHATSAPP = '5511971739061';
process.env.PRODUCAO_WHATSAPP = '5512991053852';

const http = require('http');
const config = require('../src/config');

if (!/_test$/.test(new URL(config.databaseUrl).pathname.slice(1))) {
  throw new Error('Os testes apagam o schema: use um banco cujo nome termine em _test.');
}
config.assertConfig();

const db = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const { hashPassword } = require('../src/auth/password');
const { createApp } = require('../src/app');
const mailer = require('../src/services/mailer');

// ---- YOURLS simulado (nunca toca o encurtador real) ----
const yourlsCalls = [];
let collideNext = 0;
const realFetch = global.fetch;

// ---- Backblaze B2 (S3) simulado: guarda em memória, confere assinatura e a restrição de prefixo da chave ----
const b2Store = new Map(); // chave do objeto -> { body: Buffer, contentType }
const b2Calls = [];
const b2Multipart = new Map(); // uploadId -> { key, contentType, parts: Map(n -> Buffer) }
let b2Seq = 0;
const md5 = (buf) => require('crypto').createHash('md5').update(buf).digest('hex');
// ---- Groq simulado ----
const groqCalls = [];
let groqFail = false;
const BLOCKED = /(backblazeb2\.com|groq\.com|upload-post\.com|outstand\.so|zernio\.com|generativelanguage\.googleapis\.com)/;
// ---- Upload-Post simulado: guarda os pedidos e responde conforme o teste configurar ----
const uploadPostCalls = [];
const uploadPostState = {
  accounts: { instagram: { display_name: 'pulso', handle: 'pulso', reauth_required: false }, youtube: { display_name: 'Pulso', handle: '@pulso', reauth_required: false } },
  status: { status: 'completed', completed: 1, total: 1, results: [] }, failUpload: null,
  analytics: { instagram: { followers: 1200, views: 5000, reach: 3000, likes: 400, comments: 50, shares: 20 } },
  media: [{ id: 'm1', caption: 'Reels', permalink: 'https://www.instagram.com/reel/m1/', timestamp: new Date().toISOString(), media_type: 'VIDEO' }],
  comments: {}, // por post (id ou url) -> lista de comentários
  conversations: [],
};

let b2Full = false; // simula a conta do Backblaze sem espaço (Caps & Alerts)
const b2Cors = { xml: null, denied: false }; // CORS do bucket (nível do bucket, ?cors)
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (/^https:\/\/s3\.test-region\.backblazeb2\.com\/test-bucket\?cors=?$/.test(u)) {
    const method = opts.method || 'GET';
    b2Calls.push({ method, key: '(bucket)', query: { cors: '' }, authorization: opts.headers?.Authorization, md5: opts.headers?.['content-md5'] });
    if (!/^AWS4-HMAC-SHA256 Credential=test-key-id\//.test(opts.headers?.Authorization || '')) return new Response('<Error><Code>SignatureDoesNotMatch</Code></Error>', { status: 403 });
    if (method === 'GET') return b2Cors.xml ? new Response(b2Cors.xml, { status: 200 }) : new Response('<Error><Code>NoSuchCorsConfiguration</Code></Error>', { status: 404 });
    if (b2Cors.denied) return new Response('<Error><Code>AccessDenied</Code><Message>not entitled</Message></Error>', { status: 403 });
    if (method === 'PUT') { b2Cors.xml = Buffer.from(opts.body).toString(); return new Response('', { status: 200 }); }
    if (method === 'DELETE') { b2Cors.xml = null; return new Response('', { status: 204 }); }
  }
  if (u.startsWith('https://s3.test-region.backblazeb2.com/test-bucket/')) {
    const parsed = new URL(u);
    const key = decodeURIComponent(parsed.pathname.slice('/test-bucket/'.length));
    const q = parsed.searchParams;
    const method = opts.method || 'GET';
    b2Calls.push({ method, key, query: Object.fromEntries(q), authorization: opts.headers?.Authorization, payloadHash: opts.headers?.['x-amz-content-sha256'] });
    const presigned = q.has('X-Amz-Signature') && q.get('X-Amz-Algorithm') === 'AWS4-HMAC-SHA256' && q.get('X-Amz-Credential')?.startsWith('test-key-id/');
    if (!presigned && !/^AWS4-HMAC-SHA256 Credential=test-key-id\/\d{8}\/test-region\/s3\/aws4_request, SignedHeaders=.+, Signature=[0-9a-f]{64}$/.test(opts.headers?.Authorization || '')) {
      return new Response('<Error><Code>SignatureDoesNotMatch</Code></Error>', { status: 403 });
    }
    if (!key.startsWith('pp')) return new Response('<Error><Code>AccessDenied</Code><Message>not entitled</Message></Error>', { status: 403 });
    // upload em partes
    if (method === 'POST' && q.has('uploads')) {
      b2Seq += 1;
      const id = `upload-${b2Seq}`;
      b2Multipart.set(id, { key, contentType: opts.headers['content-type'], parts: new Map() });
      return new Response(`<InitiateMultipartUploadResult><Bucket>test-bucket</Bucket><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`, { status: 200 });
    }
    if (b2Full && method === 'PUT') return new Response('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Error><Code>AccessDenied</Code><Message>Cannot upload files, storage cap exceeded. See the Caps &amp; Alerts page to increase your cap.</Message></Error>', { status: 403 });
    if (method === 'PUT' && q.has('partNumber')) {
      const mp = b2Multipart.get(q.get('uploadId'));
      if (!mp) return new Response('<Error><Code>NoSuchUpload</Code></Error>', { status: 404 });
      const body = Buffer.from(opts.body);
      mp.parts.set(Number(q.get('partNumber')), body);
      return new Response('', { status: 200, headers: { etag: `"${md5(body)}"` } });
    }
    if (method === 'POST' && q.has('uploadId')) {
      const mp = b2Multipart.get(q.get('uploadId'));
      if (!mp) return new Response('<Error><Code>NoSuchUpload</Code></Error>', { status: 404 });
      const listed = [...Buffer.from(opts.body).toString().matchAll(/<PartNumber>(\d+)<\/PartNumber><ETag>([^<]+)<\/ETag>/g)].map((m) => [Number(m[1]), m[2]]);
      for (const [n, etag] of listed) {
        if (!mp.parts.has(n) || `"${md5(mp.parts.get(n))}"` !== etag) return new Response('<Error><Code>InvalidPart</Code></Error>', { status: 400 });
      }
      b2Store.set(mp.key, { body: Buffer.concat(listed.map(([n]) => mp.parts.get(n))), contentType: mp.contentType });
      b2Multipart.delete(q.get('uploadId'));
      return new Response('<CompleteMultipartUploadResult><Key>x</Key></CompleteMultipartUploadResult>', { status: 200 });
    }
    if (method === 'DELETE' && q.has('uploadId')) { b2Multipart.delete(q.get('uploadId')); return new Response('', { status: 204 }); }
    if (method === 'PUT') { b2Store.set(key, { body: Buffer.from(opts.body), contentType: opts.headers['content-type'] }); return new Response('', { status: 200 }); }
    if (method === 'DELETE') { b2Store.delete(key); return new Response('', { status: 204 }); }
    const obj = b2Store.get(key);
    if (method === 'HEAD') return obj ? new Response(null, { status: 200, headers: { 'content-length': String(obj.body.length), 'content-type': obj.contentType } }) : new Response(null, { status: 404 });
    return obj ? new Response(obj.body, { status: 200, headers: { 'content-type': obj.contentType } }) : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
  }
  if (u === 'https://api.groq.com/openai/v1/audio/transcriptions') {
    const form = opts.body;
    groqCalls.push({ model: form.get('model'), language: form.get('language'), file: form.get('file'), auth: opts.headers.Authorization });
    if (groqFail) return Response.json({ error: { message: 'modelo indisponível' } }, { status: 503 });
    return Response.json({ text: 'texto transcrito de teste' });
  }
  if (u.startsWith('https://api.upload-post.com/')) {
    const method = opts.method || 'GET';
    const rec = { method, url: u, auth: opts.headers?.Authorization, idempotency: opts.headers?.['Idempotency-Key'] };
    if (method === 'POST' && opts.body && typeof opts.body.entries === 'function') { rec.fields = [...opts.body.entries()].map(([k, v]) => [k, String(v)]); }
    if (method === 'POST' && typeof opts.body === 'string') rec.json = JSON.parse(opts.body);
    uploadPostCalls.push(rec);
    if (rec.auth !== 'Apikey test-upload-post-key') return Response.json({ success: false, message: 'Invalid or expired token' }, { status: 401 });
    if (method === 'GET' && u.includes('/api/uploadposts/users')) return Response.json({ success: true, profiles: [{ username: 'default', social_accounts: uploadPostState.accounts }] });
    if (method === 'GET' && u.includes('/api/uploadposts/status')) return Response.json({ request_id: new URL(u).searchParams.get('request_id'), ...uploadPostState.status });
    const qs = new URL(u).searchParams;
    if (method === 'GET' && u.includes('/api/analytics/')) return Response.json(uploadPostState.analytics);
    if (method === 'GET' && u.includes('/api/uploadposts/media')) return Response.json({ success: true, media: uploadPostState.media });
    if (method === 'GET' && u.includes('/api/uploadposts/comments')) return Response.json({ success: true, comments: uploadPostState.comments[qs.get('post_id') || qs.get('post_url')] || [] });
    if (method === 'GET' && u.includes('/api/uploadposts/dms/conversations')) return Response.json({ success: true, conversations: uploadPostState.conversations });
    if (method === 'POST' && /\/api\/uploadposts\/(comments\/create|comments\/reply|dms\/send|posts\/edit)$/.test(u)) return Response.json({ success: true, id: 'novo', message_id: 'msg' });
    if (method === 'POST' && u.endsWith('/api/upload_photos')) return Response.json({ success: true, request_id: Object.fromEntries(rec.fields).request_id });
    if (method === 'POST' && u.endsWith('/api/upload')) {
      if (uploadPostState.failUpload) return Response.json({ success: false, message: uploadPostState.failUpload }, { status: 400 });
      return Response.json({ success: true, message: 'Upload initiated successfully in background.', request_id: Object.fromEntries(rec.fields).request_id, total_platforms: rec.fields.filter(([k]) => k === 'platform[]').length });
    }
    return Response.json({ success: false }, { status: 404 });
  }
  if (BLOCKED.test(u)) throw new Error(`Rede externa bloqueada nos testes: ${u}`); // nada de Backblaze/Groq reais na suíte
  return fetchYourlsOrReal(url, opts);
};

async function fetchYourlsOrReal(url, opts) {
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
  // Em agendamento/Agendado exigem foto: nos testes todo convidado nasce com uma (os testes da regra apagam a foto).
  await db.query("ALTER TABLE guests ALTER COLUMN photo_key SET DEFAULT 'teste/foto-convidado.jpg'");
  mailer.outbox.length = 0;
  b2Store.clear();
  b2Multipart.clear();
  b2Calls.length = 0;
  groqCalls.length = 0;
  groqFail = false;
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
    cookie: () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
    async req(method, path, { form, headers = {}, ua } = {}) {
      const h = { ...headers, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), 'user-agent': ua || 'Mozilla/5.0 (test)' };
      let body;
      // listas viram campos repetidos (como checkboxes com o mesmo nome)
      if (form) { body = new URLSearchParams(Object.entries(form).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
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

module.exports = { uploadPostCalls, uploadPostState, b2Store, b2Cors, b2Calls, b2Multipart, groqCalls, setGroqFail: (v) => { groqFail = v; }, setB2Full: (v) => { b2Full = v; }, db, config, mailer, resetDb, createUser, startServer, client, yourlsCalls, setCollisions: (n) => { collideNext = n; } };
