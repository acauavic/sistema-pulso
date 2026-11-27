// Funções sob medida: o que cada função acessa, por área; função padrão e função por projeto; acesso com data de fim;
// e o guarda do item na URL (ação de outro projeto, ou fora da função naquele projeto, responde 404).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const P = require('../src/permissions');
const roles = require('../src/services/roles');

const one = async (sql, params) => (await h.db.query(sql, params)).rows[0];

describe('funções', () => {
  let app; let casa; let ana; let anaId; let finRoleId; let pulsoGuest; let p100Guest; let pulsoSponsor;

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    await h.createUser({ name: 'Gil Gestão', email: 'g@t.com', role: 'gestao', projects: [1, 2] });
    anaId = (await h.createUser({ name: 'Ana Freela', email: 'ana@t.com', role: 'produtora', projects: [1, 2] })).id;
    await h.db.query("UPDATE projects SET modules = modules || '{\"producao\": true, \"convidados\": true}'::jsonb WHERE id = 2");
    await require('../src/services/projects').refresh(true);
    casa = h.client(app.base); await casa.login('g@t.com');
    pulsoGuest = await one("INSERT INTO guests (name, status, project_id, instagram, profile) VALUES ('Dra. Pulso', 'prospect', 1, '@dp', 'medico') RETURNING *");
    p100Guest = await one("INSERT INTO guests (name, status, project_id, instagram, profile) VALUES ('Dr. Cem', 'prospect', 2, '@dc', 'medico') RETURNING *");
    pulsoSponsor = await one("INSERT INTO sponsors (company, project_id) VALUES ('Marca Pulso', 1) RETURNING *");
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('as quatro funções de fábrica dão exatamente o que os perfis davam', async () => {
    await roles.refresh(true);
    for (const base of ['superadmin', 'gestao', 'produtora', 'editor_video']) {
      const r = roles.byKey(base);
      assert.ok(r && r.builtin, base);
      assert.deepEqual([...roles.permsOf(r)].sort(), (base === 'superadmin' ? Object.keys(P.PERMISSIONS) : P.permsOfBase(base)).sort(), base);
    }
    assert.ok(roles.byKey('superadmin').locked);
    // cada permissão mora em uma área e tem nome
    const inAreas = P.AREAS.flatMap((a) => [...a.read, ...a.edit, ...a.manage]);
    assert.deepEqual([...new Set(inAreas)].sort(), Object.keys(P.PERMISSIONS).sort());
    for (const p of Object.keys(P.PERMISSIONS)) assert.ok(P.PERM_LABELS[p], p);
  });

  it('criar uma função pela tela: as caixas marcadas, e o "ver" da área vem junto com o "fazer"', async () => {
    const page = (await casa.get('/gestao/funcoes')).text;
    assert.match(page, /Nova função/); assert.match(page, /Editor de Vídeo/); assert.match(page, /travada/);
    await casa.act('/gestao/funcoes', { name: 'Financeiro do parceiro', base: 'gestao', perm: ['finance.write', 'episodes.read', 'guests.read'] }, { from: '/gestao/funcoes' });
    await roles.refresh(true);
    const r = roles.all().find((x) => x.name === 'Financeiro do parceiro');
    assert.ok(r); finRoleId = r.id;
    assert.deepEqual([...r.perms].sort(), ['episodes.read', 'finance.read', 'finance.write', 'guests.read']);
    assert.equal(roles.levelOf(r.perms, P.AREAS.find((a) => a.key === 'financeiro')), 'edita');
  });

  it('na janela do usuário, a função de cada projeto (aqui: produtora no Pulso, financeiro do parceiro no Projeto 100)', async () => {
    const page = (await casa.get(`/usuarios/${anaId}/editar`)).text;
    assert.match(page, /name="role_id"/); assert.match(page, /name="funcao_2"/); assert.match(page, /name="access_until"/);
    const produtora = roles.byKey('produtora').id;
    const r = await casa.act(`/usuarios/${anaId}`, { name: 'Ana Freela', email: 'ana@t.com', role_id: produtora, acesso: '1', projetos: ['1', '2'], funcao_1: '', funcao_2: String(finRoleId) }, { from: `/usuarios/${anaId}/editar` });
    assert.equal(r.status, 302);
    const m = await one('SELECT role_id FROM project_members WHERE user_id = $1 AND project_id = 2', [anaId]);
    assert.equal(m.role_id, finRoleId);
    ana = h.client(app.base); await ana.login('ana@t.com');
  });

  it('o financeiro só aparece onde a função dela vê o dinheiro', async () => {
    await h.db.query(`INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, project_id) VALUES
      ('saida', 'outros', 'CONTA-DO-PULSO', 1000, '2026-12-01', 1), ('saida', 'outros', 'CONTA-DO-CEM', 1000, '2026-12-01', 2)`);
    const page = (await ana.get('/financeiro/lancamentos')).text;
    assert.match(page, /CONTA-DO-CEM/); assert.doesNotMatch(page, /CONTA-DO-PULSO/);
  });

  it('no projeto em que a função só lê, ela lê mas não muda (404); no outro, muda', async () => {
    assert.equal((await ana.get(`/convidados/${p100Guest.id}`)).status, 200, 'lê o convidado do Projeto 100');
    const r = await ana.act(`/convidados/${p100Guest.id}/nota`, { note: 'tentou' }, { from: '/convidados' });
    assert.equal(r.status, 404, 'no Projeto 100 a função dela não escreve em convidados');
    const ok = await ana.act(`/convidados/${pulsoGuest.id}/nota`, { note: 'no Pulso pode' }, { from: '/convidados' });
    assert.notEqual(ok.status, 404);
    // financeiro: no Pulso ela é produtora (sem financeiro), então a conta do Pulso não existe para ela
    const pulsoEntry = await one("SELECT id FROM fin_entries WHERE description = 'CONTA-DO-PULSO'");
    assert.equal((await ana.act(`/financeiro/lancamentos/${pulsoEntry.id}/pagar`, { amount: '10,00' }, { from: '/financeiro' })).status, 404);
  });

  it('o guarda do item vale em toda ação: quem não é do projeto recebe 404 e nada muda', async () => {
    await h.createUser({ name: 'Cem Só', email: 'cem@t.com', role: 'gestao', projects: [2] });
    const cem = h.client(app.base); await cem.login('cem@t.com');
    const acoes = [
      [`/convidados/${pulsoGuest.id}`, { name: 'Mudou', instagram: '@x', profile: 'medico', status: 'prospect' }],
      [`/convidados/${pulsoGuest.id}/nota`, { note: 'x' }],
      [`/patrocinadores/${pulsoSponsor.id}/nota`, { note: 'x' }],
      [`/patrocinadores/${pulsoSponsor.id}/excluir`, {}],
    ];
    for (const [url, form] of acoes) {
      const r = await cem.act(url, form, { from: '/' });
      assert.equal(r.status, 404, `${url} (veio ${r.status})`);
    }
    assert.equal((await one('SELECT name FROM guests WHERE id = $1', [pulsoGuest.id])).name, 'Dra. Pulso');
    assert.ok(await one('SELECT id FROM sponsors WHERE id = $1', [pulsoSponsor.id]));
  });

  it('editar a função de fábrica muda na hora; voltar ao padrão desfaz', async () => {
    const prod = roles.byKey('produtora');
    const keep = roles.permsOf(prod).filter((p) => p !== 'guests.write' && p !== 'guests.invite');
    await casa.act(`/gestao/funcoes/${prod.id}`, { name: 'Produtora', perm: keep }, { from: '/gestao/funcoes' });
    assert.equal((await ana.act(`/convidados/${pulsoGuest.id}/nota`, { note: 'agora não' }, { from: '/convidados' })).status, 403, 'sem escrever em convidados em nenhum projeto: a rota recusa');
    await casa.act(`/gestao/funcoes/${prod.id}/padrao`, {}, { from: '/gestao/funcoes' });
    await roles.refresh(true);
    assert.equal(roles.byKey('produtora').perms, null);
    assert.notEqual((await ana.act(`/convidados/${pulsoGuest.id}/nota`, { note: 'voltou' }, { from: '/convidados' })).status, 403);
  });

  it('função com gente não sai; sem gente, sai', async () => {
    await casa.act(`/gestao/funcoes/${finRoleId}/excluir`, {}, { from: '/gestao/funcoes' });
    await roles.refresh(true);
    assert.ok(roles.get(finRoleId), 'tem gente usando no Projeto 100');
    await casa.act('/gestao/funcoes', { name: 'Leitura', base: 'editor_video', perm: ['episodes.read'] }, { from: '/gestao/funcoes' });
    await roles.refresh(true);
    const lid = roles.all().find((x) => x.name === 'Leitura').id;
    await casa.act(`/gestao/funcoes/${lid}/excluir`, {}, { from: '/gestao/funcoes' });
    await roles.refresh(true);
    assert.equal(roles.get(lid), null);
  });

  it('acesso com data de fim: depois dela, a sessão cai e o login não entra', async () => {
    await h.db.query("UPDATE users SET access_until = '2020-01-01' WHERE id = $1", [anaId]);
    assert.equal((await ana.get('/')).status, 302, 'a sessão não vale mais');
    const fresh = h.client(app.base);
    const r = await fresh.login('ana@t.com');
    assert.notEqual(r.status, 302, 'o login não entra');
    await h.db.query('UPDATE users SET access_until = NULL WHERE id = $1', [anaId]);
  });

  it('quem só grava o perfil (código antigo, script) ganha a função de fábrica dele', async () => {
    const u = await one("INSERT INTO users (name, email, role) VALUES ('Script', 's@t.com', 'editor_video') RETURNING role_id");
    assert.equal(u.role_id, roles.byKey('editor_video').id);
  });
});
