const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const h = require('./helpers');
const { engine } = require('../src/services/covers');
const designs = require('../src/services/designs');
const { sanitizeSpec } = require('../src/services/specSanitizer');

// Quadro sintético: fundo escuro, um "rosto" (elipse clara) do lado indicado e, opcionalmente, uma legenda queimada embaixo.
function makeFrame(id, { w, h: hgt, faceX = 0.62, captions = false, at = 0, score = 7 }) {
  const c = createCanvas(w, hgt); const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, w, hgt); grad.addColorStop(0, '#1b2a2a'); grad.addColorStop(1, '#0d0d14');
  g.fillStyle = grad; g.fillRect(0, 0, w, hgt);
  const face = { x: faceX, y: 0.18, w: hgt > w ? 0.34 : 0.17, h: hgt > w ? 0.2 : 0.4 };
  g.fillStyle = '#d9b49a'; g.beginPath(); g.ellipse((face.x + face.w / 2) * w, (face.y + face.h / 2) * hgt, face.w * w / 2, face.h * hgt / 2, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#26324a'; g.fillRect(face.x * w - face.w * w * 0.4, (face.y + face.h) * hgt, face.w * w * 1.8, hgt);
  const blocks = captions ? [{ x: 0.1, y: 0.78, w: 0.8, h: 0.1 }] : [];
  for (const b of blocks) { g.fillStyle = '#ffffff'; g.fillRect(b.x * w, b.y * hgt, b.w * w, b.h * hgt); }
  return { id, ref: `f${id}`, width: w, height: hgt, at_ms: at, score, buffer: c.toBuffer('image/jpeg'), analysis: { rostos: [face], caixas_de_texto: blocks } };
}

