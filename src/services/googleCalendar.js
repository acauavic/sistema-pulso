// Google Agenda: o que tem data no painel (gravações, lembretes, tarefas, contas, posts…) vai para o calendário do Pulso Podcast,
// conforme o que a gestão liga em Gestão > Integrações, e acompanha mudanças (criar, atualizar, remover). Conta de serviço (sem
// tela de login): o calendário precisa estar compartilhado com o e-mail dela, com permissão para editar eventos.
// Reaproveita as mesmas fontes do Calendário do painel (services/calendar.js). O id do evento no Google é derivado da chave
// do item ("pulso" + hex), então repetir a rotina nunca duplica nada.
const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config');
const settingsSvc = require('./settings');
const cal = require('./calendar');
const { TZ } = require('../utils/format');

const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const WINDOW_DAYS = 240; // quanto do futuro fica no Google
const TIMED = new Set(['gravacao', 'lembrete', 'post']); // os outros tipos têm só o dia (evento de dia inteiro)
const DEFAULT_MINUTES = { gravacao: config.google.eventMinutes, lembrete: 15, post: 15 };
const ALL_USER = { id: null, role: 'superadmin' }; // vê todos os tipos, de todo mundo

const b64url = (v) => Buffer.from(v).toString('base64url');
const eventId = (key) => `pulso${Buffer.from(String(key)).toString('hex')}`; // só 0-9 e a-v, como o Google exige

// ---------------------------------------------------------------- o que vai para a agenda (Gestão > Integrações)
// { gravacao: { enabled, minutes }, ... } — só gravações ligadas por padrão.
async function settings() {
  let saved = {};
  try { saved = JSON.parse(await settingsSvc.get('gcal_types') || '{}'); } catch { /* usa o padrão */ }
  const out = {};
  for (const t of cal.TYPES) {
    const s = saved[t.key] || {};
    out[t.key] = { enabled: s.enabled !== undefined ? Boolean(s.enabled) : t.key === 'gravacao', minutes: TIMED.has(t.key) ? clampMinutes(s.minutes, DEFAULT_MINUTES[t.key]) : null };
  }
  return out;
}
const clampMinutes = (v, fallback) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 15 && n <= 720 ? n : fallback; };

// body: { on_<tipo>: 'on', min_<tipo>: '90' }
async function saveSettings(body) {
  const cur = await settings(); const next = {};
  for (const t of cal.TYPES) next[t.key] = { enabled: body[`on_${t.key}`] === 'on' || body[`on_${t.key}`] === '1', minutes: TIMED.has(t.key) ? clampMinutes(body[`min_${t.key}`], cur[t.key].minutes) : null };
  await settingsSvc.set('gcal_types', JSON.stringify(next));
  return next;
}

// ---------------------------------------------------------------- acesso à API
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
    throw new Error(`Google Agenda: ${msg}`);
  }
  return { status: res.status, json };
}

// ---------------------------------------------------------------- conteúdo do evento
const addMinutesLocal = (day, time, min) => new Date(new Date(`${day}T${time}:00Z`).getTime() + min * 60_000).toISOString().slice(0, 19); // relógio de Brasília, sem fuso no meio
const nextDay = (day) => cal.addDays(day, 1);

// e: evento do calendário do painel; extra: dados do convidado (gravações); cfg: { minutes }
function payload(e, { extra = null, address = '', minutes = 120 } = {}) {
  const lines = [];
  if (e.sub) lines.push(e.sub.charAt(0).toUpperCase() + e.sub.slice(1));
  if (e.amount) lines.push(`Valor: ${e.amount}`);
  if (extra) {
    if (extra.topic) lines.push(`Tema: ${extra.topic}`);
    if (extra.instagram) lines.push(`Instagram: @${String(extra.instagram).replace(/^@/, '')}`);
    const ok = [extra.scheduled_studio && 'estúdio', extra.scheduled_hosts && 'hosts', extra.scheduled_guest && 'convidado'].filter(Boolean);
    lines.push(`Agenda confirmada com: ${ok.length ? ok.join(', ') : 'ninguém ainda'}`);
  }
  if (e.who) lines.push(`Responsável: ${e.who}`);
  const link = `${config.appBaseUrl}${e.url}`;
  lines.push('', `Painel: ${link}`);
  const timed = e.time && TIMED.has(e.type);
  const body = {
    summary: e.type === 'gravacao' ? e.title.replace(/^Gravação: /, 'Gravação Pulso: ') : e.title,
    description: lines.join('\n'), status: 'confirmed', source: { title: 'Pulso Gestão', url: link },
    extendedProperties: { private: { pulsoKey: e.id, pulsoType: e.type } },
  };
  if (timed) {
    body.start = { dateTime: `${e.day}T${e.time}:00`, timeZone: TZ };
    body.end = { dateTime: addMinutesLocal(e.day, e.time, minutes), timeZone: TZ };
    if (e.type === 'gravacao' && address) body.location = address;
  } else {
    body.start = { date: e.day }; body.end = { date: nextDay(e.day) };
  }
  return body;
}
const hashOf = (p) => crypto.createHash('sha1').update(JSON.stringify(p)).digest('hex');

async function upsert(key, p) {
  const id = eventId(key);
  let r = await api('PATCH', `/${id}`, p);
  if (r.status === 404 || r.status === 410) {
    r = await api('POST', '', { ...p, id });
    if (r.status === 409) r = await api('PUT', `/${id}`, { ...p, id }); // evento apagado antes: o Google guarda o id
  }
  return r.json;
}

