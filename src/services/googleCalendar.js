// Google Agenda: cada convidado Agendado (com data) vira um evento no calendário do Pulso Podcast, e o evento acompanha
// mudanças de data, tema e responsável, ou some se o convidado deixa de estar agendado. Conta de serviço (sem tela de login):
// o calendário precisa estar compartilhado com o e-mail dela, com permissão para editar eventos.
// O id do evento é fixo por convidado ("pulsog<id>"), então repetir a rotina nunca duplica nada.
const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config');
const settingsSvc = require('./settings');
const { TZ } = require('../utils/format');

const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
// Estas etapas mantêm o evento (a gravação aconteceu); as demais o removem.
const KEEP = new Set(['agendado', 'gravado', 'publicado']);

const b64url = (v) => Buffer.from(v).toString('base64url');
const eventId = (guestId) => `pulsog${guestId}`;

function credentials() {
  const raw = String(config.google.serviceAccount || '').trim();
  if (!raw) return null;
  try {
    const json = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    if (!json.client_email || !json.private_key) return null;
    return { email: json.client_email, key: String(json.private_key).replace(/\\n/g, '\n') };
  } catch { return null; }
}

let cached = { token: null, until: 0 };
async function accessToken() {
  if (cached.token && Date.now() < cached.until - 60_000) return cached.token;
  const c = credentials();
  if (!c) throw new Error('Chave da conta de serviço inválida (GOOGLE_SERVICE_ACCOUNT_B64 ou _JSON).');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: c.email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }))}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(c.key).toString('base64url');
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }), signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`Google recusou a chave: ${json.error_description || json.error || `HTTP ${res.status}`}`);
  cached = { token: json.access_token, until: Date.now() + (json.expires_in || 3600) * 1000 };
  return cached.token;
}

// Chamada à API de eventos. Devolve { status, json }. Não lança em 404/409/410 (quem chama decide).
async function api(method, path, body) {
  if (!config.googleConfigured) throw new Error('Google Agenda não configurado (GOOGLE_CALENDAR_ID e a chave da conta de serviço).');
  const res = await fetch(`${API}/calendars/${encodeURIComponent(config.google.calendarId)}/events${path}`, {
    method, headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000),
  });
  const json = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok && ![404, 409, 410].includes(res.status)) {
    const msg = (json.error && (json.error.message || json.error.status)) || `HTTP ${res.status}`;
    throw new Error(res.status === 404 ? 'Agenda não encontrada' : `Google Agenda: ${msg}`);
  }
  return { status: res.status, json };
}

// Conteúdo do evento para um convidado (linha de `guests` + nome do responsável).
function payload(g, { address }) {
  const start = new Date(g.proposed_at);
  const end = new Date(start.getTime() + config.google.eventMinutes * 60_000);
  const lines = [];
  if (g.topic) lines.push(`Tema: ${g.topic}`);
  if (g.instagram) lines.push(`Instagram: @${String(g.instagram).replace(/^@/, '')}`);
  if (g.owner_name) lines.push(`Responsável: ${g.owner_name}`);
  const confirm = [g.scheduled_studio && 'estúdio', g.scheduled_hosts && 'hosts', g.scheduled_guest && 'convidado'].filter(Boolean);
  lines.push(`Agenda confirmada com: ${confirm.length ? confirm.join(', ') : 'ninguém ainda'}`);
  lines.push('', `Painel: ${config.appBaseUrl}/convidados/${g.id}`);
  return {
    summary: `Gravação Pulso: ${g.name}`, description: lines.join('\n'), location: address || undefined,
    start: { dateTime: start.toISOString(), timeZone: TZ }, end: { dateTime: end.toISOString(), timeZone: TZ },
    status: 'confirmed', extendedProperties: { private: { pulsoGuestId: String(g.id) } },
    source: { title: 'Pulso Gestão', url: `${config.appBaseUrl}/convidados/${g.id}` },
  };
}
const hashOf = (p) => crypto.createHash('sha1').update(JSON.stringify(p)).digest('hex');