describe('motor de design (o mesmo no servidor e no editor)', () => {
  const ctx = createCanvas(10, 10).getContext('2d');

  it('quebra de linha editorial: sem palavra pendurada nem linha órfã e sem passar da largura', () => {
    engine.setFont(ctx, engine.FONTS.display, 80);
    const { lines, overflow } = engine.balance(ctx, 'Eu tenho prazo para sair do cargo de CEO da empresa que fundei', 700, 4);
    assert.equal(overflow, false);
    assert.ok(lines.length >= 2);
    for (const l of lines) assert.ok(ctx.measureText(l).width <= 700, `passou da largura: "${l}"`);
    for (const l of lines.slice(0, -1)) assert.doesNotMatch(l, /\s(o|a|e|de|da|do|que|para|com|uma?|em|na|no)$/i, `pendurada: "${l}"`);
    assert.ok(lines.at(-1).split(' ').length >= 2 || lines.length === 1, 'última linha não fica com uma palavra só');
    assert.equal(lines.join(' ').replace(/\s+/g, ' '), 'Eu tenho prazo para sair do cargo de CEO da empresa que fundei', 'nenhum caractere se perde');
  });

  it('fitText devolve um tamanho em que o texto cabe na caixa', () => {
    const r = engine.fitText(ctx, 'Sem ego, sem vaidade', { w: 600, h: 260, font: engine.FONTS.display, minSize: 30, maxSize: 200 });
    assert.equal(r.fits, true);
    assert.ok(r.size >= 30 && r.size <= 200);
    assert.ok(r.height <= 260 && r.width <= 600);
    const tiny = engine.fitText(ctx, 'Uma frase longa demais para caber numa caixa minúscula de teste', { w: 120, h: 40, font: engine.FONTS.display, minSize: 30, maxSize: 60 });
    assert.equal(tiny.fits, false, 'quando não cabe, avisa em vez de esconder');
  });

  it('lint acusa texto sobre rosto e sobre legenda queimada, e aceita texto em área livre', () => {
    const spec = (x, y) => ({ format: 'post_4x5', width: 1080, height: 1350, bg: { kind: 'solid', color: '#0A0A0A' }, scrims: [], layers: [{ id: 't', type: 'text', role: 'main', text: 'Sem ego, sem vaidade', x, y, w: 500, size: 90, font: { ...engine.FONTS.display }, color: '#FAFAFA', align: 'left', lineHeight: 1.05, tracking: 0, shadow: 0 }] });
    const ctxData = { faces: [{ x: 600, y: 200, w: 300, h: 300 }], blocks: [{ x: 100, y: 1000, w: 800, h: 120 }] };
    assert.equal(engine.lint(ctx, spec(620, 220), ctxData).ok, false, 'cobre o rosto');
    assert.equal(engine.lint(ctx, spec(120, 1010), ctxData).ok, false, 'cobre a legenda');
    assert.equal(engine.lint(ctx, spec(120, 600), ctxData).issues.length, 0, 'área livre');
  });

  it('legenda queimada escondida por uma faixa escura deixa de contar; escondida pela metade, continua sendo problema', () => {
    const text = (y) => ({ id: 't', type: 'text', role: 'main', text: 'Sem ego, sem vaidade', x: 120, y, w: 600, size: 90, font: { ...engine.FONTS.display }, color: '#FAFAFA', align: 'left', lineHeight: 1.05, tracking: 0, shadow: 0 });
    const caption = { x: 100, y: 700, w: 700, h: 60 };
    const spec = (scrims) => ({ format: 'post_4x5', width: 1080, height: 1350, bg: { kind: 'solid', color: '#0A0A0A' }, scrims, layers: [text(690)] });
    assert.equal(engine.lint(ctx, spec([]), { blocks: [caption] }).ok, false, 'sem faixa: cobre a legenda');
    const full = [{ side: 'patch', rect: { x: 80, y: 680, w: 740, h: 100 }, strength: 0.95 }];
    assert.equal(engine.lint(ctx, spec(full), { blocks: [caption] }).issues.filter((i) => /legenda/.test(i)).length, 0, 'faixa cobre a legenda inteira');
    const half = [{ side: 'patch', rect: { x: 80, y: 680, w: 740, h: 40 }, strength: 0.95 }];
    assert.equal(engine.lint(ctx, spec(half), { blocks: [caption] }).issues.filter((i) => /legenda/.test(i)).length, 1, 'faixa cobre só metade');
    const weak = [{ side: 'patch', rect: { x: 80, y: 680, w: 740, h: 100 }, strength: 0.4 }];
    assert.equal(engine.lint(ctx, spec(weak), { blocks: [caption] }).issues.filter((i) => /legenda/.test(i)).length, 1, 'faixa fraca não esconde');
  });

  it('texto principal não pode invadir a foto menor que o canvas (inset)', () => {
    const spec = { format: 'post_split', width: 1080, height: 675, bg: { kind: 'solid', color: '#0A0A0A' }, scrims: [], layers: [{ id: 't', type: 'text', role: 'main', text: 'Uma frase longa o bastante para passar da metade', x: 72, y: 200, w: 800, size: 50, font: { ...engine.FONTS.voice }, color: '#FAFAFA', align: 'left', lineHeight: 1.1, tracking: 0, shadow: 0 }] };
    assert.ok(engine.lint(ctx, spec, { insets: [{ x: 300, y: 0, w: 780, h: 675 }] }).issues.some((i) => /invade a foto/.test(i)));
    assert.equal(engine.lint(ctx, spec, { insets: [{ x: 980, y: 0, w: 100, h: 675 }] }).issues.filter((i) => /foto/.test(i)).length, 0);
  });

  it('placeSmall varre a área quando os cantos preferidos estão ocupados e desiste (ok:false) se não há lugar', () => {
    const bounds = { x: 0, y: 0, w: 400, h: 300 };
    const spot = engine.placeSmall({ w: 100, h: 40 }, [{ x: 10, y: 10 }], [{ x: 0, y: 0, w: 200, h: 120 }], bounds);
    assert.equal(spot.ok, true);
    assert.equal(engine.overlap({ x: spot.x, y: spot.y, w: 100, h: 40 }, { x: 0, y: 0, w: 200, h: 120 }), 0);
    assert.equal(engine.placeSmall({ w: 100, h: 40 }, [{ x: 10, y: 10 }], [{ x: 0, y: 0, w: 400, h: 300 }], bounds).ok, false);
  });

  it('emptyRects acha o maior retângulo livre e evita o rosto', () => {
    const rects = engine.emptyRects({ x: 0, y: 0, w: 1000, h: 1000 }, [{ x: 500, y: 0, w: 500, h: 1000 }], { minW: 100, minH: 100 });
    assert.ok(rects.length >= 1);
    assert.ok(rects[0].x + rects[0].w <= 500 + 1, 'fica à esquerda do bloqueio');
  });
});

