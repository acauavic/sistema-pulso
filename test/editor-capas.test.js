const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const h = require('./helpers');
const covers = require('../src/services/covers');
const E = require('../src/public/design/engine');
const M = require('../src/public/design/models');
const sheets = require('../src/services/coverSheet');
const { sanitizeSpec } = require('../src/services/specSanitizer');

// Quadro sintético com um "rosto" (elipse clara) onde a análise diz que ele está.
function frameImage(w = 1920, hgt = 1080, face = { x: 0.5, y: 0.2, w: 0.16, h: 0.34 }) {
  const c = createCanvas(w, hgt); const g = c.getContext('2d');
  g.fillStyle = '#23323a'; g.fillRect(0, 0, w, hgt);
  g.fillStyle = '#d9b49a'; g.beginPath(); g.ellipse((face.x + face.w / 2) * w, (face.y + face.h / 2) * hgt, (face.w * w) / 2, (face.h * hgt) / 2, 0, 0, Math.PI * 2); g.fill();
  return { buffer: c.toBuffer('image/jpeg', 88), face };
}
const RICARDO = { guest: 'Ricardo Nascimento', ep: '018', axis: 'Negócios', tag: 'Abrir clínica', pre: 'O imóvel pode', hl: 'fechar', post: 'sua clínica', setup: 'Escolheu o imóvel', punch: 'errado?', num: '3', line: 'erros ao escolher o imóvel', quote: 'Reforma não salva imóvel errado.', hook: 'O imóvel que pode fechar sua clínica', sub: 'Como abrir com segurança.' };
const pixels = (spec, images = {}) => { const c = createCanvas(spec.width, spec.height); E.render(c.getContext('2d'), spec, images, { makeCanvas: (w, hh) => createCanvas(w, hh) }); return c.getContext('2d').getImageData(0, 0, spec.width, spec.height).data; };
const differ = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) n += 1; return n; };

