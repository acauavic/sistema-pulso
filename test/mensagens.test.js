const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('./helpers');
const chat = require('../src/services/chat');
const relay = require('../src/services/chatRelay');
const realtime = require('../src/services/realtime');
const jobs = require('../src/services/jobs');
const config = require('../src/config');

describe('Mensagens: conversas, grupos, threads, edição, reações, áudio, resumo e entrega sem perder nem duplicar', () => {
  let app; const u = {}; const c = {}; let dm;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const uid = () => crypto.randomUUID();
  const post = async (who, path, body = {}) => {
    const csrf = await who.csrf('/mensagens');
    const r = await fetch(`${app.base}${path}`, { method: 'POST', redirect: 'manual', headers: { cookie: who.cookie(), accept: 'application/json', 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const get = async (who, path) => { const r = await fetch(`${app.base}${path}`, { headers: { cookie: who.cookie(), accept: 'application/json' } }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const say = (who, conv, html, extra = {}) => post(who, `/mensagens/conversas/${conv}/mensagens`, { client_id: uid(), html: `<p>${html}</p>`, ...extra });
  const pendingOutbox = () => q('SELECT * FROM chat_outbox WHERE published_at IS NULL ORDER BY id');
  const sent = [];
  const fake = async (routingKey, event) => { sent.push({ routingKey, event }); return 'teste'; };
  const settle = async () => { await relay.drain(); await relay.tick(); };

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    await realtime.listen();
    realtime.on(relay.TOPIC, ({ routingKey, event }) => chat.handleLive(routingKey, event));
    relay.setTransport(fake);
    for (const [k, name, role] of [['ana', 'Ana Gestão', 'gestao'], ['bia', 'Bia Produtora', 'produtora'], ['edu', 'Edu Editor', 'editor_video']]) {
      u[k] = await h.createUser({ name, email: `${k}@chat.com`, role }); c[k] = h.client(app.base); await c[k].login(`${k}@chat.com`);
    }
  });
  after(async () => { await relay.drain(); realtime.stop(); await app.close(); await h.db.close(); });

  it('a conversa individual entre duas pessoas é sempre a mesma, mesmo aberta ao mesmo tempo pelas duas', async () => {
    const opens = await Promise.all([post(c.ana, '/mensagens/conversas', { tipo: 'pessoa', pessoa: u.bia.id }), post(c.bia, '/mensagens/conversas', { tipo: 'pessoa', pessoa: u.ana.id }), post(c.ana, '/mensagens/conversas', { tipo: 'pessoa', pessoa: u.bia.id })]);
    assert.ok(opens.every((r) => r.status === 200), JSON.stringify(opens));
    assert.equal(new Set(opens.map((r) => r.json.id)).size, 1);
    dm = opens[0].json.id;
    assert.equal((await q("SELECT count(*)::int AS n FROM chat_conversations WHERE kind = 'direct'"))[0].n, 1);
  });

  it('quem não participa não lê nem escreve', async () => {
    await say(c.ana, dm, 'Só para a Bia');
    assert.equal((await get(c.edu, `/mensagens/conversas/${dm}/mensagens`)).status, 404);
    assert.equal((await say(c.edu, dm, 'Intrometido')).status, 404);
    assert.equal((await c.edu.get(`/mensagens/${dm}`)).status, 404);
  });

  it('o texto é limpo e a mensagem aparece para a outra pessoa com a contagem de não lidas', async () => {
    const r = await post(c.ana, `/mensagens/conversas/${dm}/mensagens`, { client_id: uid(), html: '<p>Olá <script>alert(1)</script><strong>Bia</strong></p>' });
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.json.message.html, /script/); assert.match(r.json.message.html, /<strong>Bia<\/strong>/);
    assert.equal((await get(c.bia, '/mensagens/nao-lidas')).json.n, 2);
    assert.equal((await get(c.ana, '/mensagens/nao-lidas')).json.n, 0, 'o que eu mesma enviei não conta');
    const [conv] = (await get(c.bia, '/mensagens/conversas')).json.conversations;
    assert.equal(conv.name, 'Ana Gestão'); assert.equal(conv.unread, 2); assert.match(conv.preview, /Olá/);
    assert.equal((await post(c.bia, `/mensagens/conversas/${dm}/lida`, { ate: r.json.message.id })).status, 200);
    assert.equal((await get(c.bia, '/mensagens/nao-lidas')).json.n, 0);
  });

  describe('não duplicar', () => {
    it('reenviar a mesma mensagem (nova tentativa da rede) devolve a mesma, sem criar outra', async () => {
      const client_id = uid();
      const a = await post(c.ana, `/mensagens/conversas/${dm}/mensagens`, { client_id, html: '<p>Uma vez só</p>' });
      const b = await post(c.ana, `/mensagens/conversas/${dm}/mensagens`, { client_id, html: '<p>Uma vez só</p>' });
      assert.equal(a.json.message.id, b.json.message.id); assert.equal(b.json.duplicate, true);
      assert.equal((await q('SELECT count(*)::int AS n FROM chat_messages WHERE client_id = $1', [client_id]))[0].n, 1);
    });

    it('dez envios simultâneos do mesmo clique viram uma mensagem e um evento', async () => {
      await settle(); sent.length = 0;
      const client_id = uid();
      const all = await Promise.all(Array.from({ length: 10 }, () => post(c.ana, `/mensagens/conversas/${dm}/mensagens`, { client_id, html: '<p>Clique nervoso</p>' })));
      assert.ok(all.every((r) => r.status === 200), JSON.stringify(all.map((r) => r.status)));
      assert.equal(new Set(all.map((r) => r.json.message.id)).size, 1);
      assert.equal((await q('SELECT count(*)::int AS n FROM chat_messages WHERE client_id = $1', [client_id]))[0].n, 1);
      await settle();
      assert.equal(sent.filter((s) => s.routingKey === 'evento.mensagem').length, 1);
      assert.equal(sent.filter((s) => s.routingKey === 'espera.aviso').length, 1);
    });

    it('o mesmo código numa conversa diferente é recusado, sem vazar a mensagem', async () => {
      const client_id = uid();
      await post(c.ana, `/mensagens/conversas/${dm}/mensagens`, { client_id, html: '<p>Original</p>' });
      const { json: g } = await post(c.ana, '/mensagens/conversas', { tipo: 'grupo', nome: 'Outro', pessoas: [u.bia.id] });
      const r = await post(c.ana, `/mensagens/conversas/${g.id}/mensagens`, { client_id, html: '<p>Outra</p>' });
      assert.equal(r.status, 409); assert.equal(r.json.message, undefined);
    });

    it('aviso entregue duas vezes pelo Rabbit gera uma notificação só', async () => {
      await post(c.bia, `/mensagens/conversas/${dm}/lida`, { ate: 999999 });
      const { json } = await say(c.ana, dm, 'Vai repetir');
      const event = { conversationId: dm, messageId: json.message.id };
      await chat.handleTask('tarefa.aviso', event);
      await chat.handleTask('tarefa.aviso', event);
      const rows = await q("SELECT * FROM chat_alerts WHERE user_id = $1 AND dedupe_key = $2", [u.bia.id, `chat-${dm}-${json.message.id}`]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].url, `/mensagens/${dm}`);
      assert.equal((await q("SELECT count(*)::int AS n FROM notifications WHERE url LIKE '/mensagens%'"))[0].n, 0, 'mensagem não entra na lista de Notificações (nem no sino)');
    });

    it('reagir com o mesmo emoji ao mesmo tempo não conta duas vezes', async () => {
      const { json } = await say(c.ana, dm, 'Reage');
      await Promise.all([post(c.bia, `/mensagens/m/${json.message.id}/reagir`, { emoji: '👍' }), post(c.ana, `/mensagens/m/${json.message.id}/reagir`, { emoji: '❤️' })]);
      const rows = await q('SELECT * FROM chat_reactions WHERE message_id = $1', [json.message.id]);
      assert.equal(rows.length, 2);
    });

    it('reação avisa quem escreveu (a própria não avisa; tirar e pôr de novo não repete)', async () => {
      const { json } = await say(c.ana, dm, 'Ficou bom o corte?');
      const mid = json.message.id;
      const avisos = () => q("SELECT title, body, url FROM chat_alerts WHERE user_id = $1 AND title LIKE '%reagiu%' AND dedupe_key LIKE $2", [u.ana.id, `chat-reacao-${mid}-%`]);
      await post(c.ana, `/mensagens/m/${mid}/reagir`, { emoji: '👍' });
      assert.equal((await avisos()).length, 0);
      await post(c.bia, `/mensagens/m/${mid}/reagir`, { emoji: '🎉' });
      await post(c.bia, `/mensagens/m/${mid}/reagir`, { emoji: '🎉' });
      await post(c.bia, `/mensagens/m/${mid}/reagir`, { emoji: '🎉' });
      const list = await avisos();
      assert.equal(list.length, 1);
      assert.match(list[0].title, /reagiu 🎉 à sua mensagem/); assert.match(list[0].body, /Ficou bom o corte/); assert.equal(list[0].url, `/mensagens/${dm}`);
    });
  });

  describe('garantir a entrega', () => {
    it('a mensagem e o "falta publicar" entram juntos: se a publicação falhar, continua pendente e sai na próxima volta', async () => {
      await settle();
      relay.setTransport(async () => { throw new Error('fora do ar'); });
      const { json } = await say(c.ana, dm, 'Rabbit caiu');
      assert.ok(json.message.id, 'a pessoa recebe a confirmação: a mensagem está salva');
      await relay.drain(); await relay.tick();
      const left = await pendingOutbox();
      assert.ok(left.some((r) => r.routing_key === 'evento.mensagem' && r.payload.messageIds.includes(json.message.id)), 'não perdeu');
      assert.match(left[0].last_error, /fora do ar/);
      relay.setTransport(fake); sent.length = 0;
      await relay.tick();
      assert.equal((await pendingOutbox()).length, 0);
      assert.ok(sent.some((s) => s.routingKey === 'evento.mensagem' && s.event.messageIds.includes(json.message.id)), 'entregou quando voltou');
      assert.ok(sent.every((s, i) => i === 0 || sent[i - 1].event.id < s.event.id), 'na ordem');
    });

    it('sem RabbitMQ, o evento segue pelo Postgres e as tarefas pela fila, sem parar o chat', async () => {
      await settle();
      const delivered = [];
      const real = relay.setTransport(async (routingKey, event) => { await relay.fallback(routingKey, event); delivered.push(routingKey); return 'postgres'; });
      const { json } = await say(c.ana, dm, 'Sem Rabbit');
      await settle();
      assert.deepEqual(delivered.sort(), ['espera.aviso', 'evento.mensagem']);
      const [job] = await q("SELECT * FROM jobs WHERE kind = 'chat_tarefa' ORDER BY id DESC LIMIT 1");
      assert.equal(job.payload.routingKey, 'tarefa.aviso'); assert.equal(job.payload.event.messageId, json.message.id);
      assert.ok(new Date(job.run_after) > new Date(Date.now() + 5000), 'espera antes de avisar');
      relay.setTransport(real === fake ? fake : fake);
    });

    it('com o painel aberto, a mensagem chega ao vivo com o conteúdo', async () => {
      await settle();
      const ctl = new AbortController();
      const res = await fetch(`${app.base}/eventos`, { headers: { cookie: c.bia.cookie(), accept: 'text/event-stream' }, signal: ctl.signal });
      const reader = res.body.getReader();
      const got = (async () => {
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return null;
          buf += Buffer.from(value).toString();
          const m = buf.match(/event: chat\ndata: (.*)\n/);
          if (m) return JSON.parse(m[1]);
        }
      })();
      relay.setTransport(async (routingKey, event) => { await relay.fallback(routingKey, event); return 'postgres'; });
      const { json } = await say(c.ana, dm, 'Ao vivo');
      await settle();
      const ev = await Promise.race([got, new Promise((_, no) => setTimeout(() => no(new Error('não chegou ao vivo')), 8000))]);
      ctl.abort();
      relay.setTransport(fake);
      assert.equal(ev.kind, 'mensagem'); assert.equal(ev.messages[0].id, json.message.id); assert.match(ev.messages[0].html, /Ao vivo/);
      assert.equal(ev.messages[0].client_id, json.message.client_id, 'a tela casa com a mensagem que estava "enviando"');
    });

    it('quem esteve desconectado recebe tudo o que mudou: novas, editadas, apagadas, reações e respostas', async () => {
      const { json: base } = await say(c.ana, dm, 'Antes de cair');
      const { json: h0 } = await get(c.bia, `/mensagens/conversas/${dm}/novidades?desde=0`);
      const cursor = h0.rev;
      const nova = (await say(c.ana, dm, 'Enquanto estava fora')).json.message;
      await post(c.ana, `/mensagens/m/${base.message.id}/editar`, { html: '<p>Antes de cair, corrigido</p>' });
      const apagar = (await say(c.ana, dm, 'Vai sumir')).json.message;
      await post(c.ana, `/mensagens/m/${apagar.id}/apagar`);
      const reagir = (await say(c.ana, dm, 'Ganha reação')).json.message;
      await post(c.ana, `/mensagens/m/${reagir.id}/reagir`, { emoji: '🎉' });
      const resp = (await say(c.ana, dm, 'Resposta', { parent_id: nova.id })).json.message;
      const { json } = await get(c.bia, `/mensagens/conversas/${dm}/novidades?desde=${cursor}`);
      const by = new Map(json.messages.map((m) => [m.id, m]));
      assert.ok(by.get(nova.id), 'nova'); assert.equal(by.get(nova.id).reply_count, 1, 'contagem de respostas atualizada');
      assert.match(by.get(base.message.id).html, /corrigido/); assert.equal(by.get(base.message.id).edited, true);
      assert.equal(by.get(apagar.id).deleted, true); assert.equal(by.get(apagar.id).html, '');
      assert.equal(by.get(reagir.id).reactions[0].emoji, '🎉');
      assert.ok(by.get(resp.id));
      assert.ok(json.rev > cursor);
      assert.equal((await get(c.bia, `/mensagens/conversas/${dm}/novidades?desde=${json.rev}`)).json.messages.length, 0, 'nada repetido na próxima conferência');
    });

    it('a rev nunca fica fora de ordem, com várias pessoas escrevendo ao mesmo tempo', async () => {
      const before0 = (await q('SELECT rev FROM chat_conversations WHERE id = $1', [dm]))[0].rev;
      const all = await Promise.all(Array.from({ length: 12 }, (_, i) => say(i % 2 ? c.ana : c.bia, dm, `Mensagem ${i}`)));
      const list = all.map((r) => r.json.message).sort((a, b) => a.id - b.id);
      for (let i = 1; i < list.length; i++) assert.ok(list[i].rev > list[i - 1].rev, 'id maior sempre com rev maior');
      assert.equal(Number((await q('SELECT rev FROM chat_conversations WHERE id = $1', [dm]))[0].rev) - Number(before0), 12);
    });
  });

  describe('editar, apagar, reagir e thread', () => {
    it('só quem enviou edita e apaga; editada fica marcada; apagada some o conteúdo', async () => {
      const { json: { message: m } } = await say(c.ana, dm, 'Texto original');
      assert.equal((await post(c.bia, `/mensagens/m/${m.id}/editar`, { html: '<p>Hack</p>' })).status, 403);
      assert.equal((await post(c.bia, `/mensagens/m/${m.id}/apagar`)).status, 403);
      const e = await post(c.ana, `/mensagens/m/${m.id}/editar`, { html: '<p>Texto novo</p>' });
      assert.equal(e.json.message.edited, true); assert.match(e.json.message.html, /novo/);
      assert.equal((await post(c.ana, `/mensagens/m/${m.id}/editar`, { html: '' })).status, 400, 'não pode ficar vazia');
      const d = await post(c.ana, `/mensagens/m/${m.id}/apagar`);
      assert.equal(d.json.message.deleted, true); assert.equal(d.json.message.html, ''); assert.equal(d.json.message.text, '');
      assert.equal((await post(c.ana, `/mensagens/m/${m.id}/editar`, { html: '<p>Volta</p>' })).status, 409);
      assert.equal((await post(c.edu, `/mensagens/m/${m.id}/reagir`, { emoji: '👍' })).status, 403, 'quem está fora não reage');
    });

    it('clicar de novo no emoji tira a reação; emoji fora da paleta é recusado', async () => {
      const { json: { message: m } } = await say(c.ana, dm, 'Palma');
      const a = await post(c.bia, `/mensagens/m/${m.id}/reagir`, { emoji: '🙏' });
      assert.equal(a.json.message.reactions[0].count, 1);
      const b = await post(c.bia, `/mensagens/m/${m.id}/reagir`, { emoji: '🙏' });
      assert.deepEqual(b.json.message.reactions, []);
      assert.equal((await post(c.bia, `/mensagens/m/${m.id}/reagir`, { emoji: '💀' })).status, 400);
    });

    it('thread: a resposta fica fora da lista principal, soma na original e não aceita resposta de resposta', async () => {
      const { json: { message: root } } = await say(c.ana, dm, 'Assunto');
      const r1 = (await say(c.bia, dm, 'Primeira resposta', { parent_id: root.id })).json.message;
      await say(c.ana, dm, 'Segunda resposta', { parent_id: root.id });
      assert.equal(r1.parent_id, root.id);
      const page = (await get(c.ana, `/mensagens/conversas/${dm}/mensagens?limite=100`)).json;
      assert.ok(!page.messages.some((m) => m.parent_id), 'as respostas não entram na lista principal');
      assert.equal(page.messages.find((m) => m.id === root.id).reply_count, 2);
      const t = (await get(c.bia, `/mensagens/m/${root.id}/respostas`)).json;
      assert.equal(t.parent.id, root.id); assert.equal(t.replies.length, 2);
      assert.equal((await get(c.edu, `/mensagens/m/${root.id}/respostas`)).status, 404);
      assert.equal((await say(c.ana, dm, 'Aninhada', { parent_id: r1.id })).status, 404);
    });

    it('histórico vem em páginas', async () => {
      const first = (await get(c.ana, `/mensagens/conversas/${dm}/mensagens?limite=3`)).json;
      assert.equal(first.messages.length, 3); assert.equal(first.more, true);
      const older = (await get(c.ana, `/mensagens/conversas/${dm}/mensagens?limite=3&antes=${first.messages[0].id}`)).json;
      assert.ok(older.messages.every((m) => m.id < first.messages[0].id));
    });
  });

  describe('grupos', () => {
    let g;
    it('cria o grupo com quem cria na administração; precisa de nome e de alguém', async () => {
      assert.equal((await post(c.ana, '/mensagens/conversas', { tipo: 'grupo', nome: '  ', pessoas: [u.bia.id] })).status, 400);
      assert.equal((await post(c.ana, '/mensagens/conversas', { tipo: 'grupo', nome: 'Vazio', pessoas: [] })).status, 400);
      g = (await post(c.ana, '/mensagens/conversas', { tipo: 'grupo', nome: 'Edição EP.020', pessoas: [u.bia.id] })).json.id;
      const d = (await get(c.ana, `/mensagens/conversas/${g}`)).json.conversation;
      assert.equal(d.name, 'Edição EP.020'); assert.equal(d.role, 'admin'); assert.equal(d.people.length, 2);
      assert.equal(d.people.find((p) => p.id === u.bia.id).role, 'member');
    });

    it('só quem administra renomeia, adiciona, remove e muda papéis', async () => {
      assert.equal((await post(c.bia, `/mensagens/conversas/${g}/nome`, { nome: 'Golpe' })).status, 403);
      assert.equal((await post(c.bia, `/mensagens/conversas/${g}/pessoas`, { pessoas: [u.edu.id] })).status, 403);
      assert.equal((await post(c.bia, `/mensagens/conversas/${g}/pessoas/${u.ana.id}/remover`)).status, 403);
      assert.equal((await post(c.bia, `/mensagens/conversas/${g}/pessoas/${u.bia.id}/papel`, { papel: 'admin' })).status, 403);
      assert.equal((await post(c.ana, `/mensagens/conversas/${g}/nome`, { nome: 'Edição do EP.020' })).status, 200);
      assert.equal((await get(c.bia, `/mensagens/conversas/${g}`)).json.conversation.name, 'Edição do EP.020');
    });

    it('quem entra vê o histórico, mas ele não conta como não lido', async () => {
      await say(c.ana, g, 'Antes do Edu chegar');
      assert.equal((await post(c.ana, `/mensagens/conversas/${g}/pessoas`, { pessoas: [u.edu.id] })).status, 200);
      const seen = (await get(c.edu, `/mensagens/conversas/${g}/mensagens`)).json.messages;
      assert.equal(seen.filter((m) => !m.event).length, 1);
      assert.deepEqual(seen.filter((m) => m.event).map((m) => [m.event, m.text]), [['criou', 'Ana Gestão criou o grupo'], ['renomeou', 'Ana Gestão mudou o nome do grupo para Edição do EP.020'], ['adicionou', 'Ana Gestão adicionou Edu Editor']]);
      assert.equal((await get(c.edu, '/mensagens/nao-lidas')).json.n, 0, 'o aviso do grupo não conta como não lido');
      const [added] = await q("SELECT title, url FROM chat_alerts WHERE user_id = $1 AND title LIKE '%adicionou você%'", [u.edu.id]);
      assert.equal(added.title, 'Ana Gestão adicionou você ao grupo Edição do EP.020'); assert.equal(added.url, `/mensagens/${g}`);
      const ev = seen.find((m) => m.event);
      assert.equal((await post(c.ana, `/mensagens/m/${ev.id}/apagar`)).status, 409, 'aviso do grupo não se apaga');
      assert.equal((await say(c.ana, g, 'thread no aviso', { parent_id: ev.id })).status, 404);
      await say(c.ana, g, 'Oi, Edu');
      assert.equal((await get(c.edu, '/mensagens/nao-lidas')).json.n, 1);
    });

    it('quem sai deixa de ler; removido volta sem duplicar a participação', async () => {
      assert.equal((await post(c.ana, `/mensagens/conversas/${g}/pessoas/${u.edu.id}/remover`)).status, 200);
      assert.equal((await get(c.edu, `/mensagens/conversas/${g}/mensagens`)).status, 404);
      assert.equal((await say(c.edu, g, 'Ainda aqui?')).status, 404);
      assert.equal((await post(c.ana, `/mensagens/conversas/${g}/pessoas`, { pessoas: [u.edu.id] })).status, 200);
      assert.equal((await q('SELECT count(*)::int AS n FROM chat_members WHERE conversation_id = $1 AND user_id = $2', [g, u.edu.id]))[0].n, 1);
      assert.equal((await post(c.ana, `/mensagens/conversas/${g}/pessoas`, { pessoas: [u.edu.id] })).status, 409, 'quem já está não entra de novo');
      const texts = (await get(c.bia, `/mensagens/conversas/${g}/mensagens`)).json.messages.filter((m) => m.event).map((m) => m.text);
      assert.ok(texts.includes('Ana Gestão tirou Edu Editor do grupo'));
    });

    it('o grupo sempre tem quem administre', async () => {
      assert.equal((await post(c.ana, `/mensagens/conversas/${g}/pessoas/${u.ana.id}/papel`, { papel: 'member' })).status, 409);
      assert.equal((await post(c.ana, `/mensagens/conversas/${g}/pessoas/${u.ana.id}/remover`)).status, 400);
      assert.equal((await post(c.ana, `/mensagens/conversas/${g}/sair`)).status, 200);
      const d = (await get(c.bia, `/mensagens/conversas/${g}`)).json.conversation;
      assert.equal(d.people.length, 2); assert.equal(d.people.find((p) => p.id === u.bia.id).role, 'admin', 'quem entrou primeiro assume');
      assert.equal((await get(c.ana, `/mensagens/conversas/${g}`)).status, 404);
      const [conv] = (await get(c.bia, '/mensagens/conversas')).json.conversations.filter((x) => x.id === g);
      assert.equal(conv.preview, 'Ana Gestão saiu do grupo'); assert.equal(conv.preview_author, null);
    });

    it('conversa individual não vira grupo', async () => {
      assert.equal((await post(c.ana, `/mensagens/conversas/${dm}/pessoas`, { pessoas: [u.edu.id] })).status, 404);
      assert.equal((await post(c.ana, `/mensagens/conversas/${dm}/sair`)).status, 404);
    });
  });

  describe('avisos', () => {
    let g2;
    before(async () => { g2 = (await post(c.ana, '/mensagens/conversas', { tipo: 'grupo', nome: 'Avisos', pessoas: [u.bia.id, u.edu.id] })).json.id; });
    const notices = (who) => q("SELECT * FROM chat_alerts WHERE user_id = $1 AND url = $2 AND title NOT LIKE '%adicionou você%' ORDER BY id", [who.id, `/mensagens/${g2}`]);

    it('quem leu nos 20 segundos não recebe aviso; quem não leu recebe; quem escreveu, nunca', async () => {
      const { json: { message: m } } = await say(c.ana, g2, 'Bom dia');
      await post(c.bia, `/mensagens/conversas/${g2}/lida`, { ate: m.id });
      await chat.handleTask('tarefa.aviso', { conversationId: g2, messageId: m.id });
      assert.equal((await notices(u.bia)).length, 0);
      assert.equal((await notices(u.ana)).length, 0);
      const [n] = await notices(u.edu);
      assert.match(n.title, /Ana Gestão em Avisos/); assert.match(n.body, /Bom dia/);
    });

    it('rajada de mensagens vira um aviso só, com a contagem', async () => {
      const ids = [];
      for (let i = 0; i < 3; i++) ids.push((await say(c.ana, g2, `Parte ${i}`)).json.message.id);
      for (const id of ids) await chat.handleTask('tarefa.aviso', { conversationId: g2, messageId: id });
      const list = await notices(u.edu);
      assert.equal(list.length, 2, 'o de antes e um pela rajada');
      assert.match(list[1].title, /Avisos: 3 mensagens novas/);
    });

    it('abrir a conversa zera o contador de Mensagens (o sino não muda: mensagem não é Notificação)', async () => {
      const { rows: [{ last_message_id: last }] } = await h.db.query('SELECT last_message_id FROM chat_conversations WHERE id = $1', [g2]);
      const bell = (await q('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [u.edu.id]))[0].n;
      await post(c.edu, `/mensagens/conversas/${g2}/lida`, { ate: Number(last) });
      const [conv] = (await get(c.edu, '/mensagens/conversas')).json.conversations.filter((x) => x.id === g2);
      assert.equal(conv.unread, 0);
      assert.equal((await q('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [u.edu.id]))[0].n, bell);
    });
  });

  it('áudio: o anexo vai junto, com a transcrição, e só quem participa ouve', async () => {
    const csrf = await c.ana.csrf('/mensagens');
    const up = await fetch(`${app.base}/anexos`, { method: 'POST', headers: { cookie: c.ana.cookie(), accept: 'application/json', 'content-type': 'audio/webm', 'x-csrf-token': csrf, 'x-duration-ms': '4200', 'x-filename': 'audio.webm' }, body: Buffer.alloc(2048, 7) });
    const { attachment } = await up.json();
    assert.ok(attachment.id);
    const r = await post(c.ana, `/mensagens/conversas/${dm}/mensagens`, { client_id: uid(), html: '', anexos: [attachment.id] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const [a] = r.json.message.attachments;
    assert.equal(a.kind, 'audio'); assert.ok(a.transcript); assert.equal(a.duration_ms, 4200);
    const [conv] = (await get(c.bia, '/mensagens/conversas')).json.conversations.filter((x) => x.id === dm);
    assert.equal(conv.preview, 'Áudio');
    const open = (who) => fetch(`${app.base}/anexos/${a.id}`, { redirect: 'manual', headers: { cookie: who.cookie() } }).then((x) => x.status);
    assert.equal(await open(c.bia), 302);
    assert.equal(await open(c.edu), 404);
    assert.equal((await post(c.ana, `/mensagens/conversas/${dm}/mensagens`, { client_id: uid(), html: '' })).status, 400, 'mensagem vazia não vai');
  });

  describe('resumo com IA', () => {
    const calls = [];
    const realFetch = global.fetch;
    before(() => {
      config.gemini.key = 'teste'; config.geminiConfigured = true;
      global.fetch = async (url, opts) => {
        if (!String(url).includes('generativelanguage.googleapis.com')) return realFetch(url, opts);
        const body = JSON.parse(opts.body); calls.push(body);
        const text = JSON.stringify({ resumo: 'Combinaram o corte.', decisoes: ['Cortar a abertura'], pendencias: ['Edu sobe a v2'] });
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
    });
    after(() => { global.fetch = realFetch; config.gemini.key = ''; config.geminiConfigured = false; });

    it('resume, entrega só para quem pediu e não gera de novo se a tarefa repetir', async () => {
      const { json: { message: m } } = await say(c.bia, dm, 'Vamos cortar a abertura?');
      const r = await post(c.ana, `/mensagens/conversas/${dm}/resumo`, { alcance: 'nao_lidas', desde_id: m.id });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      await settle();
      calls.length = 0;
      await chat.handleTask('tarefa.resumo', { summaryId: r.json.id });
      await chat.handleTask('tarefa.resumo', { summaryId: r.json.id });
      assert.equal(calls.length, 1, 'uma chamada à IA');
      assert.match(calls[0].contents[0].parts[0].text, /Bia Produtora: Vamos cortar a abertura\?/);
      const s = (await get(c.ana, `/mensagens/resumos/${r.json.id}`)).json.summary;
      assert.equal(s.status, 'pronto'); assert.equal(s.result.decisoes[0], 'Cortar a abertura'); assert.equal(s.message_count, 1);
      assert.equal((await get(c.bia, `/mensagens/resumos/${r.json.id}`)).status, 404, 'o resumo é de quem pediu');
    });

    it('thread e período: só o que foi pedido; sem mensagens, avisa; quem não participa não pede', async () => {
      const { json: { message: root } } = await say(c.ana, dm, 'Pauta da thread');
      await say(c.bia, dm, 'Dentro da thread', { parent_id: root.id });
      const r = await post(c.ana, `/mensagens/conversas/${dm}/resumo`, { alcance: 'thread', parent_id: root.id });
      await settle(); calls.length = 0;
      await chat.handleTask('tarefa.resumo', { summaryId: r.json.id });
      const text = calls[0].contents[0].parts[0].text;
      assert.match(text, /Pauta da thread/); assert.match(text, /Dentro da thread/); assert.doesNotMatch(text, /Vamos cortar/);
      assert.equal((await post(c.ana, `/mensagens/conversas/${dm}/resumo`, { alcance: 'nao_lidas', desde_id: 99999999 })).status, 404);
      assert.equal((await post(c.edu, `/mensagens/conversas/${dm}/resumo`, { alcance: '24h' })).status, 404);
      assert.equal((await post(c.ana, `/mensagens/conversas/${dm}/resumo`, { alcance: 'tudo' })).status, 400);
    });
  });

  it('a página abre para toda a equipe, com o contador no menu', async () => {
    await say(c.ana, dm, 'Conta no menu');
    const page = (await c.bia.get('/mensagens')).text;
    assert.match(page, /data-chat /); assert.match(page, /\/static\/chat\.js/);
    assert.match(page, /data-chat-unread\s*>\d+</, 'contador aparece');
    const editor = (await c.edu.get('/mensagens')).text;
    assert.match(editor, /Nova conversa/);
    assert.equal((await c.bia.get(`/mensagens/${dm}`)).status, 200);
  });
});
