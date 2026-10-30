// Pulso Podcast com Plateia: agenda pública gerada dos convidados, inscrição (lead), mensagem de WhatsApp e medição.
const crypto = require('crypto');
const db = require('../db/pool');
const settingsSvc = require('./settings');

const TZ = 'America/Sao_Paulo';
const KEYS = ['plateia_active', 'plateia_price_cents', 'plateia_duration', 'plateia_location', 'plateia_whatsapp', 'plateia_meta_pixel', 'plateia_ga4', 'plateia_hero_key', 'plateia_studio_key'];

async function settings() {
  const s = await settingsSvc.getMany(KEYS);
  return {
    active: s.plateia_active === 'true', priceCents: Number(s.plateia_price_cents) || 0, duration: s.plateia_duration, location: s.plateia_location,
    whatsapp: s.plateia_whatsapp.replace(/\D/g, ''), metaPixel: s.plateia_meta_pixel, ga4: s.plateia_ga4, heroKey: s.plateia_hero_key, studioKey: s.plateia_studio_key,
  };
}

// ---------------------------------------------------------------- telefone
// Países oferecidos no formulário. `min`/`max` = dígitos do número nacional (sem o código do país).
const COUNTRIES = [
  { code: 'BR', name: 'Brasil', dial: '55', min: 10, max: 11 },
  { code: 'PT', name: 'Portugal', dial: '351', min: 9, max: 9 },
  { code: 'US', name: 'Estados Unidos / Canadá', dial: '1', min: 10, max: 10 },
  { code: 'AR', name: 'Argentina', dial: '54', min: 10, max: 11 },
  { code: 'CL', name: 'Chile', dial: '56', min: 9, max: 9 },
  { code: 'CO', name: 'Colômbia', dial: '57', min: 10, max: 10 },
  { code: 'MX', name: 'México', dial: '52', min: 10, max: 10 },
  { code: 'UY', name: 'Uruguai', dial: '598', min: 8, max: 9 },
  { code: 'PY', name: 'Paraguai', dial: '595', min: 9, max: 9 },
  { code: 'ES', name: 'Espanha', dial: '34', min: 9, max: 9 },
  { code: 'IT', name: 'Itália', dial: '39', min: 9, max: 11 },
  { code: 'FR', name: 'França', dial: '33', min: 9, max: 9 },
  { code: 'DE', name: 'Alemanha', dial: '49', min: 10, max: 12 },
  { code: 'GB', name: 'Reino Unido', dial: '44', min: 10, max: 10 },
  { code: 'AO', name: 'Angola', dial: '244', min: 9, max: 9 },
  { code: 'MZ', name: 'Moçambique', dial: '258', min: 9, max: 9 },
];
const COUNTRY_BY_CODE = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));

// Devolve { e164, display, country } ou { error }. Aceita o número com máscara, espaços e o código do país digitado junto.
function validatePhone(countryCode, raw) {
  const c = COUNTRY_BY_CODE[countryCode];
  if (!c) return { error: 'Escolha o país do WhatsApp.' };
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith(c.dial) && digits.length > c.max) digits = digits.slice(c.dial.length); // "+55 11 9…" colado inteiro
  if (c.code === 'BR') digits = digits.replace(/^0+/, ''); // zero de operadora
  if (digits.length < c.min || digits.length > c.max) return { error: c.code === 'BR' ? 'Informe o WhatsApp com DDD, por exemplo (11) 91234-5678.' : 'Esse número parece incompleto ou longo demais.' };
  if (c.code === 'BR') {
    if (!/^[1-9][1-9]/.test(digits)) return { error: 'O DDD parece inválido.' };
    if (digits.length === 11 && digits[2] !== '9') return { error: 'Celular com 11 dígitos começa com 9 depois do DDD.' };
  }
  const display = c.code === 'BR' ? `(${digits.slice(0, 2)}) ${digits.slice(2, digits.length - 4)}-${digits.slice(-4)}` : digits;
  return { e164: `+${c.dial}${digits}`, display: `+${c.dial} ${display}`, country: c.code };
}

// ---------------------------------------------------------------- formatação (horário de Brasília)
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEK = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
function parts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return { day: Number(p.day), month: Number(p.month), year: Number(p.year), hour: Number(p.hour), minute: Number(p.minute) };
}
const dateLong = (d) => { const p = parts(d); return `${p.day} de ${MONTHS[p.month - 1]} de ${p.year}`; };
const timeShort = (d) => { const p = parts(d); return p.minute ? `${p.hour}h${String(p.minute).padStart(2, '0')}` : `${p.hour}h`; };
const weekday = (d) => WEEK[new Date(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d)) + 'T12:00:00Z').getUTCDay()];
const money = (cents) => `R$ ${Math.round(cents / 100).toLocaleString('pt-BR')}`;