describe('Editor completo: o motor e as contas da foto', () => {
  const ctx = covers.measureContext();

  it('palavra em destaque também ganha contorno e sombra (antes, só a cor mudava)', () => {
    const base = { format: 'youtube_thumb', width: 640, height: 240, bg: { kind: 'solid', color: '#0A0A0A' }, scrims: [] };
    const text = { id: 't', type: 'text', css: true, text: 'O imóvel pode fechar', x: 20, y: 40, w: 600, size: 64, font: { family: 'Space Grotesk', weight: 700 }, color: '#FAFAFA', align: 'left', lineHeight: 1, tracking: -0.04, marks: { words: [3], color: '#C8FF42' } };
    const plain = pixels({ ...base, layers: [text] });
    assert.ok(differ(plain, pixels({ ...base, layers: [{ ...text, stroke: { width: 0.06, color: '#2D1B4E' } }] })) > 500, 'o contorno aparece');
    assert.ok(differ(plain, pixels({ ...base, layers: [{ ...text, shadow: 1, shadowAngle: 45, shadowDistance: 1 }] })) > 500, 'a sombra aparece');
    assert.equal(differ(plain, pixels({ ...base, layers: [{ ...text }] })), 0, 'sem contorno nem sombra, sai igual');
  });

  it('espelhar a foto inverte só a imagem, dentro do painel', () => {
    const img = createCanvas(200, 100); const g = img.getContext('2d'); g.fillStyle = '#ff0000'; g.fillRect(0, 0, 100, 100); g.fillStyle = '#0000ff'; g.fillRect(100, 0, 100, 100);
    const spec = (mirror) => ({ format: 'youtube_thumb', width: 200, height: 100, bg: { kind: 'solid', color: '#000000' }, scrims: [], layers: [{ id: 'foto', type: 'photo', ref: 'f1', x: 0, y: 0, w: 200, h: 100, img: { x: 0, y: 0, w: 200, h: 100 }, fade: 0, shape: 'rect', ...(mirror ? { mirror: true } : {}) }] });
    const at = (px, x) => [px[(50 * 200 + x) * 4], px[(50 * 200 + x) * 4 + 2]];
    const normal = pixels(spec(false), { f1: img }); const flipped = pixels(spec(true), { f1: img });
    assert.deepEqual(at(normal, 20), [255, 0]); assert.deepEqual(at(flipped, 20), [0, 255], 'a esquerda virou azul');
    assert.deepEqual(at(flipped, 180), [255, 0], 'a direita virou vermelha');
  });

  it('as zonas de rosto seguem o zoom, o enquadramento e o espelho; a foto nunca deixa buraco no painel', () => {
    const photo = { ref: 'f1', w: 1920, h: 1080, face: { x: 0.57, y: 0.37, h: 0.35 } };
    const built = M.build(ctx, 'YT-B', RICARDO, photo, {});
    const info = () => ({ face: photo.face });
    const [same] = M.facesOf(built.spec, info);
    assert.ok(Math.abs(same.x - built.ctxData.faces[0].x) < 1 && Math.abs(same.w - built.ctxData.faces[0].w) < 1, 'igual à zona que o modelo marca');
    const ph = built.spec.layers.find((l) => l.type === 'photo');
    const sc = M.photoScale(ph, photo);
    assert.ok(Math.abs(sc.zoom - 1) < 0.5 && sc.min > 0);
    const big = M.placePhoto(ph, photo, { s: sc.s * 1.5, x: ph.img.x - 300, y: ph.img.y - 200 });
    const [zoomed] = M.facesOf({ layers: [{ ...ph, ...big }] }, info);
    assert.ok(zoomed.w > same.w * 1.25, 'a zona cresce com o zoom (a folga de 36 px em volta é fixa)');
    const mirrored = M.facesOf({ layers: [{ ...ph, mirror: true }] }, info)[0];
    assert.notEqual(Math.round(mirrored.x), Math.round(same.x), 'espelhada, a zona troca de lugar');
    const far = M.placePhoto(ph, photo, { s: 0.01, x: 99999, y: -99999 });
    assert.ok(far.img.x <= 0 && far.img.x + far.img.w >= ph.w - 1, 'cobre o painel dos lados'); assert.ok(far.img.y + far.img.h >= ph.h - 1, 'e embaixo');
    assert.ok(M.placePhoto(ph, photo, { s: sc.s, x: 0, y: 9999 }).img.y <= ph.h * 0.22 + 1, 'no alto, no máximo 22% de folga');
    assert.ok(E.layerBox(ctx, { type: 'pulse', x: 10, y: 50, w: 200, beat: 9 }).h === 18, 'a linha de pulso tem área de toque');
  });
});

