// Projetos: lista em memória, projeto padrão, membros e ajustes de nome e sigla.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const projects = require('../src/services/projects');

describe('projetos: serviço', () => {
  let app; let gil; let paula; let edu;

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    gil = await h.createUser({ name: 'Gil Gestão', email: 'g@t.com', role: 'gestao', projects: [1, 2] });
    paula = await h.createUser({ name: 'Paula Produtora', email: 'p@t.com', role: 'produtora' });
    edu = await h.createUser({ name: 'Edu Editor', email: 'e@t.com', role: 'editor_video', projects: [] });
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('lista os ativos na ordem; o padrão é o Pulso', async () => {
    assert.deepEqual(projects.all().map((p) => p.slug), ['pulso', 'projeto-100']);
    assert.equal(projects.defaultId(), 1);
    assert.equal(projects.get('2').name, 'Projeto 100');
    assert.equal(projects.get(99), null);
    assert.equal(projects.label(projects.get(1)), 'Episódios'); assert.equal(projects.label(projects.get(2), false), 'Vídeo');
    assert.equal(projects.has(projects.get(1), 'plateia'), true); assert.equal(projects.has(projects.get(2), 'plateia'), false);
  });

  it('projeto desativado some da lista; o padrão continua sendo um ativo', async () => {
    await h.db.query('UPDATE projects SET active = false WHERE id = 1'); await projects.refresh(true);
    assert.deepEqual(projects.all().map((p) => p.id), [2]); assert.equal(projects.defaultId(), 2);
    await h.db.query('UPDATE projects SET active = true WHERE id = 1'); await projects.refresh(true);
    assert.equal(projects.defaultId(), 1);
  });

  it('participações de cada pessoa', async () => {
    assert.deepEqual((await projects.membershipsOf(gil.id)).map((m) => m.project_id), [1, 2]);
    assert.deepEqual((await projects.membershipsOf(paula.id)).map((m) => m.project_id), [1]);
    assert.deepEqual(await projects.membershipsOf(edu.id), []);
  });

  it('trocar quem participa: quem fica mantém o financeiro, quem entra nasce sem, ninguém fica sem projeto', async () => {
    assert.deepEqual(await projects.setMembers(2, [gil.id, paula.id, edu.id]), { ok: true });
    const m = await projects.members(2);
    assert.deepEqual(m.map((x) => [x.name, x.finance]), [['Edu Editor', false], ['Gil Gestão', true], ['Paula Produtora', false]]);
    // o Edu só participa do Projeto 100: tirar ele dali é recusado e nada muda
    const r = await projects.setMembers(2, [gil.id]);
    assert.match(r.error, /Toda pessoa participa de pelo menos um projeto\. Edu Editor só participa deste\./);
    assert.equal((await projects.members(2)).length, 3);
    await projects.addMember(edu.id, 1);
    assert.deepEqual(await projects.setMembers(2, [gil.id]), { ok: true });
    assert.deepEqual((await projects.members(2)).map((x) => x.name), ['Gil Gestão']);
  });

  it('ajustar nome e sigla: sigla vira maiúscula, não repete e tem formato', async () => {
    const ok = await projects.update(2, { name: 'Projeto 100', sigla: 'p100', video_label: 'Vídeo', video_label_plural: 'Vídeos', number_prefix: 'V.' });
    assert.equal(ok.project.sigla, 'P100'); assert.equal(projects.get(2).sigla, 'P100');
    const base = { name: 'Projeto 100', video_label: 'Vídeo', video_label_plural: 'Vídeos', number_prefix: 'V.' };
    assert.match((await projects.update(2, { ...base, sigla: 'pulso' })).error, /Já existe um projeto com esta sigla/);
    assert.match((await projects.update(2, { ...base, sigla: 'p 1' })).error, /2 a 6 letras ou números/);
    assert.match((await projects.update(2, { ...base, sigla: 'P100', name: '' })).error, /Informe o nome/);
    assert.match((await projects.update(77, { ...base, sigla: 'X77' })).error, /não encontrado/);
  });

  it('usuário criado pela tela entra no projeto padrão', async () => {
    const c = h.client(app.base); await c.login('g@t.com');
    const r = await c.act('/usuarios', { name: 'Nina Nova', email: 'n@t.com', role: 'produtora' }, { from: '/usuarios' });
    assert.equal(r.status, 302);
    const { rows: [u] } = await h.db.query("SELECT id FROM users WHERE email = 'n@t.com'");
    assert.deepEqual(await projects.membershipsOf(u.id), [{ project_id: 1, finance: true, role_id: null }]); // sem função própria no projeto: vale a padrão
  });
});
