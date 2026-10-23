const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const config = require('../src/config');
const assistant = require('../src/services/assistant');
const knowledge = require('../src/services/assistantKnowledge');

describe('assistente de IA: conhece o sistema novo e age com segurança', () => {
  const as = {}; const u = {}; let app;
  const realFetch = global.fetch;
  const geminiBodies = []; let script = [];
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const days = (n) => new Date(Date.now() + n * 86400_000).toISOString();

  const say = async (client, text = 'oi') => {
    const token = await client.csrf('/');
    const res = await fetch(`${app.base}/assistente/mensagem`, { method: 'POST', headers: { cookie: client.cookie(), accept: 'application/json', 'x-csrf-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  // Uma chamada de ferramenta pelo modelo -> o resultado que a ferramenta devolveu.
  const tool = async (client, name, args = {}) => {
    script = [{ call: name, args }, { text: 'Ok.' }];
    await say(client);
    const part = geminiBodies.at(-1).contents.at(-1).parts[0];
    return part.functionResponse ? part.functionResponse.response.resultado : null;
  };
  const toolNames = async (client) => { script = [{ text: 'Ok.' }]; await say(client); return geminiBodies.at(-1).tools[0].functionDeclarations.map((d) => d.name); };

  before(async () => {
    process.env.GEMINI_KEY = 'test-gemini'; config.gemini.key = 'test-gemini'; config.geminiConfigured = true;
    global.fetch = async (url, opts = {}) => {
      if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
        geminiBodies.push(JSON.parse(opts.body));
        const next = script.shift() || { text: 'Pronto.' };
        const parts = next.call ? [{ functionCall: { name: next.call, args: next.args || {} } }] : [{ text: next.text }];
        return Response.json({ candidates: [{ content: { role: 'model', parts } }] });
      }
      return realFetch(url, opts);
    };
    await h.resetDb(); app = await h.startServer();
    for (const [k, role, name] of [['gestao', 'gestao', 'Gil Gestão'], ['prod', 'produtora', 'Paula Produtora'], ['editor', 'editor_video', 'Edu Editor']]) {
      u[k] = await h.createUser({ name, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`);
    }
  });
  after(async () => { global.fetch = realFetch; await app.close(); await h.db.close(); });

  it('o conjunto de ferramentas é coerente e cada perfil só recebe o que pode usar', async () => {
    const all = assistant.TOOLS.map((t) => t.decl.name);
    assert.equal(new Set(all).size, all.length, 'sem nomes repetidos');
    for (const t of assistant.TOOLS) { assert.equal(t.decl.parameters.type, 'OBJECT'); assert.ok(t.decl.description.length > 40, t.decl.name); assert.equal(typeof t.run, 'function'); }
    for (const n of ['como_fazer', 'follow_ups', 'plateia', 'financeiro', 'contas', 'estoque', 'notificacoes', 'novidades', 'equipe', 'comentarios', 'atualizar_tarefa', 'comentar', 'registrar_abordagem', 'definir_responsavel', 'mudar_etapa_convidado', 'avancar_episodio', 'plateia_adicionar', 'plateia_situacao', 'plateia_selecionar']) assert.ok(all.includes(n), n);
    const g = await toolNames(as.gestao); const e = await toolNames(as.editor); const p = await toolNames(as.prod);
    for (const n of ['financeiro', 'contas', 'plateia', 'plateia_selecionar', 'mudar_etapa_convidado', 'criar_tarefa']) assert.ok(g.includes(n), `gestão: ${n}`);
    for (const n of ['financeiro', 'contas', 'plateia', 'plateia_adicionar', 'plateia_situacao', 'plateia_selecionar', 'mudar_etapa_convidado', 'criar_convidado', 'estoque', 'social']) assert.ok(!e.includes(n), `editor não recebe ${n}`);
    for (const n of ['como_fazer', 'tarefas', 'atualizar_tarefa', 'comentar', 'notificacoes', 'novidades', 'equipe']) assert.ok(e.includes(n), `editor recebe ${n}`);
    assert.ok(p.includes('plateia') && p.includes('estoque') && !p.includes('financeiro') && !p.includes('contas'), 'produtora: plateia e estoque, sem financeiro');
  });

  it('o prompt descreve o que o assistente consulta e faz, e a regra de confirmação', async () => {
    const prompt = assistant.systemPrompt(u.gestao, '/tarefas');
    for (const word of ['como_fazer', 'follow_ups', 'plateia_selecionar', 'precisa_confirmar', 'confirmado=true', 'atualizar_tarefa', 'registrar_abordagem', 'Você NÃO']) assert.match(prompt, new RegExp(word), word);
    assert.doesNotMatch(prompt, /Você só cria tarefas e convidados/, 'o texto antigo saiu');
    for (const t of knowledge.TOPICS) { assert.ok(t.steps.length && t.title && t.where, t.key); }
  });

  it('como_fazer devolve os passos do assunto certo e diz se o perfil faz', async () => {
    let r = await tool(as.gestao, 'como_fazer', { assunto: 'como registro uma abordagem de follow-up?' });
    assert.equal(r[0].assunto, 'Cadência de follow-up'); assert.ok(r[0].passos.some((p) => /Registrar abordagem/.test(p))); assert.equal(r[0].seu_perfil_faz, true);
    r = await tool(as.editor, 'como_fazer', { assunto: 'quero selecionar alguém da plateia' });
    assert.equal(r[0].assunto, 'Pulso Podcast com Plateia'); assert.equal(r[0].seu_perfil_faz, false); assert.deepEqual(r[0].quem_faz.sort(), ['Gestão', 'Produtora', 'Superadmin']);
    r = await tool(as.prod, 'como_fazer', { assunto: 'tarefa com hora' }); assert.ok(r[0].passos.some((p) => /Hora/.test(p)));
    r = await tool(as.prod, 'como_fazer', { assunto: 'xyzzy' }); assert.ok(r.erro && r.assuntos_que_conheco.includes('plateia'));
  });

  it('tarefas: lista com id e busca; criar com responsável, hora e vínculos (avisa a pessoa); responsável ambíguo ou inexistente pergunta', async () => {
    const ep = (await q("INSERT INTO episodes (number, title, status) VALUES (21, 'Médico e empresário', 'gravado') RETURNING id"))[0].id;
    const guestId = (await q("INSERT INTO guests (name, status) VALUES ('Dra. Ana Souza', 'prospect') RETURNING id"))[0].id;
    await h.createUser({ name: 'Paulo Outro', email: 'paulo@t.com', role: 'produtora' });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    let r = await tool(as.gestao, 'criar_tarefa', { titulo: 'Revisar a pauta', responsavel: 'Edu', vencimento: today, hora: '14:00', tipo: 'extra', episodio: '21', convidado: 'Ana Souza', descricao: 'Ver o roteiro' });
    assert.equal(r.criada, true); assert.equal(r.responsavel, 'Edu Editor'); assert.match(r.vence, /às 14h/);
    const t = (await q("SELECT *, to_char(due_time, 'HH24:MI') AS hm FROM tasks WHERE title = 'Revisar a pauta'"))[0];
    assert.equal(String(t.assignee_id), String(u.editor.id)); assert.equal(t.hm, '14:00'); assert.equal(t.kind, 'extra'); assert.equal(t.episode_id, ep); assert.equal(t.guest_id, guestId);
    assert.ok((await q("SELECT 1 FROM notifications WHERE user_id = $1 AND title LIKE '%criou uma tarefa para você: Revisar a pauta%'", [u.editor.id])).length, 'o responsável é avisado');
    r = await tool(as.gestao, 'criar_tarefa', { titulo: 'Ligar', responsavel: 'Paul' }); assert.ok(r.erro && r.opcoes.length === 2, JSON.stringify(r));
    r = await tool(as.gestao, 'criar_tarefa', { titulo: 'Ligar', responsavel: 'Zélia' }); assert.match(r.erro, /não encontrado/);
    r = await tool(as.gestao, 'criar_tarefa', { titulo: 'Minha própria' }); assert.equal(r.responsavel, 'Gil Gestão');
    assert.equal((await q("SELECT 1 FROM notifications WHERE user_id = $1 AND title LIKE '%Minha própria%'", [u.gestao.id])).length, 0, 'quem cria para si não se avisa');
    r = await tool(as.editor, 'tarefas', { escopo: 'minhas', busca: 'pauta' }); assert.equal(r.length, 1); assert.equal(r[0].id, t.id); assert.match(r[0].vence, /14h/); assert.match(r[0].detalhes, /roteiro/);
    assert.equal((await q("SELECT 1 FROM audit_log WHERE action = 'assistente.tarefa_criada'")).length >= 1, true, 'fica na auditoria');
  });

  it('atualizar_tarefa: status, prazo e hora, bloqueio com motivo, responsável; só quem pode mexer', async () => {
    const t = (await q("SELECT * FROM tasks WHERE title = 'Revisar a pauta'"))[0];
    let r = await tool(as.editor, 'atualizar_tarefa', { tarefa: 'Revisar a pauta', status: 'fazendo' }); assert.equal(r.atualizada, true); assert.equal(r.status, 'Fazendo');
    r = await tool(as.editor, 'atualizar_tarefa', { tarefa: String(t.id), status: 'bloqueada' }); assert.match(r.erro, /motivo do bloqueio/);
    r = await tool(as.editor, 'atualizar_tarefa', { tarefa: String(t.id), status: 'bloqueada', motivo_bloqueio: 'Falta o roteiro' }); assert.equal(r.status, 'Bloqueada');
    r = await tool(as.editor, 'atualizar_tarefa', { tarefa: String(t.id), status: 'a_fazer', vencimento: '2031-05-20', hora: '09:30' }); assert.match(r.vence, /20\/05\/2031 às 9h30/);
    r = await tool(as.editor, 'atualizar_tarefa', { tarefa: String(t.id), vencimento: '20/05/2031' }); assert.match(r.erro, /inválido/);
    r = await tool(as.editor, 'atualizar_tarefa', { tarefa: String(t.id) }); assert.match(r.erro, /Diga o que mudar/);
    r = await tool(as.gestao, 'atualizar_tarefa', { tarefa: String(t.id), responsavel: 'Paula' }); assert.equal(r.atualizada, true);
    assert.equal(String((await q('SELECT assignee_id FROM tasks WHERE id = $1', [t.id]))[0].assignee_id), String(u.prod.id));
    r = await tool(as.editor, 'atualizar_tarefa', { tarefa: String(t.id), status: 'feito' }); assert.match(r.erro, /Só quem criou, o responsável/, 'o editor não é mais o responsável nem criou');
    r = await tool(as.prod, 'atualizar_tarefa', { tarefa: String(t.id), status: 'feito' }); assert.equal(r.status, 'Feito');
    r = await tool(as.prod, 'atualizar_tarefa', { tarefa: 'não existe nada assim', status: 'feito' }); assert.match(r.erro, /não encontrad/);
  });

  it('comentar e comentarios: comenta no item em nome da pessoa (menção avisa) e lê de volta, com áudio transcrito', async () => {
    const g = (await q("SELECT id FROM guests WHERE name = 'Dra. Ana Souza'"))[0].id;
    let r = await tool(as.prod, 'comentar', { tipo: 'convidado', referencia: 'Ana Souza', texto: 'Ela prefere gravar de manhã. @Gil Gestão veja.' });
    assert.equal(r.publicado, true); assert.equal(r.em, 'Dra. Ana Souza'); assert.equal(r.mencoes, 1); assert.match(r.link, /\/convidados\/\d+#comentarios/);
    assert.ok((await q("SELECT 1 FROM notifications WHERE user_id = $1 AND title LIKE '%mencionou você%'", [u.gestao.id])).length);
    const att = (await q("INSERT INTO attachments (entity_type, entity_id, kind, filename, content_type, size_bytes, storage_key, transcript, uploaded_by) SELECT 'comment', c.id, 'audio', 'a.webm', 'audio/webm', 10, 'k', 'melhor às nove da manhã', $1 FROM comments c WHERE c.entity_id = $2 AND c.entity_type = 'guest' RETURNING id", [u.prod.id, g]))[0];
    assert.ok(att.id);
    r = await tool(as.gestao, 'comentarios', { tipo: 'convidado', referencia: 'Ana Souza' });
    assert.equal(r.item, 'Dra. Ana Souza'); assert.equal(r.comentarios.length, 1); assert.match(r.comentarios[0].texto, /gravar de manhã/); assert.equal(r.comentarios[0].audio_transcrito, 'melhor às nove da manhã'); assert.equal(r.comentarios[0].quem, 'Paula Produtora');
    r = await tool(as.gestao, 'comentarios', { tipo: 'episodio', referencia: '21' }); assert.equal(r.revisao_do_video.comentarios_em_aberto, 0);
    r = await tool(as.gestao, 'comentar', { tipo: 'episodio', referencia: 'nenhum episodio assim', texto: 'oi' }); assert.match(r.erro, /não encontrado/);
  });

  it('registrar_abordagem e follow_ups: registra na cadência, respeita a etapa e o perfil; lista quem precisa de follow-up', async () => {
    const gid = (await q("INSERT INTO guests (name, status, owner_id, instagram) VALUES ('Dr. Cadência', 'convite_enviado', $1, 'dr.cadencia') RETURNING id", [u.prod.id]))[0].id;
    await q("INSERT INTO guests (name, status) VALUES ('Dr. Prospect', 'prospect')");
    let r = await tool(as.prod, 'registrar_abordagem', { tipo: 'convidado', nome: 'Cadência', canal: 'instagram', resultado: 'enviado', observacao: 'Mandei o convite no direct' });
    assert.equal(r.registrada, true); assert.equal(r.canal, 'Instagram'); assert.equal(r.resultado, 'Enviei'); assert.ok(r.proximo_follow_up);
    assert.equal((await q("SELECT count(*)::int AS n FROM outreach_attempts WHERE subject_id = $1 AND channel = 'instagram'", [gid]))[0].n, 1);
    r = await tool(as.prod, 'registrar_abordagem', { tipo: 'convidado', nome: 'Dr. Prospect', canal: 'email' }); assert.match(r.erro, /Convite enviado/);
    r = await tool(as.editor, 'registrar_abordagem', { tipo: 'convidado', nome: 'Cadência', canal: 'email' }); assert.match(r.erro, /não registra abordagens/);
    r = await tool(as.prod, 'registrar_abordagem', { tipo: 'convidado', nome: 'Cadência', canal: 'whatsapp', quando: '2999-01-01' }); assert.match(r.erro, /futuro/);
    await q("UPDATE outreach_attempts SET at = now() - interval '9 days' WHERE subject_id = $1", [gid]);
    r = await tool(as.prod, 'follow_ups', {}); assert.equal(r.itens.some((i) => i.nome === 'Dr. Cadência'), true, JSON.stringify(r));
    r = await tool(as.prod, 'follow_ups', { quem: 'todos' }); assert.match(r.erro, /Só a gestão/);
    r = await tool(as.gestao, 'follow_ups', { quem: 'todos' }); assert.ok(r.itens.some((i) => i.nome === 'Dr. Cadência' && i.tipo === 'convidado'));
  });

  it('definir_responsavel: troca o dono do convidado e avisa; o perfil sem permissão não consegue', async () => {
    let r = await tool(as.gestao, 'definir_responsavel', { tipo: 'convidado', referencia: 'Dr. Cadência', responsavel: 'Gil' });
    assert.equal(r.feito, true); assert.equal(r.responsavel, 'Gil Gestão');
    assert.equal(String((await q("SELECT owner_id FROM guests WHERE name = 'Dr. Cadência'"))[0].owner_id), String(u.gestao.id));
    r = await tool(as.editor, 'definir_responsavel', { tipo: 'convidado', referencia: 'Dr. Cadência', responsavel: 'Paula' }); assert.match(r.erro, /perfil não troca|Seu perfil/);
    r = await tool(as.gestao, 'definir_responsavel', { tipo: 'convidado', referencia: 'Dr. Cadência', responsavel: 'ninguém' }); assert.equal(r.responsavel, 'ninguém');
  });

  it('mudar_etapa_convidado: pede confirmação, segue as regras (motivo da perda, o que falta) e só muda depois do sim', async () => {
    let r = await tool(as.prod, 'mudar_etapa_convidado', { nome: 'Dr. Prospect', etapa: 'Perdido' }); assert.match(r.erro, /motivo/i);
    r = await tool(as.prod, 'mudar_etapa_convidado', { nome: 'Dr. Prospect', etapa: 'perdido', motivo_perda: 'Recusado' });
    assert.equal(r.precisa_confirmar, true); assert.match(r.resumo, /Prospecção → Perdido \(motivo: Recusado\)/);
    assert.equal((await q("SELECT status FROM guests WHERE name = 'Dr. Prospect'"))[0].status, 'prospect', 'sem confirmar, nada muda');
    r = await tool(as.prod, 'mudar_etapa_convidado', { nome: 'Dr. Prospect', etapa: 'perdido', motivo_perda: 'Recusado', confirmado: true });
    assert.equal(r.feito, true);
    const g = (await q("SELECT status, loss_reason FROM guests WHERE name = 'Dr. Prospect'"))[0]; assert.equal(g.status, 'perdido'); assert.equal(g.loss_reason, 'recusado');
    assert.ok((await q("SELECT 1 FROM guest_events WHERE message LIKE '%pelo assistente%'")).length);
    r = await tool(as.prod, 'mudar_etapa_convidado', { nome: 'Dr. Cadência', etapa: 'agendado', confirmado: true }); assert.ok(r.erro && r.link, 'agendado exige foto e data: o assistente não pula a regra');
    r = await tool(as.editor, 'mudar_etapa_convidado', { nome: 'Dr. Prospect', etapa: 'prospect', confirmado: true }); assert.match(r.erro, /Ferramenta não disponível/);
    r = await tool(as.prod, 'mudar_etapa_convidado', { nome: 'Dr. Prospect', etapa: 'perdido' }); assert.match(r.erro, /já está em Perdido/);
  });

  it('avancar_episodio: respeita perfil e o que falta, pede confirmação e move', async () => {
    const ep = (await q("SELECT id FROM episodes WHERE number = 21"))[0].id;
    let r = await tool(as.prod, 'avancar_episodio', { episodio: '21', para: 'Disponível para edição' }); assert.match(r.erro, /falta/i);
    await q("INSERT INTO episode_files (episode_id, kind, label, filename, content_type, size_bytes, storage_key, status) VALUES ($1, 'bruto_video', 'Câmera 1', 'c1.mp4', 'video/mp4', 10, 'k/c1', 'pronto')", [ep]);
    r = await tool(as.prod, 'avancar_episodio', { episodio: '21', para: 'disponivel_edicao' }); assert.equal(r.precisa_confirmar, true); assert.match(r.resumo, /Gravado → Disponível para edição/);
    assert.equal((await q('SELECT status FROM episodes WHERE id = $1', [ep]))[0].status, 'gravado');
    r = await tool(as.prod, 'avancar_episodio', { episodio: '21', para: 'disponivel_edicao', confirmado: true }); assert.equal(r.feito, true);
    assert.equal((await q('SELECT status FROM episodes WHERE id = $1', [ep]))[0].status, 'disponivel_edicao');
    r = await tool(as.prod, 'avancar_episodio', { episodio: '21', para: 'publicado', confirmado: true }); assert.match(r.erro, /só pode ir para/);
    r = await tool(as.editor, 'avancar_episodio', { episodio: '21', para: 'em_edicao' }); assert.equal(r.precisa_confirmar, true, 'o editor assume a edição (production.edit)');
    r = await tool(as.prod, 'avancar_episodio', { episodio: 'Médico', para: 'em_edicao' }); assert.match(r.erro, /perfil de quem pediu não faz/, 'a produtora não assume a edição');
  });

  it('plateia: adicionar (novo e já selecionado com confirmação), mudar situação, selecionar e consultar', async () => {
    const gid = (await q("INSERT INTO guests (name, status, proposed_at, scheduled_studio, scheduled_hosts, scheduled_guest, email) VALUES ('Dr. Plateia', 'agendado', $1, true, true, true, 'p@t.com') RETURNING id", [days(6)]))[0].id;
    let r = await tool(as.prod, 'plateia_adicionar', { nome: 'Marina Costa', whatsapp: '(11) 91234-5678', convidado: 'Dr. Plateia' }); assert.equal(r.adicionado, true);
    let lead = (await q("SELECT * FROM plateia_leads WHERE name = 'Marina Costa'"))[0]; assert.equal(lead.status, 'novo'); assert.equal(lead.phone, '+5511912345678'); assert.equal(String(lead.added_by), String(u.prod.id));
    r = await tool(as.prod, 'plateia_adicionar', { nome: 'Marina Costa', whatsapp: '11 91234-5678', convidado: 'Dr. Plateia' }); assert.match(r.erro, /já está/);
    r = await tool(as.prod, 'plateia_adicionar', { nome: 'Sem Zap', whatsapp: '123', convidado: 'Dr. Plateia' }); assert.ok(r.erro);
    r = await tool(as.prod, 'plateia_adicionar', { nome: 'Fora', whatsapp: '11 98888-7777', convidado: 'Dr. Prospect' }); assert.match(r.erro, /não está Agendado/);
    r = await tool(as.prod, 'plateia_adicionar', { nome: 'Caio Selecionado', whatsapp: '11 97777-6666', convidado: 'Dr. Plateia', situacao: 'selecionado' }); assert.match(r.erro, /valor combinado/);
    r = await tool(as.prod, 'plateia_adicionar', { nome: 'Caio Selecionado', whatsapp: '11 97777-6666', convidado: 'Dr. Plateia', situacao: 'selecionado', valor: 197 }); assert.equal(r.precisa_confirmar, true);
    assert.equal((await q("SELECT 1 FROM plateia_leads WHERE name = 'Caio Selecionado'")).length, 0, 'sem o sim, nada é criado');
    r = await tool(as.prod, 'plateia_adicionar', { nome: 'Caio Selecionado', whatsapp: '11 97777-6666', convidado: 'Dr. Plateia', situacao: 'selecionado', valor: 197, confirmado: true }); assert.equal(r.adicionado, true);
    const caio = (await q("SELECT * FROM plateia_leads WHERE name = 'Caio Selecionado'"))[0]; assert.equal(caio.status, 'confirmado'); assert.equal(Number(caio.amount_cents), 19700); assert.ok(caio.entry_id);
    // selecionar a Marina (isenta), com confirmação
    r = await tool(as.prod, 'plateia_selecionar', { pedido: 'Marina' }); assert.match(r.erro, /valor combinado/);
    r = await tool(as.prod, 'plateia_selecionar', { pedido: 'Marina', isento: true }); assert.equal(r.precisa_confirmar, true);
    r = await tool(as.prod, 'plateia_selecionar', { pedido: 'Marina', isento: true, confirmado: true }); assert.equal(r.feito, true);
    lead = (await q("SELECT * FROM plateia_leads WHERE name = 'Marina Costa'"))[0]; assert.equal(lead.status, 'confirmado'); assert.equal(Number(lead.amount_cents), 0); assert.equal(lead.entry_id, null);
    r = await tool(as.prod, 'plateia_selecionar', { pedido: 'Marina', isento: true, confirmado: true }); assert.match(r.erro, /já está selecionado/);
    // sair de Selecionado cancela a conta: pede confirmação
    r = await tool(as.prod, 'plateia_situacao', { pedido: 'Caio', situacao: 'desistiu' }); assert.equal(r.precisa_confirmar, true); assert.match(r.resumo, /conta a receber/);
    assert.equal((await q("SELECT status FROM plateia_leads WHERE name = 'Caio Selecionado'"))[0].status, 'confirmado');
    r = await tool(as.prod, 'plateia_situacao', { pedido: 'Caio', situacao: 'desistiu', confirmado: true }); assert.equal(r.feito, true);
    assert.equal((await q('SELECT status FROM fin_entries WHERE id = $1', [caio.entry_id]))[0].status, 'cancelado');
    r = await tool(as.prod, 'plateia_situacao', { pedido: 'Caio', situacao: 'confirmado' }); assert.match(r.erro, /plateia_selecionar/);
    r = await tool(as.prod, 'plateia_situacao', { pedido: 'Marina Costa', situacao: 'novo', confirmado: true }); assert.equal(r.feito, true);
    // consulta
    r = await tool(as.prod, 'plateia', { convidado: 'Plateia' });
    assert.equal(r.pedidos.length, 2); assert.equal(r.por_situacao['Novo pedido'], 1); assert.equal(r.por_situacao.Desistiu, 1); assert.equal(r.proximas_gravacoes[0].convidado, 'Dr. Plateia'); assert.equal(r.proximas_gravacoes[0].pedidos, 2);
    r = await tool(as.prod, 'plateia', { situacao: 'desistiu' }); assert.deepEqual(r.pedidos.map((p) => p.nome), ['Caio Selecionado']);
    const audit = await q("SELECT action FROM audit_log WHERE action LIKE 'assistente.plateia%'"); assert.ok(audit.length >= 4);
  });

  it('financeiro, contas e estoque: só a gestão (e a produtora no estoque); números formatados e vencimentos', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    await q("INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, status, source) VALUES ('saida', 'estudio', 'Aluguel do estúdio', 350000, $1::date - 3, 'previsto', 'manual'), ('entrada', 'patrocinio', 'Parcela Marca Alfa', 1000000, $1::date + 5, 'previsto', 'manual')", [today]);
    await q("INSERT INTO fin_stock_items (name, unit, per_episode, min_qty, lead_days, active) VALUES ('Café', 'kg', 1, 5, 7, true)");
    let r = await tool(as.gestao, 'financeiro', {});
    assert.match(r.atrasado_a_pagar, /3\.500,00/); assert.ok(r.vencendo_ou_atrasadas.some((e) => e.descricao === 'Aluguel do estúdio' && e.atrasada)); assert.ok(r.projecao.length >= 3); assert.equal(r.links.resumo, '/financeiro');
    assert.ok(r.estoque_para_repor.some((i) => i.item === 'Café'));
    r = await tool(as.gestao, 'contas', { escopo: 'atrasadas' }); assert.equal(r.total_de_lancamentos, 1); assert.match(r.soma, /3\.500,00/); assert.equal(r.lancamentos[0].tipo, 'a pagar'); assert.equal(r.lancamentos[0].atrasada, true);
    r = await tool(as.gestao, 'contas', { escopo: 'receber', busca: 'Alfa' }); assert.equal(r.lancamentos.length, 1); assert.match(r.lancamentos[0].valor, /10\.000,00/);
    r = await tool(as.prod, 'estoque', {}); assert.equal(r.itens[0].item, 'Café'); assert.match(r.itens[0].situacao, /Acabou|Comprar/);
    assert.match((await tool(as.prod, 'financeiro', {})).erro, /não disponível para o seu perfil/, 'a produtora nem recebe a ferramenta de financeiro');
  });

  it('notificacoes, novidades e equipe: respondem do que a pessoa pode ver', async () => {
    let r = await tool(as.editor, 'notificacoes', {}); assert.ok(r.nao_lidas >= 1); assert.ok(r.mais_recentes.some((n) => /criou uma tarefa para você/.test(n.aviso)));
    const gestao = await tool(as.gestao, 'notificacoes', {}); assert.notDeepEqual(gestao.mais_recentes, r.mais_recentes, 'cada pessoa vê só as suas');
    r = await tool(as.editor, 'novidades', { quantidade: 2 }); assert.equal(r.versao_atual, require('../package.json').version); assert.equal(r.versoes.length, 2); assert.ok(r.versoes[0].itens.length);
    r = await tool(as.editor, 'equipe', {}); assert.ok(r.some((p) => p.nome === 'Paula Produtora' && p.perfil === 'Produtora')); assert.ok(!JSON.stringify(r).includes('@t.com'), 'sem e-mails');
  });

  it('episodios traz material, revisão do vídeo e links de publicação', async () => {
    const ep = (await q("SELECT id FROM episodes WHERE number = 21"))[0].id;
    await q("UPDATE episodes SET youtube_url = 'https://youtu.be/abc' WHERE id = $1", [ep]);
    await q("INSERT INTO episode_comments (episode_id, body, author_id) VALUES ($1, 'cortar aqui', $2)", [ep, u.gestao.id]);
    const r = await tool(as.gestao, 'episodios', { numero: 21 });
    assert.equal(r.material_enviado['Vídeo bruto'], 1); assert.equal(r.revisao_do_video.comentarios_em_aberto, 1); assert.equal(r.links_de_publicacao.youtube, 'https://youtu.be/abc');
    const list = await tool(as.gestao, 'tarefas', { escopo: 'todas', atrasadas: true }); assert.ok(Array.isArray(list));
  });
});
