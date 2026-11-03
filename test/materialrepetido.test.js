const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const previews = require('../src/services/previews');

describe('material: repetidos, envios parados, armazenamento cheio e galeria', () => {
  const as = {}; const u = {}; let app; let epId;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['prod', 'produtora'], ['gestao', 'gestao'], ['editor', 'editor_video']]) { u[k] = await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    epId = (await q("INSERT INTO episodes (number, title, status) VALUES (9, 'Episódio repetidos', 'gravado') RETURNING id"))[0].id;
    h.config.previewDir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pulso-previas-')); // miniaturas do teste num lugar descartável
  });
  after(async () => { h.setB2Full(false); await app.close(); await h.db.close(); });

  async function api(client, method, path, { json, raw } = {}) {
    const token = await client.csrf('/episodios');
    const headers = { cookie: client.cookie(), accept: 'application/json', 'x-csrf-token': token };
    let body;
    if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); } else if (raw) { headers['content-type'] = 'application/octet-stream'; body = raw; }
    const res = await fetch(`${app.base}${path}`, { method, headers, body, redirect: 'manual' });
    const text = await res.text(); let parsed = null; try { parsed = JSON.parse(text); } catch { /* não é JSON */ }
    return { status: res.status, json: parsed, text, location: res.headers.get('location') };
  }
  const init = (name, size, extra = {}) => api(as.prod, 'POST', `/episodios/${epId}/arquivos/iniciar`, { json: { kind: 'bastidor', nome: name, tamanho: size, tipo: 'video/mp4', ...extra } });
  const part = (id, n, buf) => api(as.prod, 'PUT', `/episodios/${epId}/arquivos/${id}/parte/${n}`, { raw: buf });
  const finish = (id) => api(as.prod, 'POST', `/episodios/${epId}/arquivos/${id}/concluir`);
  async function send(name, data, extra = {}) {
    const r = await init(name, data.length, extra); assert.equal(r.status, 200, r.text);
    for (let n = 1; n <= r.json.totalParts; n += 1) assert.equal((await part(r.json.id, n, data.subarray((n - 1) * r.json.partSize, n * r.json.partSize))).status, 200);
    assert.equal((await finish(r.json.id)).status, 200);
    return r.json.id;
  }

  it('armazenamento cheio: o servidor responde 507 com a explicação, não 500, e avisa a gestão uma vez por dia', async () => {
    const r = await init('cheio.mp4', 4096); assert.equal(r.status, 200);
    h.setB2Full(true);
    try {
      const p1 = await part(r.json.id, 1, Buffer.alloc(4096, 1));
      assert.equal(p1.status, 507); assert.equal(p1.json.code, 'storage_full');
      assert.match(p1.json.error, /limite da conta[\s\S]*Caps & Alerts[\s\S]*continua de onde parou/);
      await part(r.json.id, 1, Buffer.alloc(4096, 1));
      const notes = await q("SELECT user_id, title FROM notifications WHERE title LIKE 'Armazenamento cheio%'");
      assert.deepEqual(notes.map((n) => String(n.user_id)), [String(u.gestao.id)], 'a gestão recebe um aviso só, mesmo com várias recusas');
    } finally { h.setB2Full(false); }
    await api(as.prod, 'POST', `/episodios/${epId}/arquivos/${r.json.id}/cancelar`);
  });

  it('existentes: lista o material bruto com o que parou no meio; partes informam tamanho para retomar', async () => {
    const okId = await send('camera.mp4', Buffer.alloc(3000, 2));
    const r = await init('parado.mp4', 6000); const stuck = r.json.id;
    await part(stuck, 1, Buffer.alloc(r.json.partSize > 6000 ? 6000 : r.json.partSize, 4));
    await q("UPDATE episode_files SET created_at = now() - interval '2 hours', last_part_at = now() - interval '2 hours' WHERE id = $1", [stuck]);
    const ex = await api(as.prod, 'GET', `/episodios/${epId}/arquivos/existentes`);
    assert.equal(ex.status, 200);
    const byName = Object.fromEntries(ex.json.files.map((f) => [f.name, f]));
    assert.equal(byName['camera.mp4'].status, 'pronto'); assert.equal(byName['camera.mp4'].stalled, false); assert.equal(byName['camera.mp4'].id, okId);
    assert.equal(byName['parado.mp4'].stalled, true); assert.equal(byName['parado.mp4'].parts, 1); assert.equal(byName['parado.mp4'].size, 6000);
    const pts = await api(as.prod, 'GET', `/episodios/${epId}/arquivos/${stuck}/partes`);
    assert.deepEqual([pts.json.size, pts.json.parts, pts.json.status], [6000, [1], 'enviando']); assert.ok(pts.json.partSize && pts.json.totalParts);
    assert.equal((await api(as.editor, 'GET', `/episodios/${epId}/arquivos/existentes`)).status, 200, 'o editor também envia (vídeo editado), a rota deixa entrar');
    // a página mostra "não terminou", o aviso que ensina a retomar e a pasta com a contagem
    const page = (await as.prod.get(`/episodios/${epId}`)).text;
    assert.match(page, /<span class="badge b-red"[^>]*>não terminou<\/span>/); assert.match(page, /1 arquivo não terminou de subir/);
    assert.match(page, /reconhece pelo nome e continua de onde parou/); assert.match(page, /descartar-parados/);
    assert.match(page, /<span class="badge b-red">1 não terminou<\/span>/);
  });

  it('retomar: as partes que faltam completam o mesmo arquivo, sem recomeçar', async () => {
    const [f] = await q("SELECT * FROM episode_files WHERE filename = 'parado.mp4'");
    const pts = await api(as.prod, 'GET', `/episodios/${epId}/arquivos/${f.id}/partes`);
    for (let n = 1; n <= pts.json.totalParts; n += 1) if (!pts.json.parts.includes(n)) assert.equal((await part(f.id, n, Buffer.alloc(Math.min(pts.json.partSize, 6000 - (n - 1) * pts.json.partSize), 4))).status, 200);
    assert.equal((await finish(f.id)).status, 200);
    assert.equal((await q('SELECT status FROM episode_files WHERE id = $1', [f.id]))[0].status, 'pronto');
  });

  it('substituir: o antigo só sai quando o novo termina; envio parado com o mesmo nome sai na hora', async () => {
    const [old] = await q("SELECT * FROM episode_files WHERE filename = 'camera.mp4'");
    const r = await init('camera.mp4', 5000, { substituir: old.id });
    assert.equal((await q('SELECT 1 FROM episode_files WHERE id = $1', [old.id])).length, 1, 'enquanto o novo sobe, o antigo continua');
    assert.equal((await q('SELECT replaces_id FROM episode_files WHERE id = $1', [r.json.id]))[0].replaces_id, old.id);
    for (let n = 1; n <= r.json.totalParts; n += 1) await part(r.json.id, n, Buffer.alloc(Math.min(r.json.partSize, 5000 - (n - 1) * r.json.partSize), 7));
    assert.equal((await finish(r.json.id)).status, 200);
    assert.equal((await q('SELECT 1 FROM episode_files WHERE id = $1', [old.id])).length, 0, 'terminou: o antigo saiu');
    assert.equal((await q("SELECT count(*)::int n FROM episode_files WHERE filename = 'camera.mp4' AND episode_id = $1", [epId]))[0].n, 1);
    assert.ok(h.b2Store.has((await q('SELECT storage_key FROM episode_files WHERE id = $1', [r.json.id]))[0].storage_key));
    assert.equal(h.b2Store.has(old.storage_key), false, 'o arquivo antigo saiu do armazenamento');
    const ev = (await q("SELECT message FROM episode_events WHERE episode_id = $1 AND type = 'arquivo'", [epId])).map((e) => e.message);
    assert.ok(ev.includes('Arquivo substituído: camera.mp4'), ev.join(' | '));
    // envio parado + substituir = cancela o parado na hora
    const half = await init('meio.mp4', 3000);
    const again = await init('meio.mp4', 3500, { substituir: half.json.id });
    assert.equal(again.status, 200);
    assert.equal((await q('SELECT 1 FROM episode_files WHERE id = $1', [half.json.id])).length, 0);
    await api(as.prod, 'POST', `/episodios/${epId}/arquivos/${again.json.id}/cancelar`);
    // não substitui arquivo de outro episódio nem o vídeo editado
    const [ep2] = await q("INSERT INTO episodes (title) VALUES ('Outro') RETURNING id");
    const [alien] = await q("INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, status) VALUES ($1, 'bastidor', 'x.mp4', 10, 'k/x', 'pronto') RETURNING id", [ep2.id]);
    const r3 = await init('x.mp4', 100, { substituir: alien.id });
    assert.equal((await q('SELECT replaces_id FROM episode_files WHERE id = $1', [r3.json.id]))[0].replaces_id, null);
    await api(as.prod, 'POST', `/episodios/${epId}/arquivos/${r3.json.id}/cancelar`);
  });

  it('descartar os envios parados libera o espaço; os completos e os que estão subindo agora ficam', async () => {
    const a = await init('velho.mp4', 2000); const b = await init('agora.mp4', 2000);
    await q("UPDATE episode_files SET created_at = now() - interval '3 hours' WHERE id = $1", [a.json.id]);
    const r = await as.prod.act(`/episodios/${epId}/arquivos/descartar-parados`, {}, { from: `/episodios/${epId}` });
    assert.equal(r.status, 302);
    assert.equal((await q('SELECT 1 FROM episode_files WHERE id = $1', [a.json.id])).length, 0);
    assert.equal((await q('SELECT 1 FROM episode_files WHERE id = $1', [b.json.id])).length, 1, 'quem está subindo agora não é descartado');
    assert.equal((await q("SELECT count(*)::int n FROM episode_files WHERE episode_id = $1 AND status = 'pronto'", [epId]))[0].n >= 2, true);
    assert.equal((await as.editor.act(`/episodios/${epId}/arquivos/descartar-parados`, {}, { from: `/episodios/${epId}` })).status, 403, 'o editor não descarta material bruto');
    await api(as.prod, 'POST', `/episodios/${epId}/arquivos/${b.json.id}/cancelar`);
  });

  it('galeria: rotação da câmera, tipos de arquivo e miniatura de foto gerada uma vez e guardada', async () => {
    assert.equal(previews.mediaType({ filename: 'a.JPG' }), 'image'); assert.equal(previews.mediaType({ filename: 'a.mov' }), 'video');
    assert.equal(previews.mediaType({ filename: 'a.wav' }), 'audio'); assert.equal(previews.mediaType({ filename: 'a.heic' }), 'image'); assert.equal(previews.mediaType({ filename: 'a.r3d' }), 'file');
    assert.equal(previews.mediaType({ filename: 'final.bin', kind: 'editado' }), 'video');
    // EXIF com Orientation = 6 (girar 90°)
    const exif = Buffer.from([0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xDA]);
    assert.equal(previews.jpegOrientation(exif), 6); assert.equal(previews.jpegOrientation(Buffer.from([1, 2, 3])), 1);
    const { createCanvas } = require('@napi-rs/canvas');
    const c = createCanvas(1200, 600); c.getContext('2d').fillRect(0, 0, 1200, 600);
    const jpg = await c.encode('jpeg', 80);
    const turned = await previews.shrink(jpg, 480, 6);
    const { loadImage } = require('@napi-rs/canvas'); const img = await loadImage(turned);
    assert.deepEqual([img.width, img.height], [240, 480], 'deitada na câmera, em pé na miniatura');
    // arquivo antigo (sem miniatura): o servidor baixa a foto UMA vez, faz os dois tamanhos e guarda no disco, não no bucket
    const photoId = await send('foto1.jpg', jpg, { kind: 'foto' });
    const [ph] = await q('SELECT * FROM episode_files WHERE id = $1', [photoId]);
    const gets = () => h.b2Calls.filter((c) => c.method === 'GET' && c.key === ph.storage_key).length;
    const before = gets(); const putsBefore = h.b2Calls.filter((c) => c.method === 'PUT').length;
    const first = await fetch(`${app.base}/episodios/${epId}/arquivos/${photoId}/previa`, { headers: { cookie: as.gestao.cookie() } });
    assert.equal(first.status, 200); assert.equal(first.headers.get('content-type'), 'image/jpeg');
    assert.match(first.headers.get('cache-control'), /immutable/, 'o navegador guarda para sempre');
    assert.equal((await fetch(`${app.base}/episodios/${epId}/arquivos/${photoId}/previa?t=p`, { headers: { cookie: as.gestao.cookie() } })).status, 200);
    for (let i = 0; i < 3; i += 1) await fetch(`${app.base}/episodios/${epId}/arquivos/${photoId}/previa`, { headers: { cookie: as.gestao.cookie() } });
    assert.equal(gets() - before, 1, 'a foto original foi baixada uma vez só, para os dois tamanhos e todas as visitas');
    assert.equal(h.b2Calls.filter((c) => c.method === 'PUT').length, putsBefore, 'nada de miniatura no Backblaze');
    assert.ok(previews.stored(ph, 't') && previews.stored(ph, 'p'));
    assert.equal((await fetch(`${app.base}/episodios/${epId}/arquivos/999999/previa`, { headers: { cookie: as.gestao.cookie() } })).status, 404);
    // remover a foto apaga as miniaturas do disco
    await as.prod.act(`/episodios/${epId}/arquivos/${photoId}/excluir`, {}, { from: `/episodios/${epId}` });
    await h.emptyTrash(); // na lixeira a miniatura fica (a foto pode voltar)
    assert.equal(previews.stored(ph, 't'), null); assert.equal(previews.stored(ph, 'p'), null);
  });

  it('miniatura feita pelo navegador no envio: o servidor confere, regrava limpa e não baixa nada do Backblaze', async () => {
    const { createCanvas } = require('@napi-rs/canvas');
    const big = createCanvas(2400, 1600); big.getContext('2d').fillRect(0, 0, 2400, 1600);
    const photoId = await send('foto9.jpg', await big.encode('jpeg', 80), { kind: 'foto' });
    const [ph] = await q('SELECT * FROM episode_files WHERE id = $1', [photoId]);
    const small = createCanvas(480, 320); small.getContext('2d').fillRect(0, 0, 480, 320);
    const before = h.b2Calls.filter((c) => c.method === 'GET' && c.key === ph.storage_key).length;
    const post = (who, size, body) => fetch(`${app.base}/episodios/${epId}/arquivos/${photoId}/previa?t=${size}`, { method: 'POST', headers: { cookie: as[who].cookie(), 'content-type': 'image/jpeg', accept: 'application/json', 'x-csrf-token': '' }, body });
    const withCsrf = async (who, size, body) => fetch(`${app.base}/episodios/${epId}/arquivos/${photoId}/previa?t=${size}`, { method: 'POST', headers: { cookie: as[who].cookie(), 'content-type': 'image/jpeg', accept: 'application/json', 'x-csrf-token': await as[who].csrf('/episodios') }, body });
    assert.equal((await post('prod', 't', await small.encode('jpeg', 80))).status, 403, 'sem o token de segurança, recusa');
    assert.equal((await withCsrf('prod', 't', await small.encode('jpeg', 80))).status, 200);
    assert.equal((await withCsrf('prod', 't', Buffer.from('<script>não é imagem</script>'))).status, 400);
    assert.equal((await withCsrf('editor', 't', await small.encode('jpeg', 80))).status, 404, 'quem não envia material bruto não troca a miniatura');
    // grande demais para o tamanho pedido: o servidor reduz
    assert.equal((await withCsrf('prod', 'p', await big.encode('jpeg', 80))).status, 200);
    const { loadImage } = require('@napi-rs/canvas');
    const p = await loadImage(require('fs').readFileSync(previews.stored(ph, 'p')));
    assert.equal(Math.max(p.width, p.height), 1600);
    const shown = await fetch(`${app.base}/episodios/${epId}/arquivos/${photoId}/previa`, { headers: { cookie: as.editor.cookie() } });
    assert.equal(shown.status, 200);
    assert.equal(h.b2Calls.filter((c) => c.method === 'GET' && c.key === ph.storage_key).length, before, 'a galeria usa o que o navegador mandou: zero download');
  });

  it('galeria na página: botão, pastas com os arquivos prontos e os endereços de prévia, sem script inline', async () => {
    await send('foto2.jpg', Buffer.alloc(500, 9), { kind: 'foto' });
    const page = (await as.editor.get(`/episodios/${epId}`)).text;
    assert.match(page, /data-gallery-open aria-label="Abrir a galeria/); assert.match(page, /id="modal-galeria"/);
    const json = JSON.parse(page.match(/<script type="application\/json" data-g-data>([\s\S]*?)<\/script>/)[1]);
    const fotos = json.find((f) => f.key === 'foto'); const bts = json.find((f) => f.key === 'bastidor');
    assert.ok(fotos.items.some((i) => i.name === 'foto2.jpg' && i.type === 'image' && /\/previa$/.test(i.thumb) && /\/previa\?t=p$/.test(i.big)));
    assert.ok(bts.items.every((i) => i.type === 'video'));
    assert.ok(!json.some((f) => f.items.some((i) => i.name === 'agora.mp4')), 'o que não terminou de subir não entra na galeria');
  });
});
