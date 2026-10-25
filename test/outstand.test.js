const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const ost = require('../src/services/outstand');
const socialApi = require('../src/services/socialApi');
const publishing = require('../src/services/publishing');
const social = require('../src/services/social');

describe('Outstand como terceira via para publicar nas redes', () => {
  const as = {}; const u = {}; let app; let ep; let cover; let clip;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const calls = [];
  const realFetch = global.fetch;
  const state = {
    accounts: [], health: {}, tiktokOptions: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], post: null, failWith: null, flaky: 0, notScheduled: false, drop: false,
  };
  const acc = (id, network, username, extra = {}) => ({ id, network, username, nickname: username, isActive: 1, ...extra });
  const ACCOUNTS = () => [acc('IG1', 'instagram', 'podcastpulso'), acc('YT1', 'youtube', 'pulsobr'), acc('TT1', 'tiktok', 'podcast.pulso'), acc('OFF', 'facebook', 'inativa', { isActive: 0 }), acc('IG2', 'instagram', 'outro')];

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['editor', 'editor_video'], ['prod', 'produtora']]) { u[k] = await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    [ep] = await q("INSERT INTO episodes (number, title, status) VALUES (31, 'Episódio Outstand', 'publicado') RETURNING *");
    [cover] = await q("INSERT INTO episode_covers (episode_id, kind, position, spec, storage_key, mime, width, height, size_bytes) VALUES ($1, 'post_quote', 0, '{}', 'pp/capas/o.jpg', 'image/jpeg', 1080, 1350, 1000) RETURNING *", [ep.id]);
    [clip] = await q("INSERT INTO episode_clips (title, source, status, episode_id, storage_key, width, height, duration_ms) VALUES ('Corte O', 'upload', 'pronto', $1, 'pp/c.mp4', 1080, 1920, 30000) RETURNING *", [ep.id]);
    state.accounts = ACCOUNTS();
    Object.assign(h.config.outstand, { key: 'ost_teste', base: 'https://outstand.test', live: false }); h.config.outstandConfigured = true;
    global.fetch = async (url, opts = {}) => {
      const s = String(url);
      if (!s.startsWith('https://outstand.test')) return realFetch(url, opts);
      const method = opts.method || 'GET'; const path = s.replace('https://outstand.test', '');
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ method, path, headers: opts.headers, body });
      if (opts.headers?.Authorization !== 'Bearer ost_teste') return Response.json({ success: false, error: 'Invalid or missing API key' }, { status: 401 });
      if (method === 'GET' && path.startsWith('/v1/social-accounts?')) { const off = Number(new URL(s).searchParams.get('offset') || 0); return Response.json({ success: true, data: state.accounts.slice(off, off + 100) }); }
      let m;
      if (method === 'GET' && (m = path.match(/^\/v1\/social-accounts\/([^/]+)\/health$/))) return Response.json({ success: true, data: { id: m[1], healthy: state.health[m[1]] !== false } });
      if (method === 'GET' && path.match(/^\/v1\/tiktok\/accounts\/[^/]+\/creator-info$/)) return Response.json({ success: true, data: { privacy_level_options: state.tiktokOptions, max_video_post_duration_sec: 600 } });
      if (method === 'POST' && path === '/v1/posts') {
        if (state.flaky > 0) { state.flaky -= 1; return Response.json({ error: 'Internal server error' }, { status: 500 }); }
        if (state.failWith) return Response.json({ success: false, error: state.failWith }, { status: 400 });
        const accounts = state.accounts.filter((a) => body.accounts.includes(a.id) && !(state.drop && a.network === 'youtube'));
        state.post = { id: 'op1', scheduled: !state.notScheduled, scheduledAt: null, socialAccounts: accounts.map((a) => ({ id: a.id, network: a.network, username: a.username, status: 'pending', error: null, platformPostId: null, platformPostUrl: null })) };
        return Response.json({ success: true, warnings: ['instagram rejects videos containing edit lists.'], post: state.post }, { status: state.notScheduled ? 202 : 200 });
      }
      if (method === 'PATCH' && path === '/v1/posts/op1') { state.post.scheduled = true; return Response.json({ success: true, rescheduled: true, post: state.post }); }
      if (method === 'GET' && path === '/v1/posts/op1') return state.post ? Response.json({ success: true, post: state.post }) : Response.json({ error: 'Post not found' }, { status: 404 });
      if (method === 'GET' && path === '/v1/posts/nope') return Response.json({ error: 'Post not found' }, { status: 404 });
      return Response.json({ error: 'sem rota' }, { status: 404 });
    };
  });
  after(async () => {
    global.fetch = realFetch;
    Object.assign(h.config.outstand, { key: undefined, live: false }); h.config.outstandConfigured = false;
    await app.close(); await h.db.close();
  });
  const sent = () => calls.filter((c) => c.method === 'POST' && c.path === '/v1/posts').at(-1);

  it('monta o corte vertical no formato da Outstand: Shorts, Reel com capa, collab e marcação com x e y, TikTok direto, Reel no Facebook', () => {
    const accounts = { youtube: { accountId: 'YT1' }, instagram: { accountId: 'IG1' }, tiktok: { accountId: 'TT1' }, facebook: { accountId: 'FB1' } };
    const b = ost.buildPost({ id: 7, kind: 'clip', platforms: ['youtube', 'instagram', 'tiktok', 'facebook'], title: 'Saúde e negócios', description: 'Legenda do corte #pulso', videoUrl: 'https://b2.test/v/corte.mp4?X-Amz-Signature=abc', coverUrl: 'https://b2.test/c.jpg', tags: ['saude'], accounts, instagram: { collaborators: ['lia.prado', 'marca'], tags: [{ username: 'ana.foto' }] } });
    assert.deepEqual(b.accounts, ['YT1', 'IG1', 'TT1', 'FB1']);
    assert.deepEqual(b.containers, [{ content: 'Legenda do corte #pulso', media: [{ url: 'https://b2.test/v/corte.mp4?X-Amz-Signature=abc', filename: 'corte.mp4' }] }]);
    assert.equal(b.youtube.title, 'Saúde e negócios'); assert.equal(b.youtube.isShort, true); assert.equal(b.youtube.privacyStatus, 'public'); assert.equal(b.youtube.content, 'Legenda do corte #pulso'); assert.equal(b.youtube.thumbnailUrl, undefined, 'Shorts não levam capa pela API');
    assert.equal(b.instagram.reelCoverUrl, 'https://b2.test/c.jpg'); assert.deepEqual(b.instagram.collaborators, ['lia.prado', 'marca']); assert.deepEqual(b.instagram.userTags, [{ username: 'ana.foto', x: 0.5, y: 0.5 }], 'a Outstand exige x e y');
    assert.equal(b.tiktok.postMode, 'DIRECT_POST'); assert.equal(b.facebook.publishAsReel, true);
    assert.ok(b.idempotency.startsWith('pulso-7-')); assert.deepEqual(b._missing, []);
    assert.equal(b.processMedia, undefined, 'sem ajustar o vídeo, nada é refeito (nem cobrado)');
    assert.equal(ost.buildPost({ id: 1, kind: 'clip', platforms: ['instagram'], title: 't', description: 'd', videoUrl: 'https://b2.test/v.mp4', accounts, processMedia: true }).processMedia, true);
    assert.equal(ost.buildPost({ id: 1, kind: 'clip', platforms: ['tiktok'], title: 't', description: 'd', videoUrl: 'https://b2.test/v.mp4', accounts, tiktokMode: 'rascunho' }).tiktok.postMode, 'MEDIA_UPLOAD');
    const epb = ost.buildPost({ id: 8, kind: 'episode', platforms: ['youtube'], title: 'EP', description: 'Descrição', videoUrl: 'https://b2.test/e.mp4', thumbnailUrl: 'https://b2.test/t.jpg', accounts });
    assert.equal(epb.youtube.thumbnailUrl, 'https://b2.test/t.jpg'); assert.equal(epb.youtube.isShort, undefined);
    assert.deepEqual(ost.buildPost({ id: 9, kind: 'clip', platforms: ['youtube', 'x'], title: 'a', description: 'b', videoUrl: 'https://b2.test/v.mp4', accounts })._missing, ['x']);
  });

  it('monta imagens: post, carrossel (um contêiner com várias imagens) e story (sem legenda)', () => {
    const accounts = { instagram: { accountId: 'IG1' }, tiktok: { accountId: 'TT1' } };
    const post = ost.buildPhotoPost({ id: 1, media: 'imagem', platforms: ['instagram', 'tiktok'], title: 'Frase', description: 'Legenda da frase', photoUrls: ['https://b2.test/a.jpg'], accounts, instagram: { collaborators: ['x'], tags: [{ username: 'y', x: 0.2, y: 0.3 }, { username: 'z' }] } });
    assert.deepEqual(post.containers[0].media.map((m) => m.filename), ['a.jpg']); assert.equal(post.containers[0].content, 'Legenda da frase');
    assert.deepEqual(post.instagram.userTags, [{ username: 'y', x: 0.2, y: 0.3 }, { username: 'z', x: 0.5, y: 0.85 }]);
    assert.deepEqual(post.tiktok, { postMode: 'DIRECT_POST', title: 'Frase', description: 'Legenda da frase', disableComment: false });
    const car = ost.buildPhotoPost({ id: 2, media: 'carrossel', platforms: ['instagram'], title: 'C', description: 'D', photoUrls: ['https://b2.test/1.jpg', 'https://b2.test/2.jpg', 'https://b2.test/3.jpg'], accounts });
    assert.equal(car.containers.length, 1); assert.equal(car.containers[0].media.length, 3); assert.equal(car.instagram, undefined);
    const st = ost.buildPhotoPost({ id: 3, media: 'story', platforms: ['instagram'], title: 'Story', description: 'não vai', photoUrls: ['https://b2.test/s.jpg'], accounts, instagram: { collaborators: ['x'], tags: [] } });
    assert.equal(st.containers[0].content, undefined, 'story não tem legenda'); assert.deepEqual(st.instagram, { publishAsStory: true }, 'story não leva collab');
  });

  it('contas conectadas: uma por rede (a primeira ativa), todas as páginas; "Testar" confere o token de cada conta', async () => {
    state.accounts = [...ACCOUNTS(), ...Array.from({ length: 120 }, (_, i) => acc(`X${i}`, 'x', `u${i}`))];
    calls.length = 0;
    const c = await ost.connected({ force: true });
    assert.equal(c.ok, true);
    assert.deepEqual(Object.keys(c.platforms).sort(), ['instagram', 'tiktok', 'x', 'youtube'], 'facebook inativo fica de fora');
    assert.equal(c.platforms.instagram.accountId, 'IG1'); assert.equal(c.platforms.instagram.handle, 'podcastpulso');
    assert.ok(calls.filter((x) => x.path.startsWith('/v1/social-accounts?')).length >= 2, 'leu mais de uma página');
    state.accounts = ACCOUNTS(); state.health.TT1 = false;
    const t = await ost.connected({ force: true });
    assert.equal(t.platforms.tiktok.reauth, true, 'token vencido: reconectar'); assert.equal(t.platforms.youtube.reauth, false);
    state.health = {};
    state.accounts = []; ost.resetCache();
    h.config.outstand.key = 'errada';
    const bad = await ost.connected({ force: true });
    assert.equal(bad.ok, false); assert.match(bad.error, /Outstand recusou \(401\): Invalid or missing API key/);
    h.config.outstand.key = 'ost_teste'; state.accounts = ACCOUNTS();
  });

  it('em Integrações: a Outstand aparece, só escolhe com chave; guarda as opções do TikTok e do vídeo; Upload-Post segue o padrão', async () => {
    assert.equal(await socialApi.activeId(), 'uploadpost');
    const page = (await as.gestao.get('/integracoes')).text;
    assert.match(page, /value="outstand"/); assert.match(page, /padrão do servidor \(OUTSTAND_LIVE\)/); assert.match(page, /Opções da Outstand/); assert.match(page, /Publicar direto/);
    h.config.outstandConfigured = false;
    await as.gestao.act('/integracoes/redes', { provedor: 'outstand' }, { from: '/integracoes' });
    assert.equal(await socialApi.activeId(), 'uploadpost', 'sem chave não troca');
    h.config.outstandConfigured = true;
    await as.gestao.act('/integracoes/redes', { provedor: 'outstand' }, { from: '/integracoes' });
    assert.equal(await socialApi.activeId(), 'outstand');
    assert.equal((await as.editor.act('/integracoes/redes/outstand', { modo: 'rascunho' }, { from: '/' })).status, 403, 'só quem cuida das integrações');
    assert.equal(await ost.tiktokMode(), 'direto');
    await as.gestao.act('/integracoes/redes/outstand', { modo: 'rascunho', ajustar: '1' }, { from: '/integracoes' });
    assert.equal(await ost.tiktokMode(), 'rascunho'); assert.equal(await ost.processMedia(), true);
    assert.ok((await q("SELECT 1 FROM audit_log WHERE action = 'integracao.redes_outstand_opcoes'")).length);
    const test = await as.gestao.act('/integracoes/redes/testar', { provedor: 'outstand' }, { from: '/integracoes' });
    assert.equal(test.status, 302);
    await as.gestao.act('/integracoes/redes/outstand', { modo: 'direto' }, { from: '/integracoes' });
    assert.equal(await ost.tiktokMode(), 'direto'); assert.equal(await ost.processMedia(), false, 'desmarcado: não ajusta');
  });

  it('modo de teste: o post é montado e conferido, sai "simulado" e nada vai à Outstand', async () => {
    calls.length = 0;
    const pub = await publishing.create({ media: 'imagem', coverIds: [cover.id], platforms: ['instagram'], title: 'Post', description: 'Legenda', userId: u.gestao.id });
    assert.equal(pub.status, 'simulado'); assert.equal(pub.provider, 'outstand');
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0, 'nenhum envio');
    assert.match(socialApi.sentMessage(pub), /NADA foi enviado pela Outstand\. A publicação de verdade é ligada em Integrações/);
  });

  it('de verdade: imagem sai com a conta do Instagram, collab e marcação; acompanha até publicar e guarda o link', async () => {
    h.config.outstand.live = true; ost.resetCache();
    try {
      calls.length = 0;
      const pub = await publishing.create({ media: 'imagem', coverIds: [cover.id], platforms: ['instagram'], title: 'Post 2', description: 'Legenda 2', userId: u.gestao.id, instagram: { collaborators: ['lia.prado'], tags: [{ username: 'ana', x: 0.1, y: 0.9 }] } });
      assert.equal(pub.status, 'enviando'); assert.equal(pub.provider, 'outstand'); assert.equal(pub.request_id, 'op1');
      const req = sent();
      assert.equal(req.headers.Authorization, 'Bearer ost_teste'); assert.ok(req.headers['Idempotency-Key'].startsWith(`pulso-${pub.id}-`));
      assert.deepEqual(req.body.accounts, ['IG1']); assert.match(req.body.containers[0].media[0].url, /X-Amz-Signature/); assert.equal(req.body.scheduledAt, undefined, 'envio imediato: o agendamento é nosso');
      assert.deepEqual(req.body.instagram.collaborators, ['lia.prado']); assert.deepEqual(req.body.instagram.userTags, [{ username: 'ana', x: 0.1, y: 0.9 }]);
      assert.deepEqual(pub.options.provider_warnings, ['instagram rejects videos containing edit lists.']);
      assert.equal((await publishing.refresh(pub.id)).status, 'enviando', 'ainda publicando');
      state.post.socialAccounts[0] = { ...state.post.socialAccounts[0], status: 'published', platformPostId: 'ig-1', platformPostUrl: 'https://www.instagram.com/p/abc/' };
      const done = await publishing.refresh(pub.id);
      assert.equal(done.status, 'publicado'); assert.equal(done.results[0].url, 'https://www.instagram.com/p/abc/'); assert.equal(done.results[0].platform, 'instagram');
      const page = (await as.gestao.get(`/social/publicacoes/${pub.id}`)).text;
      assert.match(page, /Aviso da Outstand: instagram rejects videos/);
    } finally { h.config.outstand.live = false; }
  });

  it('corte nas redes: YouTube Shorts + TikTok (privacidade vem das opções da conta) + Instagram; parcial quando uma falha', async () => {
    h.config.outstand.live = true; ost.resetCache(); state.accounts = ACCOUNTS();
    try {
      calls.length = 0;
      const pub = await publishing.create({ clipId: clip.id, platforms: ['youtube', 'tiktok', 'instagram'], title: 'Corte da conversa', description: 'Legenda #pulso', userId: u.gestao.id });
      assert.equal(pub.status, 'enviando');
      assert.ok(calls.some((c) => c.path === '/v1/tiktok/accounts/TT1/creator-info'), 'leu as opções do TikTok antes');
      const body = sent().body;
      assert.equal(body.tiktok.postMode, 'DIRECT_POST'); assert.equal(body.tiktok.privacyLevel, 'PUBLIC_TO_EVERYONE'); assert.equal(body.youtube.isShort, true);
      assert.deepEqual(body.accounts.sort(), ['IG1', 'TT1', 'YT1']);
      state.post.socialAccounts = state.post.socialAccounts.map((a) => (a.network === 'youtube' ? { ...a, status: 'published', platformPostId: 'yt123' } : a.network === 'tiktok' ? { ...a, status: 'failed', error: 'TikTok API error (reached_active_user_cap)' } : { ...a, status: 'published', platformPostId: 'ig9', platformPostUrl: 'https://www.instagram.com/reel/r/' }));
      const done = await publishing.refresh(pub.id);
      assert.equal(done.status, 'parcial');
      assert.equal(done.results.find((r) => r.platform === 'youtube').url, 'https://www.youtube.com/watch?v=yt123');
      assert.match(done.results.find((r) => r.platform === 'tiktok').error, /reached_active_user_cap/);
      assert.equal((await q('SELECT youtube_url FROM episodes WHERE id = $1', [ep.id]))[0].youtube_url, null, 'link de corte não vira o link do episódio');
    } finally { h.config.outstand.live = false; }
  });

  it('TikTok: só aceita privado => recusa com o motivo; rascunho vai como MEDIA_UPLOAD e o resultado avisa que falta publicar no app', async () => {
    h.config.outstand.live = true; ost.resetCache(); state.accounts = ACCOUNTS();
    try {
      state.tiktokOptions = ['SELF_ONLY'];
      const bad = await publishing.create({ clipId: clip.id, platforms: ['tiktok'], title: 'T', description: 'D', userId: u.gestao.id });
      assert.equal(bad.status, 'erro'); assert.match(bad.error, /só aceita publicar como SELF_ONLY pela Outstand.*rascunho/);
      await ost.setTiktokMode('rascunho'); calls.length = 0;
      const pub = await publishing.create({ clipId: clip.id, platforms: ['tiktok'], title: 'T2', description: 'D2', userId: u.gestao.id });
      assert.equal(sent().body.tiktok.postMode, 'MEDIA_UPLOAD'); assert.equal(sent().body.tiktok.privacyLevel, undefined);
      assert.ok(!calls.some((c) => c.path.includes('creator-info')), 'rascunho não consulta privacidade');
      assert.equal(pub.job_id, 'tiktok-rascunho');
      state.post.socialAccounts[0] = { ...state.post.socialAccounts[0], status: 'published', platformPostId: 'publish_123' };
      const done = await publishing.refresh(pub.id);
      assert.equal(done.status, 'publicado'); assert.equal(done.results[0].draft, true); assert.match(done.results[0].note, /abra o app do TikTok/);
      assert.match((await as.gestao.get(`/social/publicacoes/${pub.id}`)).text, /Rascunho[\s\S]*abra o app do TikTok/);
    } finally { h.config.outstand.live = false; state.tiktokOptions = ['PUBLIC_TO_EVERYONE', 'SELF_ONLY']; await ost.setTiktokMode('direto'); }
  });

  it('falhas: erro de validação vira mensagem legível, rede instável repete com a mesma chave, post sem fila é reenfileirado, conta não reconhecida é recusada', async () => {
    h.config.outstand.live = true; ost.resetCache(); state.accounts = ACCOUNTS();
    try {
      state.failWith = [{ code: 'custom', message: 'tiktok.privacyLevel is required', path: ['tiktok', 'privacyLevel'] }];
      const bad = await publishing.create({ media: 'imagem', coverIds: [cover.id], platforms: ['instagram'], title: 'P', description: 'L', userId: u.gestao.id });
      assert.equal(bad.status, 'erro'); assert.match(bad.error, /Outstand recusou \(400\): tiktok\.privacyLevel: tiktok\.privacyLevel is required/);
      state.failWith = null; state.flaky = 2; calls.length = 0;
      const ok = await publishing.create({ media: 'imagem', coverIds: [cover.id], platforms: ['instagram'], title: 'P2', description: 'L2', userId: u.gestao.id });
      assert.equal(ok.status, 'enviando');
      const posts = calls.filter((c) => c.method === 'POST' && c.path === '/v1/posts');
      assert.equal(posts.length, 3, 'duas falhas 500 e a terceira passou');
      assert.equal(new Set(posts.map((c) => c.headers['Idempotency-Key'])).size, 1, 'a mesma chave nas três: nunca duplica');
      state.notScheduled = true; calls.length = 0;
      const requeued = await publishing.create({ media: 'imagem', coverIds: [cover.id], platforms: ['instagram'], title: 'P3', description: 'L3', userId: u.gestao.id });
      assert.equal(requeued.status, 'enviando'); assert.ok(calls.some((c) => c.method === 'PATCH' && c.body.scheduledAt), 'reagendou para entrar na fila');
      state.notScheduled = false;
      state.accounts = ACCOUNTS(); state.drop = true;
      const dropped = await publishing.create({ clipId: clip.id, platforms: ['youtube', 'instagram'], title: 'D', description: 'D', userId: u.gestao.id });
      assert.equal(dropped.status, 'erro'); assert.match(dropped.error, /não reconheceu uma das contas conectadas/);
      state.drop = false;
      await assert.rejects(publishing.create({ media: 'imagem', coverIds: [cover.id], platforms: ['threads'], title: 'P', description: 'L', userId: u.gestao.id }), /Sem conta conectada na Outstand: Threads/);
      assert.equal((await ost.status({ request_id: 'nope' })).state, 'erro');
    } finally { h.config.outstand.live = false; state.drop = false; state.notScheduled = false; state.failWith = null; state.flaky = 0; }
  });

  it('editar: agendado edita aqui (o envio é nosso); depois de publicado a Outstand não edita e o painel explica', async () => {
    const [sched] = await q("INSERT INTO episode_publications (episode_id, platforms, title, description, status, media, provider, scheduled_at, cover_ids) VALUES ($1, '{instagram}', 'Agendado', 'texto', 'agendado', 'imagem', 'outstand', now() + interval '2 day', $2) RETURNING *", [ep.id, [cover.id]]);
    const r = await social.editPublication(sched, { title: 'Agendado novo', description: 'texto novo' }, u.gestao);
    assert.equal(r.ok, true); assert.equal((await q('SELECT title FROM episode_publications WHERE id = $1', [sched.id]))[0].title, 'Agendado novo');
    const [done] = await q("INSERT INTO episode_publications (episode_id, platforms, title, status, media, provider, cover_ids) VALUES ($1, '{instagram}', 'Publicado', 'publicado', 'imagem', 'outstand', $2) RETURNING *", [ep.id, [cover.id]]);
    const e = await social.editPublication(done, { title: 'Novo', description: 'x' }, u.gestao);
    assert.match(e.error, /saiu pela Outstand, que não edita post depois de publicado\. Edite pelo app da rede/);
    const page = (await as.gestao.get(`/social/publicacoes/${done.id}`)).text;
    assert.doesNotMatch(page, /Editar texto/, 'sem botão que só daria erro'); assert.match(page, /Saiu pela Outstand, que só edita post que ainda não foi publicado/);
    assert.match((await as.gestao.get(`/social/publicacoes/${sched.id}`)).text, /Editar texto/, 'agendado edita');
  });

  it('o assistente e as telas citam a Outstand; o provedor escolhido some do padrão ao tirar a chave', async () => {
    const list = socialApi.list().map((p) => p.id);
    assert.deepEqual(list, ['uploadpost', 'zernio', 'outstand']);
    h.config.outstandConfigured = false;
    assert.notEqual(await socialApi.activeId(), 'outstand', 'sem chave, volta ao primeiro configurado');
    h.config.outstandConfigured = true;
  });
});
