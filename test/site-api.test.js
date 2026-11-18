// API pública do site (podcastpulso.com): campos novos, leitura e formulários.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { NOTIFICATION_TYPES } = require('../src/constants');
const notify = require('../src/services/notify');

describe('Site: campos novos', () => {
  before(async () => { await h.resetDb(); });

  it('as colunas existem', async () => {
    await h.db.query('SELECT premiere_on, origin, utm FROM guests');
    await h.db.query('SELECT origin, utm, site_hidden, site_official FROM sponsors');
  });

  it('dois patrocinadores oficiais ao mesmo tempo são recusados', async () => {
    await h.db.query(`INSERT INTO sponsors (company, site_official) VALUES ('A', true)`);
    await assert.rejects(h.db.query(`INSERT INTO sponsors (company, site_official) VALUES ('B', true)`), { code: '23505' });
    await h.db.query(`INSERT INTO sponsors (company, site_official) VALUES ('C', false)`);
  });

  it('o aviso "Pedidos pelo site" existe', () => {
    assert.equal(NOTIFICATION_TYPES.site.label, 'Pedidos pelo site');
  });

  it('o aviso "site" é gravado e vai para a gestão por padrão', async () => {
    const g = await h.createUser({ name: 'Gil Gestão', email: 'g@t.com', role: 'gestao' });
    const { rows } = await h.db.query(`SELECT roles FROM notification_settings WHERE type = 'site'`);
    assert.deepEqual([...rows[0].roles].sort(), ['gestao', 'superadmin']);
    const out = await notify.notify({ type: 'site', broadcast: true, title: 'Novo pedido pelo site' });
    assert.equal(out.length, 1);
    const { rows: n } = await h.db.query(`SELECT user_id, type FROM notifications WHERE type = 'site'`);
    assert.equal(n.length, 1); assert.equal(String(n[0].user_id), String(g.id));
  });
});

describe('Site: patrocinador oficial e esconder do site', () => {
  let app; const as = {}; let a; let b;
  const flags = async (id) => (await h.db.query('SELECT site_official, site_hidden FROM sponsors WHERE id = $1', [id])).rows[0];
  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    await h.createUser({ name: 'Gil Gestão', email: 'gestao@t.com', role: 'gestao' });
    await h.createUser({ name: 'Edu Editor', email: 'edit@t.com', role: 'editor_video' });
    for (const [k, email] of [['gestao', 'gestao@t.com'], ['editor', 'edit@t.com']]) {
      as[k] = h.client(app.base);
      assert.equal((await as[k].login(email)).status, 302, `login ${k}`);
    }
    a = (await h.db.query(`INSERT INTO sponsors (company, stage) VALUES ('Marca A', 'ativo') RETURNING id`)).rows[0].id;
    b = (await h.db.query(`INSERT INTO sponsors (company, stage) VALUES ('Marca B', 'ativo') RETURNING id`)).rows[0].id;
  });
  after(async () => { await app.close?.(); });

  it('marcar um oficial desmarca o anterior', async () => {
    let r = await as.gestao.act(`/patrocinadores/${a}/site`, { official: 'on' });
    assert.equal(r.status, 302); assert.equal(r.location, `/patrocinadores/${a}`);
    assert.equal((await flags(a)).site_official, true);
    r = await as.gestao.act(`/patrocinadores/${b}/site`, { official: 'on' });
    assert.equal(r.status, 302);
    assert.equal((await flags(a)).site_official, false);
    assert.equal((await flags(b)).site_official, true);
    r = await as.gestao.act(`/patrocinadores/${b}/site`, {});
    assert.equal((await flags(b)).site_official, false);
  });

  it('esconder do site grava site_hidden', async () => {
    await as.gestao.act(`/patrocinadores/${a}/site`, { hidden: 'on' });
    assert.deepEqual(await flags(a), { site_official: false, site_hidden: true });
    await as.gestao.act(`/patrocinadores/${a}/site`, {});
    assert.equal((await flags(a)).site_hidden, false);
    const { rows } = await h.db.query(`SELECT 1 FROM sponsor_events WHERE sponsor_id = $1 AND type = 'site'`, [a]);
    assert.ok(rows.length >= 2);
  });

  it('quem só lê patrocinadores recebe 403', async () => {
    const r = await as.editor.act(`/patrocinadores/${a}/site`, { official: 'on' });
    assert.equal(r.status, 403);
    assert.equal((await flags(a)).site_official, false);
  });

  it('a página mostra os dois interruptores e a frase', async () => {
    const r = await as.gestao.get(`/patrocinadores/${a}`);
    assert.equal(r.status, 200);
    assert.match(r.text, /Patrocinador oficial no site/);
    assert.match(r.text, /Esconder do site/);
    assert.match(r.text, /O site mostra a logo das marcas que fecharam ou patrocinam\./);
    assert.equal((r.text.match(/role="switch"/g) || []).length >= 2, true);
    assert.match(r.text, /action="\/patrocinadores\/\d+\/site"/);
  });
});

