const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('Media kit que leva para uma conversa: vagas reais, marcas que já estão com o Pulso e agenda com estreia e alcance', () => {
  const as = {}; let app; let sid; let token;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const kit = async () => { const c = h.client(app.base); await c.get(`/patrocinador/${token}`); return (await c.get('/patrocinador/kit')).text; };

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    const r = await as.prod.act('/patrocinadores', { company: 'Marca Visitante', kind: 'negocio', stage: 'prospect' }, { from: '/patrocinadores/novo' });
    sid = Number(r.location.split('/').pop());
    await as.prod.act(`/patrocinadores/${sid}/links`, {}, { from: `/patrocinadores/${sid}` });
    [{ public_token: token }] = await q('SELECT public_token FROM sponsors WHERE id = $1', [sid]);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('vagas: "no máximo 3 marcas ao mesmo tempo", contando só os patrocinadores Ativos; a gestão muda o máximo', async () => {
    let t = await kit();
    assert.match(t, /No máximo 3 marcas ao mesmo tempo/); assert.match(t, /class="vagas-num">3<small>de 3 vagas abertas/);
    await q("INSERT INTO sponsors (company, stage) VALUES ('Ativa Um', 'ativo'), ('Ativa Dois', 'ativo'), ('Já Saiu', 'inativo'), ('Negociando', 'negociacao')");
    t = await kit();
    assert.match(t, /class="vagas-num">1<small>de 3 vaga aberta/); assert.match(t, /Hoje 2 estão ocupadas/);
    assert.equal((t.match(/<span class="on"><\/span>/g) || []).length, 2);
    assert.equal((await as.prod.act('/gestao/patrocinios/vagas', { max: '5' }, { from: '/' })).status, 403, 'só a gestão');
    await as.gestao.act('/gestao/patrocinios/vagas', { max: '2' }, { from: '/gestao/patrocinios' });
    t = await kit();
    assert.match(t, /class="vagas-num">0<small>de 2 vagas abertas/); assert.match(t, /Hoje as 2 estão ocupadas/);
    assert.match((await as.gestao.get('/gestao/patrocinios')).text, /Vagas no media kit/);
    await as.gestao.act('/gestao/patrocinios/vagas', { max: '0' }, { from: '/gestao/patrocinios' });
    assert.match(await kit(), /de 2 vagas abertas/, 'número inválido não muda');
  });

  it('marcas que já estão com o Pulso: só as marcadas "Mostrar no media kit"; logo quando houver, senão o nome', async () => {
    assert.doesNotMatch(await kit(), /Marcas que escolheram estar nessas conversas/, 'sem marcas marcadas, o slide não aparece');
    const [{ id: ativa }] = await q("SELECT id FROM sponsors WHERE company = 'Ativa Um'");
    const page = (await as.prod.get(`/patrocinadores/${ativa}`)).text;
    assert.match(page, /Mostrar no media kit/);
    await as.prod.act(`/patrocinadores/${ativa}/media-kit`, { mostrar: '1' }, { from: `/patrocinadores/${ativa}` });
    assert.equal((await q('SELECT kit_show FROM sponsors WHERE id = $1', [ativa]))[0].kit_show, true);
    let t = await kit();
    assert.match(t, /Marcas que escolheram estar nessas conversas/); assert.match(t, /<span class="brand-name">Ativa Um<\/span>/);
    h.b2Store.set('patrocinadores/logo-a.png', { body: Buffer.alloc(200), contentType: 'image/png' });
    await q("INSERT INTO sponsor_files (sponsor_id, kind, storage_key, filename, content_type, size_bytes) VALUES ($1, 'logo', 'patrocinadores/logo-a.png', 'logo.png', 'image/png', 200)", [ativa]);
    t = await kit();
    assert.match(t, /<div class="brand"><img src="https:[^"]+" alt="Ativa Um"/);
    await as.prod.act(`/patrocinadores/${ativa}/media-kit`, { mostrar: '0' }, { from: `/patrocinadores/${ativa}` });
    assert.doesNotMatch(await kit(), /Marcas que escolheram estar nessas conversas/);
  });

  it('agenda: estreias marcadas (com alcance do cadastro) e depois gravações marcadas; nada de episódio já publicado', async () => {
    const [g1] = await q("INSERT INTO guests (name, instagram, profile, status, reach) VALUES ('Dra. Estreia', 'dra.estreia', 'medico', 'gravado', '+1,2M') RETURNING id");
    await q("INSERT INTO episodes (number, title, status, guest_id, aired_on) VALUES (40, 'Conversa', 'em_edicao', $1, CURRENT_DATE + 10)", [g1.id]);
    const [g2] = await q("INSERT INTO guests (name, instagram, profile, status) VALUES ('Dr. Publicado', 'dr.pub', 'medico', 'gravado') RETURNING id");
    await q("INSERT INTO episodes (number, title, status, guest_id, aired_on) VALUES (41, 'Já saiu', 'publicado', $1, CURRENT_DATE + 3)", [g2.id]);
    await q("INSERT INTO guests (name, instagram, profile, status, proposed_at, reach) VALUES ('Dr. Agendado', 'dr.agendado', 'medico', 'agendado', now() + interval '5 days', '+300K')");
    const t = await kit();
    assert.match(t, /Quem vem por aí/);
    assert.match(t, /class="agenda-date">ESTREIA \d{2} [A-Z]{3}<\/span>\s*<span class="agenda-name">Dra\. Estreia/);
    assert.match(t, /data-date="Estreia em \d+ de [a-zç]+"/); assert.match(t, /data-reach="\+1,2M"/);
    assert.match(t, /<span class="agenda-reach">\+1,2M<span class="lbl">seguidores<\/span><\/span>/);
    assert.match(t, /class="agenda-date">GRAVAÇÃO \d{2} [A-Z]{3}<\/span>\s*<span class="agenda-name">Dr\. Agendado/);
    assert.ok(t.indexOf('Dra. Estreia') < t.indexOf('Dr. Agendado'), 'estreias antes das gravações');
    assert.doesNotMatch(t, /Dr\. Publicado/);
  });

  it('o alcance fica no cadastro do convidado (formulário e resumo) e alimenta a galeria do kit', async () => {
    const r = await as.prod.act('/convidados', { name: 'Ana Alcance', instagram: '@ana.alcance', profile: 'medico', reach: '+850K', confirmar_duplicata: '1' }, { from: '/convidados/novo' });
    const id = Number(r.location.split('/').pop().split('?')[0].split('#')[0]);
    assert.equal((await q('SELECT reach FROM guests WHERE id = $1', [id]))[0].reach, '+850K');
    assert.match((await as.prod.get(`/convidados/${id}`)).text, /<dt>Alcance<\/dt><dd class="mono">\+850K seguidores/);
    assert.match((await as.prod.get(`/convidados/${id}/editar`)).text, /name="reach" value="\+850K"/);
    const [ep] = await q("INSERT INTO episodes (number, title, status, guest_id, kit_featured) VALUES (42, 'Galeria', 'gravado', $1, true) RETURNING id", [id]);
    const items = await require('../src/services/kitGallery').items();
    assert.equal(items.find((i) => i.ep === 42).audience, '+850K', 'sem alcance no episódio, usa o do convidado');
    await q("UPDATE episodes SET kit_audience = '+900K' WHERE id = $1", [ep.id]);
    assert.equal((await require('../src/services/kitGallery').items()).find((i) => i.ep === 42).audience, '+900K');
  });
});
