// Categoria dos vídeos (corte, bastidor, trailer…) e filtros combináveis no estilo do ClickUp (Convidados e Conteúdo > Cortes):
// campo + condição + valor, todos (E) ou qualquer um (OU), "está vazio", datas, conexões e visualizações salvas.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const ff = require('../src/services/filters');
const fieldsDef = require('../src/services/filterFields');

describe('Categoria dos vídeos e filtros combináveis', () => {
  let app; const u = {}; const as = {}; const g = {}; const c = {};
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const names = (html) => [...html.matchAll(/<a href="\/convidados\/\d+"><strong>([^<]+)<\/strong><\/a>/g)].map((m) => m[1]);

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora'], ['editor', 'editor_video']]) {
      u[k] = await h.createUser({ name: `Pessoa ${k}`, email: `${k}@t.com`, role });
      as[k] = h.client(app.base); await as[k].login(`${k}@t.com`);
    }
    const ins = (name, status, extra = '') => q(`INSERT INTO guests (name, instagram, profile, status, owner_id, email${extra ? `, ${extra.split('=')[0]}` : ''}) VALUES ($1, $2, 'medico', $3, $4, $5${extra ? `, ${extra.split('=')[1]}` : ''}) RETURNING id`, [name, name.toLowerCase().replace(/\W/g, ''), status, u.prod.id, name.includes('Sem') ? null : `${name.split(' ')[1].toLowerCase()}@x.com`]).then((r) => r[0].id);
    g.ana = await ins('Dra. Ana', 'agendado');
    g.bia = await ins('Dra. Bia Sem Email', 'agendado');
    g.caio = await ins('Dr. Caio', 'gravado', "proposed_at=now() - interval '3 days'");
    g.davi = await ins('Dr. Davi Sem Email', 'prospect');
    await q('UPDATE guests SET owner_id = $2 WHERE id = $1', [g.davi, u.gestao.id]);
    const [ep] = await q("INSERT INTO episodes (number, title, status, guest_id) VALUES (7, 'Conversa com Caio', 'gravado', $1) RETURNING id", [g.caio]);
    c.ep = ep.id;
    const clip = (title, type, w, hgt, epId = ep.id) => q("INSERT INTO episode_clips (title, source, status, episode_id, storage_key, size_bytes, content_type, width, height, duration_ms, video_type) VALUES ($1, 'upload', 'pronto', $2, 'pp/x.mp4', 10, 'video/mp4', $3, $4, 40000, $5) RETURNING id", [title, epId, w, hgt, type]).then((r) => r[0].id);
    c.vertical = await clip('Corte vertical', 'cortes', 1080, 1920);
    c.longo = await clip('Corte longo horizontal', 'cortes', 1920, 1080);
    c.bastidor = await clip('Bastidor da gravação', 'bastidores', 1080, 1920);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('motor: campo, condição e valor saem de uma lista fechada; o resto é descartado', async () => {
    const fields = await fieldsDef.guestFields();
    const st = ff.parse({ f: ['etapa~em~agendado|inventado', 'nao_existe~em~x', 'email~vazio~qualquer', "nome~contem~a'); DROP TABLE guests; --", 'cadastro~ultimos~abc', 'responsavel~em~eu'], m: 'ou' }, fields, { userId: u.prod.id });
    assert.deepEqual(st.filters.map((f) => [f.field, f.op]), [['etapa', 'em'], ['email', 'vazio'], ['nome', 'contem'], ['responsavel', 'em']]);
    assert.deepEqual(st.filters[0].value, ['agendado'], 'valor fora das opções sai');
    assert.deepEqual(st.filters[3].value, [String(u.prod.id)], '"eu" vira quem está vendo');
    assert.equal(st.mode, 'ou');
    const params = []; const sql = ff.toSql(st, fields, params);
    assert.doesNotMatch(sql, /DROP/, 'o valor vai como parâmetro, nunca no SQL');
    assert.ok(params.some((p) => String(p).includes('DROP')));
    assert.ok(new URLSearchParams(ff.toQuery(st, { userId: u.prod.id })).getAll('f').includes('responsavel~em~eu'), 'no endereço, "eu" continua "eu"');
  });

  it('Convidados: "está vazio", E e OU combinados, data e conexão', async () => {
    const list = async (qs) => names((await as.prod.get(`/convidados?view=lista&${qs}`)).text);
    assert.deepEqual((await list('f=email~vazio')).sort(), ['Dr. Davi Sem Email', 'Dra. Bia Sem Email']);
    assert.deepEqual(await list('f=email~vazio&f=etapa~em~agendado'), ['Dra. Bia Sem Email'], 'E: os dois ao mesmo tempo');
    assert.deepEqual((await list('f=etapa~em~gravado&f=responsavel~em~' + u.gestao.id + '&m=ou')).sort(), ['Dr. Caio', 'Dr. Davi Sem Email'], 'OU: qualquer um');
    assert.deepEqual(await list('f=gravacao~ultimos~7'), ['Dr. Caio']);
    assert.deepEqual(await list('f=tem_episodio~sim'), ['Dr. Caio']);
    assert.equal((await list('f=tem_episodio~nao')).length, 3);
    assert.deepEqual(await list('f=responsavel~em~eu&f=etapa~fora~agendado'), ['Dr. Caio'], '"eu" e "não é"');
    const page = (await as.prod.get('/convidados?view=lista&f=email~vazio')).text;
    assert.match(page, /data-fb-def/); assert.match(page, /E-mail está vazio/, 'o resumo legível aparece ao lado do botão');
    assert.equal((await as.prod.get('/convidados?view=quadro&f=etapa~em~agendado')).status, 200, 'o quadro também filtra');
  });

  it('Cortes: categoria nasce do pedido, muda num vídeo ou em vários, e entra nos filtros', async () => {
    const [r] = await q("INSERT INTO content_requests (kind, title, created_by) VALUES ('bastidores', 'Bastidor', $1) RETURNING id", [u.gestao.id]);
    const clips = require('../src/services/clips');
    const { clip } = await clips.startUpload({ filename: 'b.mp4', size: 10, contentType: 'video/mp4', userId: u.editor.id, requestId: r.id });
    assert.equal((await q('SELECT video_type FROM episode_clips WHERE id = $1', [clip.id]))[0].video_type, 'bastidores');
    await q("UPDATE episode_clips SET status = 'erro' WHERE id = $1", [clip.id]);

    // um vídeo: o corte longo horizontal vira "Extra"
    let res = await as.editor.act(`/cortes/${c.longo}/categoria`, { video_type: 'extra' }, { from: `/cortes/${c.longo}` });
    assert.equal(res.status, 302);
    assert.equal((await q('SELECT video_type FROM episode_clips WHERE id = $1', [c.longo]))[0].video_type, 'extra');
    res = await as.editor.act(`/cortes/${c.longo}/categoria`, { video_type: 'inventada' }, { from: `/cortes/${c.longo}` });
    assert.equal((await q('SELECT video_type FROM episode_clips WHERE id = $1', [c.longo]))[0].video_type, 'extra', 'categoria fora da lista não entra');
    assert.match((await as.editor.get(`/cortes/${c.longo}`)).text, /CATEGORIA<\/span> <span class="badge b-gray">/);

    // vários: o corte vertical e o longo viram bastidor, e a lista volta com os filtros
    const voltar = '/conteudo?vista=cortes&f=categoria~em~bastidores';
    res = await as.editor.act('/conteudo/em-massa/cortes', { acao: 'categoria', video_type: 'bastidores', ids: [String(c.vertical), String(c.longo)], voltar }, { from: '/conteudo?vista=cortes' });
    assert.equal(res.location, voltar);
    assert.deepEqual((await q('SELECT video_type FROM episode_clips WHERE id = ANY($1) ORDER BY id', [[c.vertical, c.longo]])).map((x) => x.video_type), ['bastidores', 'bastidores']);
    await q("UPDATE episode_clips SET video_type = 'cortes' WHERE id = $1", [c.vertical]);

    const shown = async (qs) => [...(await as.editor.get(`/conteudo?vista=cortes&${qs}`)).text.matchAll(/data-clip="(\d+)"/g)].map((m) => Number(m[1]));
    assert.deepEqual((await shown('f=categoria~em~bastidores')).sort(), [c.longo, c.bastidor].sort());
    assert.deepEqual(await shown('f=formato~em~horizontal'), [c.longo], 'formato sai da largura e da altura');
    assert.deepEqual((await shown('f=categoria~em~bastidores&f=formato~em~vertical')), [c.bastidor]);
    assert.equal((await shown('f=social~em~nao&f=status~em~pronto')).length, 3);
    assert.match((await as.editor.get('/conteudo?vista=cortes&f=categoria~em~trailer')).text, /Nenhum vídeo com esses filtros/);
  });

  it('visualizações salvas: só os filtros que a lista entende; compartilhada aparece para a equipe; só quem criou apaga', async () => {
    let res = await as.prod.act('/filtros/visualizacoes', { entidade: 'guest', nome: 'Agendados sem e-mail', query: 'view=lista&f=email~vazio&f=etapa~em~agendado&lixo=1', compartilhar: '1' }, { from: '/convidados' });
    assert.equal(res.status, 302);
    const [v] = await q("SELECT * FROM saved_filters WHERE name = 'Agendados sem e-mail'");
    assert.equal(v.query, 'view=lista&f=email%7Evazio&f=etapa%7Eem%7Eagendado');
    assert.equal(v.shared, true);
    const page = (await as.gestao.get('/convidados')).text;
    assert.match(page, /Agendados sem e-mail <span class="mono small muted">equipe<\/span>/);
    assert.equal((await as.gestao.act(`/filtros/visualizacoes/${v.id}/excluir`, {}, { from: '/convidados' })).status, 403);
    res = await as.prod.act('/filtros/visualizacoes', { entidade: 'guest', nome: 'Sem filtro', query: 'view=lista' }, { from: '/convidados' });
    assert.equal((await q("SELECT count(*)::int AS n FROM saved_filters WHERE name = 'Sem filtro'"))[0].n, 0, 'sem filtro não salva');
    assert.equal((await as.editor.act('/filtros/visualizacoes', { entidade: 'usuarios', nome: 'X', query: 'f=email~vazio' }, { from: '/' })).status, 403, 'só as listas que têm filtros');
    await as.prod.act(`/filtros/visualizacoes/${v.id}/excluir`, {}, { from: '/convidados' });
    assert.equal((await q('SELECT count(*)::int AS n FROM saved_filters WHERE id = $1', [v.id]))[0].n, 0);
  });
});