async function remove(key) {
  await api('DELETE', `/${eventId(key)}`); // 404/410 = já não existe: tudo certo
  await db.query('DELETE FROM gcal_events WHERE key = $1', [key]);
}

// ---------------------------------------------------------------- sincronização
// Deixa o calendário igual ao painel. Devolve { created, updated, removed, unchanged, errors: [texto] }.
async function sync() {
  const out = { created: 0, updated: 0, removed: 0, unchanged: 0, errors: [] };
  if (!config.googleConfigured) return out;
  const cfg = await settings();
  const today = cal.todayISO();
  const enabled = cal.TYPES.map((t) => t.key).filter((k) => cfg[k].enabled);
  const list = enabled.length ? await cal.events({ user: ALL_USER, from: today, to: cal.addDays(today, WINDOW_DAYS), types: enabled }) : [];
  const present = new Map(list.map((e) => [e.id, e]));
  const { rows: have } = await db.query("SELECT key, type, hash, to_char(day, 'YYYY-MM-DD') AS day FROM gcal_events");
  const haveBy = new Map(have.map((r) => [r.key, r]));

  const guestIds = list.filter((e) => /^gravacao-\d+$/.test(e.id)).map((e) => Number(e.id.slice(9)));
  const { rows: gs } = guestIds.length ? await db.query('SELECT id, topic, instagram, scheduled_studio, scheduled_hosts, scheduled_guest FROM guests WHERE id = ANY($1)', [guestIds]) : { rows: [] };
  const extraBy = new Map(gs.map((g) => [`gravacao-${g.id}`, g]));
  const settingsRows = await settingsSvc.getMany(['lembrete_endereco', 'plateia_location']);
  const address = settingsRows.lembrete_endereco || settingsRows.plateia_location;

  for (const e of list) {
    if (e.done) continue; // o que já foi feito fica como está no Google (histórico)
    if (e.type === 'gravacao' && e.tentative) continue; // "a confirmar com o convidado" ainda não vai para a agenda
    try {
      const p = payload(e, { extra: extraBy.get(e.id), address, minutes: (cfg[e.type] || {}).minutes || 120 });
      const h = hashOf(p); const cur = haveBy.get(e.id);
      if (cur && cur.hash === h) { out.unchanged += 1; continue; }
      const ev = await upsert(e.id, p);
      await db.query(`INSERT INTO gcal_events (key, type, day, event_id, hash, html_link, synced_at) VALUES ($1,$2,$3,$4,$5,$6,now())
                      ON CONFLICT (key) DO UPDATE SET type = EXCLUDED.type, day = EXCLUDED.day, event_id = EXCLUDED.event_id, hash = EXCLUDED.hash, html_link = EXCLUDED.html_link, synced_at = now()`,
      [e.id, e.type, e.day, eventId(e.id), h, ev.htmlLink || null]);
      out[cur ? 'updated' : 'created'] += 1;
    } catch (err) { out.errors.push(`${e.title}: ${err.message}`); }
  }

  for (const r of have) {
    const e = present.get(r.key);
    const gone = !cfg[r.type] || !cfg[r.type].enabled // tipo desligado em Integrações
      || (!e && r.day >= today) // o item deixou de existir ou de valer (convidado perdido, tarefa apagada, conta cancelada…)
      || (e && !e.done && e.type === 'gravacao' && e.tentative); // voltou para "a confirmar"
    if (!gone) continue;
    try { await remove(r.key); out.removed += 1; } catch (err) { out.errors.push(`${r.key}: ${err.message}`); }
  }
  return out;
}

// Rotina do sistema (a cada minuto). Erros viram aviso em scheduler_runs.
async function tick() {
  if (!config.googleConfigured) return;
  const r = await sync();
  if (r.errors.length) throw new Error(r.errors.slice(0, 3).join(' | '));
}

// Depois de qualquer gravação no painel (POST/PUT/DELETE bem-sucedido), sincroniza em seguida — a data mudou, o Google muda junto.
// Junta várias alterações seguidas numa volta só; se outra volta estiver rodando, ela mesma pega a mudança na próxima.
const kickDelay = { ms: 3000 };
let kickTimer = null;
function kick() {
  if (!config.googleConfigured || kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    require('./scheduler').runOnce('google-agenda', tick).catch((err) => console.error('google-agenda:', err.message));
  }, kickDelay.ms);
  if (kickTimer.unref) kickTimer.unref();
}
function kickOnWrite(req, res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && config.googleConfigured) res.on('finish', () => { if (res.statusCode < 400) kick(); });
  next();
}

// Teste seguro: só lê (1 evento).
async function ping() {
  await api('GET', '?maxResults=1');
  return { calendarId: config.google.calendarId, serviceAccount: (credentials() || {}).email || null };
}

async function status() {
  const c = credentials();
  const { rows: [s] } = await db.query('SELECT count(*)::int AS n, max(synced_at) AS last FROM gcal_events');
  return { configured: config.googleConfigured, validKey: Boolean(c), serviceAccount: c && c.email, calendarId: config.google.calendarId, synced: s.n, last: s.last };
}

module.exports = {
  sync, tick, ping, status, payload, eventId, credentials, settings, saveSettings, kick, kickOnWrite, kickDelay, TIMED, DEFAULT_MINUTES,
  _reset: () => { cached = { token: null, until: 0 }; },
};
