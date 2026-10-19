// Pulso Podcast com Plateia — lado interno: inscrições, resultados, ajustes da página e controles no card do convidado.
const express = require('express');
const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config');
const audience = require('../services/audience');
const infinitePay = require('../services/infinitePay');
const settingsSvc = require('../services/settings');
const b2 = require('../services/b2');
const { audit } = require('../services/audit');
const { requirePerm } = require('../middleware');
const { can } = require('../permissions');
const { clean, parseBRL, parseInputDate, formatBRL } = require('../utils/format');
const { wrap, isIntId } = require('../utils/wrap');

const router = express.Router();
const MAX_IMG = 5 * 1024 * 1024;
const STATUS = { novo: 'Novo pedido', em_atendimento: 'Em avaliação', confirmado: 'Selecionado', nao_selecionado: 'Não selecionado', desistiu: 'Desistiu' };
const GUEST_STATUS = { disponivel: 'Disponível', lotado: 'Lotado', encerrado: 'Encerrado' };

// Só imagens de verdade: o tipo vem dos primeiros bytes, não do que o navegador diz.
function imageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 100) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: 'png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}

async function storeImage(prefix, id, buf, kind) {
  const img = imageType(buf);
  if (!img) return null;
  const key = await b2.keyFor(prefix, id, `${kind}-${crypto.randomBytes(8).toString('hex')}.${img.ext}`);
  await b2.putObject(key, buf, img.type);
  return key;
}

// ---------------------------------------------------------------- painel
router.get('/plateia/painel', requirePerm('audience.read'), wrap(async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.dias)) ? Number(req.query.dias) : 30;
  const guestFilter = isIntId(String(req.query.convidado || '')) ? Number(req.query.convidado) : null;
  const view = req.query.vista === 'quadro' ? 'quadro' : 'lista';
  const statusFilter = view === 'lista' && STATUS[req.query.status] ? req.query.status : ''; // no quadro, cada coluna já é uma situação
  const q = clean(req.query.q, 80) || '';
  const origin = ['equipe', 'pagina'].includes(req.query.origem) ? req.query.origem : '';
  const where = []; const p = [];
  if (guestFilter) { p.push(guestFilter); where.push(`l.guest_id = $${p.length}`); }
  if (statusFilter) { p.push(statusFilter); where.push(`l.status = $${p.length}`); }
  if (origin) where.push(origin === 'equipe' ? 'l.added_by IS NOT NULL' : 'l.added_by IS NULL');
  if (q) { // nome da pessoa, do convidado ou parte do WhatsApp
    p.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); const like = `$${p.length}`;
    const digits = q.replace(/\D/g, '');
    let phone = '';
    if (digits.length >= 3) { p.push(`%${digits}%`); phone = ` OR regexp_replace(l.phone, '\\D', '', 'g') LIKE $${p.length}`; }
    where.push(`(l.name ILIKE ${like} OR l.guest_name ILIKE ${like}${phone})`);
  }
  const [leads, results, s, upcoming, agenda] = await Promise.all([
    db.query(`SELECT l.*, e.status AS pay_status, e.due_on AS pay_due, e.paid_on AS pay_paid, k.url AS link_url, k.amount_cents AS link_amount, k.status AS link_status, k.capture_method AS link_method, k.installments AS link_installments
       FROM plateia_leads l LEFT JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'cancelado'
       LEFT JOIN LATERAL (SELECT * FROM plateia_pay_links WHERE lead_id = l.id ORDER BY (status = 'pago') DESC, id DESC LIMIT 1) k ON true ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY l.created_at DESC LIMIT 300`, p),
    audience.results(days), audience.settings(),
    db.query("SELECT id, name, proposed_at FROM guests WHERE id IN (SELECT guest_id FROM plateia_leads WHERE guest_id IS NOT NULL) ORDER BY proposed_at DESC NULLS LAST LIMIT 60"),
    audience.agenda(),
  ]);
  const { rows: [counts] } = await db.query("SELECT count(*) FILTER (WHERE status = 'novo')::int AS novos, count(*)::int AS total FROM plateia_leads");
  const { rows: recordings } = await db.query("SELECT id, name, proposed_at FROM guests WHERE status = 'agendado' AND proposed_at IS NOT NULL AND proposed_at > now() - interval '1 day' ORDER BY proposed_at, id");
  res.render('plateia/admin', {
    title: 'Plateia', view, q, origin, recordings, countries: audience.COUNTRIES, leads: leads.rows, results, s, days, guests: upcoming.rows, agenda, guestFilter, statusFilter, STATUS, counts, price: audience.money(s.priceCents),
    canManage: can(req.user.role, 'audience.manage'), storageReady: config.storageConfigured, publicUrl: `${config.appBaseUrl}/plateia`, fmtMoney: formatBRL, payLinks: config.infinitepayConfigured, canMove: true, isExempt: (l) => l.status === 'confirmado' && l.amount_cents != null && Number(l.amount_cents) === 0 && !l.entry_id,
  });
}));

