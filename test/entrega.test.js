const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const socialApi = require('../src/services/socialApi');
const publishing = require('../src/services/publishing');
const mediaCheck = require('../src/services/mediaCheck');
const E = require('../src/services/publishErrors');

// Entrega garantida nas redes. O incidente de 27/10/2026: a 2ª parte (16 a 32 MB) do vídeo de um corte passou a responder 503 no
// Backblaze; cada rede baixou só o começo: o Reel saiu pela metade, Facebook deu 500, Threads "could not process", X "terminated",
// o TikTok recebeu o link do Backblaze (a hospedagem falhou em silêncio) e o YouTube caiu na fila compartilhada da Outstand.
describe('entrega garantida: arquivo conferido antes, nova tentativa na hora certa e histórico de cada envio', () => {
  const as = {}; const u = {}; let app; let ep;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const realFetch = global.fetch;
  const calls = [];
  const st = { oPosts: {}, zPosts: {}, seq: 0, media: 0, uploadFail: false, netFail: 0, ttMax: 600, broken: new Map() };
  const ACC = [['IG1', 'instagram'], ['YT1', 'youtube'], ['TT1', 'tiktok'], ['FB1', 'facebook'], ['TH1', 'threads']].map(([id, network]) => ({ id, network, username: 'podcastpulso', nickname: 'Pulso', isActive: 1 }));
  const posts = (who) => calls.filter((c) => c.who === who && c.method === 'POST' && c.path === '/v1/posts');
  const lastPost = () => posts('outstand').at(-1)?.body;
  const pubRow = async (id) => (await q('SELECT * FROM episode_publications WHERE id = $1', [id]))[0];
  // a resposta de cada rede no post da Outstand: { instagram: ['published', null, 'id'] | ['failed', 'mensagem'] }
  const setO = (id, map) => { const p = st.oPosts[id]; p.socialAccounts = p.socialAccounts.map((a) => (map[a.network] ? { ...a, status: map[a.network][0], error: map[a.network][0] === 'failed' ? map[a.network][1] : null, platformPostId: map[a.network][0] === 'published' ? (map[a.network][2] || `${a.network}-1`) : null, platformPostUrl: a.network === 'instagram' && map[a.network][0] === 'published' ? 'https://www.instagram.com/reel/ok/' : null } : a)); };
  const setZ = (id, status) => { const p = st.zPosts[id]; Object.assign(p, { status, platforms: p.platforms.map((x) => ({ ...x, status, platformPostUrl: status === 'published' ? 'https://x.com/pulso/status/9' : null, errorMessage: status === 'failed' ? 'Twitter media upload failed: terminated' : null })) }); };
  // a hora da nova tentativa chegou (sem esperar de verdade)
  const dueNow = async (id) => {
    const p = await pubRow(id); const past = new Date(Date.now() - 1000).toISOString();
    await h.db.query('UPDATE episode_publications SET retry_at = $2, results = $3 WHERE id = $1', [id, past, JSON.stringify(p.results.map((r) => (r.retry_at ? { ...r, retry_at: past } : r)))]);
  };
  const mkClip = async (key, { bytes = 3000, durationMs = 34635 } = {}) => {
    h.b2Store.set(key, { body: Buffer.alloc(bytes, 7), contentType: 'video/mp4' });
    return (await q("INSERT INTO episode_clips (title, source, status, episode_id, storage_key, size_bytes, content_type, width, height, duration_ms) VALUES ('Corte', 'upload', 'pronto', $1, $2, $3, 'video/mp4', 1080, 1920, $4) RETURNING *", [ep.id, key, bytes, durationMs]))[0];
  };
  const notes = (titleLike) => q("SELECT n.title, n.body, u.name FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.title LIKE $1 ORDER BY n.id", [titleLike]);

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['admin', 'superadmin'], ['prod', 'produtora']]) { u[k] = await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    [ep] = await q("INSERT INTO episodes (number, title, status) VALUES (18, 'Sua clínica corre risco de fechar pela vigilância sanitária?', 'publicado') RETURNING *");
    Object.assign(h.config.outstand, { key: 'ost_e', base: 'https://outstand.test', live: false }); h.config.outstandConfigured = true;
    Object.assign(h.config.zernio, { key: 'zk_e', base: 'https://zernio.test/api', live: false }); h.config.zernioConfigured = true;
    global.fetch = async (url, opts = {}) => {
      const s = String(url); const method = opts.method || 'GET';
      // Backblaze com uma parte ilegível: entrega o começo e a conexão cai (como no corte de 27/10)
      if (s.startsWith('https://s3.test-region.backblazeb2.com/test-bucket/') && method === 'GET') {
        const key = decodeURIComponent(new URL(s).pathname.slice('/test-bucket/'.length));
        if (st.broken.has(key) && h.b2Store.has(key)) {
          const obj = h.b2Store.get(key); let first = true;
          const body = new ReadableStream({ pull(ctl) { if (first) { first = false; ctl.enqueue(new Uint8Array(obj.body.subarray(0, st.broken.get(key)))); } else ctl.error(Object.assign(new TypeError('terminated'), { cause: { code: 'UND_ERR_SOCKET', message: 'other side closed' } })); } });
          return new Response(body, { status: 200, headers: { 'content-length': String(obj.body.length), 'content-type': obj.contentType } });
        }
      }
      if (s.startsWith('https://upload.outstand.test/')) {
        let n = 0; const r = opts.body.getReader(); for (;;) { const { done, value } = await r.read(); if (done) break; n += value.byteLength; }
        calls.push({ who: 'upload', method, path: s, bytes: n });
        return new Response(null, { status: st.uploadFail ? 500 : 200 });
      }
      const external = s.startsWith('https://outstand.test') || s.startsWith('https://zernio.test');
      const body = external && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
      if (s.startsWith('https://outstand.test')) {
        const path = s.replace('https://outstand.test', ''); calls.push({ who: 'outstand', method, path, body, headers: opts.headers });
        let m;
        if (method === 'GET' && path.startsWith('/v1/social-accounts?')) return Response.json({ success: true, data: ACC });
        if (method === 'GET' && /\/health$/.test(path)) return Response.json({ success: true, data: { healthy: true } });
        if (method === 'GET' && /creator-info$/.test(path)) return Response.json({ success: true, data: { privacy_level_options: ['PUBLIC_TO_EVERYONE'], max_video_post_duration_sec: st.ttMax } });
        if (method === 'POST' && path === '/v1/media/upload') { st.media += 1; return Response.json({ success: true, data: { id: `m${st.media}`, upload_url: `https://upload.outstand.test/put/m${st.media}`, expires_in: 3600 } }); }
        if (method === 'POST' && (m = path.match(/^\/v1\/media\/(m\d+)\/confirm$/))) return Response.json({ success: true, data: { id: m[1], url: `https://media.outstand.test/${m[1]}/video.mp4`, status: 'active', size: body?.size } });
        if (method === 'POST' && path === '/v1/posts') {
          if (st.netFail > 0) { st.netFail -= 1; throw new TypeError('fetch failed'); } // a rede caiu: não dá para saber se o post foi criado
          st.seq += 1; const id = `op${st.seq}`;
          st.oPosts[id] = { id, scheduled: true, socialAccounts: ACC.filter((a) => body.accounts.includes(a.id)).map((a) => ({ id: a.id, network: a.network, username: a.username, status: 'pending', error: null, platformPostId: null, platformPostUrl: null })) };
          return Response.json({ success: true, post: st.oPosts[id] });
        }
        if (method === 'GET' && (m = path.match(/^\/v1\/posts\/(op\d+)$/))) return Response.json({ success: true, post: st.oPosts[m[1]] });
        return Response.json({ error: 'sem rota' }, { status: 404 });
      }
      if (s.startsWith('https://zernio.test/api')) {
        const path = s.replace('https://zernio.test/api', ''); calls.push({ who: 'zernio', method, path, body, headers: opts.headers });
        let m;
        if (method === 'GET' && path.startsWith('/v1/accounts')) return Response.json({ accounts: [{ _id: 'ZX1', platform: 'twitter', username: 'pulso_x', isActive: true }] });
        if (method === 'POST' && path === '/v1/posts') { st.seq += 1; const id = `zp${st.seq}`; st.zPosts[id] = { _id: id, status: 'scheduled', platforms: body.platforms.map((p) => ({ ...p, status: 'pending' })) }; return Response.json({ post: st.zPosts[id] }, { status: 201 }); }
        if (method === 'GET' && (m = path.match(/^\/v1\/posts\/(zp\d+)$/))) return Response.json({ post: st.zPosts[m[1]] });
        return Response.json({ error: 'sem rota' }, { status: 404 });
      }
      return realFetch(url, opts);
    };
    await socialApi.choose('outstand'); await socialApi.setRoutes({ x: 'zernio' });
    h.config.outstand.live = true; h.config.zernio.live = true;
  });
  after(async () => {
    global.fetch = realFetch;
    Object.assign(h.config.outstand, { key: undefined, live: false }); h.config.outstandConfigured = false;
    Object.assign(h.config.zernio, { key: undefined, live: false }); h.config.zernioConfigured = false;
    await app.close(); await h.db.close();
  });

  it('o arquivo que o Backblaze entrega pela metade não vai às redes: espera, tenta de novo sozinho e, com o arquivo bom, sai em todas', async () => {
    const key = 'pp/cortes/22/video-a.mp4';
    const clip = await mkClip(key);
    st.broken.set(key, 1000); calls.length = 0;
    const pub = await publishing.create({ clipId: clip.id, platforms: ['youtube', 'tiktok', 'instagram', 'facebook', 'threads', 'x'], title: 'A clínica irregular está fadada ao fracasso', description: 'Legenda', userId: u.gestao.id });
    assert.equal(pub.status, 'erro');
    assert.equal(posts('outstand').length, 0, 'nenhum post na Outstand: nada de Reel pela metade');
    assert.equal(posts('zernio').length, 0, 'nem na Zernio');
    assert.ok(pub.results.every((r) => r.code === 'arquivo_indisponivel' && r.retry_at), 'cada rede espera a nova tentativa');
    assert.ok(new Date(pub.retry_at) > new Date(Date.now() + 60_000), 'tenta de novo em uns 2 minutos');
    assert.match(pub.error, /Backblaze\) não entregou o arquivo inteiro: nada foi enviado às redes/);
    assert.match(pub.error, /parou de entregar o arquivo em 0,0 MB de 0,0 MB: terminated \(UND_ERR_SOCKET: other side closed\)/);
    const [att] = await publishing.attemptsOf(pub.id);
    assert.equal(att.trigger, 'agora'); assert.ok(att.finished_at); assert.match(att.error, /parou de entregar/);
    assert.equal((await notes('Tentando de novo:%')).length, 1, 'quem pediu sabe que vai tentar de novo (um aviso só)');
    // antes da hora, a rotina não mexe
    await publishing.tick(); assert.equal(posts('outstand').length, 0);
    // o Backblaze volta a entregar o arquivo inteiro; a hora chega
    st.broken.delete(key); await dueNow(pub.id);
    await publishing.tick();
    const again = await pubRow(pub.id);
    assert.equal(again.status, 'enviando');
    const o = lastPost();
    assert.deepEqual(o.accounts.sort(), ['FB1', 'IG1', 'TH1', 'TT1', 'YT1']);
    assert.match(o.containers[0].media[0].url, /^https:\/\/media\.outstand\.test\//, 'todas as redes da Outstand (e o TikTok) baixam da cópia hospedada');
    assert.ok(calls.some((c) => c.who === 'upload' && c.bytes === 3000), 'subiu o arquivo INTEIRO');
    assert.match(posts('zernio').at(-1).body.mediaItems[0].url, /^https:\/\/s3\.test-region\.backblazeb2\.com\//, 'o X (Zernio) recebe o link do Backblaze, que acabou de ser lido inteiro');
    setO(again.request_id, Object.fromEntries(['youtube', 'tiktok', 'instagram', 'facebook', 'threads'].map((n) => [n, ['published']])));
    setZ(again.options.parts.find((p) => p.provider === 'zernio').request_id, 'published');
    const done = await publishing.refresh(pub.id);
    assert.equal(done.status, 'publicado'); assert.equal(done.retry_at, null);
    assert.equal(done.attempts, 2);
    const list = await publishing.attemptsOf(pub.id);
    assert.deepEqual(list.map((a) => a.trigger), ['automatico', 'agora']);
    assert.ok(list[0].outcome.every((x) => x.ok));
    assert.equal(list[0].media.files[0].onde, 'outstand');
    const [pubNote] = await notes('Publicado:%');
    assert.match(pubNote.body, /depois de 2 tentativas/);
  });

  it('o editor envia o vídeo de novo: enquanto o corte processa a publicação espera, e depois sai com o arquivo novo', async () => {
    const key = 'pp/cortes/30/video-velho.mp4';
    const clip = await mkClip(key);
    st.broken.set(key, 800);
    const pub = await publishing.create({ clipId: clip.id, platforms: ['instagram', 'facebook'], title: 'Reenviado pelo editor', description: 'L', userId: u.gestao.id });
    assert.equal(pub.results[0].code, 'arquivo_indisponivel');
    // o editor sobe o vídeo de novo: o corte volta a processar
    await h.db.query("UPDATE episode_clips SET status = 'processando' WHERE id = $1", [clip.id]);
    await dueNow(pub.id); await publishing.tick();
    let p = await pubRow(pub.id);
    assert.equal(p.status, 'erro'); assert.ok(p.results.every((r) => r.code === 'em_preparo' && r.retry_at), 'espera o corte ficar pronto');
    assert.match(p.results[0].hint, /O vídeo está sendo enviado ou lido de novo/);
    // pronto, com outro arquivo (chave nova): sai com ele, hospedado de novo
    h.b2Store.set('pp/cortes/30/video-novo.mp4', { body: Buffer.alloc(4000, 1), contentType: 'video/mp4' });
    await h.db.query("UPDATE episode_clips SET status = 'pronto', storage_key = 'pp/cortes/30/video-novo.mp4', size_bytes = 4000 WHERE id = $1", [clip.id]);
    calls.length = 0;
    await dueNow(pub.id); await publishing.tick();
    p = await pubRow(pub.id);
    assert.equal(p.status, 'enviando');
    assert.ok(calls.some((c) => c.who === 'upload' && c.bytes === 4000), 'subiu o arquivo novo inteiro');
    assert.deepEqual(lastPost().accounts.sort(), ['FB1', 'IG1']);
    st.broken.delete(key);
  });

  it('fila do YouTube na Outstand: só o YouTube volta, no horário que ela informa; o Instagram que saiu fica como está e o vídeo não sobe de novo', async () => {
    const clip = await mkClip('pp/cortes/3/video-b.mp4');
    const pub = await publishing.create({ clipId: clip.id, platforms: ['youtube', 'instagram'], title: 'Mais de 30 clínicas fechadas', description: 'L', userId: u.gestao.id });
    assert.equal(pub.status, 'enviando');
    const retryAt = new Date(Date.now() + 10 * 60_000).toISOString();
    setO(pub.request_id, { instagram: ['published'], youtube: ['failed', `Shared YouTube upload capacity is waiting for the next release. Retry or schedule this destination later. [youtube_upload_error:release_pending; retryAt=${retryAt}]`] });
    const p = await publishing.refresh(pub.id);
    assert.equal(p.status, 'parcial');
    const yt = p.results.find((r) => r.platform === 'youtube');
    assert.equal(yt.code, 'youtube_fila');
    assert.ok(Date.parse(yt.retry_at) > Date.parse(retryAt) && Date.parse(yt.retry_at) < Date.parse(retryAt) + 3 * 60_000, 'logo depois da hora informada');
    assert.match(yt.hint, /Fila compartilhada do YouTube na Outstand: a próxima vaga abre às (\d{2}\/\d{2} )?\d{2}:\d{2}\./);
    calls.length = 0;
    await publishing.tick();
    assert.equal(posts('outstand').length, 0, 'antes da vaga não tenta (cada tentativa gasta da cota do dia)');
    await dueNow(pub.id); await publishing.tick();
    const again = await pubRow(pub.id);
    assert.equal(again.status, 'enviando');
    assert.deepEqual(lastPost().accounts, ['YT1'], 'só o YouTube'); assert.equal(lastPost().instagram, undefined);
    assert.ok(!calls.some((c) => c.path === '/v1/media/upload'), 'reaproveitou o vídeo já hospedado (não depende do Backblaze de novo)');
    setO(again.request_id, { youtube: ['published', null, 'yt9'] });
    const done = await publishing.refresh(pub.id);
    assert.equal(done.status, 'publicado');
    assert.equal(done.results.find((r) => r.platform === 'instagram').url, 'https://www.instagram.com/reel/ok/', 'o Instagram não foi refeito');
    assert.equal(done.results.find((r) => r.platform === 'youtube').url, 'https://www.youtube.com/watch?v=yt9');
  });

  it('o TikTok nunca sai com o link do Backblaze: se a Outstand não recebe o arquivo, nada é enviado e tenta de novo', async () => {
    const clip = await mkClip('pp/cortes/5/video-c.mp4');
    st.uploadFail = true; calls.length = 0;
    try {
      const pub = await publishing.create({ clipId: clip.id, platforms: ['tiktok', 'instagram'], title: 'TikTok', description: 'L', userId: u.gestao.id });
      assert.equal(pub.status, 'erro'); assert.equal(posts('outstand').length, 0, 'sem o arquivo hospedado, não manda o link do Backblaze');
      assert.ok(pub.results.every((r) => r.code === 'provedor_fora' && r.retry_at));
    } finally { st.uploadFail = false; }
  });

  it('o que precisa de ação (conta vencida) não tenta sozinho e avisa quem pediu e a gestão uma vez', async () => {
    const clip = await mkClip('pp/cortes/6/video-d.mp4');
    const pub = await publishing.create({ clipId: clip.id, platforms: ['instagram', 'youtube'], title: 'Conta vencida', description: 'L', userId: u.prod.id });
    setO(pub.request_id, { instagram: ['failed', 'Access token has expired'], youtube: ['published'] });
    const p = await publishing.refresh(pub.id);
    assert.equal(p.status, 'parcial'); assert.equal(p.retry_at, null);
    const ig = p.results.find((r) => r.platform === 'instagram');
    assert.equal(ig.code, 'conta'); assert.equal(ig.action, true); assert.match(ig.hint, /precisa ser reconectada em Integrações/);
    let n = await notes('Precisa de ação: Conta vencida');
    assert.deepEqual(n.map((x) => x.name).sort(), ['admin', 'gestao', 'prod'], 'quem pediu e a gestão');
    // reenviar na mão e falhar do mesmo jeito não repete o aviso
    const again = await publishing.retry(pub.id);
    setO(again.request_id, { instagram: ['failed', 'Access token has expired'] });
    await publishing.refresh(pub.id);
    n = await notes('Precisa de ação: Conta vencida');
    assert.equal(n.length, 3);
  });

  it('tentativas esgotadas param e pedem ação (sem insistir para sempre)', async () => {
    const clip = await mkClip('pp/cortes/7/video-e.mp4');
    const pub = await publishing.create({ clipId: clip.id, platforms: ['facebook'], title: 'Esgotou', description: 'L', userId: u.gestao.id });
    await h.db.query(`UPDATE episode_publications SET options = options || '{"tries":{"facebook":5}}' WHERE id = $1`, [pub.id]);
    setO(pub.request_id, { facebook: ['failed', 'Error publishing post to Facebook: Failed to upload Facebook video for publishing: 500 - Request failed with status code 500'] });
    const p = await publishing.refresh(pub.id);
    assert.equal(p.status, 'erro'); assert.equal(p.retry_at, null);
    const fb = p.results[0];
    assert.equal(fb.code, 'rede'); assert.equal(fb.tries, 6); assert.match(fb.hint, /Já tentamos 6 vezes/);
  });

  it('envio interrompido (o servidor reiniciou no meio da preparação) volta sozinho em 1 minuto', async () => {
    const clip = await mkClip('pp/cortes/8/video-f.mp4');
    const [pub] = await q("INSERT INTO episode_publications (episode_id, clip_id, platforms, title, status, media, provider) VALUES ($1, $2, '{instagram,youtube}', 'Interrompido', 'enviando', 'video', 'outstand') RETURNING *", [ep.id, clip.id]);
    await q("INSERT INTO publication_attempts (publication_id, trigger, platforms, started_at) VALUES ($1, 'agendado', '{instagram,youtube}', now() - interval '30 minutes')", [pub.id]);
    await publishing.recoverInterrupted();
    const p = await pubRow(pub.id);
    assert.equal(p.status, 'erro');
    assert.ok(p.results.every((r) => r.code === 'interrompido'));
    assert.ok(new Date(p.retry_at) <= new Date(Date.now() + 90_000), 'volta em 1 minuto');
    const [att] = await publishing.attemptsOf(pub.id); assert.ok(att.finished_at, 'a tentativa interrompida foi fechada');
  });

  it('sem resposta da Outstand ao criar o post: a nova tentativa repete com a MESMA chave (se o post foi criado, não publica duas vezes)', async () => {
    const clip = await mkClip('pp/cortes/9/video-g.mp4');
    st.netFail = 3; calls.length = 0;
    const pub = await publishing.create({ clipId: clip.id, platforms: ['instagram'], title: 'Sem resposta', description: 'L', userId: u.gestao.id });
    assert.equal(pub.status, 'erro'); assert.equal(pub.results[0].code, 'provedor_fora'); assert.ok(pub.retry_at);
    const keys = posts('outstand').map((c) => c.headers['Idempotency-Key']);
    assert.equal(keys.length, 3); assert.equal(new Set(keys).size, 1);
    assert.equal(pub.options.pending_keys.outstand.key, keys[0]);
    await dueNow(pub.id); await publishing.tick();
    assert.equal(posts('outstand').at(-1).headers['Idempotency-Key'], keys[0], 'a mesma chave: a Outstand devolve o post que talvez já exista');
    assert.equal((await pubRow(pub.id)).status, 'enviando');
  });

  it('clique repetido em "Publicar" (o vídeo leva alguns segundos para subir): o mesmo pedido em 2 minutos devolve a publicação que já existe', async () => {
    const clip = await mkClip('pp/cortes/40/video-m.mp4');
    calls.length = 0;
    const args = { clipId: clip.id, platforms: ['instagram'], title: 'Duplo clique', description: 'L', userId: u.gestao.id };
    const [a, b] = await Promise.all([publishing.create(args), publishing.create(args)]);
    assert.equal(a.id, b.id, 'dois cliques ao mesmo tempo: uma publicação');
    assert.equal(posts('outstand').length, 1, 'um post só na Outstand');
    assert.equal((await publishing.create(args)).id, a.id, 'e logo depois também');
    assert.notEqual((await publishing.create({ ...args, title: 'Outro título' })).id, a.id, 'pedido diferente é outra publicação');
    const page = (await as.gestao.get('/social/novo')).text;
    assert.match(page, /action="\/social\/publicar" class="stack-lg" data-compose data-busy="Enviando…"/, 'o botão mostra o andamento e trava o formulário');
  });

  it('o link que chega depois (TikTok) é buscado de novo nas horas seguintes', async () => {
    const clip = await mkClip('pp/cortes/42/video-o.mp4');
    const pub = await publishing.create({ clipId: clip.id, platforms: ['tiktok', 'instagram'], title: 'Link depois', description: 'L', userId: u.gestao.id });
    setO(pub.request_id, { tiktok: ['published', null, 'publish_abc'], instagram: ['published'] });
    const done = await publishing.refresh(pub.id);
    assert.equal(done.status, 'publicado'); assert.equal(done.results.find((r) => r.platform === 'tiktok').url, null, 'o TikTok ainda não deu o link');
    const tt = st.oPosts[pub.request_id].socialAccounts.find((a) => a.network === 'tiktok');
    Object.assign(tt, { platformPostId: '7701363240067976466', platformPostUrl: 'https://www.tiktok.com/@podcast.pulso/video/7701363240067976466' });
    await publishing.fillLinks();
    assert.equal((await pubRow(pub.id)).results.find((r) => r.platform === 'tiktok').url, 'https://www.tiktok.com/@podcast.pulso/video/7701363240067976466');
    calls.length = 0; await publishing.fillLinks();
    assert.ok(!calls.some((c) => c.path === `/v1/posts/${pub.request_id}`), 'com o link no lugar, não consulta mais');
  });

  it('texto curto no X (280) e no Threads (500): cada um recebe a versão que cabe, sem cortar palavra, e quem publica é avisado', async () => {
    const clip = await mkClip('pp/cortes/41/video-n.mp4');
    const legenda = `${'Falar que tem a licença é diferente de comprovar. '.repeat(4).trim()}\n\n${'Antes de atender, exija os documentos do espaço. '.repeat(10).trim()}\n\nEpisódio completo no nosso canal do YouTube!`;
    calls.length = 0;
    const pub = await publishing.create({ clipId: clip.id, platforms: ['instagram', 'threads', 'x'], title: 'Texto longo', description: legenda, userId: u.gestao.id });
    assert.equal(pub.status, 'enviando');
    assert.ok(pub.options.warnings.some((w) => /^X: a legenda tem \d+ caracteres e a rede aceita 280; lá vai a versão curta/.test(w)));
    assert.ok(pub.options.warnings.some((w) => /^Threads: a legenda tem \d+ caracteres e a rede aceita 500/.test(w)));
    const o = lastPost();
    assert.equal(o.containers[0].content, legenda, 'o Instagram leva a legenda inteira');
    assert.ok([...o.threads.content].length <= 500 && legenda.startsWith(o.threads.content), 'o Threads leva o começo que cabe (senão a Outstand recusaria o post inteiro)');
    const xText = posts('zernio').at(-1).body.platforms.find((p) => p.platform === 'twitter').customContent;
    assert.equal(xText, 'Falar que tem a licença é diferente de comprovar. Falar que tem a licença é diferente de comprovar. Falar que tem a licença é diferente de comprovar. Falar que tem a licença é diferente de comprovar.', 'o X leva o primeiro parágrafo, que cabe em 280');
    assert.equal(E.classify("Tweet text is too long (283 characters). Twitter's limit is 280 characters.").code, 'texto_longo');
    // pub 8 (28/10): collab com perfil privado ou inexistente vem como OAuthException, mas não é a conta
    const ig = E.classify('Error publishing Instagram post: Failed to create Instagram media container: 400 - {"error":{"message":"Invalid user id","type":"OAuthException","code":110,"error_subcode":2207018,"is_transient":false,"error_user_title":"Cannot load user with a private profile or invalid username","error_user_msg":"The following user(s) cannot be accessed: acauvic"}}');
    assert.equal(ig.code, 'ig_perfil'); assert.equal(ig.terminal, true);
    assert.match(ig.hint, /não encontrou o perfil @acauvic do collab ou da marcação/);
  });

  it('duração por rede: corte de 2 min não agenda Reels do Facebook (a Outstand recusaria o post inteiro); no X é só aviso', async () => {
    const clip = await mkClip('pp/cortes/10/video-h.mp4', { durationMs: 120_000 });
    await assert.rejects(publishing.create({ clipId: clip.id, platforms: ['facebook', 'instagram'], title: 'Longo', description: 'L', userId: u.gestao.id }), /Facebook Reels: o vídeo tem 2 min e a rede aceita até 1 min 30 s/);
    const longer = await mkClip('pp/cortes/10/video-h2.mp4', { durationMs: 150_000 });
    const pub = await publishing.create({ clipId: longer.id, platforms: ['instagram', 'x'], title: 'Longo 2', description: 'L', userId: u.gestao.id });
    assert.ok(pub.options.warnings.some((w) => /X: o vídeo tem 2 min 30 s; conta comum aceita até 2 min 20 s/.test(w)), 'pode ser conta Premium: avisa, não bloqueia');
    assert.equal(pub.status, 'enviando');
  });

  it('TikTok com vídeo mais longo do que a conta aceita: falha só o TikTok, o resto sai', async () => {
    const clip = await mkClip('pp/cortes/11/video-i.mp4', { durationMs: 45_000 });
    st.ttMax = 30;
    try {
      const pub = await publishing.create({ clipId: clip.id, platforms: ['tiktok', 'instagram'], title: 'TikTok longo', description: 'L', userId: u.gestao.id });
      assert.equal(pub.status, 'enviando'); assert.deepEqual(lastPost().accounts, ['IG1']); assert.equal(lastPost().tiktok, undefined);
      assert.match(pub.results.find((r) => r.platform === 'tiktok').error, /tem 45 s e esta conta aceita até 30 s/);
      setO(pub.request_id, { instagram: ['published'] });
      const p = await publishing.refresh(pub.id);
      assert.equal(p.status, 'parcial');
      const tt = p.results.find((r) => r.platform === 'tiktok');
      assert.equal(tt.code, 'formato'); assert.equal(tt.retry_at, null, 'precisa de um corte mais curto: não insiste');
    } finally { st.ttMax = 600; }
  });

  it('agendado com o arquivo ilegível: a conferência antes do horário avisa a equipe com antecedência (uma vez por dia)', async () => {
    const key = 'pp/cortes/12/video-j.mp4';
    const clip = await mkClip(key);
    st.broken.set(key, 500);
    await h.db.query('DELETE FROM hosted_media WHERE storage_key = $1', [key]);
    const [pub] = await q("INSERT INTO episode_publications (episode_id, clip_id, platforms, title, status, media, provider, scheduled_at, created_by) VALUES ($1, $2, '{instagram}', 'Agendado ruim', 'agendado', 'video', 'outstand', now() + interval '1 hour', $3) RETURNING *", [ep.id, clip.id, u.prod.id]);
    try {
      const r = await publishing.precheckScheduled();
      assert.equal(r.ok, false); assert.equal(r.code, 'arquivo_indisponivel');
      const n = await notes('Atenção antes de publicar: Agendado ruim');
      assert.deepEqual(n.map((x) => x.name).sort(), ['admin', 'gestao', 'prod']);
      assert.match(n[0].body, /Agendado para (\d{2}\/\d{2} )?\d{2}:\d{2}\. O armazenamento \(Backblaze\) não entregou o arquivo inteiro/);
      assert.equal(await publishing.precheckScheduled(), null, 'na mesma hora não confere de novo');
      assert.equal((await pubRow(pub.id)).status, 'agendado', 'segue agendado: na hora, só sai se o arquivo estiver bom');
    } finally { st.broken.delete(key); await h.db.query('DELETE FROM episode_publications WHERE id = $1', [pub.id]); }
  });

  it('telas: a publicação mostra a nova tentativa e o motivo em português, o histórico de envio e dá para parar; Gestão > Sistema lista o que espera e o que precisa de ação', async () => {
    const clip = await mkClip('pp/cortes/13/video-k.mp4');
    const pub = await publishing.create({ clipId: clip.id, platforms: ['youtube', 'instagram'], title: 'Na fila do YouTube', description: 'L', userId: u.gestao.id });
    setO(pub.request_id, { instagram: ['published'], youtube: ['failed', `Shared YouTube upload capacity is waiting for the next release. [youtube_upload_error:release_pending; retryAt=${new Date(Date.now() + 15 * 60_000).toISOString()}]`] });
    await publishing.refresh(pub.id);
    let page = (await as.gestao.get(`/social/publicacoes/${pub.id}`)).text;
    assert.match(page, /Nova tentativa automática às <span class="mono">(\d{2}\/\d{2} )?\d{2}:\d{2}<\/span>/);
    assert.match(page, /Fila compartilhada do YouTube na Outstand: a próxima vaga abre às (\d{2}\/\d{2} )?\d{2}:\d{2}\./);
    assert.match(page, /Resposta: Shared YouTube upload capacity/, 'a resposta original fica logo abaixo, para quem precisar');
    assert.match(page, /Histórico de envio/); assert.match(page, /Envio na hora/); assert.match(page, /vídeo \([^)]+\) hospedado na Outstand/);
    assert.match(page, /Reenviar agora/); assert.match(page, /Parar novas tentativas/);
    const sys = (await as.gestao.get('/gestao/sistema')).text;
    assert.match(sys, /Publicações nas redes/); assert.match(sys, /Nova tentativa marcada/); assert.match(sys, /Na fila do YouTube/); assert.match(sys, /Conta vencida/, 'a que precisa de ação aparece');
    const list = (await as.gestao.get('/social/publicacoes')).text;
    assert.match(list, /Nova tentativa<\/span> <span class="mono small muted">\d{2}:\d{2}/);
    assert.equal((await as.prod.act(`/social/publicacoes/${pub.id}/parar`, {}, { from: `/social/publicacoes/${pub.id}` })).status, 403, 'só a gestão');
    await as.gestao.act(`/social/publicacoes/${pub.id}/parar`, {}, { from: `/social/publicacoes/${pub.id}` });
    const stopped = await pubRow(pub.id);
    assert.equal(stopped.retry_at, null); assert.match(stopped.results.find((r) => r.platform === 'youtube').hint, /Novas tentativas automáticas paradas/);
    page = (await as.gestao.get(`/social/publicacoes/${pub.id}`)).text;
    assert.doesNotMatch(page, /Nova tentativa automática às/); assert.match(page, /Reenviar as que falharam/);
    assert.ok((await q("SELECT 1 FROM audit_log WHERE action = 'publicacao.tentativas_paradas'")).length);
  });

  it('vigia: worker sem sinal e agendado atrasado avisam a gestão (uma vez por hora); banco que não responde reinicia o worker', async () => {
    const watchdog = require('../src/services/watchdog');
    await h.db.query('DELETE FROM worker_heartbeats'); await h.db.query("DELETE FROM notifications WHERE type = 'integracao'");
    await h.db.query("INSERT INTO worker_heartbeats (worker, role, seen_at) VALUES ('vps:1', 'worker', now() - interval '10 minutes')");
    const clip = await mkClip('pp/cortes/14/video-l.mp4');
    const [late] = await q("INSERT INTO episode_publications (episode_id, clip_id, platforms, title, status, media, provider, scheduled_at) VALUES ($1, $2, '{instagram}', 'Atrasado', 'agendado', 'video', 'outstand', now() - interval '20 minutes') RETURNING *", [ep.id, clip.id]);
    try {
      const found = await watchdog.check();
      assert.deepEqual(found.map((x) => x.key).sort(), ['atrasada', 'worker']);
      const n = await q("SELECT n.title, n.body, n.url, u.name FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.type = 'integracao' ORDER BY n.id");
      assert.ok(n.some((x) => x.title === 'O worker parou' && /há 10 min/.test(x.body) && x.url === '/gestao/sistema'));
      assert.ok(n.some((x) => x.title === 'Publicação agendada atrasada' && /Atrasado \(\d{2}:\d{2}\) ainda não saiu/.test(x.body)));
      assert.deepEqual([...new Set(n.map((x) => x.name))].sort(), ['admin', 'gestao'], 'a gestão');
      await watchdog.check();
      assert.equal((await q("SELECT 1 FROM notifications WHERE type = 'integracao'")).length, n.length, 'na mesma hora não repete');
      // banco travado (pool esgotado): duas conferências sem resposta e o worker sai para o Docker reiniciar
      const real = h.db.query; let exited = null;
      h.db.query = () => new Promise(() => {});
      try {
        assert.equal(await watchdog.selfCheck({ timeoutMs: 20, exit: (c) => { exited = c; } }), false); assert.equal(exited, null, 'uma falha só não reinicia');
        await watchdog.selfCheck({ timeoutMs: 20, exit: (c) => { exited = c; } }); assert.equal(exited, 1);
      } finally { h.db.query = real; }
      assert.equal(await watchdog.selfCheck({ exit: () => {} }), true);
    } finally { await h.db.query('DELETE FROM episode_publications WHERE id = $1', [late.id]); await h.db.query('DELETE FROM worker_heartbeats'); }
  });

  it('conferência parte a parte (episódio grande): acha a parte que o armazenamento não entrega sem baixar gigabytes', async () => {
    const MB = 1024 ** 2; const part = 64 * MB; const size = 4 * part;
    const seen = [];
    const prev = global.fetch;
    global.fetch = async (url, opts = {}) => {
      if (!String(url).startsWith('https://probe.test/')) return prev(url, opts);
      const at = Number(opts.headers.Range.match(/bytes=(\d+)-/)[1]); seen.push(at);
      if (String(url).endsWith('ruim.mp4') && at >= part && at < 2 * part) return new Response('<Error><Code>ServiceUnavailable</Code></Error>', { status: 503 });
      return new Response('x', { status: 206 });
    };
    try {
      const ok = await mediaCheck.probe('https://probe.test/bom.mp4', { size, partSize: part });
      assert.equal(ok.mode, 'partes'); assert.equal(ok.probes, 5, 'começo de cada parte e o último byte');
      await assert.rejects(mediaCheck.probe('https://probe.test/ruim.mp4', { size, partSize: part }), (e) => e.code === 'arquivo_indisponivel' && /respondeu 503.*na altura de 64,0 MB de 256 MB/.test(e.message));
    } finally { global.fetch = prev; }
  });

  it('corrigir e reenviar: só a rede que falhou, com o collab e o texto editados; o que já saiu não muda; dá para mandar para outra rede', async () => {
    const clip = await mkClip('pp/cortes/28/video-collab.mp4');
    const pub = await publishing.create({ clipId: clip.id, platforms: ['instagram', 'facebook'], title: 'Mitos e verdades', description: 'Legenda original', userId: u.gestao.id, instagram: { collaborators: ['marirvabo', 'acauvic'], tags: [] } });
    const opId = Object.keys(st.oPosts).at(-1);
    setO(opId, { facebook: ['published'], instagram: ['failed', 'Failed to create Instagram media container: 400 - {"error":{"message":"Invalid user id","type":"OAuthException","code":110,"error_subcode":2207018,"error_user_msg":"The following user(s) cannot be accessed: acauvic"}}'] });
    await publishing.refresh(pub.id);
    let p = await pubRow(pub.id);
    assert.equal(p.status, 'parcial');
    assert.equal(p.results.find((r) => r.platform === 'instagram').code, 'ig_perfil');

    const page = (await as.gestao.get(`/social/publicacoes/${pub.id}`)).text;
    assert.match(page, /data-resend-net="">[\s\S]*?Corrigir e reenviar/);
    assert.match(page, /Corrigir e reenviar só Reels do Instagram|Corrigir e reenviar só Instagram/);
    assert.match(page, /id="modal-reenviar"/);
    assert.match(page, /data-failed="instagram"/);
    assert.match(page, /value="facebook" disabled/, 'a rede que já está no ar não entra');
    assert.match(page, /data-initial="[^"]*acauvic/, 'o collab atual vem preenchido para corrigir');
    assert.equal((await as.prod.act(`/social/publicacoes/${pub.id}/reenviar`, { platforms: 'instagram' }, { from: `/social/publicacoes/${pub.id}` })).status, 403);

    calls.length = 0;
    const r = await as.gestao.act(`/social/publicacoes/${pub.id}/reenviar`, { platforms: ['instagram', 'facebook'], title: 'Mitos e verdades', description: 'Legenda nova só para o Instagram', ig_collab: ['marirvabo', '@acauavic'] }, { from: `/social/publicacoes/${pub.id}` });
    assert.equal(r.status, 302);
    const sent = lastPost();
    assert.deepEqual(sent.accounts, ['IG1'], 'só o Instagram: o Facebook já estava no ar');
    assert.deepEqual(sent.instagram.collaborators, ['marirvabo', 'acauavic']);
    assert.equal(sent.containers[0].content, 'Legenda nova só para o Instagram');
    p = await pubRow(pub.id);
    assert.equal(p.description, 'Legenda original', 'o texto da publicação (o que saiu no Facebook) fica');
    assert.deepEqual(p.options.texts.instagram, { title: 'Mitos e verdades', description: 'Legenda nova só para o Instagram' });
    assert.ok(p.results.find((r2) => r2.platform === 'facebook').ok, 'o Facebook continua no ar');
    setO(Object.keys(st.oPosts).at(-1), { instagram: ['published'] });
    await publishing.refresh(pub.id);
    p = await pubRow(pub.id);
    assert.equal(p.status, 'publicado');
    assert.match((await as.gestao.get(`/social/publicacoes/${pub.id}`)).text, /Com texto próprio desta rede/);

    // publicada em tudo: dá para mandar para outra rede que ainda não recebeu
    assert.match((await as.gestao.get(`/social/publicacoes/${pub.id}`)).text, /Publicar em outra rede/);
    const again = await publishing.resend(pub.id, { platforms: ['instagram'] });
    assert.match(again.error, /pelo menos uma rede que ainda não está no ar/);
    calls.length = 0;
    await as.gestao.act(`/social/publicacoes/${pub.id}/reenviar`, { platforms: 'threads', title: 'Mitos e verdades', description: 'Legenda original' }, { from: `/social/publicacoes/${pub.id}` });
    assert.deepEqual(lastPost().accounts, ['TH1']);
    p = await pubRow(pub.id);
    assert.deepEqual(p.platforms, ['instagram', 'facebook', 'threads']);
    assert.equal(p.options.texts.threads, undefined, 'mesmo texto da publicação: sem texto próprio');
  });

  it('cada resposta que já vimos vira um código, a frase certa e a decisão certa (tentar de novo ou pedir ação)', () => {
    const cases = [
      ['Error publishing post to Facebook: Failed to upload Facebook video for publishing: 500 - Request failed with status code 500', 'rede', true],
      ['Threads container 17908463670378601 failed: Threads could not process it (UNKNOWN)', 'rede', true],
      ['Twitter media upload failed: terminated', 'rede', true],
      ['TikTok API error (url_ownership_unverified): Please review our URL ownership verification rules', 'tiktok_dominio', true],
      ['TikTok API error (reached_active_user_cap)', 'tiktok_cota', true],
      ['TikTok API error (spam_risk_user_banned_from_posting)', 'tiktok_bloqueado', false],
      ['TikTok API error (access_token_invalid)', 'conta', false],
      ['Shared YouTube uploads have reached the daily limit. [youtube_upload_error:daily_limit_reached; retryAt=2099-10-07T07:00:00.000Z]', 'youtube_fila', true],
      ['Status is a duplicate.', 'repetido', false],
      ['Rate limit exceeded. Please try again later.', 'limite', true],
      ['Invalid video aspect ratio', 'formato', false],
    ];
    for (const [msg, code, retries] of cases) {
      const c = E.classify(msg);
      assert.equal(c.code, code, msg); assert.equal(Boolean(c.retryAt), retries, msg);
    }
    const daily = E.classify('[youtube_upload_error:daily_limit_reached; retryAt=2099-10-07T07:00:00.000Z]');
    assert.ok(daily.retryAt > new Date('2099-10-07T07:00:00.000Z'), 'espera o novo dia do Pacífico');
    assert.match(E.sentence(daily), /nova vaga às 07\/10 04:0\d\./, 'outro dia: mostra a data');
  });
});
