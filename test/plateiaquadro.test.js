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
    assert.match(html, /Quadro<\/a>/); assert.match(html, /Lista<\/a>/);
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
