// Lembretes da gravação: a produtora manda ao convidado agendado pelo WhatsApp. O sistema monta a agenda dos lembretes,
// avisa na hora de cada um (notificação "lembrete") e deixa a mensagem pronta na página do convidado.
//   d3  · 3 dias antes, no horário da manhã   — lembrar a data
//   d1  · 1 dia antes, no horário da manhã    — confirmar que está tudo certo
//   dia · no dia, no horário da manhã         — lembrete com o endereço
//   h3  · 3 horas antes                       — saber se está tudo certo
// Gravação cedo (antes de manhã + 3 h): sem lembretes no dia; o de 1 dia antes leva o endereço.
// Lembrete do dia e o de 3 horas muito perto (menos de 90 min): fica só o de 3 horas, com o endereço.
const db = require('../db/pool');
const settingsSvc = require('./settings');

const TZ = 'America/Sao_Paulo';
const KINDS = {
  d3: { label: '3 dias antes', hint: 'Lembrar a data' },
  d1: { label: '1 dia antes', hint: 'Confirmar que está tudo certo' },
  dia: { label: 'No dia', hint: 'Lembrete com o endereço' },
  h3: { label: '3 horas antes', hint: 'Saber se está tudo certo' },
};
const ORDER = ['d3', 'd1', 'dia', 'h3'];
const HOUR = 3600_000;
const SETTING_KEYS = ['lembrete_endereco', 'lembrete_hora', 'lembrete_msg_d3', 'lembrete_msg_d1', 'lembrete_msg_dia', 'lembrete_msg_h3', 'plateia_location'];

async function settings() {
  const s = await settingsSvc.getMany(SETTING_KEYS);
  return {
    address: s.lembrete_endereco || s.plateia_location, addressSet: Boolean(s.lembrete_endereco),
    morning: /^\d{2}:\d{2}$/.test(s.lembrete_hora) ? s.lembrete_hora : '09:00',
    messages: { d3: s.lembrete_msg_d3, d1: s.lembrete_msg_d1, dia: s.lembrete_msg_dia, h3: s.lembrete_msg_h3 },
  };
}

// Dia da gravação em Brasília (-03:00 fixo) + deslocamento em dias, no horário "HH:MM".
function at(recording, dayOffset, hhmm) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(recording);
  const base = new Date(`${day}T${hhmm}:00-03:00`);
  return new Date(base.getTime() + dayOffset * 24 * HOUR);
}

// Plano de lembretes para uma gravação: [{ kind, due, until, withAddress }], já sem os que perderam a hora
// (cada lembrete vale até a hora do próximo; o último, até a gravação).
function plan(recording, { morning = '09:00', now = new Date() } = {}) {
  const rec = new Date(recording);
  const morningOfDay = at(rec, 0, morning);
  const items = [{ kind: 'd3', due: at(rec, -3, morning) }, { kind: 'd1', due: at(rec, -1, morning) }];
  const h3 = new Date(rec.getTime() - 3 * HOUR);
  if (h3 < morningOfDay) items[1].withAddress = true; // gravação cedo: só até o dia anterior
  else if (h3 - morningOfDay < 1.5 * HOUR) items.push({ kind: 'h3', due: h3, withAddress: true });
  else items.push({ kind: 'dia', due: morningOfDay }, { kind: 'h3', due: h3 });
  return items
    .map((it, i) => ({ withAddress: false, ...it, until: items[i + 1] ? items[i + 1].due : rec }))
    .filter((it) => now < it.until);
}

const fmtPart = (d, o) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, ...o }).format(d);
function hourLabel(d) {
  const [h, m] = fmtPart(d, { hour: '2-digit', minute: '2-digit', hour12: false }).split(':');
  return `${Number(h)}h${m === '00' ? '' : m}`;
}

