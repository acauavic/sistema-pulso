const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const prod = require('../src/services/production');

describe('editor de vídeo: avisos de cada etapa e início só com produção', () => {
  let app; const as = {}; const u = {}; let ep;
  const q = (sql, p) => h.db.query(sql, p);
  const notes = (user) => q("SELECT title, body, url FROM notifications WHERE user_id = $1 AND type = 'episodio' ORDER BY id", [user.id]).then((r) => r.rows);
  const fresh = async () => (await q('SELECT * FROM episodes WHERE id = $1', [ep.id])).rows[0];
  const move = async (who, to) => { const r = await prod.move(await fresh(), to, u[who]); assert.ok(r.ok, JSON.stringify(r)); };

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    for (const [k, name, role] of [['admin', 'Ana Admin', 'superadmin'], ['gestao', 'Gil Gestão', 'gestao'], ['prod', 'Paula Produtora', 'produtora'], ['editor', 'Edu Editor', 'editor_video'], ['editor2', 'Eva Editora', 'editor_video']]) {
      u[k] = await h.createUser({ name, email: `${k}@t.com`, role });
      as[k] = h.client(app.base); assert.equal((await as[k].login(`${k}@t.com`)).status, 302);
    }
    ep = (await q("INSERT INTO episodes (number, title, status) VALUES (12, 'Conversa com Dra. Lia', 'gravado') RETURNING *")).rows[0];
    await q("INSERT INTO guests (name, profile, status) VALUES ('Dra. Lia Segredo', 'medico', 'prospect')");
    await q("INSERT INTO sponsors (company, stage) VALUES ('Marca Confidencial', 'prospect')");
    await q("INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, status) VALUES ($1, 'bruto_video', 'cam.mp4', 10, 'k1', 'pronto')", [ep.id]);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('liberar para edição avisa todos os editores (e só eles); quem liberou não é avisado', async () => {
    await move('prod', 'disponivel_edicao');
    for (const e of ['editor', 'editor2']) {
      const n = await notes(u[e]);
      assert.equal(n.length, 1, e); assert.match(n[0].title, /Liberado para edição: EP\.012 · Conversa com Dra\. Lia/); assert.equal(n[0].url, `/episodios/${ep.id}`);
    }
    for (const o of ['prod', 'gestao', 'admin']) assert.equal((await notes(u[o])).length, 0, `${o} não recebe o aviso da fila`);
  });

  it('assumir, enviar para revisão, pedir ajustes e aprovar avisam quem precisa agir', async () => {
    await move('editor', 'em_edicao');
    assert.ok((await notes(u.prod)).some((n) => /Edu Editor assumiu a edição/.test(n.title)), 'a produção sabe quem pegou');
    assert.equal((await notes(u.editor2)).length, 1, 'o outro editor não recebe nada novo');

    await q("INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, status) VALUES ($1, 'editado', 'final.mp4', 10, 'k2', 'pronto')", [ep.id]);
    await q('UPDATE episode_checklist_items SET done = true WHERE episode_id = $1', [ep.id]); // checklists do episódio em dia
    await move('editor', 'em_revisao');
    for (const r of ['gestao', 'admin']) assert.ok((await notes(u[r])).some((n) => /Vídeo para revisar: EP\.012/.test(n.title) && /#revisao$/.test(n.url)), `${r} recebe o vídeo para revisar`);
    assert.ok(!(await notes(u.editor)).some((n) => /Vídeo para revisar/.test(n.title)), 'o editor não recebe o próprio envio');

    await q("INSERT INTO episode_comments (episode_id, body, author_id) VALUES ($1, 'Corta a pausa do minuto 3', $2)", [ep.id, u.gestao.id]);
    await move('gestao', 'em_edicao');
    const ed = await notes(u.editor);
    assert.ok(ed.some((n) => /Ajustes pedidos: EP\.012/.test(n.title)), 'o editor do episódio recebe os ajustes');
    assert.ok(!(await notes(u.editor2)).some((n) => /Ajustes pedidos/.test(n.title)), 'o outro editor não');

    await q("UPDATE episode_comments SET resolved = true WHERE episode_id = $1", [ep.id]);
    await move('editor', 'em_revisao');
    await move('gestao', 'em_finalizacao');
    assert.ok((await notes(u.editor)).some((n) => /Vídeo aprovado: EP\.012/.test(n.title)), 'o editor sabe que foi aprovado');
    assert.ok((await notes(u.prod)).some((n) => /Vídeo aprovado/.test(n.title)), 'a produção também');
    assert.ok(!(await notes(u.gestao)).some((n) => /Vídeo aprovado/.test(n.title)), 'quem aprovou não é avisado');
  });

  it('o tipo "Etapas do episódio" aparece na configuração de avisos e pode ser silenciado', async () => {
    assert.match((await as.gestao.get('/gestao/notificacoes')).text, /Etapas do episódio/);
    await as.editor.act('/notificacoes/preferencias', { silenciar: 'episodio' }, { from: '/notificacoes' });
    const before = (await notes(u.editor)).length;
    await q("UPDATE episodes SET status = 'em_edicao' WHERE id = $1", [ep.id]);
    await q('DELETE FROM episode_comments WHERE episode_id = $1', [ep.id]);
    await q("INSERT INTO episode_comments (episode_id, body, author_id) VALUES ($1, 'Mais um ajuste', $2)", [ep.id, u.gestao.id]);
    await q("UPDATE episodes SET status = 'em_revisao' WHERE id = $1", [ep.id]);
    await move('gestao', 'em_edicao');
    assert.equal((await notes(u.editor)).length, before, 'silenciado: nada novo');
  });

  it('o Início do editor mostra fila, os episódios dele e as tarefas, sem dados de convidados, patrocinadores ou financeiro', async () => {
    const e2 = (await q("INSERT INTO episodes (number, title, status) VALUES (13, 'Conversa na fila', 'disponivel_edicao') RETURNING id")).rows[0];
    await q("INSERT INTO tasks (title, kind, status, assignee_id, due_on) VALUES ('Subir os cortes', 'geral', 'a_fazer', $1, CURRENT_DATE + 1)", [u.editor.id]);
    const page = (await as.editor.get('/')).text;
    assert.match(page, /Fila de edição/); assert.match(page, /EP\.013 · Conversa na fila/); assert.match(page, /Meus episódios/); assert.match(page, /EP\.012 · Conversa com Dra\. Lia/); assert.match(page, /ajustes pedidos/);
    assert.match(page, /Minhas tarefas/); assert.match(page, /Subir os cortes/);
    for (const re of [/Dra\. Lia Segredo/, /Marca Confidencial/, /Próximas gravações/, /Atividade recente/, /Convite enviado/, /Financeiro/]) assert.doesNotMatch(page, re, String(re));
    assert.equal((await as.editor.get(`/episodios/${e2.id}`)).status, 200);
    assert.match((await as.prod.get('/')).text, /Próximas gravações/, 'as outras pessoas continuam com o Início de sempre');
  });

  it('o editor só lê convidados e patrocinadores (briefing, datas, restrições): vê, mas não cria nem muda', async () => {
    const g = (await q("SELECT id FROM guests WHERE name = 'Dra. Lia Segredo'")).rows[0]; const sp = (await q("SELECT id FROM sponsors WHERE company = 'Marca Confidencial'")).rows[0];
    for (const path of ['/convidados', `/convidados/${g.id}`, '/patrocinadores', `/patrocinadores/${sp.id}`]) assert.equal((await as.editor.get(path)).status, 200, path);
    const menu = (await as.editor.get('/tarefas')).text;
    assert.match(menu, /href="\/convidados"/); assert.match(menu, /href="\/patrocinadores"/);
    assert.equal((await as.editor.get('/convidados/novo')).status, 403);
    assert.equal((await as.editor.act(`/convidados/${g.id}/status`, { status: 'gravado' }, { from: '/' })).status, 403);
    assert.equal((await as.editor.act(`/patrocinadores/${sp.id}/avancar`, { para: 'negociacao' }, { from: '/' })).status, 403);
  });

  it('na página do episódio o editor não vê o que não é dele: sobe só o vídeo editado e vê só os passos que faz', async () => {
    const e = (await q("INSERT INTO episodes (number, title, status) VALUES (14, 'Conversa nova', 'gravado') RETURNING id")).rows[0];
    let page = (await as.editor.get(`/episodios/${e.id}`)).text;
    assert.doesNotMatch(page, /Liberar para edição<\/button>/, 'o botão da produção não aparece para ele');
    assert.match(page, /Esta etapa está com Gestão ou Produtora: liberar para edição/);
    assert.doesNotMatch(page, /data-uploader/, 'sem envio de material bruto');
    assert.match((await as.prod.get(`/episodios/${e.id}`)).text, /Liberar para edição<\/button>/);
    assert.match((await as.prod.get(`/episodios/${e.id}`)).text, /data-uploader/, 'a produção sobe o bruto');
    await q("UPDATE episodes SET status = 'em_edicao', editor_id = $2 WHERE id = $1", [e.id, u.editor.id]);
    page = (await as.editor.get(`/episodios/${e.id}`)).text;
    assert.match(page, /Vídeo editado/); assert.match(page, /data-edited="1"/, 'o editor sobe o vídeo editado');
    assert.doesNotMatch(page, /data-edited="0"/, 'mas não o material bruto');
    assert.equal((await as.editor.act(`/episodios/${e.id}/arquivos/iniciar`, { kind: 'bruto_video', filename: 'x.mp4', size: '10' }, { from: `/episodios/${e.id}` })).status, 403, 'e o servidor também recusa o bruto');
  });

  it('revisão contínua: comentar, resolver e apagar respondem em JSON (a tela atualiza sem recarregar)', async () => {
    const e = (await q("INSERT INTO episodes (number, title, status, editor_id) VALUES (15, 'Em revisão', 'em_revisao', $1) RETURNING id", [u.editor.id])).rows[0];
    const f = (await q("INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, status) VALUES ($1, 'editado', 'v1.mp4', 10, 'kv1', 'pronto') RETURNING id", [e.id])).rows[0];
    const api = async (client, path, body) => {
      const token = await client.csrf('/');
      const r = await fetch(`${app.base}${path}`, { method: 'POST', headers: { cookie: client.cookie(), accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': token }, body: new URLSearchParams(body) });
      return { status: r.status, json: await r.json().catch(() => null) };
    };
    const a = await api(as.gestao, `/episodios/${e.id}/comentarios`, { body: 'Corta a pausa <b>aqui</b>', at_ms: '83000', file_id: String(f.id) });
    assert.equal(a.status, 200); assert.ok(a.json.ok);
    assert.deepEqual([a.json.comment.clock, a.json.comment.at_ms, a.json.comment.author, a.json.comment.resolved], ['1:23', 83000, 'Gil Gestão', false]);
    assert.equal(a.json.comment.body, 'Corta a pausa <b>aqui</b>', 'o texto volta como está (a tela insere como texto, sem HTML)');
    assert.deepEqual(a.json.counts, { total: 1, open: 1 });
    const g = await api(as.gestao, `/episodios/${e.id}/comentarios`, { body: 'Comentário geral', at_ms: '' });
    assert.equal(g.json.comment.clock, null); assert.deepEqual(g.json.counts, { total: 2, open: 2 });
    const r1 = await api(as.editor, `/episodios/${e.id}/comentarios/${a.json.id}/resolver`, { resolved: '1' });
    assert.deepEqual([r1.json.ok, r1.json.resolved, r1.json.counts.open], [true, true, 1]);
    assert.equal((await api(as.editor, `/episodios/${e.id}/comentarios/${a.json.id}/resolver`, { resolved: '0' })).json.counts.open, 2, 'reabrir');
    // só quem escreveu (ou a gestão) apaga; o editor não apaga o da gestão
    const denied = await api(as.editor, `/episodios/${e.id}/comentarios/${g.json.id}/excluir`, {});
    assert.equal(denied.status, 403); assert.equal(denied.json.ok, false);
    const del = await api(as.gestao, `/episodios/${e.id}/comentarios/${g.json.id}/excluir`, {});
    assert.deepEqual([del.status, del.json.ok, del.json.counts.total], [200, true, 1]);
    // a página traz os controles do player e os ganchos da tela contínua
    const page = (await as.editor.get(`/episodios/${e.id}`)).text;
    for (const re of [/data-playpause/, /data-skip="-10"/, /data-skip="5"/, /data-speed/, /data-comment-list/, /data-comment-delete/, /data-no-comments/, /Atalhos: espaço pausa/]) assert.match(page, re, String(re));
  });
});
