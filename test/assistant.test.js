const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const config = require('../src/config');

describe('assistente de IA', () => {
  const as = {};
  let app; let users = {};
  const realFetch = global.fetch;
  const geminiBodies = [];
  let script = []; // respostas do Gemini, em ordem

  const post = async (c, path, body, { raw, type } = {}) => {
    const token = await c.csrf('/');
    const res = await fetch(`${app.base}${path}`, {
      method: 'POST', headers: { cookie: c.cookie(), accept: 'application/json', 'x-csrf-token': token, 'content-type': raw ? type : 'application/json' }, body: raw || JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const getJson = async (c, path) => { const r = await c.get(path, { headers: { accept: 'application/json' } }); return { status: r.status, json: JSON.parse(r.text) }; };

  before(async () => {
    process.env.GEMINI_KEY = 'test-gemini'; config.gemini.key = 'test-gemini'; config.geminiConfigured = true;
    global.fetch = async (url, opts = {}) => {
      if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
        geminiBodies.push(JSON.parse(opts.body));
        const next = script.shift() || { text: 'Pronto.' };
        if (next.status) return Response.json({ error: { message: next.message } }, { status: next.status });
        const parts = next.call ? [{ functionCall: { name: next.call, args: next.args || {} } }] : [{ text: next.text }];
        return Response.json({ candidates: [{ content: { role: 'model', parts } }] });
      }
      return realFetch(url, opts);
    };
    await h.resetDb();
    app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['editor', 'editor_video']]) {
      users[k] = await h.createUser({ name: k === 'gestao' ? 'Gil Gestão' : 'Edu Editor', email: `${k}@t.com`, role });
      as[k] = h.client(app.base); await as[k].login(`${k}@t.com`);
    }
    await h.db.query("INSERT INTO tasks (title, kind, status, assignee_id, due_on) VALUES ('Revisar o EP.012', 'geral', 'a_fazer', $1, CURRENT_DATE)", [users.gestao.id]);
  });
  after(async () => { global.fetch = realFetch; await app.close(); await h.db.close(); });

  it('aparece em todas as páginas do painel (botão flutuante + script)', async () => {
    const t = (await as.editor.get('/')).text;
    assert.match(t, /data-assist-open/);
    assert.match(t, /\/static\/assistant\.js/);
    assert.match(t, /data-assist-mic/);
  });

  it('usa ferramenta do sistema, guarda a conversa e responde com link', async () => {
    script = [{ call: 'tarefas', args: { escopo: 'hoje' } }, { text: 'Hoje você tem 1 tarefa: [Revisar o EP.012](/tarefas/1).' }];
    const r = await post(as.gestao, '/assistente/mensagem', { text: 'O que tenho para hoje?', page: '/episodios' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.match(r.json.reply, /Revisar o EP\.012/);
    assert.deepEqual(r.json.tools, ['tarefas']);
    const second = geminiBodies.at(-1);
    const fr = second.contents.at(-1).parts[0].functionResponse;
    assert.equal(fr.name, 'tarefas');
    assert.equal(fr.response.resultado[0].titulo, 'Revisar o EP.012', 'o resultado da ferramenta volta para o modelo');
    assert.match(second.systemInstruction.parts[0].text, /Gil Gestão/);
    assert.match(second.systemInstruction.parts[0].text, /página \/episodios/);
    const conv = r.json.conversation.id;
    script = [{ text: 'Isso mesmo.' }];
    await post(as.gestao, '/assistente/mensagem', { text: 'E amanhã?', conversation_id: conv });
    const hist = geminiBodies.at(-1).contents.map((c) => c.role + ':' + (c.parts[0].text || ''));
    assert.deepEqual(hist.slice(0, 3), ['user:O que tenho para hoje?', 'model:Hoje você tem 1 tarefa: [Revisar o EP.012](/tarefas/1).', 'user:E amanhã?'], 'o histórico vai junto');
    const list = await getJson(as.gestao, '/assistente/conversas');
    assert.equal(list.json.conversations.length, 1);
    assert.equal(list.json.conversations[0].title, 'O que tenho para hoje?');
    const one = await getJson(as.gestao, `/assistente/conversas/${conv}`);
    assert.equal(one.json.conversation.messages.length, 4);
    assert.equal((await as.editor.get(`/assistente/conversas/${conv}`)).status, 404, 'conversa de outra pessoa não abre');
  });

  it('ferramentas seguem o perfil: editor de vídeo não recebe a de redes nem a de criar no CRM', async () => {
    script = [{ text: 'Ok.' }];
    await post(as.editor, '/assistente/mensagem', { text: 'oi' });
    const names = geminiBodies.at(-1).tools[0].functionDeclarations.map((d) => d.name);
    assert.ok(names.includes('episodios'));
    assert.ok(!names.includes('social'), 'editor não vê as redes');
    script = [{ call: 'social' }, { text: 'Ok.' }];
    const r = await post(as.editor, '/assistente/mensagem', { text: 'e as redes?' });
    assert.match(JSON.stringify(geminiBodies.at(-1).contents.at(-1)), /não disponível para o seu perfil/, 'pedido de ferramenta proibida é recusado');
    assert.equal(r.status, 200);
  });

  it('cria tarefa quando pedido', async () => {
    script = [{ call: 'criar_tarefa', args: { titulo: 'Ligar para o estúdio', vencimento: '2026-12-01' } }, { text: 'Criei a tarefa.' }];
    await post(as.gestao, '/assistente/mensagem', { text: 'Anota: ligar para o estúdio até 1/12' });
    const { rows: [t] } = await h.db.query("SELECT * FROM tasks WHERE title = 'Ligar para o estúdio'");
    assert.equal(t.assignee_id, users.gestao.id);
    assert.equal(t.due_on.toISOString().slice(0, 10), '2026-12-01');
  });

  it('pergunta por áudio: transcreve (Groq), responde e marca a mensagem como "por voz"', async () => {
    script = [{ text: 'Entendi.' }];
    const r = await post(as.gestao, '/assistente/audio?pagina=/', null, { raw: Buffer.alloc(2000, 1), type: 'audio/webm' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.transcript, 'texto transcrito de teste');
    const { rows: [m] } = await h.db.query("SELECT * FROM assistant_messages WHERE content = 'texto transcrito de teste'");
    assert.equal(m.meta.audio, true);
    assert.equal((await post(as.gestao, '/assistente/audio', null, { raw: Buffer.alloc(10), type: 'audio/webm' })).status, 400, 'gravação vazia');
    assert.equal((await post(as.gestao, '/assistente/audio', null, { raw: Buffer.alloc(2000), type: 'text/plain' })).status, 400, 'só áudio');
  });

  it('IA sem cota: responde com aviso claro e guarda o erro', async () => {
    script = [{ status: 429, message: 'quota' }, { status: 429, message: 'quota' }];
    const r = await post(as.gestao, '/assistente/mensagem', { text: 'teste' });
    assert.equal(r.status, 200);
    assert.equal(r.json.error, true);
    assert.match(r.json.reply, /cota da IA/);
  });

  it('apagar conversa', async () => {
    const { json } = await getJson(as.gestao, '/assistente/conversas');
    const id = json.conversations[0].id;
    assert.equal((await post(as.editor, `/assistente/conversas/${id}/excluir`, {})).status, 404, 'só a dona apaga');
    assert.equal((await post(as.gestao, `/assistente/conversas/${id}/excluir`, {})).status, 200);
    assert.equal((await as.gestao.get(`/assistente/conversas/${id}`)).status, 404);
  });
});
