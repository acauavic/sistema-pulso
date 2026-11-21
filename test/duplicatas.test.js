const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const dup = require('../src/services/duplicates');

describe('duplicatas: regras, aviso ao cadastrar, faixa no cadastro, gestão e juntar', () => {
  const q = async (sql, p) => (await h.db.query(sql, p)).rows;
  let app; const as = {}; const u = {};

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    for (const [k, name, role] of [['gestao', 'Gil Gestão', 'gestao'], ['prod', 'Paula Produtora', 'produtora'], ['editor', 'Edu Editor', 'editor_video']]) {
      u[k] = await h.createUser({ name, email: `${k}@t.com`, role });
      as[k] = h.client(app.base); assert.equal((await as[k].login(`${k}@t.com`)).status, 302);
    }
    require('../src/services/googleCalendar').kickDelay.ms = 600_000;
  });
  after(async () => { await app.close(); await h.db.close(); });

  const guest = async (o) => (await q("INSERT INTO guests (name, instagram, email, phone, profile, status, owner_id) VALUES ($1,$2,$3,$4,'medico',$5,$6) RETURNING *",
    [o.name, o.instagram ?? null, o.email ?? null, o.phone ?? null, o.status || 'prospect', o.owner ?? u.prod.id]))[0];
  const sponsor = async (o) => (await q("INSERT INTO sponsors (company, website, contact_email, contact_phone, stage, owner_id, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [o.company, o.website ?? null, o.email ?? null, o.phone ?? null, o.stage || 'prospect', o.owner ?? u.prod.id, o.notes ?? null]))[0];

  it('normaliza e compara: @, telefone, site com utm, títulos, grupos que dividem e-mail', () => {
    const n = dup.norm;
    assert.deepEqual(['@Fulano', 'https://www.instagram.com/fulano/?igsh=x', 'fulano', 'instagram.com/fulano'].map(n.instagram), ['fulano', 'fulano', 'fulano', 'fulano']);
    assert.equal(n.phone('+55 (11) 98888-7777'), n.phone('11988887777'));
    assert.equal(n.phone('9888'), '', 'número curto não compara');
    assert.equal(n.site('https://www.mustela.com.br/?utm_source=ig&fbclid=x'), 'mustela.com.br');
    assert.equal(n.site('https://linktr.ee/marca'), '', 'agregador não compara');
    assert.equal(n.personName('Dr. Bruno Bíndi'), 'bruno bindi');
    assert.equal(n.companyName('Vitha Suplementos LTDA.'), 'vitha suplementos');
    assert.equal(n.companyName('Natura S.A.'), 'natura');

    const g = (r) => dup.keys('guest', r); const s = (r) => dup.keys('sponsor', r);
    assert.deepEqual(dup.compare('guest', g({ name: 'Ana', instagram: '@Ana.Lu' }), g({ name: 'Outra', instagram: 'instagram.com/ana.lu/' })), { level: 'certa', reasons: ['mesmo Instagram'] });
    assert.equal(dup.compare('guest', g({ name: 'Dr. Bruno Bindi' }), g({ name: 'Bruno Bindi' })).level, 'possivel');
    assert.equal(dup.compare('guest', g({ name: 'Mariana Albuquerqe' }), g({ name: 'Mariana Albuquerque' })).level, 'possivel', 'erro de digitação');
    assert.equal(dup.compare('guest', g({ name: 'Ana Silva' }), g({ name: 'Ana Paula Silva' })).level, 'possivel', 'mesmo primeiro e último nome');
    assert.equal(dup.compare('guest', g({ name: 'João Lima' }), g({ name: 'Pedro Costa' })), null);
    assert.equal(dup.compare('guest', g({ name: 'A', phone: '+55 11 98888-7777' }), g({ name: 'B', phone: '(11) 98888-7777' })).level, 'certa');
    assert.equal(dup.compare('sponsor', s({ company: 'Mustela', website: 'https://www.mustela.com.br/' }), s({ company: 'Mustela Brasil', website: 'mustela.com.br/?utm=1' })).level, 'certa');
    const grupo = dup.compare('sponsor', s({ company: 'Probiótica', email: 'marketing@supley.com.br' }), s({ company: 'Max Titanium', email: 'marketing@supley.com.br' }));
    assert.deepEqual(grupo, { level: 'possivel', reasons: ['mesmo e-mail'] }, 'grupo que divide e-mail é só possível');
    assert.equal(dup.compare('sponsor', s({ company: 'Mundo Verde' }), s({ company: 'mundo verde ltda' })).level, 'certa');
    assert.equal(dup.compare('sponsor', s({ company: 'Biolab', website: 'https://linktr.ee/x' }), s({ company: 'Memed', website: 'https://linktr.ee/x' })), null);
  });

  it('cadastro de patrocinador: aviso antes de gravar, "cadastrar mesmo assim" e o formulário trava no clique', async () => {
    await sponsor({ company: 'Mundo Verde', website: 'https://www.mundoverde.com.br/?srsltid=abc' });
    const form = (await as.prod.get('/patrocinadores/novo')).text;
    assert.match(form, /data-busy="Salvando…"/, 'o botão de criar trava depois do primeiro clique');
    let r = await as.prod.act('/patrocinadores', { company: 'Mundo Verde', kind: 'negocio', stage: 'prospect', owner_id: u.prod.id }, { from: '/patrocinadores/novo' });
    assert.equal(r.status, 200);
    assert.match(r.text, /Este patrocinador já está cadastrado/); assert.match(r.text, /mesma empresa/); assert.match(r.text, /Cadastrar mesmo assim/);
    assert.match(r.text, /value="Mundo Verde"/, 'o que foi digitado continua no formulário');
    assert.equal((await q("SELECT count(*)::int AS n FROM sponsors WHERE company = 'Mundo Verde'"))[0].n, 1, 'não gravou');
    r = await as.prod.act('/patrocinadores', { company: 'Mundo Verde', kind: 'negocio', stage: 'prospect', owner_id: u.prod.id, confirmar_duplicata: '1' }, { from: '/patrocinadores/novo' });
    assert.equal(r.status, 302);
    assert.equal((await q("SELECT count(*)::int AS n FROM sponsors WHERE company = 'Mundo Verde'"))[0].n, 2);
    r = await as.prod.act('/patrocinadores', { company: 'Empresa Inédita', kind: 'negocio', stage: 'prospect', owner_id: u.prod.id }, { from: '/patrocinadores/novo' });
    assert.equal(r.status, 302, 'nada parecido: grava direto');
  });

  it('cadastro de convidado: duplicata certa pelo @ e possível pelo nome', async () => {
    await guest({ name: 'Dr. Bruno Bindi', instagram: 'brunobindi' });
    let r = await as.prod.act('/convidados', { name: 'Fulano Qualquer', instagram: '@BrunoBindi', profile: 'medico' }, { from: '/convidados/novo' });
    assert.equal(r.status, 200); assert.match(r.text, /Este convidado já está cadastrado/); assert.match(r.text, /mesmo Instagram/);
    r = await as.prod.act('/convidados', { name: 'Bruno Bindi', instagram: '@outro.bruno', profile: 'medico' }, { from: '/convidados/novo' });
    assert.equal(r.status, 200); assert.match(r.text, /Pode já estar cadastrado/); assert.match(r.text, /mesmo nome/, "títulos (Dr.) não contam");
    r = await as.prod.act('/convidados', { name: 'Bruno Bindi', instagram: '@outro.bruno', profile: 'medico', confirmar_duplicata: '1' }, { from: '/convidados/novo' });
    assert.equal(r.status, 302);
  });

  it('o cadastro mostra a faixa; "não é duplicata" some com ela e a gestão pode voltar a avisar', async () => {
    const [a, b] = await q("SELECT id FROM sponsors WHERE company = 'Mundo Verde' ORDER BY id");
    let page = (await as.prod.get(`/patrocinadores/${b.id}`)).text;
    assert.match(page, /Duplicata de/); assert.match(page, new RegExp(`/duplicatas/patrocinadores/${b.id}/${a.id}`));
    assert.doesNotMatch((await as.editor.get(`/patrocinadores/${b.id}`)).text, /Duplicata de/, 'quem só lê não vê o aviso');

    const list = await as.gestao.get('/gestao/duplicatas');
    assert.equal(list.status, 200); assert.match(list.text, /Mundo Verde/); assert.match(list.text, /Bruno Bindi/);
    assert.equal((await as.prod.get('/gestao/duplicatas')).status, 403, 'a lista é da gestão');

    await as.prod.act(`/duplicatas/patrocinadores/${b.id}/${a.id}/dispensar`, { voltar: `/patrocinadores/${b.id}` }, { from: `/patrocinadores/${b.id}` });
    page = (await as.prod.get(`/patrocinadores/${b.id}`)).text;
    assert.doesNotMatch(page, /Duplicata de/);
    assert.equal((await dup.pairs('sponsor')).dismissed.length, 1);
    assert.match((await as.gestao.get('/gestao/duplicatas')).text, /Marcados como não duplicata/);
    await as.gestao.act(`/duplicatas/patrocinadores/${a.id}/${b.id}/avisar`, {}, { from: '/gestao/duplicatas' });
    assert.match((await as.prod.get(`/patrocinadores/${b.id}`)).text, /Duplicata de/, 'voltou a avisar');
    assert.equal((await as.editor.act(`/duplicatas/patrocinadores/${a.id}/${b.id}/dispensar`, {}, { from: '/' })).status, 403);
  });

  it('juntar patrocinadores: tudo passa para o que fica, repetido fica com o que sai, valores escolhidos e lixeira', async () => {
    const keep = await sponsor({ company: 'Mustela', website: 'https://www.mustela.com.br/', email: 'sac@expanscience.com.br', stage: 'negociacao', notes: 'Falar com a Rita.' });
    const drop = await sponsor({ company: 'Mustela', website: 'https://www.mustela.com.br/?utm=x', email: 'mkt@mustela.com', phone: '+55 11 97777-6666', stage: 'prospect', owner: null });
    const [ep1] = await q("INSERT INTO episodes (title) VALUES ('EP com os dois') RETURNING id");
    const [ep2] = await q("INSERT INTO episodes (title) VALUES ('EP só do que sai') RETURNING id");
    await q("INSERT INTO sponsor_episodes (sponsor_id, episode_id) VALUES ($1,$3),($2,$3),($2,$4)", [keep.id, drop.id, ep1.id, ep2.id]);
    await q("INSERT INTO sponsor_events (sponsor_id, type, message) VALUES ($1, 'nota', 'evento do que sai')", [drop.id]);
    await q("INSERT INTO outreach_attempts (subject_type, subject_id, channel, address, user_id) VALUES ('sponsor', $1, 'email', 'mkt@mustela.com', $2)", [drop.id, u.prod.id]);
    await q("INSERT INTO comments (entity_type, entity_id, body, author_id) VALUES ('sponsor', $1, 'Comentário do que sai', $2)", [drop.id, u.prod.id]);
    await q("INSERT INTO tasks (title, kind, status, sponsor_id, created_by) VALUES ('Tarefa do que sai', 'geral', 'a_fazer', $1, $2)", [drop.id, u.prod.id]);
    await q("INSERT INTO sponsor_meetings (sponsor_id, title, starts_at, minutes, mode, attendees, created_by) VALUES ($1, 'Reunião', now() + interval '2 days', 30, 'meet', '[]', $2)", [drop.id, u.prod.id]);

    const page = await as.prod.get(`/duplicatas/patrocinadores/${keep.id}/${drop.id}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Qual cadastro fica/); assert.match(page.text, /E-mail do contato/, 'campo em conflito aparece');
    assert.doesNotMatch(page.text, /<span class="seg-label">Site</, 'site igual depois de normalizar não é conflito');
    assert.match(page.text, new RegExp(`name="manter" value="${keep.id}" checked`), 'fica o de etapa mais avançada');

    const r = await as.prod.act(`/duplicatas/patrocinadores/${keep.id}/${drop.id}/juntar`, { manter: keep.id, campo_contact_email: drop.id }, { from: `/duplicatas/patrocinadores/${keep.id}/${drop.id}` });
    assert.equal(r.status, 302); assert.equal(r.location, `/patrocinadores/${keep.id}`);
    const [s] = await q('SELECT * FROM sponsors WHERE id = $1', [keep.id]);
    assert.equal(s.contact_email, 'mkt@mustela.com', 'ficou o e-mail escolhido');
    assert.equal(s.contact_phone, '+55 11 97777-6666', 'vazio preenchido com o do outro');
    assert.match(s.notes, /Falar com a Rita\./); assert.match(s.notes, /e-mail do contato: sac@expanscience\.com\.br/, 'o valor que não ficou vai para as observações');
    assert.equal((await q('SELECT 1 FROM sponsors WHERE id = $1', [drop.id])).length, 0);
    assert.deepEqual((await q('SELECT episode_id FROM sponsor_episodes WHERE sponsor_id = $1 ORDER BY episode_id', [keep.id])).map((x) => x.episode_id), [ep1.id, ep2.id]);
    for (const [sql, label] of [
      ["SELECT 1 FROM sponsor_events WHERE sponsor_id = $1 AND message = 'evento do que sai'", 'evento'],
      ["SELECT 1 FROM outreach_attempts WHERE subject_type = 'sponsor' AND subject_id = $1", 'abordagem'],
      ["SELECT 1 FROM comments WHERE entity_type = 'sponsor' AND entity_id = $1", 'comentário'],
      ['SELECT 1 FROM tasks WHERE sponsor_id = $1', 'tarefa'],
      ['SELECT 1 FROM sponsor_meetings WHERE sponsor_id = $1', 'reunião'],
      ["SELECT 1 FROM sponsor_events WHERE sponsor_id = $1 AND message LIKE 'Juntado com o cadastro de Mustela%'", 'linha do tempo da junção'],
    ]) assert.equal((await q(sql, [keep.id])).length, 1, label);
    const [t] = await q("SELECT id, payload FROM trash_items WHERE kind = 'sponsor' AND ref_id = $1", [String(drop.id)]);
    assert.ok(t, 'o que saiu está na lixeira');
    assert.ok(t.payload.rows.some((x) => x.table === 'sponsor_episodes' && x.row.episode_id === ep1.id), 'o vínculo repetido foi com o que saiu');
    assert.equal((await q("SELECT 1 FROM audit_log WHERE action = 'patrocinador.juntado'")).length, 1);

    const back = await require('../src/services/trash').restore(t.id);
    assert.ok(back.ok, JSON.stringify(back));
    const [again] = await q('SELECT company, contact_email FROM sponsors WHERE id = $1', [drop.id]);
    assert.deepEqual(again, { company: 'Mustela', contact_email: 'mkt@mustela.com' }, 'restaurar devolve os dados do cadastro que saiu');
    assert.equal((await q("SELECT 1 FROM outreach_attempts WHERE subject_type = 'sponsor' AND subject_id = $1", [drop.id])).length, 0, 'o histórico continua no que ficou');
  });

  it('juntar convidados: link do convite e foto acompanham quando o que fica não tem', async () => {
    const keep = await guest({ name: 'Carla Menezes', instagram: 'carla.menezes', status: 'em_agendamento' });
    await q('UPDATE guests SET photo_key = NULL WHERE id = $1', [keep.id]);
    const drop = await guest({ name: 'Carla Menezes', email: 'carla@x.com', status: 'convite_enviado' });
    await q("UPDATE guests SET invite_token = 'tok-carla', invite_sent_at = now(), photo_key = 'guests/carla.jpg' WHERE id = $1", [drop.id]);
    await q("INSERT INTO outreach_attempts (subject_type, subject_id, channel, address, user_id) VALUES ('guest', $1, 'instagram', '@carla', $2)", [drop.id, u.prod.id]);
    const r = await as.prod.act(`/duplicatas/convidados/${drop.id}/${keep.id}/juntar`, { manter: keep.id }, { from: `/duplicatas/convidados/${drop.id}/${keep.id}` });
    assert.equal(r.status, 302);
    const [g] = await q('SELECT email, invite_token, invite_sent_at, photo_key FROM guests WHERE id = $1', [keep.id]);
    assert.equal(g.email, 'carla@x.com'); assert.equal(g.invite_token, 'tok-carla'); assert.ok(g.invite_sent_at); assert.equal(g.photo_key, 'guests/carla.jpg');
    const [t] = await q("SELECT storage_keys FROM trash_items WHERE kind = 'guest' AND ref_id = $1", [String(drop.id)]);
    assert.deepEqual(t.storage_keys, [], 'a foto não vai junto para a lixeira (a limpeza apagaria o arquivo do que ficou)');
    assert.equal((await q("SELECT 1 FROM outreach_attempts WHERE subject_type = 'guest' AND subject_id = $1", [keep.id])).length, 1);
  });

  it('recusa juntar com ele mesmo, ids inválidos ou sem escolher qual fica; editor não junta', async () => {
    const [a] = await q("SELECT id FROM guests WHERE name = 'Bruno Bindi'");
    const [b] = await q("SELECT id FROM guests WHERE name = 'Dr. Bruno Bindi'");
    assert.equal((await as.prod.get(`/duplicatas/convidados/${a.id}/${a.id}`)).status, 404);
    assert.equal((await as.prod.get(`/duplicatas/outros/${a.id}/${b.id}`)).status, 404);
    let r = await as.prod.act(`/duplicatas/convidados/${a.id}/${b.id}/juntar`, { manter: 999999 }, { from: '/' });
    assert.equal(r.status, 302); assert.equal((await q('SELECT count(*)::int AS n FROM guests WHERE id = ANY($1)', [[a.id, b.id]]))[0].n, 2);
    r = await as.editor.act(`/duplicatas/convidados/${a.id}/${b.id}/juntar`, { manter: a.id }, { from: '/' });
    assert.equal(r.status, 403);
    assert.deepEqual(await dup.merge('guest', a.id, a.id, {}, null), { error: 'Escolha dois cadastros diferentes.' });
  });

  it('assistente: duplicata certa recusa; possível pede confirmação', async () => {
    const assistant = require('../src/services/assistant');
    const user = { id: u.prod.id, name: 'Paula Produtora', role: 'produtora' };
    const tool = assistant.TOOLS ? assistant.TOOLS.find((t) => t.decl.name === 'criar_convidado') : null;
    if (!tool) return; // a ferramenta não é exportada nesta versão: coberta pelo teste do assistente
    let r = await tool.run({ nome: 'Qualquer', instagram: '@brunobindi', perfil: 'médico' }, user);
    assert.match(r.erro, /Já existe um convidado/);
    r = await tool.run({ nome: 'Bruno Bindi', instagram: '@terceiro.bruno', perfil: 'médico' }, user);
    assert.equal(r.precisa_confirmar, true);
    r = await tool.run({ nome: 'Bruno Bindi', instagram: '@terceiro.bruno', perfil: 'médico', confirmado: true }, user);
    assert.equal(r.criado, true);
  });
});