describe('sanitizador do spec enviado pelo editor', () => {
  const base = { format: 'post_4x5', bg: { kind: 'frame', ref: 'f1' }, scrims: [], layers: [] };
  const allowed = new Set(['f1', 'f2']);

  it('recusa formato desconhecido e quadro de outro episódio', () => {
    assert.throws(() => sanitizeSpec({ ...base, format: 'banner_xx' }, { allowedRefs: allowed }), /Formato/);
    assert.throws(() => sanitizeSpec({ ...base, bg: { kind: 'frame', ref: 'f99' } }, { allowedRefs: allowed }), /quadro/);
    assert.throws(() => sanitizeSpec({ ...base, bg: { kind: 'panels', panels: [{ ref: 'f99', rect: { x: 0, y: 0, w: 100, h: 100 } }] } }, { allowedRefs: allowed }), /painéis/);
    assert.throws(() => sanitizeSpec(null, { allowedRefs: allowed }), /Spec/);
  });

  it('limita números, troca fonte desconhecida, descarta camadas estranhas e cores inválidas', () => {
    const out = sanitizeSpec({
      ...base, dim: 9,
      layers: [
        { id: 'a b', type: 'text', text: 'Olá\u0000 mundo', x: 1e9, y: -1e9, w: 5, size: 5000, font: { family: 'Comic Sans' }, color: 'red', align: 'justify' },
        { id: 'x', type: 'script', text: 'alert(1)' },
        { id: 'r', type: 'rect', x: 10, y: 10, w: 100, h: 10, color: '#C8FF42' },
      ],
    }, { allowedRefs: allowed });
    assert.equal(out.layers.length, 2);
    const t = out.layers[0];
    assert.equal(t.font.family, 'Space Grotesk');
    assert.ok(t.size <= 420 && t.w >= 40);
    assert.ok(Math.abs(t.x) <= 2 * 1080);
    assert.equal(t.color, '#FAFAFA');
    assert.equal(t.align, 'left');
    assert.equal(t.text, 'Olá mundo');
    assert.match(t.id, /^l\d+$/, 'id inválido é regenerado');
    assert.ok(out.dim <= 0.8);
  });
});

describe('construtores: thumbnails e posts passam na conferência', () => {
  const horiz = makeFrame(1, { w: 1280, h: 720, faceX: 0.6 });
  const vert = makeFrame(2, { w: 720, h: 1280, faceX: 0.33, captions: true });
  const vert2 = makeFrame(3, { w: 720, h: 1280, faceX: 0.4 });
  const fmt = (k) => engine.FORMATS[k];

  const clean = (b, name) => {
    const lint = engine.lint(require('../src/services/covers').measureContext(), b.spec, b.ctxData);
    assert.equal(lint.issues.length, 0, `${name}: ${lint.issues.join(' | ')}`);
    assert.ok(b.spec.width > 0 && b.spec.height > 0);
  };

  it('thumbnail 1280x720 com quadro horizontal e com quadro vertical', () => {
    for (const f of [horiz, vert]) {
      const b = designs.buildThumbnail({ frame: f, text: 'Prazo pra sair', label: 'Jonata Rocha', epLabel: 'EP.012' });
      assert.equal(b.spec.width, 1280); assert.equal(b.spec.height, 720);
      clean(b, `thumb ${f.width}x${f.height}`);
    }
  });

  it('post de frase 4:5 respeita rosto e legenda queimada', () => {
    const b = designs.buildQuotePost({ frame: vert, quote: 'Médico que não entende de negócio vira refém do próprio consultório.', who: 'Dr. Márcio Martins', role: 'Empreendedorismo médico', epLabel: 'EP.012' });
    assert.equal(b.spec.width, fmt('post_4x5').w);
    clean(b, 'quote');
  });

  it('tela dividida e carrossel: formatos certos e nenhum problema', () => {
    const split = designs.buildSplitPost({ top: { frame: vert, quote: 'Sem ego, sem vaidade.' }, bottom: { frame: vert2, quote: 'O prazo para sair já está marcado.' }, epLabel: 'EP.012' });
    clean(split, 'split');
    const slides = designs.buildCarousel({ coverFrame: horiz, title: 'Prazo pra sair.', quotes: ['Sem ego, sem vaidade.', 'O prazo para sair já está marcado.', 'Governança é cultura.'], who: 'Jonata Rocha', role: 'Empresário', epLabel: 'EP.012' });
    assert.ok(slides.length >= 4);
    slides.forEach((s, i) => clean(s, `slide ${i + 1}`));
  });
});

