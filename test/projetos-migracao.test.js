// Migração dos projetos: tudo o que existia vira do Pulso, nada some, nenhum número de episódio muda.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { migrate } = require('../src/db/migrate');

const ROOTS = ['guests', 'sponsors', 'episodes', 'episode_clips', 'content_requests'];
const OPTIONAL = ['tasks', 'trash_items'];

describe('projetos: migração', () => {
  const before092 = {};

  before(async () => {
    await h.db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate({ until: '092' });
    await h.db.query(`INSERT INTO users (name, email, role) VALUES ('Gil Gestão', 'g@t.com', 'gestao'), ('Sara Super', 's@t.com', 'superadmin')`);
    await h.db.query("INSERT INTO guests (name) VALUES ('Dra. Antes')");
    await h.db.query("INSERT INTO sponsors (company) VALUES ('Marca Antes')");
    await h.db.query("INSERT INTO episodes (title, number) VALUES ('Ep antes', 7)");
    await h.db.query("INSERT INTO episode_clips (title, status, source, storage_key) VALUES ('Corte antes', 'pronto', 'upload', 'pp/cortes/1/a.mp4')");
    await h.db.query("INSERT INTO content_requests (kind, title) VALUES ('video', 'Pedido antes')");
    await h.db.query("INSERT INTO tasks (title, kind, status) VALUES ('Tarefa antes', 'geral', 'a_fazer')");
    await h.db.query(`INSERT INTO trash_items (kind, ref_id, title, batch, payload) VALUES ('guest', '99', 'Apagado antes', gen_random_uuid(), '{"rows": []}')`);
    for (const t of [...ROOTS, ...OPTIONAL, 'users']) before092[t] = (await h.db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
  });
  after(async () => { await h.db.close(); });

  it('o banco de antes não tem projetos', async () => {
    const { rows } = await h.db.query("SELECT to_regclass('public.projects') AS t");
    assert.equal(rows[0].t, null);
  });

  it('a migração cria Pulso (1) e Projeto 100 (2) e põe tudo no Pulso', async () => {
    const applied = await migrate();
    assert.ok(applied.includes('093_projetos.sql'));
    const { rows: projects } = await h.db.query('SELECT * FROM projects ORDER BY id');
    assert.deepEqual(projects.map((p) => [p.id, p.slug, p.name, p.sigla, p.video_label, p.video_label_plural, p.number_prefix, p.default_format, p.position]), [
      [1, 'pulso', 'Pulso', 'PULSO', 'Episódio', 'Episódios', 'EP.', 'podcast', 1],
      [2, 'projeto-100', 'Projeto 100', 'P100', 'Vídeo', 'Vídeos', 'V.', 'video', 2],
    ]);
    assert.ok(projects[0].modules.producao && projects[0].modules.plateia && projects[0].modules.redes);
    // a migração 093 cria o Projeto 100 só com tarefas; a 096 (fase do vídeo) liga produção e convidados
    assert.deepEqual(projects[1].modules, { tarefas: true, producao: true, convidados: true });
    assert.ok(!projects[1].modules.redes && !projects[1].modules.financeiro, 'redes e financeiro esperam as fases deles');
    for (const t of [...ROOTS, ...OPTIONAL]) {
      const { rows: [r] } = await h.db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE project_id = 1)::int AS pulso FROM ${t}`);
      assert.equal(r.n, before092[t], `${t}: nenhuma linha some`);
      assert.equal(r.pulso, r.n, `${t}: tudo vira Pulso`);
    }
    assert.equal((await h.db.query('SELECT number FROM episodes')).rows[0].number, 7, 'o número do episódio não muda');
  });

  it('quem já estava entra no Pulso; só o superadmin entra também no Projeto 100', async () => {
    const { rows } = await h.db.query(`SELECT u.email, array_agg(pm.project_id ORDER BY pm.project_id) AS projects, bool_and(pm.finance) AS finance, bool_and(u.house) AS house
                                         FROM users u JOIN project_members pm ON pm.user_id = u.id GROUP BY u.email ORDER BY u.email`);
    assert.deepEqual(rows, [{ email: 'g@t.com', projects: [1], finance: true, house: true }, { email: 's@t.com', projects: [1, 2], finance: true, house: true }]);
  });

  it('o próximo projeto criado é o 3; raiz nova sem projeto informado cai no Pulso', async () => {
    await h.db.query("INSERT INTO guests (name) VALUES ('Dra. Depois')");
    assert.equal((await h.db.query("SELECT project_id FROM guests WHERE name = 'Dra. Depois'")).rows[0].project_id, 1);
    const { rows: [p] } = await h.db.query("INSERT INTO projects (slug, name, sigla) VALUES ('outro', 'Outro', 'OUT') RETURNING id");
    assert.equal(p.id, 3);
    await assert.rejects(h.db.query("INSERT INTO projects (slug, name, sigla) VALUES ('ruim', 'Ruim', 'minuscula')"), /sigla/);
  });
});