const flashBack = (req) => (/^\/plateia\/painel[?=&a-z_0-9]*$/.test(String(req.body.voltar || '')) ? req.body.voltar : '/plateia/painel');
const findLead = async (id) => (isIntId(id) ? (await db.query('SELECT * FROM plateia_leads WHERE id = $1', [id])).rows[0] : null);

// Muda a situação do pedido e cuida do que vem junto (link de pagamento ao avaliar, conta a receber ao deixar de selecionar).
// Devolve { reload }: true quando houve um aviso que a pessoa precisa ver (o quadro recarrega para mostrar).
async function applyStatus(req, lead, status) {
  let reload = false;
  await db.query('UPDATE plateia_leads SET status = $2, updated_at = now() WHERE id = $1', [lead.id, status]);
  if (status === 'em_atendimento' && config.infinitepayConfigured && !(await infinitePay.currentLink(lead.id)) && lead.status !== 'confirmado') { // em avaliação: já nasce o link de pagamento
    reload = true;
    try {
      const link = await infinitePay.createLink({ lead, amountCents: await infinitePay.defaultAmount(lead), userId: req.user.id });
      await audit(req, 'plateia.link_criado', 'plateia_lead', lead.id, { valor: Number(link.amount_cents) });
      await req.flash('ok', `Em avaliação. O link de pagamento de ${formatBRL(link.amount_cents)} está em "Link de pagamento" no pedido.`);
    } catch (err) { await req.flash('error', `Situação atualizada, mas não consegui gerar o link de pagamento: ${err.message}`); }
  }
  if (lead.status === 'confirmado') {
    reload = true;
    const r = await audience.releaseLead(lead);
    await req.flash('ok', r.kept ? 'Situação atualizada. O pagamento já recebido continua nas contas do financeiro.' : 'Situação atualizada e a conta a receber foi cancelada.');
  }
  return { reload };
}

// Muda a situação do pedido (Selecionado tem janela própria: pede o valor combinado).
router.post('/plateia/painel/leads/:id', requirePerm('audience.read'), wrap(async (req, res) => {
  const lead = await findLead(req.params.id);
  if (!lead) return res.redirect('/plateia/painel');
  const to = flashBack(req);
  const status = STATUS[req.body.status] ? req.body.status : null;
  if (status === 'confirmado') { await req.flash('error', 'Para selecionar, use "Confirmar participação": ela pede o valor combinado.'); return res.redirect(to); }
  if (status && status !== lead.status) await applyStatus(req, lead, status);
  if (req.body.notes !== undefined) await db.query('UPDATE plateia_leads SET notes = $2, updated_at = now() WHERE id = $1', [lead.id, clean(req.body.notes, 1000) || null]);
  await audit(req, 'plateia.inscricao', 'plateia_lead', lead.id, { status });
  res.redirect(to);
}));

// Arrastar no quadro: mesma regra, resposta em JSON. Selecionado não passa por aqui (a janela pede o valor combinado).
router.post('/plateia/painel/leads/:id/mover', requirePerm('audience.read'), wrap(async (req, res) => {
  const lead = await findLead(req.params.id);
  if (!lead) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
  const status = STATUS[req.body.status] ? req.body.status : null;
  if (!status) return res.status(400).json({ ok: false, error: 'Situação inválida.' });
  if (status === 'confirmado') return res.status(422).json({ ok: false, error: 'Para selecionar, informe o valor combinado em "Confirmar participação".' });
  let reload = false;
  if (status !== lead.status) { ({ reload } = await applyStatus(req, lead, status)); await audit(req, 'plateia.inscricao', 'plateia_lead', lead.id, { status }); }
  res.json({ ok: true, reload });
}));

