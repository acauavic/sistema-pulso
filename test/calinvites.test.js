const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const mailer = require('../src/services/mailer');
const invites = require('../src/services/calendarInvites');
const cal = require('../src/services/calendar');

describe('convite de calendário por e-mail ao convidado', () => {
  const day = (n) => cal.addDays(cal.todayISO(), n);
  const q = (sql, p) => h.db.query(sql, p);
  const guest = async (name, email, status = 'agendado', at = `${day(20)} 14:00-03`) => (await q("INSERT INTO guests (name, email, profile, status, proposed_at) VALUES ($1, $2, 'medico', $3, $4) RETURNING id", [name, email, status, at])).rows[0].id;
  const sent = (to) => mailer.outbox.filter((m) => m.to === to);
  let app; let admin;

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    await h.createUser({ name: 'Ana Admin', email: 'adm@t.com', role: 'superadmin' });
    admin = h.client(app.base); await admin.login('adm@t.com');
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('desligado por padrão: nada é enviado', async () => {
    await guest('Antiga Agendada', 'antiga@ex.com');
    assert.equal(await invites.enabled(), false);
    await invites.tick();
    assert.equal(sent('antiga@ex.com').length, 0);
  });

  it('ao ligar, quem já está agendado não recebe; o próximo agendamento recebe o convite com .ics', async () => {
    const r = await admin.act('/integracoes/google/tipos', { on_gravacao: 'on', min_gravacao: '90', invite: 'on' }, { from: '/integracoes' });
    assert.equal(r.status, 302); assert.equal(await invites.enabled(), true);
    await invites.tick();
    assert.equal(sent('antiga@ex.com').length, 0, 'quem já existia não recebe');

    const id = await guest('Nova Marcada', 'nova@ex.com');
    await guest('Sem Email', null);
    await guest('Em Agendamento', 'ema@ex.com', 'em_agendamento');
    const out = await invites.tick();
    assert.equal(out.sent, 1);
    const [mail] = sent('nova@ex.com');
    assert.ok(mail && /Convite: gravação no/.test(mail.subject), mail && mail.subject);
    assert.equal(mail.icalEvent.method, 'REQUEST');
    const ics = mail.icalEvent.content;
    assert.match(ics, new RegExp(`UID:gravacao-${id}@podcastpulso.com`)); assert.match(ics, /SEQUENCE:0/); assert.match(ics, /ATTENDEE;CN=Nova Marcada.*mailto:nova@ex.com/);
    const t0 = new Date(`${day(20)}T14:00:00-03:00`);
    assert.match(ics, new RegExp(`DTSTART:${t0.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`));
    assert.match(ics, new RegExp(`DTEND:${new Date(t0.getTime() + 90 * 60000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`), 'duração configurada: 90 min');
    assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'linhas dobradas em 75 bytes');
    assert.equal(sent('ema@ex.com').length, 0); assert.equal((await invites.tick()).sent, 0, 'não repete');
  });

  it('remarcou: novo convite com o mesmo UID e sequência maior; cancelou: aviso de cancelamento', async () => {
    const { rows: [g] } = await q("SELECT id FROM guests WHERE email = 'nova@ex.com'");
    await q('UPDATE guests SET proposed_at = $2 WHERE id = $1', [g.id, `${day(22)} 10:00-03`]);
    const out = await invites.tick(); assert.equal(out.updated, 1);
    const upd = sent('nova@ex.com')[1];
    assert.match(upd.subject, /Nova data/); assert.match(upd.icalEvent.content, /SEQUENCE:1/); assert.match(upd.icalEvent.content, new RegExp(`UID:gravacao-${g.id}@`));

    await q("UPDATE guests SET status = 'perdido', loss_reason = 'sem_agenda' WHERE id = $1", [g.id]);
    const c = await invites.tick(); assert.equal(c.cancelled, 1);
    const cancel = sent('nova@ex.com')[2];
    assert.equal(cancel.icalEvent.method, 'CANCEL'); assert.match(cancel.icalEvent.content, /STATUS:CANCELLED/); assert.match(cancel.icalEvent.content, /SEQUENCE:2/);
    assert.equal((await q('SELECT 1 FROM guest_cal_invites WHERE guest_id = $1', [g.id])).rowCount, 0);
    assert.equal((await invites.tick()).cancelled, 0);
  });

  it('gravado antes da hora não manda cancelamento; desligar para de enviar', async () => {
    const id = await guest('Gravou Cedo', 'cedo@ex.com'); await invites.tick();
    assert.equal(sent('cedo@ex.com').length, 1);
    await q("UPDATE guests SET status = 'gravado' WHERE id = $1", [id]);
    await invites.tick(); assert.equal(sent('cedo@ex.com').length, 1, 'sem cancelamento');
    await admin.act('/integracoes/google/tipos', { on_gravacao: 'on' }, { from: '/integracoes' });
    assert.equal(await invites.enabled(), false);
    await guest('Depois Desligado', 'depois@ex.com'); await invites.tick();
    assert.equal(sent('depois@ex.com').length, 0);
  });
});
