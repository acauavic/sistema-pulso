const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const ig = require('../src/services/igPeople');
const up = require('../src/services/uploadPost');
const zn = require('../src/services/zernio');
const ost = require('../src/services/outstand');

describe('Reel de teste no Instagram (trial reel)', () => {
  const as = {}; let app; let ep; let clip;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    await h.createUser({ name: 'Gestão', email: 'gestao@t.com', role: 'gestao' });
    as.gestao = h.client(app.base); await as.gestao.login('gestao@t.com');
    [ep] = await q("INSERT INTO episodes (number, title, status) VALUES (30, 'Conversa de teste', 'publicado') RETURNING *");
    h.b2Store.set('pp/corte-trial.mp4', { body: Buffer.alloc(3000, 7), contentType: 'video/mp4' });
    [clip] = await q("INSERT INTO episode_clips (title, source, status, episode_id, storage_key, size_bytes, content_type, width, height, duration_ms) VALUES ('Corte teste', 'upload', 'pronto', $1, 'pp/corte-trial.mp4', 3000, 'video/mp4', 1080, 1920, 34000) RETURNING *", [ep.id]);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('lê o formulário: só em Reel, "libera sozinho" é o padrão, e recusa collab junto', () => {
    const p = (body, o) => ig.parse(body, { platforms: ['instagram'], media: 'video', ...o });
    assert.deepEqual(p({ ig_trial: '1' }).instagram, { collaborators: [], tags: [], trial: 'auto' });
    assert.equal(p({ ig_trial: '1', ig_trial_modo: 'manual' }).instagram.trial, 'manual');
    assert.equal(p({ ig_trial: '1', ig_trial_modo: 'qualquer' }).instagram.trial, 'auto', 'valor estranho = libera sozinho');
    assert.equal(p({}).instagram, null, 'sem marcar: Reel normal');
    assert.equal(p({ ig_trial: '1' }, { media: 'imagem' }).instagram, null, 'imagem não vira Reel de teste');
    assert.equal(p({ ig_trial: '1' }, { media: 'story' }).instagram, null);
    assert.equal(ig.parse({ ig_trial: '1' }, { platforms: ['tiktok'], media: 'video' }).instagram, null, 'sem Instagram: ignora');
    assert.match(p({ ig_trial: '1', ig_collab: 'lia.prado' }).error, /Reel de teste não aceita collab/);
    assert.deepEqual(p({ ig_trial: '1', ig_tag: 'ana' }).instagram.tags, [{ username: 'ana' }], 'a marcação continua');
  });

  it('cada provedor recebe o campo dele (e o Reel de teste não vai ao feed)', () => {
    const base = { id: 1, kind: 'clip', platforms: ['instagram', 'tiktok'], title: 't', description: 'd', videoUrl: 'https://v', coverUrl: 'https://c' };
    const accounts = { instagram: { accountId: 'IG1' }, tiktok: { accountId: 'TT1' } };
    // Outstand
    assert.deepEqual(ost.buildPost({ ...base, accounts, instagram: { collaborators: [], tags: [], trial: 'manual' } }).instagram.trialReel, { graduationStrategy: 'MANUAL' });
    assert.deepEqual(ost.buildPost({ ...base, accounts, instagram: { collaborators: [], tags: [], trial: 'auto' } }).instagram.trialReel, { graduationStrategy: 'SS_PERFORMANCE' });
    assert.equal(ost.buildPost({ ...base, accounts }).instagram?.trialReel, undefined, 'Reel normal: sem o campo');
    assert.equal(ost.buildPhotoPost({ id: 2, media: 'imagem', platforms: ['instagram'], title: 't', description: 'd', photoUrls: ['https://p'], accounts, instagram: { collaborators: [], tags: [], trial: 'auto' } }).instagram?.trialReel, undefined, 'foto nunca');
    // Zernio
    const z = (instagram) => zn.buildPost({ ...base, instagram }).platforms.find((p) => p.platform === 'instagram').platformSpecificData;
    assert.deepEqual(z({ collaborators: [], tags: [], trial: 'auto' }).trialParams, { graduationStrategy: 'SS_PERFORMANCE' });
    assert.equal(z({ collaborators: [], tags: [], trial: 'auto' }).shareToFeed, undefined);
    assert.equal(z(null).shareToFeed, true); assert.equal(z(null).trialParams, undefined);
    assert.equal(zn.buildPost({ ...base, instagram: { trial: 'auto' } }).platforms.find((p) => p.platform === 'tiktok').platformSpecificData?.trialParams, undefined, 'só no Instagram');
    // Upload-Post
    const f = (instagram) => up.buildFields({ ...base, instagram });
    assert.deepEqual(f({ collaborators: [], tags: [], trial: 'manual' }).filter(([k]) => ['share_mode', 'share_to_feed'].includes(k)), [['share_mode', 'TRIAL_REELS_DONT_SHARE_TO_FOLLOWERS']]);
    assert.deepEqual(f({ collaborators: [], tags: [], trial: 'auto' }).find(([k]) => k === 'share_mode'), ['share_mode', 'TRIAL_REELS_SHARE_TO_FOLLOWERS_IF_LIKED']);
    assert.deepEqual(f(null).find(([k]) => k === 'share_to_feed'), ['share_to_feed', 'true']);
    assert.ok(!f(null).some(([k]) => k === 'share_mode'));
  });

  it('o formulário do corte mostra a opção, e o collab sai de cena quando ela é marcada', async () => {
    const ejs = require('ejs'); const { icon } = require('../src/utils/icons');
    const part = (locals) => ejs.renderFile(require('path').join(__dirname, '../src/views/partials/ig-people.ejs'), { icon, assetV: 't', ...locals });
    const vid = await part({ photo: false });
    assert.match(vid, /name="ig_trial" value="1"/); assert.match(vid, /data-igp-trial-mode hidden/, 'a escolha só abre depois de marcar');
    assert.match(vid, /value="auto" checked/); assert.match(vid, /data-igp-collab-wrap/);
    assert.doesNotMatch(await part({ photo: true }), /ig_trial/, 'imagem não tem Reel de teste');
    const again = await part({ photo: false, initial: { collaborators: [], tags: [], trial: 'manual' } });
    assert.match(again, /data-igp-trial-on checked/, 'no reenvio vem marcado'); assert.match(again, /value="manual" checked/);
    assert.match((await as.gestao.get(`/cortes/${clip.id}`)).text, /name="ig_trial"/);
  });

  it('publicar o corte como Reel de teste: guarda, envia e mostra a marca depois de publicado', async () => {
    const r = await as.gestao.act(`/cortes/${clip.id}/publicar`, { title: 'Corte teste', description: 'Legenda', platforms: ['instagram', 'tiktok'], ig_trial: '1', ig_trial_modo: 'manual', confirmar: '1' }, { from: `/cortes/${clip.id}` });
    assert.equal(r.status, 302, r.text);
    const [pub] = await q('SELECT * FROM episode_publications WHERE clip_id = $1 ORDER BY id DESC LIMIT 1', [clip.id]);
    assert.equal(pub.options.instagram.trial, 'manual');
    assert.ok(pub.options.fields.includes('share_mode'), 'o pedido montado leva o Reel de teste');
    // a marca aparece na publicação (no "Onde saiu" e na linha do Instagram), na lista, no corte e no quadro do Conteúdo
    await q("UPDATE episode_publications SET status = 'publicado', results = $2 WHERE id = $1", [pub.id, JSON.stringify([{ platform: 'instagram', ok: true, url: 'https://www.instagram.com/reel/abc/' }, { platform: 'tiktok', ok: true }])]);
    const page = (await as.gestao.get(`/social/publicacoes/${pub.id}`)).text;
    assert.equal((page.match(/badge b-trial/g) || []).length, 2, 'no resumo e na linha do Instagram');
    assert.match(page, /a equipe libera no app/); assert.match(page, /compartilhar com os seguidores/);
    assert.match((await as.gestao.get('/social/publicacoes')).text, /b-trial[^>]*>Reel de teste/);
    assert.match((await as.gestao.get(`/cortes/${clip.id}`)).text, /Instagram <span class="badge b-trial">Reel de teste/);
    assert.match((await as.gestao.get('/conteudo')).text, /badge b-trial/);
  });

  it('collab junto com Reel de teste: recusa e nada é criado', async () => {
    const n = async () => (await q('SELECT count(*)::int n FROM episode_publications'))[0].n;
    const before0 = await n();
    const r = await as.gestao.act(`/cortes/${clip.id}/publicar`, { title: 'X', platforms: 'instagram', ig_trial: '1', ig_collab: 'lia.prado', confirmar: '1' }, { from: `/cortes/${clip.id}` });
    assert.equal(r.status, 302); assert.equal(await n(), before0);
  });
});
