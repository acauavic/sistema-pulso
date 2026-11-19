const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const R = require('../src/services/commentReplies');

describe('Respostas por IA: convite para seguir e direct com a comunidade (Instagram)', () => {
  const as = {}; let app; let pub;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const realFetch = global.fetch;
  const calls = [];
  const byText = async (t) => (await q('SELECT * FROM social_comments WHERE text = $1', [t]))[0];
  const at = (iso) => new Date(iso);

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    const [g] = await q("INSERT INTO guests (name, profile, status, instagram) VALUES ('Carol Borba', 'empresario', 'gravado', 'carolborba1') RETURNING id");
    const [ep] = await q("INSERT INTO episodes (number, title, status, guest_id) VALUES (8, 'Disciplina', 'publicado', $1) RETURNING id", [g.id]);
    [pub] = await q(`INSERT INTO episode_publications (episode_id, platforms, title, status, results, options) VALUES ($1, '{instagram}', 'Não é motivação, é disciplina', 'publicado',
      '[{"platform":"instagram","provider":"outstand","ref":"op1","post_id":"1789","ok":true}]', '{"instagram":{"trial":true}}') RETURNING *`, [ep.id]);
    Object.assign(h.config.outstand, { key: 'ost', base: 'https://outstand.test', live: true }); h.config.outstandConfigured = true;
    Object.assign(h.config.gemini, { key: 'gem' }); h.config.geminiConfigured = true;
    require('../src/services/outstand').resetCache();
    const now = new Date().toISOString();
    const c = (id, text, username, uid, ts = now) => ({ id, author_username: username, text, created_at: ts, like_count: 0, replies: [], platform_specific: { from: { id: uid, username } } });
    const old = new Date(Date.now() - 9 * 86400_000).toISOString();
    const data = [
      c('a1', 'Treino todo dia às 5h, disciplina mudou minha vida', 'ana.fit', 'U1'), c('a2', '🔥🔥', 'bia', 'U2'),
      c('a3', 'Comecei semana passada e já sinto diferença', 'caio', 'U3'), c('a4', 'Eu acho que motivação ajuda também', 'ana.fit', 'U1'),
      c('a5', 'Isso vale para o trabalho também', 'duda', 'U5', old),
      // respondido à mão (antes do direct existir): a resposta do Pulso vem aninhada sem o @ e repetida no primeiro nível
      { ...c('a6', 'Faço isso há 3 anos e confirmo: a constância vence', 'eva.run', 'U6'), replies: [{ id: 'r6', author_username: null, text: 'Três anos! Qual foi o mais difícil?', created_at: now }] },
      c('r6', 'Três anos! Qual foi o mais difícil?', 'podcastpulso', 'IGP'),
    ];
    global.fetch = async (url, opts = {}) => {
      const s = String(url);
      if (s.startsWith('https://generativelanguage.googleapis.com/')) {
        const body = JSON.parse(opts.body);
        const text = body.contents[0].parts.map((p) => p.text || '').join('\n');
        const list = JSON.parse(text.slice(text.indexOf('Comentários (JSON):') + 'Comentários (JSON):'.length));
        const itens = list.map((k) => (/🔥/.test(k.texto)
          ? { id: k.id, acao: 'reagir', motivo: 'apoio', resposta: '🙌', confianca: 0.9, direct: 'não deveria ir' }
          : { id: k.id, acao: 'responder', motivo: 'relato', resposta: `Que bom, @${k.usuario}. O que mais te ajudou?`, confianca: 0.9, convite: 'E se ainda não acompanha o Pulso, toda semana tem conversa nova por aqui.', direct: `Oi! Vi o que você contou sobre "${k.texto.slice(0, 20)}". A conversa continua na nossa comunidade` }));
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ itens }) }] } }] });
      }
      if (!s.startsWith('https://outstand.test')) return realFetch(url, opts);
      const method = opts.method || 'GET'; const path = s.replace('https://outstand.test', '');
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ method, path, body });
      if (method === 'GET' && path.startsWith('/v1/social-accounts?')) return Response.json({ success: true, data: [{ id: 'IG1', network: 'instagram', username: 'podcastpulso', isActive: 1 }] });
      if (method === 'GET' && path.startsWith('/v1/posts/op1/replies')) return Response.json({ success: true, replies: { comments: [] }, data });
      if (method === 'POST' && path === '/v1/posts/op1/replies') return Response.json({ success: true, reply_id: `rep-${body.parent_comment_id}` });
      if (method === 'POST' && path === '/v1/conversations') return Response.json({ success: true, conversation: { id: 'cv' }, message: { id: 'm', status: 'sent' } }, { status: 201 });
      return Response.json({ error: 'sem rota' }, { status: 404 });
    };
    await R.setConfig({ on: '1' }, { onlyToggle: true });
  });
  after(async () => { global.fetch = realFetch; h.config.outstand.live = false; h.config.geminiConfigured = false; await app.close(); await h.db.close(); });

  it('a triagem põe o direct só em quem comentou com conteúdo, um por pessoa, e espaça o convite para seguir', async () => {
    await R.sweep(); await R.classifyPublication(pub.id);
    const a1 = await byText('Treino todo dia às 5h, disciplina mudou minha vida');
    assert.equal(a1.author_id, 'U1', 'o id de quem comentou vem da Outstand');
    assert.equal(a1.dm_status, 'proposta'); assert.match(a1.dm_text, /\{comunidade\}$/, 'sem o marcador, o link vai no fim');
    const a2 = await byText('🔥🔥'); assert.equal(a2.action, 'reagir'); assert.equal(a2.dm_text, null, 'reação não leva direct');
    const a4 = await byText('Eu acho que motivação ajuda também'); assert.equal(a4.dm_text, null, 'a mesma pessoa não recebe dois directs');
    const invited = (await q("SELECT author_username FROM social_comments WHERE invited")).map((r) => r.author_username);
    assert.equal(invited.length, 1, 'convite espaçado: um só neste lote'); assert.match((await q('SELECT reply_text FROM social_comments WHERE invited'))[0].reply_text, /O que mais te ajudou\? E se ainda não acompanha o Pulso/);
  });

  it('a tela mostra o direct e avisa que falta o link da comunidade; editar e tirar o direct', async () => {
    let page = (await as.prod.get('/social/comentarios?vista=aprovar')).text;
    assert.match(page, /DIRECT/); assert.match(page, /\[link da comunidade\]/); assert.match(page, /COM CONVITE PARA SEGUIR/);
    assert.match(page, /está esperando o link/);
    assert.match(page, /name="direct"/);
    const a3 = await byText('Comecei semana passada e já sinto diferença');
    await as.prod.act(`/social/comentarios/${a3.id}/resposta`, { texto: 'Que começo! Qual foi o primeiro passo?', direct: 'Que bom saber! Vem para a comunidade: {comunidade}' }, { from: '/social/comentarios' });
    const a3b = await byText('Comecei semana passada e já sinto diferença');
    assert.equal(a3b.status, 'aprovada'); assert.equal(a3b.dm_status, 'aprovada'); assert.equal(a3b.dm_text, 'Que bom saber! Vem para a comunidade: {comunidade}');
    const a5 = await byText('Isso vale para o trabalho também');
    await as.prod.act(`/social/comentarios/${a5.id}/sem-direct`, {}, { from: '/social/comentarios' });
    assert.equal((await byText('Isso vale para o trabalho também')).dm_status, 'pulada');
    page = (await as.gestao.get('/social/comentarios')).text;
    assert.match(page, /name="dm_per_day"/); assert.match(page, /DIRECTS NAS ÚLTIMAS 24 H 0 DE 150/);
  });

  it('o direct sai depois da resposta pública, no ritmo do dia, com o link e o id de quem comentou', async () => {
    await as.prod.act('/social/comentarios/aprovar-todas', {}, { from: '/social/comentarios' });
    await R.setConfig({ mode: 'aprovar', per_hour: '60', from: '0', to: '24', dm_on: '1', dm_per_day: '2', invite_on: '1' });
    const t0 = Date.parse('2026-11-20T15:00:00Z');
    assert.equal((await R.dmTick({ now: new Date(t0) })).reason, 'sem link da comunidade');
    await require('../src/services/commentAutomation').setLinks({ whatsapp_community: 'https://chat.whatsapp.com/pulso' });
    assert.equal((await R.dmTick({ now: new Date(t0) })).reason, 'fila vazia', 'antes da resposta pública, o direct espera');
    for (let i = 0; i < 6; i += 1) await R.sendTick({ now: new Date(t0 + i * 5 * 60_000) });
    let r = await R.dmTick({ now: new Date(t0 + 31 * 60_000) });
    assert.equal(r.sent, 1, JSON.stringify(r));
    const dm = calls.find((c) => c.method === 'POST' && c.path === '/v1/conversations');
    assert.equal(dm.body.social_account_id, 'IG1'); assert.ok(['U1', 'U3'].includes(dm.body.instagram.author_id));
    assert.match(dm.body.content, /chat\.whatsapp\.com\/pulso|https?:\/\/\S+/); assert.doesNotMatch(dm.body.content, /\{comunidade\}/);
    assert.equal((await R.dmTick({ now: new Date(t0 + 31 * 60_000 + 1000) })).reason, 'intervalo');
    // 2 por dia: o intervalo médio é de 12 h (entre 7 h e 17 h)
    r = await R.dmTick({ now: new Date(t0 + 18 * 3600_000) });
    assert.equal(r.sent, 1);
    await h.db.query("DELETE FROM app_settings WHERE key = 'respostas_ia_direct'");
    assert.equal((await R.dmTick({ now: new Date(t0 + 18 * 3600_000 + 60_000) })).reason, 'limite do dia');
    assert.equal((await q("SELECT count(*)::int AS n FROM social_comments WHERE dm_status = 'enviada'"))[0].n, 2);
  });

  it('comentário com mais de 7 dias não recebe direct; desligado, nada sai', async () => {
    const a5 = await byText('Isso vale para o trabalho também');
    await q("UPDATE social_comments SET dm_status = 'aprovada', dm_text = 'Oi {comunidade}', status = 'enviada', sent_at = now() WHERE id = $1", [a5.id]);
    await R.setConfig({ mode: 'aprovar', per_hour: '60', from: '0', to: '24', dm_on: '1', dm_per_day: '50', invite_on: '1' });
    await h.db.query("DELETE FROM app_settings WHERE key = 'respostas_ia_direct'");
    await R.dmTick({ now: new Date() });
    const after5 = await byText('Isso vale para o trabalho também');
    assert.equal(after5.dm_status, 'pulada'); assert.match(after5.dm_error, /7 dias/);
    await R.setConfig({ mode: 'aprovar', per_hour: '60', from: '0', to: '24', dm_per_day: '50', invite_on: '1' }); // dm_on desmarcado
    assert.equal((await R.dmTick({ now: new Date() })).reason, 'desligado');
    void at;
  });

  it('quem foi respondido à mão antes do direct existir também recebe: relê o id de quem comentou e manda no ritmo do dia', async () => {
    await q("UPDATE social_comments SET author_id = NULL WHERE comment_id = 'a6'");
    const before = await q("SELECT status, dm_status FROM social_comments WHERE comment_id = 'a6'");
    assert.deepEqual(before[0], { status: 'respondida', dm_status: null });
    await R.setConfig({ mode: 'automatico', per_hour: '60', from: '0', to: '24', dm_on: '1', dm_per_day: '50', invite_on: '1' });
    const r = await R.catchUpDms();
    assert.equal(r.proposed, 1, JSON.stringify(r));
    const [a6] = await q("SELECT * FROM social_comments WHERE comment_id = 'a6'");
    assert.equal(a6.author_id, 'U6', 'a releitura guarda o id de quem comentou');
    assert.equal(a6.dm_status, 'aprovada'); assert.match(a6.dm_text, /\{comunidade\}/);
    assert.equal((await R.catchUpDms()).proposed, 0, 'não escreve de novo');
    await h.db.query("DELETE FROM app_settings WHERE key = 'respostas_ia_direct'");
    calls.length = 0;
    assert.equal((await R.dmTick({ now: new Date() })).sent, 1);
    const dm = calls.find((x) => x.method === 'POST' && x.path === '/v1/conversations');
    assert.equal(dm.body.instagram.author_id, 'U6'); assert.equal(dm.body.instagram.comment_id, 'a6');
    assert.equal((await byText('Faço isso há 3 anos e confirmo: a constância vence')).dm_status, 'enviada');
  });
});
