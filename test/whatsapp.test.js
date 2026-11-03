const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const contacts = require('../src/services/contacts');
const settings = require('../src/services/settings');

describe('WhatsApp dos convites: número e mensagens configuráveis na gestão', () => {
  let app; const as = {}; const u = {};
  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    for (const [k, role] of [['admin', 'superadmin'], ['gestao', 'gestao'], ['prod', 'produtora']]) {
      u[k] = await h.createUser({ name: `Pessoa ${k}`, email: `${k}@t.com`, role });
      as[k] = h.client(app.base); assert.equal((await as[k].login(`${k}@t.com`)).status, 302);
    }
  });
  after(async () => { await app.close(); await h.db.close(); });

  const location = async (client, path) => (await client.get(path, { redirect: 'manual' })).headers.get('location');

  it('sem configurar, vale o padrão do servidor e as mensagens de sempre', async () => {
    const cur = await contacts.current();
    assert.equal(cur.producao.numberFromEnv, true); assert.match(cur.producao.number, /^55\d{10,11}$/);
    assert.match(await contacts.waUrl('producao', 'aceitar', 'Dra. Ana'), /^https:\/\/wa\.me\/55\d+\?text=Ol%C3%A1!%20Sou%20Dra\.%20Ana%20e%20aceito%20o%20convite/);
    assert.match(await contacts.waUrl('patrocinio', 'quero', 'Clínica X'), /quero%20ser%20um%20patrocinador.*Cl%C3%ADnica%20X/);
  });

  it('a gestão troca o número e a mensagem; o botão do convite já usa; vazio volta ao padrão', async () => {
    const r = await as.gestao.act('/gestao/whatsapp', { grupo: 'producao', numero: '(11) 98888-7777', msg_aceitar: 'Oi, aqui é {nome}! Aceito o convite do {podcast}.', msg_producao: '' }, { from: '/gestao/whatsapp' });
    assert.equal(r.status, 302);
    const url = await contacts.waUrl('producao', 'aceitar', 'Rita');
    assert.ok(url.startsWith('https://wa.me/5511988887777?text='));
    assert.equal(decodeURIComponent(url.split('text=')[1]), 'Oi, aqui é Rita! Aceito o convite do Podcast Pulso.');
    assert.match(decodeURIComponent((await contacts.waUrl('producao', 'producao', 'Rita')).split('text=')[1]), /gostaria de falar com a produção/, 'mensagem vazia = padrão');

    // o redirecionamento real do convite
    const { rows: [g] } = await h.db.query("INSERT INTO guests (name, profile, status, invite_token) VALUES ('Rita Convidada', 'medico', 'convite_enviado', 'tokenwhatsapp0001abcdef') RETURNING id");
    const loc = await location(h.client(app.base), '/convite/tokenwhatsapp0001abcdef/producao');
    assert.ok(loc && loc.startsWith('https://wa.me/5511988887777?text='), loc);
    assert.match(decodeURIComponent(loc.split('text=')[1]), /Sou Rita Convidada/);

    await as.gestao.act('/gestao/whatsapp', { grupo: 'producao', numero: '', msg_aceitar: '', msg_producao: '' }, { from: '/gestao/whatsapp' });
    assert.equal((await contacts.current()).producao.numberFromEnv, true, 'número em branco volta ao padrão do servidor');
    await h.db.query('DELETE FROM guests WHERE id = $1', [g.id]);
  });

  it('comercial: número do patrocinador, número inválido e permissões', async () => {
    await as.admin.act('/gestao/whatsapp', { grupo: 'patrocinio', numero: '+55 11 97171-0000', msg_quero: 'Quero patrocinar o {podcast}. Sou da {nome}.', msg_equipe: 'Falar com a equipe, {nome}.' }, { from: '/gestao/whatsapp' });
    const url = await contacts.waUrl('patrocinio', 'quero', 'Marca Y');
    assert.ok(url.startsWith('https://wa.me/5511971710000?text=')); assert.equal(decodeURIComponent(url.split('text=')[1]), 'Quero patrocinar o Podcast Pulso. Sou da Marca Y.');
    await as.gestao.act('/gestao/whatsapp', { grupo: 'patrocinio', numero: '12345', msg_quero: 'x', msg_equipe: 'y' }, { from: '/gestao/whatsapp' });
    assert.equal((await contacts.current()).patrocinio.number, '5511971710000', 'número inválido não grava');
    assert.equal((await as.prod.get('/gestao/whatsapp')).status, 403);
    assert.equal((await as.prod.act('/gestao/whatsapp', { grupo: 'producao', numero: '11999990000' }, { from: '/' })).status, 403);
    const page = (await as.gestao.get('/gestao/whatsapp')).text;
    assert.match(page, /WhatsApp dos convites/); assert.match(page, /\+55 \(11\) 97171-0000/); assert.match(page, /Quero patrocinar o/);
  });

  it('o menu da gestão tem grupos e abas internas, só com o que o perfil pode ver', async () => {
    const page = (await as.gestao.get('/gestao/whatsapp')).text;
    for (const g of ['Visão geral', 'Equipe', 'Operação', 'Convites e parcerias', 'Sistema']) assert.match(page, new RegExp(`subnav-groups[\\s\\S]*>${g}<`), g);
    assert.match(page, /class="subnav-inner"/); assert.match(page, /aria-current="page">WhatsApp dos convites</); assert.match(page, />Planos de patrocínio</);
    assert.doesNotMatch(page, />Cadência de follow-up</, 'a aba de outro grupo só aparece dentro do grupo dela');
    const op = (await as.gestao.get('/gestao/cadencia')).text;
    for (const t of ['Cadência de follow-up', 'Lembretes da gravação', 'Rotinas de tarefas', 'Notificações']) assert.match(op, new RegExp(`>${t}<`), t);
    const geral = (await as.gestao.get('/gestao')).text;
    assert.doesNotMatch(geral, /class="subnav-inner"/, 'visão geral não tem segunda linha');
  });
});
