// Reuniões com patrocinador: marcadas no cadastro (aba Reuniões), criadas no Google Agenda "Pulso Podcast" EM NOME da conta do
// Workspace (GOOGLE_IMPERSONATE, delegação em todo o domínio): assim o próprio Google manda o convite, cria o Meet e recolhe as
// respostas. Sem a conta de serviço agir em nome de alguém, o Google recusa convidados e Meet (verificado em 11/11/2026).
// Ordem: a reunião é gravada aqui primeiro e só depois vai ao Google; se o Google falhar, nada se perde (estado "erro" + Tentar de novo).
// A volta do Google (tick, a cada 15 min): horário mudado lá, Meet criado lá, respostas dos convidados, cancelamento.
// O resumo: saveSummary (à mão hoje; o webhook de um sistema externo vai chamar a mesma função).
const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config');
const gcal = require('./googleCalendar');
const richText = require('./richText');
const { TZ, isEmail, formatDateTime } = require('../utils/format');

const DURATIONS = [30, 45, 60, 90];
const MODES = { meet: 'Google Meet', presencial: 'Presencial' };
const RESPONSES = { accepted: 'confirmou', declined: 'recusou', tentative: 'talvez', needsAction: 'sem resposta' };
const MAX_EMAILS = 20;
const WAITING = 'A conta do Pulso ainda não autorizou convites e Meet (Gestão > Integrações).';

const addEvent = (sponsorId, userId, message) => require('./sponsors').addEvent(sponsorId, userId, 'reuniao', message);
const when = (d) => formatDateTime(d);

// ---------------------------------------------------------------- entrada
// Texto com e-mails separados por vírgula, espaço, ponto e vírgula ou linha: válidos, sem repetir, em minúsculas.
function emailsFrom(text) {
  const out = [];
  for (const raw of String(text || '').split(/[\s,;]+/)) {
    const e = raw.trim().replace(/^<|>$/g, '').toLowerCase();
    if (e && isEmail(e) && !out.includes(e)) out.push(e);
  }
  return out;
}

// Formulário -> input. body: { titulo, pauta, inicio (datetime-local, Brasília), duracao, formato, local, emails, responsavel, equipe }
function parseInput(body, sponsor) {
  const team = [].concat(body.equipe || []).map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
  return {
    title: String(body.titulo || '').trim() || `Reunião · ${sponsor.company}`,
    agenda: String(body.pauta || '').trim() || null,
    startsAt: require('../utils/format').parseInputDateTime(String(body.inicio || '')),
    minutes: Number(body.duracao) || 45,
    mode: body.formato === 'presencial' ? 'presencial' : 'meet',
    location: String(body.local || '').trim() || null,
    emails: emailsFrom(body.emails),
    rawEmails: String(body.emails || ''),
    ownerId: /^[0-9a-f-]{36}$/i.test(String(body.responsavel || '')) ? String(body.responsavel) : null,
    teamIds: [...new Set(team)],
  };
}

function validate(input, { allowPast = false } = {}) {
  if (!input.startsAt) return 'Escolha a data e o horário.';
  if (!allowPast && input.startsAt.getTime() < Date.now() - 5 * 60_000) return 'Esse horário já passou: escolha um horário à frente.';
  if (!(input.minutes >= 15 && input.minutes <= 240)) return 'A duração vai de 15 minutos a 4 horas.';
  if (input.title.length > 200) return 'Assunto longo demais (até 200 caracteres).';
  if (input.agenda && input.agenda.length > 2000) return 'Pauta longa demais (até 2.000 caracteres).';
  if (input.mode === 'presencial' && !input.location) return 'Reunião presencial: informe o endereço.';
  if (!input.emails.length) return input.rawEmails && input.rawEmails.trim() ? 'Nenhum e-mail válido nos convidados.' : 'Informe pelo menos um e-mail do patrocinador para o convite.';
  if (input.emails.length > MAX_EMAILS) return `No máximo ${MAX_EMAILS} convidados.`;
  if (!input.ownerId) return 'Escolha o responsável.';
  return null;
}