describe('Editor completo: o servidor confere o desenho de um modelo', () => {
  const ctx = covers.measureContext();
  const photo = { ref: 'f1', w: 1920, h: 1080, face: { x: 0.57, y: 0.37, h: 0.35 } };
  const allowed = new Set(['f1', 'f2']);

  it('foto, tarja, degradê, pontos, linha de pulso e rótulos contornados passam inteiros', () => {
    for (const id of ['YT-B', 'YT-C', 'YT-A+', 'SP-C', 'RL-A']) {
      const b = M.build(ctx, id, { ...RICARDO, creds: ['Arquiteto', 'Clínicas'] }, photo, {});
      const out = sanitizeSpec(JSON.parse(JSON.stringify(b.spec)), { allowedRefs: allowed, base: b.spec });
      assert.deepEqual(out.layers.map((l) => l.type), b.spec.layers.map((l) => l.type), `${id}: nenhuma camada some`);
      assert.equal(differ(pixels(b.spec), pixels(out)), 0, `${id}: o desenho continua idêntico`);
    }
    const plus = sanitizeSpec(M.build(ctx, 'YT-A+', { ...RICARDO, creds: ['Arquiteto', 'Clínicas'] }, photo, {}).spec, { allowedRefs: allowed, base: { model: 'YT-A+' } });
    const chip = plus.layers.find((l) => l.id === 'cred1').chip;
    assert.deepEqual([chip.color, chip.stroke, chip.strokeWidth], ['none', '#FAFAFA', 2], 'a credencial contornada continua contornada');
  });

  it('o que é do modelo vem da capa guardada; foto de outro episódio é recusada; peso e transparência são conferidos', () => {
    const b = M.build(ctx, 'SP-A', RICARDO, photo, {});
    const base = { ...b.spec, angle: null, photo: { ref: 'f1', face: { x: 0.5, y: 0.4, h: 0.3 } } };
    const sent = JSON.parse(JSON.stringify(b.spec));
    Object.assign(sent, { model: 'YT-G', scale: 1, safe: { l: 0, r: 0, t: 0, b: 0 }, sheet: { hook: 'hack' }, photo: { ref: 'f2' } });
    sent.layers.find((l) => l.id === 'nome').font = { family: 'Inter', weight: 800 };
    sent.layers.find((l) => l.id === 'nome').alpha = 0.5;
    const out = sanitizeSpec(sent, { allowedRefs: allowed, base });
    assert.deepEqual([out.model, out.scale, out.edited], ['SP-A', 3, true], 'modelo e escala do arquivo (3000 px) são da capa guardada');
    assert.deepEqual(out.sheet, b.spec.sheet);
    assert.deepEqual(out.photo, { ref: 'f1', face: { x: 0.5, y: 0.4, h: 0.3 } }, 'a mesma foto mantém o rosto marcado');
    const nome = out.layers.find((l) => l.id === 'nome');
    assert.deepEqual([nome.font.weight, nome.alpha], [600, 0.5], 'peso que não existe vira o mais perto hospedado');
    sent.layers.find((l) => l.type === 'photo').ref = 'f2';
    assert.deepEqual(sanitizeSpec(sent, { allowedRefs: allowed, base }).photo, { ref: 'f2' }, 'foto trocada: o rosto volta a ser o da análise');
    sent.layers.find((l) => l.type === 'photo').ref = 'f99';
    assert.throws(() => sanitizeSpec(sent, { allowedRefs: allowed, base }), /não é deste episódio/);
    const legacy = sanitizeSpec({ ...b.spec, layers: b.spec.layers }, { allowedRefs: allowed });
    assert.equal(legacy.model, undefined, 'sem a capa guardada de um modelo, nada de modelo');
  });
});

