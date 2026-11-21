const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('./helpers');
const relay = require('../src/services/chatRelay');

describe('Mensagens: respostas não lidas das threads que eu sigo', () => {
  let app; const u = {}; const c = {}; let g;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const post = async (who, path, body = {}) => {
    const csrf = await who.csrf('/mensagens');
    const r = await fetch(`${app.base}${path}`, { method: 'POST', redirect: 'manual', headers: { cookie: who.cookie(), accept: 'application/json', 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const get = async (who, path) => { const r = await fetch(`${app.base}${path}`, { headers: { cookie: who.cookie(), accept: 'application/json' } }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const say = async (who, html, parent = null) => (await post(who, `/mensagens/conversas/${g}/mensagens`, { client_id: crypto.randomUUID(), html: `<p>${html}</p>`, ...(parent ? { parent_id: parent } : {}) })).json.message;
  const unread = async (who) => (await get(who, `/mensagens/conversas/${g}/threads-nao-lidas`)).json.threads;

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    relay.setTransport(async () => 'teste');
    for (const [k, name, role] of [['ana', 'Ana Gestão', 'gestao'], ['bia', 'Bia Produtora', 'produtora'], ['edu', 'Edu Editor', 'editor_video'], ['zeca', 'Zeca Fora', 'produtora']]) {
      u[k] = await h.createUser({ name, email: `${k}@t.com`, role }); c[k] = h.client(app.base); await c[k].login(`${k}@t.com`);
    }
    g = (await post(c.ana, '/mensagens/conversas', { tipo: 'grupo', nome: 'Edição', pessoas: [u.bia.id, u.edu.id] })).json.id;
  });
  after(async () => { await relay.drain(); await app.close(); await h.db.close(); });

  it('quem escreveu a mensagem vê a resposta nova; abrir a thread marca como lida', async () => {
    const root = await say(c.ana, 'Quem fecha a capa do EP 12?');
    await say(c.bia, 'Eu fecho hoje', root.id);
    const [t] = await unread(c.ana);
    assert.equal(t.id, root.id); assert.equal(t.unread, 1); assert.equal(t.last_reply_author, 'Bia Produtora'); assert.match(t.preview, /Quem fecha a capa/);
    assert.deepEqual(await unread(c.edu), [], 'quem não escreveu, não respondeu nem foi marcado não segue');
    assert.deepEqual(await unread(c.bia), [], 'a própria resposta não conta');
    const r = await post(c.ana, `/mensagens/m/${root.id}/thread-lida`, { ate: 999999999 });
    assert.equal(r.status, 200);
    assert.deepEqual(await unread(c.ana), []);
  });

  it('marcado com @ numa resposta passa a seguir; resposta apagada não conta; responder zera', async () => {
    const root = await say(c.bia, 'Revisão do corte 3');
    await say(c.ana, 'Olha isso @Edu Editor', root.id);
    assert.equal((await unread(c.edu))[0].unread, 1);
    const late = await say(c.ana, 'Mais um detalhe', root.id);
    assert.equal((await unread(c.edu))[0].unread, 2);
    await post(c.ana, `/mensagens/m/${late.id}/apagar`);
    assert.equal((await unread(c.edu))[0].unread, 1, 'a resposta apagada sai da conta');
    await say(c.edu, 'Vi, ajusto', root.id);
    assert.deepEqual(await unread(c.edu), [], 'responder marca a thread como lida até a minha resposta');
    assert.equal((await unread(c.bia))[0].unread, 2, 'quem escreveu a original vê as duas de outras pessoas');
  });

  it('thread que já existia antes da migração conta como lida (semente)', async () => {
    const { rows: [{ n }] } = await h.db.query("SELECT count(*)::int AS n FROM chat_thread_reads");
    assert.ok(n >= 1);
    const migration = require('fs').readFileSync(require('path').join(__dirname, '../src/db/migrations/089_avisos_threads_tarefa_da_mensagem.sql'), 'utf8');
    const root = await say(c.ana, 'Antiga');
    await say(c.bia, 'Resposta antiga', root.id);
    await q('DELETE FROM chat_thread_reads WHERE parent_id = $1', [root.id]);
    await h.db.query(migration.match(/INSERT INTO chat_thread_reads[\s\S]*?;/)[0]); // a semente da migração, de novo
    assert.deepEqual((await unread(c.ana)).filter((t) => t.id === root.id), []);
  });

  it('quem entra no grupo depois não vê as threads antigas como não lidas; a resposta nova aparece', async () => {
    const root = await say(c.ana, 'Aviso geral @todos');
    await say(c.bia, 'Ciente', root.id);
    await post(c.ana, `/mensagens/conversas/${g}/pessoas`, { pessoas: [u.zeca.id] });
    assert.deepEqual(await unread(c.zeca), [], 'o histórico de antes de entrar não conta');
    await say(c.bia, 'Mais um ponto', root.id);
    assert.equal((await unread(c.zeca)).find((t) => t.id === root.id).unread, 1);
    await post(c.ana, `/mensagens/conversas/${g}/pessoas/${u.zeca.id}/remover`);
  });

  it('quem não participa recebe 404', async () => {
    assert.equal((await get(c.zeca, `/mensagens/conversas/${g}/threads-nao-lidas`)).status, 404);
    const root = await say(c.ana, 'Só do grupo');
    assert.ok([403, 404].includes((await post(c.zeca, `/mensagens/m/${root.id}/thread-lida`, { ate: 1 })).status));
  });
});
