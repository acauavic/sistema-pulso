// InfinitePay (checkout): gera o link de pagamento de quem a produtora coloca em "Em avaliação" e confirma o pagamento por webhook.
// Documentação: https://www.infinitepay.io/checkout-documentacao. A API não tem chave: o link é criado com o handle (InfiniteTag) e o
// webhook não é assinado. Por isso o endereço do webhook leva um segredo e, antes de aceitar um pagamento, o sistema pergunta à
// InfinitePay (payment_check) se ele existe de fato. O valor em centavos é o mesmo do sistema.
const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config');
const audience = require('./audience');

const API = 'https://api.checkout.infinitepay.io';
const dateShort = (d) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(new Date(d));

const secret = () => config.infinitepay.webhookSecret
  || crypto.createHmac('sha256', config.sessionSecret || 'dev').update('infinitepay-webhook').digest('hex').slice(0, 32);
const webhookUrl = () => `${config.appBaseUrl}/webhooks/infinitepay/${secret()}`;
const secretOk = (given) => { const a = Buffer.from(String(given || '')); const b = Buffer.from(secret()); return a.length === b.length && crypto.timingSafeEqual(a, b); };

async function post(path, body) {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

// O link vem em algum campo da resposta (a documentação não mostra qual): procura o endereço https de checkout.
function extractUrl(json) {
  for (const k of ['url', 'link', 'checkout_url', 'payment_url', 'checkoutUrl', 'invoice_url']) if (typeof json[k] === 'string' && /^https:\/\//.test(json[k])) return json[k];
  const scan = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 3) return null;
    for (const v of Object.values(o)) {
      if (typeof v === 'string' && /^https:\/\/[^\s]*infinitepay[^\s]*/i.test(v)) return v;
      const r = typeof v === 'object' ? scan(v, depth + 1) : null; if (r) return r;
    }
    return null;
  };
  return scan(json);
}

// Cria o link na InfinitePay e guarda. O anterior ainda aberto vira "substituído" (mas continua valendo se alguém pagar por ele).
async function createLink({ lead, amountCents, userId = null, description }) {
  if (!config.infinitepayConfigured) throw new Error('InfinitePay não configurada (INFINITEPAY_HANDLE).');
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Informe um valor maior que zero.');
  const orderNsu = `pl${lead.id}-${crypto.randomBytes(5).toString('hex')}`;
  const body = {
    handle: config.infinitepay.handle, order_nsu: orderNsu,
    items: [{ quantity: 1, price: amountCents, description: description || `Plateia Pulso Podcast: ${lead.guest_name}${lead.recording_at ? ` (${dateShort(lead.recording_at)})` : ''}` }],
    redirect_url: `${config.appBaseUrl}/plateia/pagamento-concluido`, webhook_url: webhookUrl(),
    // Sem `customer` de propósito: com o telefone preenchido o checkout pede confirmar o número por WhatsApp/SMS, e quem paga nem sempre é
    // quem se inscreveu. Sem ele, a pessoa informa o próprio contato. O pedido é identificado pelo order_nsu, não pelos dados dela.
  };
  const r = await post('/links', body);
  if (!r.ok || r.json.success === false) throw new Error(r.json.message || `a InfinitePay respondeu HTTP ${r.status}`);
  const url = extractUrl(r.json);
  if (!url) throw new Error(`a InfinitePay não devolveu o endereço do link (campos: ${Object.keys(r.json).join(', ') || 'nenhum'})`);
  await db.query("UPDATE plateia_pay_links SET status = 'substituido' WHERE lead_id = $1 AND status = 'aberto'", [lead.id]);
  const { rows: [row] } = await db.query(
    'INSERT INTO plateia_pay_links (lead_id, order_nsu, amount_cents, url, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *', [lead.id, orderNsu, amountCents, url, userId]);
  return row;
}

// Valor padrão do link: o combinado no pedido ou o investimento da página.
const defaultAmount = async (lead) => Number(lead.amount_cents) > 0 ? Number(lead.amount_cents) : Number(lead.price_cents) || (await audience.settings()).priceCents;

const currentLink = async (leadId) => (await db.query("SELECT * FROM plateia_pay_links WHERE lead_id = $1 AND status <> 'pago' ORDER BY id DESC LIMIT 1", [leadId])).rows[0] || null;

// Webhook: { status, body } para a rota responder. 200 = recebido (ou não é nosso); 400 = a InfinitePay tenta de novo.
async function handleWebhook(payload) {
  const p = payload || {};
  const orderNsu = String(p.order_nsu || ''); const txn = String(p.transaction_nsu || ''); const slug = String(p.invoice_slug || '');
  if (!orderNsu || !txn) return { status: 400, body: { ok: false, error: 'order_nsu e transaction_nsu são obrigatórios' } };
  const { rows: [link] } = await db.query('SELECT * FROM plateia_pay_links WHERE order_nsu = $1', [orderNsu]);
  if (!link) return { status: 200, body: { ok: true, ignored: 'pedido desconhecido' } };
  if (link.status === 'pago') return { status: 200, body: { ok: true, duplicate: true } };

  let check;
  try { check = await post('/payment_check', { handle: config.infinitepay.handle, order_nsu: orderNsu, transaction_nsu: txn, slug }); } catch (err) { return { status: 400, body: { ok: false, error: 'não consegui conferir o pagamento agora' } }; }
  if (!check.ok || !check.json.paid) return { status: 400, body: { ok: false, error: 'pagamento não confirmado pela InfinitePay' } };

  const paid = Number(check.json.paid_amount ?? p.paid_amount ?? check.json.amount) || null;
  const amount = Number(check.json.amount ?? p.amount) || link.amount_cents;
  const upd = await db.query(
    `UPDATE plateia_pay_links SET status = 'pago', paid_at = now(), transaction_nsu = $2, invoice_slug = $3, paid_amount_cents = $4, capture_method = $5, installments = $6, receipt_url = $7
      WHERE id = $1 AND status <> 'pago' RETURNING id`,
    [link.id, txn, slug || null, paid, check.json.capture_method || p.capture_method || null, check.json.installments || p.installments || null, typeof p.receipt_url === 'string' ? p.receipt_url.slice(0, 500) : null]);
  if (!upd.rows.length) return { status: 200, body: { ok: true, duplicate: true } };

  const { rows: [lead] } = await db.query('SELECT * FROM plateia_leads WHERE id = $1', [link.lead_id]);
  let note = '';
  if (lead) {
    const today = require('./finance').todayISO();
    if (lead.entry_id && (await db.query("SELECT 1 FROM fin_entries WHERE id = $1 AND status = 'pago'", [lead.entry_id])).rowCount) {
      note = ' (já havia um pagamento recebido: conferir se foi em duplicidade)';
    } else {
      const r = await audience.confirmLead(lead, { amountCents: amount, dueOn: today, paidOn: today }, null);
      if (r.error) note = ` (${r.error})`;
    }
    await require('./notify').notify({
      type: 'plateia', broadcast: true, title: `Pagamento recebido: ${lead.name}`,
      body: `${lead.guest_name} · ${(amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} pelo link da InfinitePay${note}`,
      url: `/plateia/painel?convidado=${lead.guest_id || ''}`, dedupe: `plateia-pago-${link.id}`,
    }).catch((err) => console.error('aviso do pagamento:', err.message));
  }
  return { status: 200, body: { ok: true } };
}

module.exports = { createLink, defaultAmount, currentLink, handleWebhook, webhookUrl, secretOk, extractUrl };
