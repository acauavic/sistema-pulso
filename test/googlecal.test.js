const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('./helpers');
const config = require('../src/config');
const gcal = require('../src/services/googleCalendar');
const cal = require('../src/services/calendar');

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
    if (method === 'PUT') { events.set(id, body); return reply(200, body); }
    if (method === 'DELETE') { if (!events.has(id)) return reply(410); events.delete(id); return reply(204); }
    return reply(500);
  };
  return { events, calls, fail: (s) => { failWith = s; }, restore: () => { global.fetch = real; } };
}

describe('Google Agenda: o que tem data no painel acompanha o calendário do Pulso Podcast', () => {
  const gid = (id) => gcal.eventId(`gravacao-${id}`);
  const day = (n) => cal.addDays(cal.todayISO(), n);
  let app; let g; let admin; const q = (sql, p) => h.db.query(sql, p);
  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    config.google.calendarId = 'pulso@group.calendar.google.com';
    config.google.serviceAccount = Buffer.from(JSON.stringify({ client_email: 'pulso@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) })).toString('base64');
    config.googleConfigured = true;
    g = fakeGoogle(); gcal.kickDelay.ms = 600_000; // as voltas em segundo plano só rodam no teste que as exercita
    await h.createUser({ name: 'Ana Admin', email: 'adm@t.com', role: 'superadmin' });
    admin = h.client(app.base); await admin.login('adm@t.com');
  });
  after(async () => { g.restore(); config.googleConfigured = false; await app.close(); await h.db.close(); });

  const guest = async (name, status, at) => (await q("INSERT INTO guests (name, instagram, topic, profile, status, proposed_at) VALUES ($1, 'insta', 'Gestão de clínicas', 'medico', $2, $3) RETURNING id", [name, status, at])).rows[0].id;

  it('cria, não repete, atualiza a data e remove conforme o convidado muda', async () => {
    const a = await guest('Ana Agendada', 'agendado', `${day(30)} 14:00-03`);
    const b = await guest('Bia Em Agendamento', 'em_agendamento', `${day(31)} 14:00-03`);
    let r = await gcal.sync();
    assert.deepEqual([r.created, r.updated, r.removed, r.errors.length], [1, 0, 0, 0]);
    const ev = g.events.get(gid(a));
    assert.ok(ev && ev.summary === 'Gravação Pulso: Ana Agendada'); assert.match(ev.description, /Tema: Gestão de clínicas/); assert.match(ev.description, /\/convidados\//);
    assert.deepEqual(ev.start, { dateTime: `${day(30)}T14:00:00`, timeZone: 'America/Sao_Paulo' });
    assert.equal(ev.end.dateTime, `${day(30)}T16:00:00`, 'duração padrão da gravação: 2 h');
    assert.ok(!g.events.has(gid(b)), 'a confirmar com o convidado ainda não vai');

    r = await gcal.sync(); assert.deepEqual([r.created, r.updated, r.unchanged], [0, 0, 1], 'sem mudança, nada é enviado');

    await q("UPDATE guests SET proposed_at = $2 WHERE id = $1", [a, `${day(33)} 16:30-03`]);
    r = await gcal.sync(); assert.equal(r.updated, 1);
    assert.equal(g.events.get(gid(a)).start.dateTime, `${day(33)}T16:30:00`);

    await q("UPDATE guests SET status = 'agendado' WHERE id = $1", [b]); // a confirmação sobe o evento
    r = await gcal.sync(); assert.equal(r.created, 1); assert.ok(g.events.has(gid(b)));

    await q("UPDATE guests SET status = 'perdido', loss_reason = 'sem_agenda' WHERE id = $1", [a]);
    r = await gcal.sync(); assert.equal(r.removed, 1); assert.ok(!g.events.has(gid(a)));
    assert.equal((await q('SELECT 1 FROM gcal_events WHERE key = $1', [`gravacao-${a}`])).rowCount, 0);

    await q("UPDATE guests SET status = 'agendado', loss_reason = NULL WHERE id = $1", [a]);
    r = await gcal.sync(); assert.equal(r.created, 1, 'recriar um evento apagado (o Google guarda o id)'); assert.ok(g.events.has(gid(a)));
  });

  it('gravado mantém o evento; convidado apagado remove; falha do Google vira aviso e se recupera', async () => {
    const c = await guest('Caio Gravado', 'agendado', `${day(40)} 10:00-03`);
    await gcal.sync();
    await q("UPDATE guests SET status = 'gravado' WHERE id = $1", [c]);
    let r = await gcal.sync(); assert.equal(r.removed, 0); assert.ok(g.events.has(gid(c)), 'gravação feita fica no calendário');

    const d = await guest('Davi Apagado', 'agendado', `${day(41)} 10:00-03`);
    await gcal.sync(); assert.ok(g.events.has(gid(d)));
    await q('DELETE FROM guests WHERE id = $1', [d]);
    r = await gcal.sync(); assert.equal(r.removed, 1); assert.ok(!g.events.has(gid(d)));

    await guest('Eva Nova', 'agendado', `${day(42)} 10:00-03`);
    g.fail(403);
    r = await gcal.sync(); assert.equal(r.errors.length, 1); assert.match(r.errors[0], /Eva Nova.*Forbidden/);
    await assert.rejects(gcal.tick(), /Forbidden/);
    g.fail(null);
    r = await gcal.sync(); assert.equal(r.created, 1, 'na próxima volta se recupera');
  });

  it('a gestão escolhe o que vai e a duração: tarefas (dia inteiro), lembretes e posts; desligar remove do Google', async () => {
    const before = await gcal.settings();
    assert.equal(before.gravacao.enabled, true); assert.equal(before.tarefa.enabled, false); assert.equal(before.gravacao.minutes, 120); assert.equal(before.tarefa.minutes, null);
    const { rows: [t] } = await q("INSERT INTO tasks (title, kind, status, due_on) VALUES ('Pagar o estúdio', 'geral', 'a_fazer', $1) RETURNING id", [day(20)]);
    assert.ok(![...g.events.values()].some((e) => e.summary === 'Pagar o estúdio'), 'tarefa começa desligada');

    let res = await admin.act('/integracoes/google/tipos', { on_gravacao: 'on', min_gravacao: '90', on_tarefa: 'on' }, { from: '/integracoes' });
    assert.equal(res.status, 302);
    const saved = await gcal.settings();
    assert.deepEqual([saved.gravacao.minutes, saved.tarefa.enabled, saved.lembrete.enabled], [90, true, false]);
    let r = await gcal.sync(); assert.ok(r.created >= 1 && r.errors.length === 0, JSON.stringify(r));
    const task = g.events.get(gcal.eventId(`tarefa-${t.id}`));
    assert.deepEqual([task.start, task.end], [{ date: day(20) }, { date: day(21) }], 'dia inteiro');
    const ana = [...g.events.values()].find((e) => e.summary === 'Gravação Pulso: Ana Agendada');
    assert.equal(ana.end.dateTime.slice(11), `${ana.start.dateTime.slice(11, 16)}:00`.replace(/^(\d\d):(\d\d)/, (m, hh, mm) => { const x = Number(hh) * 60 + Number(mm) + 90; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; }), 'nova duração vale para todos');

    await q("UPDATE tasks SET due_on = $2 WHERE id = $1", [t.id, day(22)]);
    r = await gcal.sync(); assert.equal(r.updated, 1); assert.deepEqual(g.events.get(gcal.eventId(`tarefa-${t.id}`)).start, { date: day(22) });
    await q('DELETE FROM tasks WHERE id = $1', [t.id]);
    r = await gcal.sync(); assert.equal(r.removed, 1); assert.ok(!g.events.has(gcal.eventId(`tarefa-${t.id}`)));

    const { rows: [t2] } = await q("INSERT INTO tasks (title, kind, status, due_on) VALUES ('Outra', 'geral', 'a_fazer', $1) RETURNING id", [day(25)]);
    await gcal.sync(); assert.ok(g.events.has(gcal.eventId(`tarefa-${t2.id}`)));
    await admin.act('/integracoes/google/tipos', { on_gravacao: 'on', min_gravacao: '90' }, { from: '/integracoes' }); // tarefas desligadas
    r = await gcal.sync(); assert.ok(r.removed >= 1); assert.ok(!g.events.has(gcal.eventId(`tarefa-${t2.id}`)), 'desligar tira da agenda');
    assert.equal((await admin.act('/integracoes/google/tipos', { min_gravacao: '5' }, { from: '/integracoes' })).status, 302);
    assert.equal((await gcal.settings()).gravacao.minutes, 90, 'duração fora do limite é ignorada');
  });

  it('mudar a data no painel atualiza o Google em seguida (sem esperar a rotina)', async () => {
    gcal._cancelKick(); gcal.kickDelay.ms = 30;
    await admin.act('/integracoes/google/tipos', { on_gravacao: 'on', min_gravacao: '120' }, { from: '/integracoes' });
    await new Promise((ok) => setTimeout(ok, 200));
    await gcal.sync();
    const id = (await guest('Fabi Remarcada', 'agendado', `${day(50)} 09:00-03`));
    await gcal.sync();
    assert.equal(g.events.get(gid(id)).start.dateTime, `${day(50)}T09:00:00`);
    await q('UPDATE guests SET proposed_at = $2 WHERE id = $1', [id, `${day(52)} 11:00-03`]); // a data muda (aqui direto no banco)
    const res = await admin.act('/perfil', { name: 'Ana Admin' }, { from: '/perfil' }); // qualquer gravação bem-sucedida no painel dispara a volta
    assert.equal(res.status, 302);
    for (let i = 0; i < 40 && g.events.get(gid(id)).start.dateTime !== `${day(52)}T11:00:00`; i += 1) await new Promise((ok) => setTimeout(ok, 50));
    assert.equal(g.events.get(gid(id)).start.dateTime, `${day(52)}T11:00:00`, 'o Google acompanhou a nova data');
    gcal._cancelKick(); gcal.kickDelay.ms = 600_000;
  });

  it('a tela de integrações mostra o status, o que vai e o botão de sincronizar', async () => {
    const page = await admin.get('/integracoes');
    assert.match(page.text, /Google Agenda/); assert.match(page.text, /pulso@proj\.iam\.gserviceaccount\.com/); assert.match(page.text, /Sincronizar agora/); assert.match(page.text, /O que vai para a agenda/);
    assert.doesNotMatch(page.text, /BEGIN PRIVATE KEY/);
    assert.equal((await admin.act('/integracoes/google', { acao: 'sincronizar' }, { from: '/integracoes' })).status, 302);
    assert.match((await admin.get('/integracoes')).text, /Google Agenda: \d+ criado/);
    assert.equal((await admin.act('/integracoes/google', { acao: 'testar' }, { from: '/integracoes' })).status, 302);
  });
});
