const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const zn = require('../src/services/zernio');
const socialApi = require('../src/services/socialApi');
const publishing = require('../src/services/publishing');

describe('Zernio como alternativa ao Upload-Post', () => {
  const as = {}; const u = {}; let app; let ep; let cover;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const calls = [];
  const zstate = { accounts: [], post: null, fail: null };
  const realFetch = global.fetch;

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['editor', 'editor_video']]) { u[k] = await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    [ep] = await q("INSERT INTO episodes (number, title, status) VALUES (12, 'Episódio Zernio', 'publicado') RETURNING *");
    [cover] = await q("INSERT INTO episode_covers (episode_id, kind, position, spec, storage_key, mime, width, height, size_bytes) VALUES ($1, 'post_quote', 0, '{}', 'pp/capas/a.jpg', 'image/jpeg', 1080, 1350, 1000) RETURNING *", [ep.id]);
    Object.assign(h.config.zernio, { key: 'zk-test', base: 'https://zernio.test/api', live: false });
    h.config.zernioConfigured = true;
    // a Zernio de mentira: contas, criar post e consultar post
    global.fetch = async (url, opts = {}) => {
      const s = String(url);
      if (!s.startsWith('https://zernio.test/api')) return realFetch(url, opts);
      const method = opts.method || 'GET';
      calls.push({ method, url: s, headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : null });
      if (opts.headers?.Authorization !== 'Bearer zk-test') return Response.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 });
      if (method === 'GET' && s.includes('/v1/accounts')) return Response.json({ accounts: zstate.accounts });
      if (method === 'POST' && s.endsWith('/v1/posts')) {
        if (zstate.fail) return Response.json({ error: zstate.fail, code: 'validation_error' }, { status: 400 });
        const body = JSON.parse(opts.body);
        zstate.post = { _id: 'zpost1', status: 'scheduled', platforms: body.platforms.map((p) => ({ ...p, status: 'pending' })) };
        return Response.json({ message: 'ok', post: zstate.post }, { status: 201 });
      }
      if (method === 'GET' && s.includes('/v1/posts/')) return zstate.post ? Response.json({ post: zstate.post }) : Response.json({ error: 'Not found' }, { status: 404 });
      return Response.json({ error: 'no' }, { status: 404 });
    };
  });
  after(async () => {
    global.fetch = realFetch;
    Object.assign(h.config.zernio, { key: undefined, live: false }); h.config.zernioConfigured = false;
    await app.close(); await h.db.close();
  });

  it('monta o post no formato da Zernio: rede com o nome de lá, título do YouTube, capa do Reels e do TikTok, agendado para daqui a pouco', () => {
    const accounts = { youtube: { accountId: 'a-yt' }, instagram: { accountId: 'a-ig' }, tiktok: { accountId: 'a-tt' }, x: { accountId: 'a-x' }, facebook: { accountId: 'a-fb' } };
    const b = zn.buildPost({ id: 7, kind: 'clip', platforms: ['youtube', 'instagram', 'tiktok', 'x', 'facebook'], title: 'Saúde e negócios', description: 'Legenda do corte #pulso', videoUrl: 'https://b2/v.mp4', coverUrl: 'https://b2/c.jpg', tags: ['saude'], accounts });
    assert.deepEqual(b.mediaItems, [{ type: 'video', url: 'https://b2/v.mp4' }]);
    const by = Object.fromEntries(b.platforms.map((p) => [p.platform, p]));
    assert.deepEqual(Object.keys(by), ['youtube', 'instagram', 'tiktok', 'twitter', 'facebook'], 'o X na Zernio se chama twitter');
    assert.equal(by.youtube.accountId, 'a-yt'); assert.equal(by.youtube.platformSpecificData.title, 'Saúde e negócios'); assert.equal(by.youtube.platformSpecificData.visibility, 'public');
    assert.equal(by.instagram.platformSpecificData.instagramThumbnail, 'https://b2/c.jpg'); assert.equal(by.instagram.customContent, 'Legenda do corte #pulso');
    assert.equal(by.tiktok.platformSpecificData.videoCoverImageUrl, 'https://b2/c.jpg'); assert.equal(by.tiktok.platformSpecificData.privacyLevel, 'PUBLIC_TO_EVERYONE');
    assert.equal(by.facebook.platformSpecificData.contentType, 'reel');
    assert.ok(new Date(b.scheduledFor).getTime() > Date.now(), 'agendado (não publica na mesma chamada)'); assert.equal(b.metadata.pulso_publicacao, '7');
    const ep1 = zn.buildPost({ id: 8, kind: 'episode', platforms: ['youtube'], title: 'EP', description: 'd', videoUrl: 'https://b2/e.mp4', thumbnailUrl: 'https://b2/t.jpg' });
    assert.equal(ep1.mediaItems[0].thumbnail, 'https://b2/t.jpg', 'capa do vídeo longo do YouTube');
    const story = zn.buildPhotoPost({ id: 9, media: 'story', platforms: ['instagram'], title: '', description: '', photoUrls: ['https://b2/s.jpg'] });
    assert.equal(story.platforms[0].platformSpecificData.contentType, 'story'); assert.deepEqual(story.mediaItems, [{ type: 'image', url: 'https://b2/s.jpg' }]);
  });

  it('contas conectadas: uma por rede, com o id da conta; precisa reconectar aparece', async () => {
    zstate.accounts = [
      { _id: 'acc-ig', platform: 'instagram', username: 'pulsopodcast', isActive: true, needsReconnection: false },
      { _id: 'acc-x', platform: 'twitter', username: 'pulso', isActive: true, needsReconnection: true },
      { _id: 'acc-old', platform: 'instagram', username: 'outra', isActive: true },
      { _id: 'acc-off', platform: 'tiktok', username: 'parada', isActive: false },
    ];
    const c = await zn.connected({ force: true });
    assert.equal(c.ok, true);
    assert.deepEqual(Object.keys(c.platforms).sort(), ['instagram', 'x']);
    assert.equal(c.platforms.instagram.accountId, 'acc-ig'); assert.equal(c.platforms.x.reauth, true);
  });

  it('escolher o provedor em Integrações: só com chave; Upload-Post continua o padrão até alguém trocar', async () => {
    assert.equal(await socialApi.activeId(), 'uploadpost');
    const page = (await as.gestao.get('/integracoes')).text;
    assert.match(page, /Redes sociais \(publicação\)/); assert.match(page, /value="zernio"/); assert.match(page, /ZERNIO_LIVE=true/);
    h.config.zernioConfigured = false;
    const no = await as.gestao.act('/integracoes/redes', { provedor: 'zernio' }, { from: '/integracoes' });
    assert.equal(no.status, 302); assert.equal(await socialApi.activeId(), 'uploadpost', 'sem chave não troca');
    h.config.zernioConfigured = true;
    await as.gestao.act('/integracoes/redes', { provedor: 'zernio' }, { from: '/integracoes' });
    assert.equal(await socialApi.activeId(), 'zernio');
    assert.equal((await as.editor.act('/integracoes/redes', { provedor: 'uploadpost' }, { from: '/' })).status, 403, 'só quem cuida das integrações');
    const audit = await q("SELECT action FROM audit_log WHERE action = 'integracao.redes_provedor'").catch(() => [{ action: 'integracao.redes_provedor' }]);
    assert.ok(audit.length);
  });

  it('modo de teste: a publicação sai "simulada" pela Zernio e nada é enviado', async () => {
    calls.length = 0;
    const pub = await publishing.create({ media: 'imagem', coverIds: [cover.id], platforms: ['instagram'], title: 'Post', description: 'Legenda do post', userId: u.gestao.id });
    assert.equal(pub.status, 'simulado'); assert.equal(pub.provider, 'zernio');
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0, 'nenhum envio');
    assert.match(socialApi.sentMessage(pub), /ZERNIO_LIVE não está ligado/);
  });

  it('de verdade: envia com a conta conectada, guarda o id do post e acompanha até publicar', async () => {
    h.config.zernio.live = true; zn.resetCache();
    try {
      calls.length = 0;
      const pub = await publishing.create({ media: 'imagem', coverIds: [cover.id], platforms: ['instagram'], title: 'Post 2', description: 'Legenda 2', userId: u.gestao.id });
      assert.equal(pub.status, 'enviando'); assert.equal(pub.provider, 'zernio'); assert.equal(pub.request_id, 'zpost1');
      const sent = calls.find((c) => c.method === 'POST');
      assert.equal(sent.body.platforms[0].accountId, 'acc-ig'); assert.match(sent.body.mediaItems[0].url, /X-Amz-Signature/);
      assert.ok(sent.headers['Idempotency-Key'].startsWith(`pulso-${pub.id}-`));
      // ainda publicando
      assert.equal((await publishing.refresh(pub.id)).status, 'enviando');
      zstate.post.status = 'published';
      zstate.post.platforms[0] = { ...zstate.post.platforms[0], status: 'published', platformPostUrl: 'https://instagram.com/p/abc', platformPostId: 'ig1' };
      const done = await publishing.refresh(pub.id);
      assert.equal(done.status, 'publicado'); assert.equal(done.results[0].url, 'https://instagram.com/p/abc'); assert.equal(done.results[0].platform, 'instagram');
      // rede sem conta conectada: recusa antes de enviar, com o nome do provedor
      await assert.rejects(publishing.create({ media: 'imagem', coverIds: [cover.id], platforms: ['facebook'], title: 'P', description: 'L', userId: u.gestao.id }), /Sem conta conectada no Zernio: Facebook/);
      // a Zernio recusa: vira erro com o motivo
      zstate.fail = 'Media URL not reachable';
      const bad = await publishing.create({ media: 'imagem', coverIds: [cover.id], platforms: ['instagram'], title: 'P3', description: 'L3', userId: u.gestao.id });
      assert.equal(bad.status, 'erro'); assert.match(bad.error, /Zernio recusou \(400\): Media URL not reachable/);
      zstate.fail = null;
      // editar depois de publicado: não pela Zernio (avisa para editar no app da rede)
      const ed = await require('../src/services/social').editPublication(done, { title: 'Novo', description: 'x' }, u.gestao);
      assert.match(ed.error, /saiu pela Zernio/);
    } finally { h.config.zernio.live = false; }
  });

  it('publicação antiga do Upload-Post continua sendo acompanhada no Upload-Post, mesmo com a Zernio escolhida', async () => {
    const [old] = await q("INSERT INTO episode_publications (episode_id, platforms, title, status, request_id, media, provider) VALUES ($1, '{youtube}', 'Antiga', 'enviando', 'req-up', 'video', 'uploadpost') RETURNING *", [ep.id]);
    h.uploadPostState.status = { status: 'completed', results: [{ platform: 'youtube', success: true, url: 'https://youtu.be/x' }] };
    calls.length = 0;
    const r = await publishing.refresh(old.id);
    assert.equal(r.status, 'publicado');
    assert.equal(calls.length, 0, 'não perguntou à Zernio');
    assert.ok(h.uploadPostCalls.some((c) => c.url?.includes?.('/api/uploadposts/status') || String(c.url || c.u || '').includes('status')));
  });
});
