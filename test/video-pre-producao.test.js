// Pré-produção: o vídeo nasce antes da gravação, e só vira episódio gravado (com tarefas, custos e link do estúdio) quando é marcado.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const one = async (sql, params) => (await h.db.query(sql, params)).rows[0];

describe('vídeo: etapa de pré-produção', () => {
  let app; let c; let sara; let video;

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    sara = await h.createUser({ name: 'Sara Super', email: 's@t.com', role: 'superadmin', projects: [1, 2] });
    await h.db.query("UPDATE projects SET modules = modules || '{\"producao\": true}'::jsonb WHERE id = 2");
    await require('../src/services/projects').refresh(true);
    c = h.client(app.base); await c.login('s@t.com');
    await c.act('/projeto', { project: '2', voltar: '/' });
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('no projeto de vídeo, a ação principal é "Novo vídeo" e a janela pede título e data prevista', async () => {
    const page = (await c.get('/episodios')).text;
    assert.match(page, /<h1>Vídeos<\/h1>/);
    assert.match(page, /data-modal-open="modal-novo-video"[^>]*>[\s\S]{0,600}Novo vídeo/);
    assert.match(page, /<h2 id="novo-video-h">Novo vídeo<\/h2>/);
    assert.match(page, /name="title"[^>]*required/); assert.match(page, /name="recorded_on"/);
    assert.match(page, /O vídeo começa em <strong>Pré-produção<\/strong>/);
    assert.match(page, /data-status="pre_producao"/, 'o quadro tem a coluna da etapa nova');
    assert.match(page, /<span class="badge b-st-pre_producao">Pré-produção<\/span>/);
  });

  it('o vídeo nasce em Pré-produção, sem tarefas, sem custo e sem link do estúdio', async () => {
    const r = await c.act('/episodios/video', { title: 'Como escolher um plano', recorded_on: '2026-12-02' }, { from: '/episodios' });
    assert.equal(r.status, 302);
    video = await one("SELECT * FROM episodes WHERE title = 'Como escolher um plano'");
    assert.equal(video.status, 'pre_producao'); assert.equal(video.format, 'video'); assert.equal(video.project_id, 2);
    assert.equal(video.number, 1); assert.equal(video.recorded_on.toISOString().slice(0, 10), '2026-12-02');
    for (const t of ['tasks', 'content_requests', 'fin_entries']) {
      assert.equal((await h.db.query(`SELECT count(*)::int AS n FROM ${t} WHERE episode_id = $1`, [video.id])).rows[0].n, 0, t);
    }
    assert.equal((await h.db.query('SELECT count(*)::int AS n FROM episode_upload_links WHERE episode_id = $1', [video.id])).rows[0].n, 0);
    assert.match((await c.get(`/episodios/${video.id}`)).text, /Marcar como gravado/);
  });

  it('sem título não cria', async () => {
    assert.equal((await c.act('/episodios/video', { title: '  ' }, { from: '/episodios' })).status, 302);
    assert.equal(await one("SELECT 1 FROM episodes WHERE title = ''"), undefined);
    assert.match((await c.get('/episodios')).text, /Dê um título para o vídeo\./);
  });

  it('"Marcar como gravado" leva para Gravado e só então cria tarefas, custo e link do estúdio', async () => {
    const r = await c.act(`/episodios/${video.id}/etapa`, { to: 'gravado' }, { from: `/episodios/${video.id}` });
    assert.equal(r.status, 302);
    const ep = await one('SELECT status FROM episodes WHERE id = $1', [video.id]);
    assert.equal(ep.status, 'gravado');
    const pedidos = (await h.db.query('SELECT title FROM content_requests WHERE episode_id = $1 ORDER BY id', [video.id])).rows.map((r) => r.title);
    assert.ok(pedidos.length > 0, 'as rotinas criaram os pedidos de conteúdo do episódio');
    assert.equal((await h.db.query('SELECT count(*)::int AS n FROM content_requests WHERE episode_id = $1 AND project_id = 2', [video.id])).rows[0].n, pedidos.length, 'os pedidos nascem no projeto do vídeo');
    assert.equal((await h.db.query('SELECT count(*)::int AS n FROM episode_upload_links WHERE episode_id = $1', [video.id])).rows[0].n, 1);
    const eventos = (await h.db.query("SELECT message FROM episode_events WHERE episode_id = $1 ORDER BY id", [video.id])).rows.map((e) => e.message);
    assert.ok(eventos.some((m) => /em pré-produção/.test(m)), eventos.join(' | '));
    assert.ok(eventos.some((m) => /Pré-produção → Gravado/.test(m)), eventos.join(' | '));
  });

  it('no Pulso nada muda: o botão é o de sempre e o episódio do convidado nasce gravado', async () => {
    await c.act('/projeto', { project: '1', voltar: '/' });
    const page = (await c.get('/episodios')).text;
    assert.match(page, /<h1>Episódios<\/h1>/);
    assert.doesNotMatch(page, /modal-novo-video/);
    assert.match(page, /Registrar episódio gravado/);
    const g = await one("INSERT INTO guests (name, status, project_id) VALUES ('Dra. Pulso', 'gravado', 1) RETURNING id");
    const ep = await require('../src/services/production').syncFromGuest(g.id, sara.id);
    assert.equal(ep.status, 'gravado'); assert.equal(ep.format, 'podcast');
  });
});