// ---------------------------------------------------------------- Google
// Erro do Google -> frase para a equipe.
function googleReason(err) {
  const m = String(err && err.message || err || '');
  if (err && err.google === 'unauthorized_client' || /unauthorized_client|Domain-Wide Delegation|cannot invite attendees/i.test(m)) return `${WAITING} Falta a delegação no Admin do Google Workspace.`;
  if (/invalid_grant|Invalid email or User ID/i.test(m)) return 'O e-mail da conta do Pulso (GOOGLE_IMPERSONATE) não existe no Google Workspace.';
  if (err && (err.status === 403 || err.status === 404) || /forbidden|writer access|not found/i.test(m)) return 'A conta do Pulso não tem permissão para editar o calendário Pulso Podcast no Google.';
  if (/conference/i.test(m)) return 'O Google não criou o link do Meet. Tente "Criar link do Meet" ou crie direto no Google Agenda.';
  if (err && err.status >= 500 || /timeout|aborted|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|\b5\d\d\b/i.test(m)) return 'O Google não respondeu agora. Tentamos de novo sozinhos em até 15 minutos.';
  return `O Google recusou: ${m.replace(/^Google Agenda:\s*/, '').slice(0, 200)}`;
}

const usersOf = async (ids) => (ids.length ? (await db.query('SELECT id, name, email FROM users WHERE id = ANY($1::uuid[]) AND active', [ids])).rows : []);
const teamEmails = async (m) => (await usersOf([m.owner_id, ...(m.team_ids || [])].filter(Boolean))).map((u) => String(u.email).toLowerCase());

