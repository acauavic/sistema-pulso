// Aprovação por link: quem aprova pauta, vídeo e capas está fora do sistema e responde pelo link, uma vez, só para a versão enviada.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const one = async (sql, params) => (await h.db.query(sql, params)).rows[0];
const tokenOf = (text) => (text.match(/\/aprovar\/([A-Za-z0-9_-]{32})/) || [])[1];

describe('aprovação por link', () => {
  let app; let gestao; let pulsoOnly; let gil; let video; let pautaId;

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    gil = await h.createUser({ name: 'Gil Gestão', email: 'g@t.com', role: 'gestao', projects: [1, 2] });
    await h.createUser({ name: 'Pia Pulso', email: 'p@t.com', role: 'gestao', projects: [1] });
    await h.db.query("UPDATE projects SET modules = modules || '{\"producao\": true}'::jsonb WHERE id = 2");
    await require('../src/services/projects').refresh(true);
    gestao = h.client(app.base); await gestao.login('g@t.com');
    pulsoOnly = h.client(app.base); await pulsoOnly.login('p@t.com');
    video = await one("INSERT INTO episodes (title, number, project_id, status, format) VALUES ('Planos de saúde', 1, 2, 'pre_producao', 'video') RETURNING *");
    await gestao.act('/pautas', { episode_id: video.id, kind: 'pauta', body_html: '<p>Bloco 1: o problema</p><p>Bloco 2: a saída</p>' }, { from: `/episodios/${video.id}` });
    pautaId = (await one("SELECT id FROM pautas WHERE episode_id = $1 AND kind = 'pauta'", [video.id])).id;
  });
  after(async () => { await app.close(); await h.db.close(); });

  const newPautaLink = async (to = 'Grupo Projeto 100') => {
    const r = await gestao.act(`/pautas/${pautaId}/link`, { to, voltar: `/episodios/${video.id}#pauta` }, { from: `/episodios/${video.id}` });
    assert.equal(r.status, 302);
    return one('SELECT * FROM approval_links WHERE pauta_id = $1 ORDER BY id DESC LIMIT 1', [pautaId]);
  };

  it('gerar o link manda a pauta para aprovação, guarda a versão e mostra a mensagem para copiar', async () => {
    const l = await newPautaLink();
    assert.equal(l.kind, 'pauta'); assert.equal(l.project_id, 2); assert.equal(l.sent_to, 'Grupo Projeto 100');
    assert.match(l.token, /^[A-Za-z0-9_-]{32}$/);
    const p = await one('SELECT state, sent_to FROM pautas WHERE id = $1', [pautaId]);
    assert.equal(p.state, 'aprovacao');
    const v = await one('SELECT * FROM pauta_versions WHERE id = $1', [l.pauta_version_id]);
    assert.equal(v.n, 1); assert.match(v.body, /Bloco 1/);
    const page = (await gestao.get(`/episodios/${video.id}`)).text;
    assert.match(page, /aguardando resposta/);
    assert.equal(tokenOf(page), l.token, 'a mensagem leva o link');
    assert.match(page, /Copiar mensagem/);
  });

  it('a página pública mostra a pauta e os botões, sem nada do painel', async () => {
    const l = await one('SELECT * FROM approval_links WHERE pauta_id = $1 ORDER BY id DESC LIMIT 1', [pautaId]);
    const anon = h.client(app.base);
    const r = await anon.get(`/aprovar/${l.token}`);
    assert.equal(r.status, 200);
    assert.match(r.text, /Bloco 2: a saída/);
    assert.match(r.text, /value="aprovar"/); assert.match(r.text, /value="ajustes"/);
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(r.headers.get('x-robots-tag'), /noindex/);
    assert.doesNotMatch(r.text, /name="csrf"|class="sidebar"|Gil Gestão/);
  });

  it('pedir ajustes exige o recado; com ele, a pauta volta e o link não aceita outra resposta', async () => {
    const l = await one('SELECT * FROM approval_links WHERE pauta_id = $1 ORDER BY id DESC LIMIT 1', [pautaId]);
    const anon = h.client(app.base);
    let r = await anon.post(`/aprovar/${l.token}`, { nome: 'Dr. José', resposta: 'ajustes', recado: '' });
    assert.equal(r.status, 422); assert.match(r.text, /Diga o que precisa mudar/);
    r = await anon.post(`/aprovar/${l.token}`, { nome: '', resposta: 'aprovar' });
    assert.equal(r.status, 422); assert.match(r.text, /Escreva o seu nome/);
    r = await anon.post(`/aprovar/${l.token}`, { nome: 'Dr. José', resposta: 'ajustes', recado: 'Troque a ordem dos blocos.' });
    assert.equal(r.status, 303);
    const p = await one('SELECT state, review_note FROM pautas WHERE id = $1', [pautaId]);
    assert.equal(p.state, 'ajustes'); assert.equal(p.review_note, 'Troque a ordem dos blocos.');
    const ev = await one("SELECT message FROM pauta_events WHERE pauta_id = $1 AND type = 'ajustes' ORDER BY id DESC LIMIT 1", [pautaId]);
    assert.match(ev.message, /Dr\. José pediu ajustes pelo link/);
    const n = await one("SELECT * FROM notifications WHERE type = 'aprovacao' AND user_id = $1 ORDER BY id DESC LIMIT 1", [gil.id]);
    assert.ok(n, 'quem gerou o link é avisado'); assert.match(n.title, /ajustes pedidos por Dr\. José/);
    r = await anon.post(`/aprovar/${l.token}`, { nome: 'Outro', resposta: 'aprovar' });
    assert.equal(r.status, 409);
    assert.match(r.text, /Resposta registrada/);
  });

  it('a versão nova mostra o que mudou; a anterior deixa de valer', async () => {
    await gestao.act('/pautas', { episode_id: video.id, kind: 'pauta', body_html: '<p>Bloco 2: a saída</p><p>Bloco 1: o problema, com números</p>' }, { from: `/episodios/${video.id}` });
    const old = await newPautaLink();
    // a pauta mudou depois do envio: o link fica "substituído"
    await gestao.act('/pautas', { episode_id: video.id, kind: 'pauta', body_html: '<p>Bloco 2: a saída</p><p>Bloco 1: o problema, com números</p><p>Fecho</p>' }, { from: `/episodios/${video.id}` });
    const anon = h.client(app.base);
    let r = await anon.get(`/aprovar/${old.token}`);
    assert.match(r.text, /Esta versão foi substituída/);
    r = await anon.post(`/aprovar/${old.token}`, { nome: 'Dr. José', resposta: 'aprovar' });
    assert.equal(r.status, 409);
    const l = await newPautaLink();
    assert.ok((await one('SELECT revoked_at FROM approval_links WHERE id = $1', [old.id])).revoked_at, 'o link anterior foi substituído');
    r = await anon.get(`/aprovar/${l.token}`);
    assert.match(r.text, /O que mudou desde o pedido de ajustes/);
    assert.match(r.text, /novo<\/span> Bloco 1: o problema, com números/);
    assert.match(r.text, /<s>Bloco 1: o problema<\/s>/);
  });

  it('aprovar pelo link aprova a pauta com o nome de quem aprovou', async () => {
    const l = await one('SELECT * FROM approval_links WHERE pauta_id = $1 ORDER BY id DESC LIMIT 1', [pautaId]);
    const r = await h.client(app.base).post(`/aprovar/${l.token}`, { nome: 'Dr. José', resposta: 'aprovar', recado: 'Perfeito.' });
    assert.equal(r.status, 303);
    const p = await one('SELECT state, approved_by FROM pautas WHERE id = $1', [pautaId]);
    assert.equal(p.state, 'aprovada'); assert.equal(p.approved_by, 'Dr. José (pelo link)');
    const page = (await gestao.get(`/episodios/${video.id}`)).text;
    assert.match(page, /Recado de Dr\. José: Perfeito\./);
  });

  it('vídeo em revisão: comentários na minutagem e pedir ajustes devolvem ao editor; aprovar leva à finalização', async () => {
    const ep = await one("INSERT INTO episodes (title, number, project_id, status, format) VALUES ('Corte final', 2, 2, 'em_revisao', 'video') RETURNING *");
    const file = await one(`INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, version, status)
      VALUES ($1, 'editado', 'v1.mp4', 10, 'k/v1.mp4', 1, 'pronto') RETURNING *`, [ep.id]);
    await gestao.act(`/episodios/${ep.id}/aprovacao/video`, { to: 'Dr. José' }, { from: `/episodios/${ep.id}` });
    const l = await one("SELECT * FROM approval_links WHERE episode_id = $1 AND kind = 'video'", [ep.id]);
    assert.equal(l.file_id, file.id);
    const anon = h.client(app.base);
    assert.match((await anon.get(`/aprovar/${l.token}`)).text, /\/aprovar\/[\w-]+\/video/);
    const r = await anon.post(`/aprovar/${l.token}`, { nome: 'Dr. José', resposta: 'ajustes', recado: '', c_at: ['12000', '45000'], c_end: ['', '50000'], c_body: ['Corta essa pausa', 'Tira esse trecho'] });
    assert.equal(r.status, 303);
    const cs = (await h.db.query('SELECT * FROM episode_comments WHERE episode_id = $1 ORDER BY at_ms', [ep.id])).rows;
    assert.equal(cs.length, 2);
    assert.deepEqual(cs.map((c) => [c.at_ms, c.end_ms, c.external_name, c.version]), [[12000, null, 'Dr. José', 1], [45000, 50000, 'Dr. José', 1]]);
    assert.equal((await one('SELECT status FROM episodes WHERE id = $1', [ep.id])).status, 'em_edicao');
    // o painel mostra o nome de quem comentou pelo link
    await h.db.query("UPDATE episodes SET status = 'em_revisao' WHERE id = $1", [ep.id]);
    assert.match((await gestao.get(`/episodios/${ep.id}`)).text, /Dr\. José \(pelo link\)/);
    // nova versão: o link antigo não vale; o novo aprova
    await h.db.query(`INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, version, status) VALUES ($1, 'editado', 'v2.mp4', 10, 'k/v2.mp4', 2, 'pronto')`, [ep.id]);
    assert.equal((await anon.post(`/aprovar/${l.token}`, { nome: 'Dr. José', resposta: 'aprovar' })).status, 409);
    await gestao.act(`/episodios/${ep.id}/aprovacao/video`, { to: 'Dr. José' }, { from: `/episodios/${ep.id}` });
    const l2 = await one("SELECT * FROM approval_links WHERE episode_id = $1 AND kind = 'video' ORDER BY id DESC LIMIT 1", [ep.id]);
    assert.equal((await anon.post(`/aprovar/${l2.token}`, { nome: 'Dr. José', resposta: 'aprovar', recado: 'Ficou ótimo' })).status, 303);
    assert.equal((await one('SELECT status FROM episodes WHERE id = $1', [ep.id])).status, 'em_finalizacao');
    const ev = await one("SELECT message FROM episode_events WHERE episode_id = $1 AND type = 'aprovacao' ORDER BY id DESC LIMIT 1", [ep.id]);
    assert.match(ev.message, /Aprovado por Dr\. José pelo link \(v2\)/);
  });

  it('capas: aprovar exige marcar ao menos uma; as marcadas ficam aprovadas', async () => {
    const ep = await one("INSERT INTO episodes (title, number, project_id, status, format) VALUES ('Capas', 3, 2, 'em_finalizacao', 'video') RETURNING *");
    const ins = (pos) => one(`INSERT INTO episode_covers (episode_id, kind, position, spec, storage_key, mime, width, height, size_bytes)
      VALUES ($1, 'youtube_thumb', $2, '{}', 'c/k.jpg', 'image/jpeg', 1280, 720, 10) RETURNING id`, [ep.id, pos]);
    const a = await ins(0); const b = await ins(1);
    await gestao.act(`/episodios/${ep.id}/aprovacao/capas`, { to: 'Dr. José' }, { from: `/episodios/${ep.id}` });
    const l = await one("SELECT * FROM approval_links WHERE episode_id = $1 AND kind = 'capas'", [ep.id]);
    const anon = h.client(app.base);
    let r = await anon.post(`/aprovar/${l.token}`, { nome: 'Dr. José', resposta: 'aprovar' });
    assert.equal(r.status, 422); assert.match(r.text, /Marque a capa/);
    r = await anon.post(`/aprovar/${l.token}`, { nome: 'Dr. José', resposta: 'aprovar', capa: [String(b.id)] });
    assert.equal(r.status, 303);
    const rows = (await h.db.query('SELECT id, approved FROM episode_covers WHERE episode_id = $1 ORDER BY id', [ep.id])).rows;
    assert.deepEqual(rows.map((x) => x.approved), [false, true]);
    assert.equal(rows[0].id, a.id);
  });

  it('cancelar o link: quem recebeu vê o aviso; quem não é do projeto não cancela', async () => {
    const ep = await one("INSERT INTO episodes (title, number, project_id, status, format) VALUES ('Outro', 4, 2, 'em_revisao', 'video') RETURNING *");
    await h.db.query(`INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, version, status) VALUES ($1, 'editado', 'v1.mp4', 10, 'k/o.mp4', 1, 'pronto')`, [ep.id]);
    await gestao.act(`/episodios/${ep.id}/aprovacao/video`, { to: 'Dr. José' }, { from: `/episodios/${ep.id}` });
    const l = await one("SELECT * FROM approval_links WHERE episode_id = $1", [ep.id]);
    assert.equal((await pulsoOnly.act(`/aprovacoes/${l.id}/revogar`, {}, { from: '/' })).status, 404);
    assert.equal((await gestao.act(`/aprovacoes/${l.id}/revogar`, {}, { from: `/episodios/${ep.id}` })).status, 302);
    const anon = h.client(app.base);
    assert.match((await anon.get(`/aprovar/${l.token}`)).text, /Este link foi cancelado/);
    assert.equal((await anon.post(`/aprovar/${l.token}`, { nome: 'X', resposta: 'aprovar' })).status, 409);
  });

  it('link que não existe responde 404 com a página própria', async () => {
    const r = await h.client(app.base).get(`/aprovar/${'x'.repeat(32)}`);
    assert.equal(r.status, 404); assert.match(r.text, /Link não encontrado/);
  });
});
