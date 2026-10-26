const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('Conteúdo > Posts: selecionar e baixar vários posts gerados', () => {
  let app; let gestao; let epMany; let epOne;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const cover = (ep, kind, pos, extra = {}) => q(
    "INSERT INTO episode_covers (episode_id, kind, group_key, position, label, spec, storage_key, mime, width, height, size_bytes, auto) VALUES ($1,$2,$3,$4,$5,'{}',$6,'image/jpeg',1080,1350,$7,true) RETURNING id",
    [ep, kind, extra.group || 'g1', pos, extra.label || `Opção ${pos + 1}`, `pp/capas/${ep}-${kind}-${pos}.jpg`, extra.size || 400000]).then((r) => r[0].id);

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    await h.createUser({ name: 'Gil', email: 'g@t.com', role: 'gestao' }); gestao = h.client(app.base); await gestao.login('g@t.com');
    [{ id: epMany }] = await q("INSERT INTO episodes (number, title, status) VALUES (14, 'Ep com muitos posts', 'gravado') RETURNING id");
    [{ id: epOne }] = await q("INSERT INTO episodes (number, title, status) VALUES (15, 'Ep com um post', 'gravado') RETURNING id");
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('com 2+ imagens: Selecionar e Baixar tudo; cada cartão leva o link de baixar e o nome do arquivo; a imagem marca no modo seleção', async () => {
    const a = await cover(epMany, 'post_quote', 0); await cover(epMany, 'post_quote', 1); const c3 = await cover(epMany, 'carousel', 2, { group: 'car', label: 'Slide 3', size: 123456 });
    const page = (await gestao.get(`/conteudo?vista=posts&episodio=${epMany}`)).text;
    const sec = page.match(/<section class="card top-gap" data-dl>[\s\S]*?<\/section>/)[0];
    assert.match(sec, /data-dl-select/); assert.match(sec, /data-dl-everything/); assert.match(sec, /Baixa as 3 imagens/);
    assert.match(sec, /data-dl-bar[^>]*hidden/, 'a barra só aparece depois de Selecionar');
    assert.equal((sec.match(/data-dl-item/g) || []).length, 3);
    assert.match(sec, new RegExp(`data-dl-item data-href="/capas/${a}/imagem\\?baixar=1" data-name="ep014-post-quote-1\\.jpg" data-bytes="400000"`));
    assert.match(sec, new RegExp(`data-href="/capas/${c3}/imagem\\?baixar=1" data-name="ep014-carousel-3\\.jpg" data-bytes="123456"`));
    assert.match(sec, /<a href="\/capas\/\d+\/imagem" target="_blank" rel="noopener" data-dl-pick>/, 'a imagem abre em outra aba, mas no modo seleção marca o cartão');
    assert.match(sec, /Baixar<\/a>/, 'o Baixar de cada cartão continua');
    assert.doesNotMatch(page, /data-bulk/);
    assert.ok(page.indexOf('/static/baixar.js') > 0 && page.indexOf('/static/baixar.js') < page.indexOf('/static/producao.js'));
  });

  it('com uma imagem só, nada de selecionar (o Baixar do cartão basta)', async () => {
    await cover(epOne, 'post_quote', 0);
    const page = (await gestao.get(`/conteudo?vista=posts&episodio=${epOne}`)).text;
    assert.match(page, /Ep com um post/);
    assert.doesNotMatch(page, /data-dl-select|data-dl-everything|data-dl-item/);
  });
});
