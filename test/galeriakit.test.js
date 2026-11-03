const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const kitGallery = require('../src/services/kitGallery');

describe('Galeria do media kit: a equipe escolhe quais episódios publicados aparecem', () => {
  const as = {}; let app; let token; const ep = {};
  const kitPage = async () => { const c = h.client(app.base); await c.get(`/patrocinador/${token}`); return (await c.get('/patrocinador/kit')).text; };
  const chosen = async () => JSON.parse((await kitPage()).match(/var GUESTS_CHOSEN = (\[.*?\]);\n/s)[1]);

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora'], ['editor', 'editor_video']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    const r = await as.prod.act('/patrocinadores', { company: 'Marca Kit', kind: 'negocio', tier: 'ouro', stage: 'prospect' }, { from: '/patrocinadores/novo' });
    const sid = Number(r.location.split('/').pop());
    await as.prod.act(`/patrocinadores/${sid}/links`, {}, { from: `/patrocinadores/${sid}` });
    token = (await h.db.query('SELECT public_token FROM sponsors WHERE id=$1', [sid])).rows[0].public_token;
    const guest = async (name, extra = {}) => (await h.db.query("INSERT INTO guests (name, profile, status, instagram, job_title, company, photo_key) VALUES ($1, 'medico', 'gravado', $2, $3, $4, $5) RETURNING id", [name, extra.ig || null, extra.job || null, extra.company || null, extra.photo || null])).rows[0].id;
    const episode = async (number, title, status, guestId) => (await h.db.query('INSERT INTO episodes (number, title, status, guest_id) VALUES ($1, $2, $3, $4) RETURNING id', [number, title, status, guestId])).rows[0].id;
    ep.a = await episode(1, 'Primeiro', 'publicado', await guest('Dra. Ana Lima', { ig: '@dra.ana', job: 'Cardiologista', company: 'Clínica Ana', photo: 'k/ana.jpg' }));
    ep.b = await episode(2, 'Segundo', 'publicado', await guest('Dr. Beto', { ig: 'https://www.instagram.com/dr.beto/' }));
    ep.c = await episode(3, 'Em edição', 'em_edicao', await guest('Ainda Não'));
    ep.d = await episode(4, 'Sem convidado', 'publicado', null);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('sem escolha, o kit mostra a galeria padrão (lista escolhida vazia)', async () => {
    assert.deepEqual(await chosen(), []);
    const html = await kitPage();
    assert.match(html, /var GUESTS_DEFAULT = \[/);
    assert.match(html, /id="galleryTrack"/);
  });

  it('a tela lista só episódios publicados e a gestão escolhe', async () => {
    const page = await as.gestao.get('/gestao/galeria-kit');
    assert.equal(page.status, 200);
    assert.match(page.text, /Dra\. Ana Lima/); assert.match(page.text, /Dr\. Beto/);
    assert.doesNotMatch(page.text, /Ainda Não/, 'episódio em edição não aparece');
    assert.match(page.text, /precisa de convidado/, 'episódio sem convidado não pode ir ao kit');

    const r = await as.gestao.act(`/gestao/galeria-kit/${ep.a}/mostrar`, { mostrar: '1' }, { from: '/gestao/galeria-kit' });
    assert.equal(r.status, 302);
    const list = await chosen();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Dra. Ana Lima');
    assert.equal(list[0].handle, 'dra.ana');
    assert.equal(list[0].credential, 'Cardiologista · Clínica Ana', 'sem frase própria, usa cargo e empresa');
    assert.match(list[0].photo, /^\/agenda\/foto\/\d+\?e=\d+&s=/);
    assert.equal(list[0].audience, '—');
  });

  it('alcance e frase de apresentação são editáveis; instagram em URL vira só o usuário', async () => {
    await as.gestao.act(`/gestao/galeria-kit/${ep.b}/mostrar`, { mostrar: '1' }, { from: '/gestao/galeria-kit' });
    await as.gestao.act(`/gestao/galeria-kit/${ep.b}`, { audience: '+1,2M', credential: 'Médico e empresário' }, { from: '/gestao/galeria-kit' });
    const list = await chosen();
    assert.deepEqual(list.map((x) => x.name), ['Dra. Ana Lima', 'Dr. Beto'], 'segue a ordem dos episódios');
    assert.equal(list[1].audience, '+1,2M'); assert.equal(list[1].credential, 'Médico e empresário'); assert.equal(list[1].handle, 'dr.beto');
  });

  it('tirar do kit e regras: episódio não publicado e sem convidado não entram; quem não é da gestão não acessa', async () => {
    await as.gestao.act(`/gestao/galeria-kit/${ep.a}/mostrar`, { mostrar: '0' }, { from: '/gestao/galeria-kit' });
    assert.deepEqual((await chosen()).map((x) => x.name), ['Dr. Beto']);
    await as.gestao.act(`/gestao/galeria-kit/${ep.c}/mostrar`, { mostrar: '1' }, { from: '/gestao/galeria-kit' });
    assert.equal((await h.db.query('SELECT kit_featured FROM episodes WHERE id=$1', [ep.c])).rows[0].kit_featured, false);
    await as.gestao.act(`/gestao/galeria-kit/${ep.d}/mostrar`, { mostrar: '1' }, { from: '/gestao/galeria-kit' });
    assert.equal((await kitGallery.items()).length, 1, 'sem convidado ligado não vira cartão');
    for (const k of ['prod', 'editor']) assert.equal((await as[k].get('/gestao/galeria-kit')).status, 403);
  });
});
