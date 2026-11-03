const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const socialApi = require('../src/services/socialApi');
const publishing = require('../src/services/publishing');
const health = require('../src/services/socialHealth');
const ost = require('../src/services/outstand');

describe('Uma rede por provedor (X pela Zernio, o resto pela Outstand) e vigia das contas desconectadas', () => {
  const as = {}; const u = {}; let app; let ep; let cover; let clip;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const calls = [];
  const realFetch = global.fetch;
  const st = {
    oAccounts: [], zAccounts: [], oHealth: {}, oDown: false, zDown: false, zFail: null,
    oPost: null, zPost: null,
  };
  const oAcc = (id, network, username) => ({ id, network, username, nickname: username, isActive: 1 });
  const zAcc = (id, platform, username, extra = {}) => ({ _id: id, platform, username, isActive: true, needsReconnection: false, ...extra });
  const notes = (type = 'integracao') => q('SELECT n.title, n.body, n.url, u.name FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.type = $1 ORDER BY n.id', [type]);
  const gone = () => q("DELETE FROM notifications WHERE type = 'integracao'");

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['admin', 'superadmin'], ['prod', 'produtora'], ['editor', 'editor_video']]) { u[k] = await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    [ep] = await q("INSERT INTO episodes (number, title, status) VALUES (41, 'Episódio rotas', 'publicado') RETURNING *");
    [cover] = await q("INSERT INTO episode_covers (episode_id, kind, position, spec, storage_key, mime, width, height, size_bytes) VALUES ($1, 'post_quote', 0, '{}', 'pp/capas/r.jpg', 'image/jpeg', 1080, 1350, 1000) RETURNING *", [ep.id]);
    [clip] = await q("INSERT INTO episode_clips (title, source, status, episode_id, storage_key, width, height, duration_ms) VALUES ('Corte R', 'upload', 'pronto', $1, 'pp/r.mp4', 1080, 1920, 30000) RETURNING *", [ep.id]);
    h.b2Store.set('pp/r.mp4', { body: Buffer.from('video-corte'), contentType: 'video/mp4' }); // o envio confere o arquivo no armazenamento
    h.b2Store.set('pp/capas/r.jpg', { body: Buffer.from('jpg'), contentType: 'image/jpeg' });
    Object.assign(h.config.outstand, { key: 'ost_t', base: 'https://outstand.test', live: false }); h.config.outstandConfigured = true;
    Object.assign(h.config.zernio, { key: 'zk_t', base: 'https://zernio.test/api', live: false }); h.config.zernioConfigured = true;
    st.oAccounts = [oAcc('IG1', 'instagram', 'podcastpulso'), oAcc('YT1', 'youtube', 'pulsobr')];
    st.zAccounts = [zAcc('ZX1', 'twitter', 'pulso_x'), zAcc('ZIG', 'instagram', 'podcastpulso')];
    global.fetch = async (url, opts = {}) => {
      const s = String(url); const method = opts.method || 'GET';
      const external = s.startsWith('https://outstand.test') || s.startsWith('https://zernio.test');
      const body = external && opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
      if (s.startsWith('https://outstand.test')) {
        const path = s.replace('https://outstand.test', ''); calls.push({ who: 'outstand', method, path, body, headers: opts.headers });
        if (st.oDown) return Response.json({ error: 'fora do ar' }, { status: 503 });
        if (method === 'GET' && path.startsWith('/v1/social-accounts?')) return Response.json({ success: true, data: st.oAccounts });
        let m;
        if (method === 'GET' && (m = path.match(/^\/v1\/social-accounts\/([^/]+)\/health$/))) return Response.json({ success: true, data: { id: m[1], healthy: st.oHealth[m[1]] !== false } });
        if (method === 'POST' && path === '/v1/posts') {
          st.oPost = { id: 'op9', scheduled: true, socialAccounts: st.oAccounts.filter((a) => body.accounts.includes(a.id)).map((a) => ({ id: a.id, network: a.network, username: a.username, status: 'pending', error: null, platformPostId: null })) };
          return Response.json({ success: true, post: st.oPost });
        }
        if (method === 'GET' && path === '/v1/posts/op9') return Response.json({ success: true, post: st.oPost });
        if (method === 'POST' && path === '/v1/media/upload') return Response.json({ success: true, data: { id: 'mr1', upload_url: 'https://upload.outstand.test/put/mr1', expires_in: 3600 } });
        if (method === 'POST' && path === '/v1/media/mr1/confirm') return Response.json({ success: true, data: { id: 'mr1', url: `https://media.outstand.test/mr1/${body?.size || 0}`, status: 'active' } });
        return Response.json({ error: 'sem rota' }, { status: 404 });
      }
      if (s.startsWith('https://upload.outstand.test/')) { const r = opts.body.getReader(); for (;;) { const { done } = await r.read(); if (done) break; } return new Response(null, { status: 200 }); }
      if (s.startsWith('https://zernio.test/api')) {
        const path = s.replace('https://zernio.test/api', ''); calls.push({ who: 'zernio', method, path, body, headers: opts.headers });
        if (st.zDown) return Response.json({ error: 'fora do ar' }, { status: 503 });
        if (method === 'GET' && path.startsWith('/v1/accounts')) return Response.json({ accounts: st.zAccounts });
        if (method === 'POST' && path === '/v1/posts') {
          if (st.zFail) return Response.json({ error: st.zFail }, { status: 400 });
          st.zPost = { _id: 'zp9', status: 'scheduled', platforms: body.platforms.map((p) => ({ ...p, status: 'pending' })) };
          return Response.json({ post: st.zPost }, { status: 201 });
        }
        if (method === 'GET' && path === '/v1/posts/zp9') return Response.json({ post: st.zPost });
        return Response.json({ error: 'sem rota' }, { status: 404 });
      }
      return realFetch(url, opts);
    };
    await socialApi.setRoutes({}); await socialApi.choose('outstand');
  });
  after(async () => {
    global.fetch = realFetch;
    Object.assign(h.config.outstand, { key: undefined, live: false }); h.config.outstandConfigured = false;
    Object.assign(h.config.zernio, { key: undefined, live: false }); h.config.zernioConfigured = false;
    await app.close(); await h.db.close();
  });

  it('rotas por rede: o padrão é o provedor em uso; rota para provedor sem chave é recusada ou ignorada', async () => {
    assert.equal((await socialApi.routeMap()).instagram, 'outstand'); assert.equal((await socialApi.routeMap()).x, 'outstand');
    await socialApi.setRoutes({ x: 'zernio', naoexiste: 'zernio' });
    assert.deepEqual(await socialApi.routes(), { x: 'zernio' }, 'rede desconhecida é descartada');
    const map = await socialApi.routeMap();
    assert.equal(map.x, 'zernio'); assert.equal(map.instagram, 'outstand'); assert.equal(map.youtube, 'outstand');
    const groups = await socialApi.plan(['instagram', 'x', 'youtube']);
    assert.deepEqual(groups.map((g) => [g.provider.id, g.platforms]), [['outstand', ['instagram', 'youtube']], ['zernio', ['x']]]);
    await assert.rejects(socialApi.setRoutes({ x: 'upload-post-falso' }), /Provedor desconhecido/);
    h.config.zernioConfigured = false;
    assert.equal((await socialApi.routeMap()).x, 'outstand', 'rota perde o efeito se o provedor ficou sem chave');
    await assert.rejects(socialApi.setRoutes({ x: 'zernio' }), /Zernio não está configurado/);
    h.config.zernioConfigured = true;
  });

  it('contas por rede, cada uma do provedor dela; erro de um provedor não esconde as contas do outro', async () => {
    const all = await socialApi.connectedAll({ force: true });
    assert.equal(all.ok, true);
    assert.equal(all.platforms.instagram.provider, 'outstand'); assert.equal(all.platforms.instagram.accountId, 'IG1');
    assert.equal(all.platforms.x.provider, 'zernio'); assert.equal(all.platforms.x.accountId, 'ZX1');
    st.zDown = true; socialApi.PROVIDERS.zernio.resetCache();
    const part = await socialApi.connectedAll({ force: true });
    assert.equal(part.ok, false); assert.match(part.error, /Zernio: Zernio recusou \(503\)/); assert.ok(part.platforms.instagram, 'Outstand segue respondendo');
    st.zDown = false; socialApi.PROVIDERS.zernio.resetCache();
  });

  it('publicação dividida: Instagram e YouTube vão à Outstand, X vai à Zernio; cada provedor recebe só as suas redes', async () => {
    h.config.outstand.live = true; h.config.zernio.live = true; calls.length = 0;
    try {
      const pub = await publishing.create({ clipId: clip.id, platforms: ['instagram', 'youtube', 'x'], title: 'Corte dividido', description: 'Legenda #pulso', userId: u.gestao.id });
      assert.equal(pub.status, 'enviando'); assert.deepEqual(pub.options.routes, { instagram: 'outstand', youtube: 'outstand', x: 'zernio' });
      const o = calls.find((c) => c.who === 'outstand' && c.method === 'POST' && c.path === '/v1/posts'); const z = calls.find((c) => c.who === 'zernio' && c.method === 'POST' && c.path === '/v1/posts');
      assert.deepEqual(o.body.accounts.sort(), ['IG1', 'YT1']); assert.equal(o.body.youtube.isShort, true);
      assert.deepEqual(z.body.platforms.map((p) => [p.platform, p.accountId]), [['twitter', 'ZX1']]);
      assert.deepEqual(pub.options.parts.map((p) => [p.provider, p.request_id]), [['outstand', 'op9'], ['zernio', 'zp9']]);
      assert.equal(pub.request_id, 'op9');
      // só a Outstand terminou: continua enviando
      st.oPost.socialAccounts = st.oPost.socialAccounts.map((a) => ({ ...a, status: 'published', platformPostId: a.network === 'youtube' ? 'yt1' : 'ig1', platformPostUrl: a.network === 'instagram' ? 'https://www.instagram.com/reel/r/' : null }));
      assert.equal((await publishing.refresh(pub.id)).status, 'enviando');
      // a Zernio termina: publicado, cada resultado diz por onde saiu
      st.zPost = { ...st.zPost, status: 'published', platforms: st.zPost.platforms.map((p) => ({ ...p, status: 'published', platformPostUrl: 'https://x.com/pulso_x/status/1', platformPostId: '1' })) };
      const done = await publishing.refresh(pub.id);
      assert.equal(done.status, 'publicado');
      assert.deepEqual(done.results.map((r) => [r.platform, r.provider]).sort(), [['instagram', 'outstand'], ['x', 'zernio'], ['youtube', 'outstand']]);
      assert.equal(done.results.find((r) => r.platform === 'x').url, 'https://x.com/pulso_x/status/1');
      const page = (await as.gestao.get(`/social/publicacoes/${pub.id}`)).text;
      assert.match(page, /Saiu por[\s\S]*Zernio e Outstand/);
    } finally { h.config.outstand.live = false; h.config.zernio.live = false; }
  });

  it('um provedor termina e o outro falha: fica "parcial" e o motivo aparece na rede que falhou', async () => {
    h.config.outstand.live = true; h.config.zernio.live = true; calls.length = 0;
    try {
      const pub = await publishing.create({ media: 'imagem', coverIds: [cover.id], platforms: ['instagram', 'x'], title: 'Post dividido', description: 'L', userId: u.gestao.id });
      st.oPost.socialAccounts = st.oPost.socialAccounts.map((a) => ({ ...a, status: 'published', platformPostId: 'ig2' }));
      st.zPost = { ...st.zPost, status: 'failed', platforms: st.zPost.platforms.map((p) => ({ ...p, status: 'failed', errorMessage: 'X: client-not-enrolled' })) };
      const done = await publishing.refresh(pub.id);
      assert.equal(done.status, 'parcial');
      assert.equal(done.results.find((r) => r.platform === 'x').error, 'X: client-not-enrolled'); assert.equal(done.results.find((r) => r.platform === 'instagram').ok, true);
    } finally { h.config.outstand.live = false; h.config.zernio.live = false; }
  });

  it('um provedor recusa ao enviar e o outro aceita: a publicação segue e o erro fica na rede certa; se todos recusam, é erro e dá para tentar de novo', async () => {
    h.config.outstand.live = true; h.config.zernio.live = true;
    try {
      st.zFail = 'conta bloqueada'; calls.length = 0;
      const pub = await publishing.create({ media: 'imagem', coverIds: [cover.id], platforms: ['instagram', 'x'], title: 'Post 3', description: 'L', userId: u.gestao.id });
      assert.equal(pub.status, 'enviando'); assert.deepEqual(pub.options.send_errors.map((e) => [e.platform, e.provider]), [['x', 'zernio']]);
      assert.match(pub.results.find((r) => r.platform === 'x').error, /conta bloqueada/);
      st.oPost.socialAccounts = st.oPost.socialAccounts.map((a) => ({ ...a, status: 'published', platformPostId: 'ig3' }));
      const done = await publishing.refresh(pub.id);
      assert.equal(done.status, 'parcial', 'o que saiu, saiu; o X falhou'); assert.match(done.results.find((r) => r.platform === 'x').error, /conta bloqueada/);
      // todos recusam
      st.zFail = 'conta bloqueada'; st.oAccounts = []; socialApi.PROVIDERS.outstand.resetCache();
      await assert.rejects(publishing.create({ media: 'imagem', coverIds: [cover.id], platforms: ['instagram', 'x'], title: 'Post 4', description: 'L', userId: u.gestao.id }), /Sem conta conectada na Outstand: Instagram/);
    } finally { st.zFail = null; st.oAccounts = [oAcc('IG1', 'instagram', 'podcastpulso'), oAcc('YT1', 'youtube', 'pulsobr')]; socialApi.PROVIDERS.outstand.resetCache(); h.config.outstand.live = false; h.config.zernio.live = false; }
  });

  it('conta que precisa reconectar bloqueia o envio daquela rede, com a explicação (e não deixa a publicação falhar às cegas)', async () => {
    h.config.outstand.live = true; h.config.zernio.live = true;
    try {
      st.zAccounts = [zAcc('ZX1', 'twitter', 'pulso_x', { needsReconnection: true }), zAcc('ZIG', 'instagram', 'podcastpulso')]; socialApi.PROVIDERS.zernio.resetCache();
      await assert.rejects(publishing.create({ media: 'imagem', coverIds: [cover.id], platforms: ['x'], title: 'X', description: 'L', userId: u.gestao.id }), /Reconecte X na Zernio: o acesso da conta venceu/);
      st.zAccounts = [zAcc('ZX1', 'twitter', 'pulso_x'), zAcc('ZIG', 'instagram', 'podcastpulso')]; socialApi.PROVIDERS.zernio.resetCache();
      // a Outstand só mostra o token vencido pela checagem: o estado guardado também bloqueia
      await h.db.query("INSERT INTO social_account_status (provider, network, handle, status) VALUES ('outstand', 'instagram', 'podcastpulso', 'reauth') ON CONFLICT (provider, network) DO UPDATE SET status = 'reauth'");
      await assert.rejects(publishing.create({ media: 'imagem', coverIds: [cover.id], platforms: ['instagram'], title: 'IG', description: 'L', userId: u.gestao.id }), /Reconecte Instagram na Outstand/);
      await h.db.query("DELETE FROM social_account_status WHERE provider = 'outstand'");
    } finally { h.config.outstand.live = false; h.config.zernio.live = false; }
  });

  it('vigia: conta que cai vira "reconectar" e avisa a gestão uma vez; lembra depois de 1 dia; para depois de 3 avisos; avisa quando volta', async () => {
    await h.db.query('DELETE FROM social_account_status'); await gone();
    let r = await health.check();
    assert.equal(r.problems.length, 0, 'tudo conectado: nada a avisar');
    assert.ok((await q("SELECT 1 FROM social_account_status WHERE provider = 'outstand' AND network = 'instagram' AND status = 'ok'")).length);
    // o token do Instagram na Outstand venceu (a checagem de saúde diz que não vale)
    st.oHealth.IG1 = false;
    r = await health.check();
    assert.equal(r.problems.length, 1); assert.match(r.problems[0].text, /Instagram \(@podcastpulso\) precisa ser reconectado na Outstand/);
    let n = await notes();
    assert.deepEqual(n.map((x) => x.name).sort(), ['admin', 'gestao'], 'gestão e superadmin, e mais ninguém');
    assert.match(n[0].title, /Reconectar Instagram \(@podcastpulso\) na Outstand/); assert.equal(n[0].url, '/integracoes#redes'); assert.match(n[0].body, /painel da Outstand/);
    await health.check();
    assert.equal((await notes()).length, 2, 'não avisa de novo na mesma hora');
    await q("UPDATE social_account_status SET notified_at = now() - interval '25 hours'");
    await health.check();
    assert.equal((await notes()).length, 4, 'lembrete depois de 1 dia'); assert.match((await notes()).at(-1).body, /\(lembrete\)/);
    await q("UPDATE social_account_status SET notified_at = now() - interval '25 hours'"); await health.check();
    await q("UPDATE social_account_status SET notified_at = now() - interval '25 hours'"); await health.check();
    assert.equal((await notes()).length, 6, 'no máximo 3 avisos por queda');
    // volta
    st.oHealth.IG1 = true;
    r = await health.check();
    assert.equal(r.problems.length, 0);
    assert.ok((await notes()).some((x) => /Instagram \(@podcastpulso\) reconectado/.test(x.title)));
  });

  it('vigia: conta que sumiu da lista avisa; provedor fora do ar não vira alarme falso; conta de provedor que não publica a rede não avisa', async () => {
    await h.db.query('DELETE FROM social_account_status'); await gone();
    await health.check();
    st.oAccounts = st.oAccounts.filter((a) => a.network !== 'youtube'); socialApi.PROVIDERS.outstand.resetCache();
    const r = await health.check();
    assert.ok(r.problems.some((p) => p.network === 'youtube' && p.status === 'sumiu'), 'YouTube já esteve conectado e sumiu');
    assert.match((await notes()).at(-1).title, /YouTube \(@pulsobr\) desconectado na Outstand/);
    // provedor sem resposta: nada muda, e o erro é informado
    const before = await q('SELECT provider, network, status FROM social_account_status ORDER BY 1, 2');
    st.oDown = true; socialApi.PROVIDERS.outstand.resetCache();
    const down = await health.check();
    assert.equal(down.errors.length >= 1, true); assert.match(down.errors.find((e) => e.provider === 'outstand').error, /Outstand recusou \(503\)/);
    assert.deepEqual(await q('SELECT provider, network, status FROM social_account_status ORDER BY 1, 2'), before, 'sem resposta não conclui que desconectou');
    st.oDown = false;
    // o Instagram da Zernio cai, mas o Instagram sai pela Outstand: sem aviso
    await gone();
    st.zAccounts = st.zAccounts.filter((a) => a.platform !== 'instagram'); socialApi.PROVIDERS.zernio.resetCache();
    await health.check();
    assert.equal((await q("SELECT status FROM social_account_status WHERE provider = 'zernio' AND network = 'instagram'"))[0].status, 'sumiu');
    assert.ok(!(await notes()).some((x) => /Instagram/.test(x.title) && /Zernio/.test(x.title)), 'não avisa de conta que não publica');
    // conta de X no Upload-Post não conta: o X sai pela Zernio
    await q("INSERT INTO social_account_status (provider, network, handle, status) VALUES ('uploadpost', 'x', 'antigo', 'sumiu') ON CONFLICT (provider, network) DO UPDATE SET status = 'sumiu'");
    health.resetCache();
    assert.ok(!(await health.problems()).some((p) => p.provider === 'uploadpost' && p.network === 'x'), 'Upload-Post não publica o X');
    await q("DELETE FROM social_account_status WHERE provider = 'uploadpost' AND network = 'x'");
    // mas o X sai pela Zernio: avisa
    st.zAccounts = []; socialApi.PROVIDERS.zernio.resetCache();
    await health.check();
    assert.ok((await notes()).some((x) => /X \(@pulso_x\) desconectado na Zernio/.test(x.title)));
    st.zAccounts = [zAcc('ZX1', 'twitter', 'pulso_x'), zAcc('ZIG', 'instagram', 'podcastpulso')]; st.oAccounts = [oAcc('IG1', 'instagram', 'podcastpulso'), oAcc('YT1', 'youtube', 'pulsobr')];
    socialApi.PROVIDERS.zernio.resetCache(); socialApi.PROVIDERS.outstand.resetCache();
  });

  it('telas: Integrações mostra contas e rotas, salva as rotas e verifica; o alerta aparece em Social, no Início e no Novo post; a gestão configura o aviso', async () => {
    await h.db.query('DELETE FROM social_account_status'); await gone(); health.resetCache();
    await health.check();
    let page = (await as.gestao.get('/integracoes')).text;
    assert.match(page, /Contas das redes/); assert.match(page, /Cada rede por um provedor/); assert.match(page, /Verificar agora/);
    assert.match(page, /X sai pela Zernio/, 'a rota salva no teste anterior aparece'); assert.match(page, /@pulso_x/);
    // salvar rotas pelo formulário
    const ok = await as.gestao.act('/integracoes/redes/rotas', { rota_x: 'outstand', rota_instagram: 'padrao' }, { from: '/integracoes' });
    assert.equal(ok.status, 302); assert.deepEqual(await socialApi.routes(), { x: 'outstand' });
    assert.equal((await as.editor.act('/integracoes/redes/rotas', { rota_x: 'zernio' }, { from: '/' })).status, 403);
    await as.gestao.act('/integracoes/redes/rotas', { rota_x: 'zernio' }, { from: '/integracoes' });
    assert.ok((await q("SELECT 1 FROM audit_log WHERE action = 'integracao.redes_rotas'")).length);
    // uma conta cai: faixa de alerta
    st.zAccounts = [zAcc('ZX1', 'twitter', 'pulso_x', { needsReconnection: true }), zAcc('ZIG', 'instagram', 'podcastpulso')]; socialApi.PROVIDERS.zernio.resetCache();
    const v = await as.gestao.act('/integracoes/redes/verificar', {}, { from: '/integracoes' });
    assert.equal(v.status, 302);
    page = (await as.gestao.get('/integracoes')).text;
    assert.match(page, /X \(@pulso_x\) precisa ser reconectado na Zernio/); assert.match(page, /Reconectar/);
    health.resetCache();
    assert.match((await as.gestao.get('/social/novo')).text, /conn-alert[\s\S]*X \(@pulso_x\) precisa ser reconectado na Zernio/);
    assert.match((await as.gestao.get('/social/publicacoes')).text, /conn-alert/);
    assert.match((await as.gestao.get('/')).text, /conn-alert/, 'no Início da gestão também');
    assert.match((await as.gestao.get('/social/novo?tipo=imagem&publicados=1')).text, /\(reconectar na Zernio\)/, 'a rede aparece desabilitada no Novo post');
    assert.doesNotMatch((await as.editor.get('/')).text, /conn-alert/, 'quem não mexe com social não vê o alerta');
    assert.match((await as.gestao.get('/gestao/notificacoes')).text, /Contas das redes/);
    st.zAccounts = [zAcc('ZX1', 'twitter', 'pulso_x'), zAcc('ZIG', 'instagram', 'podcastpulso')]; socialApi.PROVIDERS.zernio.resetCache();
    await as.gestao.act('/integracoes/redes/verificar', {}, { from: '/integracoes' }); health.resetCache();
    assert.doesNotMatch((await as.gestao.get('/social/novo')).text, /conn-alert/, 'voltou: some o alerta');
  });
});
