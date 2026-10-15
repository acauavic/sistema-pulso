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

  it('o Início do editor mostra fila, os episódios dele e as tarefas, sem convidados, patrocinadores ou financeiro', async () => {
    const e2 = (await q("INSERT INTO episodes (number, title, status) VALUES (13, 'Conversa na fila', 'disponivel_edicao') RETURNING id")).rows[0];
    await q("INSERT INTO tasks (title, kind, status, assignee_id, due_on) VALUES ('Subir os cortes', 'geral', 'a_fazer', $1, CURRENT_DATE + 1)", [u.editor.id]);
    const page = (await as.editor.get('/')).text;
    assert.match(page, /Fila de edição/); assert.match(page, /EP\.013 · Conversa na fila/); assert.match(page, /Meus episódios/); assert.match(page, /EP\.012 · Conversa com Dra\. Lia/); assert.match(page, /ajustes pedidos/);
    assert.match(page, /Minhas tarefas/); assert.match(page, /Subir os cortes/);
    for (const re of [/Dra\. Lia Segredo/, /Marca Confidencial/, /Próximas gravações/, /Atividade recente/, /Convite enviado/, /Financeiro/]) assert.doesNotMatch(page, re, String(re));
    assert.doesNotMatch(page, /href="\/convidados"/, 'sem Convidados no menu'); assert.doesNotMatch(page, /href="\/patrocinadores"/, 'sem Patrocinadores no menu');
    assert.equal((await as.editor.get('/convidados')).status, 403); assert.equal((await as.editor.get('/patrocinadores')).status, 403);
    assert.equal((await as.editor.get(`/episodios/${e2.id}`)).status, 200, 'mas o episódio abre normalmente');
    // as outras pessoas continuam com o Início de sempre
    assert.match((await as.prod.get('/')).text, /Próximas gravações/);
  });

  it('o editor ainda baixa logo, moldura e QR Code do patrocinador pelo episódio, mas não os arquivos internos', async () => {
    const sp = (await q("SELECT id FROM sponsors WHERE company = 'Marca Confidencial'")).rows[0];
    const b2 = require('../src/services/b2');
    const mk = async (kind) => { const key = `pp/t/${kind}`; await b2.putObject(key, Buffer.from('x'), 'image/png'); return (await q("INSERT INTO sponsor_files (sponsor_id, kind, filename, content_type, size_bytes, storage_key) VALUES ($1, $2, 'a.png', 'image/png', 1, $3) RETURNING id", [sp.id, kind, key])).rows[0].id; };
    const logo = await mk('logo'); const audio = await mk('audio');
    assert.equal((await as.editor.get(`/patrocinadores/${sp.id}/arquivos/${logo}`)).status, 200, 'logo: liberado para quem edita');
    assert.equal((await as.editor.get(`/patrocinadores/${sp.id}/arquivos/${audio}`)).status, 404, 'áudio do briefing: só quem vê o CRM');
    assert.equal((await as.prod.get(`/patrocinadores/${sp.id}/arquivos/${audio}`)).status, 200, 'a produtora continua vendo tudo');
  });
});