async function upsert(g, p) {
  const id = eventId(g.id);
  let r = await api('PATCH', `/${id}`, p);
  if (r.status === 404 || r.status === 410) {
    r = await api('POST', '', { ...p, id });
    if (r.status === 409) r = await api('PUT', `/${id}`, { ...p, id }); // evento apagado antes: o Google guarda o id
  }
  return r.json;
}

async function remove(guestId) {
  await api('DELETE', `/${eventId(guestId)}`); // 404/410 = já não existe: tudo certo
  await db.query('DELETE FROM gcal_events WHERE guest_id = $1', [guestId]);
}

// Deixa o calendário igual ao CRM. Devolve { created, updated, removed, unchanged, errors: [texto] }.
async function sync() {
  const out = { created: 0, updated: 0, removed: 0, unchanged: 0, errors: [] };
  if (!config.googleConfigured) return out;
  const address = (await settingsSvc.getMany(['lembrete_endereco', 'plateia_location'])).lembrete_endereco
    || (await settingsSvc.get('plateia_location'));
  const [{ rows: wanted }, { rows: have }] = await Promise.all([
    db.query(`SELECT g.*, u.name AS owner_name FROM guests g LEFT JOIN users u ON u.id = g.owner_id WHERE g.status = 'agendado' AND g.proposed_at IS NOT NULL ORDER BY g.proposed_at`),
    db.query('SELECT e.*, g.status AS guest_status FROM gcal_events e LEFT JOIN guests g ON g.id = e.guest_id'),
  ]);
  const byGuest = new Map(have.map((e) => [e.guest_id, e]));
  for (const g of wanted) {
    try {
      const p = payload(g, { address }); const h = hashOf(p); const cur = byGuest.get(g.id);
      if (cur && cur.hash === h) { out.unchanged += 1; continue; }
      const ev = await upsert(g, p);
      await db.query(`INSERT INTO gcal_events (guest_id, event_id, hash, html_link, synced_at) VALUES ($1,$2,$3,$4,now())
                      ON CONFLICT (guest_id) DO UPDATE SET event_id = EXCLUDED.event_id, hash = EXCLUDED.hash, html_link = EXCLUDED.html_link, synced_at = now()`,
      [g.id, eventId(g.id), h, ev.htmlLink || null]);
      out[cur ? 'updated' : 'created'] += 1;
    } catch (err) { out.errors.push(`${g.name}: ${err.message}`); }
  }
  const wantedIds = new Set(wanted.map((g) => g.id));
  for (const e of have) {
    if (wantedIds.has(e.guest_id) || (e.guest_status && KEEP.has(e.guest_status))) continue;
    try { await remove(e.guest_id); out.removed += 1; } catch (err) { out.errors.push(`#${e.guest_id}: ${err.message}`); }
  }
  return out;
}

// Rotina do sistema (a cada poucos minutos). Erros viram aviso em scheduler_runs.
async function tick() {
  if (!config.googleConfigured) return;
  const r = await sync();
  if (r.errors.length) throw new Error(r.errors.slice(0, 3).join(' | '));
}

// Teste seguro: só lê (1 evento).
async function ping() {
  await api('GET', '?maxResults=1');
  return { calendarId: config.google.calendarId, serviceAccount: (credentials() || {}).email || null };
}

async function status() {
  const c = credentials();
  const { rows: [s] } = await db.query('SELECT count(*)::int AS n, max(synced_at) AS last FROM gcal_events');
  return { configured: config.googleConfigured, validKey: Boolean(c), serviceAccount: c && c.email, calendarId: config.google.calendarId, minutes: config.google.eventMinutes, synced: s.n, last: s.last };
}

module.exports = { sync, tick, ping, status, payload, eventId, credentials, _reset: () => { cached = { token: null, until: 0 }; } };
