// Filtros combináveis em todas as listas (Episódios, Patrocinadores, Conteúdo > Quadro, Posts e Pedidos), "Campos do cartão"
// (cada pessoa escolhe o que aparece no cartão; o padrão é o cartão de sempre) e a estreia prevista no cartão do convidado gravado.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('Filtros em todas as listas e campos do cartão', () => {
  let app; const u = {}; const as = {}; const id = {};
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const ids = (html, base) => [...html.matchAll(new RegExp(`class="kcard[^"]*" href="${base}/(\\d+)"`, 'g'))].map((m) => Number(m[1]));

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora']]) {
      u[k] = await h.createUser({ name: `Pessoa ${k}`, email: `${k}@t.com`, role });
      as[k] = h.client(app.base); await as[k].login(`${k}@t.com`);
    }
    const [g1] = await q("INSERT INTO guests (name, instagram, profile, status) VALUES ('Dra. Sem Estreia', 'drasem', 'medico', 'gravado') RETURNING id");
    const [g2] = await q("INSERT INTO guests (name, instagram, profile, status, premiere_on) VALUES ('Dr. Com Estreia', 'drcom', 'medico', 'gravado', '2026-12-20') RETURNING id");
    id.g1 = g1.id; id.g2 = g2.id;
    const [e1] = await q("INSERT INTO episodes (number, title, status, guest_id) VALUES (1, 'Primeiro', 'gravado', $1) RETURNING id", [g1.id]);
    const [e2] = await q("INSERT INTO episodes (number, title, status, guest_id) VALUES (2, 'Segundo', 'publicado', $1) RETURNING id", [g2.id]);
    await q("UPDATE episodes SET updated_at = now() - interval '30 days' WHERE id = $1", [e2.id]);
    id.e1 = e1.id; id.e2 = e2.id;
    const [s1] = await q("INSERT INTO sponsors (company, stage, contact_email) VALUES ('Marca Com Email', 'ganho', 'a@b.com') RETURNING id");
    const [s2] = await q("INSERT INTO sponsors (company, stage) VALUES ('Marca Sem Email', 'prospect') RETURNING id");
    await q('INSERT INTO sponsor_episodes (sponsor_id, episode_id) VALUES ($1, $2)', [s1.id, e2.id]);
    id.s1 = s1.id; id.s2 = s2.id;
    await q("INSERT INTO content_requests (kind, title, created_by, priority) VALUES ('trailer', 'Trailer urgente', $1, true), ('trailer', 'Trailer calmo', $1, false)", [u.gestao.id]);
    await q(`INSERT INTO episode_covers (episode_id, kind, group_key, position, label, spec, storage_key, mime, width, height, size_bytes, approved)
             VALUES ($1, 'post_quote', 'a', 1, 'Frase aprovada', '{}', 'pp/a.jpg', 'image/jpeg', 1080, 1350, 4, true),
                    ($1, 'post_quote', 'b', 1, 'Frase por aprovar', '{}', 'pp/b.jpg', 'image/jpeg', 1080, 1350, 4, false)`, [e1.id]);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('Episódios: etapa, conexão e data de atualização, no quadro e na lista', async () => {
    assert.deepEqual(ids((await as.gestao.get('/episodios?f=etapa~em~gravado')).text, '/episodios'), [id.e1]);
    assert.deepEqual(ids((await as.gestao.get('/episodios?f=tem_patrocinador~sim')).text, '/episodios'), [id.e2]);
    assert.deepEqual(ids((await as.gestao.get('/episodios?f=atualizado~ultimos~7')).text, '/episodios'), [id.e1]);
    const lista = (await as.gestao.get('/episodios?view=lista&f=etapa~em~publicado')).text;
    assert.match(lista, /Segundo/); assert.doesNotMatch(lista, /Primeiro/);
  });

  it('Patrocinadores: campo vazio, etapa e conexão', async () => {
    assert.deepEqual(ids((await as.gestao.get('/patrocinadores?f=email~vazio')).text, '/patrocinadores'), [id.s2]);
    assert.deepEqual(ids((await as.gestao.get('/patrocinadores?f=tem_episodio~sim&f=etapa~em~prospect&m=ou')).text, '/patrocinadores').sort(), [id.s1, id.s2].sort());
    assert.deepEqual(ids((await as.gestao.get('/patrocinadores?f=criado~ultimos~1&f=etapa~em~ganho')).text, '/patrocinadores'), [id.s1]);
  });

  it('Conteúdo: o quadro, os posts e os pedidos também filtram', async () => {
    let page = (await as.gestao.get('/conteudo?vista=quadro&f=prioridade~sim')).text;
    assert.match(page, /Trailer urgente/); assert.doesNotMatch(page, /Trailer calmo/);
    page = (await as.gestao.get('/conteudo?vista=posts&f=aprovado~sim')).text;
    assert.match(page, /data-fb-def/);
    const [ok] = await q("SELECT id FROM episode_covers WHERE label = 'Frase aprovada'"); const [no] = await q("SELECT id FROM episode_covers WHERE label = 'Frase por aprovar'");
    assert.ok(page.includes(`/capas/${ok.id}/`)); assert.ok(!page.includes(`/capas/${no.id}/`));
    page = (await as.gestao.get('/conteudo?vista=pedidos&f=titulo~contem~calmo')).text;
    assert.match(page, /Trailer calmo/); assert.doesNotMatch(page, /Trailer urgente/);
    assert.match((await as.gestao.get('/conteudo?vista=posts&f=texto~contem~inexistente')).text, /Nenhum post com esses filtros/);
  });

  it('visualização salva vale para as novas listas', async () => {
    const res = await as.gestao.act('/filtros/visualizacoes', { entidade: 'episode', nome: 'Gravados', query: 'view=quadro&f=etapa~em~gravado' }, { from: '/episodios' });
    assert.equal(res.status, 302);
    assert.match((await as.gestao.get('/episodios')).text, />Gravados</);
    assert.equal((await as.gestao.act('/filtros/visualizacoes', { entidade: 'request', nome: 'Urgentes', query: 'vista=pedidos&f=prioridade~sim' }, { from: '/conteudo' })).status, 302);
    assert.equal((await q("SELECT count(*)::int AS n FROM saved_filters WHERE entity = 'request'"))[0].n, 1);
  });

  it('campos do cartão: padrão como sempre, extras escondidos, e a estreia no convidado gravado', async () => {
    const page = (await as.prod.get('/convidados')).text;
    assert.match(page, /data-cf-menu="convidados"/);
    assert.match(page, /data-cf="email" hidden|data-cf="cadastro" hidden/, 'campo extra nasce escondido');
    assert.match(page, /data-cf="tema"|data-cf="perfil">/, 'campo padrão nasce visível');
    assert.match(page, /estreia não preenchida/);
    assert.match(page, /estreia 20\/12/);
    for (const path of ['/episodios', '/patrocinadores', '/conteudo?vista=quadro']) assert.match((await as.gestao.get(path)).text, /data-cf-menu=/, path);
    assert.doesNotMatch((await as.gestao.get('/convidados?view=lista')).text, /data-cf-menu=/, 'a lista em tabela não tem cartões');
  });
});
