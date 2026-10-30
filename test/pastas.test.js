const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('episódio: material bruto e vídeo editado em pastas', () => {
  const as = {}; const u = {}; let app; let ep;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const file = (kind, label, name, extra = {}) => q(
    "INSERT INTO episode_files (episode_id, kind, label, filename, size_bytes, storage_key, status, version, uploaded_by) VALUES ($1,$2,$3,$4,1048576,$5,$6,$7,$8) RETURNING id",
    [ep, kind, label, name, `k/${name}`, extra.status || 'pronto', extra.version || 1, u.gestao.id]).then((r) => r[0].id);

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role, name] of [['gestao', 'gestao', 'Gil Gestão'], ['editor', 'editor_video', 'Edu Editor']]) { u[k] = await h.createUser({ name, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    [{ id: ep }] = await q("INSERT INTO episodes (title, status, editor_id) VALUES ('Ep pastas', 'em_revisao', $1) RETURNING id", [u.editor.id]);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('só aparecem pastas que têm arquivo; cada uma com contagem, tamanho e o que está enviando', async () => {
    let page = (await as.gestao.get(`/episodios/${ep}`)).text;
    assert.doesNotMatch(page, /data-folder-open="bruto_video"/, 'sem arquivo, sem pasta');
    await file('bruto_video', 'Câmera 1', 'cam1.mp4'); await file('bruto_video', 'Câmera 2', 'cam2.mp4'); await file('bruto_video', 'Câmera 1', 'cam1b.mp4');
    await file('foto', null, 'f1.jpg'); await file('bruto_audio', 'Lapela', 'a.wav', { status: 'enviando' });
    page = (await as.gestao.get(`/episodios/${ep}`)).text;
    const raw = page.match(/data-key="raw-\d+"[\s\S]*?(?=data-key="edited|<\/section>)/)[0];
    for (const k of ['bruto_video', 'foto', 'bruto_audio']) assert.match(raw, new RegExp(`data-folder-open="${k}"`));
    assert.doesNotMatch(raw, /data-folder-open="bastidor"/);
    assert.match(raw, /Abrir a pasta Vídeos do episódio, 3 arquivos/);
    assert.match(raw, /Vídeos do episódio <span[^>]*>3 · 3\.0 MB|Vídeos do episódio <span[^>]*>3 · 3,0 MB/);
    assert.match(raw, /<span class="badge b-amber">enviando<\/span>/, 'pasta com arquivo subindo avisa');
  });

  it('dentro da pasta, os arquivos se separam por rótulo; remover é ícone e baixar continua', async () => {
    const page = (await as.gestao.get(`/episodios/${ep}`)).text;
    const panel = page.match(/data-folder-panel="bruto_video"[\s\S]*?<\/div>\s*(?=<div class="folder-panel"|<\/div>\s*<\/div>)/)[0];
    assert.match(panel, /folder-sub[^>]*>[\s\S]*Câmera 1[\s\S]*<span class="mono small muted">2<\/span>/);
    assert.match(panel, /Câmera 2/);
    assert.match(panel, /aria-label="Remover o arquivo"/); assert.doesNotMatch(panel, />remover</);
    assert.match(panel, /Baixar/);
    assert.match(page, /data-folder-back aria-label="Voltar às pastas"/);
  });

  it('quem não sobe material não vê o remover, mas vê as pastas', async () => {
    const page = (await as.editor.get(`/episodios/${ep}`)).text;
    assert.match(page, /data-folder-open="bruto_video"/);
    assert.doesNotMatch(page.match(/data-folder-panel="bruto_video"[\s\S]*?data-folder-panel="foto"/)[0], /Remover o arquivo/);
  });

  it('baixar vários: selecionar e "Baixar tudo" só onde há mais de um arquivo pronto; cada arquivo leva o link de sempre, e a galeria também seleciona', async () => {
    const a = await file('bastidor', null, 'bast-1.jpg'); const b = await file('bastidor', null, 'a "b" & <c>.jpg'); await file('bastidor', null, 'bast-3.jpg', { status: 'enviando' });
    const page = (await as.gestao.get(`/episodios/${ep}`)).text;
    const panel = (kind) => page.match(new RegExp(`data-folder-panel="${kind}"[\\s\\S]*?(?=<div class="folder-panel"|<\\/section>)`))[0];
    const bast = panel('bastidor');
    assert.match(bast, /data-dl\b/); assert.match(bast, /data-dl-select/); assert.match(bast, /data-dl-everything/);
    assert.match(bast, /data-dl-bar[^>]*hidden/, 'a barra de seleção só aparece depois de "Selecionar"');
    assert.match(bast, new RegExp(`data-dl-item data-href="/episodios/${ep}/arquivos/${a}/baixar" data-name="bast-1.jpg" data-bytes="1048576"`));
    assert.match(bast, /data-name="a &#34;b&#34; &amp; &lt;c&gt;\.jpg"/, 'o nome do arquivo vai escapado');
    assert.doesNotMatch(bast, /<c>/);
    assert.equal((bast.match(/data-dl-item/g) || []).length, 2, 'o arquivo que ainda está enviando não entra na seleção');
    assert.match(bast, new RegExp(`aria-label="Selecionar bast-1.jpg"`));
    assert.doesNotMatch(panel('foto'), /data-dl-select|data-dl-everything/, 'um arquivo só: o botão Baixar da linha basta');
    assert.match(page, /data-g-select/); assert.match(page, /data-g-everything/); assert.match(page, /"bytes":1048576/, 'a galeria conhece o tamanho de cada arquivo');
    assert.doesNotMatch(page, /data-bulk/, 'não repete os nomes da edição em massa de Convidados');
    assert.ok(page.indexOf('/static/baixar.js') > 0 && page.indexOf('/static/baixar.js') < page.indexOf('/static/producao.js'), 'baixar.js carrega antes do producao.js');
    const js = await as.gestao.get('/static/baixar.js');
    assert.equal(js.status, 200); assert.match(js.text, /window\.PulsoBaixar/);
    assert.ok(b > a);
  });

  it('vídeo editado: uma pasta por versão (a mais nova é a atual) com os comentários de revisão daquela versão', async () => {
    const v1 = await file('editado', null, 'ep_v1.mp4', { version: 1 }); const v2 = await file('editado', null, 'ep_v2.mp4', { version: 2 });
    await q("INSERT INTO episode_comments (episode_id, file_id, at_ms, body, author_id) VALUES ($1,$2,1000,'a',$4), ($1,$2,2000,'b',$4), ($1,$3,3000,'c',$4)", [ep, v1, v2, u.gestao.id]);
    await q("UPDATE episode_comments SET resolved = true WHERE file_id = $1 AND at_ms = 1000", [v1]);
    const page = (await as.gestao.get(`/episodios/${ep}`)).text;
    const ed = page.match(/data-key="edited-\d+"[\s\S]*?Enviar nova versão/)[0];
    assert.match(ed, new RegExp(`data-folder-open="v${v2}"[\\s\\S]*Versão 2[\\s\\S]*atual`));
    assert.match(ed, new RegExp(`class="folder older" data-folder-open="v${v1}"`), 'versão antiga esmaecida');
    assert.match(ed, /1 em aberto/, 'a versão 2 tem 1 comentário em aberto');
    assert.match(ed, /1 em aberto[\s\S]*Versão 1/, 'a ordem é da mais nova para a mais antiga');
    assert.match(ed, /2 comentários de revisão nesta versão · 1 em aberto/);
    assert.match(ed, /<a href="#revisao">Abrir a revisão<\/a>/, 'só a versão atual leva à aba de revisão');
    assert.equal((ed.match(/Abrir a revisão/g) || []).length, 1);
    assert.match(ed, /aria-label="Remover a versão"/);
  });

  it('as pastas funcionam sem JS inline: o script e o estilo estão nos arquivos do painel', async () => {
    assert.match((await as.gestao.get('/static/producao.js')).text, /data-folder-open/);
    assert.match((await as.gestao.get('/static/app.css')).text, /\.folder-grid/);
    assert.doesNotMatch((await as.gestao.get(`/episodios/${ep}`)).text.match(/data-folders[\s\S]*?<\/button>/)[0], /style=|onclick/);
  });
});
