const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const rich = require('../src/services/richText');
const lp = require('../src/services/linkPreview');
const attachments = require('../src/services/attachments');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(300, 2)]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(300, 3)]);
const HTML = Buffer.from('<html><body><script>alert(1)</script>oi</body></html>');

describe('texto rico: limpeza do HTML', () => {
  it('mantém só o que está na lista branca e derruba script, atributos, iframes e links perigosos', () => {
    const r = rich.sanitize('<p onclick="x()" style="color:red">Oi <b>mundo</b><script>alert(1)</script></p><iframe src="//e.com"></iframe><img src="/anexos/12" onerror="x()"><img src="http://e.com/a.png"><img src="javascript:alert(1)"><a href="javascript:alert(1)">ruim</a><a href="https://ok.com" onclick="x()" data-card="1">bom</a><h1>T</h1><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><style>p{}</style><form action="/x"><input></form>');
    assert.match(r.html, /<p>Oi <strong>mundo<\/strong><\/p>/);
    assert.doesNotMatch(r.html, /script|onclick|onerror|style=|iframe|javascript:|<form|<input|<style/i);
    assert.match(r.html, /<img src="\/anexos\/12" alt="" \/>/); assert.doesNotMatch(r.html, /e\.com\/a\.png/);
    assert.match(r.html, /<a href="https:\/\/ok\.com" rel="noopener noreferrer nofollow" target="_blank" data-card="1">bom<\/a>/);
    assert.match(r.html, /<h2>T<\/h2>/); assert.match(r.html, /<table><thead><tr><th>A<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><\/tr><\/tbody><\/table>/);
    assert.deepEqual(r.attachmentIds, [12]);
    assert.doesNotMatch(r.html, /ruim<\/a>|<a href="">/, 'link sem endereço válido some');
  });
  it('texto puro para busca e avisos; vazio de verdade; texto antigo vira parágrafos e listas', () => {
    assert.equal(rich.sanitize('<p>Oi <b>mundo</b></p><ul><li>um</li><li>dois</li></ul>').text, 'Oi mundo\num\ndois');
    assert.equal(rich.sanitize('<p><br></p>').html, ''); assert.equal(rich.sanitize('   ').text, '');
    assert.equal(rich.sanitize('<p><br></p><img src="/anexos/3">').html.includes('/anexos/3'), true, 'só a imagem já é conteúdo');
    assert.equal(rich.fromPlain('Oi\nlinha 2\n\n- a\n- b\n\n<b>x</b>'), '<p>Oi<br>linha 2</p><ul><li>a</li><li>b</li></ul><p>&lt;b&gt;x&lt;/b&gt;</p>');
    assert.equal(rich.display('<p>x</p>', 'ignorado'), '<p>x</p>'); assert.equal(rich.display(null, 'a\nb'), '<p>a<br>b</p>');
    assert.ok(rich.sanitize(`<p>${'a'.repeat(100000)}</p>`).html.length <= rich.MAX_HTML);
  });
});

describe('prévia de link: proteção contra rede interna e leitura das tags', () => {
  it('recusa IPs privados, localhost, nuvem, portas e usuário/senha; deixa o público passar', async () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '224.0.0.1']) assert.equal(lp.isPrivateIp(ip), true, ip);
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.equal(lp.isPrivateIp(ip), false, ip);
    for (const u of ['http://127.0.0.1/x', 'http://[::1]/x', 'http://2130706433/', 'http://169.254.169.254/latest/meta-data/', 'http://localhost/', 'http://0x7f.1/']) await assert.rejects(lp.safeGet(u), { code: 'EBLOCKED' }, u);
    await assert.rejects(lp.safeGet('http://example.com:8080/'), /Porta/); await assert.rejects(lp.safeGet('ftp://example.com/'), /http/); await assert.rejects(lp.safeGet('http://a:b@example.com/'), /usuário/);
  });
  it('lê título, resumo, imagem (https) e site; ignora imagem http; limpa entidades', () => {
    const html = '<html><head><title>Fallback</title><meta property="og:title" content="Pulso &amp; Cia"><meta property="og:description" content="Uma conversa  longa"><meta property="og:image" content="/img/a.jpg"><meta property="og:site_name" content="Pulso"></head></html>';
    assert.deepEqual(lp.parse(html, 'https://pulso.example/p/1'), { title: 'Pulso & Cia', description: 'Uma conversa longa', image: 'https://pulso.example/img/a.jpg', site: 'Pulso' });
    assert.equal(lp.parse('<meta property="og:image" content="http://x/a.jpg"><title>T</title>', 'https://www.site.com/').image, null);
    assert.deepEqual(lp.parse('<title>Só título</title>', 'https://www.site.com/x'), { title: 'Só título', description: null, image: null, site: 'site.com' });
  });
});

