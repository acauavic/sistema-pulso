const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('Plateia: visão em quadro, busca e filtros dos pedidos', () => {
  const as = {}; let app; let g1; let g2; const ids = {};
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const days = (n) => new Date(Date.now() + n * 86400_000).toISOString();
  const lead = async (name, phone, gid, status, extra = '') => (await q(
    `INSERT INTO plateia_leads (ref, guest_id, guest_name, recording_at, name, phone, country, price_cents, status ${extra ? ', added_by' : ''}) SELECT $1, g.id, g.name, g.proposed_at, $2, $3, 'BR', 19700, $4 ${extra ? ', (SELECT id FROM users WHERE email = \'prod@t.com\')' : ''} FROM guests g WHERE g.id = $5 RETURNING id`,
    [`ref-${name}`, name, phone, status, gid]))[0].id;
  const mover = async (client, id, status) => {
    const res = await fetch(`${app.base}/plateia/painel/leads/${id}/mover`, { method: 'POST', headers: { cookie: client.cookie(), accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': await client.csrf('/plateia/painel') }, body: new URLSearchParams({ status }) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const board = async (client, qs = '') => (await client.get(`/plateia/painel?vista=quadro${qs}`)).text;
  const column = (html, key) => html.split(`data-status="${key}"`)[1].split('</section>')[0];

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora'], ['editor', 'editor_video']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    const mk = async (name, at) => (await q("INSERT INTO guests (name, status, proposed_at, email, scheduled_studio, scheduled_hosts, scheduled_guest) VALUES ($1,'agendado',$2,'a@b.com',true,true,true) RETURNING id", [name, at]))[0].id;
    g1 = await mk('Dra. Ana', days(5)); g2 = await mk('Dr. Bruno', days(9));
    ids.novo = await lead('Maria Nova', '+5511911110001', g1, 'novo');
    ids.aval = await lead('João Avaliação', '+5511911110002', g1, 'em_atendimento');
    ids.sel = await lead('Sara Selecionada', '+5511911110003', g2, 'novo', 'equipe');
    ids.des = await lead('Davi Desistiu', '+5521922220004', g2, 'desistiu');
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('o quadro tem uma coluna por situação, com os pedidos e as contagens, e o seletor Lista | Quadro', async () => {
    const html = await board(as.prod);
    for (const k of ['novo', 'em_atendimento', 'confirmado', 'nao_selecionado', 'desistiu']) assert.match(html, new RegExp(`data-status="${k}"`));
    assert.match(column(html, 'novo'), /Maria Nova/); assert.match(column(html, 'novo'), /Sara Selecionada/);
    assert.match(column(html, 'em_atendimento'), /João Avaliação/); assert.match(column(html, 'desistiu'), /Davi Desistiu/);
    assert.match(column(html, 'novo'), /<span class="count">2<\/span>/);
    assert.match(html, /data-base="\/plateia\/painel\/leads"/); assert.match(html, /data-status-path="mover"/);
    assert.match(html, /aria-label="Ver em quadro"/); assert.match(html, /aria-label="Ver em lista"/);
    assert.match(column(html, 'confirmado'), /data-drop-open/, 'soltar em Selecionado abre a janela de confirmação');
    assert.doesNotMatch(html, /name="status" aria-label="Situação"/, 'no quadro a situação é a coluna');
    const list = (await as.prod.get('/plateia/painel')).text;
    assert.doesNotMatch(list, /data-board/, 'a lista continua sendo a visão padrão');
  });

  it('busca por nome, WhatsApp e convidado; filtros por episódio e por origem valem nas duas visões', async () => {
    let html = await board(as.prod, '&q=maria');
    assert.match(html, /Maria Nova/); assert.doesNotMatch(html, /João Avaliação/);
    html = await board(as.prod, '&q=11%2091111-0002');
    assert.match(html, /João Avaliação/); assert.doesNotMatch(html, /Maria Nova/);
    html = await board(as.prod, `&q=bruno`);
    assert.match(html, /Sara Selecionada/); assert.doesNotMatch(html, /Maria Nova/);
    html = await board(as.prod, `&convidado=${g1}`);
    assert.match(html, /Maria Nova/); assert.doesNotMatch(html, /Sara Selecionada/);
    html = await board(as.prod, '&origem=equipe');
    assert.match(html, /Sara Selecionada/); assert.doesNotMatch(html, /Maria Nova/);
    html = await board(as.prod, '&origem=pagina');
    assert.doesNotMatch(html, /Sara Selecionada/); assert.match(html, /Maria Nova/);
    const list = (await as.prod.get('/plateia/painel?q=davi')).text;
    assert.match(list, /Davi Desistiu/); assert.doesNotMatch(list, /Maria Nova/);
    assert.match(await board(as.prod, '&q=zzzz'), /Nenhum pedido com esses filtros/);
  });

  it('arrastar muda a situação; Selecionado não passa pelo arrastar; sair de Selecionado cancela a conta a receber', async () => {
    let r = await mover(as.prod, ids.novo, 'em_atendimento');
    assert.equal(r.status, 200); assert.equal(r.json.ok, true);
    assert.equal((await q('SELECT status FROM plateia_leads WHERE id=$1', [ids.novo]))[0].status, 'em_atendimento');
    r = await mover(as.prod, ids.novo, 'confirmado');
    assert.equal(r.status, 422); assert.match(r.json.error, /valor combinado/);
    assert.equal((await q('SELECT status FROM plateia_leads WHERE id=$1', [ids.novo]))[0].status, 'em_atendimento');
    assert.equal((await mover(as.prod, ids.novo, 'xis')).status, 400);
    assert.equal((await mover(as.prod, 999999, 'novo')).status, 404);
    // seleciona (janela de confirmação) e depois tira de Selecionado arrastando
    await as.prod.act(`/plateia/painel/leads/${ids.sel}/confirmar`, { amount: '197,00', paid: '0', due_on: new Date().toISOString().slice(0, 10) }, { from: '/plateia/painel' });
    const lead = (await q('SELECT * FROM plateia_leads WHERE id=$1', [ids.sel]))[0];
    assert.equal(lead.status, 'confirmado'); assert.ok(lead.entry_id);
    assert.match(column(await board(as.prod), 'confirmado'), /Sara Selecionada[\s\S]*a receber/);
    r = await mover(as.prod, ids.sel, 'nao_selecionado');
    assert.equal(r.json.reload, true, 'o quadro recarrega para mostrar o aviso da conta cancelada');
    assert.equal((await q('SELECT status FROM fin_entries WHERE id=$1', [lead.entry_id]))[0].status, 'cancelado');
    assert.equal((await mover(as.prod, ids.des, 'novo')).json.reload, false, 'movimento simples não recarrega');
  });

  it('o editor de vídeo não acessa o quadro nem move pedidos', async () => {
    assert.equal((await as.editor.get('/plateia/painel?vista=quadro')).status, 403);
    assert.equal((await mover(as.editor, ids.des, 'novo')).status, 403);
  });
});

describe('Plateia: editar e excluir pedidos', () => {
  const as = {}; let app; let g1; let g2;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const days = (n) => new Date(Date.now() + n * 86400_000).toISOString();
  const act = (client, path, form) => client.act(path, form, { from: '/plateia/painel' });
  const mkLead = async (name, phone, gid, extra = {}) => (await q(
    `INSERT INTO plateia_leads (ref, guest_id, guest_name, recording_at, name, phone, country, price_cents, status)
     SELECT $1, g.id, g.name, g.proposed_at, $2, $3, 'BR', 19700, $4 FROM guests g WHERE g.id = $5 RETURNING id`, [`ref-${name}`, name, phone, extra.status || 'novo', gid]))[0].id;

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['prod', 'produtora'], ['editor', 'editor_video']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    const mk = async (name, at) => (await q("INSERT INTO guests (name, status, proposed_at, email, scheduled_studio, scheduled_hosts, scheduled_guest) VALUES ($1,'agendado',$2,'a@b.com',true,true,true) RETURNING id", [name, at]))[0].id;
    g1 = await mk('Dra. Um', days(5)); g2 = await mk('Dr. Dois', days(8));
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('a lista é uma tabela alinhada, com ícones nas ações e a situação num chip que abre as opções', async () => {
    await mkLead('Ana Lista', '+5511911112222', g1);
    const html = (await as.prod.get('/plateia/painel')).text;
    assert.match(html, /<table class="ptable">/); assert.match(html, /<th>Pessoa<\/th><th>WhatsApp<\/th><th>Situação<\/th><th>Pedido em<\/th>/);
    assert.match(html, /aria-label="Chamar Ana Lista no WhatsApp"/); assert.match(html, /aria-label="Editar o pedido de Ana Lista"/); assert.match(html, /aria-label="Selecionar Ana Lista"/);
    assert.match(html, /aria-label="Mudar a situação de Ana Lista"[\s\S]*Em avaliação[\s\S]*Selecionado…/);
    assert.doesNotMatch(html, /Confirmar participação<\/button>/, 'sem botões de texto repetidos em cada linha');
  });

  it('editar: nome, WhatsApp, gravação e observações; recusa nome vazio, WhatsApp inválido ou repetido', async () => {
    const id = await mkLead('Beto Edita', '+5511933334444', g1); await mkLead('Outro Beto', '+5511955556666', g2);
    await act(as.prod, `/plateia/painel/leads/${id}/editar`, { name: 'Beto Editado', country: 'BR', phone: '(11) 97777-8888', guest_id: String(g2), notes: 'Vem com a esposa' });
    let [l] = await q('SELECT * FROM plateia_leads WHERE id = $1', [id]);
    assert.equal(l.name, 'Beto Editado'); assert.equal(l.phone, '+5511977778888'); assert.equal(l.notes, 'Vem com a esposa');
    assert.equal(l.guest_id, g2); assert.equal(l.guest_name, 'Dr. Dois'); assert.ok(l.recording_at, 'acompanha a data da nova gravação');
    const same = async (form) => { await act(as.prod, `/plateia/painel/leads/${id}/editar`, form); [l] = await q('SELECT * FROM plateia_leads WHERE id = $1', [id]); assert.equal(l.name, 'Beto Editado', JSON.stringify(form)); };
    await same({ name: '', country: 'BR', phone: '11 97777-8888', guest_id: String(g2) });
    await same({ name: 'X', country: 'BR', phone: '123', guest_id: String(g2) });
    await same({ name: 'X', country: 'BR', phone: '11 95555-6666', guest_id: String(g2) }); // já existe nessa gravação
    const page = (await as.prod.get('/plateia/painel')).text;
    assert.match(page, /id="modal-editar"/); assert.match(page, /data-fill-remove="\/plateia\/painel\/leads\/\d+\/excluir"/);
    assert.equal((await as.editor.get('/plateia/painel')).status, 403);
    assert.notEqual((await act(as.editor, `/plateia/painel/leads/${id}/editar`, { name: 'Invasor', country: 'BR', phone: '11 97777-8888', guest_id: String(g2) })).status, 200);
    assert.equal((await q('SELECT name FROM plateia_leads WHERE id = $1', [id]))[0].name, 'Beto Editado');
  });

  it('editar o nome de quem já está selecionado atualiza a conta a receber', async () => {
    const id = await mkLead('Carla Selecionada', '+5511912340000', g1);
    await act(as.prod, `/plateia/painel/leads/${id}/confirmar`, { amount: '197,00', paid: '0', due_on: new Date().toISOString().slice(0, 10) });
    const { entry_id: entry } = (await q('SELECT entry_id FROM plateia_leads WHERE id = $1', [id]))[0];
    await act(as.prod, `/plateia/painel/leads/${id}/editar`, { name: 'Carla Souza', country: 'BR', phone: '11 91234-0000', guest_id: String(g1) });
    assert.match((await q('SELECT description FROM fin_entries WHERE id = $1', [entry]))[0].description, /Plateia · Carla Souza · Dra\. Um/);
  });

  it('excluir: apaga o pedido e cancela a conta ainda não paga; não apaga quem já pagou', async () => {
    const a = await mkLead('Davi Descartável', '+5511900001111', g1);
    await act(as.prod, `/plateia/painel/leads/${a}/confirmar`, { amount: '197,00', paid: '0', due_on: new Date().toISOString().slice(0, 10) });
    const entry = (await q('SELECT entry_id FROM plateia_leads WHERE id = $1', [a]))[0].entry_id;
    await act(as.prod, `/plateia/painel/leads/${a}/excluir`, {});
    assert.equal((await q('SELECT 1 FROM plateia_leads WHERE id = $1', [a])).length, 0);
    assert.equal((await q('SELECT status FROM fin_entries WHERE id = $1', [entry]))[0].status, 'cancelado');
    const b = await mkLead('Eva Pagou', '+5511900002222', g1);
    await act(as.prod, `/plateia/painel/leads/${b}/confirmar`, { amount: '197,00', paid: '1', paid_on: new Date().toISOString().slice(0, 10) });
    await act(as.prod, `/plateia/painel/leads/${b}/excluir`, {});
    assert.equal((await q('SELECT 1 FROM plateia_leads WHERE id = $1', [b])).length, 1, 'pagamento recebido: não apaga');
    await act(as.prod, `/plateia/painel/leads/${b}/recebido`, { desfazer: '1' });
    await act(as.prod, `/plateia/painel/leads/${b}/excluir`, {});
    assert.equal((await q('SELECT 1 FROM plateia_leads WHERE id = $1', [b])).length, 0, 'desfeito o recebimento, apaga');
    assert.notEqual((await act(as.editor, `/plateia/painel/leads/${a}/excluir`, {})).status, 200);
  });

  it('o quadro preenche a altura da tela: classe própria, sem o texto de apoio e com rolagem por coluna', async () => {
    const html = (await as.prod.get('/plateia/painel?vista=quadro')).text;
    assert.match(html, /class="board board-wide pboard"/);
    const css = (await as.prod.get(html.match(/\/static\/app\.css\?v=[a-f0-9]+/)[0])).text;
    assert.match(css, /\.pboard \{ min-height: 340px; \}/);
    assert.match(css, /\.pane:not\(\[hidden\]\) \.pboard\)\) \.column \.cards \{ flex: 1; min-height: 60px; overflow-y: auto;/);
  });
});
