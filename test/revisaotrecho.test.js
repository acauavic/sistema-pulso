const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('Revisão do vídeo: comentário em um trecho', () => {
  let app; let gestao; let ep; let file;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const comment = async (form) => {
    const csrf = await gestao.csrf(`/episodios/${ep}`);
    const r = await fetch(`${app.base}/episodios/${ep}/comentarios`, { method: 'POST', headers: { cookie: gestao.cookie(), accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': csrf }, body: new URLSearchParams({ body: 'Ajustar', file_id: String(file), ...form }) });
    return { status: r.status, json: await r.json() };
  };

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    const u = await h.createUser({ name: 'Gil', email: 'g@tr.com', role: 'gestao' }); gestao = h.client(app.base); await gestao.login('g@tr.com');
    [{ id: ep }] = await q("INSERT INTO episodes (number, title, status) VALUES (9, 'Ep', 'em_revisao') RETURNING id");
    [{ id: file }] = await q("INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, status, version, uploaded_by) VALUES ($1,'editado','v1.mp4',1000,'pp/v1','pronto',1,$2) RETURNING id", [ep, u.id]);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('a tela oferece marcar o trecho', async () => {
    const page = (await gestao.get(`/episodios/${ep}`)).text;
    assert.match(page, /data-range-mark/); assert.match(page, /Marcar início do trecho/); assert.match(page, /I O marcam início e fim do trecho/);
  });

  it('comentário com início e fim guarda o trecho, mostra os dois tempos e toca aquele pedaço', async () => {
    const r = await comment({ at_ms: '92000', end_ms: '100500' });
    assert.equal(r.status, 200);
    assert.equal(r.json.comment.end_ms, 100500); assert.equal(r.json.comment.clock, '1:32 – 1:40');
    assert.match(r.json.html, /data-at="92000" data-end="100500"/);
    assert.match(r.json.html, /data-seek="92000" data-seek-end="100500"/);
    assert.match(r.json.html, /1:32 – 1:40/);
    assert.equal((await q('SELECT end_ms FROM episode_comments WHERE id = $1', [r.json.id]))[0].end_ms, 100500);
    assert.match((await q("SELECT message FROM episode_events WHERE type = 'comentario' ORDER BY id DESC LIMIT 1"))[0].message, /em 1:32 – 1:40:/);
  });

  it('continua aceitando comentário num ponto e geral', async () => {
    const point = await comment({ at_ms: '5000', end_ms: '' });
    assert.equal(point.status, 200); assert.equal(point.json.comment.end_ms, null); assert.equal(point.json.comment.clock, '0:05');
    assert.doesNotMatch(point.json.html, /data-seek-end/);
    const general = await comment({ at_ms: '', end_ms: '' });
    assert.equal(general.status, 200); assert.equal(general.json.comment.at_ms, null);
  });

  it('trecho impossível é recusado', async () => {
    assert.equal((await comment({ at_ms: '5000', end_ms: '5000' })).status, 400);
    assert.equal((await comment({ at_ms: '5000', end_ms: '3000' })).status, 400);
    assert.equal((await comment({ at_ms: '', end_ms: '3000' })).status, 400);
    assert.equal((await comment({ at_ms: '5000', end_ms: 'abc' })).status, 400);
  });

  it('o trecho aparece na lista de ajustes pedidos do editor', async () => {
    await q("UPDATE episodes SET status = 'em_edicao' WHERE id = $1", [ep]);
    const page = (await gestao.get(`/episodios/${ep}`)).text;
    assert.match(page.split('id="ajustes"')[1], /1:32 – 1:40/);
  });
});
