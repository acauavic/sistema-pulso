const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const h = require('./helpers');
const config = require('../src/config');
const b2 = require('../src/services/b2');
const clips = require('../src/services/clips');
const publishing = require('../src/services/publishing');
const up = require('../src/services/uploadPost');
const jobs = require('../src/services/jobs');

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const inDays = (n) => new Date(Date.now() + n * 86400_000 - 3 * 3600_000).toISOString().slice(0, 16); // "datetime-local" em Brasília

describe('cortes enviados pelo editor', { skip: !hasFfmpeg && 'precisa de ffmpeg' }, () => {
  const as = {};
  let app; let tmp; let srv; let srvBase; let vertical; let horizontal;
  let ep; let epEarly;
  let geminiMode = 'ok'; // ok | vision_fail | texts_fail
  const realFetch = global.fetch;
  const realPresign = b2.presignGet;

  const mkvideo = (name, size, seconds) => {
    const file = path.join(tmp, name);
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30:duration=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
    assert.equal(r.status, 0, String(r.stderr));
    return fs.readFileSync(file);
  };

  // cliente HTTP "como o navegador": JSON, CSRF no cabeçalho
  const call = async (c, method, p, { json, raw, form } = {}) => {
    const token = await c.csrf('/episodios');
    const headers = { cookie: c.cookie(), accept: 'application/json', 'x-csrf-token': token };
    let body;
    if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); } else if (raw) { headers['content-type'] = 'application/octet-stream'; body = raw; } else if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    const r = await fetch(`${app.base}${p}`, { method, headers, body, redirect: 'manual' });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* html */ }
    return { status: r.status, json: j, text, location: r.headers.get('location') };
  };
  // envia um vídeo pelo mesmo caminho do navegador: iniciar -> partes -> concluir
  const uploadClip = async (c, name, data, { stop = false } = {}) => {
    const init = await call(c, 'POST', '/cortes/iniciar', { json: { nome: name, tamanho: data.length, tipo: 'video/mp4' } });
    if (init.status !== 200) return { init };
    const { id, partSize, totalParts } = init.json;
    for (let n = 1; n <= totalParts; n += 1) {
      const slice = data.subarray((n - 1) * partSize, Math.min(data.length, n * partSize));
      const part = await call(c, 'PUT', `/cortes/${id}/parte/${n}`, { raw: slice });
      assert.equal(part.status, 200, part.text);
    }
    if (stop) return { init: init.json, id };
    return { init: init.json, id, done: await call(c, 'POST', `/cortes/${id}/concluir`) };
  };
  const clipRow = (id) => h.db.query('SELECT * FROM episode_clips WHERE id=$1', [id]).then((r) => r.rows[0]);
  const runAll = async () => { for (let i = 0; i < 8; i += 1) { if (!(await jobs.runNext())) break; } };
  const lastCall = (pred) => [...h.uploadPostCalls].reverse().find(pred);
  const fieldsOf = (c) => c.fields.reduce((o, [k, v]) => { (o[k] ||= []).push(v); return o; }, {});
  const post = (c, p, pairs = []) => call(c, 'POST', p, { form: Object.fromEntries(pairs.reduce((m, [k, v]) => { m.push([k, v]); return m; }, [])) });

  before(async () => {
    process.env.GEMINI_KEY = 'test-gemini'; config.gemini.key = 'test-gemini'; config.geminiConfigured = true;
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.startsWith('https://generativelanguage.googleapis.com/')) {
        const body = JSON.parse(opts.body); const parts = body.contents[0].parts;
        const images = parts.filter((p) => p.inline_data).length;
        if ((images && geminiMode === 'vision_fail') || (!images && geminiMode === 'texts_fail')) return Response.json({ error: { message: 'indisponível no teste' } }, { status: 400 });
        const data = images
          ? { quadros: parts.filter((p) => p.text?.startsWith('Quadro índice')).map((p) => { const i = Number(p.text.match(/índice (\d+)/)[1]); return { indice: i, rostos: [{ x: 0.3 + (i % 3) * 0.05, y: 0.12, w: 0.4, h: 0.25 }], olhos_abertos: true, expressao: 'falando', nitidez: 7, luz: 7, texto_queimado: false, caixas_de_texto: [], nota_thumbnail: 5 + (i % 4) }; }) }
          : { titulo: 'Prazo para sair do cargo, sem ego.', legenda: 'Jonata fala sobre sucessão e governança. Veja o trecho completo.', textos_capa: ['Prazo pra sair', 'Sem ego e vaidade 🔥', 'Sucessão sem vaidade'] };
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }], usageMetadata: { totalTokenCount: 10 } });
      }
      return realFetch(url, opts);
    };

    await h.resetDb();
    app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['editor', 'editor_video'], ['prod', 'produtora']]) {
      await h.createUser({ name: k, email: `${k}@t.com`, role });
      as[k] = h.client(app.base); await as[k].login(`${k}@t.com`);
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-test-'));
    vertical = mkvideo('v.mp4', '360x640', 12);
    horizontal = mkvideo('h.mp4', '640x360', 5);
    // o ffmpeg precisa de HTTP de verdade: um servidor local faz o papel do link assinado do Backblaze (com Range)
    srv = http.createServer((req, res) => {
      const key = decodeURIComponent(req.url.replace('/obj/', ''));
      const obj = h.b2Store.get(key);
      if (!obj) { res.writeHead(404); res.end(); return; }
      const buf = obj.body; const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      if (m) { const a = Number(m[1]); const z = m[2] ? Number(m[2]) : buf.length - 1; res.writeHead(206, { 'content-type': 'video/mp4', 'content-range': `bytes ${a}-${z}/${buf.length}`, 'content-length': z - a + 1, 'accept-ranges': 'bytes' }); res.end(buf.subarray(a, z + 1)); } else { res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': buf.length, 'accept-ranges': 'bytes' }); res.end(buf); }
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    srvBase = `http://127.0.0.1:${srv.address().port}`;
    b2.presignGet = async (key, o) => (/\/cortes\/\d+\/video-/.test(key) ? `${srvBase}/obj/${encodeURIComponent(key)}` : realPresign(key, o));

    const { rows: [g] } = await h.db.query("INSERT INTO guests (name, instagram, profile, status, positioning) VALUES ('Jonata Rocha', 'jon.divisao', 'empresario', 'gravado', 'Empresário e mentor') RETURNING id");
    ep = (await h.db.query("INSERT INTO episodes (number, title, status, guest_id) VALUES (12, 'Conversa com Jonata Rocha', 'em_edicao', $1) RETURNING *", [g.id])).rows[0];
    epEarly = (await h.db.query("INSERT INTO episodes (number, title, status) VALUES (13, 'Outro episódio', 'gravado') RETURNING *")).rows[0];
    await h.db.query('INSERT INTO episode_metadata (episode_id, suggestions) VALUES ($1,$2)', [ep.id, JSON.stringify({ hashtags: ['sucessão', 'governança'], moments: [{ start_ms: 4000, end_ms: 28000, titulo: 'Data marcada para deixar o cargo', motivo: 'Revela o prazo.' }] })]);
  });
  after(async () => {
    b2.presignGet = realPresign; global.fetch = realFetch; config.uploadPost.live = false;
    srv?.close(); fs.rmSync(tmp, { recursive: true, force: true });
    await app.close(); await h.db.close();
  });

  it('o editor envia vários cortes de uma vez; cada um ganha nome interno e entra na fila de leitura', async () => {
    const a = await uploadClip(as.editor, 'primeiro.mp4', vertical);
    const b = await uploadClip(as.editor, 'segundo.mov', horizontal);
    for (const r of [a, b]) { assert.equal(r.done.status, 200, r.done.text); assert.equal(r.init.ok ?? r.init.partSize > 0, true); }
    const rows = (await h.db.query('SELECT * FROM episode_clips ORDER BY id')).rows;
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.title), rows.map((r) => `Corte ${r.id}`), 'nome interno: Corte N');
    assert.ok(rows.every((r) => r.status === 'processando' && r.episode_id === null && r.source === 'upload'));
    assert.ok(rows.every((r) => r.storage_key.startsWith(`pp/cortes/${r.id}/video-`) && h.b2Store.has(r.storage_key)));
    assert.equal((await h.db.query("SELECT count(*)::int n FROM jobs WHERE kind='corte' AND status='queued'")).rows[0].n, 2);
  });

  it('o envio recusa quem não é do time de vídeo, formatos que não são vídeo, parte com tamanho errado e conclusão incompleta', async () => {
    assert.equal((await call(as.prod, 'POST', '/cortes/iniciar', { json: { nome: 'x.mp4', tamanho: 100, tipo: 'video/mp4' } })).status, 403);
    const txt = await call(as.editor, 'POST', '/cortes/iniciar', { json: { nome: 'notas.txt', tamanho: 100, tipo: 'text/plain' } });
    assert.equal(txt.status, 400); assert.match(txt.json.error, /Envie vídeo/);
    assert.equal((await call(as.editor, 'POST', '/cortes/iniciar', { json: { nome: 'x.mp4', tamanho: 0 } })).status, 400);
    const { init, id } = await uploadClip(as.editor, 'meio.mp4', vertical, { stop: true });
    const badPart = await call(as.editor, 'PUT', `/cortes/${id}/parte/1`, { raw: Buffer.alloc(10) });
    assert.equal(badPart.status, 400); assert.match(badPart.json.error, /deveria ter/);
    assert.ok(init.totalParts >= 2, 'o vídeo de teste precisa de várias partes');
    await h.db.query('DELETE FROM clip_upload_parts WHERE clip_id=$1 AND part_number=2', [id]); // falta uma parte
    const incomplete = await call(as.editor, 'POST', `/cortes/${id}/concluir`);
    assert.equal(incomplete.status, 409); assert.match(incomplete.json.error, /Faltam partes/);
    assert.equal((await call(as.editor, 'POST', `/cortes/${id}/cancelar`)).status, 200);
    assert.equal((await h.db.query('SELECT count(*)::int n FROM episode_clips WHERE id=$1', [id])).rows[0].n, 0, 'envio cancelado some');
  });

  it('o sistema lê cada corte: formato, duração, fala, quadros, título, legenda e 3 capas (sem episódio ainda)', async () => {
    await runAll();
    const [v, hz] = (await h.db.query('SELECT * FROM episode_clips ORDER BY id')).rows;
    assert.equal(v.status, 'pronto', v.error);
    assert.equal(v.width, 360); assert.equal(v.height, 640);
    assert.ok(Math.abs(v.duration_ms - 12000) < 500);
    assert.match(v.transcript, /texto transcrito de teste/);
    assert.equal(v.post_title, 'Prazo para sair do cargo, sem ego');
    assert.match(v.caption, /Jonata fala sobre sucessão/);
    assert.deepEqual(v.cover_texts, ['Prazo pra sair', 'Sem ego e vaidade', 'Sucessão sem vaidade']);
    assert.equal(v.episode_id, null);
    const covers = (await h.db.query('SELECT * FROM episode_covers WHERE clip_id=$1 ORDER BY position', [v.id])).rows;
    assert.equal(covers.length, 3);
    for (const c of covers) {
      assert.equal(c.kind, 'reel_cover'); assert.equal(c.episode_id, null); assert.equal(c.width, 1080);
      assert.deepEqual(c.lint.issues, [], c.lint.issues.join(' | '));
      assert.ok(c.storage_key.startsWith(`pp/cortes/${v.id}/capas/`) && h.b2Store.has(c.storage_key));
    }
    assert.equal(v.cover_id, covers[0].id, 'a primeira capa já fica escolhida');
    assert.equal((await h.db.query('SELECT count(*)::int n FROM episode_frames WHERE clip_id=$1 AND episode_id IS NULL', [v.id])).rows[0].n, 6);
    assert.equal(hz.status, 'pronto'); assert.equal(hz.width, 640);
    assert.match(hz.note, /horizontal/, 'avisa que corte horizontal não é o ideal para Reels/TikTok/Shorts');
  });

  it('a tela de conteúdo lista os cortes sem episódio e só oferece episódios já gravados', async () => {
    const page = await as.editor.get('/conteudo');
    assert.equal(page.status, 200);
    assert.match(page.text, /Sem episódio \(2\)/);
    assert.match(page.text, /Atribuir a um episódio/);
    assert.match(page.text, /EP\.012 · Conversa com Jonata Rocha/);
    assert.match(page.text, /EP\.013 · Outro episódio/, 'todo episódio já nasce gravado');
    assert.match(page.text, /Enviar cortes/);
    const asProd = (await as.prod.get('/conteudo')).text;
    assert.match(asProd, /Sem episódio/, 'a produtora enxerga');
    assert.doesNotMatch(asProd, /Enviar cortes/, 'mas não envia');
    const detail = await as.editor.get(`/cortes/${(await h.db.query('SELECT id FROM episode_clips ORDER BY id LIMIT 1')).rows[0].id}`);
    assert.equal(detail.status, 200);
    assert.match(detail.text, /\/cortes\/\d+\/video#t=0\.1/);
    assert.equal((detail.text.match(/class="cover-pick/g) || []).length, 3);
  });

  it('atribuir: só a episódio existente, só editor ou gestão; as capas são refeitas com o convidado e o número', async () => {
    const [v] = (await h.db.query('SELECT * FROM episode_clips ORDER BY id')).rows;
    const before = (await h.db.query('SELECT id FROM episode_covers WHERE clip_id=$1 ORDER BY position', [v.id])).rows;
    assert.equal((await post(as.prod, `/cortes/${v.id}/atribuir`, [['episode_id', String(ep.id)]])).status, 403);
    await post(as.editor, `/cortes/${v.id}/atribuir`, [['episode_id', '999999']]);
    assert.equal((await clipRow(v.id)).episode_id, null);

    assert.equal((await post(as.editor, `/cortes/${v.id}/atribuir`, [['episode_id', String(ep.id)]])).status, 302);
    assert.equal((await clipRow(v.id)).episode_id, ep.id);
    assert.equal((await h.db.query('SELECT count(*)::int n FROM episode_covers WHERE clip_id=$1 AND episode_id=$2', [v.id, ep.id])).rows[0].n, 3, 'capas e quadros acompanham o corte');
    assert.equal((await h.db.query('SELECT count(*)::int n FROM episode_frames WHERE clip_id=$1 AND episode_id=$2', [v.id, ep.id])).rows[0].n, 6);
    const after = (await h.db.query('SELECT id, spec FROM episode_covers WHERE clip_id=$1 ORDER BY position', [v.id])).rows;
    assert.ok(after.every((c) => !before.some((b) => b.id === c.id)), 'capas refeitas');
    assert.ok(after.every((c) => c.spec.layers.some((l) => /EP\.012/.test(l.text || ''))), 'o número do episódio entra nas capas');
    assert.ok((await h.db.query("SELECT 1 FROM episode_events WHERE episode_id=$1 AND type='corte'", [ep.id])).rows.length);
    assert.notEqual((await clipRow(v.id)).cover_id, null);
    assert.match((await as.gestao.get(`/conteudo?episodio=${ep.id}`)).text, /Momentos que a IA sugere cortar/, 'com o filtro do episódio, aparecem os momentos da análise como dica');
    const epPage = (await as.gestao.get(`/episodios/${ep.id}`)).text;
    assert.match(epPage, /Conteúdo <span class="mono small">0\/1<\/span>/, 'o episódio só mostra o resumo (publicados/total) e o link');
    assert.doesNotMatch(epPage, /cover-pick/, 'cortes não ficam dentro do card do episódio');
  });

  it('editar os textos do corte e escolher a capa (só entre as do próprio corte)', async () => {
    const [v] = (await h.db.query('SELECT * FROM episode_clips ORDER BY id')).rows;
    await post(as.editor, `/cortes/${v.id}`, [['title', 'Prazo do CEO'], ['post_title', 'Eu tenho prazo para sair'], ['caption', 'Legenda nova #sucessão']]);
    const now = await clipRow(v.id);
    assert.equal(now.title, 'Prazo do CEO'); assert.equal(now.post_title, 'Eu tenho prazo para sair'); assert.equal(now.caption, 'Legenda nova #sucessão');
    const covers = (await h.db.query('SELECT id FROM episode_covers WHERE clip_id=$1 ORDER BY position', [v.id])).rows;
    assert.equal((await post(as.editor, `/cortes/${v.id}/capa`, [['cover_id', String(covers[2].id)]])).status, 302);
    assert.equal((await clipRow(v.id)).cover_id, covers[2].id);
    const { rows: [thumb] } = await h.db.query("INSERT INTO episode_covers (episode_id, kind, spec, storage_key, mime, width, height, size_bytes) VALUES ($1,'youtube_thumb','{}','pp/x/t.jpg','image/jpeg',1280,720,10) RETURNING id", [ep.id]);
    assert.equal((await post(as.editor, `/cortes/${v.id}/capa`, [['cover_id', String(thumb.id)]])).status, 404);
    await h.db.query('DELETE FROM episode_covers WHERE id=$1', [thumb.id]);
    assert.equal((await post(as.prod, `/cortes/${v.id}`, [['title', 'x']])).status, 403);
  });

  it('as capas do corte abrem pelo endereço genérico /capas/:id (corte pode não ter episódio)', async () => {
    const [v] = (await h.db.query('SELECT * FROM episode_clips ORDER BY id')).rows;
    const cv = (await h.db.query('SELECT id FROM episode_covers WHERE clip_id=$1 LIMIT 1', [v.id])).rows[0];
    assert.equal((await as.gestao.get(`/capas/${cv.id}/imagem`)).status, 302);
    assert.equal((await as.gestao.get(`/capas/${cv.id}/editar`)).status, 200);
    assert.equal((await as.gestao.get(`/episodios/${ep.id}/capas/${cv.id}/imagem`)).status, 302, 'também pelo endereço do episódio dono');
    assert.equal((await as.gestao.get(`/episodios/${epEarly.id}/capas/${cv.id}/imagem`)).status, 404, 'mas não pelo de outro episódio');
    const frame = (await h.db.query('SELECT id FROM episode_frames WHERE clip_id=$1 LIMIT 1', [v.id])).rows[0];
    assert.equal((await as.gestao.get(`/quadros/${frame.id}`)).status, 302);
  });

  it('sem a leitura de rostos pela IA o corte fica pronto, avisa e não inventa capa; "ler de novo" refaz tudo', async () => {
    geminiMode = 'vision_fail';
    let r;
    try { r = await uploadClip(as.editor, 'sem-ia.mp4', vertical); await runAll(); } finally { geminiMode = 'ok'; }
    const c = await clipRow(r.id);
    assert.equal(c.status, 'pronto'); assert.match(c.note, /As capas ainda não foram geradas/);
    assert.equal((await h.db.query('SELECT count(*)::int n FROM episode_covers WHERE clip_id=$1', [c.id])).rows[0].n, 0);
    assert.equal((await post(as.editor, `/cortes/${c.id}/reprocessar`)).status, 302);
    await runAll();
    const again = await clipRow(c.id);
    assert.equal(again.note, null);
    assert.equal((await h.db.query('SELECT count(*)::int n FROM episode_covers WHERE clip_id=$1', [c.id])).rows[0].n, 3);
    // a gestão soube uma vez que o corte ficou disponível ("ler de novo" não repete); quem subiu não recebe esse aviso
    const { rows: notes } = await h.db.query(
      `SELECT u.role, n.title, n.body, n.url FROM notifications n JOIN users u ON u.id = n.user_id
        WHERE n.type = 'episodio' AND n.entity_type = 'clip' AND n.entity_id = $1 ORDER BY n.id`, [c.id]);
    assert.ok(notes.some((n) => n.role === 'gestao'), 'a gestão recebe');
    assert.equal(notes.filter((n) => n.role === 'gestao').length, 1, 'uma vez só, mesmo lendo de novo');
    assert.ok(!notes.some((n) => n.role === 'editor_video'), 'o editor que subiu não recebe');
    assert.match(notes[0].title, new RegExp(`^Corte disponível: ${c.title}`)); assert.match(notes[0].body, /subiu o corte\. .*publicar\./); assert.equal(notes[0].url, `/cortes/${c.id}`);
  });

  it('um arquivo que não é vídeo de verdade vira erro claro (e dá para excluir)', async () => {
    const r = await uploadClip(as.editor, 'quebrado.mp4', Buffer.from('isto não é um vídeo'.repeat(10)));
    assert.equal(r.done.status, 200);
    await runAll();
    const c = await clipRow(r.id);
    assert.equal(c.status, 'erro'); assert.match(c.error, /Não consegui ler este vídeo/);
    assert.match((await as.editor.get(`/cortes/${c.id}`)).text, /Não consegui ler este vídeo/);
    await post(as.editor, `/cortes/${c.id}/excluir`);
    assert.equal((await h.db.query('SELECT count(*)::int n FROM episode_clips WHERE id=$1', [c.id])).rows[0].n, 0);
    assert.ok(!h.b2Store.has(c.storage_key));
  });

  describe('publicação', () => {
    let clip; let pubCount = 0;
    const platforms = (...p) => p.map((x) => ['platforms', x]);
    // publicar: vários "platforms" precisam repetir a chave, então monta o corpo na mão
    const publishTo = async (c, p, pairs) => {
      const token = await c.csrf('/episodios');
      const r = await fetch(`${app.base}${p}`, { method: 'POST', headers: { cookie: c.cookie(), 'x-csrf-token': token, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(pairs).toString(), redirect: 'manual' });
      const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* html */ }
      return { status: r.status, json: j, text };
    };
    const publish = (c, pairs) => publishTo(c, `/cortes/${clip.id}/publicar`, pairs);

    before(async () => { clip = (await h.db.query("SELECT * FROM episode_clips WHERE status='pronto' AND episode_id IS NOT NULL AND cover_id IS NOT NULL ORDER BY id LIMIT 1")).rows[0]; assert.ok(clip, 'precisa de um corte pronto e atribuído'); });

    it('um corte sem episódio não publica', async () => {
      const loose = (await h.db.query("SELECT id FROM episode_clips WHERE episode_id IS NULL AND status='pronto' ORDER BY id LIMIT 1")).rows[0];
      const r = await publishTo(as.gestao, `/cortes/${loose.id}/publicar`, [['title', 'T'], ...platforms('tiktok'), ['confirmar', '1']]);
      assert.equal(r.status, 422); assert.match(r.json.error, /Atribua o corte a um episódio/);
    });

    it('modo de teste (padrão): monta e confere o pedido, marca como simulado e NÃO chama o Upload-Post', async () => {
      assert.equal(config.uploadPost.live, false);
      const calls = h.uploadPostCalls.length;
      const r = await publish(as.gestao, [['title', 'Prazo pra sair do cargo'], ['description', 'Jonata fala de sucessão. #sucessão'], ...platforms('tiktok', 'youtube', 'instagram'), ['confirmar', '1']]);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.publication.status, 'simulado');
      assert.equal(h.uploadPostCalls.length, calls, 'nenhuma chamada ao Upload-Post em modo de teste');
      assert.ok(r.json.publication.results.every((x) => x.simulated));
      assert.equal(r.json.publication.episode_id, ep.id, 'a publicação do corte guarda o episódio dele');
      pubCount += 1;
    });

    it('exige confirmação e gestão (produtora pede e vai para revisão); recusa textos acima dos limites e agendamento no passado', async () => {
      const base = [['title', 'Título'], ['description', 'Legenda'], ...platforms('tiktok'), ['confirmar', '1']];
      assert.equal((await publish(as.editor, base)).status, 403);
      const asked = await publish(as.prod, base);
      assert.equal(asked.status, 200);
      assert.equal(asked.json.publication.status, 'revisao', 'pedido da produtora vai para a revisão da gestão');
      await h.db.query('DELETE FROM episode_publications WHERE id=$1', [asked.json.publication.id]);
      assert.match((await publish(as.gestao, base.filter(([k]) => k !== 'confirmar'))).json.error, /Confirme/);
      assert.match((await publish(as.gestao, [['title', 'T'], ['description', 'x'.repeat(2201)], ...platforms('instagram'), ['confirmar', '1']])).json.error, /2200/);
      assert.match((await publish(as.gestao, [['title', 'T'], ...platforms('youtube'), ['agendar', '2020-01-01T10:00'], ['confirmar', '1']])).json.error, /futuro/);
      assert.equal((await h.db.query('SELECT count(*)::int n FROM episode_publications')).rows[0].n, pubCount);
    });

    it('ao vivo: formulário certo (Reels com capa, Shorts sem thumbnail, vídeo por link assinado) e acompanha até publicar', async () => {
      config.uploadPost.live = true; up.resetCache();
      try {
        const r = await publish(as.gestao, [['title', 'Prazo pra sair do cargo'], ['description', 'Jonata fala de sucessão.\n\n#sucessão'], ...platforms('youtube', 'instagram'), ['confirmar', '1']]);
        assert.equal(r.status, 200, r.text);
        assert.equal(r.json.publication.status, 'enviando');
        const sent = lastCall((c) => c.method === 'POST' && c.url.endsWith('/api/upload'));
        const f = fieldsOf(sent);
        assert.deepEqual(f['platform[]'].sort(), ['instagram', 'youtube']);
        assert.match(f.video[0], /X-Amz-Signature=|127\.0\.0\.1/);
        assert.equal(f.media_type[0], 'REELS');
        assert.match(f.cover_url[0], /X-Amz-Signature=/);
        assert.equal(f.thumbnail_url, undefined, 'Shorts não aceitam thumbnail personalizada');
        assert.equal(sent.idempotency, f.request_id[0]);
        h.uploadPostState.status = { status: 'completed', completed: 2, total: 2, results: [
          { platform: 'youtube', success: true, status: 'completed', post_url: 'https://youtube.com/shorts/abc' },
          { platform: 'instagram', success: true, status: 'completed', post_url: 'https://instagram.com/reel/xyz' }] };
        assert.equal((await publishing.refresh(r.json.publication.id)).status, 'publicado');
        pubCount += 1;
      } finally { config.uploadPost.live = false; }
    });

    it('ao vivo: rede sem conta conectada é recusada; falha vira erro e dá para tentar de novo', async () => {
      config.uploadPost.live = true; up.resetCache();
      try {
        const calls = h.uploadPostCalls.filter((c) => c.method === 'POST').length;
        const noTiktok = await publish(as.gestao, [['title', 'T'], ...platforms('tiktok'), ['confirmar', '1']]);
        assert.equal(noTiktok.status, 422); assert.match(noTiktok.json.error, /Sem conta conectada.*TikTok/);
        assert.equal(h.uploadPostCalls.filter((c) => c.method === 'POST').length, calls);
        h.uploadPostState.failUpload = 'Invalid media format';
        const bad = await publish(as.gestao, [['title', 'T'], ...platforms('instagram'), ['confirmar', '1']]);
        assert.equal(bad.json.publication.status, 'erro'); assert.match(bad.json.publication.error, /Invalid media format/);
        h.uploadPostState.failUpload = null;
        assert.equal((await publishing.retry(bad.json.publication.id)).status, 'enviando');
        pubCount += 1;
      } finally { config.uploadPost.live = false; }
    });

    it('agendamento é nosso: nada sai antes da hora; depois do horário o envio acontece; dá para cancelar', async () => {
      const r = await publish(as.gestao, [['title', 'Agendado'], ...platforms('instagram'), ['agendar', inDays(30)], ['confirmar', '1']]);
      assert.equal(r.json.publication.status, 'agendado');
      const calls = h.uploadPostCalls.length;
      await publishing.tick();
      assert.equal(h.uploadPostCalls.length, calls);
      await h.db.query("UPDATE episode_publications SET scheduled_at = now() - interval '1 minute' WHERE id=$1", [r.json.publication.id]);
      await publishing.tick();
      assert.equal((await h.db.query('SELECT status FROM episode_publications WHERE id=$1', [r.json.publication.id])).rows[0].status, 'simulado');
      const r2 = await publish(as.gestao, [['title', 'Cancelar'], ...platforms('instagram'), ['agendar', inDays(31)], ['confirmar', '1']]);
      assert.equal((await call(as.gestao, 'POST', `/episodios/${ep.id}/publicacoes/${r2.json.publication.id}/cancelar`)).status, 302);
      assert.equal((await h.db.query('SELECT count(*)::int n FROM episode_publications WHERE id=$1', [r2.json.publication.id])).rows[0].n, 0);
    });

    it('a página do corte mostra o modo de teste e as publicações; excluir apaga tudo do bucket', async () => {
      const page = await as.gestao.get(`/cortes/${clip.id}`);
      assert.match(page.text, /Modo de teste/);
      assert.match(page.text, /simulado/);
      const keys = [clip.storage_key, ...(await h.db.query('SELECT storage_key FROM episode_covers WHERE clip_id=$1', [clip.id])).rows.map((r) => r.storage_key), ...(await h.db.query('SELECT storage_key FROM episode_frames WHERE clip_id=$1', [clip.id])).rows.map((r) => r.storage_key)];
      assert.ok(keys.length >= 10);
      assert.equal((await call(as.gestao, 'POST', `/cortes/${clip.id}/excluir`)).status, 302);
      assert.ok(keys.every((k) => !h.b2Store.has(k)), 'nada sobrou no bucket');
      assert.equal((await h.db.query('SELECT count(*)::int n FROM episode_covers WHERE clip_id=$1', [clip.id])).rows[0].n, 0);
    });
  });
});

describe('regras dos cortes', () => {
  it('texto de capa: sem emoji, sem ponto final, até 28 caracteres', () => {
    assert.equal(clips.cleanCoverText('“Prazo pra sair.”'), 'Prazo pra sair');
    assert.ok(clips.cleanCoverText('Governança e sucessão familiar na prática empresarial').length <= 28);
    assert.doesNotMatch(clips.cleanCoverText('Sem ego 🔥'), /🔥/);
  });
  it('só episódio já gravado recebe cortes', () => {
    for (const s of ['gravado', 'em_edicao', 'publicado']) assert.ok(clips.ELIGIBLE_STATUSES.includes(s));
    for (const s of ['planejado', 'agendado']) assert.ok(!clips.ELIGIBLE_STATUSES.includes(s));
  });
});
