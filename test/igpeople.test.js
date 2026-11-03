const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const ig = require('../src/services/igPeople');
const up = require('../src/services/uploadPost');
const zn = require('../src/services/zernio');

describe('Instagram: collab e marcação na publicação', () => {
  const as = {}; const u = {}; let app; let ep; let cover; let cover2;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora']]) { u[k] = await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    const [g] = await q("INSERT INTO guests (name, instagram, profile, status) VALUES ('Dra. Lia Prado', '@Lia.Prado', 'medico', 'gravado') RETURNING id");
    await q("INSERT INTO guests (name, instagram, profile, status) VALUES ('Bruno Lima', 'instagram.com/brunolima_', 'medico', 'prospect'), ('Sem Insta', NULL, 'medico', 'prospect')");
    [ep] = await q("INSERT INTO episodes (number, title, status, guest_id) VALUES (21, 'Conversa com Lia', 'publicado', $1) RETURNING *", [g.id]);
    [cover] = await q("INSERT INTO episode_covers (episode_id, kind, position, spec, storage_key, mime, width, height, size_bytes) VALUES ($1, 'post_quote', 0, '{}', 'pp/capas/a.jpg', 'image/jpeg', 1080, 1350, 1000) RETURNING *", [ep.id]);
    [cover2] = await q("INSERT INTO episode_covers (episode_id, kind, position, spec, storage_key, mime, width, height, size_bytes) VALUES ($1, 'post_split', 0, '{}', 'pp/capas/b.jpg', 'image/jpeg', 1080, 1350, 1000) RETURNING *", [ep.id]);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('limpa o @ (arroba, maiúsculas, link do perfil) e recusa o que não é um @ válido', () => {
    assert.equal(ig.clean('@Lia.Prado'), 'lia.prado'); assert.equal(ig.clean('https://www.instagram.com/brunolima_/'), 'brunolima_');
    for (const bad of ['a b', 'com-hífen', '.ponto', 'dois..pontos', 'x'.repeat(31), '']) assert.equal(ig.clean(bad), '', bad);
  });

  it('regras: até 3 collabs, sem repetir, nada em story nem sem o Instagram marcado; foto sem posição ganha uma', () => {
    const p = (body, o) => ig.parse(body, { platforms: ['instagram'], ...o });
    assert.deepEqual(p({ ig_collab: ['@A', 'a', 'b'], ig_tag: 'c' }).instagram, { collaborators: ['a', 'b'], tags: [{ username: 'c' }] }, 'vídeo: marcação só com o @');
    assert.match(p({ ig_collab: ['a', 'b', 'c', 'd'] }).error, /no máximo 3/);
    assert.match(p({ ig_collab: ['ok', 'não vale'] }).error, /não é um @ válido/);
    assert.equal(p({ ig_collab: 'a' }, { media: 'story' }).instagram, null, 'story: o Instagram não aceita collab');
    assert.equal(ig.parse({ ig_collab: 'a' }, { platforms: ['tiktok'] }).instagram, null, 'sem Instagram marcado: ignora');
    const photo = p({ ig_tag: ['x|0.2|0.3', 'y', 'z||'] }, { media: 'imagem' }).instagram.tags;
    assert.deepEqual(photo[0], { username: 'x', x: 0.2, y: 0.3 });
    assert.deepEqual(photo.slice(1).map((t) => [t.x, t.y]), [[0.333, 0.85], [0.667, 0.85]], 'sem posição: distribui na base da imagem');
    assert.equal(p({ ig_tag: 'q|7|-2' }, { media: 'imagem' }).instagram.tags[0].x, 1, 'posição fora da imagem é ajustada');
  });

  it('sugestões: o convidado do episódio primeiro, depois convidados com @ e perfis já usados; busca por nome ou @', async () => {
    const all = await ig.suggest({ episodeId: ep.id });
    assert.deepEqual(all[0], { handle: 'lia.prado', name: 'Dra. Lia Prado', kind: 'convidado do episódio' });
    assert.ok(all.some((s) => s.handle === 'brunolima_' && s.kind === 'convidado'));
    assert.equal(all.filter((s) => s.handle === 'lia.prado').length, 1, 'sem repetir');
    assert.deepEqual((await ig.suggest({ q: 'brun' })).map((s) => s.handle), ['brunolima_']);
    assert.deepEqual((await ig.suggest({ q: 'Lia' })).map((s) => s.handle), ['lia.prado'], 'acha pelo nome');
    await q("INSERT INTO episode_publications (episode_id, platforms, title, status, media, options) VALUES ($1, '{instagram}', 'x', 'publicado', 'imagem', $2)", [ep.id, JSON.stringify({ instagram: { collaborators: ['marca.parceira'], tags: [{ username: 'fotografo.pulso', x: 0.5, y: 0.5 }] } })]);
    const used = await ig.suggest({ q: 'o' });
    assert.ok(used.some((s) => s.handle === 'fotografo.pulso' && s.kind === 'já usado'));
    const r = await as.prod.get(`/social/instagram/sugestoes?q=marca&episodio=${ep.id}`);
    assert.deepEqual(JSON.parse(r.text).items.map((s) => s.handle), ['marca.parceira']);
  });

  it('Upload-Post: collaborators e user_tags (vídeo com @, foto com posição em JSON)', () => {
    const insta = { collaborators: ['lia.prado', 'marca'], tags: [{ username: 'ana', x: 0.2, y: 0.4 }] };
    const v = up.buildFields({ id: 1, kind: 'clip', platforms: ['instagram'], title: 't', description: 'd', videoUrl: 'https://v', instagram: { ...insta, tags: [{ username: 'ana' }] } });
    assert.deepEqual(v.filter(([k]) => ['collaborators', 'user_tags'].includes(k)), [['collaborators', 'lia.prado,marca'], ['user_tags', '@ana']]);
    const f = up.buildPhotoFields({ id: 2, media: 'imagem', platforms: ['instagram'], title: 't', description: 'd', photoUrls: ['https://p'], instagram: insta });
    assert.deepEqual(JSON.parse(f.find(([k]) => k === 'user_tags')[1]), [{ username: 'ana', x: 0.2, y: 0.4 }]);
    const story = up.buildPhotoFields({ id: 3, media: 'story', platforms: ['instagram'], title: '', description: '', photoUrls: ['https://p'], instagram: insta });
    assert.ok(!story.some(([k]) => k === 'collaborators'), 'story sem collab');
    assert.ok(!up.buildFields({ id: 4, kind: 'clip', platforms: ['tiktok'], title: 't', videoUrl: 'https://v', instagram: insta }).some(([k]) => k === 'collaborators'), 'só no Instagram');
  });

  it('Zernio: platformSpecificData.collaborators e userTags (carrossel marca a primeira imagem)', () => {
    const insta = { collaborators: ['lia.prado'], tags: [{ username: 'ana', x: 0.2, y: 0.4 }] };
    const v = zn.buildPost({ id: 1, kind: 'clip', platforms: ['instagram', 'tiktok'], title: 't', description: 'd', videoUrl: 'https://v', instagram: insta });
    const igv = v.platforms.find((p) => p.platform === 'instagram').platformSpecificData;
    assert.deepEqual(igv.collaborators, ['lia.prado']); assert.deepEqual(igv.userTags, [{ username: 'ana' }]);
    assert.equal(v.platforms.find((p) => p.platform === 'tiktok').platformSpecificData.collaborators, undefined);
    const ph = zn.buildPhotoPost({ id: 2, media: 'carrossel', platforms: ['instagram'], title: 't', description: 'd', photoUrls: ['https://a', 'https://b'], instagram: insta });
    assert.deepEqual(ph.platforms[0].platformSpecificData.userTags, [{ username: 'ana', x: 0.2, y: 0.4, mediaIndex: 0 }]);
    const st = zn.buildPhotoPost({ id: 3, media: 'story', platforms: ['instagram'], title: '', description: '', photoUrls: ['https://a'], instagram: insta });
    assert.equal(st.platforms[0].platformSpecificData.collaborators, undefined);
  });

  it('pela tela "Novo post": o pedido guarda collab e marcação e o envio leva os campos para a rede', async () => {
    const page = (await as.gestao.get('/social/novo?tipo=imagem')).text;
    assert.match(page, /data-ig-people/); assert.match(page, /data-photo="1"/); assert.match(page, /static\/igpeople\.js/);
    assert.match(page, new RegExp(`value="${cover.id}" data-episode="${ep.id}"`), 'cada item diz de qual episódio é (para sugerir o convidado)');
    const r = await as.gestao.act('/social/publicar', { tipo: 'imagem', cover_ids: String(cover.id), platforms: 'instagram', title: 'Frase', description: 'Legenda', confirmar: '1', ig_collab: ['@lia.prado', 'marca.parceira'], ig_tag: ['ana.foto|0.25|0.6'] }, { from: '/social/novo' });
    assert.equal(r.status, 302, r.text);
    const [pub] = await q('SELECT * FROM episode_publications WHERE cover_ids = $1 ORDER BY id DESC LIMIT 1', [[cover.id]]);
    assert.deepEqual(pub.options.instagram, { collaborators: ['lia.prado', 'marca.parceira'], tags: [{ username: 'ana.foto', x: 0.25, y: 0.6 }] });
    assert.equal(pub.status, 'simulado');
    assert.ok(pub.options.fields.includes('collaborators') && pub.options.fields.includes('user_tags'), 'o pedido montado leva os campos do Instagram');
    const shown = (await as.gestao.get(`/social/publicacoes/${pub.id}`)).text;
    assert.match(shown, /Collab no Instagram/); assert.match(shown, /@marca\.parceira/); assert.match(shown, /@ana\.foto/);
    // mais de 3 collabs: recusa com a explicação, nada é criado
    const before = (await q('SELECT count(*)::int n FROM episode_publications'))[0].n;
    const bad = await as.gestao.act('/social/publicar', { tipo: 'imagem', cover_ids: String(cover2.id), platforms: 'instagram', title: 'F', description: 'L', confirmar: '1', ig_collab: ['a1', 'a2', 'a3', 'a4'] }, { from: '/social/novo' });
    assert.equal(bad.status, 302); assert.equal((await q('SELECT count(*)::int n FROM episode_publications'))[0].n, before);
  });

  it('a produtora pede com collab: a gestão vê no pedido e, ao aprovar, sai com os mesmos perfis', async () => {
    await as.prod.act('/social/publicar', { tipo: 'imagem', cover_ids: String(cover2.id), platforms: 'instagram', title: 'Pedido', description: 'Legenda', ig_collab: 'lia.prado' }, { from: '/social/novo' });
    const [pub] = await q("SELECT * FROM episode_publications WHERE status = 'revisao' ORDER BY id DESC LIMIT 1");
    assert.deepEqual(pub.options.instagram.collaborators, ['lia.prado']);
    const out = await require('../src/services/publishing').approve(pub.id, u.gestao);
    assert.equal(out.status, 'simulado'); assert.ok(out.options.fields.includes('collaborators'));
  });
});
