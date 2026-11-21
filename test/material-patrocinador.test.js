// Material do patrocinador (aba Material): as pastas só existem depois que ele fecha, o envio em partes (a mesma fila dos episódios),
// a logo principal (media kit, portal e episódio), moldura e QR Code no entregável, substituir, o ZIP, o baixar e quem pode o quê.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const prod = require('../src/services/production');
const sponsorsSvc = require('../src/services/sponsors');

describe('Material do patrocinador', () => {
  const as = {}; const u = {}; let app; let won; let prospect;
  const q = (sql, p) => h.db.query(sql, p);

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['prod', 'produtora'], ['gestao', 'gestao'], ['editor', 'editor_video']]) {
      u[k] = await h.createUser({ name: `Pessoa ${k}`, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`);
    }
    won = (await q("INSERT INTO sponsors (company, stage, owner_id) VALUES ('Clínica Aurora', 'ganho', $1) RETURNING id", [u.prod.id])).rows[0].id;
    prospect = (await q("INSERT INTO sponsors (company, stage, owner_id) VALUES ('Lab Vitta', 'prospect', $1) RETURNING id", [u.prod.id])).rows[0].id;
    await q("INSERT INTO sponsor_deliverables (sponsor_id, kind, title) VALUES ($1, 'moldura', 'Moldura'), ($1, 'qr_code', 'QR Code')", [won]);
  });
  after(async () => { await app.close(); await h.db.close(); });

  async function api(client, method, path, { json, raw } = {}) {
    const token = await client.csrf('/patrocinadores');
    const headers = { cookie: client.cookie(), accept: 'application/json', 'x-csrf-token': token };
    let body;
    if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); } else if (raw) { headers['content-type'] = 'application/octet-stream'; body = raw; }
    const res = await fetch(`${app.base}${path}`, { method, headers, body, redirect: 'manual' });
    const text = await res.text(); let parsed = null; try { parsed = JSON.parse(text); } catch { /* não é JSON */ }
    return { status: res.status, json: parsed, text };
  }
  // O caminho do navegador: iniciar -> partes -> concluir.
  async function send(client, sponsorId, kind, name, { content = 'arquivo', substituir = '' } = {}) {
    const data = Buffer.from(content);
    const base = `/patrocinadores/${sponsorId}/material/`;
    const init = await api(client, 'POST', `${base}iniciar`, { json: { kind, nome: name, tamanho: data.length, tipo: name.endsWith('.png') ? 'image/png' : 'application/pdf', substituir } });
    if (init.status !== 200) return init;
    for (let n = 1; n <= init.json.totalParts; n += 1) {
      const part = await api(client, 'PUT', `${base}${init.json.id}/parte/${n}`, { raw: data.subarray((n - 1) * init.json.partSize, Math.min(data.length, n * init.json.partSize)) });
      assert.equal(part.status, 200, part.text);
    }
    const done = await api(client, 'POST', `${base}${init.json.id}/concluir`);
    assert.equal(done.status, 200, done.text);
    return { status: 200, id: init.json.id };
  }
  const file = async (id) => (await q('SELECT * FROM sponsor_files WHERE id = $1', [id])).rows[0];

  it('a aba Material só aparece depois que o patrocinador fecha; quem vê patrocinadores vê as quatro pastas e só quem edita envia', async () => {
    let page = (await as.prod.get(`/patrocinadores/${won}`)).text;
    assert.match(page, /data-tab-btn="material"/);
    for (const title of ['Logos', 'Moldura', 'QR Code', 'Material da marca']) assert.match(page, new RegExp(`<strong>${title}</strong>`));
    assert.match(page, /data-material-pick/); assert.match(page, /data-m-config=/);
    assert.match(page, /ficam na aba <a href="#material">Material<\/a>/, 'quem procurava em Entregas acha o caminho');
    assert.doesNotMatch(page, /id="modal-arquivo"/, 'a janela antiga de envio saiu');
    page = (await as.editor.get(`/patrocinadores/${won}`)).text;
    assert.match(page, /data-tab-btn="material"/); assert.doesNotMatch(page, /data-material-pick/, 'o editor vê e baixa, não envia');
    assert.doesNotMatch((await as.prod.get(`/patrocinadores/${prospect}`)).text, /data-tab-btn="material"/, 'em prospecção ainda não há material');
  });

  it('envio em partes: só para quem edita e patrocinador fechado; a primeira logo vira a principal; moldura e QR Code vão para o entregável', async () => {
    assert.equal((await send(as.editor, won, 'logo', 'logo.png')).status, 403);
    assert.equal((await send(as.prod, prospect, 'logo', 'logo.png')).status, 409, 'em prospecção: o material ainda não abriu');
    assert.equal((await send(as.prod, won, 'contrato', 'x.pdf')).status, 400, 'pasta que não existe');
    const logo1 = await send(as.prod, won, 'logo', 'logo-horizontal.png', { content: 'png-1' });
    const logo2 = await send(as.prod, won, 'logo', 'logo-negativo.png', { content: 'png-2' });
    assert.deepEqual([(await file(logo1.id)).is_main, (await file(logo2.id)).is_main], [true, false], 'a primeira logo é a principal');
    assert.equal((await file(logo1.id)).status, 'pronto');
    const mold = await send(as.prod, won, 'moldura', 'moldura.png');
    const qr = await send(as.prod, won, 'qrcode', 'qr.png');
    const { rows: d } = await q("SELECT kind, file_id FROM sponsor_deliverables WHERE sponsor_id = $1 ORDER BY kind", [won]);
    assert.deepEqual(d, [{ kind: 'moldura', file_id: mold.id }, { kind: 'qr_code', file_id: qr.id }]);
    await send(as.prod, won, 'material', 'manual-da-marca.pdf', { content: 'manual' });
    const ev = (await q("SELECT message FROM sponsor_events WHERE sponsor_id = $1 AND type = 'arquivo' ORDER BY id", [won])).rows.map((r) => r.message);
    assert.ok(ev.includes('Material enviado (Logos: logo-horizontal.png)'), ev.join(' | '));
    const page = (await as.prod.get(`/patrocinadores/${won}`)).text;
    assert.match(page, /logo-horizontal\.png<\/span>\s*<span class="badge b-gray">[\s\S]*?principal<\/span>/);
    assert.match(page, new RegExp(`action="/patrocinadores/${won}/arquivos/${logo2.id}/principal"`), 'a outra logo pode virar a principal');
    assert.match(page, /manual-da-marca\.pdf/);
  });

  it('logo principal: troca e vale no media kit, no portal e no episódio; a logo do formulário não apaga as versões da equipe', async () => {
    const [l1, l2] = (await q("SELECT id FROM sponsor_files WHERE sponsor_id = $1 AND kind = 'logo' ORDER BY id", [won])).rows.map((r) => r.id);
    assert.equal((await as.editor.act(`/patrocinadores/${won}/arquivos/${l2}/principal`, {}, { from: `/patrocinadores/${won}` })).status, 403);
    const r = await as.prod.act(`/patrocinadores/${won}/arquivos/${l2}/principal`, {}, { from: `/patrocinadores/${won}` });
    assert.equal(r.status, 302); assert.match(r.location, /#material$/);
    assert.deepEqual((await q("SELECT id FROM sponsor_files WHERE sponsor_id = $1 AND kind = 'logo' AND is_main", [won])).rows.map((x) => x.id), [l2]);
    const [{ id: ep }] = (await q("INSERT INTO episodes (number, title, status) VALUES (90, 'EP patrocinado', 'em_edicao') RETURNING id")).rows;
    await q("INSERT INTO sponsor_episodes (sponsor_id, episode_id, role) VALUES ($1, $2, 'insercao')", [won, ep]);
    assert.equal((await prod.sponsorAssets(ep))[0].logo.id, l2, 'o episódio patrocinado mostra a principal');
    const epPage = (await as.editor.get(`/episodios/${ep}`)).text;
    assert.match(epPage, new RegExp(`href="/patrocinadores/${won}#material"`), 'o editor acha todo o material a partir do episódio');
    // o patrocinador manda a logo pelo formulário: troca só a que ele tinha mandado
    await sponsorsSvc.storeFile({ sponsorId: won, kind: 'logo', buffer: Buffer.from('png-form'), filename: 'enviada.png', contentType: 'image/png', fromSponsor: true, replace: true });
    await sponsorsSvc.storeFile({ sponsorId: won, kind: 'logo', buffer: Buffer.from('png-form-2'), filename: 'enviada-2.png', contentType: 'image/png', fromSponsor: true, replace: true });
    const logos = (await q("SELECT filename, from_sponsor, is_main FROM sponsor_files WHERE sponsor_id = $1 AND kind = 'logo' ORDER BY id", [won])).rows;
    assert.deepEqual(logos.map((x) => [x.filename, x.from_sponsor, x.is_main]), [['logo-horizontal.png', false, false], ['logo-negativo.png', false, true], ['enviada-2.png', true, false]]);
  });

  it('substituir troca o arquivo só quando o novo chega inteiro; envio que parou some com "descartar"', async () => {
    const old = (await q("SELECT id FROM sponsor_files WHERE sponsor_id = $1 AND kind = 'moldura'", [won])).rows[0].id;
    const fresh = await send(as.prod, won, 'moldura', 'moldura-v2.png', { substituir: old });
    assert.equal(await file(old), undefined, 'a moldura antiga saiu');
    assert.equal((await q("SELECT file_id FROM sponsor_deliverables WHERE sponsor_id = $1 AND kind = 'moldura'", [won])).rows[0].file_id, fresh.id);
    const init = await api(as.prod, 'POST', `/patrocinadores/${won}/material/iniciar`, { json: { kind: 'material', nome: 'video.mp4', tamanho: 10, tipo: 'video/mp4' } });
    assert.equal(init.status, 200);
    await q("UPDATE sponsor_files SET last_part_at = now() - interval '2 hours', created_at = now() - interval '2 hours' WHERE id = $1", [init.json.id]);
    assert.match((await as.prod.get(`/patrocinadores/${won}`)).text, /1 arquivo não terminou de subir/);
    const ex = await api(as.prod, 'GET', `/patrocinadores/${won}/material/existentes`);
    assert.ok(ex.json.files.some((f) => f.id === init.json.id && f.stalled && f.status === 'enviando'), 'a janela de envio reconhece o envio parado');
    await as.prod.act(`/patrocinadores/${won}/material/descartar-parados`, {}, { from: `/patrocinadores/${won}` });
    assert.equal(await file(init.json.id), undefined);
  });

  it('baixar: um arquivo vai por link curto do armazenamento; vários num ZIP só (só para quem vê patrocinadores)', async () => {
    const { rows } = await q("SELECT id, filename FROM sponsor_files WHERE sponsor_id = $1 AND kind = 'logo' AND NOT from_sponsor ORDER BY id", [won]);
    const one = await fetch(`${app.base}/patrocinadores/${won}/arquivos/${rows[0].id}/baixar`, { headers: { cookie: as.editor.cookie() }, redirect: 'manual' });
    assert.equal(one.status, 302); assert.ok(one.headers.get('location'), 'link assinado');
    const zip = await fetch(`${app.base}/baixar.zip?itens=${rows.map((r) => `s${r.id}`).join(',')}&nome=clinica-aurora-logos`, { headers: { cookie: as.editor.cookie() }, redirect: 'manual' });
    assert.equal(zip.status, 200); assert.equal(zip.headers.get('content-type'), 'application/zip');
    const buf = Buffer.from(await zip.arrayBuffer());
    for (const r of rows) assert.ok(buf.includes(Buffer.from(r.filename)), `${r.filename} está no ZIP`);
  });
});
