const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('./helpers');
const config = require('../src/config');
const relay = require('../src/services/chatRelay');

describe('Criar tarefa a partir de uma mensagem ou da thread', () => {
  let app; const u = {}; const c = {}; let g; let root; let reply;
  const realFetch = global.fetch;
  const geminiBodies = []; const script = [];
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const post = async (who, path, body = {}) => {
    const csrf = await who.csrf('/mensagens');
    const r = await fetch(`${app.base}${path}`, { method: 'POST', redirect: 'manual', headers: { cookie: who.cookie(), accept: 'application/json', 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const get = async (who, path) => { const r = await fetch(`${app.base}${path}`, { headers: { cookie: who.cookie(), accept: 'application/json' } }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const say = async (who, html, parent = null) => (await post(who, `/mensagens/conversas/${g}/mensagens`, { client_id: crypto.randomUUID(), html: `<p>${html}</p>`, ...(parent ? { parent_id: parent } : {}) })).json.message;
  const answer = (o) => script.push({ text: JSON.stringify({ titulo: 'Fechar a capa do EP 12', descricao: '', tipo: 'geral', ...o }) });
  const lastPrompt = () => geminiBodies.at(-1).contents[0].parts[0].text;
  const lastSystem = () => geminiBodies.at(-1).systemInstruction.parts[0].text;

  before(async () => {
    config.gemini.key = 'test-gemini'; config.geminiConfigured = true;
    global.fetch = async (url, opts = {}) => {
      if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
        geminiBodies.push(JSON.parse(opts.body));
        return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: (script.shift() || { text: '{}' }).text }] } }] });
      }
      return realFetch(url, opts);
    };
    await h.resetDb(); app = await h.startServer();
    relay.setTransport(async () => 'teste');
    for (const [k, name, role] of [['ana', 'Ana Gestão', 'gestao'], ['bia', 'Bia Produtora', 'produtora'], ['zeca', 'Zeca Fora', 'produtora']]) {
      u[k] = await h.createUser({ name, email: `${k}@t.com`, role }); c[k] = h.client(app.base); await c[k].login(`${k}@t.com`);
    }
    g = (await post(c.ana, '/mensagens/conversas', { tipo: 'grupo', nome: 'Capas', pessoas: [u.bia.id] })).json.id;
    root = await say(c.ana, 'Bia, fecha a capa do EP 12 até sexta?');
    reply = await say(c.bia, 'Fecho, mas preciso da foto nova do convidado', root.id);
  });
  after(async () => { global.fetch = realFetch; await relay.drain(); await app.close(); await h.db.close(); });

  it('só a mensagem: o texto e quem escreveu vão para a IA, que devolve o rascunho; nada é criado', async () => {
    const before = (await q('SELECT count(*)::int AS n FROM tasks'))[0].n;
    answer({ responsavel_id: String(u.bia.id) });
    const r = await post(c.ana, `/mensagens/m/${root.id}/tarefa`, { alcance: 'mensagem' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.draft.title, 'Fechar a capa do EP 12'); assert.equal(r.json.draft.assignee_id, String(u.bia.id));
    assert.equal(r.json.has_thread, true);
    assert.match(lastPrompt(), /Ana Gestão \(\d{2}\/\d{2} \d{2}:\d{2}\): Bia, fecha a capa do EP 12 até sexta\?/);
    assert.doesNotMatch(lastPrompt(), /foto nova/, 'a resposta da thread fica de fora');
    assert.match(lastSystem(), /conversa escrita/);
    assert.equal((await q('SELECT count(*)::int AS n FROM tasks'))[0].n, before);
  });

  it('a thread inteira leva as respostas; numa resposta, "thread" não vale; quem não participa recebe 404', async () => {
    answer({});
    let r = await post(c.ana, `/mensagens/m/${root.id}/tarefa`, { alcance: 'thread' });
    assert.equal(r.status, 200); assert.match(lastPrompt(), /Bia Produtora \(\d{2}\/\d{2} \d{2}:\d{2}\): Fecho, mas preciso da foto nova/);
    r = await post(c.ana, `/mensagens/m/${reply.id}/tarefa`, { alcance: 'thread' });
    assert.equal(r.status, 400);
    answer({});
    r = await post(c.ana, `/mensagens/m/${reply.id}/tarefa`, { alcance: 'mensagem' });
    assert.equal(r.status, 200); assert.equal(r.json.has_thread, false);
    r = await post(c.zeca, `/mensagens/m/${root.id}/tarefa`, { alcance: 'mensagem' });
    assert.equal(r.status, 404);
  });

  it('criar com a origem grava o link; a mensagem passa a mostrar a tarefa; a página da tarefa leva de volta', async () => {
    const res = await c.ana.act('/tarefas', { title: 'Fechar a capa do EP 12', kind: 'geral', assignee_id: u.bia.id, source_message_id: root.id, source_scope: 'thread', voltar: `/mensagens/${g}?thread=${root.id}` }, { from: '/tarefas' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `/mensagens/${g}?thread=${root.id}`);
    const [t] = await q("SELECT * FROM tasks WHERE title = 'Fechar a capa do EP 12'");
    assert.equal(Number(t.source_message_id), root.id); assert.equal(t.source_scope, 'thread');
    const th = await get(c.bia, `/mensagens/m/${root.id}/respostas`);
    assert.deepEqual(th.json.parent.tasks, [{ id: t.id, title: 'Fechar a capa do EP 12' }]);
    const page = await c.ana.get(`/tarefas/${t.id}`);
    assert.match(page.text, /Veio de uma mensagem de Ana Gestão em Capas/);
    assert.match(page.text, new RegExp(`/mensagens/${g}\\?thread=${root.id}`));
    const outsider = await c.zeca.get(`/tarefas/${t.id}`);
    assert.match(outsider.text, /Veio de uma mensagem do chat/);
    assert.doesNotMatch(outsider.text, /Capas/, 'quem não participa não vê o nome da conversa');
  });

  it('a página de Mensagens traz a janela Nova tarefa com a barra "Da mensagem" e sem a parte de voz', async () => {
    const page = await c.ana.get(`/mensagens/${g}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /id="modal-task-new"/); assert.match(page.text, /data-task-from/); assert.match(page.text, /data-tasks="1"/);
    assert.doesNotMatch(page.text, /data-voice-btn/);
    assert.match(page.text, /\/static\/tarefa-msg\.js/);
  });

  it('origem de uma conversa da qual a pessoa não participa é ignorada', async () => {
    const res = await c.zeca.act('/tarefas', { title: 'Tarefa do Zeca', kind: 'geral', source_message_id: root.id, source_scope: 'mensagem' }, { from: '/tarefas' });
    assert.equal(res.status, 302);
    const [t] = await q("SELECT * FROM tasks WHERE title = 'Tarefa do Zeca'");
    assert.equal(t.source_message_id, null);
  });
});
