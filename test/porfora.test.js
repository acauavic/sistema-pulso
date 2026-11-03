const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('Postado por fora: corte e rede que falhou', () => {
  const as = {}; let app; let ep; let g;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const one = (sql, p) => q(sql, p).then((r) => r[0]);
  const clip = async (title) => (await one("INSERT INTO episode_clips (episode_id, title, post_title, caption, status, storage_key, source) VALUES ($1, $2, $2, 'Legenda do corte', 'pronto', 'pp/c.mp4', 'upload') RETURNING id", [ep, title])).id;

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['editor', 'editor_video']]) { await h.createUser({ name: k, email: `${k}@pf.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@pf.com`); }
    g = (await one("INSERT INTO guests (name, status, instagram) VALUES ('Mari Vabo', 'gravado', 'marivabo') RETURNING id")).id;
    ep = (await one("INSERT INTO episodes (number, title, guest_id, status) VALUES (12, 'Gestão', $1, 'publicado') RETURNING id", [g])).id;
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('reconhece a rede pelo link', () => {
    const { networkOf, parseLinks } = require('../src/services/publishing');
    assert.equal(networkOf('https://www.instagram.com/reel/abc/'), 'instagram');
    assert.equal(networkOf('https://youtu.be/x'), 'youtube'); assert.equal(networkOf('https://www.youtube.com/shorts/x'), 'youtube');
    assert.equal(networkOf('https://vm.tiktok.com/x'), 'tiktok'); assert.equal(networkOf('https://x.com/a/status/1'), 'x');
    assert.equal(networkOf('https://www.threads.com/@a/post/1'), 'threads'); assert.equal(networkOf('https://fb.watch/x'), 'facebook');
    assert.equal(networkOf('https://notinstagram.com/x'), null); assert.equal(networkOf('javascript:alert(1)'), null);
    assert.match(parseLinks('https://instagram.com/a https://instagram.com/b').error, /Mais de um link do Instagram/);
    assert.deepEqual(parseLinks('https://instagram.com/reel/a\nhttps://tiktok.com/v/1').links.map((l) => l.platform), ['instagram', 'tiktok']);
  });

  it('corte postado por fora vira publicação no ar, com collab, e sai dos exclusivos do portal', async () => {
    const c = await clip('Corte emergência');
    assert.match((await as.gestao.get(`/cortes/${c}`)).text, /Postado por fora\? Registrar o link/);
    assert.match((await as.gestao.get(`/cortes/${c}`)).text, /value="@marivabo"/);
    assert.equal((await as.editor.act(`/cortes/${c}/por-fora`, { links: 'https://instagram.com/reel/a' }, { from: '/' })).status, 403);

    let r = await as.gestao.act(`/cortes/${c}/por-fora`, { links: 'https://exemplo.com/a' }, { from: `/cortes/${c}` });
    assert.equal(r.location, `/cortes/${c}`);
    assert.equal((await q('SELECT id FROM episode_publications WHERE clip_id = $1', [c])).length, 0);

    r = await as.gestao.act(`/cortes/${c}/por-fora`, { links: 'https://www.instagram.com/reel/EMG/\nhttps://www.tiktok.com/@pulso/video/1', collab: '@MariVabo', quando: '2026-10-29T18:30' }, { from: `/cortes/${c}` });
    const pub = await one('SELECT * FROM episode_publications WHERE clip_id = $1', [c]);
    assert.equal(r.location, `/social/publicacoes/${pub.id}`);
    assert.equal(pub.status, 'publicado'); assert.equal(pub.title, 'Corte emergência'); assert.equal(pub.description, 'Legenda do corte');
    assert.deepEqual(pub.platforms, ['instagram', 'tiktok']);
    assert.ok(pub.results.every((x) => x.ok && x.manual)); assert.equal(pub.results[0].url, 'https://www.instagram.com/reel/EMG/');
    assert.deepEqual(pub.options.instagram.collaborators, ['marivabo']); assert.equal(pub.options.manual, true);
    assert.equal(new Date(pub.created_at).toISOString(), new Date('2026-10-29T18:30:00-03:00').toISOString());
    const page = (await as.gestao.get(`/social/publicacoes/${pub.id}`)).text;
    assert.match(page, /por fora, pelo app da rede/); assert.match(page, /Postado por fora · registrado por gestao/);

    const portal = require('../src/services/guestPortal');
    const content = await portal.content(await portal.byId(g));
    assert.ok(content.collab.some((p) => p.id === pub.id), 'entra como collab no portal');
    assert.ok(!content.exclusive.some((x) => x.id === c), 'não é mais exclusivo');
  });

  it('rede que falhou: registrar o link postado por fora tira a nova tentativa e fecha a publicação', async () => {
    const c = await clip('Corte com falha');
    const results = [{ platform: 'instagram', ok: false, error: 'falhou', retry_at: new Date(Date.now() + 3600_000).toISOString(), hint: 'Nova tentativa' }, { platform: 'youtube', ok: true, url: 'https://youtube.com/shorts/x' }];
    const pub = await one("INSERT INTO episode_publications (episode_id, clip_id, platforms, title, status, media, results, retry_at, error) VALUES ($1, $2, '{instagram,youtube}', 'Corte com falha', 'parcial', 'video', $3, now() + interval '1 hour', 'x') RETURNING id", [ep, c, JSON.stringify(results)]);
    let page = (await as.gestao.get(`/social/publicacoes/${pub.id}`)).text;
    assert.match(page, /postei por fora/); assert.match(page, /id="modal-por-fora"/);

    await as.gestao.act(`/social/publicacoes/${pub.id}/por-fora`, { platform: 'instagram', url: 'https://www.tiktok.com/x' }, { from: `/social/publicacoes/${pub.id}` });
    assert.equal((await one('SELECT status FROM episode_publications WHERE id = $1', [pub.id])).status, 'parcial', 'link de outra rede não vale');

    await as.gestao.act(`/social/publicacoes/${pub.id}/por-fora`, { platform: 'instagram', url: 'https://www.instagram.com/reel/OK/' }, { from: `/social/publicacoes/${pub.id}` });
    const saved = await one('SELECT * FROM episode_publications WHERE id = $1', [pub.id]);
    assert.equal(saved.status, 'publicado'); assert.equal(saved.retry_at, null); assert.equal(saved.error, null);
    const ig = saved.results.find((x) => x.platform === 'instagram');
    assert.equal(ig.ok, true); assert.equal(ig.manual, true); assert.equal(ig.url, 'https://www.instagram.com/reel/OK/');
    page = (await as.gestao.get(`/social/publicacoes/${pub.id}`)).text;
    assert.match(page, /Postado por fora/); assert.doesNotMatch(page, /postei por fora/);
    assert.equal((await as.editor.act(`/social/publicacoes/${pub.id}/por-fora`, { platform: 'x', url: 'https://x.com/a' }, { from: '/' })).status, 403);
  });
});
