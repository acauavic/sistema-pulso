const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('./helpers');
const config = require('../src/config');
const gcal = require('../src/services/googleCalendar');

// "Google" de mentira: guarda os eventos em memória e responde como a API (PATCH em evento que não existe = 404, etc.).
function fakeGoogle() {
  const events = new Map(); const calls = []; let failWith = null;
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body || {} });
  const real = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('http://127.0.0.1')) return real(url, opts); // o servidor de teste
    const method = opts.method || 'GET';
    if (u.includes('oauth2.googleapis.com/token')) return reply(200, { access_token: 'tok', expires_in: 3600 });
    const m = u.match(/calendars\/[^/]+\/events(?:\/([^?]+))?/);
    calls.push(`${method} ${m && m[1] || ''}`.trim());
    if (failWith) return reply(failWith, { error: { message: 'Forbidden' } });
    const id = m && m[1]; const body = opts.body ? JSON.parse(opts.body) : null;
    if (method === 'GET') return reply(200, { items: [] });
    if (method === 'PATCH') { if (!events.has(id)) return reply(404); events.set(id, { ...events.get(id), ...body }); return reply(200, events.get(id)); }
    if (method === 'POST') { if (events.has(body.id)) return reply(409); events.set(body.id, body); return reply(200, { ...body, htmlLink: `https://calendar.google.com/event?eid=${body.id}` }); }
    if (method === 'DELETE') { if (!events.has(id)) return reply(410); events.delete(id); return reply(204); }
    return reply(500);
  };
  return { events, calls, fail: (s) => { failWith = s; }, restore: () => { global.fetch = real; } };
}

describe('Google Agenda: gravações agendadas vão para o calendário', () => {
  let app; let g; const q = (sql, p) => h.db.query(sql, p);
  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    config.google.calendarId = 'pulso@group.calendar.google.com';
    config.google.serviceAccount = Buffer.from(JSON.stringify({ client_email: 'pulso@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) })).toString('base64');
    config.googleConfigured = true;
    g = fakeGoogle();
  });
  after(async () => { g.restore(); config.googleConfigured = false; await app.close(); await h.db.close(); });

  const guest = async (name, status, at) => (await q("INSERT INTO guests (name, instagram, topic, profile, status, proposed_at) VALUES ($1, 'insta', 'Gestão de clínicas', 'medico', $2, $3) RETURNING id", [name, status, at])).rows[0].id;

  it('cria, não repete, atualiza e remove conforme o convidado muda', async () => {
    const a = await guest('Ana Agendada', 'agendado', '2031-05-10 14:00-03');
    const b = await guest('Bia Em Agendamento', 'em_agendamento', '2031-05-11 14:00-03');
    let r = await gcal.sync();
    assert.deepEqual([r.created, r.updated, r.removed, r.errors.length], [1, 0, 0, 0]);
    const ev = g.events.get(`pulsog${a}`);
    assert.ok(ev && ev.summary === 'Gravação Pulso: Ana Agendada'); assert.match(ev.description, /Tema: Gestão de clínicas/);
    assert.equal(ev.start.dateTime, '2031-05-10T17:00:00.000Z'); assert.equal(ev.start.timeZone, 'America/Sao_Paulo');
    assert.equal((new Date(ev.end.dateTime) - new Date(ev.start.dateTime)) / 60000, 120);
    assert.ok(!g.events.has(`pulsog${b}`), 'só Agendado entra');

    r = await gcal.sync(); assert.deepEqual([r.created, r.updated, r.unchanged], [0, 0, 1], 'sem mudança, nada é enviado');

    await q("UPDATE guests SET proposed_at = '2031-05-12 16:00-03' WHERE id = $1", [a]);
    r = await gcal.sync(); assert.equal(r.updated, 1);
    assert.equal(g.events.get(`pulsog${a}`).start.dateTime, '2031-05-12T19:00:00.000Z');

    await q("UPDATE guests SET status = 'perdido', loss_reason = 'sem_agenda' WHERE id = $1", [a]);
    r = await gcal.sync(); assert.equal(r.removed, 1); assert.ok(!g.events.has(`pulsog${a}`));
    assert.equal((await q('SELECT 1 FROM gcal_events WHERE guest_id = $1', [a])).rowCount, 0);

    // voltou a Agendado: o id do evento é o mesmo, e o Google responde 409 ao recriar um apagado
    await q("UPDATE guests SET status = 'agendado', loss_reason = NULL WHERE id = $1", [a]);
    r = await gcal.sync(); assert.equal(r.created, 1); assert.ok(g.events.has(`pulsog${a}`));
  });

  it('gravado mantém o evento; convidado apagado remove; falha do Google vira aviso', async () => {
    const c = await guest('Caio Gravado', 'agendado', '2031-06-01 10:00-03');
    await gcal.sync();
    await q("UPDATE guests SET status = 'gravado' WHERE id = $1", [c]);
    let r = await gcal.sync(); assert.equal(r.removed, 0); assert.ok(g.events.has(`pulsog${c}`), 'gravação feita fica no calendário');

    const d = await guest('Davi Apagado', 'agendado', '2031-06-02 10:00-03');
    await gcal.sync(); assert.ok(g.events.has(`pulsog${d}`));
    await q('DELETE FROM guests WHERE id = $1', [d]);
    r = await gcal.sync(); assert.equal(r.removed, 1); assert.ok(!g.events.has(`pulsog${d}`));

    await guest('Eva Nova', 'agendado', '2031-06-03 10:00-03');
    g.fail(403);
    r = await gcal.sync(); assert.equal(r.errors.length, 1); assert.match(r.errors[0], /Eva Nova.*Forbidden/);
    await assert.rejects(gcal.tick(), /Forbidden/);
    g.fail(null);
    r = await gcal.sync(); assert.equal(r.created, 1, 'na próxima volta se recupera');
  });

  it('a tela de integrações mostra o status e o botão de sincronizar', async () => {
    await h.createUser({ name: 'Ana Admin', email: 'adm@t.com', role: 'superadmin' });
    const c = h.client(app.base); await c.login('adm@t.com');
    const page = await c.get('/integracoes');
    assert.match(page.text, /Google Agenda/); assert.match(page.text, /pulso@proj\.iam\.gserviceaccount\.com/); assert.match(page.text, /Sincronizar agora/);
    assert.doesNotMatch(page.text, /BEGIN PRIVATE KEY/);
    const r = await c.act('/integracoes/google', { acao: 'sincronizar' }, { from: '/integracoes' });
    assert.equal(r.status, 302);
    assert.match((await c.get('/integracoes')).text, /Google Agenda: \d+ criado/);
    assert.equal((await c.act('/integracoes/google', { acao: 'testar' }, { from: '/integracoes' })).status, 302);
  });
});
