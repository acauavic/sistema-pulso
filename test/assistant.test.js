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

  describe('números, cadastro e orientação por perfil', () => {
    const lastResult = () => geminiBodies.at(-1).contents.at(-1).parts[0].functionResponse.response.resultado;
    const ask = async (who, call, args) => { script = [{ call, args }, { text: 'Ok.' }]; await post(as[who], '/assistente/mensagem', { text: 'teste' }); return lastResult(); };

    before(async () => {
      const mk = (name, ig, status, extra = '') => h.db.query(`INSERT INTO guests (name, instagram, profile, status${extra ? ', loss_reason' : ''}) VALUES ($1,$2,'medico',$3${extra ? ', $4' : ''})`, extra ? [name, ig, status, extra] : [name, ig, status]);
      await mk('Pro Um', 'pro.um', 'prospect'); await mk('Pro Dois', 'pro.dois', 'prospect'); await mk('Pro Tres', 'pro.tres', 'prospect');
      await mk('Conv Um', 'conv.um', 'convite_enviado'); await mk('Perd Um', 'perd.um', 'perdido', 'nunca_respondeu'); await mk('Perd Dois', 'perd.dois', 'perdido', 'nunca_respondeu');
      await h.db.query("UPDATE guests SET owner_id = $1 WHERE instagram = 'pro.um'", [users.gestao.id]);
    });

    it('numeros: contagem por etapa com link, motivos de perda e o que falta no funil', async () => {
      const r = await ask('gestao', 'numeros', { assunto: 'convidados' });
      const por = Object.fromEntries(r.convidados.por_etapa.map((e) => [e.etapa, e.quantidade]));
      assert.equal(por['Prospecção'], 3); assert.equal(por['Convite enviado'], 1); assert.equal(por['Perdido'], 2);
      assert.equal(r.convidados.por_etapa[0].link, '/convidados?view=lista&status=prospect');
      assert.deepEqual(r.convidados.motivos_de_perda, { 'Nunca respondeu': 2 });
      assert.equal(r.convidados.total, 6); assert.equal(r.convidados.sem_responsavel_em_andamento, 3);
      const all = await ask('gestao', 'numeros', {});
      for (const k of ['convidados', 'patrocinadores', 'episodios', 'tarefas', 'social', 'plateia', 'financeiro']) assert.ok(all[k], `gestão vê ${k}`);
      assert.equal(all.tarefas.minhas_abertas, 2, 'a de hoje e a que o próprio assistente criou antes');
      assert.equal(all.sem_acesso_para_o_seu_perfil, undefined);
    });

    it('numeros respeita o perfil: editor de vídeo não recebe redes, plateia nem financeiro', async () => {
      const r = await ask('editor', 'numeros', {});
      assert.ok(r.episodios && r.tarefas);
      assert.deepEqual(r.sem_acesso_para_o_seu_perfil.sort(), ['convidados', 'financeiro', 'patrocinadores', 'plateia', 'social']);
      assert.equal(r.financeiro, undefined);
      const only = await ask('editor', 'numeros', { assunto: 'financeiro' });
      assert.deepEqual(only, { sem_acesso_para_o_seu_perfil: ['financeiro'] });
    });

    it('calendario: o que tem data nos próximos dias, só do que o perfil enxerga', async () => {
      await h.db.query("INSERT INTO tasks (title, kind, status, assignee_id, due_on) VALUES ('Tarefa do calendário', 'geral', 'a_fazer', $1, CURRENT_DATE + 1)", [users.gestao.id]);
      await h.db.query("INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, status) VALUES ('saida', 'estudio', 'Conta do calendário', 12000, CURRENT_DATE + 2, 'previsto')");
      const r = await ask('gestao', 'calendario', { dias: 7 });
      assert.ok(r.eventos.some((e) => e.titulo === 'Tarefa do calendário' && e.tipo === 'Tarefas'));
      const conta = r.eventos.find((e) => e.titulo === 'Conta do calendário');
      assert.ok(conta && conta.tipo === 'A pagar' && /R\$/.test(conta.valor), 'gestão vê as contas');
      assert.equal(r.ver_tudo, '/calendario');
      const mine = await ask('gestao', 'calendario', { dias: 7, so_meus: true });
      assert.ok(mine.eventos.some((e) => e.titulo === 'Tarefa do calendário'));
      assert.ok(mine.eventos.some((e) => e.titulo === 'Conta do calendário'), 'pagar é do perfil da gestão: entra em "só os meus"');
      const editor = await ask('editor', 'calendario', { dias: 7, tipos: ['pagar', 'tarefa'] });
      assert.ok(!editor.eventos.some((e) => e.titulo === 'Conta do calendário'), 'editor de vídeo não vê contas, mesmo pedindo');
      assert.ok(!editor.tipos_que_o_perfil_ve.includes('pagar'));
    });

    it('lista_convidados: quem está na etapa, só os meus, e etapa inválida', async () => {
      const r = await ask('gestao', 'lista_convidados', { etapa: 'prospect' });
      assert.equal(r.total, 3); assert.equal(r.mostrando, 3);
      assert.deepEqual(r.convidados.map((g) => g.nome).sort(), ['Pro Dois', 'Pro Tres', 'Pro Um']);
      assert.equal(r.ver_todos, '/convidados?view=lista&status=prospect');
      const mine = await ask('gestao', 'lista_convidados', { etapa: 'Prospecção', responsavel: 'eu' });
      assert.deepEqual(mine.convidados.map((g) => g.nome), ['Pro Um']);
      const lost = await ask('gestao', 'lista_convidados', { etapa: 'perdido' });
      assert.equal(lost.convidados[0].motivo_da_perda, 'Nunca respondeu');
      assert.match((await ask('gestao', 'lista_convidados', { etapa: 'astronauta' })).erro, /Etapa desconhecida/);
      assert.equal((await ask('editor', 'lista_convidados', { etapa: 'prospect' })).total, undefined, 'editor de vídeo não vê convidados');
    });

    it('criar_convidado: cadastra em Prospecção com a pessoa como responsável; pede o que falta; barra duplicado; editor não cria', async () => {
      const ok = await ask('gestao', 'criar_convidado', { nome: 'Dra. Bia Nova', instagram: '@bia.nova', perfil: 'médica', genero: 'f', email: 'Bia@Exemplo.com', whatsapp: '(11) 97777-6666', tema: 'Sono' });
      assert.equal(ok.criado, true); assert.equal(ok.etapa, 'Prospecção'); assert.equal(ok.perfil, 'Médico(a)'); assert.equal(ok.instagram, '@bia.nova');
      const { rows: [g] } = await h.db.query("SELECT * FROM guests WHERE instagram = 'bia.nova'");
      assert.deepEqual([g.status, g.owner_id, g.created_by, g.gender, g.email, g.phone, g.topic, g.profile], ['prospect', users.gestao.id, users.gestao.id, 'f', 'bia@exemplo.com', '(11) 97777-6666', 'Sono', 'medico']);
      assert.equal(ok.link, `/convidados/${g.id}`);
      assert.match((await h.db.query("SELECT message FROM guest_events WHERE guest_id = $1", [g.id])).rows[0].message, /Cadastrado pelo assistente a pedido de Gil Gestão/);
      assert.match((await as.gestao.get('/auditoria')).text, /convidado\.criado/);

      assert.match((await ask('gestao', 'criar_convidado', { nome: 'Sem Perfil', instagram: '@sem.perfil' })).erro, /perfil/);
      assert.match((await ask('gestao', 'criar_convidado', { nome: 'X', instagram: 'não é @ válido!', perfil: 'astronauta' })).erro, /nome.*Instagram inválido.*perfil “astronauta” não reconhecido/);
      const dup = await ask('gestao', 'criar_convidado', { nome: 'Outra Bia', instagram: '@BIA.NOVA', perfil: 'médico' });
      assert.match(dup.erro, /Já existe.*Dra\. Bia Nova \(Prospecção\)/); assert.equal(dup.link, `/convidados/${g.id}`);
      assert.equal((await h.db.query("SELECT count(*)::int n FROM guests WHERE instagram = 'bia.nova'")).rows[0].n, 1);

      script = [{ call: 'criar_convidado', args: { nome: 'Edu Tenta', instagram: '@edu.tenta', perfil: 'médico' } }, { text: 'Ok.' }];
      await post(as.editor, '/assistente/mensagem', { text: 'cadastra' });
      assert.match(JSON.stringify(geminiBodies.at(-1).contents.at(-1)), /não disponível para o seu perfil/);
      assert.equal((await h.db.query("SELECT count(*)::int n FROM guests WHERE instagram = 'edu.tenta'")).rows[0].n, 0, 'editor de vídeo não cadastra convidados');
      assert.ok(!geminiBodies.at(-1).tools[0].functionDeclarations.some((d) => d.name === 'criar_convidado'));
    });

    it('o prompt instrui pelo perfil: o que pode, o que não pode e quem pode', async () => {
      script = [{ text: 'Ok.' }]; await post(as.editor, '/assistente/mensagem', { text: 'o que eu posso fazer?' });
      const editorPrompt = geminiBodies.at(-1).systemInstruction.parts[0].text;
      assert.match(editorPrompt, /Perfil de quem pergunta: Editor de Vídeo/);
      assert.match(editorPrompt, /pode: .*assumir a edição, subir o vídeo editado/);
      assert.match(editorPrompt, /NÃO pode \(e quem pode\): .*cadastrar e editar convidados.*\[Superadmin ou Gestão ou Produtora\]/);
      assert.match(editorPrompt, /aprovar ou devolver pedidos de post.*\[Superadmin ou Gestão\]/);
      assert.match(editorPrompt, /Zerar aceite e voltar para Prospecção/); assert.match(editorPrompt, /Editar em massa/); assert.match(editorPrompt, /Lembretes da gravação/);
      script = [{ text: 'Ok.' }]; await post(as.gestao, '/assistente/mensagem', { text: 'o que eu posso fazer?' });
      const gestaoPrompt = geminiBodies.at(-1).systemInstruction.parts[0].text;
      assert.match(gestaoPrompt, /Perfil de quem pergunta: Gestão/);
      assert.match(gestaoPrompt, /pode: .*cadastrar e editar convidados.*editar vários de uma vez/);
      assert.doesNotMatch(gestaoPrompt, /NÃO pode \(e quem pode\): .*cadastrar e editar convidados/);
      assert.match(gestaoPrompt, /excluir usuários \[Superadmin\]/, 'o que a gestão não faz traz quem faz');
    });
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
