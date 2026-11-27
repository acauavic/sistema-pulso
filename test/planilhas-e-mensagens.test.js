// Planilhas e mensagens (revisão de design e telas): a planilha de convidados segue os filtros da tela; a importação pede o
// projeto e confere duplicata no projeto; a da plateia sai no horário de Brasília e com os filtros; o ZIP não entrega arquivo
// de outro projeto; a sessão que terminou responde JSON para o fetch e manda o formulário ao login; a página de erro tem Voltar.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { userMessage } = require('../src/utils/userMessage');

const PULSO = 1; const P100 = 2;

describe('planilhas e mensagens', () => {
  const as = {}; let app;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const one = (sql, p) => q(sql, p).then((r) => r[0]);

  before(async () => {
    await h.resetDb();
    await h.createUser({ name: 'Casa', email: 'casa@local.test', role: 'gestao', projects: [PULSO, P100] });
    await h.createUser({ name: 'Cem', email: 'cem@local.test', role: 'gestao', projects: [P100] });
    app = await h.startServer();
    for (const k of ['casa', 'cem']) { as[k] = h.client(app.base); await as[k].login(`${k}@local.test`); }
    await h.db.query(`INSERT INTO guests (name, status, project_id, instagram, profile, email) VALUES
      ('Ana Prospect', 'prospect', 1, 'anap', 'medico', 'ana@x.com'), ('Bruno Agendado', 'agendado', 1, 'brunoa', 'medico', NULL),
      ('Carla do Cem', 'prospect', 2, 'carlac', 'medico', NULL)`);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('planilha de convidados: o que está na tela (etapa e projeto), com BOM e ";"', async () => {
    const all = await as.casa.get('/convidados/exportar.csv');
    assert.equal(all.status, 200); assert.match(all.headers.get('content-type'), /text\/csv/);
    assert.ok(all.text.replace(/^\uFEFF/, '').startsWith('Nome;Instagram;WhatsApp'), 'cabeçalho em português');
    assert.match(all.text, /Ana Prospect/); assert.match(all.text, /Carla do Cem/); assert.match(all.text, /;Projeto;/, 'com mais de um projeto, a coluna Projeto');
    const prospect = (await as.casa.get('/convidados/exportar.csv?status=prospect')).text;
    assert.match(prospect, /Ana Prospect/); assert.doesNotMatch(prospect, /Bruno Agendado/, 'filtro de etapa vale na planilha');
    const cem = (await as.cem.get('/convidados/exportar.csv')).text;
    assert.match(cem, /Carla do Cem/); assert.doesNotMatch(cem, /Ana Prospect/, 'só o projeto da pessoa');
    assert.match((await as.casa.get('/convidados?view=lista')).text, /\/convidados\/exportar\.csv/);
  });

  it('importação: em "Todos os projetos" pede o projeto; a duplicata é a do projeto escolhido', async () => {
    const csv = 'nome;instagram;perfil\nAna Outra;anap;médico\nNova Pessoa;novap;médico';
    let r = await as.casa.act('/convidados/importar/previa', { csv }, { from: '/convidados/importar' });
    assert.equal(r.status, 400); assert.match(r.text, /Escolha em que projeto os convidados entram/);
    r = await as.casa.act('/convidados/importar/previa', { csv, project_id: String(P100) }, { from: '/convidados/importar' });
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.text, /já cadastrado/, '@anap é do Pulso: no Projeto 100 não é duplicata');
    r = await as.casa.act('/convidados/importar/previa', { csv, project_id: String(PULSO) }, { from: '/convidados/importar' });
    assert.match(r.text, /@anap já cadastrado/);
    await as.casa.act('/convidados/importar', { csv, project_id: String(P100) }, { from: '/convidados/importar' });
    assert.equal(Number((await one("SELECT project_id FROM guests WHERE instagram = 'novap'")).project_id), P100, 'entra no projeto escolhido, nunca no padrão por engano');
  });

  it('planilha da plateia: data no horário de Brasília (dd/mm/aaaa) e os filtros da tela', async () => {
    await h.db.query(`INSERT INTO plateia_leads (ref, guest_name, name, phone, status, created_at) VALUES
      ('r1', 'Dr. X', 'Lia Nova', '+5511999990001', 'novo', '2026-11-21T02:30:00Z'), ('r2', 'Dr. X', 'Rui Confirmado', '+5511999990002', 'confirmado', '2026-11-20T15:00:00Z')`);
    const csv = (await as.casa.get('/plateia/painel/inscricoes.csv')).text;
    assert.match(csv, /20\/11\/2026 23:30/, '02:30 UTC é 23:30 do dia anterior em Brasília');
    assert.doesNotMatch(csv, /T02:30:00/, 'nada de data ISO em UTC');
    const novos = (await as.casa.get('/plateia/painel/inscricoes.csv?status=novo')).text;
    assert.match(novos, /Lia Nova/); assert.doesNotMatch(novos, /Rui Confirmado/);
  });

  it('ZIP de vários arquivos: arquivo de outro projeto fica de fora', async () => {
    const ep = await one("INSERT INTO episodes (title, project_id, number, status) VALUES ('Ep do Pulso', 1, 1, 'gravado') RETURNING id");
    const f = await one("INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, status) VALUES ($1, 'foto', 'foto.jpg', 10, 'k/foto.jpg', 'pronto') RETURNING id", [ep.id]);
    const r = await as.cem.get(`/baixar.zip?itens=f${f.id}`);
    assert.equal(r.status, 404, 'quem é só do Projeto 100 não baixa o arquivo do Pulso');
  });

  it('sessão que terminou: fetch recebe JSON com a frase; formulário vai ao login; erro tem Voltar', async () => {
    const anon = h.client(app.base);
    const j = await fetch(`${app.base}/tarefas/1/comentarios`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: '{}', redirect: 'manual' });
    assert.equal(j.status, 401); assert.match((await j.json()).error, /Sua sessão terminou/);
    const form = await anon.post('/tarefas', { title: 'x' });
    assert.equal(form.status, 303); assert.equal(form.location, '/login');
    const nf = await as.casa.get('/pagina-que-nao-existe');
    assert.equal(nf.status, 404); assert.match(nf.text, /data-go-back/); assert.match(nf.text, /lixeira ou em outro projeto/);
  });

  it('foto do convidado em qualquer etapa: quem foi cadastrado já gravado também envia (cartão Sobre)', async () => {
    const g = await one("INSERT INTO guests (name, status, project_id, instagram, profile) VALUES ('Luisa Gravada', 'gravado', 1, 'luisag', 'medico') RETURNING id");
    await h.db.query('UPDATE guests SET photo_key = NULL WHERE id = $1', [g.id]); // nos testes, o convidado nasce com foto
    await h.db.query('UPDATE people SET photo_key = NULL WHERE id = (SELECT person_id FROM guests WHERE id = $1)', [g.id]);
    const page = (await as.casa.get(`/convidados/${g.id}`)).text;
    const sobre = page.split('id="sobre"')[1].split('</section>')[0];
    assert.match(sobre, /data-modal-open="modal-foto"/, 'o botão abre a janela de foto');
    assert.match(sobre, /Enviar foto/); assert.match(sobre, /Sem foto/);
    assert.match(page, /id="modal-foto"/, 'a janela de recorte existe nesta etapa');
  });

  it('erro técnico do provedor não chega à pessoa; a frase do próprio sistema passa', () => {
    assert.equal(userMessage(new Error('Outstand recusou (500): Internal server error'), 'Reserva.'), 'Reserva.');
    assert.equal(userMessage(new Error('InfinitePay não configurada (INFINITEPAY_HANDLE).'), 'Reserva.'), 'Reserva.');
    assert.equal(userMessage(new Error('fetch failed'), 'Reserva.'), 'Reserva.');
    assert.equal(userMessage(new Error('Não há quadros analisados para montar as capas.'), 'Reserva.'), 'Não há quadros analisados para montar as capas.');
  });
});