// Link de pagamento (InfinitePay): gerar ou trocar o valor. Cria um link novo; o anterior deixa de ser o atual.
router.post('/plateia/painel/leads/:id/link', requirePerm('audience.read'), wrap(async (req, res) => {
  const lead = await findLead(req.params.id);
  const to = flashBack(req);
  if (!lead) return res.redirect('/plateia/painel');
  if (!config.infinitepayConfigured) { await req.flash('error', 'A InfinitePay ainda não está configurada.'); return res.redirect(to); }
  if (lead.status === 'confirmado' && (await db.query("SELECT 1 FROM plateia_pay_links WHERE lead_id = $1 AND status = 'pago'", [lead.id])).rowCount) { await req.flash('error', 'Este pedido já foi pago pelo link.'); return res.redirect(to); }
  const raw = String(req.body.amount || '').trim();
  const amount = raw ? parseBRL(raw) : await infinitePay.defaultAmount(lead);
  if (amount == null || Number.isNaN(amount) || amount <= 0) { await req.flash('error', 'Informe o valor do link, por exemplo 197,00.'); return res.redirect(to); }
  try {
    const link = await infinitePay.createLink({ lead, amountCents: amount, userId: req.user.id });
    await audit(req, 'plateia.link_criado', 'plateia_lead', lead.id, { valor: amount });
    await req.flash('ok', `Link de ${formatBRL(link.amount_cents)} criado. Envie pelo WhatsApp ou copie.`);
  } catch (err) { await req.flash('error', `Não consegui gerar o link: ${err.message}`); }
  res.redirect(to);
}));

// Lê a janela de confirmação (valor combinado, vencimento, já recebido ou isento).
function parseConfirm(body) {
  const exempt = body.paid === 'isento';
  const amount = exempt ? 0 : parseBRL(body.amount);
  let dueOn = parseInputDate(body.due_on) || audience.todayISO();
  if (Number.isNaN(dueOn)) dueOn = audience.todayISO();
  if (amount == null || Number.isNaN(amount) || (amount <= 0 && !exempt)) return { error: 'Informe o valor combinado, por exemplo 197,00.' };
  let paidOn = null;
  if (!exempt && body.paid === '1') { paidOn = parseInputDate(body.paid_on) || audience.todayISO(); if (Number.isNaN(paidOn)) paidOn = audience.todayISO(); }
  return { amountCents: amount, dueOn, paidOn, exempt };
}

// Adicionar uma pessoa à mão (já combinada por fora): entra no pedido da gravação escolhida; pode já nascer Selecionada.
router.post('/plateia/painel/leads', requirePerm('audience.read'), wrap(async (req, res) => {
  const back = (guestId) => res.redirect(guestId ? `/plateia/painel?convidado=${guestId}` : '/plateia/painel');
  const guestId = isIntId(String(req.body.guest_id || '')) ? Number(req.body.guest_id) : null;
  const { rows: [guest] } = guestId ? await db.query("SELECT id, name, proposed_at FROM guests WHERE id = $1 AND status = 'agendado' AND proposed_at IS NOT NULL", [guestId]) : { rows: [] };
  const name = clean(req.body.name, 120);
  const phone = audience.validatePhone(req.body.country || 'BR', req.body.phone);
  const confirmed = req.body.status === 'confirmado';
  const pay = confirmed ? parseConfirm(req.body) : null;
  const error = !guest ? 'Escolha a gravação (só aparecem convidados Agendados).' : !name ? 'Informe o nome da pessoa.' : phone.error || (pay && pay.error);
  if (error) { await req.flash('error', error); return res.redirect('/plateia/painel'); }
  const added = await audience.addLead({ guest, name, phone, userId: req.user.id });
  if (added.duplicate) { await req.flash('error', 'Essa pessoa (mesmo WhatsApp) já está nesta gravação.'); return back(guest.id); }
  await audit(req, 'plateia.adicionada', 'plateia_lead', added.lead.id, { convidado: guest.id, selecionada: confirmed });
  if (confirmed) {
    const r = await audience.confirmLead(added.lead, pay, req.user.id);
    if (r.error) { await req.flash('error', `${name} foi adicionada(o), mas não consegui selecionar: ${r.error}`); return back(guest.id); }
  }
  await req.flash('ok', confirmed ? `${name} foi adicionada(o) e já está selecionada(o).` : `${name} foi adicionada(o) como novo pedido. Avalie e confirme a participação quando combinar.`);
  back(guest.id);
}));

