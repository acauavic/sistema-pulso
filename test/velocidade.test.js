const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const h = require('./helpers');
const b2 = require('../src/services/b2');

// Imagem pequena de verdade (PNG 40x30) para converter.
async function png() {
  const { createCanvas } = require('@napi-rs/canvas');
  const c = createCanvas(40, 30); const x = c.getContext('2d'); x.fillStyle = '#c8ff42'; x.fillRect(0, 0, 40, 30);
  return c.encode('png');
}

describe('velocidade: WebP para ver, compressão, cache, medição e paginação', () => {
  const as = {}; let app; let guestId;

  before(async () => {
    h.config.previewDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-webp-')); // WebP do teste num lugar descartável
    await h.resetDb(); app = await h.startServer();
    await h.createUser({ name: 'Admin', email: 'admin@t.com', role: 'superadmin' });
    as.admin = h.client(app.base); await as.admin.login('admin@t.com');
    const key = 'pp/convidados/1/foto-teste.png'; // prefixo do bucket de teste
    await b2.putObject(key, await png(), 'image/png');
    ({ rows: [{ id: guestId }] } = await h.db.query("INSERT INTO guests (name, profile, status, photo_key) VALUES ('Dra. Foto', 'medico', 'prospect', $1) RETURNING id", [key]));
  });
  after(async () => { await app.close(); await h.db.close(); });

  const raw = (p, headers = {}) => fetch(`${app.base}${p}`, { headers: { cookie: as.admin.cookie(), ...headers } });

  it('foto para ver sai em WebP para quem aceita; quem não aceita (robô do og:image) recebe o original', async () => {
    const webp = await raw(`/convidados/${guestId}/foto`, { accept: 'image/avif,image/webp,*/*' });
    assert.equal(webp.status, 200);
    assert.equal(webp.headers.get('content-type'), 'image/webp');
    assert.match(webp.headers.get('vary') || '', /Accept/);
    const body = Buffer.from(await webp.arrayBuffer());
    assert.equal(body.slice(0, 4).toString(), 'RIFF'); assert.equal(body.slice(8, 12).toString(), 'WEBP');
    const calls = h.b2Calls.length;
    await (await raw(`/convidados/${guestId}/foto`, { accept: 'image/webp' })).arrayBuffer();
    assert.equal(h.b2Calls.length, calls, 'a segunda visita sai do disco do servidor, sem baixar do bucket');
    const orig = await raw(`/convidados/${guestId}/foto`, { accept: '*/*' });
    assert.equal(orig.headers.get('content-type'), 'image/png', 'sem WebP no Accept: o original');
  });

  it('arquivos estáticos: Brotli (ou gzip) já comprimidos e cache de 1 ano quando o endereço tem a versão', async () => {
    const file = fs.readFileSync(path.join(__dirname, '../src/public/app.css'));
    const br = await fetch(`${app.base}/static/app.css?v=abc`, { headers: { 'accept-encoding': 'br, gzip' } });
    assert.equal(br.headers.get('content-encoding'), 'br');
    assert.match(br.headers.get('cache-control'), /max-age=31536000, immutable/);
    // fetch do Node descomprime sozinho: o conteúdo tem que ser o arquivo
    assert.equal(Buffer.from(await br.arrayBuffer()).length, file.length);
    const gz = await fetch(`${app.base}/static/app.css`, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(gz.headers.get('content-encoding'), 'gzip');
    assert.match(gz.headers.get('cache-control'), /max-age=3600/, 'sem versão: 1 hora');
    const font = await fetch(`${app.base}/static/fonts/inter-latin-400-normal.woff2`);
    assert.match(font.headers.get('cache-control'), /max-age=2592000/, 'fonte: 30 dias');
    assert.equal(zlib.brotliDecompressSync(zlib.brotliCompressSync(file)).length, file.length);
    const trav = await fetch(`${app.base}/static/..%2f..%2fpackage.json`, { headers: { 'accept-encoding': 'br' } });
    assert.notEqual(trav.status, 200, 'não sai da pasta de estáticos');
  });

  it('cada resposta conta o tempo (Server-Timing) e a lenta fica registrada com o tempo de banco', async () => {
    const r = await raw('/');
    assert.match(r.headers.get('server-timing') || '', /app;dur=[\d.]+, db;dur=[\d.]+;desc="\d+ consultas"/);
    const perf = require('../src/services/perf');
    const { rows: [before] } = await h.db.query('SELECT count(*)::int AS n FROM slow_requests');
    // uma requisição lenta de propósito (pg_sleep conta como banco)
    const express = require('express');
    const mini = express();
    mini.use(perf.middleware); mini.use(require('../src/utils/requestCache').middleware);
    mini.get('/lenta', async (req, res) => { await h.db.query('SELECT pg_sleep($1)', [perf.SLOW_MS / 1000 + 0.05]); res.send('ok'); });
    const srv = mini.listen(0); const port = srv.address().port;
    await (await fetch(`http://127.0.0.1:${port}/lenta`)).text();
    await new Promise((r2) => setTimeout(r2, 150));
    srv.close();
    const { rows } = await h.db.query('SELECT * FROM slow_requests ORDER BY id DESC LIMIT 1');
    assert.equal((await h.db.query('SELECT count(*)::int AS n FROM slow_requests')).rows[0].n, before.n + 1);
    assert.equal(rows[0].route, '/lenta'); assert.ok(rows[0].ms >= perf.SLOW_MS); assert.ok(rows[0].db_ms >= perf.SLOW_MS, 'o tempo de banco aparece');
    assert.equal(rows[0].db_count, 1);
  });

  it('velocidade real: o navegador manda as medições, a página de desempenho mostra por página', async () => {
    const token = await as.admin.csrf('/');
    const send = (body) => fetch(`${app.base}/metricas/vitals`, { method: 'POST', headers: { cookie: as.admin.cookie(), 'content-type': 'application/json' }, body: JSON.stringify({ _csrf: token, ...body }) });
    assert.equal((await send({ page: '/convidados/12', device: 'celular', metrics: [{ name: 'LCP', value: 1800 }, { name: 'INP', value: 650 }, { name: 'CLS', value: 0.02 }, { name: 'TTFB', value: 300 }, { name: 'XYZ', value: 1 }] })).status, 204);
    assert.equal((await send({ metrics: [{ name: 'LCP', value: 1 }] })).status, 204);
    const { rows } = await h.db.query("SELECT metric, page, device FROM web_vitals WHERE page = '/convidados/:id' ORDER BY metric");
    assert.deepEqual(rows.map((r) => r.metric), ['CLS', 'INP', 'LCP', 'TTFB'], 'métrica desconhecida fica de fora; a página vira o padrão /convidados/:id');
    assert.equal(rows[0].device, 'celular');
    const noToken = await fetch(`${app.base}/metricas/vitals`, { method: 'POST', headers: { cookie: as.admin.cookie(), 'content-type': 'application/json' }, body: JSON.stringify({ metrics: [] }) });
    assert.equal(noToken.status, 403, 'sem o token de segurança não grava');
    const page = (await as.admin.get('/gestao/desempenho')).text;
    assert.match(page, /\/convidados\/:id/); assert.match(page, /Velocidade real/); assert.match(page, /Requisições lentas/);
    assert.match(page, /badge b-red">650 ms/, 'INP de 650 ms é lento (vermelho)');
    assert.match(page, /badge b-gray">1,8 s/, 'LCP de 1,8 s é bom (neutro, nunca lime)');
    assert.match((await as.admin.get('/')).text, /\/static\/vitals\.js/);
  });

  it('auditoria e notificações paginam (antes, só os mais recentes apareciam)', async () => {
    await h.db.query("INSERT INTO audit_log (action, entity) SELECT 'teste.' || g, 'system' FROM generate_series(1, 130) g");
    const p1 = (await as.admin.get('/auditoria')).text;
    assert.match(p1, /Mais antigos/); assert.doesNotMatch(p1, /Mais recentes/);
    const p2 = (await as.admin.get('/auditoria?pagina=2')).text;
    assert.match(p2, /Mais recentes/); assert.match(p2, /Página 2/);
    assert.match(p2, /teste\.1\b/, 'o mais antigo está na segunda página');
  });

  it('assistente: o script só baixa quando a pessoa abre', async () => {
    const html = (await as.admin.get('/')).text;
    assert.match(html, /data-assist-src="\/static\/assistant\.js/);
    assert.doesNotMatch(html, /<script src="\/static\/assistant\.js/);
  });
});
