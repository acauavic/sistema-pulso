const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const h = require('./helpers');
const publishing = require('../src/services/publishing');
const board = require('../src/services/contentBoard');

describe('Conteúdo: pedidos ao editor, quadro da linha de produção e o que já saiu no Social', () => {
  let app; const as = {}; const u = {}; let ep; let trailer; let story;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const call = async (c, method, p, { json, raw, type } = {}) => {
    const token = await c.csrf('/episodios');
    const headers = { cookie: c.cookie(), accept: 'application/json', 'x-csrf-token': token };
    let body;
    if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); } else if (raw) { headers['content-type'] = type || 'application/octet-stream'; body = raw; }
    const r = await fetch(`${app.base}${p}`, { method, headers, body, redirect: 'manual' });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* html */ }
    return { status: r.status, json: j, text };
  };
  const act = (who, p, form) => as[who].act(p, form, { from: '/conteudo' });
  const reqRow = (id) => q('SELECT * FROM content_requests WHERE id = $1', [id]).then((r) => r[0]);
  const notes = (user) => q('SELECT title, url FROM notifications WHERE user_id = $1 ORDER BY id', [user.id]);
  const png = (w, hgt) => { const c = createCanvas(w, hgt); const g = c.getContext('2d'); g.fillStyle = '#2d1b4e'; g.fillRect(0, 0, w, hgt); return c.toBuffer('image/png'); };

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['editor', 'editor_video'], ['editor2', 'editor_video'], ['prod', 'produtora']]) {
      u[k] = await h.createUser({ name: `${k} Silva`, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`);
    }
    [ep] = await q("INSERT INTO episodes (number, title, status, published_at) VALUES (21, 'Conversa com Lia', 'publicado', now()) RETURNING *");
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('a gestão pede um trailer sem episódio para um editor: ele é avisado, vê no Início e o quadro mostra em "Pedido"', async () => {
    assert.equal((await act('editor', '/conteudo/pedidos', { kind: 'trailer', title: 'X' })).status, 403, 'o editor não pede, faz');
    const r = await act('gestao', '/conteudo/pedidos', { kind: 'trailer', title: 'Trailer da temporada', briefing_html: '<p>60 s, ritmo rápido, fecha com o logo.</p>', format: 'horizontal', assignee_id: u.editor.id, due_on: '2026-11-10' });
    assert.equal(r.status, 302);
    [trailer] = await q("SELECT * FROM content_requests WHERE title = 'Trailer da temporada'");
    assert.equal(trailer.status, 'pedido'); assert.equal(trailer.episode_id, null); assert.equal(trailer.format, 'horizontal');
    assert.ok((await notes(u.editor)).some((n) => /Pedido de conteúdo: Trailer da temporada/.test(n.title) && n.url === `/conteudo/pedidos/${trailer.id}`));
    assert.match((await as.editor.get('/')).text, /Pedidos de conteúdo[\s\S]*Trailer da temporada/);
    const page = (await as.gestao.get('/conteudo')).text;
    assert.match(page, /data-stage="pedido"[\s\S]*?Trailer da temporada[\s\S]*?data-stage="producao"/, 'no quadro, coluna Pedido');
    assert.match(page, /Pedir conteúdo/);
    assert.match((await as.gestao.get(`/conteudo/pedidos/${trailer.id}`)).text, /60 s, ritmo rápido/);
  });

  it('só quem faz começa e entrega; sem entrega não vai para a revisão; a entrega em vídeo nasce ligada ao pedido', async () => {
    assert.equal((await act('prod', `/conteudo/pedidos/${trailer.id}/comecar`, {})).status, 403);
    assert.equal((await act('editor2', `/conteudo/pedidos/${trailer.id}/comecar`, {})).status, 403, 'pedido com dono: o outro editor não pega');
    const early = await call(as.editor, 'POST', `/conteudo/pedidos/${trailer.id}/cortes/iniciar`, { json: { nome: 'trailer.mp4', tamanho: 1000, tipo: 'video/mp4' } });
    assert.equal(early.status, 409, 'antes de começar não envia');
    await act('editor', `/conteudo/pedidos/${trailer.id}/comecar`, {});
    assert.equal((await reqRow(trailer.id)).status, 'producao');
    await act('editor', `/conteudo/pedidos/${trailer.id}/entregar`, {});
    assert.equal((await reqRow(trailer.id)).status, 'producao', 'sem entrega, continua em produção');
    const data = Buffer.alloc(2000, 7);
    const init = await call(as.editor, 'POST', `/conteudo/pedidos/${trailer.id}/cortes/iniciar`, { json: { nome: 'trailer.mp4', tamanho: data.length, tipo: 'video/mp4' } });
    assert.equal(init.status, 200, init.text);
    for (let n = 1; n <= init.json.totalParts; n += 1) {
      const part = await call(as.editor, 'PUT', `/conteudo/pedidos/${trailer.id}/cortes/${init.json.id}/parte/${n}`, { raw: data.subarray((n - 1) * init.json.partSize, n * init.json.partSize) });
      assert.equal(part.status, 200, part.text);
    }
    assert.equal((await call(as.editor, 'POST', `/conteudo/pedidos/${trailer.id}/cortes/${init.json.id}/concluir`)).status, 200);
    const [clip] = await q('SELECT * FROM episode_clips WHERE id = $1', [init.json.id]);
    assert.equal(clip.request_id, trailer.id); assert.equal(clip.title, 'Trailer da temporada');
    // a leitura do vídeo (FFmpeg/IA) é de outro teste: aqui o vídeo já está pronto
    await q("UPDATE episode_clips SET status = 'pronto', width = 1920, height = 1080, duration_ms = 60000 WHERE id = $1", [clip.id]);
    assert.doesNotMatch((await as.gestao.get('/social/novo')).text, /Trailer da temporada/, 'antes de aprovar não aparece no Social');
    await assert.rejects(publishing.create({ clipId: clip.id, platforms: ['youtube'], title: 'Trailer', userId: u.gestao.id }), /ainda não foi aprovada/);
    await act('editor', `/conteudo/pedidos/${trailer.id}/entregar`, {});
    assert.equal((await reqRow(trailer.id)).status, 'revisao');
    assert.ok((await notes(u.gestao)).some((n) => /Entrega para revisar: Trailer da temporada/.test(n.title)));
    trailer.clipId = clip.id;
  });

  it('a gestão pede ajustes (volta para o editor com o recado) e depois aprova', async () => {
    assert.equal((await act('editor', `/conteudo/pedidos/${trailer.id}/aprovar`, {})).status, 403, 'quem faz não aprova');
    await act('gestao', `/conteudo/pedidos/${trailer.id}/ajustes`, { nota: 'Encurtar para 45 s' });
    let r = await reqRow(trailer.id);
    assert.equal(r.status, 'producao'); assert.equal(r.rounds, 1); assert.equal(r.review_note, 'Encurtar para 45 s');
    assert.ok((await notes(u.editor)).some((n) => /Ajustes pedidos: Trailer da temporada/.test(n.title)));
    assert.match((await as.editor.get(`/conteudo/pedidos/${trailer.id}`)).text, /Ajustes pedidos · 1ª volta[\s\S]*Encurtar para 45 s/);
    await act('editor', `/conteudo/pedidos/${trailer.id}/entregar`, {});
    await act('gestao', `/conteudo/pedidos/${trailer.id}/aprovar`, {});
    r = await reqRow(trailer.id);
    assert.equal(r.status, 'aprovado'); assert.equal(r.review_note, null);
    assert.ok((await notes(u.editor)).some((n) => /Entrega aprovada/.test(n.title)));
  });

  it('aprovado: entra no Social como avulso, sugerido; publica sem episódio; depois some da lista e aparece como publicado', async () => {
    let t = (await as.gestao.get('/social/novo')).text;
    assert.match(t, /Trailer da temporada/); assert.match(t, /Avulso · Trailer do canal/); assert.match(t, /sugerido/);
    let cards = (await board.build()).cards;
    assert.equal(cards.find((c) => c.key === `c${trailer.clipId}`).stage, 'pronto');
    const pub = await publishing.create({ clipId: trailer.clipId, platforms: ['youtube'], title: 'Trailer da temporada', description: 'Nova temporada do Pulso.', userId: u.gestao.id });
    assert.equal(pub.episode_id, null); assert.equal(pub.status, 'simulado', 'modo de teste');
    assert.match((await as.gestao.get(`/social/publicacoes/${pub.id}`)).text, /Conteúdo avulso/);
    await q("UPDATE episode_publications SET status = 'publicado', results = $2 WHERE id = $1", [pub.id, JSON.stringify([{ platform: 'youtube', ok: true, url: 'https://youtu.be/t' }])]);
    cards = (await board.build()).cards;
    const card = cards.find((c) => c.key === `c${trailer.clipId}`);
    assert.equal(card.stage, 'publicado'); assert.deepEqual(card.pub.platforms, ['YouTube']);
    t = (await as.gestao.get('/social/novo')).text;
    assert.doesNotMatch(t, /Avulso · Trailer do canal/, 'já publicado: sai da lista');
    t = (await as.gestao.get('/social/novo?publicados=1')).text;
    assert.match(t, /Avulso · Trailer do canal[\s\S]*?publicado/, 'com "ver já publicados" aparece, marcado');
    assert.match((await as.gestao.get('/conteudo')).text, /data-stage="publicado"[\s\S]*Trailer da temporada/);
    assert.match((await as.gestao.get(`/conteudo/pedidos/${trailer.id}`)).text, /Já saiu nas redes/);
  });

  it('story pedido: o editor entrega a imagem; aprovado, aparece em Story (e capa de corte não)', async () => {
    await act('prod', '/conteudo/pedidos', { kind: 'story', title: 'Story de bastidores', episode_id: ep.id });
    [story] = await q("SELECT * FROM content_requests WHERE title = 'Story de bastidores'");
    assert.equal(story.assignee_id, null);
    await act('editor2', `/conteudo/pedidos/${story.id}/comecar`, {});
    assert.equal((await reqRow(story.id)).assignee_id, u.editor2.id, 'sem dono: quem começa assume');
    const bad = await call(as.editor2, 'POST', `/conteudo/pedidos/${story.id}/imagens`, { raw: Buffer.from('nada aqui que seja imagem'.repeat(10)), type: 'image/png' });
    assert.equal(bad.status, 400);
    const ok = await call(as.editor2, 'POST', `/conteudo/pedidos/${story.id}/imagens`, { raw: png(1080, 1920), type: 'image/png' });
    assert.equal(ok.status, 200, ok.text);
    const [img] = await q("SELECT * FROM episode_covers WHERE request_id = $1", [story.id]);
    assert.equal(img.kind, 'entrega'); assert.equal(img.width, 1080); assert.ok(h.b2Store.has(img.storage_key));
    // uma capa de Reels de corte do mesmo episódio (vertical) não pode aparecer como story
    const [clip] = await q("INSERT INTO episode_clips (title, source, status, episode_id, storage_key) VALUES ('Corte 9', 'upload', 'pronto', $1, 'pp/c.mp4') RETURNING id", [ep.id]);
    const [capa] = await q("INSERT INTO episode_covers (episode_id, clip_id, kind, position, spec, storage_key, mime, width, height, size_bytes) VALUES ($1, $2, 'reel_cover', 0, '{}', 'pp/capa.jpg', 'image/jpeg', 1080, 1920, 10) RETURNING id", [ep.id, clip.id]);
    await act('editor2', `/conteudo/pedidos/${story.id}/entregar`, {});
    assert.doesNotMatch((await as.gestao.get('/social/novo?tipo=story')).text, new RegExp(`/capas/${img.id}/imagem`), 'antes de aprovar, não');
    await act('gestao', `/conteudo/pedidos/${story.id}/aprovar`, {});
    const t = (await as.gestao.get('/social/novo?tipo=story')).text;
    assert.match(t, new RegExp(`/capas/${img.id}/imagem`));
    assert.doesNotMatch(t, new RegExp(`/capas/${capa.id}/imagem`), 'capa de corte não é story');
    assert.equal((await as.gestao.get(`/capas/${img.id}/editar`)).status, 302, 'imagem entregue não abre no editor de capa');
  });

  it('pedido cancelado sai do Início do editor e do quadro; a lista de pedidos guarda o histórico', async () => {
    await act('gestao', '/conteudo/pedidos', { kind: 'post', title: 'Post de agenda', assignee_id: u.editor.id });
    const [p] = await q("SELECT * FROM content_requests WHERE title = 'Post de agenda'");
    assert.equal((await act('editor', `/conteudo/pedidos/${p.id}/cancelar`, {})).status, 403, 'só quem pediu ou a gestão cancela');
    await act('gestao', `/conteudo/pedidos/${p.id}/cancelar`, {});
    assert.equal((await reqRow(p.id)).status, 'cancelado');
    assert.doesNotMatch((await as.editor.get('/')).text, /Post de agenda/);
    const page = (await as.gestao.get('/conteudo?vista=pedidos')).text;
    assert.match(page, /Aprovados e cancelados[\s\S]*Post de agenda/);
    assert.ok(!(await board.build()).cards.some((c) => c.title === 'Post de agenda'));
  });

  it('comentários no pedido avisam o responsável', async () => {
    const r = await as.gestao.act('/comentarios', { tipo: 'content_request', id: String(trailer.id), texto: 'Ficou ótimo, @editor Silva' }, { from: `/conteudo/pedidos/${trailer.id}` });
    assert.ok([200, 302].includes(r.status));
    assert.ok((await notes(u.editor)).some((n) => /pedido de conteúdo: Trailer da temporada/.test(n.title)));
  });
});
