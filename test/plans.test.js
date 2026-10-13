const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const C = require('../src/constants');

describe('planos de patrocínio (Ouro e Diamond)', () => {
  const as = {}; let app; let sid; let sid2; let token;
  const plan = (k) => h.db.query('SELECT * FROM sponsor_plans WHERE key=$1', [k]).then((r) => r.rows[0]);
  const items = (k) => h.db.query('SELECT * FROM plan_items WHERE plan_key=$1 ORDER BY section, position', [k]).then((r) => r.rows);
  const delivs = (id) => h.db.query('SELECT d.*, pi.title AS pt FROM sponsor_deliverables d LEFT JOIN plan_items pi ON pi.id = d.plan_item_id WHERE d.sponsor_id=$1 ORDER BY d.id', [id]).then((r) => r.rows);
  const kit = async () => { const c = h.client(app.base); await c.get(`/patrocinador/${token}`); return (await c.get('/patrocinador/kit')).text; };
  const portal = async () => { const c = h.client(app.base); await c.get(`/patrocinador/${token}/portal`); return (await c.get('/patrocinador/portal')).text; };

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora'], ['editor', 'editor_video']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    const mk = async (company, tier) => { const r = await as.prod.act('/patrocinadores', { company, kind: 'negocio', tier, stage: 'prospect' }, { from: '/patrocinadores/novo' }); return Number(r.location.split('/').pop()); };
    sid = await mk('Marca Ouro', 'ouro'); sid2 = await mk('Marca Diamond', 'diamond');
    await as.prod.act(`/patrocinadores/${sid}/links`, {}, { from: `/patrocinadores/${sid}` });
    token = (await h.db.query('SELECT public_token FROM sponsors WHERE id=$1', [sid])).rows[0].public_token;
    await h.db.query("UPDATE sponsors SET stage='ativo', paid_at=CURRENT_DATE WHERE id=ANY($1)", [[sid, sid2]]);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('o plano nasce com o que o media kit dizia; a cota traz os entregáveis (Diamond = Ouro + os próprios)', async () => {
    assert.equal((await plan('ouro')).price_cents, 600000);
    assert.equal((await items('ouro')).length, 6);
    assert.equal((await delivs(sid)).length, 6);
    assert.equal((await delivs(sid2)).length, 8);
    const t = await kit();
    assert.match(t, /Plano Ouro/); assert.match(t, /R\$ 6\.000/); assert.match(t, /R\$ 15\.000/);
    assert.match(t, /Tudo do plano Ouro/); assert.match(t, /Escolha 1 de 4/); assert.match(t, /Episódio especial dedicado/);
    assert.match(t, /<th class="plan-col">Diamond<\/th>/);
  });

  it('só a gestão mexe nos planos', async () => {
    assert.equal((await as.prod.get('/gestao/patrocinios')).status, 403);
    assert.equal((await as.editor.act('/gestao/patrocinios/ouro', { name: 'x', price: '1' }, { from: '/' })).status, 403);
    const page = await as.gestao.get('/gestao/patrocinios');
    assert.equal(page.status, 200);
    assert.match(page.text, /Planos de patrocínio/); assert.match(page.text, /Inserção nos episódios/);
  });

  it('renomear e mudar o valor vale no media kit, no portal, no cadastro e na página do patrocinador', async () => {
    const r = await as.gestao.act('/gestao/patrocinios/ouro', { name: 'Ouro Prime', price: '7.500,00', episodes_label: '5', tag: '5 episódios patrocinados', headline: 'Marca presente.', lede: 'Cinco episódios.' }, { from: '/gestao/patrocinios' });
    assert.equal(r.status, 302);
    assert.equal((await plan('ouro')).name, 'Ouro Prime');
    assert.equal(C.SPONSOR_TIERS.ouro, 'Ouro Prime');
    const t = await kit();
    assert.match(t, /Plano Ouro Prime/); assert.match(t, /R\$ 7\.500/); assert.match(t, /5 episódios patrocinados/); assert.match(t, /Marca presente\./);
    assert.match(t, /<th class="plan-col">Ouro Prime<\/th>/);
    assert.match(await portal(), /Patrocínio Ouro Prime/);
    assert.match((await as.prod.get('/patrocinadores/novo')).text, /Ouro Prime/);
    assert.match((await as.prod.get(`/patrocinadores/${sid}`)).text, /Plano <strong>Ouro Prime<\/strong>/);
    assert.match((await as.gestao.act('/gestao/patrocinios/ouro', { name: '', price: '1' }, { from: '/gestao/patrocinios' })).location, /patrocinios/);
    assert.equal((await plan('ouro')).name, 'Ouro Prime', 'nome vazio não salva');
    assert.equal((await as.gestao.act('/gestao/patrocinios/ouro', { name: 'Ouro', price: '6.000,00', episodes_label: '4', tag: '4 episódios patrocinados', headline: 'Presença recorrente nos episódios.', lede: 'x' }, { from: '/gestao/patrocinios' })).status, 302);
  });

  it('entregável novo no plano chega a quem tem a cota (e ao Diamond, que inclui o Ouro); retirar tira de todos', async () => {
    await as.gestao.act('/gestao/patrocinios/ouro/itens', { title: 'Menção no Instagram Stories', description: 'Três stories por episódio.', quantity: '3', section: 'entrega' }, { from: '/gestao/patrocinios' });
    const [novo] = (await items('ouro')).filter((i) => i.title === 'Menção no Instagram Stories');
    assert.ok(novo);
    assert.ok((await delivs(sid)).some((d) => d.plan_item_id === novo.id));
    assert.ok((await delivs(sid2)).some((d) => d.plan_item_id === novo.id), 'Diamond inclui tudo do Ouro');
    assert.match(await portal(), /Menção no Instagram Stories/);
    assert.match(await portal(), /Três stories por episódio\./);
    assert.match(await kit(), /Menção no Instagram Stories/);
    await as.gestao.act(`/gestao/patrocinios/itens/${novo.id}`, { title: 'Menção em Stories', description: 'Três stories.', quantity: '4' }, { from: '/gestao/patrocinios' });
    assert.match(await portal(), /Menção em Stories/, 'quem não personalizou acompanha a mudança');
    await as.gestao.act(`/gestao/patrocinios/itens/${novo.id}/excluir`, {}, { from: '/gestao/patrocinios' });
    assert.equal((await delivs(sid)).filter((d) => d.plan_item_id === novo.id).length, 0);
    assert.doesNotMatch(await kit(), /Menção em Stories/);
  });

  it('reordenar entregáveis muda a ordem no media kit', async () => {
    const [first, second] = await items('ouro');
    await as.gestao.act(`/gestao/patrocinios/itens/${second.id}/mover`, { dir: 'up' }, { from: '/gestao/patrocinios' });
    const t = await kit();
    assert.ok(t.indexOf(second.title) < t.indexOf(first.title) || t.indexOf(`<h4>${second.title}</h4>`) < t.indexOf(`<h4>${first.title}</h4>`));
  });

  it('personalizar um entregável só para um patrocinador; voltar ao padrão; criar um só dele; reaplicar o plano', async () => {
    const [ins] = (await delivs(sid)).filter((d) => d.kind === 'insercao');
    await as.prod.act(`/patrocinadores/${sid}/entregaveis/${ins.id}`, { title: 'Inserção premium', quantity: '6', description: 'Com leitura ao vivo.', status: 'ativo' }, { from: `/patrocinadores/${sid}` });
    let [row] = (await delivs(sid)).filter((d) => d.id === ins.id);
    assert.equal(row.title, 'Inserção premium'); assert.equal(row.quantity, 6);
    assert.match(await portal(), /Inserção premium/);
    const other = (await delivs(sid2)).find((d) => d.kind === 'insercao');
    assert.equal(other.title, null, 'o outro patrocinador continua com o padrão do plano');
    assert.match((await as.prod.get(`/patrocinadores/${sid}`)).text, /Personalizado/);
    await as.prod.act(`/patrocinadores/${sid}/entregaveis/${ins.id}`, { title: 'Inserção premium', status: 'ativo', restaurar: '1' }, { from: `/patrocinadores/${sid}` });
    [row] = (await delivs(sid)).filter((d) => d.id === ins.id);
    assert.deepEqual([row.title, row.quantity, row.description], [null, null, null]);
    // título igual ao plano continua herdando
    await as.prod.act(`/patrocinadores/${sid}/entregaveis/${ins.id}`, { title: row.pt, status: 'pendente' }, { from: `/patrocinadores/${sid}` });
    assert.equal((await delivs(sid)).find((d) => d.id === ins.id).title, null);
    // só dele
    await as.prod.act(`/patrocinadores/${sid}/entregaveis`, { title: 'Almoço com a equipe', quantity: '1' }, { from: `/patrocinadores/${sid}` });
    const mine = (await delivs(sid)).find((d) => d.title === 'Almoço com a equipe');
    assert.ok(mine && mine.plan_item_id === null && mine.kind === null);
    // retirou um do plano -> reaplicar traz de volta; o personalizado fica
    await as.prod.act(`/patrocinadores/${sid}/entregaveis/${ins.id}/excluir`, {}, { from: `/patrocinadores/${sid}` });
    assert.equal((await delivs(sid)).some((d) => d.id === ins.id), false);
    await as.prod.act(`/patrocinadores/${sid}/plano`, {}, { from: `/patrocinadores/${sid}` });
    assert.equal((await delivs(sid)).filter((d) => d.kind === 'insercao').length, 1);
    assert.ok((await delivs(sid)).some((d) => d.title === 'Almoço com a equipe'));
  });

  it('trocar a cota troca os entregáveis do plano e mantém os personalizados', async () => {
    const before = (await delivs(sid)).length;
    await as.prod.act(`/patrocinadores/${sid}`, { company: 'Marca Ouro', kind: 'negocio', tier: 'diamond', stage: 'ativo', paid_at: new Date().toISOString().slice(0, 10), value: '15.000,00' }, { from: `/patrocinadores/${sid}/editar` });
    const rows = await delivs(sid);
    assert.equal(rows.filter((d) => d.plan_item_id).length, 8);
    assert.ok(rows.some((d) => d.title === 'Almoço com a equipe'));
    assert.ok(rows.length > before - 1);
    await as.prod.act(`/patrocinadores/${sid}`, { company: 'Marca Ouro', kind: 'negocio', stage: 'negociacao' }, { from: `/patrocinadores/${sid}/editar` });
    assert.equal((await delivs(sid)).filter((d) => d.plan_item_id).length, 0, 'sem cota, sem entregáveis de plano');
  });

  it('página do patrocinador: etapa no topo abre a janela de confirmação e excluir fica ao lado de editar', async () => {
    const page = (await as.prod.get(`/patrocinadores/${sid2}`)).text;
    assert.match(page, /badge-btn[^>]*data-modal-open="modal-etapa"/);
    assert.match(page, /id="modal-etapa"[\s\S]*data-stage-confirm disabled/);
    assert.doesNotMatch(page, /Outras ações/);
    assert.doesNotMatch(page, /name="delete"/);
  });

  it('episódio exclusivo de um patrocinador não recebe inserção de outro (ligado por padrão, configurável na gestão)', async () => {
    const ep = (await h.db.query("INSERT INTO episodes (title, status) VALUES ('Episódio do Ouro','gravado') RETURNING id")).rows[0].id;
    const put = (f) => as.prod.act(`/episodios/${ep}/patrocinadores`, f, { from: `/episodios/${ep}` });
    const roles = async () => (await h.db.query('SELECT sponsor_id, role FROM sponsor_episodes WHERE episode_id=$1 ORDER BY sponsor_id', [ep])).rows;
    await put({ [`role_${sid}`]: 'exclusivo' });
    assert.equal((await roles()).length, 1);
    await put({ [`role_${sid}`]: 'exclusivo', [`role_${sid2}`]: 'insercao' });
    assert.deepEqual((await roles()).map((r) => r.role), ['exclusivo'], 'inserção do outro foi barrada');
    // pela página do outro patrocinador também
    const r = await as.prod.act(`/patrocinadores/${sid2}/episodios`, { [`role_${ep}`]: 'insercao' }, { from: `/patrocinadores/${sid2}` });
    assert.equal(r.status, 302);
    assert.equal((await roles()).length, 1);
    assert.equal((await as.prod.act('/gestao/patrocinios/regras', { block_insertion: '0' }, { from: '/' })).status, 403);
    await as.gestao.act('/gestao/patrocinios/regras', { block_insertion: '0' }, { from: '/gestao/patrocinios' });
    await put({ [`role_${sid}`]: 'exclusivo', [`role_${sid2}`]: 'insercao' });
    assert.equal((await roles()).length, 2, 'desligado: aceita');
    await as.gestao.act('/gestao/patrocinios/regras', { block_insertion: '1' }, { from: '/gestao/patrocinios' });
    assert.match((await as.gestao.get('/gestao/patrocinios')).text, /Hoje: <strong>ligado/);
  });
});
