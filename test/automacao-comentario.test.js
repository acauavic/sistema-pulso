const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('./helpers');
const A = require('../src/services/commentAutomation');
const bulk = require('../src/services/bulkPublish');

describe('Automação de comentário → direct ao publicar (Outstand)', () => {
  const as = {}; let app; let ep; let ep2; let clip; let clip2; let secret;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const realFetch = global.fetch;
  const calls = []; const state = { replyStatus: 201 };
  const sign = (raw) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  const deliver = async (payload, { signature } = {}) => {
    const raw = JSON.stringify(payload);
    return realFetch(`${app.base}/webhooks/outstand`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-outstand-signature': signature === undefined ? sign(raw) : signature }, body: raw });
  };
  const comment = (over = {}) => ({ event: 'comment.received', timestamp: new Date().toISOString(), data: { orgId: 'org', network: 'instagram', accountId: 'IG1', postId: 'op9', platformPostId: '17890', isLive: false, commentId: 'c1', parentCommentId: null, authorId: 'u1', authorUsername: 'fa.do.pulso', authorName: 'Fã', text: 'Tamiris!!', author: null, ...over } });
  const runInbox = async () => { for (const r of await q("SELECT ref_id FROM jobs WHERE kind = 'comentario_recebido' AND status = 'queued' ORDER BY id")) await A.handle({ ref_id: r.ref_id }); await q("UPDATE jobs SET status = 'done' WHERE kind = 'comentario_recebido'"); };

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    const [g] = await q("INSERT INTO guests (name, profile, status) VALUES ('Dra. Tamiris Mariano', 'medico', 'gravado') RETURNING id");
    const [g2] = await q("INSERT INTO guests (name, profile, status) VALUES ('Guto Galamba e Fillipe Holzer', 'empresario', 'gravado') RETURNING id");
    [ep] = await q("INSERT INTO episodes (number, title, status, guest_id, youtube_url) VALUES (3, 'Telas e infância', 'publicado', $1, 'https://youtu.be/ep3') RETURNING *", [g.id]);
    [ep2] = await q("INSERT INTO episodes (number, title, status, guest_id) VALUES (11, 'Negócios', 'gravado', $1) RETURNING *", [g2.id]);
    h.b2Store.set('pp/a1.mp4', { body: Buffer.alloc(100), contentType: 'video/mp4' });
    [clip] = await q("INSERT INTO episode_clips (title, post_title, caption, source, status, episode_id, storage_key, size_bytes, content_type, width, height, duration_ms) VALUES ('Corte 1', 'Telas roubam tempo', 'Legenda.', 'upload', 'pronto', $1, 'pp/a1.mp4', 100, 'video/mp4', 1080, 1920, 30000) RETURNING *", [ep.id]);
    [clip2] = await q("INSERT INTO episode_clips (title, post_title, caption, source, status, episode_id, storage_key, size_bytes, content_type, width, height, duration_ms) VALUES ('Corte 2', 'Negócio na saúde', 'Legenda 2.', 'upload', 'pronto', $1, 'pp/a1.mp4', 100, 'video/mp4', 1080, 1920, 30000) RETURNING *", [ep2.id]);
    Object.assign(h.config.outstand, { key: 'ost_teste', base: 'https://outstand.test', live: true }); h.config.outstandConfigured = true;
    require('../src/services/outstand').resetCache();
    global.fetch = async (url, opts = {}) => {
      const s = String(url);
      if (!s.startsWith('https://outstand.test')) return realFetch(url, opts);
      const method = opts.method || 'GET'; const path = s.replace('https://outstand.test', '');
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ method, path, body });
      if (method === 'GET' && path.startsWith('/v1/social-accounts?')) return Response.json({ success: true, data: [{ id: 'IG1', network: 'instagram', username: 'podcastpulso', nickname: 'Pulso', isActive: 1 }] });
      if (method === 'POST' && path === '/v1/conversations') return state.replyStatus === 201 ? Response.json({ success: true, conversation: { id: 'cv1' }, message: { id: 'm1', status: 'sent' } }, { status: 201 }) : Response.json({ success: false, error: 'Too late' }, { status: state.replyStatus });
      if (method === 'POST' && path === '/v1/posts/op9/replies') return Response.json({ success: true, reply_id: 'r1' });
      if (method === 'POST' && path === '/v1/social-networks/instagram/auth-url') return Response.json({ success: true, data: { auth_url: 'https://www.instagram.com/oauth/authorize?x=1' } });
      return Response.json({ error: 'sem rota' }, { status: 404 });
    };
  });
  after(async () => { global.fetch = realFetch; h.config.outstand.live = false; await app.close(); await h.db.close(); });

  it('palavra, chamada e mensagem', () => {
    assert.equal(A.keywordFor('Dra. Tamiris Mariano'), 'TAMIRIS'); assert.equal(A.keywordFor('Guto Galamba e Fillipe Holzer'), 'GUTO');
    assert.equal(A.keywordFor('José Bento'), 'JOSÉ'); assert.equal(A.keywordFor(''), 'EPISODIO');
    assert.equal(A.withKeyword('Siga o Pulso.', 'TAMIRIS'), 'Comente TAMIRIS e receba no direct o link do episódio completo.');
    assert.equal(A.withKeyword('Comente tamiris aqui que eu te mando.', 'TAMIRIS'), 'Comente tamiris aqui que eu te mando.', 'já pede a palavra: fica');
    const msg = A.render(A.DEFAULT_MESSAGE, { episode: { youtube_url: 'https://youtu.be/ep3' }, guest: { name: 'Dra. Tamiris Mariano' }, linkSet: { whatsapp_community: 'https://chat.whatsapp.com/abc' } });
    assert.match(msg, /conversa completa com Dra\. Tamiris Mariano/); assert.match(msg, /https:\/\/youtu\.be\/ep3/); assert.match(msg, /https:\/\/chat\.whatsapp\.com\/abc/);
    const noCommunity = A.render(A.DEFAULT_MESSAGE, { episode: { youtube_url: 'https://youtu.be/ep3' }, guest: { name: 'X' }, linkSet: {} });
    assert.doesNotMatch(noCommunity, /comunidade/, 'sem link da comunidade, a linha não vai');
    assert.match(A.render('Veja: {episodio}', { episode: {}, linkSet: { youtube_channel: 'https://youtube.com/@pulso' } }), /youtube\.com\/@pulso/, 'antes da estreia: o canal');
    assert.equal(A.readForm({ auto_palavra: 'x' }), null);
    assert.deepEqual(A.readForm({ auto_on: '1', auto_palavra: 'tamiris!', auto_dias: '7' }), { keyword: 'TAMIRIS', message: A.DEFAULT_MESSAGE, reply: null, days: 7 });
  });

  it('links da automação (Social > Automações) e o aviso de comentários em Integrações', async () => {
    let r = await as.gestao.act('/social/automacoes/links', { whatsapp_community: 'chat.whatsapp.com/abc' }, { from: '/social/automacoes' });
    assert.equal(r.status, 302); assert.equal((await A.links()).whatsapp_community, '', 'sem https: recusa');
    await as.gestao.act('/social/automacoes/links', { youtube_channel: 'https://youtube.com/@pulso', whatsapp_community: 'https://chat.whatsapp.com/abc' }, { from: '/social/automacoes' });
    assert.equal((await A.links()).whatsapp_community, 'https://chat.whatsapp.com/abc');
    const page = (await as.gestao.get('/social/automacoes')).text;
    assert.match(page, /Links que vão no direct/); assert.match(page, /chat\.whatsapp\.com\/abc/); assert.match(page, /A Outstand ainda não avisou nenhum comentário/);
    const integ = (await as.gestao.get('/integracoes')).text;
    assert.match(integ, /Comentários e directs/); assert.match(integ, /\/webhooks\/outstand/); assert.match(integ, /ainda não gerado/);
    assert.equal((await deliver(comment(), { signature: 'sha256=abc' })).status, 401, 'sem segredo cadastrado: recusa');
    await as.gestao.act('/integracoes/outstand/segredo', {}, { from: '/integracoes' });
    secret = (await A.state()).secret; assert.match(secret, /^whsec_[0-9a-f]{48}$/);
    assert.equal((await as.prod.act('/integracoes/outstand/segredo', {}, { from: '/' })).status, 403);
    // reconectar o Instagram com acesso às mensagens
    r = await as.gestao.act('/integracoes/outstand/mensagens', {}, { from: '/integracoes' });
    assert.equal(r.status, 303); assert.equal(r.location, 'https://www.instagram.com/oauth/authorize?x=1');
    const auth = calls.find((c) => c.path === '/v1/social-networks/instagram/auth-url');
    assert.match(auth.body.scopes, /instagram_business_manage_messages/); assert.match(auth.body.redirect_uri, /\/integracoes\/outstand\/voltou$/);
    await as.gestao.get('/integracoes/outstand/voltou?success=true&account_id=IG1&username=podcastpulso');
    assert.ok((await A.state()).reconnected_at);
  });

  it('publicar um corte com a automação: regra presa à publicação e a chamada do Instagram pedindo a palavra', async () => {
    const page = (await as.gestao.get(`/cortes/${clip.id}`)).text;
    assert.match(page, /Automação no Instagram/); assert.match(page, /name="auto_palavra" value="TAMIRIS"/);
    const r = await as.gestao.act(`/cortes/${clip.id}/publicar`, { title: 'Telas roubam tempo', description: 'Legenda.', platforms: ['instagram', 'tiktok'], cta_on: '1', cta_instagram: 'Siga o Pulso.', cta_tiktok: 'Segue o Pulso.', auto_on: '1', auto_palavra: '', auto_mensagem: A.DEFAULT_MESSAGE, auto_dias: '30', confirmar: '1' }, { from: `/cortes/${clip.id}` });
    assert.equal(r.status, 302, r.text);
    const [pub] = await q('SELECT * FROM episode_publications WHERE clip_id = $1 ORDER BY id DESC LIMIT 1', [clip.id]);
    assert.equal(pub.options.ctas.instagram, 'Comente TAMIRIS e receba no direct o link do episódio completo.'); assert.equal(pub.options.ctas.tiktok, 'Segue o Pulso.');
    const [rule] = await q('SELECT * FROM social_rules WHERE publication_id = $1', [pub.id]);
    assert.deepEqual(rule.keywords, ['TAMIRIS']); assert.equal(rule.scope, 'publicacao'); assert.equal(rule.provider, 'outstand'); assert.equal(rule.active, true);
    assert.ok(new Date(rule.expires_at) > new Date(Date.now() + 29 * 86400_000));
    // o post saiu pela Outstand
    await q("UPDATE episode_publications SET status = 'publicado', results = $2 WHERE id = $1", [pub.id, JSON.stringify([{ platform: 'instagram', ok: true, provider: 'outstand', ref: 'op9', post_id: '17890', url: 'https://www.instagram.com/reel/x/' }, { platform: 'tiktok', ok: true, provider: 'outstand', ref: 'op9' }])]);
    assert.match((await as.gestao.get(`/social/publicacoes/${pub.id}`)).text, /Quem comentar <span class="mono">TAMIRIS<\/span> recebe o link no direct/);
  });

  it('comentário com a palavra: um aviso por comentário e a resposta no direct com o link do episódio e da comunidade', async () => {
    assert.equal((await deliver(comment(), { signature: 'sha256=errada' })).status, 401);
    assert.equal((await deliver(comment())).status, 200);
    assert.equal((await deliver(comment())).status, 200, 'a Outstand repete o aviso');
    assert.equal((await q('SELECT count(*)::int n FROM social_inbox'))[0].n, 1);
    assert.equal((await q("SELECT count(*)::int n FROM jobs WHERE kind = 'comentario_recebido'"))[0].n, 1);
    await runInbox();
    const sent = calls.filter((c) => c.path === '/v1/conversations');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.social_account_id, 'IG1'); assert.deepEqual(sent[0].body.instagram, { comment_id: 'c1', author_id: 'u1' });
    assert.match(sent[0].body.content, /Dra\. Tamiris Mariano/); assert.match(sent[0].body.content, /https:\/\/youtu\.be\/ep3/); assert.match(sent[0].body.content, /https:\/\/chat\.whatsapp\.com\/abc/);
    const [evt] = await q("SELECT * FROM social_events WHERE external_id = 'c1'");
    assert.equal(evt.status, 'enviado'); assert.equal(evt.author, 'fa.do.pulso');
    assert.equal((await q('SELECT result FROM social_inbox WHERE comment_id = $1', ['c1']))[0].result, 'Respondido no direct.');
    assert.ok((await A.state()).messaging_ok_at, 'a primeira resposta confirma o acesso às mensagens');
  });

  it('fica de fora: sem a palavra, resposta a comentário, a própria conta e outro post; erro do Instagram vira frase clara', async () => {
    await deliver(comment({ commentId: 'c2', text: 'que conversa boa' }));
    await deliver(comment({ commentId: 'c3', parentCommentId: 'c1', text: 'tamiris' }));
    await deliver(comment({ commentId: 'c4', authorUsername: 'podcastpulso', authorId: 'me', text: 'TAMIRIS' }));
    await deliver(comment({ commentId: 'c5', postId: 'outro', platformPostId: '999', text: 'tamiris' }));
    await runInbox();
    assert.equal(calls.filter((c) => c.path === '/v1/conversations').length, 1, 'nenhum direct novo');
    const res = Object.fromEntries((await q("SELECT comment_id, result FROM social_inbox WHERE comment_id IN ('c2','c3','c4','c5')")).map((r) => [r.comment_id, r.result]));
    assert.equal(res.c2, 'A palavra não bateu.'); assert.match(res.c3, /Resposta a um comentário/); assert.match(res.c4, /própria conta/); assert.equal(res.c5, 'Nenhuma automação para este post.');
    assert.equal((await q("SELECT status FROM social_events WHERE external_id = 'c2'"))[0].status, 'ignorado');
    state.replyStatus = 422;
    await deliver(comment({ commentId: 'c6', text: 'tamiris' }));
    await runInbox();
    const [bad] = await q("SELECT * FROM social_events WHERE external_id = 'c6'");
    assert.equal(bad.status, 'erro'); assert.match(bad.error, /7 dias/);
    state.replyStatus = 201;
  });

  it('resposta pública opcional e automação em massa com a palavra de cada convidado', async () => {
    const [rule] = await q("SELECT id FROM social_rules WHERE scope = 'publicacao' LIMIT 1");
    await q("UPDATE social_rules SET action = 'ambos', reply_text = 'Te mandei no direct.' WHERE id = $1", [rule.id]);
    await deliver(comment({ commentId: 'c7', text: 'TAMIRIS por favor' }));
    await runInbox();
    const pub = calls.find((c) => c.path === '/v1/posts/op9/replies');
    assert.deepEqual(pub.body, { content: 'Te mandei no direct.', parent_comment_id: 'c7', platform_post_id: '17890' });
    // em massa: palavra em branco = primeiro nome do convidado de cada corte
    const at = new Date(Date.now() + 2 * 86400_000).toISOString();
    const { created } = await bulk.schedule([{ clipId: clip2.id, at, trial: false }], { platforms: ['instagram', 'tiktok'], userId: null, auto: A.readForm({ auto_on: '1', auto_palavra: '', auto_dias: '7' }) });
    assert.equal(created.length, 1); assert.equal(created[0].keyword, 'GUTO');
    assert.equal(created[0].pub.options.ctas.instagram, 'Comente GUTO e receba no direct o link do episódio completo.');
    const [r2] = await q('SELECT * FROM social_rules WHERE publication_id = $1', [created[0].pub.id]);
    assert.deepEqual(r2.keywords, ['GUTO']); assert.ok(new Date(r2.expires_at) > new Date(at), 'conta a partir de quando o post sai');
    const list = (await as.gestao.get('/social/automacoes')).text;
    assert.match(list, /Comentou GUTO/); assert.match(list, /Comentou TAMIRIS/);
    assert.match((await as.gestao.get(`/social/automacoes/${r2.id}`)).text, /Responde na hora/);
  });

  it('automação criada à mão no Instagram também vai pela Outstand e vale para qualquer post da conta', async () => {
    await as.gestao.act('/social/automacoes', { name: 'Link geral', trigger: 'comentario', platform: 'instagram', scope: 'recentes', keywords: 'pulso', action: 'dm', message: 'Aqui está o canal: {canal}' }, { from: '/social/automacoes' });
    const [rule] = await q("SELECT * FROM social_rules WHERE name = 'Link geral'");
    assert.equal(rule.provider, 'outstand'); assert.equal(rule.active, false, 'nasce pausada');
    await as.gestao.act(`/social/automacoes/${rule.id}/ativar`, { confirmar: '1' }, { from: `/social/automacoes/${rule.id}` });
    const before = calls.filter((c) => c.path === '/v1/conversations').length;
    await deliver(comment({ commentId: 'c9', postId: null, platformPostId: '5555', text: 'amo o pulso' }));
    await runInbox();
    const sent = calls.filter((c) => c.path === '/v1/conversations');
    assert.equal(sent.length, before + 1); assert.equal(sent.at(-1).body.content, 'Aqui está o canal: https://youtube.com/@pulso');
  });
});
