const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const config = require('../src/config');
const ip = require('../src/services/infinitePay');

// InfinitePay de mentira: guarda os links criados e responde ao payment_check conforme o teste decidir.
function fakeInfinitePay() {
  const links = []; const checks = []; let paid = true;
  const real = global.fetch;
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (!u.startsWith('https://api.checkout.infinitepay.io')) return real(url, opts);
    const body = JSON.parse(opts.body);
    if (u.endsWith('/links')) { links.push(body); return reply(200, { url: `https://checkout.infinitepay.io/pulso?lenc=${body.order_nsu}` }); }
    if (u.endsWith('/payment_check')) { checks.push(body); return reply(200, { success: true, paid, amount: 19700, paid_amount: 19910, installments: 3, capture_method: 'credit_card' }); }
    return reply(404, {});
  };
  return { links, checks, setPaid: (v) => { paid = v; }, restore: () => { global.fetch = real; } };
}

describe('InfinitePay: link de pagamento da plateia e confirmação por webhook', () => {
  let app; let fake; let prod; let leadId; let anon; const q = (sql, p) => h.db.query(sql, p);
  const webhook = (secret, body) => anon.post(`/webhooks/infinitepay/${secret}`, body);

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    fake = fakeInfinitePay();
    await h.createUser({ name: 'Paula Produtora', email: 'p@t.com', role: 'produtora' });
    prod = h.client(app.base); await prod.login('p@t.com'); anon = h.client(app.base);
    const { rows: [g] } = await q("INSERT INTO guests (name, profile, status, proposed_at) VALUES ('Dr. Convidado', 'medico', 'agendado', now() + interval '10 days') RETURNING id");
    ({ rows: [{ id: leadId }] } = await q(`INSERT INTO plateia_leads (ref, guest_id, guest_name, recording_at, name, phone, country, price_cents) VALUES ('ref1', $1, 'Dr. Convidado', now() + interval '10 days', 'Maria da Silva', '+5511912345678', 'BR', 19700) RETURNING id`, [g.id]));
  });
  after(async () => { fake.restore(); config.infinitepay.handle = ''; config.infinitepayConfigured = false; await app.close(); await h.db.close(); });
  const setStatus = (status) => prod.act(`/plateia/painel/leads/${leadId}`, { status }, { from: '/plateia/painel' });

  it('sem handle configurado: nada é gerado e o webhook não existe', async () => {
    await setStatus('em_atendimento');
    assert.equal((await q('SELECT 1 FROM plateia_pay_links')).rowCount, 0);
    assert.equal((await webhook('qualquer', { order_nsu: 'x', transaction_nsu: 'y' })).status, 404);
    await setStatus('novo');
  });

  it('Em avaliação gera o link com o valor da página; o valor pode ser alterado (link novo)', async () => {
    config.infinitepay.handle = 'pulso-teste'; config.infinitepayConfigured = true;
    await setStatus('em_atendimento');
    assert.equal(fake.links.length, 1);
    const b = fake.links[0];
    assert.equal(b.handle, 'pulso-teste'); assert.deepEqual(b.items.map((i) => [i.quantity, i.price]), [[1, 19700]]);
    assert.match(b.order_nsu, new RegExp(`^pl${leadId}-[0-9a-f]{10}$`)); assert.match(b.webhook_url, /\/webhooks\/infinitepay\/[0-9a-f]{32}$/);
    assert.match(b.redirect_url, /\/plateia\/pagamento-concluido$/); assert.equal(b.customer, undefined, 'sem dados da pessoa: o checkout não pede confirmar o telefone dela'); assert.equal(b.address, undefined);
    const page = (await prod.get('/plateia/painel')).text;
    assert.match(page, /Link de pagamento/); assert.match(page, /checkout\.infinitepay\.io\/pulso\?lenc=/); assert.match(page, /Enviar pelo WhatsApp/);

    await setStatus('em_atendimento'); assert.equal(fake.links.length, 1, 'não duplica o link');
    const r = await prod.act(`/plateia/painel/leads/${leadId}/link`, { amount: '150,00' }, { from: '/plateia/painel' });
    assert.equal(r.status, 302); assert.equal(fake.links.length, 2); assert.equal(fake.links[1].items[0].price, 15000);
    const rows = (await q('SELECT amount_cents, status FROM plateia_pay_links ORDER BY id')).rows.map((x) => [Number(x.amount_cents), x.status]);
    assert.deepEqual(rows, [[19700, 'substituido'], [15000, 'aberto']]);
    await prod.act(`/plateia/painel/leads/${leadId}/link`, { amount: 'abc' }, { from: '/plateia/painel' });
    assert.equal(fake.links.length, 2, 'valor inválido não cria link');
  });

  it('webhook: segredo errado, pedido desconhecido, pagamento não confirmado e o pagamento valendo', async () => {
    const url = new URL(ip.webhookUrl()); const secret = url.pathname.split('/').pop();
    assert.equal((await webhook('errado', { order_nsu: 'x', transaction_nsu: 'y' })).status, 404);
    assert.equal((await webhook(secret, { invoice_slug: 'a' })).status, 400, 'faltam campos');
    const unk = await webhook(secret, { order_nsu: 'nao-existe', transaction_nsu: 't0', invoice_slug: 's0' });
    assert.equal(unk.status, 200); assert.equal(fake.checks.length, 0, 'pedido desconhecido não consulta a API');

    const link = (await q("SELECT * FROM plateia_pay_links WHERE status = 'aberto'")).rows[0];
    fake.setPaid(false);
    assert.equal((await webhook(secret, { order_nsu: link.order_nsu, transaction_nsu: 'T1', invoice_slug: 'S1', amount: 15000 })).status, 400, 'a InfinitePay não confirma: tenta de novo');
    assert.equal((await q("SELECT status FROM plateia_leads WHERE id = $1", [leadId])).rows[0].status, 'em_atendimento');

    fake.setPaid(true);
    const ok = await webhook(secret, { order_nsu: link.order_nsu, transaction_nsu: 'T1', invoice_slug: 'S1', amount: 15000, paid_amount: 15110, capture_method: 'credit_card', installments: 3, receipt_url: 'https://comprovante.exemplo/1' });
    assert.equal(ok.status, 200);
    assert.deepEqual(fake.checks.at(-1), { handle: 'pulso-teste', order_nsu: link.order_nsu, transaction_nsu: 'T1', slug: 'S1' });
    const lead = (await q('SELECT status, amount_cents, entry_id FROM plateia_leads WHERE id = $1', [leadId])).rows[0];
    assert.equal(lead.status, 'confirmado'); assert.equal(Number(lead.amount_cents), 19700, 'vale o "amount" que a InfinitePay confirmou');
    const entry = (await q('SELECT status, direction, amount_cents, paid_on FROM fin_entries WHERE id = $1', [lead.entry_id])).rows[0];
    assert.deepEqual([entry.status, entry.direction, Number(entry.amount_cents)], ['pago', 'entrada', 19700]); assert.ok(entry.paid_on);
    const paidLink = (await q('SELECT status, transaction_nsu, capture_method, installments FROM plateia_pay_links WHERE id = $1', [link.id])).rows[0];
    assert.deepEqual(Object.values(paidLink), ['pago', 'T1', 'credit_card', 3]);
    assert.ok((await q("SELECT 1 FROM notifications WHERE title LIKE 'Pagamento recebido: Maria da Silva%'")).rowCount >= 1);

    const again = await webhook(secret, { order_nsu: link.order_nsu, transaction_nsu: 'T1', invoice_slug: 'S1' });
    assert.equal(again.status, 200); assert.equal((await q("SELECT 1 FROM fin_entries WHERE source = 'plateia'")).rowCount, 1, 'reenvio da InfinitePay não duplica');
    assert.match((await prod.get('/plateia/painel')).text, /InfinitePay · cartão 3x/);
    assert.equal((await prod.act(`/plateia/painel/leads/${leadId}/link`, { amount: '100' }, { from: '/plateia/painel' })).status, 302);
    assert.equal(fake.links.length, 2, 'já pago: não gera outro link');
  });

  it('a página de pagamento concluído e a tela de integrações', async () => {
    const t = await anon.get('/plateia/pagamento-concluido');
    assert.equal(t.status, 200); assert.match(t.text, /Pagamento recebido/);
    await h.createUser({ name: 'Ana Admin', email: 'adm@t.com', role: 'superadmin' });
    const admin = h.client(app.base); await admin.login('adm@t.com');
    const page = (await admin.get('/integracoes')).text;
    assert.match(page, /InfinitePay/); assert.match(page, /\$pulso-teste/); assert.match(page, /Gerar link de teste/);
    assert.doesNotMatch(page, new RegExp(ip.webhookUrl().split('/').pop()), 'o segredo do webhook não aparece na tela');
  });
});
