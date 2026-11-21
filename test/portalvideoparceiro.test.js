const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('Vídeo do episódio no portal do convidado e logo do parceiro', () => {
  const as = {}; let app; let anon; let g; let ep; let token; let base; let uploader;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const one = (sql, p) => q(sql, p).then((r) => r[0]);
  const act = (who, path, form) => as[who].act(path, form, { from: `/convidados/${g}` });
  const video = (version, status = 'pronto') => one(
    "INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, status, version, uploaded_by) VALUES ($1,'editado',$2,1048576,$3,$4,$5,$6) RETURNING id",
    [ep, `Edição Final v${version}.MOV`, `pp/editado/v${version}`, status, version, uploader]);
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 3)]);
  const sendLogo = async (who, path, body) => {
    const csrf = await as[who].csrf(`/convidados/${g}`);
    return fetch(`${app.base}${path}`, { method: 'POST', headers: { cookie: as[who].cookie(), 'content-type': 'image/png', 'x-csrf-token': csrf, accept: 'application/json' }, body });
  };

  before(async () => {
    await h.resetDb(); app = await h.startServer(); anon = h.client(app.base);
    for (const [k, role] of [['gestao', 'gestao'], ['editor', 'editor_video']]) { const u = await h.createUser({ name: k, email: `${k}@pv.com`, role }); if (k === 'gestao') uploader = u.id; as[k] = h.client(app.base); await as[k].login(`${k}@pv.com`); }
    await q("INSERT INTO app_settings (key, value) VALUES ('plateia_active', 'true') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");
    g = (await one("INSERT INTO guests (name, status, proposed_at, audience_enabled, scheduled_studio, scheduled_hosts, scheduled_guest) VALUES ('Mari Vabo', 'agendado', now() + interval '10 days', true, true, true, true) RETURNING id")).id;
    ep = (await one("INSERT INTO episodes (number, title, guest_id, status) VALUES (12, 'Gestão', $1, 'em_revisao') RETURNING id", [g])).id;
    await act('gestao', `/convidados/${g}/portal`, { on: '1' });
    token = (await one('SELECT portal_token FROM guests WHERE id = $1', [g])).portal_token;
    base = `/convidado/${token}`;
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('vídeo: desligado por padrão, mesmo com vídeo editado no episódio', async () => {
    let tab = (await as.gestao.get(`/convidados/${g}`)).text;
    assert.match(tab, /sem vídeo editado no episódio/);
    assert.doesNotMatch(tab, /liberar para baixar/);
    await act('gestao', `/convidados/${g}/portal/video`, { on: '1' });
    assert.equal((await one('SELECT portal_video FROM guests WHERE id = $1', [g])).portal_video, false, 'sem vídeo, não liga');

    await video(1); await video(2);
    tab = (await as.gestao.get(`/convidados/${g}`)).text;
    assert.match(tab, /Fora do portal/); assert.match(tab, /liberar para baixar/);
    assert.doesNotMatch((await anon.get(base)).text, /Baixar episódio/);
    assert.equal((await anon.get(`${base}/episodio/baixar`)).status, 404);
  });

  it('vídeo: só quem edita o convidado libera; liberado, entrega a versão mais nova com nome do episódio; "tirar" fecha', async () => {
    assert.equal((await act('editor', `/convidados/${g}/portal/video`, { on: '1' })).status, 403);
    await act('gestao', `/convidados/${g}/portal/video`, { on: '1' });
    const tab = (await as.gestao.get(`/convidados/${g}`)).text;
    assert.match(tab, /Versão 2 · 1[.,]0 MB/); assert.match(tab, />tirar</);

    const page = (await anon.get(base)).text;
    assert.match(page, /Baixar episódio/); assert.match(page, new RegExp(`${base}/episodio/baixar`));
    let r = await anon.get(`${base}/episodio/baixar`);
    assert.equal(r.status, 302);
    assert.match(r.location, /pp\/editado\/v2\?/);
    assert.match(decodeURIComponent(r.location), /attachment; filename\*=UTF-8''pulso-ep012-mari-vabo\.mov/);

    await video(3, 'enviando');
    assert.match((await anon.get(`${base}/episodio/baixar`)).location, /v2\?/, 'versão ainda subindo não entra');
    await q("UPDATE episode_files SET status = 'pronto' WHERE storage_key = 'pp/editado/v3'");
    assert.match((await anon.get(`${base}/episodio/baixar`)).location, /v3\?/);

    await act('gestao', `/convidados/${g}/portal/video`, { on: '0' });
    assert.doesNotMatch((await anon.get(base)).text, /Baixar episódio/);
    r = await anon.get(`${base}/episodio/baixar`);
    assert.equal(r.status, 404);
  });

  it('logo: o parceiro nasce sem logo; só PNG/JPEG/WebP; só quem edita envia; aparece no link dele e em mais nenhum lugar', async () => {
    await act('gestao', `/convidados/${g}/plateia/pagina`, { on: '1' });
    await act('gestao', `/convidados/${g}/plateia/parceiros`, { name: 'Clínica Vida', slots: '2' });
    await act('gestao', `/convidados/${g}/plateia/parceiros`, { name: 'Sem Logo', slots: '' });
    const [p, sem] = await q('SELECT * FROM plateia_partners WHERE guest_id = $1 ORDER BY id', [g]);
    const { audience_slug: slug } = await one('SELECT audience_slug FROM guests WHERE id = $1', [g]);
    const path = `/convidados/${g}/plateia/parceiros/${p.id}/logo`;
    assert.match((await as.gestao.get(`/convidados/${g}`)).text, /enviar logo/);

    assert.equal((await sendLogo('editor', path, PNG)).status, 403);
    assert.equal((await sendLogo('gestao', path, Buffer.from('<svg></svg>'))).status, 400);
    assert.equal((await sendLogo('gestao', `/convidados/${g}/plateia/parceiros/999999/logo`, PNG)).status, 404);
    const up = await sendLogo('gestao', path, PNG);
    assert.equal(up.status, 200);
    const { logo_key: k1 } = await one('SELECT logo_key FROM plateia_partners WHERE id = $1', [p.id]);
    assert.ok(k1 && h.b2Store.has(k1));

    const pub = (await anon.get(`/plateia/com/${slug}/${p.token}`)).text;
    assert.match(pub, new RegExp(`class="pl-gift-logo"><img loading="lazy" decoding="async" src="/plateia/com/${slug}/${p.token}/logo\\?v=[^"]+" alt="Clínica Vida"`));
    assert.doesNotMatch((await anon.get(`/plateia/com/${slug}`)).text, /pl-gift-logo/, 'a página normal não mostra');
    assert.doesNotMatch((await anon.get(`/plateia/com/${slug}/${sem.token}`)).text, /pl-gift-logo/, 'outro parceiro não mostra');
    const img = await fetch(`${app.base}/plateia/com/${slug}/${p.token}/logo`);
    assert.equal(img.status, 200); assert.equal(Buffer.compare(Buffer.from(await img.arrayBuffer()), PNG), 0);
    assert.equal((await as.gestao.get(path)).status, 302);
    assert.notEqual((await anon.get(path)).status, 200);
    assert.match((await as.gestao.get(`/convidados/${g}`)).text, /trocar logo/);

    await sendLogo('gestao', path, Buffer.concat([PNG, PNG]));
    const { logo_key: k2 } = await one('SELECT logo_key FROM plateia_partners WHERE id = $1', [p.id]);
    assert.notEqual(k1, k2); assert.ok(!h.b2Store.has(k1), 'a logo antiga sai do armazenamento');

    await act('gestao', `/convidados/${g}/plateia/parceiros/${p.id}`, { active: '0' });
    assert.equal((await fetch(`${app.base}/plateia/com/${slug}/${p.token}/logo`)).status, 404, 'link desativado não entrega a logo');
    await act('gestao', `/convidados/${g}/plateia/parceiros/${p.id}`, { active: '1' });

    await act('gestao', `${path}/excluir`, {});
    assert.equal((await one('SELECT logo_key FROM plateia_partners WHERE id = $1', [p.id])).logo_key, null);
    assert.ok(!h.b2Store.has(k2));
    assert.doesNotMatch((await anon.get(`/plateia/com/${slug}/${p.token}`)).text, /pl-gift-logo/);
  });
});
