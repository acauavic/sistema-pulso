// Pauta e roteiro: escrever, mandar para o WhatsApp, registrar a resposta. Quem aprova está fora do sistema.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const pautas = require('../src/services/pautas');

const one = async (sql, params) => (await h.db.query(sql, params)).rows[0];

describe('pauta e roteiro', () => {
  let app; let gestao; let editor; let gil; let video; let guestId;

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    gil = await h.createUser({ name: 'Gil Gestão', email: 'g@t.com', role: 'gestao', projects: [1, 2] });
    await h.createUser({ name: 'Edu Editor', email: 'e@t.com', role: 'editor_video', projects: [1, 2] });
    await h.db.query("UPDATE projects SET modules = modules || '{\"producao\": true, \"convidados\": true}'::jsonb WHERE id = 2");
    await require('../src/services/projects').refresh(true);
    gestao = h.client(app.base); await gestao.login('g@t.com');
    editor = h.client(app.base); await editor.login('e@t.com');
    video = await one("INSERT INTO episodes (title, number, project_id, status, format) VALUES ('Planos de saúde', 1, 2, 'pre_producao', 'video') RETURNING *");
    guestId = (await one("INSERT INTO guests (name, status, project_id, instagram, profile) VALUES ('Dra. Pauta', 'em_agendamento', 1, '@pauta', 'medico') RETURNING id")).id;
  });
  after(async () => { await app.close(); await h.db.close(); });

  const docOf = async (kind = 'pauta') => one('SELECT * FROM pautas WHERE episode_id = $1 AND kind = $2', [video.id, kind]);

  it('o vídeo em pré-produção abre na aba Pauta, com os dois documentos "A fazer"', async () => {
    const page = (await gestao.get(`/episodios/${video.id}`)).text;
    assert.match(page, /data-tabs data-default="pauta"/);
    assert.match(page, /<h3 class="m-0">Pauta <span class="badge b-st-pre_producao">A fazer<\/span>/);
    assert.match(page, /<h3 class="m-0">Roteiro <span class="badge b-st-pre_producao">A fazer<\/span>/);
    assert.match(page, /Escreva a pauta, mande para o grupo do WhatsApp/);
  });

  it('escrever leva para Em elaboração e guarda o projeto do vídeo', async () => {
    const r = await gestao.act('/pautas', { episode_id: video.id, kind: 'pauta', body_html: '<p>Bloco 1: o problema</p><ul><li>Quanto custa</li></ul>', owner_id: gil.id, due_on: '2026-12-01' }, { from: `/episodios/${video.id}` });
    assert.equal(r.status, 302);
    const d = await docOf();
    assert.equal(d.state, 'elaboracao'); assert.equal(d.project_id, 2);
    assert.match(d.body, /Bloco 1: o problema/); assert.match(d.body_html, /<li>Quanto custa<\/li>/);
    assert.equal(String(d.owner_id), String(gil.id));
    const page = (await gestao.get(`/episodios/${video.id}`)).text;
    assert.match(page, /Em elaboração/); assert.match(page, /Gerar link de aprovação/); assert.match(page, /mandar só o texto, sem link/);
    assert.match(page, /Gil Gestão/);
  });

  it('sem texto e sem link não salva', async () => {
    await gestao.act('/pautas', { episode_id: video.id, kind: 'roteiro', body_html: '', link: '' }, { from: `/episodios/${video.id}` });
    assert.equal(await docOf('roteiro'), undefined);
    assert.match((await gestao.get(`/episodios/${video.id}`)).text, /Escreva a pauta ou cole o link do documento\./);
  });

  it('o link do Google Docs vale no lugar do texto', async () => {
    await gestao.act('/pautas', { episode_id: video.id, kind: 'roteiro', link: 'https://docs.google.com/document/d/abc' }, { from: `/episodios/${video.id}` });
    const d = await docOf('roteiro');
    assert.equal(d.link, 'https://docs.google.com/document/d/abc'); assert.equal(d.state, 'elaboracao');
  });

  it('o texto do WhatsApp é puro e legível; com link, vai o link', async () => {
    const d = { ...(await docOf()), episode_number: 1, episode_title: 'Planos de saúde' };
    const txt = pautas.whatsappText(d, { prefix: 'V.' });
    assert.match(txt, /^PAUTA · V\.001 · Planos de saúde/);
    assert.match(txt, /Bloco 1: o problema/); assert.match(txt, /Quanto custa/);
    assert.doesNotMatch(txt, /<[a-z]/i, 'nada de HTML');
    assert.match(txt, /Prazo para a resposta: 01\/12\/2026/);
    const r = { ...(await docOf('roteiro')), episode_number: 1, episode_title: 'Planos de saúde' };
    assert.match(pautas.whatsappText(r, { prefix: 'V.' }), /https:\/\/docs\.google\.com\/document\/d\/abc/);
  });

  it('"Copiar para o WhatsApp" marca Enviada, com data e para quem', async () => {
    const d = await docOf();
    const r = await gestao.act(`/pautas/${d.id}/enviada`, { to: 'Grupo Projeto 100' }, { from: `/episodios/${video.id}` });
    assert.equal(r.status, 302);
    const sent = await docOf();
    assert.equal(sent.state, 'aprovacao'); assert.equal(sent.sent_to, 'Grupo Projeto 100'); assert.ok(sent.sent_at);
    const page = (await gestao.get(`/episodios/${video.id}`)).text;
    assert.match(page, /Enviada para aprovação/);
    assert.match(page, /enviada \d{2}\/\d{2} para Grupo Projeto 100/);
    assert.match(page, /Registrar aprovação<\/button>/); assert.match(page, /Registrar ajustes<\/button>/);
    assert.doesNotMatch(page.slice(page.indexOf('pane-pauta'), page.indexOf('pane-material')), /mandar só o texto, sem link/, 'já foi: o envio manual sai de cena');
  });

  it('"Pediram ajustes" guarda o recado e devolve para quem escreve', async () => {
    const d = await docOf();
    assert.equal((await gestao.act(`/pautas/${d.id}/resposta`, { resposta: 'ajustes', note: '' }, { from: `/episodios/${video.id}` })).status, 302);
    assert.equal((await docOf()).state, 'aprovacao', 'sem dizer o que ajustar, nada muda');
    assert.match((await gestao.get(`/episodios/${video.id}`)).text, /Diga o que pediram para ajustar\./);
    await gestao.act(`/pautas/${d.id}/resposta`, { resposta: 'ajustes', note: 'tirar a pergunta 4' }, { from: `/episodios/${video.id}` });
    const ajustada = await docOf();
    assert.equal(ajustada.state, 'ajustes'); assert.equal(ajustada.review_note, 'tirar a pergunta 4');
    const page = (await gestao.get(`/episodios/${video.id}`)).text;
    assert.match(page, /Pediram ajustes: tirar a pergunta 4/);
    assert.match(page, /Gerar link de aprovação/, 'volta a poder mandar de novo');
  });

  it('reescrever volta para Em elaboração e depois a aprovação fica registrada', async () => {
    const d = await docOf();
    await gestao.act('/pautas', { episode_id: video.id, kind: 'pauta', body_html: '<p>Bloco 1 revisado</p>' }, { from: `/episodios/${video.id}` });
    assert.equal((await docOf()).state, 'elaboracao');
    await gestao.act(`/pautas/${d.id}/enviada`, { to: 'Grupo Projeto 100' }, { from: `/episodios/${video.id}` });
    await gestao.act(`/pautas/${d.id}/resposta`, { resposta: 'aprovada', by: 'Dr. José' }, { from: `/episodios/${video.id}` });
    const ok = await docOf();
    assert.equal(ok.state, 'aprovada'); assert.equal(ok.approved_by, 'Dr. José'); assert.equal(ok.review_note, null);
    const page = (await gestao.get(`/episodios/${video.id}`)).text;
    assert.match(page, /aprovada por Dr\. José/);
    assert.match(page, /Histórico <span class="mono">\d<\/span>/);
  });

  it('o editor lê, mas não escreve', async () => {
    const page = (await editor.get(`/episodios/${video.id}`)).text;
    assert.match(page, /Bloco 1 revisado/, 'o editor lê a pauta aprovada');
    assert.doesNotMatch(page, /data-modal-open="pauta-edit-pauta"/);
    const r = await editor.act('/pautas', { episode_id: video.id, kind: 'pauta', body_html: '<p>Não pode</p>' }, { from: `/episodios/${video.id}` });
    assert.equal(r.status, 403);
  });

  it('a pauta do convidado acompanha quando ele vira episódio, sem duplicar', async () => {
    assert.match((await gestao.get(`/convidados/${guestId}`)).text, /data-pane-id="pauta"/);
    await gestao.act('/pautas', { guest_id: guestId, kind: 'pauta', body_html: '<p>Perguntas para a Dra.</p>' }, { from: `/convidados/${guestId}` });
    const doc = await one('SELECT * FROM pautas WHERE guest_id = $1', [guestId]);
    assert.equal(doc.project_id, 1);
    await h.db.query("UPDATE guests SET status = 'gravado' WHERE id = $1", [guestId]);
    const ep = await require('../src/services/production').syncFromGuest(guestId, gil.id);
    const movida = await one('SELECT * FROM pautas WHERE id = $1', [doc.id]);
    assert.equal(movida.episode_id, ep.id); assert.equal(movida.guest_id, null);
    assert.equal((await h.db.query('SELECT count(*)::int AS n FROM pautas WHERE episode_id = $1', [ep.id])).rows[0].n, 1);
    assert.match((await gestao.get(`/episodios/${ep.id}`)).text, /Perguntas para a Dra\./);
  });

  it('pauta de outro projeto responde 404 para quem não participa dele', async () => {
    const paula = await h.createUser({ name: 'Paula', email: 'p@t.com', role: 'produtora' }); // só o Pulso
    const c = h.client(app.base); await c.login('p@t.com');
    const d = await docOf();
    assert.equal((await c.act(`/pautas/${d.id}/enviada`, { to: 'x' }, { from: '/' })).status, 404);
    assert.ok(paula.id);
  });

  it('tudo entra na auditoria em português', async () => {
    const html = (await gestao.get('/auditoria')).text;
    for (const t of ['Pauta escrita', 'Pauta enviada para aprovação', 'Pediram ajustes na pauta']) assert.match(html, new RegExp(t), t);
  });
});
