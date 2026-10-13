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
function whatsappMessage({ name, guestName, date, time, priceCents, phoneDisplay }) {
  return `Olá! Meu nome é ${name} e quero pedir uma vaga na plateia do Pulso Podcast.\n` +
    `Tenho interesse na gravação do episódio com ${guestName}, no dia ${date}, às ${time}.\n` +
    `Entendi que a plateia é selecionada pela produção e que, se eu for selecionado(a), o investimento é de ${money(priceCents)} por participante.\n` +
    `Gostaria de saber como seguir. Meu WhatsApp é ${phoneDisplay}.\nObrigado(a)!`;
}

async function createLead({ guest, name, phone, utm, referrer, landingUrl, visitorId, userAgent }) {
  const s = await settings();
  const msg = whatsappMessage({ name, guestName: guest.name, date: dateLong(guest.proposed_at), time: timeShort(guest.proposed_at), priceCents: s.priceCents, phoneDisplay: phone.display });
  // mesma pessoa no mesmo episódio: atualiza em vez de duplicar
  const { rows: [dup] } = await db.query('SELECT id, ref FROM plateia_leads WHERE guest_id = $1 AND phone = $2 ORDER BY id DESC LIMIT 1', [guest.id, phone.e164]);
  let ref; let created = false; let leadId = null;
  if (dup) {
    ref = dup.ref;
    await db.query('UPDATE plateia_leads SET name = $2, updated_at = now(), status = CASE WHEN status = \'desistiu\' THEN \'novo\' ELSE status END WHERE id = $1', [dup.id, name]);
  } else {
    ref = crypto.randomBytes(9).toString('base64url'); created = true;
    const { rows: [row] } = await db.query(
      `INSERT INTO plateia_leads (ref, guest_id, guest_name, recording_at, name, phone, country, price_cents, utm_source, utm_medium, utm_campaign, utm_term, utm_content, fbclid, gclid, referrer, landing_url, visitor_id, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
      [ref, guest.id, guest.name, guest.proposed_at, name, phone.e164, phone.country, s.priceCents, utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_term, utm.utm_content, utm.fbclid, utm.gclid,
        clip(referrer, 300), clip(landingUrl, 500), cleanVisitor(visitorId), clip(userAgent, 300)]);
    leadId = row.id;
  }
  if (created) { // a mesma pessoa pedindo de novo não conta duas vezes no funil nem avisa de novo
    await recordEvent({ type: 'lead', guestId: guest.id, visitorId, utm, referrer });
    require('./notify').notify({
      type: 'plateia', broadcast: true, title: `Nova inscrição na plateia: ${name}`, body: `${guest.name} · ${dateLong(guest.proposed_at)}, ${timeShort(guest.proposed_at)} · ${phone.display}`,
      url: `/plateia/painel?convidado=${guest.id}`, dedupe: `plateia-lead-${leadId}`,
    }).catch((err) => console.error('aviso da plateia:', err.message));
  }
  const url = s.whatsapp ? `https://wa.me/${s.whatsapp}?text=${encodeURIComponent(msg)}` : null;
  return { ref, url, message: msg, price: money(s.priceCents) };
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
async function confirmLead(lead, { amountCents, dueOn, paidOn = null }, userId) {
  const fin = require('./finance');
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

module.exports = {
  todayISO: () => require('./finance').todayISO(), confirmLead, releaseLead, setReceived,
  settings, COUNTRIES, COUNTRY_BY_CODE, validatePhone, dateLong, timeShort, weekday, money, agenda, agendaGuest, cleanUtm, cleanVisitor, recordEvent, whatsappMessage, createLead, results, EVENT_TYPES, clip,
};