async function eventBody(m, { withMeet = false } = {}) {
  const { rows: [s] } = await db.query('SELECT company FROM sponsors WHERE id = $1', [m.sponsor_id]);
  const team = await usersOf([m.owner_id, ...(m.team_ids || [])].filter(Boolean));
  const start = new Date(m.starts_at); const end = new Date(start.getTime() + m.minutes * 60_000);
  // a descrição é vista pelo patrocinador: só a pauta e a assinatura (nada do painel interno)
  const description = [m.agenda, `${config.podcastName}${s ? ` · ${s.company}` : ''}`].filter(Boolean).join('\n\n');
  const emails = new Set();
  const attendees = [];
  for (const a of m.attendees || []) if (!emails.has(a.email)) { emails.add(a.email); attendees.push({ email: a.email }); }
  for (const u of team) { const e = String(u.email).toLowerCase(); if (!emails.has(e)) { emails.add(e); attendees.push({ email: e, displayName: u.name }); } }
  return {
    summary: m.title, description, status: 'confirmed',
    start: { dateTime: start.toISOString(), timeZone: TZ }, end: { dateTime: end.toISOString(), timeZone: TZ },
    location: m.mode === 'presencial' ? m.location : null,
    attendees, guestsCanModify: false, guestsCanInviteOthers: false,
    extendedProperties: { private: { pulsoMeeting: String(m.id) } },
    ...(withMeet ? { conferenceData: { createRequest: { requestId: `pulso-${m.id}-${crypto.randomBytes(4).toString('hex')}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
  };
}

const ORG = (send = 'all') => ({ organizer: true, query: { conferenceDataVersion: 1, sendUpdates: send } });

async function setGoogle(id, fields) {
  const keys = Object.keys(fields);
  const { rows: [m] } = await db.query(
    `UPDATE sponsor_meetings SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...keys.map((k) => fields[k])]);
  return m;
}

// Leva a reunião ao Google (cria ou atualiza tudo). Devolve a reunião como ficou. Nunca lança: o erro fica na reunião.
async function push(m) {
  if (!config.googleMeetConfigured) return setGoogle(m.id, { google_state: 'pendente', google_error: config.googleConfigured ? WAITING : 'Google Agenda não configurado.' });
  try {
    const body = await eventBody(m, { withMeet: m.mode === 'meet' && !m.meet_url });
    let r;
    if (m.google_event_id) {
      r = await gcal.api('PATCH', `/${encodeURIComponent(m.google_event_id)}`, body, ORG());
      if (r.status === 404 || r.status === 410) r = null; // apagado no Google: cria de novo
    }
    if (!r) r = await gcal.api('POST', '', body, ORG());
    if (r.status >= 400) throw Object.assign(new Error(`Google Agenda: HTTP ${r.status}`), { status: r.status });
    return setGoogle(m.id, { google_event_id: r.json.id, google_state: 'ok', google_error: null, synced_at: new Date(), meet_url: r.json.hangoutLink || (m.mode === 'meet' ? m.meet_url : null) });
  } catch (err) {
    console.warn(`[reunião ${m.id}] Google: ${err.message}`);
    return setGoogle(m.id, { google_state: 'erro', google_error: googleReason(err) });
  }
}

// ---------------------------------------------------------------- ações
const get = async (id) => (await db.query('SELECT * FROM sponsor_meetings WHERE id = $1', [id])).rows[0] || null;

async function create(sponsorId, input, user) {
  const error = validate(input);
  if (error) return { error };
  const { rows: [m] } = await db.query(
    `INSERT INTO sponsor_meetings (sponsor_id, title, agenda, starts_at, minutes, mode, location, attendees, owner_id, team_ids, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [sponsorId, input.title, input.agenda, input.startsAt, input.minutes, input.mode, input.mode === 'presencial' ? input.location : null,
      JSON.stringify(input.emails.map((email) => ({ email, response: 'needsAction' }))), input.ownerId, input.teamIds.filter((t) => t !== input.ownerId), user?.id || null]);
  await addEvent(sponsorId, user?.id, `Reunião marcada para ${when(m.starts_at)} (${MODES[m.mode]}).`);
  return { meeting: await push(m) };
}

async function update(id, input, user) {
  const cur = await get(id);
  if (!cur || cur.status !== 'marcada') return { error: 'Esta reunião não pode mais ser alterada.' };
  const error = validate(input);
  if (error) return { error };
  const byEmail = new Map((cur.attendees || []).map((a) => [a.email, a]));
  const moved = new Date(cur.starts_at).getTime() !== input.startsAt.getTime() || cur.minutes !== input.minutes;
  const { rows: [m] } = await db.query(
    `UPDATE sponsor_meetings SET title = $2, agenda = $3, starts_at = $4, minutes = $5, mode = $6, location = $7, attendees = $8, owner_id = $9, team_ids = $10,
            meet_url = CASE WHEN $6 = 'presencial' THEN NULL ELSE meet_url END, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, input.title, input.agenda, input.startsAt, input.minutes, input.mode, input.mode === 'presencial' ? input.location : null,
      JSON.stringify(input.emails.map((email) => ({ email, response: moved ? 'needsAction' : (byEmail.get(email)?.response || 'needsAction') }))), input.ownerId, input.teamIds.filter((t) => t !== input.ownerId)]);
  await addEvent(m.sponsor_id, user?.id, moved ? `Reunião remarcada para ${when(m.starts_at)}.` : 'Reunião alterada (convidados, local ou pauta).');
  return { meeting: await push(m) };
}

async function cancel(id, user) {
  const cur = await get(id);
  if (!cur || cur.status !== 'marcada') return { error: 'Esta reunião já não está marcada.' };
  const m = await setGoogle(id, { status: 'cancelada' });
  await addEvent(m.sponsor_id, user?.id, `Reunião de ${when(m.starts_at)} cancelada.`);
  if (m.google_event_id && config.googleMeetConfigured) {
    try { await gcal.api('PATCH', `/${encodeURIComponent(m.google_event_id)}`, { status: 'cancelled' }, ORG()); } catch (err) {
      console.warn(`[reunião ${m.id}] cancelar no Google: ${err.message}`);
      return { meeting: await setGoogle(id, { google_state: 'erro', google_error: `Cancelada aqui, mas não no Google: ${googleReason(err)}` }) };
    }
  }
  return { meeting: m };
}

async function addMeet(id, user) {
  const cur = await get(id);
  if (!cur || cur.status !== 'marcada') return { error: 'Esta reunião já não está marcada.' };
  const m = await setGoogle(id, { mode: 'meet', location: null });
  const done = await push({ ...m, meet_url: null });
  if (done.meet_url) await addEvent(m.sponsor_id, user?.id, 'Link do Meet criado.');
  return { meeting: done };
}

async function retry(id) {
  const cur = await get(id);
  if (!cur || cur.status !== 'marcada') return { error: 'Esta reunião já não está marcada.' };
  return { meeting: await push(cur) };
}

// HTML do editor rico (sanitizado). source: 'manual' | 'webhook'. Vazio apaga.
async function saveSummary(id, html, { source = 'manual', user = null } = {}) {
  const cur = await get(id);
  if (!cur) return { error: 'Reunião não encontrada.' };
  const clean = html && !richText.isEmpty(html) ? richText.sanitize(html) : null;
  const m = await setGoogle(id, { summary: clean, summary_source: clean ? source : null, summary_at: clean ? new Date() : null, summary_by: clean ? user?.id || null : null });
  if (clean && !cur.summary) await addEvent(m.sponsor_id, user?.id, `Resumo da reunião de ${when(m.starts_at)} registrado${source === 'webhook' ? ' automaticamente' : ''}.`);
  return { meeting: m };
}

// ---------------------------------------------------------------- volta do Google
// Para cada reunião marcada (de ontem até 60 dias) já no Google: horário, Meet, convidados e respostas, cancelamento.
async function syncFromGoogle() {
  if (!config.googleMeetConfigured) return { checked: 0, changed: 0 };
  const { rows } = await db.query(
    `SELECT * FROM sponsor_meetings WHERE status = 'marcada' AND google_event_id IS NOT NULL
        AND starts_at BETWEEN now() - interval '1 day' AND now() + interval '60 days' ORDER BY starts_at LIMIT 100`);
  let changed = 0;
  for (const m of rows) {
    try {
      const r = await gcal.api('GET', `/${encodeURIComponent(m.google_event_id)}`, null, { organizer: true });
      if (r.status === 404 || r.status === 410 || r.json.status === 'cancelled') {
        await setGoogle(m.id, { status: 'cancelada', synced_at: new Date() });
        await addEvent(m.sponsor_id, null, `Reunião de ${when(m.starts_at)} cancelada no Google Agenda.`);
        changed += 1; continue;
      }
      const ev = r.json; const fields = { synced_at: new Date() };
      const start = ev.start?.dateTime ? new Date(ev.start.dateTime) : null; const end = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;
      const notes = [];
      if (start && start.getTime() !== new Date(m.starts_at).getTime()) { fields.starts_at = start; notes.push(`remarcada no Google Agenda para ${when(start)}`); }
      if (start && end) { const min = Math.min(240, Math.max(15, Math.round((end - start) / 60_000))); if (min !== m.minutes) fields.minutes = min; }
      if (ev.hangoutLink && ev.hangoutLink !== m.meet_url) { fields.meet_url = ev.hangoutLink; if (!m.meet_url) notes.push('link do Meet criado no Google Agenda'); }
      const ours = new Set(await teamEmails(m));
      const attendees = (ev.attendees || []).filter((a) => !a.resource && !a.organizer && !a.self && !ours.has(String(a.email).toLowerCase()))
        .map((a) => ({ email: String(a.email).toLowerCase(), response: RESPONSES[a.responseStatus] ? a.responseStatus : 'needsAction' }));
      const before = JSON.stringify(m.attendees || []);
      if (ev.attendees && JSON.stringify(attendees) !== before) {
        fields.attendees = JSON.stringify(attendees);
        for (const a of attendees) {
          const old = (m.attendees || []).find((x) => x.email === a.email);
          if (old && old.response !== a.response && (a.response === 'accepted' || a.response === 'declined')) notes.push(`${a.email} ${RESPONSES[a.response]}`);
        }
      }
      await setGoogle(m.id, fields);
      if (notes.length) { changed += 1; await addEvent(m.sponsor_id, null, `Reunião de ${when(m.starts_at)}: ${notes.join('; ')}.`); }
    } catch (err) { console.warn(`[reunião ${m.id}] volta do Google: ${err.message}`); }
  }
  return { checked: rows.length, changed };
}

// Rotina (15 min): manda de novo o que ficou pendente ou com erro (reuniões futuras) e lê o que mudou no Google.
async function tick() {
  if (!config.googleMeetConfigured) return { retried: 0 };
  const { rows } = await db.query(
    `SELECT * FROM sponsor_meetings WHERE status = 'marcada' AND google_state IN ('pendente', 'erro') AND starts_at > now() - interval '1 hour'
      ORDER BY starts_at LIMIT 10`);
  for (const m of rows) await push(m);
  const s = await syncFromGoogle();
  return { retried: rows.length, ...s };
}

// ---------------------------------------------------------------- leitura
async function listFor(sponsorId) {
  const { rows } = await db.query(
    `SELECT m.*, u.name AS owner_name, sb.name AS summary_by_name,
            coalesce((SELECT array_agg(t.name ORDER BY t.name) FROM users t WHERE t.id = ANY(m.team_ids)), '{}') AS team_names
       FROM sponsor_meetings m LEFT JOIN users u ON u.id = m.owner_id LEFT JOIN users sb ON sb.id = m.summary_by
      WHERE m.sponsor_id = $1 ORDER BY m.starts_at`, [sponsorId]);
  const now = Date.now();
  const isUpcoming = (m) => m.status === 'marcada' && new Date(m.starts_at).getTime() + m.minutes * 60_000 > now;
  return { upcoming: rows.filter(isUpcoming), past: rows.filter((m) => !isUpcoming(m)).reverse() };
}

// Teste de Integrações: cria um evento daqui a um ano com Meet e um convidado fictício, remarca, lê e apaga (sem e-mail a ninguém).
async function check() {
  if (!config.googleMeetConfigured) return { ok: false, error: config.googleConfigured ? WAITING : 'Google Agenda não configurado.' };
  let id = null;
  try {
    const start = new Date(Math.ceil((Date.now() + 365 * 86_400_000) / 60_000) * 60_000); const end = new Date(start.getTime() + 30 * 60_000); // minuto cheio: o Google não guarda milissegundos
    const body = { summary: 'Teste do Pulso Gestão (pode apagar)', start: { dateTime: start.toISOString(), timeZone: TZ }, end: { dateTime: end.toISOString(), timeZone: TZ }, attendees: [{ email: 'teste-pulso@example.com' }], conferenceData: { createRequest: { requestId: `pulso-teste-${crypto.randomBytes(4).toString('hex')}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } } };
    const c = await gcal.api('POST', '', body, ORG('none'));
    if (c.status >= 400) throw Object.assign(new Error(`Google Agenda: HTTP ${c.status}`), { status: c.status });
    id = c.json.id;
    const later = new Date(start.getTime() + 30 * 60_000);
    await gcal.api('PATCH', `/${encodeURIComponent(id)}`, { start: { dateTime: later.toISOString(), timeZone: TZ }, end: { dateTime: new Date(later.getTime() + 30 * 60_000).toISOString(), timeZone: TZ } }, ORG('none'));
    const g = await gcal.api('GET', `/${encodeURIComponent(id)}`, null, { organizer: true });
    const meet = Boolean(g.json.hangoutLink || c.json.hangoutLink);
    return { ok: true, meet, invite: (g.json.attendees || []).length > 0, moved: new Date(g.json.start?.dateTime).getTime() === later.getTime() };
  } catch (err) {
    return { ok: false, error: googleReason(err) };
  } finally {
    if (id) await gcal.api('DELETE', `/${encodeURIComponent(id)}`, null, { organizer: true, query: { sendUpdates: 'none' } }).catch(() => {});
  }
}

module.exports = { DURATIONS, MODES, RESPONSES, WAITING, emailsFrom, parseInput, validate, googleReason, eventBody, create, update, cancel, addMeet, retry, saveSummary, syncFromGoogle, tick, listFor, check, get };