// Confirmar a participação: valor combinado, vencimento e (se já pagou) a data do recebimento. Vira conta a receber no financeiro.
router.post('/plateia/painel/leads/:id/confirmar', requirePerm('audience.read'), wrap(async (req, res) => {
  const lead = await findLead(req.params.id);
  if (!lead) return res.redirect('/plateia/painel');
  const to = flashBack(req);
  const pay = parseConfirm(req.body);
  if (pay.error) { await req.flash('error', pay.error); return res.redirect(to); }
  const { amountCents: amount, exempt, paidOn } = pay;
  const r = await audience.confirmLead(lead, pay, req.user.id);
  if (r.error) { await req.flash('error', r.error); return res.redirect(to); }
  await audit(req, 'plateia.confirmada', 'plateia_lead', lead.id, { valor: amount, recebido: Boolean(paidOn), isento: exempt });
  await req.flash('ok', `${lead.name} está selecionado(a). ${exempt ? 'Participação isenta: sem cobrança e sem conta a receber.' : paidOn ? 'Pagamento registrado como recebido.' : 'A conta a receber foi criada no financeiro.'}`);
  res.redirect(to);
}));

router.post('/plateia/painel/leads/:id/recebido', requirePerm('audience.read'), wrap(async (req, res) => {
  const lead = await findLead(req.params.id);
  if (!lead || lead.status !== 'confirmado') return res.redirect(flashBack(req));
  const undo = req.body.desfazer === '1';
  let paidOn = parseInputDate(req.body.paid_on) || audience.todayISO(); if (Number.isNaN(paidOn)) paidOn = audience.todayISO();
  await audience.setReceived(lead, undo ? null : paidOn);
  await audit(req, undo ? 'plateia.recebimento_desfeito' : 'plateia.recebido', 'plateia_lead', lead.id);
  await req.flash('ok', undo ? 'Recebimento desfeito.' : 'Pagamento marcado como recebido.');
  res.redirect(flashBack(req));
}));

// Planilha das inscrições (UTM incluídas) para cruzar com as campanhas.
router.get('/plateia/painel/inscricoes.csv', requirePerm('audience.read'), wrap(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM plateia_leads ORDER BY created_at DESC');
  const cell = (v) => { let t = String(v ?? ''); if (/^[=+\-@\t]/.test(t)) t = `'${t}`; return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const head = ['Data', 'Nome', 'WhatsApp', 'Convidado', 'Gravação', 'Situação', 'Valor combinado (R$)', 'Abriu o WhatsApp', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'Origem (referrer)'];
  const out = [head.join(';')];
  for (const r of rows) {
    out.push([r.created_at.toISOString(), r.name, r.phone.replace(/\D/g, ''), r.guest_name, r.recording_at ? r.recording_at.toISOString() : '', STATUS[r.status], r.amount_cents != null ? (Number(r.amount_cents) / 100).toFixed(2).replace('.', ',') : '', r.whatsapp_opened_at ? 'sim' : 'não',
      r.utm_source, r.utm_medium, r.utm_campaign, r.utm_term, r.utm_content, r.referrer].map(cell).join(';'));
  }
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="plateia-inscricoes.csv"' });
  res.send(`﻿${out.join('\r\n')}\r\n`);
}));

// ---------------------------------------------------------------- ajustes da página (gestão)
router.post('/plateia/painel/ajustes', requirePerm('audience.manage'), wrap(async (req, res) => {
  const price = parseBRL(req.body.price);
  const whatsapp = String(req.body.whatsapp || '').replace(/\D/g, '');
  const pixel = String(req.body.meta_pixel || '').trim(); const ga4 = String(req.body.ga4 || '').trim().toUpperCase();
  const duration = clean(req.body.duration, 40); const location = clean(req.body.location, 160);
  const back = '/plateia/painel#ajustes';
  if (price == null || Number.isNaN(price) || price <= 0) { await req.flash('error', 'Valor inválido. Use algo como 197,00.'); return res.redirect(back); }
  if (whatsapp && (whatsapp.length < 10 || whatsapp.length > 15)) { await req.flash('error', 'WhatsApp da produtora inválido: informe com o código do país, por exemplo 5511912345678.'); return res.redirect(back); }
  if (pixel && !/^\d{5,20}$/.test(pixel)) { await req.flash('error', 'O ID do Meta Pixel tem só números.'); return res.redirect(back); }
  if (ga4 && !/^G-[A-Z0-9]{4,12}$/.test(ga4)) { await req.flash('error', 'O ID do Google Analytics 4 parece com G-XXXXXXXXXX.'); return res.redirect(back); }
  if (!duration || !location) { await req.flash('error', 'Preencha a duração e o local.'); return res.redirect(back); }
  const set = settingsSvc.set;
  await Promise.all([
    set('plateia_active', req.body.active === '1'), set('plateia_price_cents', price), set('plateia_whatsapp', whatsapp), set('plateia_meta_pixel', pixel), set('plateia_ga4', ga4),
    set('plateia_duration', duration), set('plateia_location', location),
  ]);
  await audit(req, 'plateia.ajustes', 'settings', null, { ativa: req.body.active === '1' });
  await req.flash('ok', 'Ajustes da página salvos.');
  res.redirect(back);
}));

