// Mensagens: @menções, @todos, itens citados com # (links clicáveis) e a escolha de avisos (padrão da pessoa e por conversa).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('./helpers');
const chat = require('../src/services/chat');
const relay = require('../src/services/chatRelay');

describe('Mensagens: menções, citações e avisos sob medida', () => {
  let app; const u = {}; const c = {}; let g; let dm; let ep;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const uid = () => crypto.randomUUID();
  const post = async (who, path, body = {}) => {
    const csrf = await who.csrf('/mensagens');
    const r = await fetch(`${app.base}${path}`, { method: 'POST', redirect: 'manual', headers: { cookie: who.cookie(), accept: 'application/json', 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const get = async (who, path) => { const r = await fetch(`${app.base}${path}`, { headers: { cookie: who.cookie(), accept: 'application/json' } }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const say = (who, conv, html) => post(who, `/mensagens/conversas/${conv}/mensagens`, { client_id: uid(), html: `<p>${html}</p>` });
  const notice = async (conv, msg) => chat.handleTask('tarefa.aviso', { conversationId: conv, messageId: msg });
  const avisos = (who, conv) => q("SELECT title FROM notifications WHERE user_id = $1 AND type = 'mensagem' AND url = $2 AND title NOT LIKE '%adicionou você%' ORDER BY id", [who.id, `/mensagens/${conv}`]);

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    relay.setTransport(async () => 'teste');
    for (const [k, name, role] of [['ana', 'Ana Gestão', 'gestao'], ['bia', 'Bia Produtora', 'produtora'], ['edu', 'Edu Editor', 'editor_video']]) {
      u[k] = await h.createUser({ name, email: `${k}@mc.com`, role }); c[k] = h.client(app.base); await c[k].login(`${k}@mc.com`);
    }
    g = (await post(c.ana, '/mensagens/conversas', { tipo: 'grupo', nome: 'Edição EP.030', pessoas: [u.bia.id, u.edu.id] })).json.id;
    dm = (await post(c.ana, '/mensagens/conversas', { tipo: 'pessoa', pessoa: u.bia.id })).json.id;
    ep = (await q("INSERT INTO episodes (number, title, status) VALUES (30, 'Conversa com Dra. Social', 'gravado') RETURNING id"))[0].id;
  });
  after(async () => { await relay.drain(); await app.close(); await h.db.close(); });

  it('@Nome marca quem participa do grupo; @todos marca o grupo; quem escreveu não se marca', async () => {
    const m1 = (await say(c.ana, g, '@Bia Produtora pode revisar? E @Ana Gestão também')).json.message;
    assert.deepEqual(m1.mentions, [u.bia.id]); assert.equal(m1.mention_all, false);
    const m2 = (await say(c.ana, g, 'Atenção @todos: gravação amanhã')).json.message;
    assert.equal(m2.mention_all, true);
    const m3 = (await say(c.ana, dm, '@Bia oi')).json.message;
    assert.deepEqual(m3.mentions, [], 'conversa individual não tem menção');
    const [conv] = (await get(c.bia, '/mensagens/conversas')).json.conversations.filter((x) => x.id === g);
    assert.equal(conv.mentions_unread, 2);
  });

  it('"só quando me marcarem": mensagem comum não avisa, menção avisa com "mencionou você"; individual continua avisando', async () => {
    assert.equal((await post(c.edu, '/mensagens/avisos', { modo: 'mencoes' })).status, 200);
    const [{ last_message_id: last }] = await q('SELECT last_message_id FROM chat_conversations WHERE id = $1', [g]);
    await post(c.edu, `/mensagens/conversas/${g}/lida`, { ate: Number(last) }); await post(c.bia, `/mensagens/conversas/${g}/lida`, { ate: Number(last) });
    const plain = (await say(c.ana, g, 'Subi o corte novo')).json.message;
    await notice(g, plain.id);
    assert.equal((await avisos(u.edu, g)).length, 0);
    assert.equal((await avisos(u.bia, g)).length, 1, 'quem está em "todas" recebe');
    const tag = (await say(c.ana, g, '@Edu dá uma olhada no áudio')).json.message;
    await notice(g, tag.id);
    const list = await avisos(u.edu, g);
    assert.equal(list.length, 1); assert.match(list[0].title, /Ana Gestão mencionou você em Edição EP\.030/);
    const edm = (await post(c.ana, '/mensagens/conversas', { tipo: 'pessoa', pessoa: u.edu.id })).json.id;
    const d = (await say(c.ana, edm, 'Oi, Edu')).json.message;
    await notice(edm, d.id);
    assert.equal((await avisos(u.edu, edm)).length, 1, 'conversa individual sempre avisa');
  });

  it('cada conversa pode ter a regra dela: "nenhum" cala até menção e reação; "padrão" volta à preferência', async () => {
    const r = await post(c.bia, `/mensagens/conversas/${g}/avisos`, { modo: 'nada' });
    assert.equal(r.status, 200); assert.equal(r.json.conversation.notify_effective, 'nada');
    const before = (await avisos(u.bia, g)).length;
    const m = (await say(c.ana, g, '@Bia Produtora urgente')).json.message;
    await notice(g, m.id);
    assert.equal((await avisos(u.bia, g)).length, before);
    const mine = (await say(c.bia, g, 'Feito')).json.message;
    await post(c.ana, `/mensagens/m/${mine.id}/reagir`, { emoji: '👍' });
    assert.equal((await q("SELECT 1 FROM notifications WHERE user_id = $1 AND title LIKE '%reagiu%'", [u.bia.id])).length, 0);
    assert.equal((await post(c.bia, `/mensagens/conversas/${g}/avisos`, { modo: 'padrao' })).json.conversation.notify, null);
    assert.equal((await post(c.bia, `/mensagens/conversas/${g}/avisos`, { modo: 'qualquer' })).status, 400);
  });

  it('marcar alguém ao editar a mensagem avisa quem passou a ser marcado', async () => {
    const m = (await say(c.ana, g, 'Revisão pronta')).json.message;
    const r = await post(c.ana, `/mensagens/m/${m.id}/editar`, { html: '<p>Revisão pronta, @Edu Editor</p>' });
    assert.equal(r.status, 200); assert.deepEqual(r.json.message.mentions, [u.edu.id]);
    assert.ok((await q("SELECT 1 FROM notifications WHERE user_id = $1 AND dedupe_key = $2", [u.edu.id, `chat-mencao-${m.id}-edit`])).length);
  });

  it('# cita itens do sistema: a busca traz o episódio e o link entra clicável; caminho estranho vira link comum', async () => {
    const found = (await get(c.bia, '/mensagens/referencias?q=Social')).json.items;
    const item = found.find((i) => i.kind === 'episodio');
    assert.equal(item.url, `/episodios/${ep}`); assert.match(item.title, /EP\.030/);
    const sent = (await post(c.bia, `/mensagens/conversas/${g}/mensagens`, { client_id: uid(), html: `<p>Olhem <a href="${item.url}" data-ref="episodio">${item.title}</a> e <a href="/usuarios/1" data-ref="episodio">isto</a></p>` })).json.message;
    assert.match(sent.html, new RegExp(`<a href="/episodios/${ep}" data-ref="episodio">`)); assert.doesNotMatch(sent.html, /data-ref="episodio">isto/);
    assert.doesNotMatch(sent.html, new RegExp(`href="/episodios/${ep}"[^>]*target=`), 'item do sistema abre na mesma aba');
    const editor = (await get(c.edu, '/mensagens/referencias?q=Social')).json.items;
    assert.ok(Array.isArray(editor));
  });

  it('Notificações > Alertas guarda o padrão dos grupos', async () => {
    await c.bia.act('/notificacoes/mensagens', { modo: 'mencoes' }, { from: '/notificacoes' });
    assert.equal((await q('SELECT chat_notify FROM users WHERE id = $1', [u.bia.id]))[0].chat_notify, 'mencoes');
    assert.match((await c.bia.get('/notificacoes')).text, /value="mencoes" checked/);
  });
});