describe('construtores com legenda queimada e foto vertical', () => {
  const covers = require('../src/services/covers');
  const lint = (b) => engine.lint(covers.measureContext(), b.spec, b.ctxData);
  const portrait = (id, faceX) => makeFrame(id, { w: 720, h: 1280, faceX, captions: true });

  it('tela dividida com fotos verticais: foto inteira de um lado, frase do outro, sem invadir a foto', () => {
    const b = designs.buildSplitPost({ top: { frame: portrait(1, 0.3), quote: 'A gente quer melhorar a mentalidade não só dos militares, mas de todos os jovens.' }, bottom: { frame: portrait(2, 0.4), quote: 'Eu tenho prazo pra sair da cadeira do CEO.' }, epLabel: 'EP.012' });
    assert.equal(lint(b).issues.length, 0, lint(b).issues.join(' | '));
    assert.equal(b.ctxData.insets.length, b.spec.bg.panels.filter((p) => p.bg.fit === 'contain').length, 'cada foto "contain" vira uma zona proibida para o texto');
    const mctx = covers.measureContext();
    for (const l of b.spec.layers.filter((x) => x.role === 'main')) for (const r of b.ctxData.insets) assert.equal(engine.overlap(engine.layerBox(mctx, l), r), 0, 'texto fora da foto');
  });

  it('post de frase: a faixa escura sobe para cobrir a legenda queimada (nunca por cima do rosto)', () => {
    const b = designs.buildQuotePost({ frame: portrait(3, 0.3), quote: 'Médico que não entende de negócio vira refém do próprio consultório.', who: 'Dr. Márcio Martins', role: 'Empreendedorismo médico', epLabel: 'EP.012' });
    assert.equal(lint(b).issues.length, 0, lint(b).issues.join(' | '));
    const mctx = covers.measureContext();
    for (const l of b.spec.layers.filter((x) => x.role === 'main')) for (const f of b.ctxData.faces) assert.equal(engine.overlap(engine.layerBox(mctx, l), f), 0);
  });

  it('capa vertical (Reels/TikTok) com legenda queimada passa na conferência', () => {
    const b = designs.buildReelCover({ frame: portrait(4, 0.35), text: 'Prazo pra sair', label: 'Jonata Rocha', epLabel: 'EP.012' });
    assert.equal(lint(b).issues.length, 0, lint(b).issues.join(' | '));
  });

  it('análises antigas (caixas em 0–1000 ou pixels) são normalizadas ao ler os quadros', async () => {
    const store = require('../src/services/coverStore');
    await h.resetDb();
    const { rows: [e] } = await h.db.query("INSERT INTO episodes (number, title, status) VALUES (1, 'x', 'em_finalizacao') RETURNING id");
    await h.db.query("INSERT INTO episode_frames (episode_id, at_ms, storage_key, width, height, analysis, score) VALUES ($1,0,'pp/a.jpg',1080,1920,$2,5), ($1,1,'pp/b.jpg',1080,1920,$3,5), ($1,2,'pp/c.jpg',1080,1920,$4,5)", [e.id,
      JSON.stringify({ rostos: [{ x: 288, y: 181, w: 472, h: 303 }], caixas_de_texto: [{ x: 242, y: 526, w: 521, h: 32 }] }),
      JSON.stringify({ rostos: [{ x: 0.288, y: 0.181, w: 0.472, h: 0.303 }], caixas_de_texto: [] }),
      JSON.stringify({ rostos: [{ x: 311, y: 348, w: 509, h: 582 }], caixas_de_texto: [] })]);
    const [a, b, c] = await store.loadFrames(e.id);
    assert.deepEqual(a.analysis.rostos[0], { x: 0.288, y: 0.181, w: 0.472, h: 0.303 }, '0–1000 vira 0–1');
    assert.deepEqual(b.analysis.rostos[0], { x: 0.288, y: 0.181, w: 0.472, h: 0.303 }, 'o que já está em 0–1 não muda');
    assert.ok(c.analysis.rostos[0].w <= 1 && c.analysis.rostos[0].x < 1);
    await h.db.query('DELETE FROM episodes WHERE id=$1', [e.id]);
  });
});

