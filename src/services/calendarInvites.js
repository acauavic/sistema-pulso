// Convite de calendário por e-mail ao convidado: quando a gravação é marcada (Agendado, com data e e-mail no CRM) ele recebe um
// e-mail na marca com o convite (.ics). Remarcou: novo convite com o mesmo UID (o calendário dele atualiza). Cancelou: aviso de
// cancelamento. Não usa o Google (conta de serviço não convida pessoas); funciona com Gmail, Outlook e Apple Calendário.
// Desligado por padrão (Gestão > Integrações > O que vai para a agenda). Ao ligar, quem já está agendado NÃO recebe e-mail
// (fica registrado); só os próximos agendamentos e as remarcações recebem.
const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config');
const settingsSvc = require('./settings');
const mailer = require('./mailer');
const { isEmail, firstName, formatDateTime } = require('../utils/format');

const KEY = 'gcal_invite';
const CANCEL_STATUSES = new Set(['cancelado', 'perdido', 'em_agendamento', 'prospect', 'convite_enviado']); // gravado/publicado: some em silêncio

const enabled = async () => (await settingsSvc.get(KEY)) === '1';

const fold = (line) => { // linhas do .ics têm no máximo 75 caracteres; as seguintes começam com espaço
  const out = []; let rest = line;
  while (Buffer.byteLength(rest) > 74) { let n = 74; while (Buffer.byteLength(rest.slice(0, n)) > 74) n -= 1; out.push(rest.slice(0, n)); rest = ` ${rest.slice(n)}`; }
  out.push(rest); return out.join('\r\n');
};
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function ics({ guestId, name, email, start, minutes, sequence, method, address }) {
  const end = new Date(new Date(start).getTime() + minutes * 60_000);
  const organizer = config.brevo.from || 'contato@podcastpulso.com';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${config.podcastName}//Pulso Gestao//PT`, 'CALSCALE:GREGORIAN', `METHOD:${method}`,
    'BEGIN:VEVENT', `UID:gravacao-${guestId}@podcastpulso.com`, `SEQUENCE:${sequence}`, `DTSTAMP:${utc(new Date())}`, `DTSTART:${utc(start)}`, `DTEND:${utc(end)}`,
    `SUMMARY:${esc(`Gravação no ${config.podcastName}`)}`,
    ...(address ? [`LOCATION:${esc(address)}`] : []),
    `DESCRIPTION:${esc(`Gravação com ${name}. Qualquer dúvida, responda ao e-mail do convite.`)}`,
    `ORGANIZER;CN=${esc(config.podcastName)}:mailto:${organizer}`,
    `ATTENDEE;CN=${esc(name)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${email}`,
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`, 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

const hashOf = (g, minutes, address) => crypto.createHash('sha1').update([new Date(g.proposed_at).toISOString(), g.email.toLowerCase(), minutes, address].join('|')).digest('hex');

async function context() {
  const s = await settingsSvc.getMany(['lembrete_endereco', 'plateia_location']);
  const minutes = (await require('./googleCalendar').settings()).gravacao.minutes;
  return { address: s.lembrete_endereco || s.plateia_location, minutes };
}

const wanted = async () => (await db.query(
  `SELECT id, name, email, proposed_at FROM guests WHERE status = 'agendado' AND proposed_at > now() AND email IS NOT NULL AND btrim(email) <> '' ORDER BY proposed_at`)).rows
  .filter((g) => isEmail(g.email.trim())).map((g) => ({ ...g, email: g.email.trim() }));

async function deliver({ g, minutes, address, sequence, method }) {
  const body = ics({ guestId: g.id, name: g.name, email: g.email, start: g.proposed_at, minutes, sequence, method, address });
  await mailer.sendCalendarInvite({ to: g.email, guestName: g.name, whenLabel: formatDateTime(g.proposed_at), address, method, ics: body, update: sequence > 0 });
}

async function save(g, { minutes, sequence, hash, sent }) {
  await db.query(
    `INSERT INTO guest_cal_invites (guest_id, name, email, start_at, minutes, sequence, hash, sent_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
     ON CONFLICT (guest_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, start_at = EXCLUDED.start_at, minutes = EXCLUDED.minutes, sequence = EXCLUDED.sequence,
       hash = EXCLUDED.hash, sent_at = COALESCE(EXCLUDED.sent_at, guest_cal_invites.sent_at), updated_at = now()`,
    [g.id, g.name, g.email, g.proposed_at, minutes, sequence, hash, sent ? new Date() : null]);
}

// Rotina: envia o que é novo ou mudou e cancela o que deixou de valer. Devolve { sent, updated, cancelled, errors }.
async function tick() {
  const out = { sent: 0, updated: 0, cancelled: 0, errors: [] };
  if (!await enabled()) return out;
  const { address, minutes } = await context();
  const list = await wanted();
  const { rows: have } = await db.query('SELECT * FROM guest_cal_invites');
  const haveBy = new Map(have.map((r) => [r.guest_id, r]));
  for (const g of list) {
    const cur = haveBy.get(g.id); const h = hashOf(g, minutes, address);
    if (cur && cur.hash === h) continue;
    try {
      const sequence = cur ? cur.sequence + 1 : 0;
      await deliver({ g, minutes, address, sequence, method: 'REQUEST' });
      await save(g, { minutes, sequence, hash: h, sent: true });
      out[cur && cur.sent_at ? 'updated' : 'sent'] += 1;
    } catch (err) { out.errors.push(`${g.name}: ${err.message}`); }
  }
  const ids = new Set(list.map((g) => g.id));
  const { rows: status } = await db.query('SELECT id, status FROM guests WHERE id = ANY($1)', [have.map((r) => r.guest_id)]);
  const statusBy = new Map(status.map((s) => [s.id, s.status]));
  for (const r of have) {
    if (ids.has(r.guest_id)) continue;
    try {
      const st = statusBy.get(r.guest_id);
      const upcoming = new Date(r.start_at) > new Date();
      if (r.sent_at && upcoming && (!st || CANCEL_STATUSES.has(st))) {
        await deliver({ g: { id: r.guest_id, name: r.name, email: r.email, proposed_at: r.start_at }, minutes: r.minutes, address, sequence: r.sequence + 1, method: 'CANCEL' });
        out.cancelled += 1;
      }
      if (!upcoming || !st || st !== 'agendado') await db.query('DELETE FROM guest_cal_invites WHERE guest_id = $1', [r.guest_id]);
    } catch (err) { out.errors.push(`${r.name}: ${err.message}`); }
  }
  if (out.errors.length) throw new Error(out.errors.slice(0, 3).join(' | '));
  return out;
}

// Ao ligar: registra quem já está agendado sem mandar e-mail.
async function seed() {
  const { address, minutes } = await context();
  for (const g of await wanted()) await save(g, { minutes, sequence: 0, hash: hashOf(g, minutes, address), sent: false });
}

async function setEnabled(on) {
  const was = await enabled();
  if (on && !was) await seed();
  await settingsSvc.set(KEY, on ? '1' : '0');
}

module.exports = { enabled, setEnabled, tick, ics, seed };
