// Sessão de gravação: vários vídeos numa ida ao estúdio; as horas são da sessão e cada vídeo gravado leva a parte dele.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const S = require('../src/services/sessions');

const one = async (sql, params) => (await h.db.query(sql, params)).rows[0];
const rows = async (sql, params) => (await h.db.query(sql, params)).rows;

describe('sessão de gravação', () => {
  let app; let gestao; let p100Only; let pulsoOnly; let vids; let pulsoVideo; let sessionId;

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    await h.createUser({ name: 'Gil Gestão', email: 'g@t.com', role: 'gestao', projects: [1, 2] });
    await h.createUser({ name: 'Cem Produtora', email: 'c@t.com', role: 'produtora', projects: [2] });
    await h.createUser({ name: 'Pia Pulso', email: 'p@t.com', role: 'gestao', projects: [1] });
    await h.db.query("UPDATE projects SET modules = modules || '{\"producao\": true}'::jsonb WHERE id = 2");
    await require('../src/services/projects').refresh(true);
    gestao = h.client(app.base); await gestao.login('g@t.com');
    p100Only = h.client(app.base); await p100Only.login('c@t.com');
    pulsoOnly = h.client(app.base); await pulsoOnly.login('p@t.com');
    vids = [];
    for (let n = 1; n <= 4; n += 1) vids.push(await one("INSERT INTO episodes (title, number, project_id, status, format) VALUES ($1, $2, 2, 'pre_producao', 'video') RETURNING *", [`Vídeo ${n}`, n]));
    pulsoVideo = await one("INSERT INTO episodes (title, number, project_id, status, format) VALUES ('Do Pulso', 1, 1, 'pre_producao', 'video') RETURNING *");
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('as partes somam o total, em minutos inteiros', () => {
    assert.deepEqual(S.shares(130, 3), [44, 43, 43]);
    assert.deepEqual(S.shares(120, 10), Array(10).fill(12));
    assert.equal(S.shares(7, 3).reduce((a, b) => a + b, 0), 7);
    assert.equal(S.fmtMinutes(130), '2 h 10'); assert.equal(S.fmtMinutes(45), '45 min');
  });

  it('marcar a sessão leva para escolher os vídeos', async () => {
    const r = await gestao.act('/sessoes', { project_id: 2, starts_at: '2026-12-03T14:00', horas: 2, minutos: 0, place: 'Estúdio HS' }, { from: '/sessoes' });
    assert.equal(r.status, 302);
    const s = await one('SELECT * FROM recording_sessions ORDER BY id DESC LIMIT 1');
    sessionId = s.id;
    assert.equal(s.project_id, 2); assert.equal(s.planned_minutes, 120); assert.equal(s.status, 'planejada');
    assert.equal(r.location, `/sessoes/${s.id}?abrir=videos`);
    const page = (await gestao.get(r.location)).text;
    assert.match(page, /id="modal-sess-videos"[^>]*data-open-on-load/);
    assert.match(page, /Vídeo 3/); assert.doesNotMatch(page, /Do Pulso/, 'só os vídeos do projeto da sessão');
  });

  it('escolher os vídeos: os de outro projeto não entram; a ordem é a da marcação', async () => {
    await gestao.act(`/sessoes/${sessionId}/videos`, { video: [vids[2].id, vids[0].id, vids[1].id, pulsoVideo.id] }, { from: `/sessoes/${sessionId}` });
    const list = await rows('SELECT id, session_position FROM episodes WHERE session_id = $1 ORDER BY session_position', [sessionId]);
    assert.deepEqual(list.map((x) => x.id), [vids[2].id, vids[0].id, vids[1].id]);
    assert.equal((await one('SELECT session_id FROM episodes WHERE id = $1', [pulsoVideo.id])).session_id, null);
  });

  it('o estúdio ocupado aparece como aviso; quem não vê o outro projeto vê só "outro projeto"', async () => {
    await h.db.query(`INSERT INTO guests (name, status, project_id, instagram, profile, proposed_at) VALUES ('Dra. Pulso', 'agendado', 1, '@dp', 'medico', '2026-12-03T15:00:00-03:00')`);
    assert.match((await gestao.get(`/sessoes/${sessionId}`)).text, /Estúdio ocupado no mesmo horário: <a href="\/convidados\/\d+">Gravação com Dra\. Pulso<\/a>/);
    const page = (await p100Only.get(`/sessoes/${sessionId}`)).text;
    assert.match(page, /Estúdio ocupado por outro projeto/); assert.doesNotMatch(page, /Dra\. Pulso/);
  });

  it('"Gravado" tira o vídeo da pré-produção com a data da sessão e a parte prevista', async () => {
    const r = await p100Only.act(`/sessoes/${sessionId}/videos/${vids[2].id}/gravado`, {}, { from: `/sessoes/${sessionId}` });
    assert.equal(r.status, 302);
    let v = await one('SELECT status, recording_minutes, to_char(recorded_on, \'YYYY-MM-DD\') AS day FROM episodes WHERE id = $1', [vids[2].id]);
    assert.equal(v.status, 'gravado'); assert.equal(v.day, '2026-12-03'); assert.equal(v.recording_minutes, 120);
    await p100Only.act(`/sessoes/${sessionId}/videos/${vids[0].id}/gravado`, {}, { from: `/sessoes/${sessionId}` });
    v = await one('SELECT recording_minutes FROM episodes WHERE id = $1', [vids[2].id]);
    assert.equal(v.recording_minutes, 60, 'a parte se refaz a cada gravado');
    assert.equal((await one('SELECT count(*)::int AS n FROM episode_upload_links')).n, 0, 'vídeo de sessão não ganha link do estúdio próprio');
  });

  it('encerrar divide a duração real entre os gravados, devolve o que faltou e cria um link do estúdio da sessão', async () => {
    const r = await gestao.act(`/sessoes/${sessionId}/encerrar`, { horas: 2, minutos: 10 }, { from: `/sessoes/${sessionId}` });
    assert.equal(r.status, 302);
    const s = await one('SELECT * FROM recording_sessions WHERE id = $1', [sessionId]);
    assert.equal(s.status, 'encerrada'); assert.equal(s.actual_minutes, 130);
    const done = await rows("SELECT id, recording_minutes FROM episodes WHERE session_id = $1 ORDER BY session_position", [sessionId]);
    assert.deepEqual(done.map((x) => x.recording_minutes), [65, 65]);
    assert.equal((await one('SELECT session_id, status FROM episodes WHERE id = $1', [vids[1].id])).session_id, null, 'o não gravado saiu da sessão');
    // custo de estúdio (R$ 300/h): a soma dos vídeos é o custo da sessão
    const { total } = await one("SELECT sum(amount_cents)::int AS total FROM fin_entries WHERE auto_key LIKE 'estudio-saldo-e%' AND episode_id = ANY($1::int[]) AND status <> 'cancelado'", [done.map((x) => x.id)]);
    assert.equal(total, 65000);
    const link = await one('SELECT * FROM episode_upload_links WHERE session_id = $1', [sessionId]);
    assert.ok(link, 'um link do estúdio para a sessão');
    const page = (await gestao.get(`/sessoes/${sessionId}`)).text;
    assert.match(page, /Link do estúdio da sessão/);
    // a página pública do estúdio fala da sessão
    const studio = (await h.client(app.base).get(`/estudio/${link.token}`)).text;
    assert.match(studio, /Sessão de gravação de 03\/12\/2026/);
  });

  it('o material da sessão é distribuído entre os vídeos', async () => {
    const holder = (await one('SELECT episode_id FROM episode_upload_links WHERE session_id = $1', [sessionId])).episode_id;
    const f = await one(`INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, version, status, session_id, session_pending)
      VALUES ($1, 'bruto_video', 'cam-a-video2.mp4', 10, 'k/a.mp4', 1, 'pronto', $2, true) RETURNING id`, [holder, sessionId]);
    assert.match((await gestao.get(`/sessoes/${sessionId}`)).text, /De qual vídeo é cada arquivo/);
    await gestao.act(`/sessoes/${sessionId}/arquivos`, { [`arquivo_${f.id}`]: vids[0].id }, { from: `/sessoes/${sessionId}` });
    const after = await one('SELECT episode_id, session_pending FROM episode_files WHERE id = $1', [f.id]);
    assert.equal(after.episode_id, vids[0].id); assert.equal(after.session_pending, false);
  });

  it('corrigir a duração refaz as partes', async () => {
    await gestao.act(`/sessoes/${sessionId}/duracao`, { horas: 3, minutos: 0 }, { from: `/sessoes/${sessionId}` });
    const done = await rows('SELECT recording_minutes FROM episodes WHERE session_id = $1', [sessionId]);
    assert.deepEqual(done.map((x) => x.recording_minutes), [90, 90]);
  });

  it('banco de horas: a sessão planejada reserva, o vídeo em pré-produção não gasta, a encerrada gasta a duração real', async () => {
    const hourBank = require('../src/services/hourBank');
    const on = await hourBank.activate({ startEpisodeId: vids[2].id, pack: { hours: 20, amountCents: 600000 } });
    assert.ok(on.ok, on.error);
    await gestao.act('/sessoes', { project_id: 2, starts_at: '2026-12-10T09:00', horas: 4, minutos: 0 }, { from: '/sessoes' });
    const next = await one('SELECT id FROM recording_sessions ORDER BY id DESC LIMIT 1');
    await gestao.act(`/sessoes/${next.id}/videos`, { video: [vids[1].id, vids[3].id] }, { from: `/sessoes/${next.id}` });
    const st = await hourBank.status();
    assert.equal(st.usedHours, 3, 'só a sessão encerrada (3 h), não os vídeos em pré-produção');
    assert.equal(st.reservedHours, 5, 'a sessão planejada reserva a duração prevista (4 h), mais o convidado agendado (1 h)');
    assert.ok(st.reserved.some((r) => r.id === `s${next.id}` && r.minutes === 240));
    assert.match((await gestao.get('/financeiro')).text, new RegExp(`/sessoes/${next.id}`));
  });

  it('quem não é do projeto não abre a sessão; cancelar só sem gravados', async () => {
    assert.equal((await pulsoOnly.get(`/sessoes/${sessionId}`)).status, 404);
    const next = await one('SELECT id FROM recording_sessions WHERE status = $1 ORDER BY id DESC LIMIT 1', ['planejada']);
    await gestao.act(`/sessoes/${next.id}/cancelar`, {}, { from: `/sessoes/${next.id}` });
    assert.equal((await one('SELECT status FROM recording_sessions WHERE id = $1', [next.id])).status, 'cancelada');
    assert.equal((await one('SELECT session_id FROM episodes WHERE id = $1', [vids[3].id])).session_id, null);
  });

  it('a lista mostra as sessões e o episódio aponta para a sua sessão', async () => {
    const page = (await gestao.get('/sessoes')).text;
    assert.match(page, /Anteriores/); assert.match(page, /Estúdio HS/);
    assert.match((await gestao.get(`/episodios/${vids[2].id}`)).text, new RegExp(`Sessão de gravação de 03/12/2026 · <a href="/sessoes/${sessionId}">abrir a sessão</a>`));
  });
});
