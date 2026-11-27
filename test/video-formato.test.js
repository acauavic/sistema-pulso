// O formato do vídeo esconde o que não se aplica: Spotify, capa do Spotify e os vídeos do convidado são do podcast.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('vídeo: o formato esconde o que não se aplica', () => {
  let app; let c; let sara; let video; let episodio;

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    sara = await h.createUser({ name: 'Sara Super', email: 's@t.com', role: 'superadmin', projects: [1, 2] });
    await h.db.query("UPDATE projects SET modules = modules || '{\"producao\": true}'::jsonb WHERE id = 2");
    await require('../src/services/projects').refresh(true);
    c = h.client(app.base); await c.login('s@t.com');
    ({ rows: [video] } = await h.db.query("INSERT INTO episodes (title, number, project_id, status, format) VALUES ('Vídeo sem convidado', 1, 2, 'em_finalizacao', 'video') RETURNING *"));
    const { rows: [g] } = await h.db.query("INSERT INTO guests (name, status, project_id) VALUES ('Dra. Pulso', 'gravado', 1) RETURNING id");
    ({ rows: [episodio] } = await h.db.query("INSERT INTO episodes (title, number, project_id, status, guest_id) VALUES ('Episódio do Pulso', 40, 1, 'em_finalizacao', $1) RETURNING *", [g.id]));
    // com a ficha preenchida, as abas das peças aparecem (sem ela, a tela é só o convite para gerar)
    for (const id of [video.id, episodio.id]) {
      await h.db.query(`INSERT INTO episode_metadata (episode_id, cover_sheet) VALUES ($1, '{"guest": "Quem", "tag": "credencial", "axis": "Histórias"}'::jsonb)`, [id]);
    }
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('no vídeo não há Spotify nem vídeos do convidado', async () => {
    const page = (await c.get(`/episodios/${video.id}`)).text;
    assert.doesNotMatch(page, /data-tab-btn="spotify"/); assert.doesNotMatch(page, /data-pane-id="spotify"/);
    assert.doesNotMatch(page, /data-tab-btn="videos"/); assert.doesNotMatch(page, /data-pane-id="videos"/);
    assert.doesNotMatch(page, /data-tab-btn="sp"/); assert.doesNotMatch(page, /name="sp_title"/);
    assert.doesNotMatch(page, /name="spotify_url"/);
    assert.match(page, /data-tab-btn="youtube"/, 'o YouTube continua');
    assert.match(page, /name="youtube_url"/);
  });

  it('no episódio de podcast tudo continua como sempre', async () => {
    const page = (await c.get(`/episodios/${episodio.id}`)).text;
    for (const re of [/data-tab-btn="spotify"/, /data-pane-id="spotify"/, /data-tab-btn="videos"/, /data-tab-btn="sp"/, /name="sp_title"/, /name="spotify_url"/]) {
      assert.match(page, re, String(re));
    }
  });

  it('as rotas do convidado recusam o vídeo sem convidado', async () => {
    const videos = require('../src/services/guestVideos');
    const out = await videos.request(video.id, 'teaser', sara.id);
    assert.match(out.error, /vídeos de lançamento são do convidado/);
    const ok = await videos.request(episodio.id, 'teaser', sara.id);
    assert.ok(!ok.error || !/são do convidado/.test(ok.error), ok.error);
  });

  it('a ficha das capas do vídeo não tenta montar a capa do Spotify', async () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src/services/coverPieces.js'), 'utf8');
    assert.match(src, /const isPodcast = ctx\.episode\.format !== 'video';/);
    assert.match(src, /const kinds = isPodcast \? \['youtube_thumb', 'spotify_cover'\] : \['youtube_thumb'\];/);
    assert.match(src, /if \(isPodcast && !kept\.some/);
  });
});