after(async () => { await h.db.close(); });

describe('Site: estreia prevista do convidado', () => {
  let app; let as; let gid;
  const premiere = async (id) => (await h.db.query('SELECT premiere_on::text AS p FROM guests WHERE id = $1', [id])).rows[0].p;
  const form = (extra = {}) => ({
    name: 'Dra. Estreia', instagram: '@dra.estreia', profile: 'medico', status: 'agendado', email: 'e@t.com',
    proposed_at: '2026-12-10T14:00', scheduled_studio: '1', scheduled_hosts: '1', scheduled_guest: '1', ...extra,
  });
  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    await h.createUser({ name: 'Gil Gestão', email: 'gestao@t.com', role: 'gestao' });
    as = h.client(app.base);
    assert.equal((await as.login('gestao@t.com')).status, 302);
    gid = (await h.db.query(`INSERT INTO guests (name, instagram, profile, status) VALUES ('Dra. Estreia', 'dra.estreia', 'medico', 'prospect') RETURNING id`)).rows[0].id;
  });
  after(async () => { await app.close?.(); });

  it('salva a estreia prevista do convidado agendado', async () => {
    const r = await as.act(`/convidados/${gid}`, form({ premiere_on: '2026-12-20' }), { from: `/convidados/${gid}/editar` });
    assert.equal(r.status, 302, r.text.slice(0, 300));
    assert.equal(await premiere(gid), '2026-12-20');
    // salvar de novo sem mexer na data mantém o valor (o formulário devolve o campo)
    const page = await as.get(`/convidados/${gid}/editar`);
    assert.match(page.text, /name="premiere_on"[^>]*value="2026-12-20"/);
    assert.match(page.text, /Estreia prevista/);
    assert.match(page.text, /Aparece na agenda do site/);
    assert.match(page.text, /data-stages="agendado"/);
    // data inválida é recusada; vazio limpa
    const bad = await as.act(`/convidados/${gid}`, form({ premiere_on: '2026-13-45' }), { from: `/convidados/${gid}/editar` });
    assert.equal(bad.status, 400);
    assert.equal(await premiere(gid), '2026-12-20');
    await as.act(`/convidados/${gid}`, form({ premiere_on: '' }), { from: `/convidados/${gid}/editar` });
    assert.equal(await premiere(gid), null);
  });

  it('o episódio nasce com aired_on = premiere_on do convidado', async () => {
    await as.act(`/convidados/${gid}`, form({ premiere_on: '2026-12-20' }), { from: `/convidados/${gid}/editar` });
    const r = await as.act(`/convidados/${gid}`, form({ premiere_on: '2026-12-20', status: 'gravado', proposed_at: '2026-11-01T14:00' }), { from: `/convidados/${gid}/editar` });
    assert.equal(r.status, 302, r.text.slice(0, 300));
    const { rows } = await h.db.query('SELECT aired_on::text AS a FROM episodes WHERE guest_id = $1', [gid]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].a, '2026-12-20');
  });

  it('sem estreia prevista o episódio nasce sem aired_on', async () => {
    const production = require('../src/services/production');
    const g2 = (await h.db.query(`INSERT INTO guests (name, instagram, profile, status, premiere_on) VALUES ('Sem Estreia', 'sem.estreia', 'medico', 'gravado', NULL) RETURNING id`)).rows[0].id;
    const ep = await production.createEpisode({ title: 'X', guestId: g2 });
    const { rows } = await h.db.query('SELECT aired_on FROM episodes WHERE id = $1', [ep.id]);
    assert.equal(rows[0].aired_on, null);
  });
});

