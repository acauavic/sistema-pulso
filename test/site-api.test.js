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