// Texto pronto para o WhatsApp.
function message(kind, guest, s, { withAddress = false } = {}) {
  const rec = new Date(guest.proposed_at);
  const vars = {
    nome: guest.name, primeiro_nome: String(guest.name || '').replace(/^(dr|dra)\.?\s+/i, '').split(/\s+/)[0] || guest.name,
    dia: fmtPart(rec, { weekday: 'long' }), data: fmtPart(rec, { day: '2-digit', month: '2-digit' }), hora: hourLabel(rec), endereco: s.address,
  };
  let text = String(s.messages[kind] || '').replace(/\{(\w+)\}/g, (all, k) => (k in vars ? vars[k] : all));
  if (withAddress && !s.messages[kind].includes('{endereco}')) text += `\n\nEndereço: ${s.address}`;
  return text;
}

// WhatsApp do convidado: só dígitos; número brasileiro sem DDI ganha o 55.
function whatsappNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return null;
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

// Acompanha a etapa e a data do convidado. Idempotente: chamado depois de qualquer mudança.
async function syncGuest(guestId) {
  const { rows: [g] } = await db.query('SELECT id, status, proposed_at FROM guests WHERE id = $1', [guestId]);
  if (!g) return;
  const live = g.status === 'agendado' && g.proposed_at && g.proposed_at > new Date();
  if (!live) { // saiu de Agendado ou a gravação passou: o que não foi enviado não vale mais
    await db.query('DELETE FROM guest_reminders WHERE guest_id = $1 AND sent_at IS NULL', [g.id]);
    return;
  }
  // remarcou: os lembretes da data antiga (enviados ou não) saem e o ciclo recomeça
  await db.query('DELETE FROM guest_reminders WHERE guest_id = $1 AND recording_at <> $2', [g.id, g.proposed_at]);
  const items = plan(g.proposed_at, { morning: (await settings()).morning });
  await db.query('DELETE FROM guest_reminders WHERE guest_id = $1 AND sent_at IS NULL AND NOT (kind = ANY($2))', [g.id, items.map((i) => i.kind)]);
  for (const it of items) {
    await db.query(
      `INSERT INTO guest_reminders (guest_id, kind, due_at, recording_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (guest_id, kind) DO UPDATE SET due_at = EXCLUDED.due_at WHERE guest_reminders.sent_at IS NULL`,
      [g.id, it.kind, it.due, g.proposed_at]);
  }
}

// Mudou o horário da manhã: refaz a agenda de quem está agendado.
async function resyncAll() {
  const { rows } = await db.query("SELECT id FROM guests WHERE status = 'agendado' AND proposed_at > now()");
  for (const r of rows) await syncGuest(r.id);
}

