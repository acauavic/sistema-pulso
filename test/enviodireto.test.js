const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('./helpers');

describe('envio direto do navegador ao Backblaze: link assinado por parte e registro da parte', () => {
  const as = {}; let app; let epId;
  const md5 = (buf) => `"${crypto.createHash('md5').update(buf).digest('hex')}"`;

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['prod', 'produtora'], ['gestao', 'gestao'], ['editor', 'editor_video']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    epId = (await h.db.query("INSERT INTO episodes (number, title, status) VALUES (9, 'Episódio direto', 'gravado') RETURNING id")).rows[0].id;
    h.config.uploadPartBytes = 5 * 1024 * 1024; // partes pequenas para o teste
  });
  after(async () => { await app.close(); await h.db.close(); });

  async function api(client, method, path, { json, raw } = {}) {
    const token = await client.csrf('/episodios');
    const headers = { cookie: client.cookie(), accept: 'application/json', 'x-csrf-token': token };
    let body;
    if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); } else if (raw) { headers['content-type'] = 'application/octet-stream'; body = raw; }
    const res = await fetch(`${app.base}${path}`, { method, headers, body, redirect: 'manual' });
    const text = await res.text(); let parsed = null; try { parsed = JSON.parse(text); } catch { /* não é JSON */ }
    return { status: res.status, json: parsed, text };
  }
  const start = async (client, size, kind = 'bruto_video', name = 'cam.mp4') => {
    const init = await api(client, 'POST', `/episodios/${epId}/arquivos/iniciar`, { json: { kind, nome: name, tamanho: size, tipo: 'video/mp4' } });
    assert.equal(init.status, 200, init.text); return init.json;
  };

  it('o servidor assina o PUT de cada parte (só as pedidas, dentro do total) e o navegador registra com o ETag', async () => {
    const size = 12 * 1024 * 1024; // 3 partes de 5 MB (5 + 5 + 2)
    const f = await start(as.prod, size);
    assert.equal(f.totalParts, 3);
    const r = await api(as.prod, 'GET', `/episodios/${epId}/arquivos/${f.id}/urls?partes=1,2,3,4,0,abc,2`);
    assert.equal(r.status, 200, r.text); assert.equal(r.json.direct, true);
    assert.deepEqual(Object.keys(r.json.urls), ['1', '2', '3'], 'sem parte fora do total, sem repetida');
    const u = new URL(r.json.urls[2]);
    assert.match(u.host, /backblazeb2\.com$/); assert.equal(u.searchParams.get('partNumber'), '2'); assert.ok(u.searchParams.get('uploadId')); assert.match(u.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
    assert.equal(u.searchParams.get('X-Amz-SignedHeaders'), 'host', 'só o host é assinado: o navegador não precisa mandar cabeçalho nenhum');
    // o navegador envia cada parte ao link assinado (PUT, sem cabeçalhos) e registra o ETag que o bucket devolveu
    const bytes = [5, 5, 2].map((mb) => Buffer.alloc(mb * 1024 * 1024, mb));
    for (let n = 1; n <= 3; n += 1) {
      const put = await fetch(r.json.urls[n], { method: 'PUT', body: bytes[n - 1] });
      assert.equal(put.status, 200); assert.equal(put.headers.get('etag'), md5(bytes[n - 1]));
      const ok = await api(as.prod, 'POST', `/episodios/${epId}/arquivos/${f.id}/parte/${n}/ok`, { json: { etag: put.headers.get('etag'), size: bytes[n - 1].length } });
      assert.equal(ok.status, 200, ok.text);
    }
    const parts = await api(as.prod, 'GET', `/episodios/${epId}/arquivos/${f.id}/partes`);
    assert.deepEqual(parts.json.parts, [1, 2, 3], 'a retomada enxerga as partes enviadas direto');
    const done = await api(as.prod, 'POST', `/episodios/${epId}/arquivos/${f.id}/concluir`);
    assert.equal(done.status, 200, done.text);
    assert.equal((await h.db.query('SELECT status FROM episode_files WHERE id = $1', [f.id])).rows[0].status, 'pronto');
    assert.equal(h.b2Store.get((await h.db.query('SELECT storage_key FROM episode_files WHERE id = $1', [f.id])).rows[0].storage_key).body.length, size, 'o arquivo inteiro está no bucket');
  });

  it('recusa parte com tamanho errado, ETag inválido, parte inexistente e envio já concluído', async () => {
    const f = await start(as.prod, 7 * 1024 * 1024, 'bruto_video', 'cam2.mp4'); // 5 MB + 2 MB
    const base = `/episodios/${epId}/arquivos/${f.id}/parte`;
    const etag = md5(Buffer.from('x'));
    assert.equal((await api(as.prod, 'POST', `${base}/1/ok`, { json: { etag, size: 1000 } })).status, 400, 'tamanho errado');
    assert.match((await api(as.prod, 'POST', `${base}/2/ok`, { json: { etag, size: 5 * 1024 * 1024 } })).json.error, /deveria ter 2097152 bytes/, 'a última parte é menor');
    assert.equal((await api(as.prod, 'POST', `${base}/1/ok`, { json: { etag: '<script>&x', size: 5 * 1024 * 1024 } })).status, 400, 'ETag com caractere perigoso para o XML');
    assert.equal((await api(as.prod, 'POST', `${base}/1/ok`, { json: { size: 5 * 1024 * 1024 } })).status, 400, 'sem ETag');
    assert.equal((await api(as.prod, 'POST', `${base}/9/ok`, { json: { etag, size: 100 } })).status, 400, 'parte inexistente');
    assert.equal((await api(as.prod, 'POST', `/episodios/${epId}/arquivos/99999/parte/1/ok`, { json: { etag, size: 5 } })).status, 404);
    // ETag sem aspas também vale (e é guardado com aspas, como o servidor sempre fez)
    assert.equal((await api(as.prod, 'POST', `${base}/1/ok`, { json: { etag: etag.replace(/"/g, ''), size: 5 * 1024 * 1024 } })).status, 200);
    assert.match((await h.db.query('SELECT etag FROM episode_file_parts WHERE file_id = $1 AND part_number = 1', [f.id])).rows[0].etag, /^"[0-9a-f]{32}"$/);
    // fechar sem todas as partes: o servidor avisa
    assert.match((await api(as.prod, 'POST', `/episodios/${epId}/arquivos/${f.id}/concluir`)).json.error, /Faltam partes: recebi 1 de 2/);
  });

  it('só quem pode enviar usa; vídeo editado é do editor; desligado, o painel manda usar o servidor', async () => {
    const f = await start(as.prod, 6 * 1024 * 1024, 'bruto_video', 'cam3.mp4');
    assert.equal((await api(as.editor, 'GET', `/episodios/${epId}/arquivos/${f.id}/urls?partes=1`)).status, 404, 'o editor não mexe no bruto da produtora');
    const ed = await start(as.editor, 6 * 1024 * 1024, 'editado', 'final.mp4');
    assert.equal((await api(as.editor, 'GET', `/episodios/${epId}/arquivos/${ed.id}/urls?partes=1`)).json.direct, true);
    assert.equal((await api(as.prod, 'GET', `/episodios/${epId}/arquivos/${ed.id}/urls?partes=1`)).status, 404, 'a produtora não mexe no editado');
    h.config.uploadDirect = false;
    try {
      const off = await api(as.prod, 'GET', `/episodios/${epId}/arquivos/${f.id}/urls?partes=1`);
      assert.deepEqual(off.json, { ok: true, direct: false, urls: {} });
      assert.equal((await api(as.prod, 'PUT', `/episodios/${epId}/arquivos/${f.id}/parte/1`, { raw: Buffer.alloc(5 * 1024 * 1024) })).status, 200, 'o caminho pelo servidor segue funcionando');
    } finally { h.config.uploadDirect = true; }
  });

  it('cortes enviados pelo editor também usam o envio direto (e a entrega de pedido, pela rota dela)', async () => {
    const init = await api(as.editor, 'POST', '/cortes/iniciar', { json: { nome: 'corte.mp4', tamanho: 7 * 1024 * 1024, tipo: 'video/mp4' } });
    assert.equal(init.status, 200, init.text);
    const urls = await api(as.editor, 'GET', `/cortes/${init.json.id}/urls?partes=1,2`);
    assert.equal(urls.json.direct, true); assert.deepEqual(Object.keys(urls.json.urls), ['1', '2']);
    assert.equal((await api(as.prod, 'GET', `/cortes/${init.json.id}/urls?partes=1`)).status, 403, 'a produtora não envia cortes');
    const size = init.json.partSize;
    assert.equal((await api(as.editor, 'POST', `/cortes/${init.json.id}/parte/1/ok`, { json: { etag: md5(Buffer.from('a')), size } })).status, 200);
    assert.equal((await api(as.editor, 'POST', `/cortes/${init.json.id}/parte/2/ok`, { json: { etag: md5(Buffer.from('b')), size: 7 * 1024 * 1024 - size } })).status, 200);
    assert.equal((await h.db.query('SELECT count(*)::int AS n FROM clip_upload_parts WHERE clip_id = $1', [init.json.id])).rows[0].n, 2);
    // a Política de segurança deixa o navegador falar com o bucket
    const home = await fetch(`${app.base}/login`);
    assert.match(home.headers.get('content-security-policy'), /connect-src 'self' https:\/\/\*\.backblazeb2\.com;/);
  });

  it('Integrações: mostra se o bucket aceita envio direto e liga/desliga o CORS com um clique (só a regra do painel), com auditoria', async () => {
    h.b2Cors.xml = null;
    let page = (await as.gestao.get('/integracoes')).text;
    assert.match(page, /Armazenamento \(Backblaze\)/); assert.match(page, /desligado no bucket/); assert.match(page, /Ligar envio direto/);
    await as.gestao.act('/integracoes/armazenamento/cors', { acao: 'ligar' }, { from: '/integracoes' });
    assert.match(h.b2Cors.xml, /<AllowedOrigin>http:\/\/localhost:\d+<\/AllowedOrigin>|<AllowedOrigin>https?:\/\/[^<]+<\/AllowedOrigin>/);
    assert.match(h.b2Cors.xml, /<AllowedMethod>PUT<\/AllowedMethod>/); assert.match(h.b2Cors.xml, /<ExposeHeader>ETag<\/ExposeHeader>/); assert.doesNotMatch(h.b2Cors.xml, /DELETE|POST/, 'só PUT');
    assert.ok(h.b2Calls.some((c) => c.key === '(bucket)' && c.md5), 'o PutBucketCors leva Content-MD5');
    page = (await as.gestao.get('/integracoes')).text;
    assert.match(page, /<span class="badge b-green">ligado<\/span>/); assert.match(page, /Desligar o envio direto/);
    assert.ok((await h.db.query("SELECT 1 FROM audit_log WHERE action = 'integracao.cors_ligado'")).rows.length);
    assert.equal((await as.editor.act('/integracoes/armazenamento/cors', { acao: 'desligar' }, { from: '/' })).status, 403, 'só quem cuida das integrações');
    await as.gestao.act('/integracoes/armazenamento/cors', { acao: 'desligar' }, { from: '/integracoes' });
    assert.equal(h.b2Cors.xml, null);
    // outras regras no bucket: avisa que ligar vai substituí-las
    h.b2Cors.xml = '<CORSConfiguration><CORSRule><AllowedOrigin>https://outro.com</AllowedOrigin><AllowedMethod>GET</AllowedMethod></CORSRule></CORSConfiguration>';
    assert.match((await as.gestao.get('/integracoes')).text, /bucket com outras regras[\s\S]*substitui as regras atuais/);
    // chave sem permissão para mudar o bucket: explica o caminho manual
    h.b2Cors.xml = null; h.b2Cors.denied = true;
    try {
      const r = await as.gestao.act('/integracoes/armazenamento/cors', { acao: 'ligar' }, { from: '/integracoes' });
      assert.equal(r.status, 302);
      assert.match((await as.gestao.get('/integracoes')).text, /não deixou ligar o CORS[\s\S]*CORS Rules/);
    } finally { h.b2Cors.denied = false; }
  });
});
