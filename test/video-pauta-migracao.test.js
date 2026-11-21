// Migração do vídeo e da pauta: o que existe vira podcast, a numeração passa a ser por projeto e as tabelas da pauta nascem.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { migrate } = require('../src/db/migrate');

describe('vídeo e pauta: migração', () => {
  before(async () => {
    await h.db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate({ until: '094' });
    await h.db.query("INSERT INTO episodes (title, number) VALUES ('Ep antes', 7)");
  });
  after(async () => { await h.db.close(); });

  it('tudo o que existe vira podcast e o número continua', async () => {
    assert.ok((await migrate()).includes('095_video_e_pauta.sql'));
    const { rows: [e] } = await h.db.query("SELECT number, format, status, project_id FROM episodes WHERE title = 'Ep antes'");
    assert.deepEqual([e.number, e.format, e.status, e.project_id], [7, 'podcast', 'gravado', 1]);
  });

  it('cada projeto numera do seu jeito, e no mesmo projeto o número não repete', async () => {
    await h.db.query("INSERT INTO episodes (title, number, project_id, format) VALUES ('Vídeo 1', 1, 2, 'video')");
    await h.db.query("INSERT INTO episodes (title, number, project_id) VALUES ('Ep 1', 1, 1)");
    assert.equal((await h.db.query('SELECT count(*)::int AS n FROM episodes WHERE number = 1')).rows[0].n, 2);
    await assert.rejects(h.db.query("INSERT INTO episodes (title, number, project_id) VALUES ('Repetido', 1, 1)"), /project_number/);
  });

  it('a etapa Pré-produção é aceita; formato inventado não', async () => {
    await h.db.query("INSERT INTO episodes (title, number, project_id, status, format) VALUES ('Em pauta', 2, 2, 'pre_producao', 'video')");
    await assert.rejects(h.db.query("INSERT INTO episodes (title, number, project_id, format) VALUES ('Ruim', 9, 2, 'reels')"), /format/);
    await assert.rejects(h.db.query("INSERT INTO episodes (title, number, project_id, status) VALUES ('Ruim', 9, 2, 'rascunho')"), /status/);
  });

  it('pauta: precisa de um dono (vídeo ou convidado), um tipo por dono, e guarda o histórico', async () => {
    const { rows: [ep] } = await h.db.query("SELECT id FROM episodes WHERE title = 'Em pauta'");
    const { rows: [g] } = await h.db.query("INSERT INTO guests (name, project_id) VALUES ('Dra. Pauta', 2) RETURNING id");
    await assert.rejects(h.db.query("INSERT INTO pautas (project_id, kind) VALUES (2, 'pauta')"), /dono/);
    await assert.rejects(h.db.query("INSERT INTO pautas (project_id, episode_id, kind) VALUES (2, $1, 'resumo')", [ep.id]), /kind/);
    const { rows: [p] } = await h.db.query("INSERT INTO pautas (project_id, episode_id, kind, body) VALUES (2, $1, 'pauta', 'temas') RETURNING id, state", [ep.id]);
    assert.equal(p.state, 'a_fazer');
    await h.db.query("INSERT INTO pautas (project_id, episode_id, kind) VALUES (2, $1, 'roteiro')", [ep.id]);
    await assert.rejects(h.db.query("INSERT INTO pautas (project_id, episode_id, kind) VALUES (2, $1, 'pauta')", [ep.id]), /episode_kind/);
    await h.db.query("INSERT INTO pautas (project_id, guest_id, kind) VALUES (2, $1, 'pauta')", [g.id]);
    await assert.rejects(h.db.query("INSERT INTO pautas (project_id, guest_id, kind) VALUES (2, $1, 'pauta')", [g.id]), /guest_kind/);
    await h.db.query("INSERT INTO pauta_events (pauta_id, type, message) VALUES ($1, 'criada', 'Pauta criada')", [p.id]);
    assert.equal((await h.db.query('SELECT count(*)::int AS n FROM pauta_events WHERE pauta_id = $1', [p.id])).rows[0].n, 1);
    // apagar o vídeo leva a pauta junto
    await h.db.query('DELETE FROM episodes WHERE id = $1', [ep.id]);
    assert.equal((await h.db.query('SELECT count(*)::int AS n FROM pautas WHERE episode_id = $1', [ep.id])).rows[0].n, 0);
  });
});
