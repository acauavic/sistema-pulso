const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const h = require('./helpers');
const config = require('../src/config');
const b2 = require('../src/services/b2');

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

// O vídeo "pilar" do episódio (o editado) só pode ser horizontal. O servidor lê o arquivo já no bucket (ffprobe) e recusa os outros formatos.
describe('formato do vídeo editado do episódio', { skip: !hasFfmpeg && 'precisa de ffmpeg' }, () => {
  let app; let gestao; let editor; let tmp; let srv; let srvBase; let ep;
  const videos = {};
  const realPresign = b2.presignGet;

  const mk = (name, size) => {
    const file = path.join(tmp, name);
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30:duration=3`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
    assert.equal(r.status, 0, String(r.stderr));
    videos[name] = fs.readFileSync(file);
  };
  const call = async (c, method, p, { json, raw } = {}) => {
    const token = await c.csrf('/episodios');
    const headers = { cookie: c.cookie(), accept: 'application/json', 'x-csrf-token': token };
    let body;
    if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); } else if (raw) { headers['content-type'] = 'application/octet-stream'; body = raw; }
    const r = await fetch(`${app.base}${p}`, { method, headers, body });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* html */ }
    return { status: r.status, json: j };
  };
  const uploadEdited = async (name) => {
    const data = videos[name];
    const init = await call(editor, 'POST', `/episodios/${ep}/arquivos/iniciar`, { json: { kind: 'editado', nome: name, tamanho: data.length, tipo: 'video/mp4' } });
    assert.equal(init.status, 200);
    const { id, partSize, totalParts } = init.json;
    for (let n = 1; n <= totalParts; n += 1) assert.equal((await call(editor, 'PUT', `/episodios/${ep}/arquivos/${id}/parte/${n}`, { raw: data.subarray((n - 1) * partSize, Math.min(data.length, n * partSize)) })).status, 200);
    return { id, done: await call(editor, 'POST', `/episodios/${ep}/arquivos/${id}/concluir`) };
  };

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    await h.createUser({ name: 'G', email: 'g@t.com', role: 'gestao' });
    await h.createUser({ name: 'E', email: 'e@t.com', role: 'editor_video' });
    gestao = h.client(app.base); await gestao.login('g@t.com');
    editor = h.client(app.base); await editor.login('e@t.com');
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fmt-test-'));
    mk('horizontal.mp4', '640x360'); mk('vertical.mp4', '360x640'); mk('quadrado.mp4', '480x480');
    videos['quebrado.mp4'] = Buffer.from('isto não é um vídeo'.repeat(400));
    srv = http.createServer((req, res) => {
      const obj = h.b2Store.get(decodeURIComponent(req.url.replace('/obj/', '')));
      if (!obj) { res.writeHead(404); res.end(); return; }
      const buf = obj.body; const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      if (m) { const a = Number(m[1]); const z = m[2] ? Number(m[2]) : buf.length - 1; res.writeHead(206, { 'content-range': `bytes ${a}-${z}/${buf.length}`, 'content-length': z - a + 1, 'accept-ranges': 'bytes' }); res.end(buf.subarray(a, z + 1)); } else { res.writeHead(200, { 'content-length': buf.length, 'accept-ranges': 'bytes' }); res.end(buf); }
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    srvBase = `http://127.0.0.1:${srv.address().port}`;
    b2.presignGet = async (key, o) => (/editado-/.test(key) ? `${srvBase}/obj/${encodeURIComponent(key)}` : realPresign(key, o));
    config.checkVideoFormat = true;
    ep = (await h.db.query("INSERT INTO episodes (number, title, status, editor_id) VALUES (1, 'Episódio', 'em_edicao', NULL) RETURNING id")).rows[0].id;
  });
  after(async () => { config.checkVideoFormat = false; b2.presignGet = realPresign; srv?.close(); fs.rmSync(tmp, { recursive: true, force: true }); await app.close(); await h.db.close(); });

  it('vídeo horizontal é aceito', async () => {
    const r = await uploadEdited('horizontal.mp4');
    assert.equal(r.done.status, 200, JSON.stringify(r.done.json));
    assert.equal((await h.db.query("SELECT status FROM episode_files WHERE id=$1", [r.id])).rows[0].status, 'pronto');
  });

  it('vídeo vertical e quadrado são recusados com a explicação e saem do bucket', async () => {
    for (const [name, word] of [['vertical.mp4', /vertical \(360×640\)/], ['quadrado.mp4', /quadrado \(480×480\)/]]) {
      const r = await uploadEdited(name);
      assert.equal(r.done.status, 422, name);
      assert.match(r.done.json.error, /precisa ser horizontal/);
      assert.match(r.done.json.error, word);
      assert.match(r.done.json.error, /Conteúdo/, 'diz onde ficam os cortes verticais');
      assert.equal((await h.db.query('SELECT count(*)::int n FROM episode_files WHERE id=$1', [r.id])).rows[0].n, 0, 'registro removido');
    }
    assert.equal([...h.b2Store.keys()].filter((k) => /editado-/.test(k)).length, 1, 'só o horizontal ficou no bucket');
  });

  it('arquivo que não abre como vídeo é recusado', async () => {
    const r = await uploadEdited('quebrado.mp4');
    assert.equal(r.done.status, 422); assert.match(r.done.json.error, /Não consegui ler este vídeo/);
  });

  it('o evento "arquivo enviado" só entra no histórico para o vídeo aceito', async () => {
    const { rows } = await h.db.query("SELECT message FROM episode_events WHERE episode_id=$1 AND type='arquivo'", [ep]);
    assert.equal(rows.length, 1);
    assert.match(rows[0].message, /horizontal\.mp4/);
  });

  it('a conferência pode ser desligada (VIDEO_FORMAT_CHECK=false) e o material bruto nunca é conferido', async () => {
    config.checkVideoFormat = false;
    const ok = await uploadEdited('vertical.mp4');
    assert.equal(ok.done.status, 200);
    config.checkVideoFormat = true;
    const data = videos['vertical.mp4'];
    const init = await call(gestao, 'POST', `/episodios/${ep}/arquivos/iniciar`, { json: { kind: 'bruto_video', nome: 'cam.mp4', tamanho: data.length, tipo: 'video/mp4' } });
    const { id, partSize, totalParts } = init.json;
    for (let n = 1; n <= totalParts; n += 1) await call(gestao, 'PUT', `/episodios/${ep}/arquivos/${id}/parte/${n}`, { raw: data.subarray((n - 1) * partSize, Math.min(data.length, n * partSize)) });
    assert.equal((await call(gestao, 'POST', `/episodios/${ep}/arquivos/${id}/concluir`)).status, 200, 'câmera vertical no bruto não é problema');
  });
});