describe('texto rico nas tarefas e comentários: anexos, imagens, links e áudio', () => {
  const as = {}; const u = {}; let app;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const upload = async (client, body, { name = 'x', type = 'application/octet-stream', duration } = {}) => {
    const res = await fetch(`${app.base}/anexos`, { method: 'POST', redirect: 'manual', headers: { cookie: client.cookie(), accept: 'application/json', 'x-csrf-token': await client.csrf('/tarefas'), 'content-type': type, 'x-filename': encodeURIComponent(name), ...(duration ? { 'x-duration-ms': String(duration) } : {}) }, body });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const task = async (title) => (await q('SELECT * FROM tasks WHERE title = $1', [title]))[0];

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role, name] of [['prod', 'produtora', 'Paula Produtora'], ['editor', 'editor_video', 'Edu Editor'], ['gestao', 'gestao', 'Gil Gestão']]) { u[k] = await h.createUser({ name, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
  });
  after(async () => { lp.setFetcher(null); await app.close(); await h.db.close(); });

  it('envio: imagem, PDF, ZIP e HTML pelo conteúdo do arquivo; recusa o que não é', async () => {
    const img = await upload(as.prod, PNG, { name: 'print.png', type: 'image/png' });
    assert.equal(img.status, 200); assert.equal(img.json.attachment.kind, 'image'); assert.equal(img.json.attachment.type, 'image/png'); assert.match(img.json.attachment.url, /^\/anexos\/\d+$/);
    assert.equal((await upload(as.prod, PNG, { name: 'foto.pdf', type: 'application/pdf' })).json.attachment.kind, 'image', 'o tipo vem dos bytes, não do nome');
    assert.equal((await upload(as.prod, PDF, { name: 'Briefing final.pdf' })).json.attachment.type, 'application/pdf');
    assert.equal((await upload(as.prod, ZIP, { name: 'material.zip' })).json.attachment.type, 'application/zip');
    const html = await upload(as.prod, HTML, { name: 'pagina.html', type: 'text/html' }); assert.equal(html.json.attachment.type, 'text/html'); assert.equal(html.json.attachment.kind, 'file');
    for (const [body, name, status] of [[Buffer.from('<svg onload=alert(1)></svg>'), 'a.svg', 415], [Buffer.from('MZ'), 'virus.exe', 415], [Buffer.alloc(300, 9), 'falso.pdf', 415], [Buffer.alloc(300, 9), 'falso.zip', 415], [Buffer.alloc(0), 'vazio.pdf', 400]]) assert.equal((await upload(as.prod, body, { name })).status, status, name);
    assert.equal((await upload(as.prod, Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]), { name: 'grande.png' })).status, 413);
    const anon = await fetch(`${app.base}/anexos`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/pdf' }, body: PDF }); assert.ok([302, 401, 403].includes(anon.status));
  });

  it('leitura: solto só para quem enviou; ligado à tarefa, para a equipe; documento sempre baixa; apagar é de quem enviou ou da gestão', async () => {
    const f = (await upload(as.prod, PDF, { name: 'Roteiro.pdf' })).json.attachment;
    assert.equal((await as.editor.get(f.url, { redirect: 'manual' })).status, 404, 'outra pessoa não vê o que ainda está solto');
    const mine = await as.prod.get(f.url, { redirect: 'manual' });
    assert.equal(mine.status, 302); assert.match(mine.headers.get('location'), /backblazeb2\.com.*response-content-disposition=attachment/); assert.match(mine.headers.get('location'), /Roteiro\.pdf/);
    const i = (await upload(as.prod, PNG, { name: 'a.png' })).json.attachment;
    const inline = await as.prod.get(i.url, { redirect: 'manual' }); assert.equal(inline.status, 302); assert.doesNotMatch(inline.headers.get('location'), /disposition=attachment/); assert.match(inline.headers.get('location'), /response-content-type=image%2Fpng/);
    await as.prod.act('/tarefas', { title: 'Tarefa dos anexos', kind: 'geral', description_html: `<p>Veja</p><img src="${i.url}">`, attachment_ids: String(f.id) }, { from: '/tarefas' });
    const t = await task('Tarefa dos anexos');
    assert.deepEqual((await q("SELECT id FROM attachments WHERE entity_type = 'task' AND entity_id = $1 ORDER BY id", [t.id])).map((r) => r.id), [f.id, i.id], 'documento do formulário e imagem do texto ficam ligados');
    assert.equal((await as.editor.get(f.url, { redirect: 'manual' })).status, 302, 'depois de salvo na tarefa, a equipe vê');
    assert.equal((await as.editor.act(`${f.url}/excluir`, {}, { from: '/tarefas' })).status, 403);
    const key = (await q('SELECT storage_key FROM attachments WHERE id = $1', [f.id]))[0].storage_key; assert.equal(h.b2Store.has(key), true, 'o arquivo está no bucket');
    const del = await fetch(`${app.base}${f.url}/excluir`, { method: 'POST', headers: { cookie: as.gestao.cookie(), accept: 'application/json', 'x-csrf-token': await as.gestao.csrf('/tarefas') } });
    assert.equal(del.status, 200); assert.equal((await q('SELECT 1 FROM attachments WHERE id = $1', [f.id])).length, 0); assert.equal(h.b2Store.has(key), false, 'saiu do bucket');
  });

  it('tarefa com texto rico: guarda HTML limpo e texto puro, mostra formatado, lista anexos e aceita edição; texto puro novo vence o HTML antigo', async () => {
    const evil = '<p>Oi <strong>time</strong></p><script>alert(1)</script><p onclick="x()">linha</p><table><tr><th>Item</th><th>Prazo</th></tr><tr><td>Roteiro</td><td>sexta</td></tr></table><a href="https://pulso.example/x" data-card="1">https://pulso.example/x</a>';
    await as.gestao.act('/tarefas', { title: 'Rica', kind: 'geral', assignee_id: String(u.prod.id), description_html: evil }, { from: '/tarefas' });
    const t = await task('Rica');
    assert.doesNotMatch(t.description_html, /script|onclick/); assert.match(t.description_html, /<table>/); assert.match(t.description_html, /data-card="1"/);
    assert.match(t.description, /Oi time/); assert.match(t.description, /Roteiro \| sexta/); assert.doesNotMatch(t.description, /<|alert/);
    const page = (await as.prod.get(`/tarefas/${t.id}`)).text;
    assert.match(page, /data-rich/); assert.match(page, /data-cmd="bold"/); assert.match(page, /data-cmd="table"/); assert.match(page, /<th>Item<\/th>/); assert.match(page, /static\/richtext\.js/);
    assert.doesNotMatch(page, /<script>alert/);
    await as.gestao.act(`/tarefas/${t.id}`, { title: 'Rica', status: 'a_fazer', kind: 'geral', description_html: '<p>Novo <em>texto</em></p>' }, { from: `/tarefas/${t.id}` });
    let r = await task('Rica'); assert.equal(r.description_html, '<p>Novo <em>texto</em></p>'); assert.equal(r.description, 'Novo texto');
    await as.gestao.act(`/tarefas/${t.id}`, { title: 'Rica', status: 'a_fazer', kind: 'geral', due_on: '' }, { from: `/tarefas/${t.id}` });
    r = await task('Rica'); assert.equal(r.description_html, '<p>Novo <em>texto</em></p>', 'salvar sem mexer no texto não perde a formatação');
    await as.gestao.act(`/tarefas/${t.id}`, { title: 'Rica', status: 'a_fazer', kind: 'geral', description_html: '' }, { from: `/tarefas/${t.id}` });
    r = await task('Rica'); assert.equal(r.description_html, null); assert.equal(r.description, null, 'apagar tudo limpa a descrição');
    await h.db.query("UPDATE tasks SET description = 'linha 1\nlinha 2\n\n- a\n- b', description_html = NULL WHERE id = $1", [t.id]);
    assert.match((await as.gestao.get(`/tarefas/${t.id}`)).text, /<p>linha 1<br>linha 2<\/p><ul><li>a<\/li><li>b<\/li><\/ul>/, 'texto antigo aparece formatado');
  });

  it('comentário rico: HTML limpo, menção pelo texto, áudio com transcrição ligado ao comentário e aviso com o que foi dito', async () => {
    const t = await task('Rica');
    const audio = await upload(as.prod, Buffer.alloc(3000, 5), { name: 'audio.webm', type: 'audio/webm', duration: 23000 });
    assert.equal(audio.status, 200); assert.equal(audio.json.attachment.kind, 'audio'); assert.equal(audio.json.attachment.transcript, 'texto transcrito de teste'); assert.equal(audio.json.attachment.duration_ms, 23000);
    await as.prod.act('/comentarios', { tipo: 'task', id: String(t.id), texto_html: '<p>@Gil Gestão veja <strong>isso</strong></p><script>x</script>', anexos: String(audio.json.attachment.id) }, { from: `/tarefas/${t.id}` });
    const [c] = await q("SELECT * FROM comments WHERE entity_type = 'task' AND entity_id = $1 ORDER BY id DESC", [t.id]);
    assert.equal(c.body, '@Gil Gestão veja isso'); assert.equal(c.body_html, '<p>@Gil Gestão veja <strong>isso</strong></p>'); assert.deepEqual(c.mentions.map(String), [String(u.gestao.id)]);
    assert.equal((await q("SELECT entity_id FROM attachments WHERE id = $1 AND entity_type = 'comment'", [audio.json.attachment.id]))[0].entity_id, c.id);
    assert.ok((await q("SELECT 1 FROM notifications WHERE user_id = $1 AND title LIKE '%mencionou você%'", [u.gestao.id])).length);
    const page = (await as.gestao.get(`/tarefas/${t.id}`)).text;
    assert.match(page, /<audio controls[^>]*src="\/anexos\/\d+"/); assert.match(page, /texto transcrito de teste/); assert.match(page, /class="cmt-text rich-content"/); assert.match(page, /data-cmd="mic"/);
    // só áudio, sem texto: vale, e o aviso mostra a transcrição
    const a2 = (await upload(as.editor, Buffer.alloc(3000, 6), { name: 'a.webm', type: 'audio/webm' })).json.attachment;
    await as.editor.act('/comentarios', { tipo: 'task', id: String(t.id), texto_html: '<p><br></p>', anexos: String(a2.id) }, { from: `/tarefas/${t.id}` });
    const note = (await q("SELECT body FROM notifications WHERE title LIKE '%Edu Editor comentou%' ORDER BY id DESC LIMIT 1"))[0];
    assert.match(note.body, /Áudio: texto transcrito de teste/);
    // sem nada: recusa
    const before = (await q('SELECT count(*)::int AS n FROM comments'))[0].n;
    await as.editor.act('/comentarios', { tipo: 'task', id: String(t.id), texto_html: '<p><br></p>' }, { from: `/tarefas/${t.id}` });
    assert.equal((await q('SELECT count(*)::int AS n FROM comments'))[0].n, before);
    // transcrição indisponível: o áudio sobe mesmo assim, avisando
    h.setGroqFail(true); const a3 = await upload(as.editor, Buffer.alloc(3000, 7), { name: 'b.webm', type: 'audio/webm' }); h.setGroqFail(false);
    assert.equal(a3.status, 200); assert.equal(a3.json.attachment.transcript, null); assert.match(a3.json.transcribeError, /transcrever/);
  });

  it('comentário puro nos outros itens continua igual (convidado), sem editor rico', async () => {
    const g = (await q("INSERT INTO guests (name, status) VALUES ('Dra. Teste', 'prospect') RETURNING id"))[0].id;
    await as.prod.act('/comentarios', { tipo: 'guest', id: String(g), texto: 'oi <b>x</b> @Gil Gestão' }, { from: `/convidados/${g}` });
    const [c] = await q("SELECT * FROM comments WHERE entity_type = 'guest' AND entity_id = $1", [g]); assert.equal(c.body_html, null); assert.equal(c.body, 'oi <b>x</b> @Gil Gestão');
    const page = (await as.prod.get(`/convidados/${g}`)).text; assert.match(page, /name="texto"/); assert.doesNotMatch(page, /data-rich/); assert.match(page, /&lt;b&gt;x&lt;\/b&gt;/);
  });

  it('miniatura de link: o servidor lê a página (com cache), recusa rede interna e a tela só mostra o que existe', async () => {
    let calls = 0;
    lp.setFetcher(async (url) => { calls += 1; return { status: 200, url, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from('<head><meta property="og:title" content="Episódio 12"><meta property="og:description" content="Uma conversa"><meta property="og:image" content="https://cdn.example/a.jpg"></head>') }; });
    const get = async (url) => JSON.parse((await as.prod.get(`/previa-link?url=${encodeURIComponent(url)}`, { headers: { accept: 'application/json' } })).text);
    const a = await get('https://pulso.example/ep/12'); assert.deepEqual([a.ok, a.title, a.description, a.image, a.site], [true, 'Episódio 12', 'Uma conversa', 'https://cdn.example/a.jpg', 'pulso.example']);
    await get('https://pulso.example/ep/12'); assert.equal(calls, 1, 'segunda leitura vem do cache');
    assert.equal((await get('javascript:alert(1)')).ok, false); assert.equal((await get('')).ok, false); assert.equal(calls, 1);
    lp.setFetcher(async () => { throw Object.assign(new Error('bloqueado'), { code: 'EBLOCKED' }); });
    const bad = await get('http://10.0.0.1/admin'); assert.equal(bad.ok, false); assert.equal(bad.title, null);
    lp.setFetcher(async () => ({ status: 200, url: 'x', headers: { 'content-type': 'application/pdf' }, body: Buffer.from('%PDF') }));
    assert.equal((await get('https://pulso.example/arquivo.pdf')).ok, false, 'só páginas HTML viram miniatura');
    assert.equal((await as.prod.get('/static/richtext.js')).status, 200);
  });

  it('limpeza: solto há mais de 2 dias e anexo de item que não existe mais saem do bucket e do banco', async () => {
    const old = (await upload(as.prod, PNG, { name: 'velho.png' })).json.attachment; const fresh = (await upload(as.prod, PNG, { name: 'novo.png' })).json.attachment;
    await h.db.query("UPDATE attachments SET created_at = now() - interval '3 days' WHERE id = $1", [old.id]);
    await h.db.query("INSERT INTO attachments (entity_type, entity_id, kind, filename, content_type, size_bytes, storage_key, uploaded_by) VALUES ('task', 999999, 'file', 'orfao.pdf', 'application/pdf', 5, 'k/orfao.pdf', $1)", [u.prod.id]);
    assert.equal(await attachments.purge(), 2);
    assert.equal((await q('SELECT 1 FROM attachments WHERE id = $1', [old.id])).length, 0); assert.equal((await q('SELECT 1 FROM attachments WHERE id = $1', [fresh.id])).length, 1);
  });
});
