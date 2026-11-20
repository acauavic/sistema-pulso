const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const h = require('./helpers');
const covers = require('../src/services/covers');
const M = require('../src/public/design/models');
const sheets = require('../src/services/coverSheet');
const pieces = require('../src/services/coverPieces');

// Quadro sintético 16:9 com um "rosto" (elipse clara) onde a análise diz que ele está.
function frameImage(w = 1920, hgt = 1080, face = { x: 0.5, y: 0.2, w: 0.16, h: 0.34 }) {
  const c = createCanvas(w, hgt); const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, w, hgt); grad.addColorStop(0, '#23323a'); grad.addColorStop(1, '#101018');
  g.fillStyle = grad; g.fillRect(0, 0, w, hgt);
  g.fillStyle = '#d9b49a'; g.beginPath(); g.ellipse((face.x + face.w / 2) * w, (face.y + face.h / 2) * hgt, (face.w * w) / 2, (face.h * hgt) / 2, 0, 0, Math.PI * 2); g.fill();
  return { buffer: c.toBuffer('image/jpeg', 88), face };
}
// O exemplo do guia (Ricardo Nascimento, EP 018).
const RICARDO = { guest: 'Ricardo Nascimento', ep: '018', axis: 'Negócios', tag: 'Abrir clínica', pre: 'O imóvel pode', hl: 'fechar', post: 'sua clínica', setup: 'Escolheu o imóvel', punch: 'errado?', num: '3', line: 'erros ao escolher o imóvel', quote: 'Reforma não salva imóvel errado.', hook: 'O imóvel que pode fechar sua clínica', sub: 'Como abrir com segurança e não perder dinheiro.' };

describe('Modelos de capa do guia (o mesmo arquivo no servidor e no navegador)', () => {
  const ctx = covers.measureContext();
  const img = frameImage();
  const photo = { ref: 'f1', w: 1920, h: 1080, face: { x: 0.58, y: 0.37, h: 0.34 } };
  // capa de corte: o quadro do corte é vertical
  const tall = frameImage(1080, 1920, { x: 0.33, y: 0.24, w: 0.34, h: 0.19 });
  const tallPhoto = { ref: 'f1', w: 1080, h: 1920, face: { x: 0.5, y: 0.335, h: 0.19 } };

  it('os 14 modelos saem com o exemplo do guia, no tamanho certo e sem problema na conferência', async () => {
    assert.equal(Object.keys(M.MODELS).length, 14);
    for (const id of Object.keys(M.MODELS)) {
      const data = { ...RICARDO, ...(id === 'RL-A' ? { hook: 'Sua clínica pode fechar por burocracia.' } : {}) };
      const reel = M.MODELS[id].kind === 'reel_cover';
      const built = M.build(ctx, id, data, reel ? tallPhoto : photo, {});
      assert.ok(!built.error, `${id}: ${built.error}`);
      assert.equal(built.spec.model, id);
      const res = await covers.renderSpec(built.spec, { f1: (reel ? tall : img).buffer }, built.ctxData, { type: 'image/jpeg', quality: 0.8 });
      const want = { youtube_thumb: [1280, 720], spotify_cover: [3000, 3000], reel_cover: [1080, 1920] }[M.MODELS[id].kind];
      assert.deepEqual([res.width, res.height], want, `${id}: tamanho`);
      assert.deepEqual(res.lint.issues, [], `${id}: ${res.lint.issues.join(' ')}`);
      if (M.MODELS[id].kind === 'youtube_thumb') assert.equal(M.reads(built.spec), true, `${id}: lê a 168 px`);
    }
  });

  it('a ficha manda: campo que passa do limite não gera a peça, e o motivo vem em português', () => {
    assert.match(M.build(ctx, 'YT-B', { ...RICARDO, pre: 'O imóvel que você escolheu pode' }, photo).error.join(' '), /Antes do destaque: 6 palavras, o limite é 4/);
    assert.match(M.build(ctx, 'YT-B', { ...RICARDO, post: 'a sua clínica inteira' }, photo).error.join(' '), /limite é 3|limite é 6/);
    assert.match(M.build(ctx, 'YT-E', { ...RICARDO, punch: 'extraordinariamente' }, photo).error.join(' '), /mais de 9 letras/);
    assert.match(M.build(ctx, 'YT-D', { ...RICARDO, num: '' }, photo).error.join(' '), /número dito no episódio/);
    assert.match(M.build(ctx, 'YT-F', { ...RICARDO, quote: 'uma frase longa demais para caber numa capa de frase' }, photo).error.join(' '), /Frase do convidado: 10 palavras, o limite é 8/);
    assert.match(M.build(ctx, 'RL-A', { ...RICARDO, hook: 'Q&A' }, photo).error.join(' '), /gancho do trecho/);
    assert.equal(M.fieldError('tag', 'A mulher que coloca o Brasil para treinar'), '', 'a credencial de 8 palavras do próprio guia passa');
    assert.deepEqual(M.modelsFor('youtube_thumb', 'autoridade').sort(), ['YT-A', 'YT-A+', 'YT-D', 'YT-G']);
  });

  it('o recorte sai do rosto: ele cai no ponto do modelo, e foto pequena demais avisa', () => {
    const c = M.crop(photo, 700, 720, 400, 300, 320);
    const faceCx = c.face.x + c.face.w / 2; const faceCy = c.face.y + c.face.h / 2;
    assert.ok(Math.abs(faceCx - 400) < 4 && Math.abs(faceCy - 300) < 4, `rosto em ${faceCx},${faceCy}`);
    assert.equal(c.soft, false);
    const small = M.crop({ ...photo, w: 640, h: 360 }, 1000, 1000, 480, 320, 300, 3);
    assert.equal(small.soft, true, 'quadro pequeno na capa do Spotify (3000 px) fica ampliado');
    const built = M.build(ctx, 'SP-B', RICARDO, { ...photo, w: 640, h: 360 });
    assert.match(built.warnings.join(' '), /Foto ampliada/);
  });

  it('espelhado, o texto troca de lado e continua longe do rosto', async () => {
    for (const id of ['YT-A', 'YT-B', 'YT-D', 'YT-E', 'YT-G']) {
      const a = M.build(ctx, id, RICARDO, photo, { flip: false }); const b = M.build(ctx, id, RICARDO, photo, { flip: true });
      const xOf = (s) => s.spec.layers.find((l) => l.id === 'foto').x;
      assert.notEqual(xOf(a), xOf(b), `${id}: a foto muda de lado`);
      assert.equal(b.spec.flip, true);
      const res = await covers.renderSpec(b.spec, { f1: img.buffer }, b.ctxData, { type: 'image/jpeg', quality: 0.8 });
      assert.deepEqual(res.lint.issues, [], `${id} espelhado: ${res.lint.issues.join(' ')}`);
    }
  });
});