// Monta os lembretes de um convidado a partir das linhas de guest_reminders (compartilhado pela página do convidado e pela fila).
// Estados: enviado · agora (hora chegou e ainda vale) · agendado (vem aí) · passou (a hora do próximo chegou sem envio).
function build(guest, rows, s, now = new Date()) {
  if (guest.status !== 'agendado' || !guest.proposed_at) return [];
  const byKind = Object.fromEntries(rows.filter((r) => r.recording_at.getTime() === guest.proposed_at.getTime()).map((r) => [r.kind, r]));
  const full = plan(guest.proposed_at, { morning: s.morning, now: new Date(0) }); // o plano inteiro, inclusive o que já passou
  const list = full.filter((it) => byKind[it.kind]).map((it) => {
    const r = byKind[it.kind];
    const state = r.sent_at ? 'enviado' : now >= it.until ? 'passou' : now >= r.due_at ? 'agora' : 'agendado';
    return { ...it, ...KINDS[it.kind], id: r.id, due: r.due_at, sentAt: r.sent_at, sentBy: r.sent_by_name, state, text: message(it.kind, guest, s, it) };
  });
  const current = list.find((it) => it.state === 'agora') || list.find((it) => it.state === 'agendado') || null;
  const phone = whatsappNumber(guest.phone);
  return list.map((it) => ({ ...it, current: it === current, waUrl: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(it.text)}` : null }));
}

// Lembretes da página do convidado.
async function forGuest(guest) {
  if (guest.status !== 'agendado' || !guest.proposed_at) return [];
  const { rows } = await db.query(
    'SELECT r.*, u.name AS sent_by_name FROM guest_reminders r LEFT JOIN users u ON u.id = r.sent_by WHERE r.guest_id = $1', [guest.id]);
  return build(guest, rows, await settings());
}

// Fila de Notificações > Lembretes: o que está na hora, o que vem aí (o próximo de cada convidado) e o que foi enviado há pouco.
async function queue() {
  const s = await settings();
  const { rows: guests } = await db.query(
    `SELECT g.id, g.name, g.phone, g.status, g.proposed_at, g.owner_id, u.name AS owner_name FROM guests g LEFT JOIN users u ON u.id = g.owner_id
      WHERE g.status = 'agendado' AND g.proposed_at > now() ORDER BY g.proposed_at LIMIT 100`);
  const { rows: all } = guests.length ? await db.query(
    'SELECT r.*, u.name AS sent_by_name FROM guest_reminders r LEFT JOIN users u ON u.id = r.sent_by WHERE r.guest_id = ANY($1)', [guests.map((g) => g.id)]) : { rows: [] };
  const items = guests.flatMap((g) => build(g, all.filter((r) => r.guest_id === g.id), s).map((it) => ({ ...it, guest: g })));
  const { rows: recent } = await db.query(
    `SELECT r.kind, r.sent_at, g.id AS guest_id, g.name, g.proposed_at, u.name AS sent_by_name FROM guest_reminders r JOIN guests g ON g.id = r.guest_id
       LEFT JOIN users u ON u.id = r.sent_by WHERE r.sent_at > now() - interval '7 days' ORDER BY r.sent_at DESC LIMIT 20`);
  return {
    now: items.filter((it) => it.state === 'agora').sort((a, b) => a.due - b.due),
    next: items.filter((it) => it.state === 'agendado' && it.current).sort((a, b) => a.due - b.due),
    sent: recent.map((r) => ({ ...KINDS[r.kind], kind: r.kind, sentAt: r.sent_at, sentBy: r.sent_by_name, guest: { id: r.guest_id, name: r.name, proposed_at: r.proposed_at } })),
  };
}

async function markSent(guestId, kind, user) {
  const { rows: [r] } = await db.query(
    `UPDATE guest_reminders SET sent_at = coalesce(sent_at, now()), sent_by = coalesce(sent_by, $3)
      WHERE guest_id = $1 AND kind = $2 RETURNING *`, [guestId, kind, user.id]);
  if (r) await require('./guests').addEvent(guestId, user.id, 'lembrete', `Lembrete enviado (${KINDS[kind].label})`);
  return r || null;
}

// Rotina: chegou a hora de um lembrete ainda não enviado -> avisa quem cuida do convidado e a produção (uma vez).
async function tick() {
  const { rows } = await db.query(
    `SELECT r.id, r.kind, g.id AS guest_id, g.name, g.owner_id, g.proposed_at FROM guest_reminders r JOIN guests g ON g.id = r.guest_id
      WHERE r.due_at <= now() AND r.notified_at IS NULL AND r.sent_at IS NULL
        AND g.status = 'agendado' AND g.proposed_at = r.recording_at AND g.proposed_at > now()
      ORDER BY r.due_at LIMIT 200`);
  const notify = require('./notify');
  for (const r of rows) {
    await notify.notify({
      type: 'lembrete', users: [r.owner_id], broadcast: true,
      title: `Lembrete de ${KINDS[r.kind].label.toLowerCase()}: ${r.name}`,
      body: `Gravação ${fmtPart(r.proposed_at, { weekday: 'short', day: '2-digit', month: '2-digit' })} às ${hourLabel(r.proposed_at)}. A mensagem está pronta na página do convidado.`,
      url: '/notificacoes/lembretes', entity: { type: 'guest', id: r.guest_id }, dedupe: `lembrete-${r.id}`,
    });
    await db.query('UPDATE guest_reminders SET notified_at = now() WHERE id = $1', [r.id]);
  }
  return { avisados: rows.length };
}

module.exports = { KINDS, ORDER, SETTING_KEYS, settings, plan, message, whatsappNumber, syncGuest, resyncAll, build, forGuest, queue, markSent, tick, hourLabel };
