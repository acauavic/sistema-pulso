const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { PassThrough } = require('stream');
const h = require('./helpers');
const { zipStream, zipLength, uniqueNames } = require('../src/utils/zipStream');

// Lê o ZIP pelo diretório central (como o Finder, o Windows e o unzip): nome, tamanho, CRC e conteúdo de cada arquivo.
function readZip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  let count = buf.readUInt16LE(eocd + 10); let cdAt = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(eocd - 20) === 0x07064b50) { // ZIP64
    const rec = Number(buf.readBigUInt64LE(eocd - 20 + 8));
    count = Number(buf.readBigUInt64LE(rec + 32)); cdAt = Number(buf.readBigUInt64LE(rec + 48));
  }
  const out = []; let p = cdAt;
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const crc = buf.readUInt32LE(p + 16); let size = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28); const xl = buf.readUInt16LE(p + 30); let off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8');
    let x = p + 46 + nl + 4; // campo ZIP64 (único extra que escrevemos)
    if (size === 0xFFFFFFFF) { size = Number(buf.readBigUInt64LE(x)); x += 16; }
    if (off === 0xFFFFFFFF) off = Number(buf.readBigUInt64LE(x));
    assert.equal(buf.readUInt32LE(off), 0x04034b50, `cabeçalho local de ${name}`);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.subarray(start, start + size);
    assert.equal(zlib.crc32(data) >>> 0, crc, `CRC de ${name}`);
    out.push({ name, size, data: data.toString() });
    p += 46 + nl + xl;
  }
  return out;
}

async function build(files, opts) {
  const pass = new PassThrough(); const chunks = []; pass.on('data', (c) => chunks.push(c));
  const zip = zipStream(pass, opts);
  for (const f of files) await zip.addStream(f.name, f.body.length, (async function* () { yield f.body.subarray(0, 3); yield f.body.subarray(3); }()));
  await zip.end();
  return Buffer.concat(chunks);
}

describe('baixar vários num ZIP só', () => {
  let app; let gestao; let anon; let ep; let user;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const put = (key, text) => h.b2Store.set(key, { body: Buffer.from(text), contentType: 'application/octet-stream' });
  const file = async (kind, name, text, extra = {}) => {
    const key = `pp/ep/${name}-${Math.random()}`; if (text !== null) put(key, text);
    return (await q("INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, status, version, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,1,$7) RETURNING id",
      [ep, kind, name, extra.dbSize ?? 999, key, extra.status || 'pronto', user.id]))[0].id;
  };

  before(async () => {
    await h.resetDb(); app = await h.startServer(); anon = h.client(app.base);
    user = await h.createUser({ name: 'Gil', email: 'g@z.com', role: 'gestao' }); gestao = h.client(app.base); await gestao.login('g@z.com');
    [{ id: ep }] = await q("INSERT INTO episodes (number, title, status) VALUES (12, 'Ep zip', 'gravado') RETURNING id");
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('formato: o tamanho previsto bate com o ZIP, nomes repetidos ganham -2, e o ZIP64 abre igual', async () => {
    const names = uniqueNames(['a.mp4', 'a.mp4', 'ção.jpg']);
    assert.deepEqual(names, ['a.mp4', 'a-2.mp4', 'ção.jpg']);
    const files = names.map((name, i) => ({ name, body: Buffer.from(`conteúdo ${i} `.repeat(i + 1)) }));
    for (const big of [undefined, 10]) { // big = 10: força o ZIP64 sem gerar 4 GB
      const opts = big ? { big } : undefined;
      const buf = await build(files, opts);
      assert.equal(buf.length, zipLength(files.map((f) => ({ name: f.name, size: f.body.length })), opts));
      assert.deepEqual(readZip(buf).map((f) => [f.name, f.data]), files.map((f) => [f.name, f.body.toString()]));
    }
    const zip = zipStream(new PassThrough());
    await assert.rejects(zip.addStream('x', 5, [Buffer.from('abc')]), /veio 3 de 5 bytes/, 'arquivo menor que o previsto não sai como ZIP quebrado');
  });

  it('arquivos do episódio, cortes e posts num ZIP, na ordem pedida, com o tamanho real e os nomes do botão Baixar', async () => {
    const a = await file('bastidor', 'b1.mp4', 'video um', { dbSize: 1 }); // tamanho do banco errado: vale o do armazenamento
    const b = await file('bastidor', 'b1.mp4', 'video dois');
    const gone = await file('bastidor', 'sumiu.mp4', null);
    const sending = await file('bastidor', 'subindo.mp4', 'x', { status: 'enviando' });
    put('pp/clip-1', 'corte!'); put('pp/capa-1', 'jpeg');
    const [{ id: clip }] = await q("INSERT INTO episode_clips (title, source, status, episode_id, storage_key, size_bytes, content_type) VALUES ('Melhor Momento', 'upload', 'pronto', $1, 'pp/clip-1', 6, 'video/mp4') RETURNING id", [ep]);
    const [{ id: cover }] = await q("INSERT INTO episode_covers (episode_id, kind, group_key, position, label, spec, storage_key, mime, width, height, size_bytes, auto) VALUES ($1,'post_quote','g',1,'x','{}','pp/capa-1','image/jpeg',1080,1350,4,true) RETURNING id", [ep]);

    const r = await fetch(`${app.base}/baixar.zip?itens=c${clip},f${b},f${a},f${gone},f${sending},k${cover},f${a},zz&nome=ep012-Bastidores`, { headers: { cookie: gestao.cookie() }, redirect: 'manual' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/zip');
    assert.equal(r.headers.get('content-disposition'), 'attachment; filename="ep012-bastidores.zip"');
    const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(Number(r.headers.get('content-length')), buf.length);
    assert.deepEqual(readZip(buf).map((f) => [f.name, f.data]), [
      ['melhor-momento.mp4', 'corte!'], ['b1.mp4', 'video dois'], ['b1-2.mp4', 'video um'], ['ep012-post-quote-2.jpg', 'jpeg'],
    ], 'o que sumiu do armazenamento e o que ainda está subindo ficam de fora; item repetido entra uma vez');
  });

  it('sem login não baixa; nada válido vira "Nada para baixar"', async () => {
    const r = await anon.get('/baixar.zip?itens=f1');
    assert.equal(r.status, 302); assert.match(r.location, /login/);
    const none = await gestao.get('/baixar.zip?itens=f999999,abc');
    assert.equal(none.status, 404); assert.match(none.text, /Nada para baixar/);
  });

  it('as listas levam a chave do ZIP em cada item e o nome do ZIP no contêiner', async () => {
    await file('foto', 'f1.jpg', 'a'); await file('foto', 'f2.jpg', 'b');
    const page = (await gestao.get(`/episodios/${ep}`)).text;
    assert.match(page, /data-folder-panel="foto" data-dl data-dl-zip="ep012-[^"]+"/);
    assert.match(page, /data-dl-item data-zip="f\d+" data-href="\/episodios\/\d+\/arquivos\/\d+\/baixar"/);
    assert.match(page, /data-gallery data-g-zip="ep012"/);
    assert.match(page, /num ZIP só/);
    const posts = (await gestao.get(`/conteudo?vista=posts&episodio=${ep}`)).text;
    assert.doesNotMatch(posts, /data-dl-zip="ep012-posts"/, 'um post só: sem seleção');
  });
});