describe('Ficha do episódio e as peças na Finalização', () => {
  const as = {}; let app; let ep;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const realFetch = global.fetch;
  const SEGS = [
    { start_ms: 0, end_ms: 4000, text: 'Hoje a gente fala de imóvel para clínica.' },
    { start_ms: 2537000, end_ms: 2541000, text: 'Olha, reforma não salva imóvel errado.' },
    { start_ms: 2600000, end_ms: 2604000, text: 'São três erros ao escolher o imóvel.' },
  ];

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora'], ['editor', 'editor_video']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    const [g] = await q("INSERT INTO guests (name, profile, status, job_title) VALUES ('Ricardo Nascimento', 'empresario', 'gravado', 'Arquiteto de clínicas') RETURNING id");
    [ep] = await q("INSERT INTO episodes (number, title, status, guest_id) VALUES (18, 'Como escolher o imóvel certo pra abrir sua clínica', 'pronto_publicar', $1) RETURNING *", [g.id]);
    await q('INSERT INTO episode_transcripts (episode_id, text, segments, duration_ms) VALUES ($1, $2, $3, 3600000)', [ep.id, SEGS.map((s) => s.text).join(' '), JSON.stringify(SEGS)]);
    const b2 = require('../src/services/b2');
    for (let i = 0; i < 3; i += 1) {
      const f = frameImage(1920, 1080, { x: 0.5, y: 0.2, w: 0.16, h: 0.34 });
      const key = await b2.keyFor('episodios', ep.id, 'quadros', `q${i}.jpg`);
      await b2.putObject(key, f.buffer, 'image/jpeg');
      await q('INSERT INTO episode_frames (episode_id, at_ms, storage_key, width, height, analysis, score) VALUES ($1,$2,$3,1920,1080,$4,$5)', [ep.id, 600000 * (i + 1), key, JSON.stringify({ rostos: [f.face], caixas_de_texto: [] }), 9 - i]);
    }
  });
  after(async () => { global.fetch = realFetch; h.config.geminiConfigured = false; await app.close(); await h.db.close(); });

  it('a IA preenche a ficha; o servidor acha a frase na transcrição, tira o número que ninguém disse e escolhe o modelo', async () => {
    Object.assign(h.config.gemini, { key: 'gem' }); h.config.geminiConfigured = true;
    let prompt = '';
    const answer = {
      guest: 'Ricardo Nascimento', tag: 'Abrir clínica!!', axis: 'Negócios', creds: ['Arquiteto', 'Clínicas', 'uma credencial longa demais'], spotify_hook: 'O imóvel que pode fechar sua clínica',
      quote: { text: 'Reforma não salva imóvel errado.', at: '42:17' },
      angles: [
        { angle: 'curiosidade', pre: 'O imóvel pode', hl: 'fechar', post: 'sua clínica', setup: 'Escolheu o imóvel', punch: 'errado?' },
        { angle: 'contraste', pre: 'Reforma não', hl: 'salva', post: 'imóvel errado', setup: 'Não é', punch: 'reforma.' },
        { angle: 'autoridade', pre: 'O erro que', hl: 'fecha', post: 'clínicas', setup: 'Não é', punch: 'sorte.', num: '3', line: 'erros ao escolher o imóvel' },
      ],
    };
    global.fetch = async (url, opts = {}) => {
      if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
        prompt = JSON.parse(opts.body).contents[0].parts.map((p) => p.text || '').join('\n');
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
      }
      return realFetch(url, opts);
    };
    const sheet = await sheets.generate(ep.id);
    assert.match(prompt, /\[42:17\] Olha, reforma não salva imóvel errado\./, 'a transcrição vai com os tempos');
    assert.equal(sheet.tag, 'Abrir clínica', 'sem ponto de exclamação');
    assert.deepEqual(sheet.creds, ['Arquiteto', 'Clínicas']);
    assert.deepEqual([sheet.quote.found, sheet.quote.at_ms], [true, 2537000], 'a frase literal foi achada, com o tempo');
    assert.equal(sheet.angles.autoridade.num, '3', '"três" foi dito');
    assert.deepEqual([sheet.angles.curiosidade.model, sheet.angles.contraste.model, sheet.angles.autoridade.model], ['YT-B', 'YT-E', 'YT-D']);
    answer.angles[2].num = '7'; answer.quote.text = 'Uma frase que ninguém disse.';
    const other = sheets.normalize(answer, { transcript: { text: SEGS.map((s) => s.text).join(' '), segments: SEGS } });
    assert.equal(other.angles.autoridade.num, '', 'número que ninguém disse sai da ficha');
    assert.equal(other.angles.autoridade.model, 'YT-A+', 'sem número, a autoridade vai de credenciais');
    assert.equal(other.quote.found, false);
    h.config.geminiConfigured = false; global.fetch = realFetch;
  });

  it('um clique gera 3 thumbnails (uma por ângulo) e a capa do Spotify, e a tela mostra cada uma com o teste de redução', async () => {
    let page = (await as.gestao.get(`/episodios/${ep.id}?capas=youtube`)).text;
    assert.match(page, /Um clique monta tudo/);
    const r = await as.gestao.act(`/episodios/${ep.id}/capas/gerar`, { pecas: '1' }, { from: `/episodios/${ep.id}` });
    assert.equal(r.status, 302);
    const rows = await q('SELECT kind, model, angle, width, height, size_bytes, auto, lint FROM episode_covers WHERE episode_id = $1 ORDER BY kind DESC, position', [ep.id]);
    assert.deepEqual(rows.map((c) => [c.kind, c.model, c.angle]), [['youtube_thumb', 'YT-B', 'curiosidade'], ['youtube_thumb', 'YT-E', 'contraste'], ['youtube_thumb', 'YT-D', 'autoridade'], ['spotify_cover', 'SP-A', null]]);
    const sp = rows[3];
    assert.deepEqual([sp.width, sp.height], [3000, 3000]); assert.ok(sp.size_bytes < 512 * 1024, `Spotify com ${sp.size_bytes} bytes`);
    for (const c of rows.slice(0, 3)) assert.equal(c.lint.reads, true);
    page = (await as.gestao.get(`/episodios/${ep.id}?capas=youtube`)).text;
    for (const t of ['CURIOSIDADE', 'CONTRASTE', 'AUTORIDADE', 'Tarja lime', 'Close + palavra', 'Número', '168 PX · CELULAR', '64 PX · LISTA DO APP', 'Abrir clínica', 'data-ajustar-open', 'Gerar as que faltam']) assert.ok(page.includes(t), t);
    assert.doesNotMatch(page, /style="/);
  });

  it('dá para aprovar várias: a primeira é a principal e as aprovadas baixam num ZIP com os nomes do guia', async () => {
    const yt = await q("SELECT id, angle FROM episode_covers WHERE episode_id = $1 AND kind = 'youtube_thumb' ORDER BY position", [ep.id]);
    assert.equal((await as.editor.act(`/episodios/${ep.id}/capas/${yt[0].id}/aprovar`, { aprovar: '1' }, { from: `/episodios/${ep.id}` })).status, 403, 'o editor não aprova');
    await as.gestao.act(`/episodios/${ep.id}/capas/${yt[0].id}/aprovar`, { aprovar: '1' }, { from: `/episodios/${ep.id}` });
    await as.gestao.act(`/episodios/${ep.id}/capas/${yt[1].id}/aprovar`, { aprovar: '1' }, { from: `/episodios/${ep.id}` });
    const main = async () => (await q('SELECT thumb_cover_id FROM episode_metadata WHERE episode_id = $1', [ep.id]))[0].thumb_cover_id;
    assert.equal(await main(), yt[0].id, 'a primeira aprovada é a principal');
    assert.equal((await q("SELECT count(*)::int AS n FROM episode_covers WHERE episode_id = $1 AND approved", [ep.id]))[0].n, 2);
    const page = (await as.gestao.get(`/episodios/${ep.id}?capas=youtube`)).text;
    assert.match(page, /principal/); assert.match(page, /no teste A\/B/); assert.match(page, /Baixar para o teste/);
    await as.gestao.act(`/capas/${yt[1].id}/principal`, {}, { from: `/episodios/${ep.id}` });
    assert.equal(await main(), yt[1].id);
    await as.gestao.act(`/episodios/${ep.id}/capas/${yt[1].id}/aprovar`, { aprovar: '0' }, { from: `/episodios/${ep.id}` });
    assert.equal(await main(), yt[0].id, 'tirar a aprovação da principal passa a vez');
    await as.gestao.act(`/episodios/${ep.id}/capas/${yt[1].id}/aprovar`, { aprovar: '1' }, { from: `/episodios/${ep.id}` });
    const res = await fetch(`${app.base}/episodios/${ep.id}/capas/teste.zip`, { headers: { cookie: as.gestao.cookie() } });
    assert.equal(res.status, 200); assert.match(res.headers.get('content-disposition'), /pulso_ep018_youtube_teste\.zip/);
    const zip = Buffer.from(await res.arrayBuffer()).toString('latin1');
    assert.match(zip, /pulso_ep018_yt_A\.(png|jpg)/); assert.match(zip, /pulso_ep018_yt_B\.(png|jpg)/); assert.doesNotMatch(zip, /pulso_ep018_yt_C/);
  });

  it('a janela Ajustar: troca texto, modelo e foto; o que passa do limite não é salvo', async () => {
    const [c] = await q("SELECT * FROM episode_covers WHERE episode_id = $1 AND angle = 'contraste'", [ep.id]);
    const info = JSON.parse((await as.prod.get(`/capas/${c.id}/ajustar`)).text);
    assert.equal(info.ok, true); assert.equal(info.cover.model, 'YT-E'); assert.equal(info.frames.length, 3); assert.equal(info.data.setup, 'Não é');
    assert.ok(info.frames[0].face && info.frames[0].url.startsWith('/quadros/'));
    const token = await as.prod.csrf('/episodios');
    const post = (id, body, who = as.prod) => fetch(`${app.base}/capas/${id}/ajustar`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', cookie: who.cookie(), 'x-csrf-token': token }, body: JSON.stringify(body) });
    let res = await post(c.id, { model: 'YT-B', fields: { pre: 'Uma frase com palavras demais para caber', hl: 'aqui', post: '' } });
    assert.equal(res.status, 422); assert.match((await res.json()).error, /limite é 4/);
    assert.equal((await q('SELECT model FROM episode_covers WHERE id = $1', [c.id]))[0].model, 'YT-E', 'nada mudou');
    res = await post(c.id, { model: 'YT-B', fields: { pre: 'Reforma não', hl: 'salva', post: 'imóvel errado' }, frame: info.frames[2].ref, flip: true });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const [now] = await q('SELECT * FROM episode_covers WHERE id = $1', [c.id]);
    assert.deepEqual([now.model, now.auto, now.spec.flip, now.spec.photo.ref, now.spec.sheet.hl], ['YT-B', false, true, info.frames[2].ref, 'salva']);
    assert.notEqual(now.storage_key, c.storage_key, 'a imagem foi refeita');
    const sheet = await sheets.get(ep.id);
    assert.deepEqual([sheet.angles.contraste.model, sheet.angles.contraste.hl], ['YT-B', 'salva'], 'o texto fica na ficha');
    assert.equal((await as.editor.get(`/capas/${c.id}/ajustar`)).status, 200, 'o editor ajusta capas');
  });

  it('mudar a credencial refaz as capas; a aprovada fica marcada como desatualizada, com o botão Atualizar', async () => {
    const before = await q("SELECT id, approved, storage_key FROM episode_covers WHERE episode_id = $1 AND model IS NOT NULL ORDER BY id", [ep.id]);
    let r = await as.gestao.act(`/episodios/${ep.id}/ficha-das-capas`, { guest: 'Ricardo Nascimento', tag: 'uma credencial com palavras demais para caber no rótulo da capa', axis: 'Negócios' }, { from: `/episodios/${ep.id}` });
    assert.match(r.location, /abrir=modal-ficha/, 'passou do limite: a janela reabre');
    r = await as.gestao.act(`/episodios/${ep.id}/ficha-das-capas`, { guest: 'Ricardo Nascimento', tag: 'Quem projeta clínicas', axis: 'Inovação' }, { from: `/episodios/${ep.id}` });
    const after2 = await q("SELECT id, approved, stale, storage_key, spec FROM episode_covers WHERE episode_id = $1 AND model IS NOT NULL ORDER BY id", [ep.id]);
    for (const c of after2) {
      const old = before.find((b) => b.id === c.id);
      if (c.approved) { assert.equal(c.stale, true); assert.equal(c.storage_key, old.storage_key, 'a aprovada não é trocada sozinha'); } else { assert.equal(c.stale, false); assert.notEqual(c.storage_key, old.storage_key); assert.equal(c.spec.sheet.tag, 'Quem projeta clínicas'); }
    }
    const page = (await as.gestao.get(`/episodios/${ep.id}?capas=youtube`)).text;
    assert.match(page, /desatualizada/); assert.match(page, /Atualizar/); assert.match(page, /Quem projeta clínicas/);
    const stale = after2.find((c) => c.approved);
    await as.gestao.act(`/capas/${stale.id}/atualizar`, {}, { from: `/episodios/${ep.id}` });
    const [fresh] = await q('SELECT stale, approved, spec FROM episode_covers WHERE id = $1', [stale.id]);
    assert.deepEqual([fresh.stale, fresh.approved, fresh.spec.sheet.tag], [false, true, 'Quem projeta clínicas']);
  });

  it('ângulo cujo texto passa do limite não sai: a tela diz o motivo e a janela Ajustar cria a capa', async () => {
    const [gone] = await q("SELECT id FROM episode_covers WHERE episode_id = $1 AND angle = 'autoridade'", [ep.id]);
    await as.gestao.act(`/episodios/${ep.id}/capas/${gone.id}/excluir`, {}, { from: `/episodios/${ep.id}` });
    const sheet = await sheets.get(ep.id);
    sheet.angles.autoridade = { ...sheet.angles.autoridade, model: 'YT-A+', num: '', line: '', pre: 'Os erros de quem escolhe', hl: 'mal', post: 'o imóvel da clínica' };
    await sheets.save(ep.id, sheet);
    const out = await pieces.generate(ep.id, {});
    assert.equal(out.created.filter((c) => c.kind === 'youtube_thumb').length, 0, 'a thumbnail de autoridade não sai'); assert.equal(out.fails[0].what, 'Autoridade');
    const page = (await as.gestao.get(`/episodios/${ep.id}?capas=youtube`)).text;
    assert.match(page, /Esta capa não saiu/); assert.match(page, /Antes do destaque: 5 palavras, o limite é 4/);
    const url = `/episodios/${ep.id}/capas/angulo/autoridade/ajustar`;
    assert.ok(page.includes(url));
    assert.equal(JSON.parse((await as.gestao.get(url)).text).cover.id, null);
    const res = await fetch(`${app.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', cookie: as.gestao.cookie(), 'x-csrf-token': await as.gestao.csrf('/episodios') }, body: JSON.stringify({ model: 'YT-A+', fields: { pre: 'O erro que', hl: 'fecha', post: 'clínicas' } }) });
    assert.equal(res.status, 200);
    const [made] = await q("SELECT model, angle, auto FROM episode_covers WHERE episode_id = $1 AND angle = 'autoridade'", [ep.id]);
    assert.deepEqual(made, { model: 'YT-A+', angle: 'autoridade', auto: false });
  });
});