// ---------------------------------------------------------------- agenda
// Sai sozinha dos convidados: confirmados (Agendado), com data futura e não desmarcados da plateia.
const AGENDA_SQL = `SELECT id, name, instagram, job_title, company, topic, proposed_at, audience_status, (photo_key IS NOT NULL) AS has_photo
                      FROM guests WHERE status = 'agendado' AND audience_enabled AND proposed_at > now() ORDER BY proposed_at, id`;

async function agenda() {
  const { rows } = await db.query(AGENDA_SQL);
  return rows.map((g) => ({
    id: g.id, name: g.name, role: [g.job_title, g.company].filter(Boolean).join(' · '), topic: g.topic, instagram: g.instagram, status: g.audience_status, hasPhoto: g.has_photo,
    at: g.proposed_at, date: dateLong(g.proposed_at), time: timeShort(g.proposed_at), weekday: weekday(g.proposed_at),
  }));
}

async function agendaGuest(id) {
  const { rows } = await db.query(`SELECT * FROM (${AGENDA_SQL}) a WHERE id = $1`, [id]);
  return rows[0] || null;
}

// ---------------------------------------------------------------- rastreamento
const clip = (v, n = 200) => { const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n); return s || null; };
function cleanUtm(input = {}) {
  const o = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid']) o[k] = clip(input[k], k.endsWith('clid') ? 300 : 150);
  return o;
}
const cleanVisitor = (v) => (/^[A-Za-z0-9_-]{8,64}$/.test(String(v || '')) ? String(v) : null);
const EVENT_TYPES = ['view', 'agenda_click', 'signup_click', 'form_open', 'lead', 'whatsapp'];