describe('Site: imagens assinadas', () => {
  const siteImages = require('../src/services/siteImages');
  let app; let guestId; let sponsorId; let coverId;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  const path = (u) => u.replace(h.config.appBaseUrl, '');
  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    guestId = (await h.db.query(`INSERT INTO guests (name) VALUES ('Dra. Foto') RETURNING id`)).rows[0].id;
    await h.db.query('UPDATE guests SET photo_key = $2 WHERE id = $1', [guestId, 'pp/site/foto.png']);
    h.b2Store.set('pp/site/foto.png', { body: png, contentType: 'image/png' });
    sponsorId = (await h.db.query(`INSERT INTO sponsors (company) VALUES ('Marca L') RETURNING id`)).rows[0].id;
    await h.db.query(`INSERT INTO sponsor_files (sponsor_id, kind, storage_key, content_type) VALUES ($1, 'logo', 'pp/site/logo-velha.png', 'image/png')`, [sponsorId]);
    await h.db.query(`INSERT INTO sponsor_files (sponsor_id, kind, storage_key, content_type) VALUES ($1, 'logo', 'pp/site/logo.png', 'image/png')`, [sponsorId]);
    h.b2Store.set('pp/site/logo.png', { body: png, contentType: 'image/png' });
    const ep = (await h.db.query(`INSERT INTO episodes (title) VALUES ('Ep') RETURNING id`)).rows[0].id;
    coverId = (await h.db.query(`INSERT INTO episode_covers (episode_id, kind, spec, storage_key, mime, width, height, size_bytes) VALUES ($1, 'post_quote', '{}', 'pp/site/capa.png', 'image/png', 1, 1, 1) RETURNING id`, [ep])).rows[0].id;
    h.b2Store.set('pp/site/capa.png', { body: png, contentType: 'image/png' });
  });
  after(async () => { await app.close?.(); });

  const T0 = 1_800_000_000_000;
  it('signedUrl é absoluta e verify confere tipo, id e validade', () => {
    const u = new URL(siteImages.signedUrl('foto', 7, T0));
    assert.ok(siteImages.signedUrl('foto', 7).startsWith(`${h.config.appBaseUrl}/api/site/v1/imagem/foto/7?e=`));
    const e = u.searchParams.get('e'); const s = u.searchParams.get('s');
    assert.equal(siteImages.verify('foto', 7, e, s, T0), true);
    assert.equal(siteImages.verify('logo', 7, e, s, T0), false); // assinatura presa ao tipo
    assert.equal(siteImages.verify('foto', 8, e, s, T0), false); // e ao id
    assert.equal(siteImages.verify('foto', 7, e, s, T0 + 25 * 3600_000), false);
  });

  it('assinatura errada ou vencida dá 404', async () => {
    const ok = path(siteImages.signedUrl('foto', guestId));
    const c = h.client(app.base);
    const forged = ok.replace(/s=.{4}/, 's=AAAA');
    const old = path(siteImages.signedUrl('foto', guestId, Date.now() - 25 * 3600_000));
    const semAssinatura = `/api/site/v1/imagem/foto/${guestId}`;
    const outroId = ok.replace(`/foto/${guestId}`, `/foto/${guestId + 1}`);
    const outroTipo = ok.replace('/foto/', '/logo/');
    const bodies = [];
    for (const p of [forged, old, semAssinatura, outroId, outroTipo]) {
      const r = await c.get(p); assert.equal(r.status, 404, p); bodies.push(r.text);
    }
    assert.equal(new Set(bodies).size, 1); // não revela o motivo
  });

  it('foto assinada responde 200 com imagem', async () => {
    const r = await h.client(app.base).get(path(siteImages.signedUrl('foto', guestId)));
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^image\//);
    assert.match(r.headers.get('cache-control'), /public, max-age=3600/);
  });

  it('logo (a mais recente) e capa assinadas respondem 200', async () => {
    const c = h.client(app.base);
    const l = await c.get(path(siteImages.signedUrl('logo', sponsorId)));
    assert.equal(l.status, 200); assert.match(l.headers.get('content-type'), /^image\//);
    assert.match(l.headers.get('cache-control'), /public, max-age=3600/);
    const v = await c.get(path(siteImages.signedUrl('capa', coverId)));
    assert.equal(v.status, 200); assert.match(v.headers.get('content-type'), /^image\//);
  });

  it('sem imagem cadastrada dá 404', async () => {
    const c = h.client(app.base);
    assert.equal((await c.get(path(siteImages.signedUrl('foto', 999999)))).status, 404);
    assert.equal((await c.get(path(siteImages.signedUrl('logo', 999999)))).status, 404);
    assert.equal((await c.get(path(siteImages.signedUrl('capa', 999999)))).status, 404);
  });

  it('kind desconhecido dá 404', async () => {
    const c = h.client(app.base);
    const u = path(siteImages.signedUrl('foto', guestId)).replace('/foto/', '/video/');
    assert.equal((await c.get(u)).status, 404);
    assert.throws(() => siteImages.signedUrl('video', 1));
  });
});

