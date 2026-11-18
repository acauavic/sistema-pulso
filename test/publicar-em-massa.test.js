const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const bulk = require('../src/services/bulkPublish');

describe('Conteúdo: filtro por episódio, ordem, publicar em massa com agenda e capas em lote', () => {
  const as = {}; let app; let ep; let ep2; const ids = {};
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const tomorrow = () => new Date(Date.now() - 3 * 3600_000 + 86400_000).toISOString().slice(0, 10);

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    [ep] = await q("INSERT INTO episodes (number, title, status) VALUES (3, 'Telas e infância', 'publicado') RETURNING *");
    [ep2] = await q("INSERT INTO episodes (number, title, status) VALUES (5, 'Menopausa', 'publicado') RETURNING *");
    const mk = async (title, epId, extra = {}) => {
      const key = `pp/${title.replace(/\W/g, '')}.mp4`; h.b2Store.set(key, { body: Buffer.alloc(2000, 1), contentType: 'video/mp4' });
      const [c] = await q("INSERT INTO episode_clips (title, post_title, caption, source, status, episode_id, storage_key, size_bytes, content_type, width, height, duration_ms, created_at) VALUES ($1, $2, 'Legenda.', 'upload', 'pronto', $3, $4, 2000, 'video/mp4', 1080, 1920, $5, $6) RETURNING *",
        [title, `Título ${title}`, epId, key, extra.ms || 30000, extra.at || new Date()]);
      return c;
    };
    ids.a = (await mk('Corte 1', ep.id, { ms: 40000, at: '2026-11-01' })).id;
    ids.b = (await mk('Corte 2', ep.id, { ms: 20000, at: '2026-11-03' })).id;
    ids.c = (await mk('Corte 3', ep2.id, { ms: 30000, at: '2026-11-02' })).id;
    ids.done = (await mk('Corte 9', ep.id)).id;
    await q("INSERT INTO episode_publications (episode_id, clip_id, platforms, title, status, results) VALUES ($1, $2, '{instagram}', 'Já saiu', 'publicado', '[]')", [ep.id, ids.done]);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('horários: espalhados entre o começo e o fim do dia, e os Reels de teste com as normais espalhadas', () => {
    const m = bulk.daySlots(8 * 60, 22 * 60, 10);
    assert.equal(m.length, 10); assert.equal(m[0], 480); assert.equal(m[9], 1320);
    assert.ok(m.every((x) => x % 5 === 0), 'de 5 em 5 minutos');
    assert.deepEqual(bulk.daySlots(8 * 60, 22 * 60, 1), [480]);
    const mask = bulk.trialMask(10, 7);
    assert.equal(mask.filter(Boolean).length, 7);
    assert.deepEqual(mask.map((t, i) => (t ? null : i)).filter((x) => x !== null), [1, 5, 8], 'as 3 normais espalhadas no dia');
    const slots = bulk.plan([1, 2, 3, 4, 5], { start: '2030-01-10', from: 480, to: 1320, perDay: 2, trialPerDay: 1 });
    assert.deepEqual(slots.map((s) => s.at), ['2030-01-10T11:00:00.000Z', '2030-01-11T01:00:00.000Z', '2030-01-11T11:00:00.000Z', '2030-01-12T01:00:00.000Z', '2030-01-12T11:00:00.000Z'], '08:00 e 22:00 de Brasília, dia após dia');
    assert.equal(slots.filter((s) => s.trial).length, 3);
    const past = bulk.plan([1], { start: '2020-01-01', from: 480, to: 480, perDay: 1, trialPerDay: 0 }, new Date('2020-01-01T15:00:00Z'));
    assert.equal(past[0].at, '2020-01-02T11:00:00.000Z', 'horário que já passou vai para o dia seguinte');
    assert.match(bulk.readOptions({ de: '22:00', ate: '08:00', por_dia: '3' }).error, /depois do começo/);
    assert.match(bulk.readOptions({ por_dia: '3', teste_por_dia: '5' }).error, /Reels de teste/);
  });

  it('aba Cortes: filtro "prontos para postar", filtro por episódio e ordem', async () => {
    let t = (await as.gestao.get('/conteudo?vista=cortes&situacao=pronto')).text;
    assert.match(t, /Prontos para postar <span class="mono">3<\/span>/);
    assert.doesNotMatch(t, new RegExp(`data-clip="${ids.done}"`), 'o publicado sai do filtro');
    t = (await as.gestao.get('/conteudo?vista=cortes&ordem=duracao')).text;
    assert.ok(t.indexOf(`data-clip="${ids.b}"`) < t.indexOf(`data-clip="${ids.a}"`), 'mais curto primeiro');
    t = (await as.gestao.get(`/conteudo?vista=cortes&episodio=${ep2.id}`)).text;
    assert.match(t, new RegExp(`data-clip="${ids.c}"`)); assert.doesNotMatch(t, new RegExp(`data-clip="${ids.a}"`));
    t = (await as.gestao.get('/conteudo')).text;
    assert.match(t, /data-dl-open="modal-massa-publicar"/); assert.match(t, /data-dl-open="modal-capas-lote"/);
    assert.match(t, /Selecionar para publicar em massa/);
    assert.match(t, /name="episodio" data-autosubmit aria-label="Filtrar por episódio"/);
  });

  it('publicar em massa: agenda para conferir, o que já saiu fica de fora e cada corte vira uma publicação agendada', async () => {
    const day = tomorrow();
    const form = { ids: [String(ids.a), String(ids.b), String(ids.c), String(ids.done)], platforms: ['instagram', 'tiktok'], inicio: day, de: '08:00', ate: '22:00', por_dia: '2', teste_por_dia: '1', teste_modo: 'manual' };
    const prev = await as.gestao.act('/conteudo/em-massa/publicar/previa', form, { from: '/conteudo?vista=cortes' });
    assert.equal(prev.status, 200, prev.text);
    assert.match(prev.text, /Agenda de <span class="mono">3<\/span> cortes/);
    assert.match(prev.text, /1 corte ficou<\/strong>|1 corte ficou de fora/); assert.match(prev.text, /já publicado/);
    assert.equal((prev.text.match(/name="teste_\d+" value="1" checked/g) || []).length, 2, '1 por dia de teste: 2 nos 3 cortes (2 dias)');
    const at = (id) => prev.text.match(new RegExp(`name="at_${id}" value="([^"]+)"`))[1];
    assert.equal(at(ids.a), `${day}T08:00`);
    const trialOf = (id) => new RegExp(`name="teste_${id}" value="1" checked`).test(prev.text);
    const confirm = { ids: [String(ids.a), String(ids.b), String(ids.c)], platforms: ['instagram', 'tiktok'], teste_modo: 'manual', confirmar: '1' };
    for (const id of [ids.a, ids.b, ids.c]) { confirm[`at_${id}`] = at(id); if (trialOf(id)) confirm[`teste_${id}`] = '1'; }
    const r = await as.gestao.act('/conteudo/em-massa/publicar', confirm, { from: '/conteudo?vista=cortes' });
    assert.equal(r.status, 302);
    const pubs = await q('SELECT * FROM episode_publications WHERE clip_id = ANY($1) ORDER BY scheduled_at', [[ids.a, ids.b, ids.c]]);
    assert.equal(pubs.length, 3);
    assert.ok(pubs.every((p) => p.status === 'agendado' && p.scheduled_at));
    assert.deepEqual(pubs.map((p) => p.platforms.sort()), [['instagram', 'tiktok'], ['instagram', 'tiktok'], ['instagram', 'tiktok']]);
    assert.equal(pubs.filter((p) => p.options.instagram?.trial === 'manual').length, 2);
    assert.ok(pubs.every((p) => p.options.ctas?.instagram && p.options.ctas?.tiktok), 'cada uma com a chamada de cada rede');
    assert.equal(pubs[0].title, 'Título Corte 1');
    // de novo: nada para agendar (já estão na fila)
    const again = await as.gestao.act('/conteudo/em-massa/publicar/previa', form, { from: '/conteudo?vista=cortes' });
    assert.match(again.text, /Nada para agendar/);
  });

  it('a produtora manda a agenda para a revisão da gestão', async () => {
    const [c] = await q("INSERT INTO episode_clips (title, source, status, episode_id, storage_key, size_bytes, content_type, duration_ms) VALUES ('Corte 4', 'upload', 'pronto', $1, 'pp/x4.mp4', 10, 'video/mp4', 30000) RETURNING id", [ep.id]);
    const r = await as.prod.act('/conteudo/em-massa/publicar', { ids: [String(c.id)], platforms: ['tiktok'], [`at_${c.id}`]: `${tomorrow()}T10:00` }, { from: '/conteudo?vista=cortes' });
    assert.equal(r.status, 302);
    assert.equal((await q('SELECT status FROM episode_publications WHERE clip_id = $1', [c.id]))[0].status, 'revisao');
  });

  it('capas em lote: escolher a capa de cada corte e gerar capa nova com outro texto', async () => {
    const { createCanvas } = require('@napi-rs/canvas');
    const cv = createCanvas(360, 640); const g = cv.getContext('2d'); g.fillStyle = '#556677'; g.fillRect(0, 0, 360, 640);
    const jpg = cv.toBuffer('image/jpeg');
    h.b2Store.set('pp/quadro-a.jpg', { body: jpg, contentType: 'image/jpeg' });
    const [fr] = await q("INSERT INTO episode_frames (episode_id, clip_id, at_ms, storage_key, width, height, analysis, score) VALUES ($1, $2, 1000, 'pp/quadro-a.jpg', 360, 640, '{\"rostos\":[],\"caixas_de_texto\":[]}', 5) RETURNING id", [ep.id, ids.a]);
    h.b2Store.set('pp/capa-a1.jpg', { body: jpg, contentType: 'image/jpeg' }); h.b2Store.set('pp/capa-a2.jpg', { body: jpg, contentType: 'image/jpeg' });
    const spec = (text) => JSON.stringify({ format: 'reel_cover', width: 1080, height: 1920, bg: { kind: 'frame', ref: `f${fr.id}` }, layers: [{ id: 'texto', type: 'text', role: 'main', text }] });
    const [c1] = await q("INSERT INTO episode_covers (episode_id, clip_id, kind, spec, storage_key, mime, width, height, size_bytes, auto, approved, label, position) VALUES ($1, $2, 'reel_cover', $3, 'pp/capa-a1.jpg', 'image/jpeg', 1080, 1920, 10, true, false, 'Capa 1: Telas roubam tempo', 0) RETURNING id", [ep.id, ids.a, spec('Telas roubam tempo')]);
    const [c2] = await q("INSERT INTO episode_covers (episode_id, clip_id, kind, spec, storage_key, mime, width, height, size_bytes, auto, approved, label, position) VALUES ($1, $2, 'reel_cover', $3, 'pp/capa-a2.jpg', 'image/jpeg', 1080, 1920, 10, true, false, 'Capa 2: Criança sem tédio', 1) RETURNING id", [ep.id, ids.a, spec('Criança sem tédio')]);
    await q('UPDATE episode_clips SET cover_id = $2 WHERE id = $1', [ids.a, c1.id]);
    const page = (await as.gestao.get(`/conteudo/capas-em-lote?ids=${ids.a}&ids=${ids.b}`)).text;
    assert.match(page, /Capas de <span class="mono">2<\/span> cortes/);
    assert.match(page, new RegExp(`name="capa_${ids.a}" value="${c1.id}" checked`));
    assert.match(page, new RegExp(`name="texto_${ids.a}" value="Telas roubam tempo"`));
    assert.match(page, /Sem capa e sem quadros lidos/);
    // só trocar a capa escolhida
    const sw = await as.gestao.act('/conteudo/capas-em-lote', { ids: [String(ids.a)], [`capa_${ids.a}`]: String(c2.id), [`texto_${ids.a}`]: 'Criança sem tédio', [`antes_${ids.a}`]: 'Criança sem tédio' }, { from: '/conteudo' });
    assert.equal(sw.status, 302);
    assert.equal((await q('SELECT cover_id FROM episode_clips WHERE id = $1', [ids.a]))[0].cover_id, c2.id);
    // texto novo: capa nova sobre o mesmo quadro, escolhida e aprovada
    const r = await as.gestao.act('/conteudo/capas-em-lote', { ids: [String(ids.a)], [`capa_${ids.a}`]: String(c2.id), [`texto_${ids.a}`]: 'Tédio também educa', [`antes_${ids.a}`]: 'Criança sem tédio' }, { from: '/conteudo' });
    assert.equal(r.status, 302);
    const [clip] = await q('SELECT cover_id, cover_texts FROM episode_clips WHERE id = $1', [ids.a]);
    const [made] = await q('SELECT * FROM episode_covers WHERE id = $1', [clip.cover_id]);
    assert.equal(made.label, 'Capa: Tédio também educa'); assert.equal(made.approved, true); assert.equal(made.auto, false);
    assert.equal(made.spec.bg.ref, `f${fr.id}`, 'mesmo quadro da capa de base');
    assert.equal(clip.cover_texts[0], 'Tédio também educa');
    assert.equal((await q('SELECT count(*)::int n FROM episode_covers WHERE clip_id = $1 AND approved', [ids.a]))[0].n, 1);
    assert.equal((await as.prod.get(`/conteudo/capas-em-lote?ids=${ids.a}`)).status, 200, 'a produtora também mexe nas capas');
  });
});
