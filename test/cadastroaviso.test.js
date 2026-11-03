const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const recordChanges = require('../src/services/recordChanges');
const comments = require('../src/services/comments');

describe('avisos de alteração e exclusão de cadastro; edição de comentários', () => {
  const as = {}; const u = {}; let app;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const notes = (userId, type) => q('SELECT title, body, url FROM notifications WHERE user_id = $1 AND type = $2 ORDER BY id', [userId, type]);
  const clear = () => q('DELETE FROM notifications');
  const setCfg = (type, inApp) => q('UPDATE notification_settings SET in_app = $2 WHERE type = $1', [type, inApp]);
  const json = async (user, path, form) => {
    const r = await as[user].post(path, { _csrf: await as[user].csrf('/'), ...form }, { headers: { accept: 'application/json' } });
    return { status: r.status, body: r.text.startsWith('{') ? JSON.parse(r.text) : r.text, location: r.location };
  };

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role, name] of [['gestao', 'gestao', 'Gil Gestão'], ['prod', 'produtora', 'Paula Produtora'], ['editor', 'editor_video', 'Edu Editor']]) {
      u[k] = await h.createUser({ name, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`);
    }
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('os dois tipos existem, vêm ligados no painel, sem papéis extras, e aparecem na configuração da gestão', async () => {
    const rows = await q("SELECT type, in_app, roles FROM notification_settings WHERE type IN ('alteracao','exclusao') ORDER BY type");
    assert.deepEqual(rows.map((r) => [r.type, r.in_app, r.roles]), [['alteracao', true, []], ['exclusao', true, []]]);
    const page = (await as.gestao.get('/gestao/notificacoes')).text;
    assert.match(page, /Cadastro alterado/); assert.match(page, /Cadastro excluído/);
  });

  it('serviço: avisa o responsável (antigo e novo) com o que mudou; ninguém avisa a si mesmo; sem mudança, sem aviso', async () => {
    await clear();
    const [g] = await q("INSERT INTO guests (name, instagram, profile, status, owner_id) VALUES ('Dra. Ana', 'ana.x', 'medico', 'prospect', $1) RETURNING id", [u.prod.id]);
    const before = await recordChanges.snapshot('guest', g.id);
    await q("UPDATE guests SET name = 'Dra. Ana Lima', email = 'ana@x.com', owner_id = $2 WHERE id = $1", [g.id, u.editor.id]);
    await recordChanges.updated({ type: 'guest', before, actor: u.gestao });
    const prod = await notes(u.prod.id, 'alteracao'); const ed = await notes(u.editor.id, 'alteracao');
    assert.equal(prod.length, 1, 'quem deixou de ser responsável também fica sabendo'); assert.equal(ed.length, 1);
    assert.match(prod[0].title, /Gil Gestão alterou o convidado: Dra\. Ana Lima/); assert.equal(prod[0].body, 'Mudou: nome, e-mail e responsável.'); assert.equal(prod[0].url, `/convidados/${g.id}`);
    await clear();
    await recordChanges.updated({ type: 'guest', before: await recordChanges.snapshot('guest', g.id), actor: u.gestao });
    assert.equal((await q('SELECT 1 FROM notifications')).length, 0, 'nada mudou: nada de aviso');
    const b2 = await recordChanges.snapshot('guest', g.id);
    await q("UPDATE guests SET phone = '+5511999990000' WHERE id = $1", [g.id]);
    await recordChanges.updated({ type: 'guest', before: b2, actor: u.editor });
    assert.equal((await notes(u.editor.id, 'alteracao')).length, 0, 'o responsável que mexeu não recebe aviso do que ele mesmo fez');
  });

  it('configurável: desligar o tipo na gestão e silenciar por pessoa calam o aviso', async () => {
    await clear();
    const [s] = await q("INSERT INTO sponsors (company, stage, owner_id) VALUES ('Marca Z', 'prospect', $1) RETURNING id", [u.prod.id]);
    const run = async () => { const b = await recordChanges.snapshot('sponsor', s.id); await q("UPDATE sponsors SET notes = $2 WHERE id = $1", [s.id, `n${Math.random()}`]); await recordChanges.updated({ type: 'sponsor', before: b, actor: u.gestao }); };
    await setCfg('alteracao', false);
    try { await run(); assert.equal((await notes(u.prod.id, 'alteracao')).length, 0, 'tipo desligado na gestão'); } finally { await setCfg('alteracao', true); }
    await q("INSERT INTO notification_mutes (user_id, type) VALUES ($1, 'alteracao')", [u.prod.id]);
    await run(); assert.equal((await notes(u.prod.id, 'alteracao')).length, 0, 'silenciado pela pessoa');
    await q("DELETE FROM notification_mutes WHERE user_id = $1", [u.prod.id]);
    await run(); const n = await notes(u.prod.id, 'alteracao');
    assert.equal(n.length, 1); assert.match(n[0].title, /alterou o patrocinador: Marca Z/); assert.equal(n[0].body, 'Mudou: observações.');
    // pela tela: a pessoa liga e desliga o silêncio e a gestão salva a configuração
    await as.gestao.act('/gestao/notificacoes', { alteracao_in_app: '1', exclusao_in_app: '1', tarefa_in_app: '1' }, { from: '/gestao/notificacoes' });
    assert.equal((await q("SELECT in_app FROM notification_settings WHERE type = 'exclusao'"))[0].in_app, true);
    await q('UPDATE notification_settings SET in_app = true'); // a tela grava todos os tipos: devolve o estado normal
  });

  it('episódio, corte e tarefa: cada um avisa o seu responsável; tarefa não repete o que já tem aviso próprio', async () => {
    await clear();
    const [ep] = await q("INSERT INTO episodes (title, editor_id) VALUES ('Conversa X', $1) RETURNING id", [u.editor.id]);
    let b = await recordChanges.snapshot('episode', ep.id);
    await q("UPDATE episodes SET title = 'Conversa Y' WHERE id = $1", [ep.id]); await recordChanges.updated({ type: 'episode', before: b, actor: u.gestao });
    assert.match((await notes(u.editor.id, 'alteracao'))[0].title, /alterou o episódio: Conversa Y/);
    const [t] = await q("INSERT INTO tasks (title, kind, status, assignee_id, created_by) VALUES ('Tarefa 1', 'geral', 'a_fazer', $1, $2) RETURNING id", [u.prod.id, u.gestao.id]);
    await clear();
    b = await recordChanges.snapshot('task', t.id);
    await q("UPDATE tasks SET status = 'feito', due_on = CURRENT_DATE + 3, assignee_id = $2 WHERE id = $1", [t.id, u.editor.id]);
    await recordChanges.updated({ type: 'task', before: b, actor: u.gestao });
    assert.equal((await q('SELECT 1 FROM notifications')).length, 0, 'status, prazo e responsável da tarefa têm aviso próprio');
    b = await recordChanges.snapshot('task', t.id);
    await q("UPDATE tasks SET title = 'Tarefa 1 revisada', description = 'novo texto' WHERE id = $1", [t.id]);
    await recordChanges.updated({ type: 'task', before: b, actor: u.gestao });
    assert.equal((await notes(u.editor.id, 'alteracao'))[0].body, 'Mudou: título e descrição.');
    assert.equal(recordChanges.isPlace('user'), false);
  });

  it('pela tela: editar e excluir tarefa avisam o responsável; excluir leva o nome e nenhum endereço', async () => {
    await clear();
    const [t] = await q("INSERT INTO tasks (title, kind, status, assignee_id, created_by) VALUES ('Subir cortes', 'geral', 'a_fazer', $1, $2) RETURNING id", [u.prod.id, u.gestao.id]);
    const r = await as.gestao.act(`/tarefas/${t.id}`, { title: 'Subir os cortes do EP.30', status: 'a_fazer', kind: 'geral', assignee_id: u.prod.id }, { from: `/tarefas/${t.id}` });
    assert.equal(r.status, 302);
    const ch = await notes(u.prod.id, 'alteracao');
    assert.equal(ch.length, 1); assert.match(ch[0].title, /Gil Gestão alterou a tarefa: Subir os cortes do EP\.30/);
    assert.equal(ch[0].url, `/tarefas/${t.id}`);
    await as.gestao.act(`/tarefas/${t.id}/excluir`, {}, { from: '/tarefas' });
    const gone = await notes(u.prod.id, 'exclusao');
    assert.equal(gone.length, 1); assert.match(gone[0].title, /Gil Gestão excluiu a tarefa: Subir os cortes do EP\.30/); assert.equal(gone[0].url, null);
  });

  it('pela tela: excluir convidado avisa o responsável', async () => {
    await clear();
    const [g] = await q("INSERT INTO guests (name, instagram, profile, status, owner_id) VALUES ('Dr. Bento', 'bento.x', 'medico', 'prospect', $1) RETURNING id", [u.prod.id]);
    const r = await as.gestao.act(`/convidados/${g.id}/excluir`, {}, { from: '/convidados' });
    assert.equal(r.status, 302);
    const gone = await notes(u.prod.id, 'exclusao');
    assert.equal(gone.length, 1); assert.match(gone[0].title, /excluiu o convidado: Dr\. Bento/);
    assert.equal((await q('SELECT 1 FROM guests WHERE id = $1', [g.id])).length, 0);
  });

  describe('comentários: editar', () => {
    let task; let c1;
    before(async () => {
      [task] = await q("INSERT INTO tasks (title, kind, status, assignee_id, created_by) VALUES ('Tarefa dos comentários', 'geral', 'a_fazer', $1, $2) RETURNING id", [u.prod.id, u.gestao.id]);
      const r = await comments.add({ type: 'task', id: task.id, author: u.gestao, html: '<p>Primeira versão</p>' });
      c1 = r.comment;
    });

    it('só quem escreveu edita; gravam texto limpo, a marca de editado e o HTML seguro', async () => {
      const other = await json('prod', `/comentarios/${c1.id}/editar`, { texto_html: '<p>Invasão</p>', voltar: `/tarefas/${task.id}` });
      assert.equal(other.status, 302);
      assert.equal((await q('SELECT body FROM comments WHERE id = $1', [c1.id]))[0].body, 'Primeira versão', 'outra pessoa não edita (nem a gestão edita o dos outros)');
      const r = await json('gestao', `/comentarios/${c1.id}/editar`, { texto_html: '<p onclick="x()">Segunda <b>versão</b><script>alert(1)</script></p>', voltar: `/tarefas/${task.id}` });
      assert.equal(r.status, 302); assert.equal(r.location, `/tarefas/${task.id}`);
      const [row] = await q('SELECT body, body_html, edited_at FROM comments WHERE id = $1', [c1.id]);
      assert.equal(row.body, 'Segunda versão'); assert.match(row.body_html, /<strong>versão<\/strong>/); assert.doesNotMatch(row.body_html, /script|onclick/);
      assert.ok(row.edited_at, 'marcado como editado');
    });

    it('a tela mostra o lápis só para o autor, o ícone de editado e o apagar em ícone', async () => {
      const mine = (await as.gestao.get(`/tarefas/${task.id}`)).text;
      assert.match(mine, new RegExp(`data-comment-edit data-action="/comentarios/${c1.id}/editar"`));
      assert.match(mine, /class="cmt-edited"/); assert.match(mine, /aria-label="Apagar o comentário"/); assert.doesNotMatch(mine, />apagar</);
      assert.match(mine, /id="modal-comment-edit"/);
      const theirs = (await as.prod.get(`/tarefas/${task.id}`)).text;
      assert.doesNotMatch(theirs, /data-comment-edit data-action/, 'quem não escreveu não vê o lápis');
      assert.match((await as.gestao.get(`/tarefas/${task.id}`)).text, /aria-label="Comentar"/);
    });

    it('mencionar alguém na edição avisa só quem entrou agora, uma vez', async () => {
      await clear();
      await json('gestao', `/comentarios/${c1.id}/editar`, { texto_html: '<p>Segunda versão, @Edu Editor veja</p>', voltar: '/' });
      const first = await notes(u.editor.id, 'comentario');
      assert.equal(first.length, 1); assert.match(first[0].title, /Gil Gestão mencionou você em tarefa/);
      await json('gestao', `/comentarios/${c1.id}/editar`, { texto_html: '<p>Terceira, @Edu Editor veja de novo</p>', voltar: '/' });
      assert.equal((await notes(u.editor.id, 'comentario')).length, 1, 'quem já era mencionado não recebe de novo');
    });

    it('comentário não fica vazio; comentário inexistente dá erro claro', async () => {
      const r = await comments.update(c1.id, u.gestao, { html: '<p><br></p>' });
      assert.match(r.error, /Escreva o comentário/);
      assert.equal((await comments.update(999999, u.gestao, { html: '<p>x</p>' })).status, 404);
      assert.equal((await comments.update(c1.id, u.editor, { html: '<p>x</p>' })).status, 403);
    });

    it('apagar o próprio comentário continua valendo (e a gestão apaga o dos outros)', async () => {
      const r = await comments.add({ type: 'task', id: task.id, author: u.prod, html: '<p>da Paula</p>' });
      assert.equal((await comments.remove(r.comment.id, u.gestao)).ok, true);
    });
  });

  describe('comentários da revisão do vídeo: editar', () => {
    let ep; let c;
    before(async () => {
      [ep] = await q("INSERT INTO episodes (title, status) VALUES ('Ep revisão', 'em_revisao') RETURNING id");
      await q("INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, status, uploaded_by) VALUES ($1, 'editado', 'ep.mp4', 1000, 'k/ep.mp4', 'pronto', $2)", [ep.id, u.editor.id]);
      [c] = await q("INSERT INTO episode_comments (episode_id, at_ms, body, body_html, author_id) VALUES ($1, 5000, 'corta aqui', '<p>corta aqui</p>', $2) RETURNING id", [ep.id, u.gestao.id]);
    });

    it('autor edita sem recarregar: a resposta traz o item pronto, com ícones e a marca de editado', async () => {
      const r = await json('gestao', `/episodios/${ep.id}/comentarios/${c.id}/editar`, { body_html: '<p>corta aqui <b>antes</b></p>' });
      assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.id, c.id);
      assert.match(r.body.html, /<strong>antes<\/strong>/); assert.match(r.body.html, /class="cmt-edited"/);
      assert.match(r.body.html, /aria-label="Editar o comentário"/); assert.match(r.body.html, /aria-label="Apagar o comentário"/); assert.doesNotMatch(r.body.html, />apagar<|marcar como resolvido</);
      const [row] = await q('SELECT body, at_ms, edited_at FROM episode_comments WHERE id = $1', [c.id]);
      assert.equal(row.body, 'corta aqui antes'); assert.equal(row.at_ms, 5000, 'a minutagem não muda'); assert.ok(row.edited_at);
    });

    it('outra pessoa não edita; vazio e inexistente são recusados', async () => {
      assert.equal((await json('editor', `/episodios/${ep.id}/comentarios/${c.id}/editar`, { body_html: '<p>x</p>' })).status, 403);
      assert.equal((await json('gestao', `/episodios/${ep.id}/comentarios/${c.id}/editar`, { body_html: '<p><br></p>' })).status, 422);
      assert.equal((await json('gestao', `/episodios/${ep.id}/comentarios/999999/editar`, { body_html: '<p>x</p>' })).status, 404);
      assert.equal((await q('SELECT body FROM episode_comments WHERE id = $1', [c.id]))[0].body, 'corta aqui antes');
    });

    it('a aba de revisão usa ícones: enviar, comentário geral, resolver, editar e apagar', async () => {
      const page = (await as.gestao.get(`/episodios/${ep.id}`)).text;
      assert.match(page, /id="modal-review-edit"/); assert.match(page, /data-dialog="modal-review-edit"/);
      assert.match(page, /aria-label="Marcar como resolvido"/); assert.doesNotMatch(page, />Comentário geral<|>Comentar neste ponto<|>apagar</);
      const res = await json('gestao', `/episodios/${ep.id}/comentarios/${c.id}/resolver`, { resolved: '1' });
      assert.equal(res.body.resolved, true);
      assert.match((await as.gestao.get(`/episodios/${ep.id}`)).text, /aria-label="Reabrir o comentário"/);
    });
  });
});
