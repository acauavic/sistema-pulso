const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const { createCanvas } = require('@napi-rs/canvas');
const h = require('./helpers');
const covers = require('../src/services/covers');
const scenes = require('../src/services/videoScenes');
const sheets = require('../src/services/coverSheet');
const videos = require('../src/services/guestVideos');
const jobs = require('../src/services/jobs');
const b2 = require('../src/services/b2');

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const DATA = { guest: 'Ricardo Nascimento', ep: '018', tag: 'Abrir clínica', title: 'Como escolher o imóvel certo pra abrir sua clínica', pre: 'O imóvel pode', hl: 'fechar', post: 'sua clínica', quote: 'Reforma não salva imóvel errado.' };
const PHOTO = { ref: 'f1', w: 1080, h: 1920, face: { x: 0.5, y: 0.335, h: 0.19 } };

describe('Cenas dos vídeos do convidado (os tempos do guia)', () => {
  const ctx = covers.measureContext();
  const layer = (spec, id) => spec.layers.find((l) => l.id === id);
  const seen = (spec, id) => { const l = layer(spec, id); return Boolean(l) && (l.alpha ?? 1) > 0.01; };

  it('story de lançamento: pulso e logo, a foto revela, nome e título, chamada e fade para preto', () => {
    const s = scenes.story(ctx, DATA, PHOTO);
    assert.deepEqual([s.duration, s.fps], [11, 30]);
    const intro = s.frame(1.2);
    assert.ok(seen(intro, 'pulso') && seen(intro, 'logo') && !layer(intro, 'foto'), 'intro: só a linha de pulso e o logo no centro');
    assert.equal(layer(intro, 'logo').size, 220);
    const reveal = s.frame(2.2);
    assert.ok(layer(reveal, 'foto').reveal > 0.1 && layer(reveal, 'foto').reveal < 0.9, 'a foto revela aos poucos');
    assert.ok(layer(reveal, 'logo').size < 220 && layer(reveal, 'logo').size > 84, 'o logo está subindo para o canto');
    const title = s.frame(6);
    assert.ok(seen(title, 'nome') && seen(title, 'texto') && seen(title, 'ep') && !seen(title, 'noAr') && !seen(title, 'chamada'));
    assert.equal(layer(title, 'logo').size, 84);
    const cta = s.frame(9);
    assert.ok(seen(cta, 'chamada') && seen(cta, 'figurinha') && !seen(cta, 'ep'));
    assert.equal(layer(s.frame(10.99), 'fim').alpha > 0.95, true, 'termina em preto');
  });

  it('teaser: o gancho já está no primeiro quadro (sem logo), depois quem é, a frase palavra a palavra e onde assistir', () => {
    const words = [5.0, 5.5, 5.9, 6.4, 6.9].map((at) => ({ at }));
    const s = scenes.teaser(ctx, DATA, PHOTO, words);
    assert.equal(s.duration, 15);
    const first = s.frame(0);
    assert.ok(seen(first, 'destaque') && seen(first, 'texto') && !seen(first, 'logo') && !seen(first, 'nome'), 'primeiro quadro: rosto e gancho, sem vinheta');
    assert.equal(layer(first, 'foto').zoom, 1.08);
    const who = s.frame(4);
    assert.ok(seen(who, 'nome') && seen(who, 'rotulo') && seen(who, 'logo') && !seen(who, 'destaque') && !seen(who, 'ep'), 'o número do episódio não aparece aqui');
    const hidden = (t) => layer(s.frame(t), 'frase').marks.words.filter((i) => i >= 0).length;
    assert.deepEqual([hidden(5.2), hidden(5.7), hidden(6.5), hidden(7.5)], [4, 3, 1, 0], 'cada palavra entra quando é dita');
    const end = s.frame(13);
    assert.ok(seen(end, 'onde') && seen(end, 'botao') && seen(end, 'link') && seen(end, 'ep'), 'no fim: onde assistir e o número do episódio');
    assert.equal(layer(end, 'ep').text, 'EP 018');
    const even = scenes.teaser(ctx, DATA, PHOTO, []);
    assert.equal(even.frame(5.3).layers.find((l) => l.id === 'frase').marks.words.filter((i) => i >= 0).length, 4, 'sem o tempo de cada palavra: ritmo fixo');
  });
});

