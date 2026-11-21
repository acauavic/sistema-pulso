// Endereços: o painel fica no domínio da casa e o que é público fica no domínio de cada projeto. Nenhum link já enviado
// do Pulso muda; quem abre um link no domínio errado é levado ao certo; o ícone e o nome público seguem o projeto.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const projects = require('../src/services/projects');
const pu = require('../src/services/publicUrl');
const guestsSvc = require('../src/services/guests');

const PULSO = 1; const P100 = 2;
const HOST_PULSO = 'sistema.pulso.test'; const HOST_CEM = 'links.cem.test';

describe('endereços por projeto', () => {
  let app; let gestao;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const one = (sql, p) => q(sql, p).then((r) => r[0]);
  const at = (host) => ({ headers: { 'x-forwarded-host': host, 'x-forwarded-proto': 'https' } });
  let tokenPulso; let tokenCem;

  before(async () => {
    await h.resetDb();
    await h.createUser({ name: 'Casa', email: 'casa@local.test', role: 'gestao', projects: [PULSO, P100] });
    app = await h.startServer();
    gestao = h.client(app.base); await gestao.login('casa@local.test');
    tokenPulso = 'tokenDoPulso1234567890';
    tokenCem = 'tokenDoProjeto1234567890';
    await h.db.query("INSERT INTO guests (name, status, project_id, invite_token, email) VALUES ('Dra. Ana','convite_enviado',$1,$2,'ana@exemplo.com')", [PULSO, tokenPulso]);
    await h.db.query("INSERT INTO guests (name, status, project_id, invite_token, email) VALUES ('Dr. Bento','convite_enviado',$1,$2,'bento@exemplo.com')", [P100, tokenCem]);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('sem endereço configurado, tudo continua num endereço só', async () => {
    assert.equal(pu.hostOf(PULSO), '', 'o banco nasce sem endereço público (desenvolvimento e teste)');
    assert.match(guestsSvc.longInviteUrl(tokenPulso, PULSO), /\/convite\/tokenDoPulso/);
    assert.equal((await gestao.get('/convidados', at(HOST_PULSO))).status, 200, 'sem endereço ligado, nada é redirecionado');
  });

  it('a gestão liga o endereço público de cada projeto', async () => {
    const r = await gestao.act(`/gestao/projetos/${PULSO}`, {
      name: 'Pulso', sigla: 'PULSO', video_label: 'Episódio', video_label_plural: 'Episódios', number_prefix: 'EP.',
      public_name: 'Podcast Pulso', public_host: `https://${HOST_PULSO}/`, short_link_host: 'link.pulso.test',
      mail_from_name: 'Podcast Pulso', mail_from_address: 'contato@pulso.test',
    }, { from: '/gestao/projetos' });
    assert.ok([302, 303].includes(r.status));
    await gestao.act(`/gestao/projetos/${P100}`, {
      name: 'Projeto 100', sigla: 'P100', video_label: 'Vídeo', video_label_plural: 'Vídeos', number_prefix: 'V.',
      public_name: 'Projeto 100', public_host: HOST_CEM,
    }, { from: '/gestao/projetos' });
    await projects.refresh(true);
    assert.equal(pu.hostOf(PULSO), HOST_PULSO, 'o endereço entra sem esquema e sem barra');
    assert.equal(pu.hostOf(P100), HOST_CEM);
    // endereço inválido não salva
    const bad = await gestao.act(`/gestao/projetos/${P100}`, {
      name: 'Projeto 100', sigla: 'P100', video_label: 'Vídeo', video_label_plural: 'Vídeos', number_prefix: 'V.', public_host: 'sem ponto',
    }, { from: '/gestao/projetos' });
    assert.ok([302, 303].includes(bad.status));
    await projects.refresh(true);
    assert.equal(pu.hostOf(P100), HOST_CEM, 'o endereço anterior fica');
  });

  it('o link público sai no endereço do projeto; o da equipe, no do painel', async () => {
    assert.equal(guestsSvc.longInviteUrl(tokenPulso, PULSO), `https://${HOST_PULSO}/convite/${tokenPulso}`);
    assert.equal(guestsSvc.longInviteUrl(tokenCem, P100), `https://${HOST_CEM}/convite/${tokenCem}`);
    assert.equal(pu.publicUrl(null, '/pos-gravacao'), `https://${HOST_PULSO}/pos-gravacao`, 'página da casa fica no projeto padrão');
    assert.match(pu.panelUrl('/convidados'), /\/convidados$/);
    assert.ok(!pu.panelUrl('/convidados').includes(HOST_PULSO), 'link da equipe não vai para o domínio público');
  });

  it('no domínio de um projeto, a tela do painel vai para o painel', async () => {
    for (const path of ['/convidados', '/', '/financeiro', '/gestao/projetos']) {
      const r = await gestao.get(path, at(HOST_PULSO));
      assert.ok([302, 303].includes(r.status), `${path} devia sair do domínio público (veio ${r.status})`);
      assert.match(String(r.location), new RegExp(`${path.replace(/[/]/g, '\\/')}$`));
      assert.ok(!String(r.location).includes(HOST_PULSO), 'vai para o endereço do painel');
      assert.doesNotMatch(r.text, /Convidados|Painel/, 'nenhuma tela interna no domínio público');
    }
  });

  it('a página pública abre no domínio do projeto e o link no domínio errado é levado ao certo', async () => {
    const aberta = await gestao.get(`/convite/${tokenPulso}`, at(HOST_PULSO));
    assert.equal(aberta.status, 200);
    assert.match(aberta.text, /Dra\. Ana|Ana/);

    const errada = await gestao.get(`/convite/${tokenPulso}`, at(HOST_CEM));
    assert.ok([302, 303].includes(errada.status));
    assert.equal(errada.location, `https://${HOST_PULSO}/convite/${tokenPulso}`);

    const doCem = await gestao.get(`/convite/${tokenCem}`, at(HOST_PULSO));
    assert.ok([302, 303].includes(doCem.status));
    assert.equal(doCem.location, `https://${HOST_CEM}/convite/${tokenCem}`);
  });

  it('o ícone e o nome público seguem o domínio', async () => {
    const painel = await gestao.get('/favicon.ico');
    const doPulso = await gestao.get('/favicon.ico', at(HOST_PULSO));
    assert.equal(painel.status, 200); assert.equal(doPulso.status, 200);
    // os dois .ico têm o mesmo tamanho; o que muda é o arquivo (o ETag do Express carrega tamanho e data)
    assert.notEqual(painel.headers.get('etag'), doPulso.headers.get('etag'), 'o painel tem o monograma; o projeto, o ícone dele');

    assert.equal(projects.publicName(PULSO), 'Podcast Pulso', 'o nome de fora continua o de sempre');
    assert.equal(projects.publicName(P100), 'Projeto 100');
    const convite = await guestsSvc.renderInvite(await one('SELECT * FROM guests WHERE invite_token = $1', [tokenCem]), {});
    assert.equal(convite.subject, 'Convite para o Projeto 100');
    // o Projeto 100 ainda não tem ícones próprios (vêm na marca dele): a página pública usa os do projeto padrão
    assert.match(convite.html, /brand\/pulso\/favicon\.svg/, 'sem ícone próprio ainda, o convite usa o do projeto padrão');
  });

  it('a sessão do painel não serve de nada no domínio de um projeto', async () => {
    const r = await gestao.get('/convidados', at(HOST_PULSO));
    assert.ok([302, 303].includes(r.status));
    assert.doesNotMatch(r.text, /sair|Sair|logout/, 'nem o menu da pessoa aparece ali');
  });
});
