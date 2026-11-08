const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const review = require('../src/services/review');

describe('Revisão que não se perde: comentários seguem as versões, "feito" do editor, "conferido" da revisão e marcadores', () => {
  let app; let gestao; let editor; let ep; let v1; let users = {};
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const send = async (c, path, form = {}) => {
    const csrf = await c.csrf(`/episodios/${ep}`);
    const r = await fetch(`${app.base}${path}`, { method: 'POST', redirect: 'manual', headers: { cookie: c.cookie(), accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': csrf }, body: new URLSearchParams(form) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const comment = (form) => send(gestao, `/episodios/${ep}/comentarios`, { body: 'Ajustar', file_id: String(v1), ...form });
  const addVersion = async (n) => (await q("INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, status, version, uploaded_by, fps) VALUES ($1,'editado',$2,1000,$3,'pronto',$4,$5,25) RETURNING *", [ep, `v${n}.mp4`, `pp/v${n}`, n, users.editor.id]))[0];

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    users.gestao = await h.createUser({ name: 'Gil Gestão', email: 'g@rv.com', role: 'gestao' }); gestao = h.client(app.base); await gestao.login('g@rv.com');
    users.editor = await h.createUser({ name: 'Edu Editor', email: 'e@rv.com', role: 'editor_video' }); editor = h.client(app.base); await editor.login('e@rv.com');
    [{ id: ep }] = await q("INSERT INTO episodes (number, title, status, editor_id) VALUES (19, 'Conversa com Mari', 'em_revisao', $1) RETURNING id", [users.editor.id]);
    [{ id: v1 }] = await q("INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, status, version, uploaded_by) VALUES ($1,'editado','v1.mp4',1000,'pp/v1','pronto',1,$2) RETURNING id", [ep, users.editor.id]);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('o comentário guarda a versão comentada', async () => {
    const r = await comment({ at_ms: '92000', end_ms: '100500', body: 'Pode cortar daqui até a pergunta do Acauã' });
    assert.equal(r.status, 200);
    assert.equal((await q('SELECT version FROM episode_comments WHERE id = $1', [r.json.id]))[0].version, 1);
    assert.match(r.json.html, /mono small muted[^>]*>v1</);
  });

  it('versão com comentários não pode ser apagada: a correção sobe como versão nova', async () => {
    await q("UPDATE episodes SET status = 'em_edicao' WHERE id = $1", [ep]);
    const r = await send(editor, `/episodios/${ep}/arquivos/${v1}/excluir`);
    assert.equal(r.status, 302);
    assert.equal((await q('SELECT count(*)::int AS n FROM episode_files WHERE id = $1', [v1]))[0].n, 1, 'a versão continua');
    assert.equal((await q('SELECT count(*)::int AS n FROM trash_items')).length && (await q("SELECT count(*)::int AS n FROM trash_items WHERE kind = 'episode_file'"))[0].n, 0);
    const page = (await editor.get(`/episodios/${ep}`)).text;
    assert.match(page, /não pode ser removida/);
    assert.match(page, /is-locked/, 'no lugar da lixeira, o cadeado com a explicação');
  });

  it('se o arquivo sair por outro caminho, o comentário fica (com a versão anotada)', async () => {
    const tmp = await addVersion(9);
    const [{ id }] = await q("INSERT INTO episode_comments (episode_id, file_id, version, at_ms, body) VALUES ($1,$2,9,1000,'teste') RETURNING id", [ep, tmp.id]);
    await q('DELETE FROM episode_files WHERE id = $1', [tmp.id]);
    const [c] = await q('SELECT file_id, version FROM episode_comments WHERE id = $1', [id]);
    assert.equal(c.file_id, null); assert.equal(c.version, 9);
    await q('DELETE FROM episode_comments WHERE id = $1', [id]);
  });

  it('o editor vê os ajustes com a caixa "feito", o aviso de minutagem aproximada e os marcadores', async () => {
    const page = (await editor.get(`/episodios/${ep}`)).text;
    const card = page.split('id="ajustes"')[1];
    assert.match(card, /data-fix="\d+"/); assert.match(card, /0 de 1 feitos/);
    assert.match(card, /minutagens são aproximadas/);
    assert.match(card, /≈ 1:32 – 1:40/);
    assert.match(page, /id="modal-marcadores"/, 'a janela dos marcadores existe para o editor');
  });

  it('o editor marca "feito": entra na próxima versão; ao subir a v2, vira "feito na v2"', async () => {
    const [{ id }] = await q('SELECT id FROM episode_comments WHERE episode_id = $1 ORDER BY id LIMIT 1', [ep]);
    const r = await send(editor, `/episodios/${ep}/comentarios/${id}/feito`, { feito: '1' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.fixed, true); assert.equal(r.json.fixedVersion, null, 'ainda não há versão nova');
    assert.match((await editor.get(`/episodios/${ep}`)).text.split('id="ajustes"')[1], /feito · entra na próxima versão/);
    const v2 = await addVersion(2);
    assert.equal(await review.versionUploaded(v2), 1);
    assert.equal((await q('SELECT fixed_version FROM episode_comments WHERE id = $1', [id]))[0].fixed_version, 2);
    assert.equal((await send(gestao, `/episodios/${ep}/comentarios/${id}/feito`, { feito: '1' })).status, 200, 'gestão também edita');
  });

  it('versão nova durante a revisão avisa quem revisa com o andamento dos ajustes', async () => {
    await q("UPDATE episodes SET status = 'em_revisao' WHERE id = $1", [ep]);
    const v3 = await addVersion(3);
    await review.newVersionNotice(v3, 0, { id: users.editor.id, name: 'Edu Editor' });
    const [n] = await q('SELECT title, body FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [users.gestao.id]);
    assert.match(n.title, /Nova versão \(v3\) para revisar: EP\.019/);
    assert.match(n.body, /1 de 1 ajuste marcado como feito para conferir/);
    await q('DELETE FROM episode_files WHERE id = $1', [v3.id]);
  });

  it('na revisão: minutagem da v1, "feito na v2 · conferir", filtro e Conferido / Ainda não', async () => {
    const page = (await gestao.get(`/episodios/${ep}`)).text;
    const rev = page.split('id="pane-revisao"')[1];
    assert.match(rev, /minutagem da v1/);
    assert.match(rev, /feito na v2 · conferir/);
    assert.match(rev, /data-filter="conferir">Para conferir <span class="mono" data-n="conferir">1</);
    assert.match(rev, /data-not-yet="\d+">Ainda não/);
    const [{ id }] = await q('SELECT id FROM episode_comments WHERE episode_id = $1 ORDER BY id LIMIT 1', [ep]);
    assert.equal((await send(editor, `/episodios/${ep}/comentarios/${id}/ainda-nao`)).status, 403, 'só quem revisa devolve');
    const back = await send(gestao, `/episodios/${ep}/comentarios/${id}/ainda-nao`);
    assert.equal(back.status, 200); assert.equal(back.json.summary.aberto, 1); assert.equal(back.json.summary.conferir, 0);
    assert.match(back.json.html, /data-state="aberto"/);
    await send(editor, `/episodios/${ep}/comentarios/${id}/feito`, { feito: '1' });
    const ok = await send(gestao, `/episodios/${ep}/comentarios/${id}/resolver`, { resolved: '1' });
    assert.equal(ok.json.summary.resolvido, 1); assert.match(ok.json.html, /data-state="resolvido"/); assert.match(ok.json.html, /conferido/);
  });

  it('marcadores do DaVinci: EDL com timecode no quadro certo, trecho com duração e o "~" de orientação', async () => {
    await comment({ at_ms: '3723000', end_ms: '', body: 'Mostrar o Acauã | fazendo a pergunta' });
    const r = await gestao.get(`/episodios/${ep}/marcadores?formato=davinci&quais=todos&fps=25&inicio=01`);
    assert.equal(r.status, 200);
    const edl = r.text;
    assert.match(edl, /^TITLE: EP\.019 ajustes da revisao\r\nFCM: NON-DROP FRAME/);
    assert.match(edl, /001 {2}001 {6}V {5}C {8}01:01:32:00 01:01:40:13 01:01:32:00 01:01:40:13/, '92 s a 25 qps, linha do tempo em 01:00:00:00');
    assert.match(edl, /\|C:ResolveColorGreen \|M:~ \[minutagem da v1\] Pode cortar daqui até a pergunta do Acauã \(Gil Gestão\) \|D:213/);
    assert.match(edl, /02:02:03:00/, '1h02m03s depois do início em 01:00:00:00');
    assert.match(edl, /\|M:~ \[minutagem da v1\] Mostrar o Acauã \/ fazendo a pergunta/, 'a barra vertical (separador do EDL) vira /');
    const open = (await gestao.get(`/episodios/${ep}/marcadores?formato=davinci&fps=25&inicio=00`)).text;
    assert.doesNotMatch(open, /Pode cortar daqui/, 'por padrão, só o que falta conferir');
    assert.match(open, /00:00:00:00|01:02:03:00/);
  });

  it('marcadores do Premiere: XML com uma sequência, marcadores em quadros desde o início, cor por estado e o aviso', async () => {
    await q('UPDATE episode_files SET width = 3840, height = 2160 WHERE episode_id = $1', [ep]);
    const r = await editor.get(`/episodios/${ep}/marcadores?formato=premiere&quais=todos&fps=29.97`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /ep019-ajustes-da-revisao\.xml/);
    const x = r.text;
    assert.match(x, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<!DOCTYPE xmeml>/);
    assert.match(x, /<!-- EP\.019 · Conversa com Mari\. As minutagens são aproximadas/);
    assert.match(x, /<name>EP\.019 · ajustes da revisão<\/name>/);
    assert.match(x, /<rate><timebase>30<\/timebase><ntsc>TRUE<\/ntsc><\/rate>/, '29,97 = base 30 com NTSC');
    assert.match(x, /<width>3840<\/width><height>2160<\/height>/, 'sequência no tamanho do vídeo');
    // 92 s a 29,97 = quadro 2757; trecho até 100,5 s = quadro 3012
    assert.match(x, /<comment>\[minutagem da v1\] Pode cortar daqui até a pergunta do Acauã \(Gil Gestão · conferido\)\. Minutagem aproximada[^<]*<\/comment>\s*<name>~ Pode cortar daqui[^<]*<\/name>\s*<in>2757<\/in>\s*<out>3012<\/out>\s*<\/marker>/, 'conferido fica com a cor padrão (verde)');
    assert.match(x, /<name>~ Mostrar o Acauã \/ fazendo a pergunta<\/name>\s*<in>111578<\/in>\s*<out>-1<\/out>\s*<pproColor>4281740498<\/pproColor>/, 'ponto = out -1; em aberto = vermelho');
  });

  it('a janela dos marcadores abre no Premiere e explica como importar', async () => {
    const page = (await editor.get(`/episodios/${ep}`)).text;
    const modal = page.split('id="modal-marcadores"')[1].split('</dialog>')[0];
    assert.match(modal, /value="premiere" checked/);
    assert.match(modal, /Arquivo &gt; Importar/);
    assert.match(modal, /data-mk-only="davinci" hidden>A linha do tempo começa em/);
  });

  it('lista em texto: diz que a minutagem é orientação e traz cada ajuste', async () => {
    const r = await editor.get(`/episodios/${ep}/marcadores?formato=texto&quais=todos`);
    assert.equal(r.status, 200);
    assert.match(r.text, /IMPORTANTE: As minutagens são aproximadas/);
    assert.match(r.text, /≈ 1:32 – 1:40 \(minutagem da v1\) · conferido/);
    assert.match(r.text, /Pode cortar daqui até a pergunta do Acauã/);
  });

  it('timecode: 29,97 sem drop frame e quadros por segundo desconhecidos caem no padrão', () => {
    assert.equal(review.timecode(3600000, 29.97, 0), '00:59:56:12');
    assert.equal(review.timecode(0, 24, 1), '01:00:00:00');
    assert.equal(review.pickFps('29.97'), 29.97); assert.equal(review.pickFps('abc'), 30); assert.equal(review.pickFps('23.98'), 23.976);
  });
});