describe('Editor completo nas rotas (episódio e corte)', () => {
  const as = {}; let app; let ep;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const SEGS = [{ start_ms: 0, end_ms: 4000, text: 'Hoje a gente fala de imóvel para clínica.' }, { start_ms: 2537000, end_ms: 2541000, text: 'Olha, reforma não salva imóvel errado.' }];
  const ANSWER = {
    guest: 'Ricardo Nascimento', tag: 'Abrir clínica', axis: 'Negócios', creds: ['Arquiteto', 'Clínicas'], spotify_hook: 'O imóvel que pode fechar sua clínica',
    quote: { text: 'Reforma não salva imóvel errado.' },
    angles: [
      { angle: 'curiosidade', pre: 'O imóvel pode', hl: 'fechar', post: 'sua clínica', model: 'YT-B' },
      { angle: 'contraste', pre: 'Reforma não', hl: 'salva', post: 'imóvel errado', setup: 'Não é', punch: 'reforma.' },
      { angle: 'autoridade', pre: 'O erro que', hl: 'fecha', post: 'clínicas', setup: 'Não é', punch: 'sorte.' },
    ],
  };
  let token;
  const save = (id, body, who = as.prod) => fetch(`${app.base}/capas/${id}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', cookie: who.cookie(), 'x-csrf-token': token }, body: JSON.stringify(body) });
  const cover = async (where, params) => (await q(`SELECT * FROM episode_covers WHERE ${where}`, params))[0];

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    const [g] = await q("INSERT INTO guests (name, profile, status, job_title) VALUES ('Ricardo Nascimento', 'empresario', 'gravado', 'Arquiteto de clínicas') RETURNING id");
    [ep] = await q("INSERT INTO episodes (number, title, status, guest_id) VALUES (18, 'Como escolher o imóvel certo', 'pronto_publicar', $1) RETURNING *", [g.id]);
    await q('INSERT INTO episode_transcripts (episode_id, text, segments, duration_ms) VALUES ($1, $2, $3, 3600000)', [ep.id, SEGS.map((s) => s.text).join(' '), JSON.stringify(SEGS)]);
    const b2 = require('../src/services/b2');
    for (let i = 0; i < 3; i += 1) {
      const f = frameImage(1920, 1080, { x: 0.5 - i * 0.1, y: 0.2, w: 0.16, h: 0.34 });
      const key = await b2.keyFor('episodios', ep.id, 'quadros', `q${i}.jpg`);
      await b2.putObject(key, f.buffer, 'image/jpeg');
      await q('INSERT INTO episode_frames (episode_id, at_ms, storage_key, width, height, analysis, score) VALUES ($1,$2,$3,1920,1080,$4,$5)', [ep.id, 600000 * (i + 1), key, JSON.stringify({ rostos: [f.face], caixas_de_texto: [] }), 9 - i]);
    }
    await sheets.save(ep.id, sheets.normalize(ANSWER, { transcript: { text: SEGS.map((s) => s.text).join(' '), segments: SEGS } }));
    const r = await as.gestao.act(`/episodios/${ep.id}/capas/gerar`, { pecas: '1' }, { from: `/episodios/${ep.id}` });
    assert.equal(r.status, 302);
    token = await as.prod.csrf('/episodios');
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('o cartão tem um Editar só, com o editor completo e o ajuste pelo modelo; o editor abre a capa do modelo inteira', async () => {
    const c = await cover("episode_id = $1 AND angle = 'curiosidade'", [ep.id]);
    assert.equal(c.model, 'YT-B');
    const page = (await as.prod.get(`/episodios/${ep.id}?capas=youtube`)).text;
    assert.match(page, new RegExp(`href="/episodios/${ep.id}/capas/${c.id}/editar"><b>Editor completo</b>`));
    assert.match(page, new RegExp(`data-ajustar-open="/capas/${c.id}/ajustar"><b>Ajustar pelo modelo</b>`));
    const ed = await as.prod.get(`/episodios/${ep.id}/capas/${c.id}/editar`);
    assert.equal(ed.status, 200);
    for (const s of ['/static/design/engine.js', '/static/design/models.js', '/static/editor.js', '/static/capas.js', 'id="modal-ajustar"', 'Ajustar pelo modelo', 'Tarja lime', 'YT-B', 'CURIOSIDADE', 'Foto e fundo']) assert.ok(ed.text.includes(s), s);
    assert.match(ed.text, new RegExp(`data-ajustar-back="/capas/${c.id}/editar"`));
    assert.doesNotMatch(ed.text, /style="/);
    const data = JSON.parse(ed.text.match(/<script type="application\/json" id="editor-data">([\s\S]*?)<\/script>/)[1]);
    assert.equal(data.model, true);
    assert.deepEqual(data.weights['Space Grotesk'], [400, 500, 600, 700]);
    assert.ok(data.spec.layers.some((l) => l.type === 'photo' && l.ref) && data.spec.layers.some((l) => l.type === 'tarja'), 'a foto e a tarja chegam ao editor');
    for (const f of ['/static/editor.js', '/static/design/models.js']) assert.equal((await as.prod.get(f)).status, 200, f);
  });

  it('salvar no editor completo: texto, cor, tamanho, posição e zoom da foto mudam; o modelo, a aprovação e as regras das peças ficam', async () => {
    const c = await cover("episode_id = $1 AND angle = 'curiosidade'", [ep.id]);
    await as.gestao.act(`/episodios/${ep.id}/capas/${c.id}/aprovar`, { aprovar: '1' }, { from: `/episodios/${ep.id}` });
    const spec = JSON.parse(JSON.stringify(c.spec));
    const tarja = spec.layers.find((l) => l.id === 'destaque');
    tarja.text = 'quebrar'; tarja.bg = '#FAFAFA'; tarja.size = 120;
    const logo = spec.layers.find((l) => l.type === 'wordmark'); logo.x += 40; logo.y -= 20;
    const ph = spec.layers.find((l) => l.type === 'photo');
    const fr = (await q('SELECT width, height FROM episode_frames WHERE id = $1', [Number(ph.ref.slice(1))]))[0];
    Object.assign(ph, M.placePhoto(ph, { w: fr.width, h: fr.height }, { s: (ph.img.w / fr.width) * 1.2, x: ph.img.x - 60, y: ph.img.y - 40 }));
    ph.mirror = true;
    spec.layers.push({ id: 'novo1', type: 'text', role: 'deco', css: true, text: 'NOVO', x: 900, y: 80, w: 300, size: 40, font: { family: 'JetBrains Mono', weight: 500 }, color: '#C8FF42' });
    const res = await save(c.id, { spec, ctx: { faces: [] } });
    assert.equal(res.status, 200, await res.clone().text());
    const json = await res.json();
    assert.equal(typeof json.lint.reads, 'boolean', 'o teste de redução roda ao salvar');
    const now = await cover('id = $1', [c.id]);
    assert.deepEqual([now.model, now.approved, now.auto, now.spec.edited, now.spec.model, now.spec.angle], ['YT-B', true, false, true, 'YT-B', 'curiosidade']);
    assert.deepEqual(now.spec.layers.map((l) => l.type), spec.layers.map((l) => l.type), 'nenhuma camada some');
    const t2 = now.spec.layers.find((l) => l.id === 'destaque');
    assert.deepEqual([t2.text, t2.bg, t2.size], ['quebrar', '#FAFAFA', 120]);
    assert.equal(now.spec.layers.find((l) => l.type === 'photo').mirror, true);
    assert.match(now.label, /^Curiosidade: .*quebrar/, 'a etiqueta segue o texto da imagem');
    assert.notEqual(now.storage_key, c.storage_key, 'a imagem foi refeita');
    assert.equal(now.ctx.faces.length, 1); assert.equal(now.ctx.faces[0].oval, true, 'o rosto sai da foto do desenho, não do navegador');
    assert.deepEqual([now.width, now.height], [1280, 720]);
    const info = JSON.parse((await as.prod.get(`/capas/${c.id}/ajustar`)).text);
    assert.equal(info.cover.edited, true, 'a janela Ajustar sabe que a capa foi mexida (e avisa antes de montar de novo)');
  });

  it('a capa do Spotify editada continua saindo em 3000×3000 e abaixo de 512 KB', async () => {
    const c = await cover("episode_id = $1 AND kind = 'spotify_cover'", [ep.id]);
    const spec = JSON.parse(JSON.stringify(c.spec));
    spec.layers.find((l) => l.id === 'nome').size = 80;
    delete spec.scale;
    const res = await save(c.id, { spec });
    assert.equal(res.status, 200, await res.clone().text());
    const now = await cover('id = $1', [c.id]);
    assert.deepEqual([now.width, now.height, now.spec.scale], [3000, 3000, 3]);
    assert.ok(now.size_bytes < 512 * 1024, `${now.size_bytes} bytes`);
  });

  it('trocar a foto pelo editor vale; foto de outro episódio, não', async () => {
    const c = await cover("episode_id = $1 AND angle = 'contraste'", [ep.id]);
    const frames = await q('SELECT id FROM episode_frames WHERE episode_id = $1 ORDER BY id', [ep.id]);
    const spec = JSON.parse(JSON.stringify(c.spec));
    const ph = spec.layers.find((l) => l.type === 'photo');
    const other = frames.map((f) => `f${f.id}`).find((r) => r !== ph.ref);
    ph.ref = other;
    assert.equal((await save(c.id, { spec })).status, 200);
    const now = await cover('id = $1', [c.id]);
    assert.deepEqual(now.spec.photo, { ref: other });
    ph.ref = 'f999999';
    const bad = await save(c.id, { spec });
    assert.equal(bad.status, 400); assert.match((await bad.json()).error, /não é deste episódio/);
  });

  it('a ficha mudou: a capa mexida à mão não é trocada sozinha; Atualizar monta de novo e pede confirmação', async () => {
    const edited = await cover("episode_id = $1 AND angle = 'contraste'", [ep.id]);
    assert.equal(edited.spec.edited, true); assert.equal(edited.approved, false);
    await as.gestao.act(`/episodios/${ep.id}/ficha-das-capas`, { guest: 'Ricardo Nascimento', tag: 'Quem projeta clínicas', axis: 'Negócios' }, { from: `/episodios/${ep.id}` });
    const after2 = await cover('id = $1', [edited.id]);
    assert.deepEqual([after2.stale, after2.storage_key, after2.spec.edited], [true, edited.storage_key, true], 'ficou como estava, marcada como desatualizada');
    const page = (await as.prod.get(`/episodios/${ep.id}?capas=youtube`)).text;
    assert.match(page, /data-confirm="Montar esta capa de novo com a ficha atual\? O que foi mexido no editor completo se perde\."/);
    await as.prod.act(`/capas/${edited.id}/atualizar`, {}, { from: `/episodios/${ep.id}` });
    const redone = await cover('id = $1', [edited.id]);
    assert.deepEqual([redone.stale, redone.spec.edited, redone.spec.sheet.tag], [false, undefined, 'Quem projeta clínicas'], 'Atualizar monta pelo modelo, com a ficha nova');
  });

  it('capa de corte: o editor completo salva, a etiqueta e o texto da capa seguem o que está na imagem', async () => {
    const clips = require('../src/services/clips');
    const b2 = require('../src/services/b2');
    const [clip] = await q(`INSERT INTO episode_clips (title, post_title, source, status, episode_id, storage_key, size_bytes, content_type, width, height, duration_ms, cover_texts, cover_sheet)
      VALUES ('Corte 7', 'Sua clínica pode fechar por burocracia', 'upload', 'pronto', $1, 'pp/c7.mp4', 100, 'video/mp4', 1080, 1920, 45000, $2, $3) RETURNING *`,
    [ep.id, JSON.stringify(['Burocracia fecha clínica', 'O alvará que faltava']), JSON.stringify({ hook: 'Sua clínica pode fechar por burocracia.', hl: 'fechar' })]);
    for (let i = 0; i < 2; i += 1) {
      const f = frameImage(1080, 1920, { x: 0.33, y: 0.24, w: 0.34, h: 0.19 });
      const key = await b2.keyFor('cortes', clip.id, 'quadros', `q${i}.jpg`);
      await b2.putObject(key, f.buffer, 'image/jpeg');
      await q('INSERT INTO episode_frames (episode_id, clip_id, at_ms, storage_key, width, height, analysis, score) VALUES ($1,$2,$3,$4,1080,1920,$5,$6)', [ep.id, clip.id, 10000 * (i + 1), key, JSON.stringify({ rostos: [f.face], caixas_de_texto: [] }), 9 - i]);
    }
    const [first] = await clips.buildCovers(clip.id);
    assert.equal(first.model, 'RL-A');
    await q('UPDATE episode_clips SET cover_id = $2 WHERE id = $1', [clip.id, first.id]);
    const page = (await as.prod.get(`/cortes/${clip.id}`)).text;
    assert.match(page, new RegExp(`href="/capas/${first.id}/editar"><b>Editor completo</b>`));
    const spec = JSON.parse(JSON.stringify(first.spec));
    spec.layers.find((l) => l.id === 'texto').text = 'A burocracia que fecha clínicas';
    assert.equal((await save(first.id, { spec })).status, 200);
    const now = await cover('id = $1', [first.id]);
    assert.equal(now.label, 'Capa: A burocracia que fecha clínicas', 'o nome do convidado é rótulo (meta), não entra');
    assert.equal(clips.coverTextOf(now), 'A burocracia que fecha clínicas', 'o texto da capa é o da imagem');
    assert.deepEqual([now.width, now.height], [1080, 1920]);
  });
});
