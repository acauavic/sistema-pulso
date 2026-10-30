const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const audience = require('../src/services/audience');
const fin_iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

describe('Pulso Podcast com Plateia', () => {
  const as = {}; let app; let anon;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const one = (sql, p) => q(sql, p).then((r) => r[0]);
  const days = (n) => new Date(Date.now() + n * 86400_000).toISOString();
  const mk = async (name, { status = 'agendado', at = days(10), topic = null, enabled = true } = {}) =>
    (await one("INSERT INTO guests (name, status, proposed_at, topic, audience_enabled, email, scheduled_studio, scheduled_hosts, scheduled_guest) VALUES ($1,$2,$3,$4,$5,'a@b.com',true,true,true) RETURNING id", [name, status, at, topic, enabled])).id;
  const json = (path, body, ua) => fetch(app.base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': ua || 'Mozilla/5.0 (test)' }, body: JSON.stringify(body) });
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
  const upload = async (user, path, buf, type = 'image/png') => fetch(app.base + path, { method: 'POST', headers: { cookie: user.cookie(), 'content-type': type, 'x-csrf-token': await user.csrf('/') }, body: buf });
  let g1; let g2; let g3; let g4; let g5;

  before(async () => {
    await h.resetDb(); app = await h.startServer(); anon = h.client(app.base);
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora'], ['editor', 'editor_video']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    g1 = await mk('Dra. Ana Souza', { topic: 'O futuro da medicina' });
    g2 = await mk('Dr. Bruno Lima', { at: days(20) });
    g3 = await mk('Dra. Fora da Plateia', { enabled: false });
    g4 = await mk('Dr. Sem Confirmar', { status: 'em_agendamento' });
    g5 = await mk('Dr. Já Passou', { at: days(-3) });
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('telefone: valida por país, aceita máscara e código colado, rejeita o que não dá', () => {
    assert.equal(audience.validatePhone('BR', '(11) 91234-5678').e164, '+5511912345678');
    assert.equal(audience.validatePhone('BR', '+55 11 91234-5678').e164, '+5511912345678');
    assert.equal(audience.validatePhone('BR', '011 91234-5678').e164, '+5511912345678');
    assert.ok(audience.validatePhone('BR', '1234').error);
    assert.ok(audience.validatePhone('BR', '11 81234-5678').error, 'celular de 11 dígitos precisa do 9');
    assert.ok(audience.validatePhone('BR', '00 91234-5678').error, 'DDD inválido');
    assert.equal(audience.validatePhone('PT', '912 345 678').e164, '+351912345678');
    assert.ok(audience.validatePhone('XX', '123').error);
  });

  it('a página pública abre sem login, é indexável e lista só as gravações certas, em ordem', async () => {
    await q("UPDATE guests SET instagram = 'dra.anasouza' WHERE id = $1", [g1]);
    const r = await anon.get('/plateia');
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.headers.get('x-robots-tag') || '', /noindex/);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'(;| )/);
    assert.doesNotMatch(r.headers.get('content-security-policy'), /unsafe-inline/);
    assert.match(r.text, /<h1>Conheça de perto quem move a saúde\.<\/h1>/); assert.match(r.text, /Networking qualificado/); assert.match(r.text, /Coffee break/);
    assert.doesNotMatch(r.text, /id="bastidores"/, 'sem vídeo dos bastidores, a seção não aparece'); assert.match(r.text, /selecionada pela produção/);
    assert.match(r.text, /Dra\. Ana Souza/); assert.match(r.text, /Dr\. Bruno Lima/);
    assert.match(r.text, /O futuro da medicina/);
    assert.doesNotMatch(r.text, /Fora da Plateia|Sem Confirmar|Já Passou/);
    assert.ok(r.text.indexOf('Ana Souza') < r.text.indexOf('Bruno Lima'), 'cronológico');
    assert.match(r.text, /R\$ 197/); assert.match(r.text, /1h30 a 2h/);
    assert.match(r.text, /Pedir para participar/); assert.match(r.text, /Pedir participação não garante a vaga/);
    assert.doesNotMatch(r.text, /<script>|onclick=/);
    assert.doesNotMatch(r.text, /class="pl-price"/, 'o valor fica no topo e na inscrição, não em cada card');
    const ig = r.text.match(/class="pl-ig" href="([^"]+)"/);
    assert.ok(ig, 'card com o Instagram do convidado'); assert.equal(ig[1], 'https://www.instagram.com/dra.anasouza/');
  });

  it('compartilhamento e SEO: título, descrição, imagem e favicon', async () => {
    const t = (await anon.get('/plateia')).text;
    assert.match(t, /Condições da plateia/); assert.match(t, /name="terms"/); assert.match(t, /sem aviso prévio/);
    assert.match(t, /<title>Pulso Podcast com Plateia: assista às gravações em São Paulo<\/title>/);
    assert.match(t, /<meta name="description" content="Assista de perto/);
    assert.match(t, /<meta property="og:image" content="http[^"]+\/static\/og-plateia\.jpg/);
    assert.match(t, /twitter:card" content="summary_large_image"/);
    assert.match(t, /rel="icon" href="\/static\/favicon\.svg/);
    const ico = await anon.get('/favicon.ico');
    assert.equal(ico.status, 200);
    assert.equal((await anon.get('/static/og-plateia.jpg')).status, 200);
    assert.equal((await anon.get('/apple-touch-icon.png')).status, 200);
  });

  it('foto do convidado: o painel abre o recorte na moldura 4:3 e quem só lê não vê o envio', async () => {
    const page = (await as.prod.get(`/convidados/${g1}`)).text;
    assert.match(page, /id="modal-recorte"[^>]*data-out-w="1200" data-out-h="900"/);
    assert.match(page, /data-image-input data-crop="4:3"/, 'o envio passa pelo recorte');
    assert.match(page, /\/static\/cropper\.js/);
    assert.match(page, /data-crop-ok/); assert.match(page, /Plateia<\/figcaption>/); assert.match(page, /Media kit e portal<\/figcaption>/); assert.match(page, /Painel<\/figcaption>/);
    const js = await fetch(`${app.base}/static/cropper.js`);
    assert.equal(js.status, 200); assert.match(await js.text(), /window\.pulsoCrop/);
    const editorPage = (await as.editor.get(`/convidados/${g1}`)).text;
    assert.doesNotMatch(editorPage, /modal-recorte|cropper\.js|data-crop=/);
    // o recorte entrega um JPEG já na moldura: o envio de sempre aceita
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);
    assert.equal((await upload(as.prod, `/convidados/${g1}/foto`, jpeg, 'image/jpeg')).status, 200);
    assert.match((await as.prod.get(`/convidados/${g1}`)).text, /<img class="guest-photo" src="\/convidados\/\d+\/foto"/);
  });

  it('desmarcar "aberto para plateia" tira da agenda; lotado e encerrado fecham o botão', async () => {
    assert.equal((await as.prod.act(`/convidados/${g2}/plateia`, { enabled: ['0'], status: 'disponivel' }, { from: `/convidados/${g2}` })).status, 302);
    assert.doesNotMatch((await anon.get('/plateia')).text, /Bruno Lima/);
    await as.prod.act(`/convidados/${g2}/plateia`, { enabled: ['0', '1'], status: 'lotado' }, { from: `/convidados/${g2}` });
    let t = (await anon.get('/plateia')).text;
    assert.match(t, /Bruno Lima/); assert.match(t, /Gravação lotada/);
    await as.prod.act(`/convidados/${g2}/plateia`, { enabled: ['0', '1'], status: 'encerrado' }, { from: `/convidados/${g2}` });
    assert.match((await anon.get('/plateia')).text, /Inscrições encerradas/);
    assert.equal((await as.editor.act(`/convidados/${g2}/plateia`, { enabled: '1' }, { from: '/' })).status, 403);
    // o card do convidado mostra o controle (agendado) e não mostra para quem já gravou
    const card = (await as.prod.get(`/convidados/${g2}`)).text;
    assert.match(card, /Podcast com plateia/); assert.match(card, /Aberto para plateia/);
    await h.db.query("UPDATE guests SET status='gravado' WHERE id=$1", [g2]);
    assert.doesNotMatch((await as.prod.get(`/convidados/${g2}`)).text, /Podcast com plateia/);
    assert.doesNotMatch((await anon.get('/plateia')).text, /Bruno Lima/, 'gravado não está mais na agenda');
    await h.db.query("UPDATE guests SET status='agendado' WHERE id=$1", [g2]);
    await as.prod.act(`/convidados/${g2}/plateia`, { enabled: ['0', '1'], status: 'disponivel' }, { from: `/convidados/${g2}` });
  });

  it('inscrição: valida, guarda UTMs, devolve o WhatsApp da produtora com a mensagem pronta e não duplica', async () => {
    let r = await json('/plateia/inscricao', { guest_id: g1, name: 'Maria', country: 'BR', phone: '(11) 91234-5678', terms: true });
    assert.equal(r.status, 400); assert.equal((await r.json()).field, 'name');
    r = await json('/plateia/inscricao', { guest_id: g1, name: 'Maria da Silva', country: 'BR', phone: '123' });
    assert.equal(r.status, 400); assert.equal((await r.json()).field, 'phone');
    assert.equal((await json('/plateia/inscricao', { guest_id: g3, name: 'Maria da Silva', country: 'BR', phone: '(11) 91234-5678', terms: true })).status, 404, 'fora da agenda');
    assert.equal((await json('/plateia/inscricao', { guest_id: g5, name: 'Maria da Silva', country: 'BR', phone: '(11) 91234-5678', terms: true })).status, 404, 'já passou');
    assert.equal((await q('SELECT 1 FROM plateia_leads')).length, 0);

    await as.gestao.act('/plateia/painel/ajustes', { active: '1', price: '197,00', duration: '1h30 a 2h', location: 'Estúdio do Pulso Podcast, Alphaville, SP', whatsapp: '+55 (11) 98888-7777' }, { from: '/plateia/painel' });
    const body = { guest_id: g1, name: 'Maria da Silva', country: 'BR', phone: '(11) 91234-5678', terms: true, visitor_id: 'visitante-123456', referrer: 'https://instagram.com/', landing: 'http://localhost/plateia?utm_source=instagram',
      utm: { utm_source: 'instagram', utm_medium: 'story', utm_campaign: 'plateia-out', fbclid: 'abc' } };
    r = await json('/plateia/inscricao', { ...body, terms: undefined });
    assert.equal(r.status, 400); assert.equal((await r.json()).field, 'terms', 'sem aceitar as condições não grava');
    assert.equal((await q('SELECT 1 FROM plateia_leads')).length, 0);
    r = await json('/plateia/inscricao', body);
    const j = await r.json();
    assert.equal(r.status, 200); assert.ok(j.ok && j.ref);
    const acc = await one('SELECT terms_accepted_at, terms_version FROM plateia_leads ORDER BY id DESC LIMIT 1');
    assert.ok(acc.terms_accepted_at && acc.terms_version, 'guarda quando e qual versão das condições foi aceita');
    const u = new URL(j.url);
    assert.equal(u.origin + u.pathname, 'https://wa.me/5511988887777');
    const msg = u.searchParams.get('text');
    assert.match(msg, /Meu nome é Maria da Silva/); assert.match(msg, /episódio com Dra\. Ana Souza/); assert.match(msg, /selecionada pela produção/); assert.match(msg, /às \d{1,2}h/);
    assert.match(msg, /R\$ 197 por participante/); assert.match(msg, /\+55 \(11\) 91234-5678/);
    const lead = await one('SELECT * FROM plateia_leads');
    assert.equal(lead.phone, '+5511912345678'); assert.equal(lead.guest_id, g1); assert.equal(lead.utm_source, 'instagram'); assert.equal(lead.utm_campaign, 'plateia-out');
    assert.equal(lead.fbclid, 'abc'); assert.equal(lead.status, 'novo'); assert.equal(lead.price_cents, 19700); assert.equal(lead.whatsapp_opened_at, null);
    // a mesma pessoa pedindo de novo não cria outra linha
    await json('/plateia/inscricao', body);
    assert.equal((await q('SELECT 1 FROM plateia_leads')).length, 1);
    // robô que preenche a isca não grava
    await json('/plateia/inscricao', { ...body, phone: '(21) 99999-0000', site: 'http://spam' });
    assert.equal((await q('SELECT 1 FROM plateia_leads')).length, 1);
    // vagas fechadas
    await h.db.query("UPDATE guests SET audience_status='lotado' WHERE id=$1", [g1]);
    assert.equal((await json('/plateia/inscricao', { ...body, phone: '(21) 99999-0000' })).status, 409);
    await h.db.query("UPDATE guests SET audience_status='disponivel' WHERE id=$1", [g1]);
  });

  it('eventos: visualização, cliques, formulário e abertura do WhatsApp (marca a inscrição)', async () => {
    const utm = { utm_source: 'instagram', utm_medium: 'story', utm_campaign: 'plateia-out' };
    for (const type of ['view', 'agenda_click', 'signup_click', 'form_open']) assert.equal((await json('/plateia/evento', { type, guest_id: g1, visitor_id: 'visitante-123456', utm })).status, 204);
    assert.equal((await json('/plateia/evento', { type: 'tipo-inventado', visitor_id: 'visitante-123456' })).status, 204);
    assert.equal((await json('/plateia/evento', { type: 'view', visitor_id: 'x' }, 'Googlebot/2.1')).status, 204, 'robô não conta');
    const types = (await q('SELECT type FROM plateia_events ORDER BY id')).map((r) => r.type);
    assert.ok(types.includes('lead'));
    assert.ok(types.includes('view') && types.includes('agenda_click') && types.includes('signup_click') && !types.includes('tipo-inventado'));
    assert.equal((await q("SELECT 1 FROM plateia_events WHERE type='view'")).length, 1);
    const lead = await one('SELECT ref FROM plateia_leads');
    await json('/plateia/evento', { type: 'whatsapp', ref: 'inexistente', visitor_id: 'visitante-123456' });
    assert.equal((await one("SELECT count(*)::int n FROM plateia_events WHERE type='whatsapp'")).n, 0);
    await json('/plateia/evento', { type: 'whatsapp', ref: lead.ref, visitor_id: 'visitante-123456', utm });
    assert.ok((await one('SELECT whatsapp_opened_at FROM plateia_leads')).whatsapp_opened_at);
    const r = await audience.results(30);
    assert.equal(r.views, 1); assert.equal(r.agendaClicks, 1); assert.equal(r.signupClicks, 1); assert.ok(r.leads >= 1); assert.equal(r.whatsapp, 1);
    const ig = r.perUtm.find((x) => x.source === 'instagram');
    assert.ok(ig && ig.views === 1 && ig.clicks === 1 && ig.leads >= 1);
    assert.ok(r.perGuest.find((x) => x.id === g1).clicks === 1);
  });

  it('painel: produtora atende, gestão ajusta, editor não entra; inscrições e CSV', async () => {
    assert.equal((await as.editor.get('/plateia/painel')).status, 403);
    assert.equal((await as.prod.get('/plateia/painel')).status, 200);
    const page = (await as.gestao.get('/plateia/painel')).text;
    assert.match(page, /Maria da Silva/); assert.match(page, /Novo pedido/); assert.match(page, /instagram \/ plateia-out/); assert.match(page, /https:\/\/wa\.me\/5511912345678/);
    assert.match(page, /id="modal-ajustes"/);
    assert.doesNotMatch((await as.prod.get('/plateia/painel')).text, /id="modal-ajustes"/, 'só a gestão mexe nos ajustes');
    assert.equal((await as.prod.act('/plateia/painel/ajustes', { price: '1', duration: 'x', location: 'y' }, { from: '/' })).status, 403);
    const lead = await one('SELECT id FROM plateia_leads');
    await as.prod.act(`/plateia/painel/leads/${lead.id}`, { status: 'em_atendimento' }, { from: '/plateia/painel' });
    assert.equal((await one('SELECT status FROM plateia_leads')).status, 'em_atendimento');
    await as.prod.act(`/plateia/painel/leads/${lead.id}`, { status: 'confirmado' }, { from: '/plateia/painel' });
    assert.equal((await one('SELECT status FROM plateia_leads')).status, 'em_atendimento', 'selecionar exige o valor combinado: só pela confirmação');
    await as.prod.act(`/plateia/painel/leads/${lead.id}`, { status: 'invalido' }, { from: '/plateia/painel' });
    assert.equal((await one('SELECT status FROM plateia_leads')).status, 'em_atendimento');
    const csv = await as.prod.get('/plateia/painel/inscricoes.csv');
    assert.equal(csv.status, 200); assert.match(csv.text, /Maria da Silva;5511912345678;/); assert.match(csv.text, /instagram/);
    assert.equal((await as.editor.get('/plateia/painel/inscricoes.csv')).status, 403);
    assert.match((await as.gestao.get('/')).text, /href="\/plateia\/painel"/);
    assert.doesNotMatch((await as.editor.get('/')).text, /href="\/plateia\/painel"/);
  });

  it('ajustes: valida preço, WhatsApp e IDs; pausar fecha a página; pixel só aparece quando informado', async () => {
    const send = (f) => as.gestao.act('/plateia/painel/ajustes', { active: '1', price: '197,00', duration: '1h30 a 2h', location: 'Estúdio', whatsapp: '5511988887777', ...f }, { from: '/plateia/painel' });
    for (const bad of [{ price: 'abc' }, { whatsapp: '123' }, { meta_pixel: 'abc' }, { ga4: 'UA-1' }, { duration: '' }]) {
      const before = (await h.db.query("SELECT value FROM app_settings WHERE key='plateia_price_cents'")).rows[0].value;
      await send(bad);
      assert.equal((await h.db.query("SELECT value FROM app_settings WHERE key='plateia_price_cents'")).rows[0].value, before);
    }
    let r = await anon.get('/plateia');
    assert.doesNotMatch(r.headers.get('content-security-policy'), /facebook|googletagmanager/);
    await send({ price: '250,00', meta_pixel: '1234567890123', ga4: 'g-abc123xyz9' });
    r = await anon.get('/plateia');
    assert.match(r.text, /R\$ 250/); assert.match(r.text, /data-meta-pixel="1234567890123"/); assert.match(r.text, /data-ga4="G-ABC123XYZ9"/);
    assert.match(r.headers.get('content-security-policy'), /connect\.facebook\.net/); assert.match(r.headers.get('content-security-policy'), /googletagmanager\.com/);
    await as.gestao.act('/plateia/painel/ajustes', { price: '197,00', duration: '1h30 a 2h', location: 'Estúdio', whatsapp: '5511988887777' }, { from: '/plateia/painel' }); // sem "active": pausa
    r = await anon.get('/plateia');
    assert.match(r.text, /Novas datas serão divulgadas em breve/); assert.doesNotMatch(r.text, /Dra\. Ana Souza/);
    assert.equal((await json('/plateia/inscricao', { guest_id: g1, name: 'Maria da Silva', country: 'BR', phone: '(11) 91234-5678', terms: true })).status, 403);
    await send({});
    assert.match((await anon.get('/plateia')).text, /Dra\. Ana Souza/);
  });

  it('fotos: só imagem de verdade; a foto do convidado só é pública enquanto ele está na agenda', async () => {
    assert.equal((await upload(as.prod, `/convidados/${g1}/foto`, Buffer.from('<script>alert(1)</script>'.repeat(10)), 'image/png')).status, 400);
    assert.equal((await upload(as.editor, `/convidados/${g1}/foto`, PNG)).status, 403);
    assert.equal((await upload(as.prod, `/convidados/${g1}/foto`, PNG)).status, 200);
    assert.ok((await one('SELECT photo_key FROM guests WHERE id=$1', [g1])).photo_key);
    let r = await anon.get(`/plateia/foto/${g1}`);
    assert.equal(r.status, 200);
    assert.match((await anon.get('/plateia')).text, new RegExp(`/plateia/foto/${g1}`));
    assert.equal((await as.prod.get(`/convidados/${g1}/foto`)).status, 200);
    assert.equal((await anon.get(`/convidados/${g1}/foto`)).status, 302, 'a rota interna exige login');
    await h.db.query('UPDATE guests SET audience_enabled=false WHERE id=$1', [g1]);
    assert.equal((await anon.get(`/plateia/foto/${g1}`)).status, 404, 'saiu da agenda: foto não é mais pública');
    await h.db.query('UPDATE guests SET audience_enabled=true WHERE id=$1', [g1]);
    assert.equal((await upload(as.prod, '/plateia/painel/imagem/hero', PNG)).status, 403, 'imagens da página são da gestão');
    assert.equal((await upload(as.gestao, '/plateia/painel/imagem/hero', PNG)).status, 200);
    assert.equal((await anon.get('/plateia/imagem/hero')).status, 200);
    assert.equal((await anon.get('/plateia/imagem/outra')).status, 404);
    assert.match((await anon.get('/plateia')).text, /plateia\/imagem\/hero/);
  });

  it('a plateia é escolhida: o pedido avisa a equipe uma única vez e a produção marca selecionado ou não', async () => {
    const lead = await one('SELECT id, name FROM plateia_leads ORDER BY id LIMIT 1');
    const notes = await q("SELECT user_id, title FROM notifications WHERE type='plateia'");
    assert.ok(notes.length >= 1 && /Nova inscrição na plateia: Maria da Silva/.test(notes[0].title));
    const before = notes.length;
    await json('/plateia/inscricao', { guest_id: g1, name: 'Maria da Silva', country: 'BR', phone: '(11) 91234-5678', terms: true });
    assert.equal((await q("SELECT 1 FROM notifications WHERE type='plateia'")).length, before, 'pedido repetido não avisa de novo');
    await as.prod.act(`/plateia/painel/leads/${lead.id}`, { status: 'nao_selecionado' }, { from: '/plateia/painel' });
    assert.equal((await one('SELECT status FROM plateia_leads WHERE id=$1', [lead.id])).status, 'nao_selecionado');
    assert.match((await as.prod.get('/plateia/painel')).text, /Não selecionado/);
    await as.prod.act(`/plateia/painel/leads/${lead.id}`, { status: 'em_atendimento' }, { from: '/plateia/painel' });
  });

  it('confirmar participação: valor combinado vira conta a receber; recebimento, desfazer e mudar de situação', async () => {
    const lead = await one('SELECT id FROM plateia_leads ORDER BY id LIMIT 1');
    const post = (path, f) => as.prod.act(`/plateia/painel/leads/${lead.id}${path}`, f, { from: '/plateia/painel' });
    await post('/confirmar', { amount: 'abc', due_on: '2026-11-01' });
    assert.equal((await one('SELECT status FROM plateia_leads WHERE id=$1', [lead.id])).status, 'em_atendimento', 'valor inválido não confirma');
    await post('/confirmar', { amount: '150,00', paid: '0', due_on: '2026-11-05' });
    let l = await one('SELECT * FROM plateia_leads WHERE id=$1', [lead.id]);
    assert.equal(l.status, 'confirmado'); assert.equal(Number(l.amount_cents), 15000); assert.ok(l.confirmed_at && l.entry_id);
    let e = await one('SELECT * FROM fin_entries WHERE id=$1', [l.entry_id]);
    assert.equal(e.direction, 'entrada'); assert.equal(e.category, 'plateia'); assert.equal(Number(e.amount_cents), 15000); assert.equal(e.status, 'previsto'); assert.equal(e.source, 'plateia'); assert.equal(e.guest_id, g1);
    assert.match(e.description, /Maria da Silva/);
    // o valor pode ser ajustado enquanto não recebeu (a conta não duplica)
    await post('/confirmar', { amount: '197,00', paid: '0', due_on: '2026-11-06' });
    assert.equal((await q("SELECT 1 FROM fin_entries WHERE category='plateia'")).length, 1);
    assert.equal(Number((await one('SELECT amount_cents FROM fin_entries WHERE id=$1', [l.entry_id])).amount_cents), 19700);
    let page = (await as.prod.get('/plateia/painel')).text;
    assert.match(page, /Selecionado/); assert.match(page, /Recebi o pagamento/); assert.match(page, /a receber até/);
    assert.match((await as.gestao.get('/financeiro/lancamentos?escopo=receber')).text, /Plateia · Maria da Silva/, 'aparece nas contas a receber da gestão');
    // recebeu
    await post('/recebido', { paid_on: '2026-11-04' });
    e = await one('SELECT * FROM fin_entries WHERE id=$1', [l.entry_id]);
    assert.equal(e.status, 'pago'); assert.equal(fin_iso(e.paid_on), '2026-11-04');
    assert.match((await as.prod.get('/plateia/painel')).text, /recebido/);
    // pago: não deixa mudar o valor por baixo
    await post('/confirmar', { amount: '300,00', due_on: '2026-11-06' });
    assert.equal(Number((await one('SELECT amount_cents FROM fin_entries WHERE id=$1', [l.entry_id])).amount_cents), 19700);
    // desistiu depois de pagar: o dinheiro recebido continua nas contas
    await post('', { status: 'desistiu' });
    assert.equal((await one('SELECT status FROM fin_entries WHERE id=$1', [l.entry_id])).status, 'pago');
    // outra pessoa, ainda sem pagar: mudar a situação cancela a conta
    const r = await (await json('/plateia/inscricao', { guest_id: g1, name: 'João Pereira Neto', country: 'BR', phone: '(21) 98765-4321', terms: true })).json();
    const l2 = await one('SELECT id FROM plateia_leads WHERE ref=$1', [r.ref]);
    await as.prod.act(`/plateia/painel/leads/${l2.id}/confirmar`, { amount: '197,00', paid: '1', paid_on: '2026-11-02' }, { from: '/plateia/painel' });
    const e2 = await one("SELECT * FROM fin_entries WHERE auto_key=$1", [`plateia-lead-${l2.id}`]);
    assert.equal(e2.status, 'pago', 'já recebeu na hora de confirmar');
    await as.prod.act(`/plateia/painel/leads/${l2.id}/recebido`, { desfazer: '1' }, { from: '/plateia/painel' });
    assert.equal((await one('SELECT status FROM fin_entries WHERE id=$1', [e2.id])).status, 'previsto');
    await as.prod.act(`/plateia/painel/leads/${l2.id}`, { status: 'nao_selecionado' }, { from: '/plateia/painel' });
    assert.equal((await one('SELECT status FROM fin_entries WHERE id=$1', [e2.id])).status, 'cancelado');
    assert.equal((await as.editor.act(`/plateia/painel/leads/${l2.id}/confirmar`, { amount: '1' }, { from: '/' })).status, 403);
    const csv = (await as.prod.get('/plateia/painel/inscricoes.csv')).text;
    assert.match(csv, /Valor combinado/); assert.match(csv, /197,00/);
  });

  it('isentar: participa sem cobrança, não cria conta e cancela a que estava prevista', async () => {
    const r = await (await json('/plateia/inscricao', { guest_id: g1, name: 'Ana Souza Lima', country: 'BR', phone: '(31) 98888-1111', terms: true })).json();
    const l = await one('SELECT id FROM plateia_leads WHERE ref=$1', [r.ref]);
    const post = (f) => as.prod.act(`/plateia/painel/leads/${l.id}/confirmar`, f, { from: '/plateia/painel' });
    await post({ amount: '197,00', paid: '0', due_on: '2026-11-05' });
    const entry = await one('SELECT id FROM fin_entries WHERE auto_key=$1', [`plateia-lead-${l.id}`]);
    await post({ paid: 'isento' });
    const row = await one('SELECT status, amount_cents, entry_id FROM plateia_leads WHERE id=$1', [l.id]);
    assert.equal(row.status, 'confirmado'); assert.equal(Number(row.amount_cents), 0); assert.equal(row.entry_id, null);
    assert.equal((await one('SELECT status FROM fin_entries WHERE id=$1', [entry.id])).status, 'cancelado', 'a conta prevista some');
    assert.match((await as.prod.get('/plateia/painel')).text, /isento/);
  });
});