describe('Site: leitura pública', () => {
  let app;
  const SITE = 'https://podcastpulso.com';
  const get = async (headers = { origin: SITE }) => {
    const r = await fetch(`${app.base}/api/site/v1/dados`, { headers });
    return { status: r.status, headers: r.headers, json: r.status === 200 ? await r.json() : null };
  };
  const day = (offset) => new Date(Date.now() + offset * 86400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const sponsor = async (company, stage, { logo = true, hidden = false, official = false, starts = null } = {}) => {
    const { rows: [s] } = await h.db.query(
      `INSERT INTO sponsors (company, stage, site_hidden, site_official, starts_on, website, contact_phone, contact_email, value_cents)
       VALUES ($1, $2, $3, $4, $5, 'marca.com.br', '11999990000', 'x@y.com', 500000) RETURNING id`, [company, stage, hidden, official, starts]);
    if (logo) await h.db.query(`INSERT INTO sponsor_files (sponsor_id, kind, storage_key, content_type) VALUES ($1, 'logo', 'pp/logo-${s.id}.png', 'image/png')`, [s.id]);
    return s.id;
  };
  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    const owner = await h.createUser({ name: 'Dona Owner', email: 'dona@t.com', role: 'gestao' });
    // convidados
    const g = async (name, status, extra = {}) => (await h.db.query(
      `INSERT INTO guests (name, instagram, status, phone, email, notes, owner_id, invite_token${Object.keys(extra).map((k) => `, ${k}`).join('')})
       VALUES ($1, $2, $3, '11999990000', 'x@y.com', 'nota secreta', $4, $5${Object.values(extra).map((v) => `, ${v}`).join('')}) RETURNING id`,
      [name, name.toLowerCase().replace(/\W/g, ''), status, owner.id, `tok${name.length}${status}`])).rows[0].id;
    const gEstreia = await g('Dra Estreia', 'gravado');
    await g('Dr Previsto', 'agendado', { premiere_on: `'${day(10)}'` });
    await g('Dra Gravacao', 'agendado', { proposed_at: "now() + interval '5 days'" });
    await g('Dr Perdido', 'perdido', { proposed_at: "now() + interval '5 days'", loss_reason: "'recusado'" });
    const gPub = await g('Dra Publicada', 'gravado');
    const gData = await g('Dr Data', 'gravado');
    // episódios
    await h.db.query(`INSERT INTO episodes (title, guest_id, status, aired_on) VALUES ('Estreia amanhã', $1, 'em_edicao', $2)`, [gEstreia, day(1)]);
    await h.db.query(`INSERT INTO episodes (title, guest_id, status, aired_on) VALUES ('Na data', $1, 'pronto_publicar', '2026-12-20')`, [gData]);
    await h.db.query(`INSERT INTO episodes (number, title, guest_id, status, aired_on, youtube_url, spotify_url, kit_featured)
                      VALUES (2, 'Mais novo', $1, 'publicado', '2026-11-10', 'https://youtu.be/abc123XYZ_-', 'https://open.spotify.com/intl-pt/episode/4rOoJ6Egrf8K2IrywzwOMk?si=x', true)`, [gPub]);
    await h.db.query(`INSERT INTO episodes (number, title, status, aired_on, youtube_url) VALUES (1, 'Mais velho', 'publicado', '2026-10-01', 'https://www.youtube.com/watch?v=OLD_id-1234&t=3')`);
    await h.db.query(`INSERT INTO episodes (number, title, status, aired_on) VALUES (3, 'Sem link', 'publicado', '2026-11-12')`);
    // patrocinadores
    await sponsor('Ativa Logo', 'ativo', { starts: '2026-01-01' });
    await sponsor('Inativa Logo', 'inativo', { starts: '2026-02-01' });
    await sponsor('Prospect Logo', 'prospect');
    await sponsor('Ativa Sem Logo', 'ativo', { logo: false });
    await sponsor('Ativa Escondida', 'ativo', { hidden: true });
    await sponsor('Oficial', 'ativo', { official: true });
  });
  after(async () => { await app.close?.(); });

  it('responde o contrato com as chaves de primeiro nível', async () => {
    const { status, json } = await get();
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(json), ['version', 'generated_at', 'mesa', 'episodios', 'posts', 'agenda', 'patrocinador_oficial', 'apoiadores', 'plateia']);
    assert.equal(json.version, 1);
    assert.deepEqual(Object.keys(json.agenda), ['vai_ao_ar', 'gravacoes']);
    assert.deepEqual(json.plateia, { abertas: 1 }); // a plateia nasce aberta; Dra Gravacao está na agenda dela
    assert.ok(!Number.isNaN(Date.parse(json.generated_at)));
  });

  it('plateia fechada: abertas 0 e nenhuma gravação com plateia', async () => {
    const settings = require('../src/services/settings');
    assert.equal((await get()).json.agenda.gravacoes.find((x) => x.name === 'Dra Gravacao').plateia, true);
    await settings.set('plateia_active', 'false');
    try {
      const { json } = await get();
      assert.deepEqual(json.plateia, { abertas: 0 });
      assert.ok(json.agenda.gravacoes.every((x) => x.plateia === false));
    } finally { await settings.set('plateia_active', 'true'); }
  });

  it('não expõe dado privado', async () => {
    const text = JSON.stringify((await get()).json);
    for (const bad of ['11999990000', 'x@y.com', '500000', 'owner', 'storage_key', 'token', 'nota secreta', 'Dona Owner']) assert.ok(!text.includes(bad), bad);
  });

  it('apoiadores: só ganho/ativo/inativo com logo, sem os escondidos e sem o oficial', async () => {
    const { json } = await get();
    assert.deepEqual(json.apoiadores.map((a) => a.company), ['Ativa Logo', 'Inativa Logo']);
    assert.equal(json.apoiadores[0].website, 'https://marca.com.br');
    assert.ok(json.apoiadores[0].logo.startsWith(`${h.config.appBaseUrl}/api/site/v1/imagem/logo/`));
    assert.equal(json.patrocinador_oficial.company, 'Oficial');
    assert.deepEqual(Object.keys(json.patrocinador_oficial), ['company', 'website', 'logo']);
  });

  it('oficial e escondido ao mesmo tempo não aparece em lugar nenhum', async () => {
    await h.db.query(`UPDATE sponsors SET site_hidden = true WHERE company = 'Oficial'`);
    try {
      const { json } = await get();
      assert.equal(json.patrocinador_oficial, null);
      assert.ok(!json.apoiadores.some((a) => a.company === 'Oficial'));
    } finally {
      await h.db.query(`UPDATE sponsors SET site_hidden = false WHERE company = 'Oficial'`);
    }
  });

  it('agenda: estreia e estreia prevista em vai_ao_ar, agendado sem episódio em gravacoes', async () => {
    const { json } = await get();
    const ar = json.agenda.vai_ao_ar.map((x) => x.name);
    const grav = json.agenda.gravacoes.map((x) => x.name);
    assert.ok(ar.includes('Dra Estreia'), ar.join());
    assert.ok(ar.includes('Dr Previsto'), ar.join());
    assert.ok(!ar.includes('Dra Gravacao'));
    assert.ok(grav.includes('Dra Gravacao'), grav.join());
    assert.ok(!grav.includes('Dra Estreia')); // já tem episódio
    assert.ok(![...ar, ...grav].includes('Dr Perdido'));
    const estreia = json.agenda.vai_ao_ar.find((x) => x.name === 'Dra Estreia');
    assert.deepEqual(Object.keys(estreia), ['date', 'name', 'handle', 'topic', 'photo']);
    assert.equal(estreia.date, day(1));
    assert.equal(json.agenda.vai_ao_ar.find((x) => x.name === 'Dr Previsto').date, day(10));
    const gr = json.agenda.gravacoes.find((x) => x.name === 'Dra Gravacao');
    assert.deepEqual(Object.keys(gr), ['at', 'name', 'handle', 'topic', 'photo', 'plateia']);
    assert.equal(gr.handle, 'dragravacao');
    assert.equal(typeof gr.plateia, 'boolean');
    assert.ok(gr.photo.startsWith(`${h.config.appBaseUrl}/api/site/v1/imagem/foto/`));
  });

  it('datas só-dia não mudam de dia', async () => {
    const { json } = await get();
    assert.equal(json.agenda.vai_ao_ar.find((x) => x.name === 'Dr Data').date, '2026-12-20');
    assert.equal(json.episodios.find((e) => e.title === 'Mais novo').aired_on, '2026-11-10');
  });

  it('episódios: só publicados com link, mais recente primeiro, com youtube_id', async () => {
    const { json } = await get();
    assert.deepEqual(json.episodios.map((e) => e.title), ['Mais novo', 'Mais velho']);
    const [novo, velho] = json.episodios;
    assert.deepEqual(Object.keys(novo), ['number', 'title', 'guest', 'aired_on', 'youtube_url', 'spotify_url', 'youtube_id', 'spotify_kind', 'spotify_id', 'cover']);
    assert.equal(novo.youtube_id, 'abc123XYZ_-');
    assert.equal(novo.spotify_kind, 'episode');
    assert.equal(novo.spotify_id, '4rOoJ6Egrf8K2IrywzwOMk');
    assert.equal(novo.guest, 'Dra Publicada');
    assert.equal(novo.number, 2);
    assert.equal(velho.youtube_id, 'OLD_id-1234');
    assert.equal(velho.spotify_kind, null);
    assert.equal(velho.guest, null);
  });

  it('extrai o id do YouTube (watch, youtu.be, shorts, live) e do Spotify (episode, show)', () => {
    const { youtubeId, spotifyRef, publicUrl } = require('../src/services/siteData');
    assert.equal(youtubeId('https://www.youtube.com/shorts/abc123XYZ_-'), 'abc123XYZ_-');
    assert.equal(youtubeId('https://youtube.com/live/abc123XYZ_-?feature=share'), 'abc123XYZ_-');
    assert.equal(youtubeId('https://m.youtube.com/watch?v=abc123XYZ_-'), 'abc123XYZ_-');
    assert.equal(youtubeId('https://evil.com/watch?v=abc123XYZ_-'), null);
    assert.deepEqual(spotifyRef('https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk'), { kind: 'show', id: '4rOoJ6Egrf8K2IrywzwOMk' });
    assert.deepEqual(spotifyRef('https://open.spotify.com/track/4rOoJ6Egrf8K2IrywzwOMk'), { kind: null, id: null });
    assert.equal(publicUrl('javascript:alert(1)'), null);
    assert.equal(publicUrl('marca.com.br'), 'https://marca.com.br');
  });

  it('mesa: os escolhidos para o kit, com nome, credencial e episódio', async () => {
    const { json } = await get();
    assert.equal(json.mesa.length, 1);
    assert.deepEqual(Object.keys(json.mesa[0]), ['name', 'credential', 'handle', 'audience', 'ep', 'photo']);
    assert.equal(json.mesa[0].name, 'Dra Publicada');
    assert.equal(json.mesa[0].ep, 2);
  });

  it('posts: os do Instagram que estão no ar, com link', async () => {
    const ep = (await h.db.query(`SELECT id FROM episodes WHERE title = 'Mais novo'`)).rows[0].id;
    await h.db.query(`INSERT INTO episode_publications (episode_id, platforms, title, status, results) VALUES
      ($1, '{instagram}', 'Post no ar', 'publicado', '[{"platform":"instagram","ok":true,"url":"https://www.instagram.com/p/ABC/"}]'),
      ($1, '{instagram}', 'Post com erro', 'erro', '[{"platform":"instagram","ok":false,"url":"https://www.instagram.com/p/ERR/"}]'),
      ($1, '{youtube}', 'Só YouTube', 'publicado', '[{"platform":"youtube","ok":true,"url":"https://youtu.be/x"}]')`, [ep]);
    const { json } = await get();
    assert.deepEqual(json.posts.map((p) => p.title), ['Post no ar']);
    assert.deepEqual(Object.keys(json.posts[0]), ['url', 'title', 'published_at', 'cover']);
    assert.equal(json.posts[0].url, 'https://www.instagram.com/p/ABC/');
  });

  it('responde com Cache-Control público e CORS do site', async () => {
    const r = await get();
    assert.equal(r.headers.get('cache-control'), 'public, max-age=60');
    assert.equal(r.headers.get('access-control-allow-origin'), SITE);
    assert.match(r.headers.get('vary') || '', /Origin/);
    const www = await get({ origin: 'https://www.podcastpulso.com' });
    assert.equal(www.headers.get('access-control-allow-origin'), 'https://www.podcastpulso.com');
    const fora = await get({ origin: 'https://outro.com' });
    assert.equal(fora.status, 200);
    assert.equal(fora.headers.get('access-control-allow-origin'), null);
  });
});
