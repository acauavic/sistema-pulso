const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const trash = require('../src/services/trash');

describe('Lixeira e ações em massa no Conteúdo', () => {
  let app; const as = {}; const u = {}; let ep; let ep2;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const act = (who, p, form, from = '/conteudo') => as[who].act(p, form, { from });
  const batchOf = (html) => html.match(/\/lixeira\/lote\/([0-9a-f-]{36})\/restaurar/)?.[1];
  // o aviso com "Desfazer" aparece na página seguinte
  const undoAfter = async (who, location) => batchOf((await as[who].get(location)).text);
  const clip = async (title, epId = ep.id, extra = {}) => {
    const key = `pp/cortes/${title.replace(/\W/g, '')}.mp4`;
    h.b2Store.set(key, { body: Buffer.from('video'), contentType: 'video/mp4' });
    const [c] = await q("INSERT INTO episode_clips (title, status, episode_id, storage_key, size_bytes, created_by, request_id) VALUES ($1, 'pronto', $2, $3, 5, $4, $5) RETURNING *", [title, epId, key, u.editor.id, extra.request_id || null]);
    return c;
  };
  const cover = async (epId, kind, clipId = null) => {
    const key = `pp/capas/${kind}-${Math.random().toString(36).slice(2)}.jpg`;
    h.b2Store.set(key, { body: Buffer.from('jpg'), contentType: 'image/jpeg' });
    const [c] = await q("INSERT INTO episode_covers (episode_id, clip_id, kind, spec, storage_key, mime, width, height, size_bytes) VALUES ($1, $2, $3, '{}', $4, 'image/jpeg', 1080, 1350, 3) RETURNING *", [epId, clipId, kind, key]);
    return c;
  };

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['editor', 'editor_video'], ['prod', 'produtora']]) {
      u[k] = await h.createUser({ name: `${k} Lima`, email: `${k}@lx.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@lx.com`);
    }
    [ep] = await q("INSERT INTO episodes (number, title, status, published_at) VALUES (30, 'Saúde e dados', 'publicado', now()) RETURNING *");
    [ep2] = await q("INSERT INTO episodes (number, title, status) VALUES (31, 'Clínica do futuro', 'gravado') RETURNING *");
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('apagar um corte manda para a lixeira com capas, comentários e publicação; "Desfazer" devolve tudo como estava', async () => {
    const c = await clip('Corte da vigilância');
    const cv = await cover(ep.id, 'reel_cover', c.id);
    await q('UPDATE episode_clips SET cover_id = $2 WHERE id = $1', [c.id, cv.id]);
    await q("INSERT INTO comments (entity_type, entity_id, body, author_id) VALUES ('clip', $1, 'Corta antes da risada', $2)", [c.id, u.gestao.id]);
    const [pub] = await q("INSERT INTO episode_publications (episode_id, clip_id, title, platforms, status) VALUES ($1, $2, 'Post do corte', '{instagram}', 'publicado') RETURNING *", [ep.id, c.id]);

    const r = await act('gestao', `/cortes/${c.id}/excluir`, {});
    assert.equal(r.status, 302);
    assert.equal((await q('SELECT 1 FROM episode_clips WHERE id = $1', [c.id])).length, 0);
    assert.equal((await q("SELECT 1 FROM comments WHERE entity_type = 'clip' AND entity_id = $1", [c.id])).length, 0, 'o comentário sai junto');
    assert.equal((await q('SELECT clip_id FROM episode_publications WHERE id = $1', [pub.id]))[0].clip_id, null);
    assert.ok(h.b2Store.has(c.storage_key) && h.b2Store.has(cv.storage_key), 'os arquivos ficam no armazenamento enquanto está na lixeira');
    const [t] = await q("SELECT * FROM trash_items WHERE kind = 'clip' AND ref_id = $1", [String(c.id)]);
    assert.equal(t.title, 'Corte da vigilância'); assert.match(t.context, /EP\.030/);
    assert.deepEqual(t.storage_keys.sort(), [c.storage_key, cv.storage_key].sort());

    const batch = await undoAfter('gestao', r.location);
    assert.equal(batch, t.batch, 'o aviso depois de apagar traz o Desfazer');
    const back = await act('gestao', `/lixeira/lote/${batch}/restaurar`, { voltar: '/conteudo' });
    assert.equal(back.location, '/conteudo');
    const [again] = await q('SELECT * FROM episode_clips WHERE id = $1', [c.id]);
    assert.equal(again.title, 'Corte da vigilância'); assert.equal(again.cover_id, cv.id, 'volta com a capa escolhida');
    assert.equal((await q("SELECT 1 FROM comments WHERE entity_type = 'clip' AND entity_id = $1", [c.id])).length, 1);
    assert.equal((await q('SELECT clip_id FROM episode_publications WHERE id = $1', [pub.id]))[0].clip_id, c.id, 'a publicação volta a apontar para o corte');
    assert.equal((await q('SELECT 1 FROM trash_items')).length, 0);
  });

  it('episódio vai com tarefas, cortes e o financeiro cancelado; restaurar devolve o lançamento como era', async () => {
    const [e] = await q("INSERT INTO episodes (number, title, status) VALUES (40, 'Para apagar', 'gravado') RETURNING *");
    const [task] = await q("INSERT INTO tasks (title, kind, episode_id, created_by) VALUES ('Bastidores', 'geral', $1, $2) RETURNING *", [e.id, u.gestao.id]);
    const c = await clip('Corte do 40', e.id);
    const [fin] = await q("INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, status, episode_id, auto_key) VALUES ('saida', 'estudio', 'Estúdio do 40', 10000, '2026-11-01', 'previsto', $1, 'teste-e40') RETURNING *", [e.id]);

    const r = await act('gestao', `/episodios/${e.id}/excluir`, {}, `/episodios/${e.id}`);
    assert.equal(r.status, 302);
    assert.equal((await q('SELECT 1 FROM tasks WHERE id = $1', [task.id])).length, 0);
    assert.equal((await q('SELECT status FROM fin_entries WHERE id = $1', [fin.id]))[0].status, 'cancelado', 'o financeiro cancela como antes');
    assert.ok(h.b2Store.has(c.storage_key));
    const [t] = await q("SELECT * FROM trash_items WHERE kind = 'episode'");
    assert.equal(t.title, 'EP.040 · Para apagar');

    const page = (await as.gestao.get('/lixeira')).text;
    assert.match(page, /EP\.040 · Para apagar/); assert.match(page, /15 dias/);
    const out = await act('gestao', `/lixeira/${t.id}/restaurar`, {}, '/lixeira');
    assert.equal(out.location, `/episodios/${e.id}`);
    assert.equal((await q('SELECT 1 FROM tasks WHERE id = $1', [task.id])).length, 1);
    assert.equal((await q('SELECT 1 FROM episode_clips WHERE id = $1', [c.id])).length, 1);
    const [f] = await q('SELECT status, episode_id FROM fin_entries WHERE id = $1', [fin.id]);
    assert.equal(f.status, 'previsto'); assert.equal(f.episode_id, e.id);
  });

  it('o que depende de algo que também foi apagado avisa para restaurar antes o outro', async () => {
    const [e] = await q("INSERT INTO episodes (number, title, status) VALUES (41, 'Dependência', 'gravado') RETURNING *");
    const c = await clip('Corte órfão', e.id);
    const a = await trash.remove('clip', c.id, { user: u.gestao });
    await trash.remove('episode', e.id, { user: u.gestao });
    const fail = await trash.restore(a.id);
    assert.match(fail.error, /o episódio de que ele depende não existe mais.*EP\.041 · Dependência/);
    const [te] = await q("SELECT id FROM trash_items WHERE kind = 'episode' AND ref_id = $1", [String(e.id)]);
    assert.ok((await trash.restore(te.id)).ok);
    assert.ok((await trash.restore(a.id)).ok);
    assert.equal((await q('SELECT episode_id FROM episode_clips WHERE id = $1', [c.id]))[0].episode_id, e.id);
  });

  it('cada pessoa vê e restaura o que ela apagou; só a gestão vê tudo e apaga de vez', async () => {
    const mine = await clip('Corte do editor');
    await act('editor', `/cortes/${mine.id}/excluir`, {});
    const other = await clip('Corte da gestão');
    await act('gestao', `/cortes/${other.id}/excluir`, {});
    const [tMine] = await q("SELECT * FROM trash_items WHERE title = 'Corte do editor'");
    const [tOther] = await q("SELECT * FROM trash_items WHERE title = 'Corte da gestão'");

    const page = (await as.editor.get('/lixeira')).text;
    assert.match(page, /Corte do editor/); assert.doesNotMatch(page, /Corte da gestão/);
    assert.doesNotMatch(page, /apagar de vez/);
    assert.equal((await act('editor', `/lixeira/${tOther.id}/restaurar`, {}, '/lixeira')).status, 403);
    assert.equal((await act('editor', `/lixeira/${tMine.id}/apagar`, {}, '/lixeira')).status, 403);
    assert.match((await as.gestao.get('/lixeira')).text, /Corte do editor[\s\S]*apagar de vez|apagar de vez[\s\S]*Corte do editor/);

    await act('gestao', `/lixeira/${tOther.id}/apagar`, {}, '/lixeira');
    assert.equal((await q('SELECT 1 FROM trash_items WHERE id = $1', [tOther.id])).length, 0);
    assert.ok(!h.b2Store.has(other.storage_key), 'apagar de vez tira o arquivo do armazenamento');
    await act('editor', `/lixeira/${tMine.id}/restaurar`, {}, '/lixeira');
    assert.equal((await q('SELECT 1 FROM episode_clips WHERE id = $1', [mine.id])).length, 1);
  });

  it('depois de 15 dias a limpeza apaga de vez, mas não um arquivo que outro item ainda usa', async () => {
    const a = await clip('Corte vencido');
    const twin = await clip('Corte gêmeo');
    await q('UPDATE episode_clips SET storage_key = $2 WHERE id = $1', [twin.id, a.storage_key]); // mesmo arquivo (reenvio)
    const c2 = await clip('Corte vencido 2');
    await trash.remove('clip', a.id, { user: u.gestao });
    await trash.remove('clip', c2.id, { user: u.gestao });
    assert.equal(await trash.purge(), 0, 'dentro do prazo nada sai');
    await q("UPDATE trash_items SET purge_after = now() - interval '1 minute'");
    assert.equal(await trash.purge(), 2);
    assert.ok(h.b2Store.has(a.storage_key), 'o gêmeo ainda usa o arquivo');
    assert.ok(!h.b2Store.has(c2.storage_key));
    assert.equal((await q('SELECT 1 FROM trash_items')).length, 0);
  });

  it('cortes em massa: atribuir ao episódio e mandar vários para a lixeira num lote só (Desfazer devolve todos)', async () => {
    const list = [await clip('Massa 1', null), await clip('Massa 2', null), await clip('Massa 3', null)];
    const ids = list.map((c) => String(c.id));
    const page = (await as.editor.get('/conteudo?vista=cortes')).text;
    assert.match(page, /data-dl-open="modal-massa-cortes"/); assert.match(page, new RegExp(`data-dl-item data-id="${list[0].id}"`));
    assert.equal((await act('prod', '/conteudo/em-massa/cortes', { acao: 'atribuir', episode_id: ep2.id, ids })).status, 403);

    const r = await act('editor', '/conteudo/em-massa/cortes', { acao: 'atribuir', episode_id: ep2.id, ids });
    assert.equal(r.location, '/conteudo?vista=cortes');
    assert.deepEqual((await q('SELECT DISTINCT episode_id FROM episode_clips WHERE id = ANY($1)', [ids])).map((x) => x.episode_id), [ep2.id]);
    assert.match((await as.editor.get(r.location)).text, /3 cortes atribuídos ao EP\.031 Clínica do futuro/);

    const del = await act('editor', '/conteudo/em-massa/cortes', { acao: 'excluir', ids: ids.slice(0, 2) });
    assert.equal((await q('SELECT 1 FROM episode_clips WHERE id = ANY($1)', [ids])).length, 1);
    const batches = await q('SELECT DISTINCT batch FROM trash_items WHERE kind = $1 AND ref_id = ANY($2)', ['clip', ids]);
    assert.equal(batches.length, 1, 'um lote só');
    const html = (await as.editor.get(del.location)).text;
    assert.match(html, /2 cortes foram para a lixeira/);
    await act('editor', `/lixeira/lote/${batchOf(html)}/restaurar`, { voltar: '/conteudo?vista=cortes' });
    assert.equal((await q('SELECT 1 FROM episode_clips WHERE id = ANY($1)', [ids])).length, 3);
  });

  it('posts em massa: aprovar, tirar aprovação e excluir', async () => {
    const posts = [await cover(ep.id, 'post_quote'), await cover(ep.id, 'post_quote'), await cover(ep.id, 'carousel')];
    const ids = posts.map((p) => String(p.id));
    await act('gestao', '/conteudo/em-massa/posts', { acao: 'aprovar', ids });
    assert.equal((await q('SELECT count(*)::int AS n FROM episode_covers WHERE id = ANY($1) AND approved', [ids]))[0].n, 3);
    await act('gestao', '/conteudo/em-massa/posts', { acao: 'desaprovar', ids: ids.slice(0, 1) });
    assert.equal((await q('SELECT approved FROM episode_covers WHERE id = $1', [ids[0]]))[0].approved, false);
    assert.equal((await act('prod', '/conteudo/em-massa/posts', { acao: 'excluir', ids })).status, 403);
    await act('editor', '/conteudo/em-massa/posts', { acao: 'excluir', ids });
    assert.equal((await q('SELECT 1 FROM episode_covers WHERE id = ANY($1)', [ids])).length, 0);
    assert.equal((await q("SELECT 1 FROM trash_items WHERE kind = 'cover' AND ref_id = ANY($1)", [ids])).length, 3);
  });

  it('pedidos em massa: responsável, prazo e prioridade; cancelar; excluir; quem não pediu fica de fora', async () => {
    const mk = async (title, by) => (await q("INSERT INTO content_requests (kind, title, created_by) VALUES ('video', $1, $2) RETURNING *", [title, by.id]))[0];
    const r1 = await mk('Vídeo A', u.gestao); const r2 = await mk('Vídeo B', u.gestao); const r3 = await mk('Vídeo da produtora', u.prod);
    const page = (await as.gestao.get('/conteudo?vista=pedidos')).text;
    assert.match(page, /data-dl-open="modal-massa-pedidos"/);

    await act('gestao', '/conteudo/em-massa/pedidos', { acao: 'alterar', ids: [r1.id, r2.id], assignee_id: u.editor.id, due_on: '2026-11-03', priority: '1' });
    for (const id of [r1.id, r2.id]) {
      const [r] = await q("SELECT assignee_id, to_char(due_on, 'YYYY-MM-DD') AS due, priority, title FROM content_requests WHERE id = $1", [id]);
      assert.equal(r.assignee_id, u.editor.id); assert.equal(r.due, '2026-11-03'); assert.equal(r.priority, true);
    }
    assert.ok((await q('SELECT 1 FROM notifications WHERE user_id = $1 AND title LIKE $2', [u.editor.id, '%Vídeo A%'])).length, 'o novo responsável é avisado');
    await act('gestao', '/conteudo/em-massa/pedidos', { acao: 'alterar', ids: [r1.id], priority: '0' });
    const [kept] = await q("SELECT assignee_id, to_char(due_on, 'YYYY-MM-DD') AS due, priority FROM content_requests WHERE id = $1", [r1.id]);
    assert.equal(kept.assignee_id, u.editor.id, 'o que não foi escolhido fica'); assert.equal(kept.due, '2026-11-03'); assert.equal(kept.priority, false);

    const prodTry = await act('prod', '/conteudo/em-massa/pedidos', { acao: 'cancelar', ids: [r1.id, r3.id] });
    assert.match((await as.prod.get(prodTry.location)).text, /1 pedido cancelado\. 1 pedido ficou de fora/);
    assert.equal((await q('SELECT status FROM content_requests WHERE id = $1', [r3.id]))[0].status, 'cancelado');
    assert.equal((await q('SELECT status FROM content_requests WHERE id = $1', [r1.id]))[0].status, 'pedido');

    await act('gestao', '/conteudo/em-massa/pedidos', { acao: 'excluir', ids: [r1.id, r2.id] });
    assert.equal((await q('SELECT 1 FROM content_requests WHERE id = ANY($1)', [[r1.id, r2.id]])).length, 0);
    const single = await mk('Vídeo C', u.gestao);
    const r = await act('gestao', `/conteudo/pedidos/${single.id}/excluir`, {});
    assert.equal(r.location, '/conteudo?vista=pedidos');
    assert.ok(batchOf((await as.gestao.get(r.location)).text));
  });
});