describe('capas e posts do episódio (rotas, B2 e permissões)', () => {
  let app; const as = {}; let ep; let frames;
  const hdr = async (c) => ({ accept: 'application/json', 'content-type': 'application/json', 'x-csrf-token': await c.csrf('/episodios') });
  const json = async (c, method, path, body) => {
    const res = await c.req(method, path, { headers: await hdr(c) });
    return res;
  };
  const postJson = async (c, path, body) => {
    const r = await fetch(`${app.base}${path}`, { method: 'POST', headers: { cookie: c.cookie(), ...(await hdr(c)) }, body: JSON.stringify(body), redirect: 'manual' });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* html */ }
    return { status: r.status, json: j, text };
  };
  const covers = () => h.db.query('SELECT * FROM episode_covers WHERE episode_id=$1 ORDER BY kind, position, id', [ep.id]).then((r) => r.rows);

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    for (const [k, role] of [['admin', 'superadmin'], ['gestao', 'gestao'], ['editor', 'editor_video'], ['prod', 'produtora']]) {
      await h.createUser({ name: k, email: `${k}@t.com`, role });
      as[k] = h.client(app.base); await as[k].login(`${k}@t.com`);
    }
    const { rows: [e] } = await h.db.query("INSERT INTO episodes (number, title, status) VALUES (12, 'Conversa com Jonata Rocha', 'em_finalizacao') RETURNING *");
    ep = e;
    const fr = [
      makeFrame(0, { w: 720, h: 1280, faceX: 0.33, at: 3000, score: 8 }), makeFrame(0, { w: 720, h: 1280, faceX: 0.4, at: 20000, score: 7, captions: true }),
      makeFrame(0, { w: 720, h: 1280, faceX: 0.3, at: 41000, score: 6.5 }), makeFrame(0, { w: 720, h: 1280, faceX: 0.45, at: 70000, score: 6 }),
    ];
    frames = [];
    for (const f of fr) {
      const key = `pp/episodios/${ep.id}/quadros/${f.at_ms}.jpg`;
      h.b2Store.set(key, { body: f.buffer, contentType: 'image/jpeg' });
      const { rows: [row] } = await h.db.query('INSERT INTO episode_frames (episode_id, at_ms, storage_key, width, height, analysis, score) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [ep.id, f.at_ms, key, f.width, f.height, JSON.stringify(f.analysis), f.score]);
      frames.push(row);
    }
    const sug = {
      thumbnail_texts: [{ texto: 'Prazo pra sair' }, { texto: 'Sem ego, sem vaidade' }, { texto: 'Novo CEO em 2031' }],
      quotes: [{ frase: 'Sem ego, sem vaidade nunca atrapalha ninguém.', at_ms: 3000, quem: 'Jonata Rocha' }, { frase: 'O prazo para sair do cargo já está marcado.', at_ms: 41000 }, { frase: 'Governança é cultura que se constrói.', at_ms: 70000 }, { frase: 'Quem planeja a saída lidera melhor.', at_ms: 20000 }],
    };
    await h.db.query('INSERT INTO episode_metadata (episode_id, suggestions, thumb_text) VALUES ($1,$2,$3)', [ep.id, JSON.stringify(sug), 'Prazo pra sair']);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('quem gerencia gera thumbnails, posts de frase, tela dividida e carrossel, guardados no B2', async () => {
    const csrf = await as.gestao.csrf('/episodios');
    const res = await as.gestao.post(`/episodios/${ep.id}/capas/gerar`, { _csrf: csrf });
    assert.equal(res.status, 302, res.text);
    const all = await covers();
    const by = (k) => all.filter((c) => c.kind === k);
    assert.equal(by('youtube_thumb').length, 3);
    assert.equal(by('post_quote').length, 2);
    assert.equal(by('post_split').length, 1);
    assert.ok(by('carousel').length >= 4);
    for (const c of all) {
      assert.ok(h.b2Store.has(c.storage_key), `${c.kind} está no bucket`);
      assert.ok(c.storage_key.startsWith(`pp/episodios/${ep.id}/capas/`));
      const jpg = h.b2Store.get(c.storage_key).body;
      assert.equal(jpg[0], 0xff); assert.equal(jpg[1], 0xd8);
      assert.deepEqual(c.lint.issues, [], `${c.kind} ${c.position}: ${(c.lint.issues || []).join(' | ')}`);
    }
    for (const t of by('youtube_thumb')) { assert.equal(t.width, 1280); assert.equal(t.height, 720); assert.ok(t.size_bytes < 2 * 1024 * 1024, 'abaixo de 2 MB (limite do YouTube)'); }
    assert.ok(by('post_quote').every((c) => c.width === 1080 && c.height === 1350));
    assert.equal(new Set(by('carousel').map((c) => c.group_key)).size, 1, 'um carrossel só');
  });

  it('gerar de novo troca o que era automático e apaga as imagens antigas do bucket', async () => {
    const before = await covers();
    const oldKeys = before.map((c) => c.storage_key);
    await as.gestao.post(`/episodios/${ep.id}/capas/gerar`, { _csrf: await as.gestao.csrf('/episodios') });
    const after = await covers();
    assert.equal(after.length, before.length);
    assert.ok(oldKeys.every((k) => !h.b2Store.has(k)), 'imagens antigas removidas do B2');
    assert.ok(after.every((c) => h.b2Store.has(c.storage_key)));
  });

  it('a imagem sai por link assinado do B2 e o download vem com nome de arquivo', async () => {
    const [c] = await covers();
    const r = await as.gestao.get(`/episodios/${ep.id}/capas/${c.id}/imagem`);
    assert.equal(r.status, 302);
    assert.match(r.location, /backblazeb2|b2|X-Amz-Signature/i);
    const d = await as.gestao.get(`/episodios/${ep.id}/capas/${c.id}/imagem?baixar=1`);
    assert.match(decodeURIComponent(d.location), /ep012-.*\.jpg/);
    assert.equal((await as.gestao.get(`/episodios/${ep.id}/capas/999999/imagem`)).status, 404);
    assert.equal((await as.gestao.get(`/episodios/abc/capas/${c.id}/imagem`)).status, 404);
  });

  it('permissões: produtora não gera nem edita; editor edita mas não aprova; só gestão aprova', async () => {
    const [c] = await covers();
    const prodGen = await as.prod.post(`/episodios/${ep.id}/capas/gerar`, { _csrf: await as.prod.csrf('/episodios') });
    assert.equal(prodGen.status, 403);
    assert.equal((await as.prod.get(`/episodios/${ep.id}/capas/${c.id}/editar`)).status, 403);
    const prodSave = await postJson(as.prod, `/episodios/${ep.id}/capas/${c.id}`, { spec: c.spec, ctx: c.ctx });
    assert.equal(prodSave.status, 403);
    assert.equal((await as.editor.get(`/episodios/${ep.id}/capas/${c.id}/editar`)).status, 200);
    const edApprove = await as.editor.post(`/episodios/${ep.id}/capas/${c.id}/aprovar`, { _csrf: await as.editor.csrf('/episodios') });
    assert.equal(edApprove.status, 403);
  });

  it('aprovar uma thumbnail desmarca as outras e grava a escolha nos metadados', async () => {
    const thumbs = (await covers()).filter((c) => c.kind === 'youtube_thumb');
    const [a, b] = thumbs;
    await as.gestao.post(`/episodios/${ep.id}/capas/${a.id}/aprovar`, { _csrf: await as.gestao.csrf('/episodios') });
    await as.gestao.post(`/episodios/${ep.id}/capas/${b.id}/aprovar`, { _csrf: await as.gestao.csrf('/episodios') });
    const now = (await covers()).filter((c) => c.kind === 'youtube_thumb');
    assert.deepEqual(now.filter((c) => c.approved).map((c) => c.id), [b.id], 'só uma thumbnail aprovada');
    assert.equal((await h.db.query('SELECT thumb_cover_id FROM episode_metadata WHERE episode_id=$1', [ep.id])).rows[0].thumb_cover_id, b.id);
    await as.gestao.post(`/episodios/${ep.id}/capas/${b.id}/aprovar`, { _csrf: await as.gestao.csrf('/episodios'), aprovar: '0' });
    assert.equal((await h.db.query('SELECT thumb_cover_id FROM episode_metadata WHERE episode_id=$1', [ep.id])).rows[0].thumb_cover_id, null);
  });

  it('a edição salva troca a imagem, apaga a antiga e devolve a conferência', async () => {
    const c = (await covers()).find((x) => x.kind === 'post_quote');
    const spec = JSON.parse(JSON.stringify(c.spec));
    const main = spec.layers.find((l) => l.role === 'main');
    main.text = 'Texto editado na mão.';
    const res = await postJson(as.editor, `/episodios/${ep.id}/capas/${c.id}`, { spec, ctx: c.ctx });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.ok, true);
    assert.ok(Array.isArray(res.json.lint.issues));
    const now = (await covers()).find((x) => x.id === c.id);
    assert.notEqual(now.storage_key, c.storage_key);
    assert.ok(h.b2Store.has(now.storage_key));
    assert.ok(!h.b2Store.has(c.storage_key), 'a imagem antiga saiu do bucket');
    assert.equal(now.auto, false, 'depois de editada, deixa de ser automática');
    assert.equal(now.spec.layers.find((l) => l.role === 'main').text, 'Texto editado na mão.');
  });

  it('a edição recusa quadro de outro episódio, formato trocado e CSRF ausente', async () => {
    const c = (await covers()).find((x) => x.kind === 'post_quote');
    const bad = JSON.parse(JSON.stringify(c.spec)); bad.bg = { kind: 'frame', ref: 'f999999' };
    assert.equal((await postJson(as.gestao, `/episodios/${ep.id}/capas/${c.id}`, { spec: bad })).status, 400);
    const other = JSON.parse(JSON.stringify(c.spec)); other.format = 'youtube_thumb';
    assert.equal((await postJson(as.gestao, `/episodios/${ep.id}/capas/${c.id}`, { spec: other })).status, 400);
    const r = await fetch(`${app.base}/episodios/${ep.id}/capas/${c.id}`, { method: 'POST', headers: { cookie: as.gestao.cookie(), 'content-type': 'application/json' }, body: JSON.stringify({ spec: c.spec }) });
    assert.equal(r.status, 403, 'sem token CSRF');
  });

  it('imagem própria como fundo: aceita JPG/PNG, marca como enviada e não conferida, entra no editor e pode ser salva na capa', async () => {
    const png = createCanvas(900, 1200); const g = png.getContext('2d'); g.fillStyle = '#335'; g.fillRect(0, 0, 900, 1200); g.fillStyle = '#eec'; g.beginPath(); g.ellipse(450, 400, 150, 190, 0, 0, Math.PI * 2); g.fill();
    const send = (c, body, type = 'image/png') => fetch(`${app.base}/episodios/${ep.id}/capas/imagem`, { method: 'POST', headers: { cookie: c.cookie(), 'x-csrf-token': c.__token, 'content-type': type, accept: 'application/json' }, body });
    for (const c of Object.values(as)) c.__token = await c.csrf('/episodios');
    assert.equal((await send(as.prod, png.toBuffer('image/png'))).status, 403, 'produtora não envia');
    const bad = await send(as.gestao, Buffer.from('isto não é uma imagem'), 'text/plain');
    assert.equal(bad.status, 400); assert.match((await bad.json()).error, /abrir esta imagem/);
    const tiny = createCanvas(100, 100); tiny.getContext('2d').fillRect(0, 0, 100, 100);
    assert.equal((await send(as.gestao, tiny.toBuffer('image/png'))).status, 400);
    const ok = await send(as.editor, png.toBuffer('image/png'));
    assert.equal(ok.status, 200);
    const { frame } = await ok.json();
    assert.equal(frame.analysis.custom, true); assert.equal(frame.analysis.unchecked, true, 'sem IA configurada: não conferida');
    assert.ok(frame.width <= 2400);
    const row = (await h.db.query('SELECT * FROM episode_frames WHERE id=$1', [frame.id])).rows[0];
    assert.ok(h.b2Store.has(row.storage_key)); assert.equal(h.b2Store.get(row.storage_key).body[0], 0xff, 'guardada como JPEG');

    const c = (await covers()).find((x) => x.kind === 'post_quote');
    const page = await as.gestao.get(`/episodios/${ep.id}/capas/${c.id}/editar`);
    const data = JSON.parse(page.text.match(/<script type="application\/json" id="editor-data">([\s\S]*?)<\/script>/)[1]);
    assert.ok(data.frames.some((f) => f.ref === frame.ref && f.analysis.custom), 'aparece no seletor de fundo do editor');
    assert.match(data.uploadUrl, /^\/capas\/imagem\?episodio=\d+$/);
    const spec = JSON.parse(JSON.stringify(c.spec)); spec.bg = { kind: 'frame', ref: frame.ref, fit: 'cover', zoom: 1, cx: 0.5, cy: 0.5, align: 'center' };
    const saved = await postJson(as.gestao, `/episodios/${ep.id}/capas/${c.id}`, { spec, ctx: { faces: [], blocks: [], insets: [] } });
    assert.equal(saved.status, 200, saved.text);

    const framesOnPage = (await as.gestao.get(`/episodios/${ep.id}`)).text;
    assert.doesNotMatch(framesOnPage, new RegExp(`quadros/${frame.id}"`), 'não aparece entre os quadros do vídeo');
    await as.gestao.post(`/episodios/${ep.id}/capas/gerar`, { _csrf: await as.gestao.csrf('/episodios') });
    assert.equal((await h.db.query('SELECT count(*)::int n FROM episode_frames WHERE id=$1', [frame.id])).rows[0].n, 1, 'gerar de novo não apaga a imagem enviada');
  });

  it('o editor mostra o spec, os quadros e carrega o motor de design; excluir remove a imagem do B2', async () => {
    const c = (await covers()).find((x) => x.kind === 'post_split');
    const page = await as.gestao.get(`/episodios/${ep.id}/capas/${c.id}/editar`);
    assert.equal(page.status, 200);
    assert.match(page.text, /id="editor-data"/);
    assert.match(page.text, /\/static\/design\/engine\.js/);
    assert.match(page.text, /\/static\/editor\.js/);
    const data = JSON.parse(page.text.match(/<script type="application\/json" id="editor-data">([\s\S]*?)<\/script>/)[1]);
    assert.equal(data.frames.filter((f) => !f.analysis.custom).length, 4);
    assert.equal(data.saveUrl, `/capas/${c.id}`);
    const del = await as.gestao.post(`/episodios/${ep.id}/capas/${c.id}/excluir`, { _csrf: await as.gestao.csrf('/episodios') });
    assert.equal(del.status, 302);
    assert.ok(!h.b2Store.has(c.storage_key));
    assert.equal((await covers()).some((x) => x.id === c.id), false);
  });

  it('a página do episódio lista as capas e os arquivos estáticos do editor existem', async () => {
    const page = await as.gestao.get(`/episodios/${ep.id}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Thumbnail do YouTube/);
    assert.doesNotMatch(page.text, /Tela dividida|Carrossel/, 'posts e carrosséis ficam em Conteúdo, não no card do episódio');
    assert.match(page.text, /\/capas\/\d+\/imagem/);
    for (const f of ['/static/editor.js', '/static/design/engine.js']) {
      const m = page.text.match(/(?:src|href)="(\/static\/[^"]*)"/g) || [];
      const direct = await as.gestao.get(f);
      assert.equal(direct.status, 200, f);
      assert.ok(m.length > 0);
    }
  });
});
