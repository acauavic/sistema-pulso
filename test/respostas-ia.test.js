const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const R = require('../src/services/commentReplies');

describe('Respostas por IA nos comentários (Social > Comentários)', () => {
  const as = {}; let app; let pub; let pub2; let gestaoId;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const realFetch = global.fetch;
  const calls = []; const geminiCalls = [];
  const comments = { op1: [], op2: [] };
  const at = (iso) => new Date(iso); // horários em UTC; Brasília = UTC-3
  const byText = async (t) => (await q('SELECT * FROM social_comments WHERE text = $1', [t]))[0];

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora'], ['editor', 'editor_video']]) {
      const u = await h.createUser({ name: k, email: `${k}@t.com`, role }); if (k === 'gestao') gestaoId = u.id;
      as[k] = h.client(app.base); await as[k].login(`${k}@t.com`);
    }
    const [g] = await q("INSERT INTO guests (name, profile, status, instagram) VALUES ('Mari Vabo', 'medico', 'gravado', '@marivabo') RETURNING id");
    const [ep] = await q("INSERT INTO episodes (number, title, status, guest_id) VALUES (12, 'Relações', 'publicado', $1) RETURNING id", [g.id]);
    const res = (ref, id) => JSON.stringify([{ platform: 'instagram', provider: 'outstand', ref, post_id: id, ok: true, url: `https://www.instagram.com/reel/${ref}/` }]);
    [pub] = await q("INSERT INTO episode_publications (episode_id, platforms, title, description, status, results) VALUES ($1, '{instagram}', 'A segurança que o homem maduro busca', 'Lealdade.', 'publicado', $2) RETURNING *", [ep.id, res('op1', '1789')]);
    [pub2] = await q("INSERT INTO episode_publications (episode_id, platforms, title, status, results) VALUES ($1, '{instagram}', 'Nem toda relação', 'publicado', $2) RETURNING *", [ep.id, res('op2', '1790')]);
    Object.assign(h.config.outstand, { key: 'ost', base: 'https://outstand.test', live: true }); h.config.outstandConfigured = true;
    Object.assign(h.config.gemini, { key: 'gem' }); h.config.geminiConfigured = true;
    require('../src/services/outstand').resetCache();
    const c = (id, text, username, replies = []) => ({ id, text, username, timestamp: '2026-11-18T12:00:00+0000', like_count: 0, replies: { data: replies } });
    comments.op1 = [
      c('c1', '50% das mulheres mentem', 'ana1'), c('c2', '👏👏', 'bia2'), c('c3', 'Qual remédio eu tomo para ansiedade?', 'caio3'),
      c('c4', '@marivabo você é incrível', 'duda4'), c('c5', 'Já respondido', 'edu5', [{ id: 'r5', text: 'Valeu!', username: null }]),
      c('r5', 'Valeu!', 'podcastpulso'), // como o Instagram devolve: a resposta do Pulso também solta, com o @
      c('c6', 'Post nosso', 'podcastpulso'), c('c7', 'Obrigada pelo carinho', 'marivabo'), c('c8', 'texto ambíguo', 'fabi8'),
      c('c9', 'Concordo', 'gui9', [{ id: 'r9', text: 'E você, já viveu isso?', username: 'podcastpulso' }, { id: 'r9b', text: 'Vivi sim, no trabalho', username: 'gui9' }]),
      c('c10', '', 'h10'),
    ];
    comments.op2 = [c('d1', 'Faz sentido demais', 'ivo1'), c('d2', 'Verdade', 'jo2')];
    global.fetch = async (url, opts = {}) => {
      const s = String(url);
      if (s.startsWith('https://generativelanguage.googleapis.com/')) {
        const body = JSON.parse(opts.body);
        const text = body.contents[0].parts.map((p) => p.text || '').join('\n');
        const props = Object.keys(body.generationConfig.responseSchema.properties);
        geminiCalls.push({ props, text, system: body.systemInstruction?.parts?.[0]?.text || '' });
        let data;
        if (props.includes('opcoes')) data = { opcoes: ['E na sua rotina, como isso aparece?', 'Concorda com ela?', 'Qual parte mais te pegou?'] };
        else {
          const list = JSON.parse(text.slice(text.indexOf('Comentários (JSON):') + 'Comentários (JSON):'.length));
          data = { itens: list.map((k) => {
            if (/50%/.test(k.texto)) return { id: k.id, acao: 'responder', motivo: 'generalização', resposta: 'E os homens, 100% sinceros? Essa conta não fecha. De onde saiu essa estatística?', confianca: 0.9 };
            if (/👏/.test(k.texto)) return { id: k.id, acao: 'reagir', motivo: 'apoio', resposta: '🔥', confianca: 0.95 };
            if (/remédio/.test(k.texto)) return { id: k.id, acao: 'equipe', motivo: 'pedido de orientação de saúde', confianca: 0.9 };
            if (/@marivabo/.test(k.texto)) return { id: k.id, acao: 'ignorar', motivo: 'conversa com a convidada', confianca: 0.9 };
            if (/ambíguo/.test(k.texto)) return { id: k.id, acao: 'responder', motivo: 'incerto', resposta: 'Hum, conta mais?', confianca: 0.3 };
            return { id: k.id, acao: 'responder', motivo: 'opinião', resposta: `Boa, @${k.usuario}. E no seu dia a dia, como isso aparece?!!`, confianca: 0.85 };
          }) };
        }
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }] });
      }
      if (!s.startsWith('https://outstand.test')) return realFetch(url, opts);
      const method = opts.method || 'GET'; const path = s.replace('https://outstand.test', '');
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ method, path, body });
      if (method === 'GET' && path.startsWith('/v1/social-accounts?')) return Response.json({ success: true, data: [{ id: 'IG1', network: 'instagram', username: 'podcastpulso', isActive: 1 }] });
      if (method === 'GET' && path.startsWith('/v1/posts/op3/replies')) return Response.json({ success: true, replies: { comments: [] }, data: [{ id: 'n1', author_username: 'kika', text: 'Oi', created_at: '2026-11-19T10:00:00+0000', like_count: 2, replies: [{ id: 'n2', author_username: null, text: 'Olá!' }] }] });
      const m = path.match(/^\/v1\/posts\/(op\d)\/replies/);
      if (m && method === 'GET') return Response.json({ success: true, replies: { comments: comments[m[1]] } });
      if (m && method === 'POST') return body.platform_post_id ? Response.json({ success: true, reply_id: `rep-${body.parent_comment_id}` }) : Response.json({ error: 'platform_post_id required' }, { status: 400 });
      if (m && method === 'DELETE') return Response.json({ success: true });
      return Response.json({ error: 'sem rota' }, { status: 404 });
    };
  });
  after(async () => { global.fetch = realFetch; h.config.outstand.live = false; h.config.geminiConfigured = false; await app.close(); await h.db.close(); });

  it('desligada: a tela ensina e só a gestão liga; o editor não entra', async () => {
    let page = (await as.gestao.get('/social/comentarios')).text;
    assert.match(page, /A IA responde os comentários dos posts do Pulso/); assert.match(page, /Ligar respostas por IA/);
    assert.match(page, /Comentários<\/a>|Comentários <span/, 'aba no menu do Social');
    page = (await as.prod.get('/social/comentarios')).text;
    assert.doesNotMatch(page, /Ligar respostas por IA/); assert.match(page, /A gestão liga as respostas por IA aqui/);
    assert.equal((await as.editor.get('/social/comentarios')).status, 403);
    assert.equal((await as.prod.act('/social/comentarios/ligar', { on: '1' }, { from: '/social/comentarios' })).status, 403);
    assert.equal((await R.sweep()).skipped, 'desligada', 'desligada: não lê nada');
  });

  it('ligar: lê os posts e a IA faz a triagem (polêmico responde, saúde vai para a equipe, convidado e vazio ficam de fora)', async () => {
    const r = await as.gestao.act('/social/comentarios/ligar', { on: '1' }, { from: '/social/comentarios' });
    assert.equal(r.status, 302);
    assert.equal((await R.getConfig()).on, true);
    assert.equal((await q("SELECT count(*)::int AS n FROM jobs WHERE kind = 'comentarios_varredura'"))[0].n, 1, 'ligar já põe a leitura na fila');
    const sw = await R.sweep();
    assert.equal(sw.posts, 2);
    await R.classifyPublication(pub.id); await R.classifyPublication(pub2.id);

    const c1 = await byText('50% das mulheres mentem');
    assert.equal(c1.status, 'proposta'); assert.equal(c1.action, 'responder'); assert.match(c1.reply_text, /\?$/, 'termina com pergunta');
    assert.equal((await byText('Faz sentido demais')).reply_text, 'Boa, @ivo1. E no seu dia a dia, como isso aparece?!', 'sem "!!!"');
    const c2 = await byText('👏👏'); assert.equal(c2.action, 'reagir'); assert.equal(c2.reply_text, '🔥');
    assert.equal((await byText('Qual remédio eu tomo para ansiedade?')).status, 'equipe');
    assert.equal((await byText('@marivabo você é incrível')).status, 'ignorada');
    const c5 = await byText('Já respondido'); assert.equal(c5.status, 'respondida', 'o Pulso já respondeu: não repete');
    assert.equal(await byText('Post nosso'), undefined, 'comentário da própria conta nem entra');
    const c7 = await byText('Obrigada pelo carinho'); assert.equal(c7.status, 'ignorada'); assert.match(c7.reason, /convidado/);
    assert.equal((await byText('texto ambíguo')).status, 'equipe', 'pouca confiança: equipe');
    assert.equal((await byText('')).status, 'ignorada');
    const back = await byText('Vivi sim, no trabalho');
    assert.equal(back.parent_comment_id, 'c9', 'a pessoa respondeu ao Pulso: a conversa continua'); assert.equal(back.status, 'proposta');
    assert.equal((await byText('Concordo')).status, 'respondida');

    const ai = geminiCalls.find((g) => g.props.includes('itens'));
    assert.match(ai.system, /leve de acidez/); assert.match(ai.system, /termine com uma pergunta/); assert.match(ai.text, /Convidado: Mari Vabo \(@marivabo\)/);
    assert.doesNotMatch(ai.text, /Obrigada pelo carinho/, 'o que já foi decidido sem IA não vai para a IA');

    // avisos para gestão e produtora: precisa de você + esperando aprovação
    const notes = await q("SELECT n.title, u.role FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.type = 'redes' ORDER BY n.id");
    assert.ok(notes.some((n) => n.role === 'produtora' && /precisa(m)? de você/.test(n.title)));
    assert.ok(notes.some((n) => n.role === 'gestao' && /esperando aprovação/.test(n.title)));
    assert.ok(!notes.some((n) => n.role === 'editor_video'));

    // a varredura de novo não duplica nem desfaz o que foi decidido
    await R.sweep(); await R.classifyPublication(pub.id);
    assert.equal((await q('SELECT count(*)::int AS n FROM social_comments'))[0].n, 12);
    assert.equal((await byText('50% das mulheres mentem')).status, 'proposta');
  });

  it('a tela abre no que precisa de você; aprovar todas, editar e não responder (a produtora também)', async () => {
    let page = (await as.prod.get('/social/comentarios')).text;
    assert.match(page, /Precisa de você/); assert.match(page, /Qual remédio eu tomo para ansiedade\?/);
    assert.doesNotMatch(page, /50% das mulheres mentem/, 'abre na aba Precisam de você');
    assert.match(page, /class="nav-count"[^>]*>7</, 'contador da aba: para aprovar + precisam de você');
    page = (await as.prod.get('/social/comentarios?vista=aprovar')).text;
    assert.match(page, /Aprovar todas \(5\)/); assert.match(page, /50% das mulheres mentem/); assert.match(page, /E os homens, 100% sinceros\?/);
    assert.match(page, /data-ai="resposta"/, 'editar tem o Sugerir com IA');

    // equipe responde o de saúde com texto próprio
    const c3 = await byText('Qual remédio eu tomo para ansiedade?');
    let r = await as.prod.act(`/social/comentarios/${c3.id}/resposta`, { texto: 'Isso é conversa para o seu médico. O episódio fala de como buscar ajuda: já viu?', voltar: '/social/comentarios?vista=equipe' }, { from: '/social/comentarios' });
    assert.equal(r.location, '/social/comentarios?vista=equipe');
    assert.equal((await byText('Qual remédio eu tomo para ansiedade?')).status, 'aprovada');
    // só emoji vira reação
    const amb = await byText('texto ambíguo');
    await as.prod.act(`/social/comentarios/${amb.id}/resposta`, { texto: '💚' }, { from: '/social/comentarios' });
    const amb2 = await byText('texto ambíguo'); assert.equal(amb2.action, 'reagir'); assert.equal(amb2.status, 'aprovada');
    // não responder
    const d2 = await byText('Verdade');
    await as.prod.act(`/social/comentarios/${d2.id}/ignorar`, {}, { from: '/social/comentarios' });
    assert.equal((await byText('Verdade')).status, 'ignorada');
    // aprovar todas
    r = await as.prod.act('/social/comentarios/aprovar-todas', {}, { from: '/social/comentarios' });
    assert.equal(r.status, 302);
    assert.equal((await q("SELECT count(*)::int AS n FROM social_comments WHERE status = 'proposta'"))[0].n, 0);
    assert.equal((await q("SELECT count(*)::int AS n FROM social_comments WHERE status = 'aprovada'"))[0].n, 6);
    page = (await as.prod.get('/social/comentarios?vista=fila')).text;
    assert.match(page, /SAI POR VOLTA DE/); assert.match(page, /até 25 por hora/);
    // configuração é da gestão
    assert.equal((await as.prod.act('/social/comentarios/config', { mode: 'automatico' }, { from: '/social/comentarios' })).status, 403);
  });

  it('envio aos poucos: horário, intervalo, limite por hora, mistura os posts e manda o platform_post_id', async () => {
    await R.setConfig({ mode: 'aprovar', per_hour: '25', from: '8', to: '23', team_handles: '' });
    assert.equal((await R.sendTick({ now: at('2026-11-19T05:00:00Z') })).reason, 'fora do horário', '02:00 em Brasília');
    let r = await R.sendTick({ now: at('2026-11-19T15:00:00Z') });
    assert.equal(r.sent, 1);
    const first = (await q('SELECT * FROM social_comments WHERE id = $1', [r.id]))[0];
    assert.equal(first.status, 'enviada'); assert.ok(first.reply_id);
    const post = calls.filter((c) => c.method === 'POST').pop();
    assert.equal(post.body.platform_post_id, first.publication_id === pub.id ? '1789' : '1790');
    assert.equal((await R.sendTick({ now: at('2026-11-19T15:00:20Z') })).reason, 'intervalo', 'espera o intervalo aleatório');
    r = await R.sendTick({ now: at('2026-11-19T15:10:00Z') });
    const second = (await q('SELECT * FROM social_comments WHERE id = $1', [r.id]))[0];
    assert.notEqual(second.publication_id, first.publication_id, 'não responde o mesmo post duas vezes seguidas');
    // a resposta à resposta vai para o comentário de cima (no Instagram as respostas ficam num nível só)
    await q("UPDATE social_comments SET decided_at = now() - interval '1 day' WHERE text = 'Vivi sim, no trabalho'");
    for (let i = 0; i < 6; i += 1) await R.sendTick({ now: at(`2026-11-19T15:${20 + i * 5}:00Z`) });
    const backPost = calls.find((c) => c.method === 'POST' && c.body.content.includes('@gui9'));
    assert.equal(backPost.body.parent_comment_id, 'c9');
    // limite por hora
    await R.setConfig({ mode: 'aprovar', per_hour: '1', from: '0', to: '24' });
    await q("UPDATE social_comments SET status = 'aprovada' WHERE text = 'Faz sentido demais'");
    await h.db.query("DELETE FROM app_settings WHERE key = 'respostas_ia_envio'");
    assert.equal((await R.sendTick({ now: at('2026-11-19T15:50:00Z') })).reason, 'limite por hora');
    // modo de teste: simula
    h.config.outstand.live = false;
    const sim = await R.sendTick({ now: at('2026-11-19T18:00:00Z') });
    assert.equal(sim.sent, 1); assert.equal((await q('SELECT status FROM social_comments WHERE id = $1', [sim.id]))[0].status, 'simulada');
    h.config.outstand.live = true;
    // desligada: nada sai
    await R.setConfig({ on: '0' }, { onlyToggle: true });
    assert.equal((await R.sendTick({ now: at('2026-11-19T19:00:00Z') })).reason, 'desligada');
    await R.setConfig({ on: '1' }, { onlyToggle: true });
  });

  it('apagar uma resposta enviada (desfazer)', async () => {
    const [sent] = await q("SELECT * FROM social_comments WHERE status = 'enviada' AND reply_id IS NOT NULL ORDER BY id LIMIT 1");
    const page = (await as.prod.get('/social/comentarios?vista=enviadas')).text;
    assert.match(page, /apagar resposta/);
    await as.prod.act(`/social/comentarios/${sent.id}/apagar`, {}, { from: '/social/comentarios' });
    const del = calls.find((c) => c.method === 'DELETE');
    assert.match(del.path, new RegExp(`/replies/${sent.reply_id}\\?platform_post_id=17\\d\\d$`));
    assert.equal((await q('SELECT status FROM social_comments WHERE id = $1', [sent.id]))[0].status, 'apagada');
  });

  it('na publicação: liga e desliga a IA só daquele post', async () => {
    let page = (await as.gestao.get(`/social/publicacoes/${pub2.id}`)).text;
    assert.match(page, /Respostas por IA/); assert.match(page, /LIGADA/); assert.match(page, new RegExp(`/social/comentarios\\?pub=${pub2.id}`));
    await as.gestao.act(`/social/publicacoes/${pub2.id}/respostas-ia`, { on: '0' }, { from: `/social/publicacoes/${pub2.id}` });
    assert.equal((await q('SELECT ai_replies FROM episode_publications WHERE id = $1', [pub2.id]))[0].ai_replies, false);
    assert.deepEqual((await R.watchedPosts()).map((p) => p.publication_id), [pub.id], 'post desligado sai da leitura');
    await q("DELETE FROM jobs WHERE kind = 'comentarios_ia'");
    assert.equal(await R.fromWebhook({ network: 'instagram', post_ref: 'op2' }), null, 'aviso de comentário de post desligado: nada');
    const job = await R.fromWebhook({ network: 'instagram', post_ref: 'op1', comment_id: 'w1', author_username: 'nova.fa', text: 'Gostei demais da conversa' });
    assert.equal(job.kind, 'comentarios_ia'); assert.equal(job.payload.fetch, true);
    const w1 = await byText('Gostei demais da conversa');
    assert.equal(w1.status, 'nova'); assert.equal(w1.publication_id, pub.id); assert.equal(w1.platform_post_id, '1789', 'o comentário do aviso entra na hora');
    await R.fromWebhook({ network: 'instagram', post_ref: 'op1', comment_id: 'w2', author_username: 'podcastpulso', text: 'Nosso' });
    assert.equal(await byText('Nosso'), undefined, 'da própria conta: não entra');
    assert.equal((await as.prod.act(`/social/publicacoes/${pub2.id}/respostas-ia`, { on: '1' }, { from: '/' })).status, 403);
    page = (await as.prod.get(`/social/publicacoes/${pub2.id}`)).text;
    assert.match(page, /desligada/);
  });

  it('Sugerir com IA na resposta usa o comentário como contexto', async () => {
    const c = await byText('50% das mulheres mentem');
    const csrf = await as.prod.csrf('/social/comentarios');
    const res = await fetch(`${app.base}/ia/texto`, { method: 'POST', headers: { cookie: as.prod.cookie(), 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': csrf, accept: 'application/json' }, body: new URLSearchParams({ campo: 'resposta', atalho: 'acido', comentario: String(c.id), atual: c.reply_text }) });
    const j = await res.json();
    assert.equal(j.ok, true); assert.equal(j.opcoes.length, 3);
    const call = geminiCalls.filter((g) => g.props.includes('opcoes')).pop();
    assert.match(call.text, /Comentário de @ana1 no post: 50% das mulheres mentem/); assert.match(call.text, /acidez/);
    const csrfE = await as.editor.csrf('/');
    const denied = await fetch(`${app.base}/ia/texto`, { method: 'POST', headers: { cookie: as.editor.cookie(), 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': csrfE, accept: 'application/json' }, body: new URLSearchParams({ campo: 'resposta', atalho: 'curto', comentario: String(c.id) }) });
    assert.equal(denied.status, 403);
  });

  it('a resposta pública da automação por palavra manda o platform_post_id', async () => {
    const ost = require('../src/services/outstand');
    await ost.replyToComment({ postRef: 'op1', commentId: 'x1', content: 'Oi', platformPostId: '1789' });
    assert.equal(calls.filter((c) => c.method === 'POST').pop().body.platform_post_id, '1789');
    const list = await ost.listComments({ postRef: 'op3', network: 'instagram' });
    assert.deepEqual(list[0], { id: 'n1', text: 'Oi', username: 'kika', timestamp: '2026-11-19T10:00:00+0000', likes: 2, authorId: null, replies: [{ id: 'n2', text: 'Olá!', username: null, timestamp: null, authorId: null }] }, 'formato novo (data) da Outstand');
    void gestaoId;
  });
});
