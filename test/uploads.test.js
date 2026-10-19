const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('envio de material: vários grupos de uma vez, em segundo plano', () => {
  const as = {}; let app; let epId;

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['prod', 'produtora'], ['gestao', 'gestao']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    epId = (await h.db.query("INSERT INTO episodes (number, title, status) VALUES (7, 'Episódio de envio', 'gravado') RETURNING id")).rows[0].id;
  });
  after(async () => { await app.close(); await h.db.close(); });

  async function api(client, method, path, { json, raw } = {}) {
    const token = await client.csrf('/episodios');
    const headers = { cookie: client.cookie(), accept: 'application/json', 'x-csrf-token': token };
    let body;
    if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); } else if (raw) { headers['content-type'] = 'application/octet-stream'; body = raw; }
    const res = await fetch(`${app.base}${path}`, { method, headers, body, redirect: 'manual' });
    const text = await res.text(); let parsed = null; try { parsed = JSON.parse(text); } catch { /* não é JSON */ }
    return { status: res.status, json: parsed, text };
  }
  // Mesmo caminho do navegador: iniciar -> partes -> concluir.
  async function send(client, kind, name, label = '', size = 2048) {
    const data = Buffer.alloc(size, 3);
    const init = await api(client, 'POST', `/episodios/${epId}/arquivos/iniciar`, { json: { kind, rotulo: label, nome: name, tamanho: data.length, tipo: 'application/octet-stream' } });
    assert.equal(init.status, 200, init.text);
    for (let n = 1; n <= init.json.totalParts; n += 1) {
      const part = await api(client, 'PUT', `/episodios/${epId}/arquivos/${init.json.id}/parte/${n}`, { raw: data.subarray((n - 1) * init.json.partSize, Math.min(data.length, n * init.json.partSize)) });
      assert.equal(part.status, 200, part.text);
    }
    assert.equal((await api(client, 'POST', `/episodios/${epId}/arquivos/${init.json.id}/concluir`)).status, 200);
    return init.json.id;
  }
  const events = async () => (await h.db.query("SELECT message FROM episode_events WHERE episode_id = $1 AND type = 'arquivo' ORDER BY id", [epId])).rows.map((r) => r.message);

  it('vídeos e áudios de uma vez, cada um com o seu rótulo; fotos e bastidores entram sem rótulo', async () => {
    await Promise.all([
      send(as.prod, 'bruto_video', 'camera1.mp4', 'Câmera 1'), send(as.prod, 'bruto_video', 'camera2.mp4', 'Câmera 2'),
      send(as.prod, 'bruto_audio', 'lapela.wav', 'Lapela do convidado'), send(as.prod, 'bastidor', 'bts.mp4'), send(as.prod, 'bastidor', 'bts.jpg'),
      send(as.prod, 'foto', 'f1.jpg'), send(as.prod, 'foto', 'f2.jpg'), send(as.prod, 'foto', 'f3.jpg'),
    ]);
    const { rows } = await h.db.query("SELECT kind, label, status FROM episode_files WHERE episode_id = $1 ORDER BY id", [epId]);
    assert.equal(rows.length, 8); assert.ok(rows.every((r) => r.status === 'pronto'));
    assert.deepEqual(rows.filter((r) => r.kind === 'bruto_video').map((r) => r.label).sort(), ['Câmera 1', 'Câmera 2']);
    assert.equal(rows.find((r) => r.kind === 'bruto_audio').label, 'Lapela do convidado');
    assert.ok(rows.filter((r) => ['foto', 'bastidor'].includes(r.kind)).every((r) => r.label === null));
  });

  it('o histórico soma fotografias e bastidores numa linha só; vídeo e áudio têm uma linha cada', async () => {
    const ev = await events();
    assert.equal(ev.filter((m) => m.startsWith('Fotografias enviadas')).length, 1);
    assert.ok(ev.includes('Fotografias enviadas: 3'), ev.join(' | '));
    assert.ok(ev.includes('Bastidores enviados: 2'), ev.join(' | '));
    assert.equal(ev.filter((m) => m.startsWith('Arquivo enviado: Vídeo bruto')).length, 2);
    assert.equal(ev.filter((m) => m.startsWith('Arquivo enviado: Áudio bruto')).length, 1);
  });

  it('outra pessoa que envia fotos ganha a própria linha no histórico', async () => {
    await send(as.gestao, 'foto', 'g1.jpg');
    const ev = await events();
    assert.equal(ev.filter((m) => m.startsWith('Fotografias enviadas')).length, 2);
    assert.ok(ev.includes('Fotografias enviadas: 1'));
  });

  it('a página do material tem a janela de triagem, a bandeja global e a lista por grupo', async () => {
    const page = (await as.prod.get(`/episodios/${epId}`)).text;
    assert.match(page, /data-material-dialog/); assert.match(page, /data-material-files[^>]*multiple|multiple[^>]*data-material-files/);
    assert.doesNotMatch(page, /Tipo de material/, 'sem o seletor de tipo único de antes');
    assert.match(page, /Vídeos do episódio/); assert.match(page, /Áudios/);
    assert.match(page, /<summary><strong>Fotografias<\/strong>/); assert.match(page, /<summary><strong>Bastidores<\/strong>/);
    assert.match(page, /Câmera 1/); assert.match(page, /Lapela do convidado/);
    assert.match(page, /static\/uploads\.js/); assert.match(page, /data-upl-icons/);
    assert.equal((await as.prod.get('/static/uploads.js')).status, 200);
  });

  it('a gestão não vê o envio (só a produção sobe material bruto)', async () => {
    const page = (await as.gestao.get(`/episodios/${epId}`)).text;
    assert.match(page, /Câmera 1/);
  });
});
