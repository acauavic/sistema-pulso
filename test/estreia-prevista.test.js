// Estreia prevista do convidado (preenchida a partir de Agendado, antes de o episódio existir) vale em todo calendário de publicação:
// media kit, portal do patrocinador, Calendário do sistema e portal do convidado. Quando o episódio nasce, ela vira a data dele.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const cal = require('../src/services/calendar');
const sponsorsSvc = require('../src/services/sponsors');
const guestPortal = require('../src/services/guestPortal');
const prod = require('../src/services/production');

describe('Estreia prevista antes do episódio', () => {
  let admin; let guest; let sponsor;
  const premiere = cal.addDays(cal.todayISO(), 10);
  const q = (sql, p) => h.db.query(sql, p);

  before(async () => {
    await h.resetDb();
    admin = await h.createUser({ name: 'Ana Admin', email: 'a@t.com', role: 'superadmin' });
    guest = (await q("INSERT INTO guests (name, instagram, profile, status, proposed_at, premiere_on) VALUES ('Dra. Estreia', 'dra.estreia', 'medico', 'agendado', now() + interval '3 days', $1) RETURNING id", [premiere])).rows[0].id;
    await q("INSERT INTO guests (name, instagram, profile, status, proposed_at) VALUES ('Dr. Só Gravação', 'dr.gravacao', 'medico', 'agendado', now() + interval '4 days')");
    sponsor = (await q("INSERT INTO sponsors (company, stage) VALUES ('Marca Exclusiva', 'ativo') RETURNING *")).rows[0];
    await q("INSERT INTO sponsor_bookings (sponsor_id, guest_id, role) VALUES ($1, $2, 'exclusivo')", [sponsor.id, guest]);
  });
  after(async () => { await h.db.close(); });

  it('media kit: o agendado com estreia prevista aparece como ESTREIA; sem estreia, como GRAVAÇÃO', async () => {
    const html = await sponsorsSvc.kitAgendaHtml();
    const card = (name) => html.slice(html.indexOf(`data-name="${name}"`), html.indexOf('</button>', html.indexOf(`data-name="${name}"`)));
    assert.match(card('Dra. Estreia'), /Estreia em/);
    assert.match(card('Dr. Só Gravação'), /Gravação em/);
  });

  it('portal do patrocinador: a gravação reservada mostra a estreia prevista', async () => {
    const { episodes } = await sponsorsSvc.portalData(sponsor);
    const b = episodes.find((e) => e.guest_id === guest);
    assert.equal(new Date(b.aired_on).toISOString().slice(0, 10), premiere); assert.equal(b.premiere, true);
  });

  it('Calendário: entra como publicação prevista, ligada ao convidado', async () => {
    const list = await cal.events({ user: admin, from: cal.addDays(premiere, -1), to: cal.addDays(premiere, 1), types: ['episodio'] });
    const e = list.find((x) => x.id === `estreia-${guest}`);
    assert.ok(e, JSON.stringify(list.map((x) => x.id)));
    assert.deepEqual([e.day, e.title, e.url], [premiere, 'Estreia prevista: Dra. Estreia', `/convidados/${guest}`]);
  });

  it('portal do convidado usa a estreia prevista; o episódio novo herda a data e o calendário não repete', async () => {
    assert.equal((await guestPortal.byId(guest)).release_on, premiere);
    const ep = await prod.createEpisode({ title: 'Conversa com a Dra. Estreia', guestId: guest, userId: admin.id });
    assert.equal(new Date(ep.aired_on).toISOString().slice(0, 10), premiere);
    const list = await cal.events({ user: admin, from: cal.addDays(premiere, -1), to: cal.addDays(premiere, 1), types: ['episodio'] });
    assert.equal(list.filter((x) => x.id === `estreia-${guest}`).length, 0, 'com episódio, vale a data do episódio');
    assert.equal(list.filter((x) => x.id === `episodio-${ep.id}`).length, 1);
  });
});
