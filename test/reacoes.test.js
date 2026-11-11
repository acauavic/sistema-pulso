const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('Reações com emoji nos comentários', () => {
  const as = {}; const u = {}; let app; let g; let cid; let ep; let rid;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const notes = (who) => q("SELECT * FROM notifications WHERE user_id = $1 AND type = 'reacao' ORDER BY id", [u[who].id]);
  const react = async (who, tipo, id, emoji) => {
    const csrf = await as[who].csrf('/');
    const r = await fetch(`${app.base}/reacoes`, { method: 'POST', headers: { cookie: as[who].cookie(), 'content-type': 'application/json', 'x-csrf-token': csrf, accept: 'application/json' }, body: JSON.stringify({ tipo, id, emoji }) });
    return { status: r.status, json: await r.json() };
  };

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role, name] of [['ana', 'gestao', 'Ana Lima'], ['bia', 'gestao', 'Bia Reis'], ['edu', 'editor_video', 'Edu Melo']]) { u[k] = await h.createUser({ name, email: `${k}@rx.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@rx.com`); }
    [{ id: g }] = await q("INSERT INTO guests (name, status) VALUES ('Mari Vabo', 'prospect') RETURNING id");
    [{ id: cid }] = await q("INSERT INTO comments (entity_type, entity_id, author_id, body) VALUES ('guest', $1, $2, 'Boa pauta') RETURNING id", [g, u.ana.id]);
    [{ id: ep }] = await q("INSERT INTO episodes (number, title, status) VALUES (9, 'Ep', 'em_revisao') RETURNING id");
    [{ id: rid }] = await q("INSERT INTO episode_comments (episode_id, body, author_id) VALUES ($1, 'Corta aqui', $2) RETURNING id", [ep, u.ana.id]);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('a tela oferece as reações; reagir mostra o emoji com a contagem e avisa quem escreveu', async () => {
    let page = (await as.bia.get(`/convidados/${g}`)).text;
    assert.match(page, /data-reacts data-kind="comment" data-id="\d+"/); assert.match(page, /aria-label="Reagir com 👍"/); assert.match(page, /\/static\/reactions\.js/);
    const r = await react('bia', 'comment', cid, '👍');
    assert.equal(r.status, 200);
    assert.match(r.json.html, /react-chip mine/); assert.match(r.json.html, /title="Bia Reis"/);
    const n = await notes('ana');
    assert.equal(n.length, 1);
    assert.match(n[0].title, /Bia Reis reagiu com 👍 ao seu comentário em convidado: Mari Vabo/);
    assert.equal(n[0].body, 'Boa pauta'); assert.match(n[0].url, /^\/convidados\/\d+#comentarios$/);
    page = (await as.edu.get(`/convidados/${g}`)).text;
    assert.match(page, /class="react-chip" data-react="👍" aria-pressed="false" title="Bia Reis"/, 'para os outros, não é "mine"');
  });

  it('reações de várias pessoas somam; clicar de novo tira; o aviso não lido some e não duplica', async () => {
    const r = await react('edu', 'comment', cid, '👍');
    assert.match(r.json.html, /<span class="mono">2<\/span>/); assert.match(r.json.html, /title="Bia Reis, Edu Melo"/);
    assert.equal((await notes('ana')).length, 2);
    await react('edu', 'comment', cid, '👍');
    assert.equal((await notes('ana')).length, 1, 'o aviso de quem desistiu sai');
    await q("UPDATE notifications SET read_at = now() WHERE user_id = $1", [u.ana.id]);
    await react('bia', 'comment', cid, '👍'); await react('bia', 'comment', cid, '👍');
    assert.equal((await notes('ana')).length, 1, 'já lido: tirar e pôr de novo não avisa outra vez');
  });

  it('quem reage ao próprio comentário não recebe aviso; emoji fora da paleta e comentário inexistente são recusados', async () => {
    const before2 = (await notes('ana')).length;
    assert.equal((await react('ana', 'comment', cid, '🎉')).status, 200);
    assert.equal((await notes('ana')).length, before2);
    assert.equal((await react('bia', 'comment', cid, '💣')).status, 400);
    assert.equal((await react('bia', 'comment', 999999, '👍')).status, 404);
    assert.equal((await react('bia', 'outro', cid, '👍')).status, 400);
    assert.equal((await react('bia', 'comment', 'abc', '👍')).status, 400);
  });

  it('o aviso liga por padrão; quem silencia "Reações" deixa de receber, e a reação continua valendo; a gestão desliga para todos', async () => {
    const page = (await as.ana.get('/notificacoes')).text;
    assert.match(page, /name="silenciar" value="reacao" *>/, 'ligado por padrão: caixa de silenciar desmarcada');
    assert.match(page, /Silenciar tipos de aviso/); assert.match(page, /value="reacao" *> Reações/);
    await as.ana.act('/notificacoes/preferencias', { silenciar: ['reacao'] }, { from: '/notificacoes' });
    const n0 = (await notes('ana')).length;
    const r = await react('bia', 'comment', cid, '❤️');
    assert.equal(r.status, 200); assert.match(r.json.html, /❤️/);
    assert.equal((await notes('ana')).length, n0, 'silenciado');
    assert.match((await as.ana.get('/notificacoes')).text, /name="silenciar" value="reacao" checked/);
    await as.ana.act('/notificacoes/preferencias', {}, { from: '/notificacoes' });
    await q("UPDATE notification_settings SET in_app = false WHERE type = 'reacao'");
    await react('edu', 'comment', cid, '😂');
    assert.equal((await notes('ana')).length, n0, 'desligado pela gestão');
    await q("UPDATE notification_settings SET in_app = true WHERE type = 'reacao'");
  });

  it('comentário da revisão do vídeo também recebe reação e avisa com o link da revisão', async () => {
    const r = await react('bia', 'review', rid, '🙏');
    assert.equal(r.status, 200);
    const last = (await notes('ana')).at(-1);
    assert.match(last.title, /reagiu com 🙏 ao seu comentário em revisão do episódio: EP\.009/);
    assert.equal(last.url, `/episodios/${ep}#revisao`);
    assert.match((await as.bia.get(`/episodios/${ep}`)).text, new RegExp(`data-kind="review" data-id="${rid}"[\\s\\S]*?react-chip mine" data-react="🙏"`));
  });

  it('apagar o comentário leva as reações; lixeira do item devolve as reações junto', async () => {
    const [{ id: temp }] = await q("INSERT INTO comments (entity_type, entity_id, author_id, body) VALUES ('guest', $1, $2, 'Apagar') RETURNING id", [g, u.bia.id]);
    await react('ana', 'comment', temp, '👍');
    await as.bia.act(`/comentarios/${temp}/excluir`, {}, { from: `/convidados/${g}` });
    assert.equal((await q('SELECT 1 FROM comment_reactions WHERE comment_id = $1', [temp])).length, 0);

    const trash = require('../src/services/trash');
    const n = (await q('SELECT count(*)::int AS n FROM comment_reactions WHERE comment_id = $1', [cid]))[0].n;
    assert.ok(n > 0);
    assert.ok(await trash.remove('guest', g, { user: { id: u.ana.id, role: 'gestao' } }));
    assert.equal((await q('SELECT 1 FROM comment_reactions WHERE comment_id = $1', [cid])).length, 0);
    const [{ id: item }] = await q('SELECT id FROM trash_items ORDER BY id DESC LIMIT 1');
    await trash.restore(item);
    assert.equal((await q('SELECT count(*)::int AS n FROM comment_reactions WHERE comment_id = $1', [cid]))[0].n, n, 'as reações voltam');
  });
});