describe('Vídeos do convidado na Finalização', { skip: !hasFfmpeg && 'precisa de ffmpeg' }, () => {
  const as = {}; let app; let ep; let tmp; let srv; let srvBase;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const realPresign = b2.presignGet;
  const runAll = async () => { for (let i = 0; i < 4; i += 1) { if (!(await jobs.runNext())) break; } };
  const probe = (file) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file]).stdout.toString());
  const SEGS = [{ start_ms: 0, end_ms: 4000, text: 'Hoje a gente fala de imóvel para clínica.' }, { start_ms: 6000, end_ms: 9000, text: 'Reforma não salva imóvel errado.' }];

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'videos-test-'));
    const [g] = await q("INSERT INTO guests (name, profile, status) VALUES ('Ricardo Nascimento', 'empresario', 'gravado') RETURNING id");
    [ep] = await q("INSERT INTO episodes (number, title, status, guest_id) VALUES (18, 'Como escolher o imóvel certo pra abrir sua clínica', 'pronto_publicar', $1) RETURNING *", [g.id]);
    await q('INSERT INTO episode_transcripts (episode_id, text, segments, duration_ms) VALUES ($1, $2, $3, 20000)', [ep.id, SEGS.map((s) => s.text).join(' '), JSON.stringify(SEGS)]);
    const c = createCanvas(1080, 1920); const cx = c.getContext('2d'); cx.fillStyle = '#23323a'; cx.fillRect(0, 0, 1080, 1920); cx.fillStyle = '#d9b49a'; cx.beginPath(); cx.ellipse(540, 640, 180, 190, 0, 0, Math.PI * 2); cx.fill();
    const key = await b2.keyFor('episodios', ep.id, 'quadros', 'q0.jpg');
    await b2.putObject(key, c.toBuffer('image/jpeg', 85), 'image/jpeg');
    await q('INSERT INTO episode_frames (episode_id, at_ms, storage_key, width, height, analysis, score) VALUES ($1, 5000, $2, 1080, 1920, $3, 9)', [ep.id, key, JSON.stringify({ rostos: [{ x: 0.33, y: 0.24, w: 0.34, h: 0.19 }], caixas_de_texto: [] })]);
    // o FFmpeg precisa de HTTP de verdade para ler o vídeo editado: um servidor local faz o papel do link assinado
    srv = http.createServer((req, res) => {
      const obj = h.b2Store.get(decodeURIComponent(req.url.replace('/obj/', '')));
      if (!obj) { res.writeHead(404); res.end(); return; }
      const buf = obj.body; const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      if (m) { const a = Number(m[1]); const z = m[2] ? Number(m[2]) : buf.length - 1; res.writeHead(206, { 'content-type': 'video/mp4', 'content-range': `bytes ${a}-${z}/${buf.length}`, 'content-length': z - a + 1, 'accept-ranges': 'bytes' }); res.end(buf.subarray(a, z + 1)); return; }
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': buf.length, 'accept-ranges': 'bytes' }); res.end(buf);
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    srvBase = `http://127.0.0.1:${srv.address().port}`;
    b2.presignGet = async (k, o) => (/editado/.test(k) ? `${srvBase}/obj/${encodeURIComponent(k)}` : realPresign(k, o));
  });
  after(async () => { b2.presignGet = realPresign; srv?.close(); fs.rmSync(tmp, { recursive: true, force: true }); await app.close(); await h.db.close(); });

  it('sem a ficha, o vídeo diz o que falta; com a ficha, o story sai em MP4 1080×1920 de 11 s', async () => {
    assert.match((await videos.request(ep.id, 'story')).error, /Gere as capas primeiro/);
    const raw = { guest: 'Ricardo Nascimento', tag: 'Abrir clínica', axis: 'Negócios', spotify_hook: 'O imóvel que pode fechar sua clínica', quote: { text: 'Reforma não salva imóvel errado.' },
      angles: [{ angle: 'curiosidade', pre: 'O imóvel pode', hl: 'fechar', post: 'sua clínica', setup: 'Escolheu o imóvel', punch: 'errado?' }, { angle: 'contraste', pre: 'Reforma não', hl: 'salva', post: '', setup: 'Não é', punch: 'reforma.' }, { angle: 'autoridade', pre: 'O erro que', hl: 'fecha', post: 'clínicas', setup: 'Não é', punch: 'sorte.' }] };
    const ctx = await sheets.context(ep.id);
    const sheet = await sheets.save(ep.id, sheets.normalize(raw, { transcript: ctx.transcript }), 'ia');
    assert.deepEqual([sheet.quote.found, sheet.quote.at_ms], [true, 6000]);
    const r = await as.prod.act(`/episodios/${ep.id}/videos/story/gerar`, {}, { from: `/episodios/${ep.id}` });
    assert.match(r.location, /capas=videos/);
    let page = (await as.prod.get(`/episodios/${ep.id}?capas=videos`)).text;
    assert.match(page, /Montando o vídeo/); assert.ok(page.includes(`data-video-wait="/episodios/${ep.id}/videos/status"`), 'o endereço da espera sai limpo no atributo');
    assert.equal(JSON.parse((await as.prod.get(`/episodios/${ep.id}/videos/status`)).text).waiting, true);
    await runAll();
    const [row] = await q("SELECT * FROM episode_teasers WHERE episode_id = $1 AND kind = 'story'", [ep.id]);
    assert.equal(row.status, 'pronto', row.error || '');
    const file = path.join(tmp, 'story.mp4'); fs.writeFileSync(file, h.b2Store.get(row.storage_key).body);
    const info = probe(file);
    const v = info.streams.find((s) => s.codec_type === 'video');
    assert.deepEqual([v.width, v.height, Math.round(Number(info.format.duration))], [1080, 1920, 11]);
    assert.ok(info.streams.some((s) => s.codec_type === 'audio'), 'leva uma faixa de áudio (em silêncio), para as redes aceitarem');
    assert.ok(h.b2Store.get(row.poster_key).body.length > 5000, 'com a capa do vídeo');
    page = (await as.prod.get(`/episodios/${ep.id}?capas=videos`)).text;
    for (const t of ['Story de lançamento', 'STORY · 11 S', 'Baixar', 'Refazer', 'Sai sem som: a trilha entra na hora de postar', 'Falta o vídeo editado do episódio']) assert.ok(page.includes(t), t);
    const dl = await as.prod.get(`/episodios/${ep.id}/videos/story/arquivo?baixar=1`);
    assert.equal(dl.status, 302); assert.match(decodeURIComponent(dl.location), /pulso_ep018_story\.mp4/);
    assert.equal((await as.prod.get(`/episodios/${ep.id}/videos/teaser/arquivo`)).status, 404, 'o teaser ainda não existe');
  });

  it('o teaser leva a voz do convidado desde o início, com a frase aos 5 s, e avisa quando a legenda foi no ritmo fixo', async () => {
    assert.match((await videos.request(ep.id, 'teaser')).error, /vídeo editado/);
    const src = path.join(tmp, 'editado.mp4');
    const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src]);
    assert.equal(made.status, 0, made.stderr.toString());
    const key = await b2.keyFor('episodios', ep.id, 'editado-teste.mp4');
    h.b2Store.set(key, { body: fs.readFileSync(src), contentType: 'video/mp4' });
    await q("INSERT INTO episode_files (episode_id, kind, filename, content_type, size_bytes, storage_key, status, version) VALUES ($1, 'editado', 'ep.mp4', 'video/mp4', $2, $3, 'pronto', 1)", [ep.id, fs.statSync(src).size, key]);
    const { data, missing } = await videos.inputs(ep.id, 'teaser');
    assert.deepEqual(missing, []); assert.deepEqual([data.pre, data.hl, data.post, data.quote_at], ['O imóvel pode', 'fechar', 'sua clínica', 6000]);
    await as.gestao.act(`/episodios/${ep.id}/videos/teaser/gerar`, {}, { from: `/episodios/${ep.id}` });
    await runAll();
    const [row] = await q("SELECT * FROM episode_teasers WHERE episode_id = $1 AND kind = 'teaser'", [ep.id]);
    assert.equal(row.status, 'pronto', row.error || '');
    assert.deepEqual([row.inputs.synced, row.inputs.quote_start_ms, row.duration_ms], [false, 6000, 15000], 'sem transcrição por palavra: a frase começa no trecho da ficha');
    const file = path.join(tmp, 'teaser.mp4'); fs.writeFileSync(file, h.b2Store.get(row.storage_key).body);
    const info = probe(file);
    assert.equal(Math.round(Number(info.format.duration)), 15);
    // a voz vai do começo até os 11 s; o fim fica em silêncio (a trilha é de quem posta)
    const level = (ss, t) => { const out = spawnSync('ffmpeg', ['-v', 'info', '-ss', String(ss), '-t', String(t), '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-']).stderr.toString(); return Number((/mean_volume: (-?[\d.]+|-inf) dB/.exec(out) || [])[1] === '-inf' ? -200 : (/mean_volume: (-?[\d.]+) dB/.exec(out) || [])[1]); };
    assert.ok(level(2, 4) > -40, 'tem voz no meio'); assert.ok(level(12, 2.5) < -60, 'o fim é silêncio');
    const page = (await as.gestao.get(`/episodios/${ep.id}?capas=videos`)).text;
    assert.match(page, /ritmo fixo/); assert.match(page, /Vai com a voz do convidado/); assert.match(page, /FRASE<\/span> “Reforma não salva imóvel errado\.”/);
  });
});
