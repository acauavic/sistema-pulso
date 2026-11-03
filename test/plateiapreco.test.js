const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('Plateia: valor geral e valor por gravação', () => {
  const as = {}; let app; let anon; let g; let other;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const one = (sql, p) => q(sql, p).then((r) => r[0]);
  const days = (n) => new Date(Date.now() + n * 86400_000).toISOString();
  const mk = async (name) => (await one("INSERT INTO guests (name, status, proposed_at, audience_enabled, scheduled_studio, scheduled_hosts, scheduled_guest) VALUES ($1, 'agendado', $2, true, true, true, true) RETURNING id", [name, days(10)])).id;
  const signup = (guestId, phone) => fetch(`${app.base}/plateia/inscricao`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (test)' },
    body: JSON.stringify({ guest_id: guestId, name: 'Pessoa Teste', phone, country: 'BR', terms: true }) }).then((r) => r.json());

  before(async () => {
    await h.resetDb(); app = await h.startServer(); anon = h.client(app.base);
    for (const [k, role] of [['gestao', 'gestao'], ['editor', 'editor_video']]) { await h.createUser({ name: k, email: `${k}@pp.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@pp.com`); }
    await q("INSERT INTO app_settings (key, value) VALUES ('plateia_active', 'true'), ('plateia_price_cents', '19700') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");
    g = await mk('Mari Vabo'); other = await mk('Outro Convidado');
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('sem valor próprio, tudo usa o valor geral (e a agenda não mostra valor por cartão)', async () => {
    const page = (await anon.get('/plateia')).text;
    assert.match(page, /<dd>R\$ 197 <span>por participante selecionado/);
    assert.doesNotMatch(page, /a partir de/);
    assert.match((await as.gestao.get(`/convidados/${g}`)).text, /valor geral/);
  });

  it('a equipe define o valor de uma gravação; a página, o pedido e a mensagem usam esse valor', async () => {
    assert.equal((await as.editor.act(`/convidados/${g}/plateia/preco`, { price: '297,00' }, { from: '/' })).status, 403);
    assert.match((await as.gestao.act(`/convidados/${g}/plateia/preco`, { price: 'abc' }, { from: `/convidados/${g}` })).location, /#plateia/);
    assert.equal((await one('SELECT audience_price_cents FROM guests WHERE id = $1', [g])).audience_price_cents, null, 'valor inválido não salva');

    await as.gestao.act(`/convidados/${g}/plateia/preco`, { price: '297,00' }, { from: `/convidados/${g}` });
    assert.equal(Number((await one('SELECT audience_price_cents FROM guests WHERE id = $1', [g])).audience_price_cents), 29700);
    const card = (await as.gestao.get(`/convidados/${g}`)).text;
    assert.match(card, /R\$ 297<\/span> <span class="small muted">só desta gravação/);

    const page = (await anon.get('/plateia')).text;
    assert.match(page, /a partir de R\$ 197/, 'resumo da página: a partir do menor');
    assert.match(page, new RegExp(`data-signup="${g}"[^>]*data-price="R\\$ 297"`));
    assert.match(page, new RegExp(`data-signup="${other}"[^>]*data-price="R\\$ 197"`));
    assert.match(page, /O valor depende da gravação/);

    const r = await signup(g, '(11) 98765-4321');
    assert.equal(r.price, 'R$ 297');
    const lead = await one('SELECT price_cents FROM plateia_leads WHERE guest_id = $1', [g]);
    assert.equal(Number(lead.price_cents), 29700);
    assert.match(require('../src/services/audience').whatsappMessage({ name: 'X', guestName: 'Mari', date: 'd', time: 't', priceCents: 29700, phoneDisplay: 'p' }), /R\$ 297 por participante/);
    const r2 = await signup(other, '(11) 98765-1111');
    assert.equal(r2.price, 'R$ 197');
    assert.equal(require('../src/services/audience').money(19750), 'R$ 197,50', 'centavos aparecem (não arredonda)');
  });

  it('pessoa adicionada à mão entra com o valor da gravação; vazio volta ao valor geral', async () => {
    await as.gestao.act('/plateia/painel/leads', { guest_id: String(g), name: 'Ana Manual', country: 'BR', phone: '(11) 91111-2222' }, { from: '/plateia/painel' });
    assert.equal(Number((await one("SELECT price_cents FROM plateia_leads WHERE name = 'Ana Manual'")).price_cents), 29700);
    await as.gestao.act(`/convidados/${g}/plateia/preco`, { price: '' }, { from: `/convidados/${g}` });
    assert.equal((await one('SELECT audience_price_cents FROM guests WHERE id = $1', [g])).audience_price_cents, null);
    assert.doesNotMatch((await anon.get('/plateia')).text, /a partir de/);
  });
});
