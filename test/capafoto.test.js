const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const h = require('./helpers');
const engine = require('../src/public/design/engine');
const { sanitizeSpec } = require('../src/services/specSanitizer');
const aiText = require('../src/services/aiText');

// Imagem de duas cores: metade esquerda (ou de cima) vermelha, a outra azul.
function twoTone(w, hgt, vertical = false) {
  const c = createCanvas(w, hgt); const g = c.getContext('2d');
  g.fillStyle = '#ff0000'; g.fillRect(0, 0, w, hgt);
  g.fillStyle = '#0000ff'; if (vertical) g.fillRect(0, hgt / 2, w, hgt / 2); else g.fillRect(w / 2, 0, w / 2, hgt);
  return c;
}
const pixel = (canvas, x, y) => Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3));
function paint(bg, img) {
  const out = createCanvas(1080, 1350);
  engine.render(out.getContext('2d'), { format: 'post_4x5', width: 1080, height: 1350, bg: { kind: 'frame', ref: 'f1', fit: 'cover', zoom: 1, cx: 0.5, cy: 0.5, align: 'center', ...bg }, layers: [] }, { f1: img }, { makeCanvas: createCanvas });
  return out;
}

describe('capa: girar, espelhar e ajustar a foto do fundo; sombra de qualquer lado e contorno', () => {
  it('espelhar troca os lados; girar 90° deita a foto e as caixas (rostos) acompanham', () => {
    const img = twoTone(1080, 1350);
    assert.deepEqual(pixel(paint({}, img), 100, 675), [255, 0, 0]);
    assert.deepEqual(pixel(paint({ flipX: true }, img), 100, 675), [0, 0, 255], 'espelhado: a esquerda ficou azul');
    const wide = twoTone(1350, 1080, true); // em cima vermelho, embaixo azul, deitada
    assert.deepEqual(engine.orientedSize({ w: 1350, h: 1080 }, { rot: 90 }), { w: 1080, h: 1350 });
    const turned = paint({ rot: 90 }, wide);
    assert.deepEqual(pixel(turned, 1000, 675), [255, 0, 0], 'girada no sentido horário: o que era em cima foi para a direita');
    assert.deepEqual(pixel(turned, 80, 675), [0, 0, 255]);
    const r90 = engine.orientBox({ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, { rot: 90 });
    assert.deepEqual(Object.fromEntries(Object.entries(r90).map(([k, v]) => [k, Math.round(v * 1000) / 1000])), { x: 0.7, y: 0.1, w: 0.1, h: 0.3 });
    const flipped = engine.orientBox({ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, { flipX: true });
    assert.ok(Math.abs(flipped.x - 0.6) < 1e-9 && flipped.y === 0.2);
  });

  it('ajustes da foto viram filtro (preto e branco, brilho) e o padrão não filtra nada', () => {
    assert.equal(engine.photoFilter({}), 'none');
    const mono = paint({ adjust: { saturate: 0 } }, twoTone(1080, 1350));
    const [r, g, b] = pixel(mono, 100, 675);
    assert.ok(Math.abs(r - g) < 3 && Math.abs(g - b) < 3, `preto e branco: ${r},${g},${b}`);
    const dark = pixel(paint({ adjust: { brightness: 0.5 } }, twoTone(1080, 1350)), 100, 675);
    assert.ok(dark[0] < 160 && dark[0] > 90, `mais escura: ${dark}`);
  });

  it('o sanitizador guarda giro, espelho, ajustes, lado da sombra e contorno, e descarta o resto', () => {
    const spec = sanitizeSpec({
      format: 'post_4x5', width: 1080, height: 1350,
      bg: { kind: 'frame', ref: 'f1', fit: 'cover', zoom: 1, cx: 0.5, cy: 0.5, rot: 450, flipX: true, flipY: 'sim', adjust: { brightness: 9, saturate: 0, blur: 3 } },
      layers: [{ id: 't', type: 'text', text: 'Oi', x: 10, y: 10, w: 500, size: 80, font: 'display', color: '#FAFAFA', shadow: 0.6, shadowAngle: 180, shadowDistance: 5, stroke: { width: 0.08, color: '#0A0A0A' } },
        { id: 'u', type: 'text', text: 'Sem contorno', x: 10, y: 200, w: 500, size: 60, font: 'display', color: '#FAFAFA', stroke: { width: 0, color: '#0A0A0A' } }],
    }, { allowedRefs: new Set(['f1']) });
    assert.equal(spec.bg.rot, 90); assert.equal(spec.bg.flipX, true); assert.ok(!spec.bg.flipY, 'só true conta');
    assert.equal(spec.bg.adjust.brightness, 1.8); assert.equal(spec.bg.adjust.saturate, 0); assert.equal(spec.bg.adjust.blur, 3);
    const [t, u] = spec.layers;
    assert.equal(t.shadowAngle, 180); assert.equal(t.shadowDistance, 1); assert.equal(t.stroke.width, 0.08);
    assert.ok(!u.stroke, 'contorno zero não fica guardado');
  });

  it('sombra para a esquerda aparece à esquerda do texto; contorno desenha borda escura', () => {
    const draw = (layer) => {
      const c = createCanvas(600, 300); const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 600, 300);
      engine.render(g, { format: 'post_4x5', width: 600, height: 300, bg: { kind: 'solid', color: '#ffffff' }, layers: [{ id: 't', type: 'text', text: 'I', x: 280, y: 60, w: 100, size: 160, font: 'display', color: '#ffffff', align: 'left', ...layer }] }, {}, { makeCanvas: createCanvas });
      return c;
    };
    // letra branca sobre branco: o que escurece é só a sombra (ou o contorno); compara o centro do que escureceu
    const shade = (c) => { let n = 0; let sx = 0; for (let x = 200; x < 480; x += 2) for (let y = 40; y < 280; y += 4) if (pixel(c, x, y)[0] < 230) { n++; sx += x; } return { n, cx: n ? sx / n : 0 }; };
    const left = shade(draw({ shadow: 1, shadowAngle: 180, shadowDistance: 1 }));
    const right = shade(draw({ shadow: 1, shadowAngle: 0, shadowDistance: 1 }));
    assert.ok(left.n > 0 && right.n > 0);
    assert.ok(left.cx + 8 < right.cx, `sombra à esquerda (${left.cx.toFixed(0)}) vs. à direita (${right.cx.toFixed(0)})`);
    assert.ok(shade(draw({ stroke: { width: 0.1, color: '#000000' } })).n > 5, 'contorno escuro em volta da letra branca');
  });
});

describe('fotografias do episódio como fundo da capa e IA nos textos', () => {
  let app; let ep; let other; let cover; let photo; let heic; let otherPhoto;
  const as = {};
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const realFetch = global.fetch;
  const geminiAsks = [];
  const config = require('../src/config');
  const postForm = async (c, path, body) => {
    const r = await fetch(`${app.base}${path}`, { method: 'POST', headers: { cookie: c.cookie(), 'x-csrf-token': c.__token, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(body), redirect: 'manual' });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: r.status, json, text };
  };

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['editor', 'editor_video'], ['prod', 'produtora']]) {
      await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); as[k].__token = await as[k].csrf('/episodios');
    }
    [ep] = await q("INSERT INTO episodes (number, title, status) VALUES (21, 'Conversa com Lia', 'em_finalizacao') RETURNING *");
    [other] = await q("INSERT INTO episodes (number, title, status) VALUES (22, 'Outra conversa', 'gravado') RETURNING *");
    [cover] = await q("INSERT INTO episode_covers (episode_id, kind, position, spec, storage_key, mime, width, height, size_bytes) VALUES ($1, 'post_quote', 0, $2, 'pp/capas/x.jpg', 'image/jpeg', 1080, 1350, 1000) RETURNING *",
      [ep.id, JSON.stringify({ format: 'post_4x5', width: 1080, height: 1350, bg: { kind: 'solid', color: '#0A0A0A' }, layers: [] })]);
    const jpg = twoTone(1600, 1200).toBuffer('image/jpeg');
    const file = async (episodeId, name, kind = 'foto') => {
      const key = `pp/episodios/${episodeId}/material/${name}`;
      h.b2Store.set(key, { body: jpg, contentType: 'image/jpeg' });
      return (await q("INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, status) VALUES ($1, $2, $3, $4, $5, 'pronto') RETURNING *", [episodeId, kind, name, jpg.length, key]))[0];
    };
    photo = await file(ep.id, 'retrato-lia.jpg');
    heic = await file(ep.id, 'iphone.HEIC');
    await file(ep.id, 'making-of.png', 'bastidor');
    await file(ep.id, 'camera.mp4', 'bruto_video');
    otherPhoto = await file(other.id, 'outra.jpg');
  });
  after(async () => {
    global.fetch = realFetch; config.gemini.key = undefined; config.geminiConfigured = false;
    await app.close(); await h.db.close();
  });

  it('o editor da capa lista só as fotografias e bastidores do episódio que abrem (sem HEIC, sem vídeo)', async () => {
    const page = await as.gestao.get(`/episodios/${ep.id}/capas/${cover.id}/editar`);
    const data = JSON.parse(page.text.match(/<script type="application\/json" id="editor-data">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(data.photos.map((p) => p.name).sort(), ['making-of.png', 'retrato-lia.jpg']);
    assert.equal(data.photoUrl, `/capas/${cover.id}/foto`);
    assert.match(data.photos[0].thumb, new RegExp(`^/episodios/${ep.id}/arquivos/\\d+/previa$`));
    for (const re of [/data-bg-src="photos"/, /data-orient="rotR"/, /data-orient="flipX"/, /data-adj="saturate"/, /data-shadow-dir="180"/, /data-p="strokeWidth"/, /data-ai="capa"/]) assert.match(page.text, re, String(re));
  });

  it('usar uma fotografia: vira imagem do fundo (em pé, até 2400 px) e a segunda vez reaproveita a mesma', async () => {
    const r = await postForm(as.editor, `/capas/${cover.id}/foto`, { arquivo: photo.id });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.reused, false); assert.equal(r.json.frame.analysis.from_file, photo.id); assert.equal(r.json.frame.analysis.custom, true);
    assert.ok(r.json.frame.width <= 2400);
    const again = await postForm(as.gestao, `/capas/${cover.id}/foto`, { arquivo: photo.id });
    assert.equal(again.json.reused, true); assert.equal(again.json.frame.ref, r.json.frame.ref);
    assert.equal((await q("SELECT count(*)::int n FROM episode_frames WHERE (analysis->>'from_file')::int = $1", [photo.id]))[0].n, 1);
    // e a capa salva com essa foto, girada e em preto e branco
    const spec = { ...cover.spec, bg: { kind: 'frame', ref: r.json.frame.ref, fit: 'cover', zoom: 1, cx: 0.5, cy: 0.5, align: 'center', rot: 90, flipX: true, adjust: { saturate: 0 } } };
    const saved = await fetch(`${app.base}/capas/${cover.id}`, { method: 'POST', headers: { cookie: as.gestao.cookie(), 'x-csrf-token': as.gestao.__token, 'content-type': 'application/json' }, body: JSON.stringify({ spec, ctx: { faces: [], blocks: [], insets: [] } }) });
    assert.equal(saved.status, 200, await saved.text());
    const [row] = await q('SELECT spec FROM episode_covers WHERE id = $1', [cover.id]);
    assert.equal(row.spec.bg.rot, 90); assert.equal(row.spec.bg.flipX, true); assert.equal(row.spec.bg.adjust.saturate, 0);
  });

  it('recusa HEIC, foto de outro episódio, vídeo e perfil sem edição de capa', async () => {
    assert.equal((await postForm(as.gestao, `/capas/${cover.id}/foto`, { arquivo: heic.id })).status, 404);
    assert.equal((await postForm(as.gestao, `/capas/${cover.id}/foto`, { arquivo: otherPhoto.id })).status, 404);
    assert.equal((await postForm(as.gestao, `/capas/${cover.id}/foto`, { arquivo: 'abc' })).status, 400);
    assert.equal((await postForm(as.prod, `/capas/${cover.id}/foto`, { arquivo: photo.id })).status, 403);
  });

  it('IA nos textos: sem chave do Gemini avisa (503); limpa as opções e respeita o tamanho do campo', async () => {
    const off = await postForm(as.gestao, '/ia/texto', { campo: 'titulo', atalho: 'curto' });
    assert.equal(off.status, 503); assert.match(off.json.error, /não está configurada/);
    assert.equal(aiText.tidyOption('"Sem ego, sem vaidade!!!" 🚀.', 'capa'), 'Sem ego, sem vaidade!');
    assert.ok(aiText.tidyOption('palavra '.repeat(40), 'capa').length <= 28);
    assert.deepEqual(aiText.shortcutsFor('titulo').map((s) => s.key).includes('hashtags'), false);
    assert.ok(aiText.shortcutsFor('descricao').some((s) => s.key === 'hashtags'));
  });

  it('IA nos textos: atalho ou pedido livre trazem 3 opções novas, com o contexto do episódio e a regra do tipo de capa', async () => {
    config.gemini.key = 'test-gemini'; config.geminiConfigured = true;
    await q("INSERT INTO episode_transcripts (episode_id, text) VALUES ($1, 'Burnout não é fraqueza, é sinal de sistema doente.')", [ep.id]).catch(() => {});
    global.fetch = async (url, opts = {}) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return realFetch(url, opts);
      const prompt = JSON.parse(opts.body).contents[0].parts.map((p) => p.text || '').join('\n');
      geminiAsks.push(prompt);
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ opcoes: ['Burnout não é fraqueza', 'Texto atual', '"Sistema doente"!!!', 'Burnout não é fraqueza', 'O que o burnout revela'] }) }] } }], usageMetadata: { totalTokenCount: 5 } });
    };
    assert.match((await as.gestao.get(`/episodios/${ep.id}/capas/${cover.id}/editar`)).text, /\/static\/aiassist\.js/, 'com a IA ligada, o botão carrega');
    const r = await postForm(as.editor, '/ia/texto', { campo: 'capa', tipo_capa: 'youtube_thumb', atual: 'Texto atual', atalho: 'pergunta', episodio: ep.id });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.opcoes, ['Burnout não é fraqueza', 'Sistema doente!', 'O que o burnout revela'], 'sem repetir, sem o texto atual, limpas');
    const ask = geminiAsks.at(-1);
    assert.match(ask, /Campo: texto da capa/); assert.match(ask, /forma de pergunta/); assert.match(ask, /Conversa com Lia|EP\.021/); assert.match(ask, /Texto atual: Texto atual/);
    const quote = await postForm(as.gestao, '/ia/texto', { campo: 'capa', tipo_capa: 'post_quote', pedido: 'cite a fala sobre burnout', episodio: ep.id });
    assert.equal(quote.status, 200); assert.match(geminiAsks.at(-1), /Campo: frase do post/); assert.match(geminiAsks.at(-1), /cite a fala sobre burnout/);
    assert.equal((await postForm(as.gestao, '/ia/texto', { campo: 'titulo' })).status, 400, 'sem atalho nem pedido');
    assert.equal((await postForm(as.gestao, '/ia/texto', { campo: 'senha', atalho: 'curto' })).status, 400, 'campo desconhecido');
  });
});