async function recordEvent({ type, guestId = null, visitorId, utm = {}, referrer = null }) {
  if (!EVENT_TYPES.includes(type)) return false;
  await db.query(
    `INSERT INTO plateia_events (type, guest_id, visitor_id, utm_source, utm_medium, utm_campaign, utm_term, utm_content, referrer) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [type, guestId, cleanVisitor(visitorId), utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_term, utm.utm_content, clip(referrer, 300)]);
  return true;
}

// ---------------------------------------------------------------- inscrição
function whatsappMessage({ name, guestName, date, time, priceCents, phoneDisplay, partnerName = null }) {
  return `Olá! Meu nome é ${name} e quero pedir uma vaga na plateia do Pulso Podcast.\n` +
    `Tenho interesse na gravação do episódio com ${guestName}, no dia ${date}, às ${time}.\n` +
    (partnerName
      ? `Recebi o convite de ${partnerName}: entendi que a plateia é selecionada pela produção e que, se eu for selecionado(a), a participação é isenta de cobrança.\n`
      : `Entendi que a plateia é selecionada pela produção e que, se eu for selecionado(a), o investimento é de ${money(priceCents)} por participante.\n`) +
    `Gostaria de saber como seguir. Meu WhatsApp é ${phoneDisplay}.\nObrigado(a)!`;
}

// Versão do texto das condições da plateia (page.ejs). Mudou o texto, aumente a versão.
const TERMS_VERSION = '2026-10b';

// partner: link de parceiro com vaga (o pedido fica isento se a pessoa for selecionada).
async function createLead({ guest, name, phone, utm, referrer, landingUrl, visitorId, userAgent, partner = null }) {
  const s = await settings();
  const msg = whatsappMessage({ name, guestName: guest.name, date: dateLong(guest.proposed_at), time: timeShort(guest.proposed_at), priceCents: s.priceCents, phoneDisplay: phone.display, partnerName: partner?.name });
  // mesma pessoa no mesmo episódio: atualiza em vez de duplicar
  const { rows: [dup] } = await db.query('SELECT id, ref FROM plateia_leads WHERE guest_id = $1 AND phone = $2 ORDER BY id DESC LIMIT 1', [guest.id, phone.e164]);
  let ref; let created = false; let leadId = null;
  if (dup) {
    ref = dup.ref;
    await db.query('UPDATE plateia_leads SET name = $2, terms_accepted_at = now(), terms_version = $3, updated_at = now(), status = CASE WHEN status = \'desistiu\' THEN \'novo\' ELSE status END, partner_id = coalesce(partner_id, $4), partner_name = coalesce(partner_name, $5) WHERE id = $1',
      [dup.id, name, TERMS_VERSION, partner?.id || null, partner?.name || null]);
  } else {
    ref = crypto.randomBytes(9).toString('base64url'); created = true;
    const { rows: [row] } = await db.query(
      `INSERT INTO plateia_leads (ref, guest_id, guest_name, recording_at, name, phone, country, price_cents, utm_source, utm_medium, utm_campaign, utm_term, utm_content, fbclid, gclid, referrer, landing_url, visitor_id, user_agent, terms_accepted_at, terms_version, partner_id, partner_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now(), $20, $21, $22) RETURNING id`,
      [ref, guest.id, guest.name, guest.proposed_at, name, phone.e164, phone.country, s.priceCents, utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_term, utm.utm_content, utm.fbclid, utm.gclid,
        clip(referrer, 300), clip(landingUrl, 500), cleanVisitor(visitorId), clip(userAgent, 300), TERMS_VERSION, partner?.id || null, partner?.name || null]);
    leadId = row.id;
  }
  if (created) { // a mesma pessoa pedindo de novo não conta duas vezes no funil nem avisa de novo
    await recordEvent({ type: 'lead', guestId: guest.id, visitorId, utm, referrer });
    require('./notify').notify({
      type: 'plateia', broadcast: true, title: `Nova inscrição na plateia: ${name}`, body: `${guest.name} · ${dateLong(guest.proposed_at)}, ${timeShort(guest.proposed_at)} · ${phone.display}${partner ? ` · isenta, link de ${partner.name}` : ''}`,
      url: `/plateia/painel?convidado=${guest.id}`, dedupe: `plateia-lead-${leadId}`,
    }).catch((err) => console.error('aviso da plateia:', err.message));
  }
  const url = s.whatsapp ? `https://wa.me/${s.whatsapp}?text=${encodeURIComponent(msg)}` : null;
  return { ref, url, message: msg, price: partner ? 'Isento' : money(s.priceCents), exempt: Boolean(partner), partnerName: partner?.name || null };
}

// ---------------------------------------------------------------- painel
async function results(days = 30) {
  const since = `now() - interval '${Number(days)} days'`;
  const [{ rows: totals }, { rows: perGuest }, { rows: perUtm }] = await Promise.all([
    db.query(`SELECT type, count(*)::int AS n, count(DISTINCT visitor_id)::int AS visitors FROM plateia_events WHERE created_at > ${since} GROUP BY type`),
    db.query(`SELECT g.id, g.name, g.proposed_at,
                (SELECT count(*)::int FROM plateia_events e WHERE e.guest_id = g.id AND e.type = 'signup_click' AND e.created_at > ${since}) AS clicks,
                (SELECT count(*)::int FROM plateia_leads l WHERE l.guest_id = g.id AND l.created_at > ${since}) AS leads,
                (SELECT count(*)::int FROM plateia_leads l WHERE l.guest_id = g.id AND l.status = 'confirmado') AS confirmed
               FROM guests g WHERE g.id IN (SELECT guest_id FROM plateia_events WHERE guest_id IS NOT NULL AND created_at > ${since} UNION SELECT guest_id FROM plateia_leads WHERE guest_id IS NOT NULL)
              ORDER BY g.proposed_at DESC NULLS LAST LIMIT 30`),
    db.query(`SELECT coalesce(utm_source, '(direto)') AS source, coalesce(utm_medium, '—') AS medium, coalesce(utm_campaign, '—') AS campaign,
                count(*) FILTER (WHERE type = 'view')::int AS views, count(*) FILTER (WHERE type = 'signup_click')::int AS clicks, count(*) FILTER (WHERE type = 'lead')::int AS leads
               FROM plateia_events WHERE created_at > ${since} GROUP BY 1, 2, 3 ORDER BY leads DESC, views DESC LIMIT 25`),
  ]);
  const t = Object.fromEntries(totals.map((r) => [r.type, r]));
  const get = (k) => (t[k] ? t[k].n : 0);
  return {
    days, visitors: t.view ? t.view.visitors : 0, views: get('view'), agendaClicks: get('agenda_click'), signupClicks: get('signup_click'), formOpens: get('form_open'), leads: get('lead'), whatsapp: get('whatsapp'),
    perGuest, perUtm,
  };
}

// Confirma a participação: guarda o valor combinado e cria (ou atualiza) a conta a receber. paidOn = já recebeu nessa data.
// exempt = isento: participa sem cobrança (valor 0, nenhuma conta a receber).
async function confirmLead(lead, { amountCents, dueOn, paidOn = null, exempt = false }, userId) {
  const fin = require('./finance');
  if (exempt) {
    if (lead.entry_id) {
      const { rows: [e] } = await db.query('SELECT status FROM fin_entries WHERE id = $1', [lead.entry_id]);
      if (e && e.status === 'pago') return { error: 'O pagamento já foi recebido. Para isentar, desfaça o recebimento antes.' };
      await db.query("UPDATE fin_entries SET status = 'cancelado', cancel_reason = 'sistema', updated_at = now() WHERE id = $1 AND status = 'previsto'", [lead.entry_id]);
    }
    await db.query("UPDATE plateia_leads SET status = 'confirmado', amount_cents = 0, confirmed_at = coalesce(confirmed_at, now()), entry_id = NULL, updated_at = now() WHERE id = $1", [lead.id]);
    return { ok: true, exempt: true, today: fin.todayISO() };
  }
  if (lead.entry_id) {
    const { rows: [e] } = await db.query('SELECT status FROM fin_entries WHERE id = $1', [lead.entry_id]);
    if (e && e.status === 'pago') return { error: 'O pagamento já foi recebido. Para mudar o valor, desfaça o recebimento antes.' };
  }
  const label = `Plateia · ${lead.name} · ${lead.guest_name}`;
  const { rows: [entry] } = await db.query(
    `INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, paid_on, status, guest_id, source, auto_key, created_by)
     VALUES ('entrada','plateia',$1,$2,$3,$4,$5,$6,'plateia',$7,$8)
     ON CONFLICT (auto_key) DO UPDATE SET amount_cents = EXCLUDED.amount_cents, due_on = EXCLUDED.due_on, paid_on = EXCLUDED.paid_on, status = EXCLUDED.status,
       cancel_reason = NULL, description = EXCLUDED.description, updated_at = now() RETURNING id`,
    [label, amountCents, dueOn, paidOn, paidOn ? 'pago' : 'previsto', lead.guest_id, `plateia-lead-${lead.id}`, userId]);
  await db.query("UPDATE plateia_leads SET status = 'confirmado', amount_cents = $2, confirmed_at = coalesce(confirmed_at, now()), entry_id = $3, updated_at = now() WHERE id = $1", [lead.id, amountCents, entry.id]);
  return { ok: true, entryId: entry.id, today: fin.todayISO() };
}

// Muda a situação do pedido e cuida do que vem junto: ao entrar em "Em avaliação" nasce o link de pagamento (se a InfinitePay está
// configurada); ao deixar "Selecionado", a conta a receber ainda não paga é cancelada. Devolve o que aconteceu, sem mensagens de tela.
async function changeStatus(lead, status, userId) {
  const config = require('../config');
  const infinitePay = require('./infinitePay');
  const out = { link: null, linkError: null, released: false, kept: false };
  await db.query('UPDATE plateia_leads SET status = $2, updated_at = now() WHERE id = $1', [lead.id, status]);
  // pedido de parceiro é isento: não nasce link de pagamento
  if (status === 'em_atendimento' && !lead.partner_id && config.infinitepayConfigured && !(await infinitePay.currentLink(lead.id)) && lead.status !== 'confirmado') {
    try { out.link = await infinitePay.createLink({ lead, amountCents: await infinitePay.defaultAmount(lead), userId }); } catch (err) { out.linkError = err.message; }
  }
  if (lead.status === 'confirmado') { const r = await releaseLead(lead); out.released = !r.kept; out.kept = r.kept; }
  return out;
}

// Mudou a situação para outra que não "Selecionado": a conta ainda não recebida deixa de existir.
async function releaseLead(lead) {
  if (!lead.entry_id) return { kept: false };
  const { rows: [e] } = await db.query('SELECT status FROM fin_entries WHERE id = $1', [lead.entry_id]);
  if (e && e.status === 'pago') return { kept: true };
  await db.query("UPDATE fin_entries SET status = 'cancelado', cancel_reason = 'sistema', updated_at = now() WHERE id = $1 AND status = 'previsto'", [lead.entry_id]);
  return { kept: false };
}

async function setReceived(lead, paidOn) { // paidOn null = desfazer
  if (!lead.entry_id) return false;
  if (paidOn) await db.query("UPDATE fin_entries SET status = 'pago', paid_on = $2, cancel_reason = NULL, updated_at = now() WHERE id = $1", [lead.entry_id, paidOn]);
  else await db.query("UPDATE fin_entries SET status = 'previsto', paid_on = NULL, updated_at = now() WHERE id = $1", [lead.entry_id]);
  return true;
}

// ---------------------------------------------------------------- pessoas adicionadas à mão
// Quem a equipe já combinou por fora entra pelo painel, sem passar pela página pública (nada de funil, UTM nem aviso).
async function addLead({ guest, name, phone, userId }) {
  const { rows: [dup] } = await db.query('SELECT id FROM plateia_leads WHERE guest_id = $1 AND phone = $2 LIMIT 1', [guest.id, phone.e164]);
  if (dup) return { duplicate: true };
  const s = await settings();
  const { rows: [row] } = await db.query(
    `INSERT INTO plateia_leads (ref, guest_id, guest_name, recording_at, name, phone, country, price_cents, added_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [crypto.randomBytes(9).toString('base64url'), guest.id, guest.name, guest.proposed_at, name, phone.e164, phone.country, s.priceCents, userId]);
  return { lead: row };
}

// ---------------------------------------------------------------- lembrete no dia da gravação
// No dia da gravação, se há gente selecionada na plateia, nasce UMA tarefa para a produtora lembrar todo mundo (não uma por pessoa).
// Quem entra na plateia depois, no mesmo dia, é somado na descrição enquanto a tarefa não foi feita.
async function producerFor(ownerId) {
  if (ownerId) {
    const { rows: [o] } = await db.query("SELECT id FROM users WHERE id = $1 AND active AND role = 'produtora'", [ownerId]);
    if (o) return o.id;
  }
  const { rows: [p] } = await db.query("SELECT id FROM users WHERE active AND role = 'produtora' ORDER BY name, id LIMIT 1");
  if (p) return p.id;
  const { rows: [g] } = await db.query("SELECT id FROM users WHERE active AND role IN ('gestao', 'superadmin') ORDER BY (role = 'gestao') DESC, name, id LIMIT 1");
  return g ? g.id : null;
}

function reminderText(guest, people, location) {
  const list = people.map((p) => `- ${p.name} · ${p.phone}`).join('\n');
  return `Hoje, às ${timeShort(guest.proposed_at)}, tem gravação com ${guest.name}${location ? ` (${location})` : ''}.\n`
    + `Mande o lembrete para ${people.length === 1 ? 'a pessoa selecionada' : `as ${people.length} pessoas selecionadas`} da plateia:\n${list}\n\n`
    + `Sugestão de mensagem: "Oi, {nome}! Passando para lembrar que hoje, às ${timeShort(guest.proposed_at)}, é a gravação do Pulso Podcast com ${guest.name}. Esperamos você${location ? ` no ${location}` : ''}. Qualquer imprevisto, é só avisar por aqui."\n\n`
    + `A lista com o WhatsApp de cada um está em Plateia > Pedidos (filtre pelo episódio).`;
}

async function reminderTick(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(now));
  if (hour < 6) return 0;
  const tasks = require('./tasks');
  const today = tasks.todayISO();
  const { rows: guests } = await db.query(
    `SELECT g.id, g.name, g.owner_id, g.proposed_at FROM guests g
      WHERE g.status = 'agendado' AND g.proposed_at > $2 AND (g.proposed_at AT TIME ZONE 'America/Sao_Paulo')::date = $1::date
        AND EXISTS (SELECT 1 FROM plateia_leads l WHERE l.guest_id = g.id AND l.status = 'confirmado')
      ORDER BY g.proposed_at`, [today, now]);
  if (!guests.length) return 0;
  const location = (await settings()).location;
  let made = 0;
  for (const g of guests) {
    const { rows: people } = await db.query("SELECT name, phone FROM plateia_leads WHERE guest_id = $1 AND status = 'confirmado' ORDER BY name, id", [g.id]);
    const description = reminderText(g, people, location);
    const autoKey = `plateia-lembrete-${g.id}-${today}`;
    const { rows: [existing] } = await db.query('SELECT id, status FROM tasks WHERE auto_key = $1', [autoKey]);
    if (existing) { if (existing.status !== 'feito') await db.query('UPDATE tasks SET description = $2, updated_at = now() WHERE id = $1 AND description IS DISTINCT FROM $2', [existing.id, description]); continue; }
    const t = await tasks.create({
      values: { title: `Lembrar a plateia: gravação com ${g.name} às ${timeShort(g.proposed_at)}`, description, kind: 'geral', status: 'a_fazer', due_on: today },
      user: null, assigneeId: await producerFor(g.owner_id), links: { guestId: g.id }, autoKey,
    });
    if (t) made += 1;
  }
  return made;
}

module.exports = {
  changeStatus, addLead, reminderTick, producerFor,
  todayISO: () => require('./finance').todayISO(), confirmLead, releaseLead, setReceived,
  settings, COUNTRIES, COUNTRY_BY_CODE, validatePhone, dateLong, timeShort, weekday, money, agenda, agendaGuest, cleanUtm, cleanVisitor, recordEvent, whatsappMessage, createLead, TERMS_VERSION, results, EVENT_TYPES, clip,
};