router.post('/plateia/painel/imagem/:slot', requirePerm('audience.manage'), express.raw({ type: () => true, limit: MAX_IMG }), wrap(async (req, res) => {
  const slot = { hero: 'plateia_hero_key', estudio: 'plateia_studio_key' }[req.params.slot];
  if (!slot) return res.status(404).json({ ok: false, error: 'Imagem desconhecida.' });
  if (!config.storageConfigured) return res.status(503).json({ ok: false, error: 'O armazenamento de arquivos não está configurado.' });
  const key = await storeImage('plateia', req.params.slot, req.body, req.params.slot);
  if (!key) return res.status(400).json({ ok: false, error: 'Envie uma imagem PNG, JPEG ou WebP (até 5 MB).' });
  const old = await settingsSvc.get(slot);
  await settingsSvc.set(slot, key);
  if (old) await b2.deleteObject(old).catch(() => {});
  await audit(req, 'plateia.imagem', 'settings', null, { slot: req.params.slot });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- no card do convidado
router.post('/convidados/:id/plateia', requirePerm('guests.write'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return res.redirect('/convidados');
  const enabled = [].concat(req.body.enabled).includes('1');
  const status = GUEST_STATUS[req.body.status] ? req.body.status : 'disponivel';
  const { rows: [g] } = await db.query('UPDATE guests SET audience_enabled = $2, audience_status = $3 WHERE id = $1 RETURNING id, name', [req.params.id, enabled, status]);
  if (!g) return res.redirect('/convidados');
  await audit(req, 'convidado.plateia', 'guest', g.id, { enabled, status });
  await req.flash('ok', enabled ? `${g.name} aparece na agenda da plateia (${GUEST_STATUS[status].toLowerCase()}).` : `${g.name} saiu da agenda da plateia.`);
  res.redirect(`/convidados/${g.id}#plateia`);
}));

router.get('/convidados/:id/foto', requirePerm('guests.read'), wrap(async (req, res) => {
  const { rows: [g] } = isIntId(req.params.id) ? await db.query('SELECT photo_key FROM guests WHERE id = $1', [req.params.id]) : { rows: [] };
  const obj = g && g.photo_key ? await b2.getObject(g.photo_key).catch(() => null) : null;
  if (!obj) return res.status(404).send('Sem foto.');
  res.set({ 'Content-Type': obj.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  return res.send(Buffer.from(await obj.arrayBuffer()));
}));

router.post('/convidados/:id/foto', requirePerm('guests.write'), express.raw({ type: () => true, limit: MAX_IMG }), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return res.status(404).json({ ok: false });
  if (!config.storageConfigured) return res.status(503).json({ ok: false, error: 'O armazenamento de arquivos não está configurado.' });
  const { rows: [g] } = await db.query('SELECT id, photo_key FROM guests WHERE id = $1', [req.params.id]);
  if (!g) return res.status(404).json({ ok: false, error: 'Convidado não encontrado.' });
  const key = await storeImage('convidados', g.id, req.body, 'foto');
  if (!key) return res.status(400).json({ ok: false, error: 'Envie uma imagem PNG, JPEG ou WebP (até 5 MB).' });
  await db.query('UPDATE guests SET photo_key = $2 WHERE id = $1', [g.id, key]);
  if (g.photo_key) await b2.deleteObject(g.photo_key).catch(() => {});
  await audit(req, 'convidado.foto', 'guest', g.id);
  res.json({ ok: true });
}));

module.exports = router;
