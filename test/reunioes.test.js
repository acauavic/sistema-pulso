const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('./helpers');
const config = require('../src/config');
const gcal = require('../src/services/googleCalendar');
const cal = require('../src/services/calendar');
const meetings = require('../src/services/sponsorMeetings');

// "Google" de mentira para as reuniões: guarda eventos, cria o Meet quando pedem, devolve respostas; registra o "sub" de cada token.
function fakeGoogle() {
  const events = new Map(); const calls = []; const subs = []; let failToken = null; let failApi = null; let n = 0;
  const real = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('http://127.0.0.1')) return real(url, opts);
    if (u.includes('oauth2.googleapis.com/token')) {
      const jwt = new URLSearchParams(opts.body).get('assertion').split('.')[1];
      const claims = JSON.parse(Buffer.from(jwt, 'base64url').toString());
      subs.push(claims.sub || null);
      if (failToken && claims.sub) return Response.json({ error: failToken, error_description: 'Client is unauthorized to retrieve access tokens using this method.' }, { status: 401 });
      return Response.json({ access_token: `tok-${claims.sub || 'sa'}`, expires_in: 3600 });
    }
    const method = opts.method || 'GET';
    const m = u.match(/calendars\/[^/]+\/events(?:\/([^?]+))?(?:\?(.*))?$/);
    const id = m && m[1] ? decodeURIComponent(m[1]) : null; const query = Object.fromEntries(new URLSearchParams(m && m[2] || ''));
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method, id, query, body, auth: opts.headers?.authorization });
    if (failApi) return Response.json({ error: { message: failApi.message } }, { status: failApi.status });
    const withMeet = (ev, b) => (b && b.conferenceData?.createRequest ? { ...ev, hangoutLink: `https://meet.google.com/abc-${ev.id}` } : ev);
    if (method === 'POST') { n += 1; const ev = withMeet({ ...body, id: `ev${n}`, attendees: (body.attendees || []).map((a) => ({ ...a, responseStatus: 'needsAction' })) }, body); events.set(ev.id, ev); return Response.json(ev); }
    if (method === 'PATCH') { if (!events.has(id)) return Response.json({}, { status: 404 }); const ev = withMeet({ ...events.get(id), ...body }, body); events.set(id, ev); return Response.json(ev); }
    if (method === 'GET') return events.has(id) ? Response.json(events.get(id)) : Response.json({}, { status: 404 });
    if (method === 'DELETE') { events.delete(id); return new Response(null, { status: 204 }); }
    return Response.json({}, { status: 500 });
  };
  return { events, calls, subs, failToken: (v) => { failToken = v; }, failApi: (v) => { failApi = v; }, restore: () => { global.fetch = real; } };
}

describe('Reuniões com patrocinador: Meet e convite pelo Google, em nome da conta do Pulso', () => {
  let app; let g; let sponsor; const as = {}; const u = {};
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const inDays = (d, hhmm = '15:00') => { const t = new Date(Date.now() + d * 86_400_000); const day = new Date(t.getTime() - 3 * 3600_000).toISOString().slice(0, 10); return `${day}T${hhmm}`; };
  const last = (method) => g.calls.filter((c) => c.method === method).at(-1);

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    Object.assign(config.google, { calendarId: 'pulso@group.calendar.google.com', subject: 'pulso@acauamedia.com', serviceAccount: Buffer.from(JSON.stringify({ client_email: 'sa@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) })).toString('base64') });
    config.googleConfigured = true; config.googleMeetConfigured = true; gcal._reset(); gcal.kickDelay.ms = 600_000;
    g = fakeGoogle();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora'], ['editor', 'editor_video']]) { u[k] = await h.createUser({ name: `${k} Silva`, email: `${k}@pulso.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@pulso.com`); }
    [sponsor] = await q("INSERT INTO sponsors (company, contact_name, contact_email, stage, owner_id) VALUES ('Clínica Aurora', 'Rita', 'rita@aurora.com', 'negociacao', $1) RETURNING *", [u.prod.id]);
  });
  after(async () => { g.restore(); config.googleConfigured = false; config.googleMeetConfigured = false; config.google.subject = ''; gcal._reset(); await app.close(); await h.db.close(); });

  it('sem reunião: a aba ensina e tem "Marcar reunião"; a janela vem com o contato e o responsável do patrocinador', async () => {
    const page = (await as.prod.get(`/patrocinadores/${sponsor.id}`)).text;
    assert.match(page, /data-tab-btn="reunioes"/); assert.match(page, /Nenhuma reunião com Clínica Aurora ainda/);
    assert.match(page, /data-modal-open="modal-reuniao-nova"/); assert.match(page, /Marcar e enviar convite/);
    assert.match(page, /name="emails" required value="rita@aurora.com"/);
    assert.match(page, new RegExp(`<option value="${u.prod.id}" selected>`), 'responsável: quem cuida do patrocinador');
    assert.doesNotMatch((await as.editor.get(`/patrocinadores/${sponsor.id}`)).text, /modal-reuniao-nova/, 'quem não edita patrocinador não marca');
  });

  it('marcar com Meet: o Google recebe convidados, Meet e aviso a todos, em nome da conta do Pulso; a página mostra "Entrar no Meet"', async () => {
    g.calls.length = 0; g.subs.length = 0;
    const r = await as.prod.act(`/patrocinadores/${sponsor.id}/reunioes`, { inicio: inDays(3), duracao: '45', formato: 'meet', emails: 'rita@aurora.com, Rita@Aurora.com; novo@aurora.com, errado@', responsavel: u.prod.id, equipe: [u.gestao.id], titulo: '', pauta: 'Apresentar o media kit' }, { from: `/patrocinadores/${sponsor.id}` });
    assert.equal(r.location, `/patrocinadores/${sponsor.id}#reunioes`);
    const [m] = await q('SELECT * FROM sponsor_meetings WHERE sponsor_id = $1', [sponsor.id]);
    assert.equal(m.title, 'Reunião · Clínica Aurora'); assert.equal(m.minutes, 45); assert.equal(m.google_state, 'ok'); assert.equal(m.google_event_id, 'ev1');
    assert.deepEqual(m.attendees.map((a) => a.email), ['rita@aurora.com', 'novo@aurora.com'], 'e-mails válidos, sem repetir');
    assert.equal(m.meet_url, 'https://meet.google.com/abc-ev1');
    const post = last('POST');
    assert.deepEqual(post.query, { conferenceDataVersion: '1', sendUpdates: 'all' });
    assert.equal(post.body.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
    assert.deepEqual(post.body.attendees.map((a) => a.email).sort(), ['gestao@pulso.com', 'novo@aurora.com', 'prod@pulso.com', 'rita@aurora.com']);
    assert.equal(post.body.extendedProperties.private.pulsoMeeting, String(m.id));
    assert.equal(post.body.start.timeZone, 'America/Sao_Paulo'); assert.equal(post.body.description, 'Apresentar o media kit\n\nPodcast Pulso · Clínica Aurora');
    assert.doesNotMatch(post.body.description, /patrocinadores|http/, 'o patrocinador vê a descrição: nada do painel');
    assert.equal(post.auth, 'Bearer tok-pulso@acauamedia.com'); assert.ok(g.subs.includes('pulso@acauamedia.com'), 'token em nome da conta do Pulso');
    const page = (await as.prod.get(`/patrocinadores/${sponsor.id}`)).text;
    assert.match(page, /Reunião marcada: o convite com o Meet foi enviado/);
    assert.match(page, /href="https:\/\/meet\.google\.com\/abc-ev1" target="_blank" rel="noopener"/); assert.match(page, /Próxima reunião: <span class="mono">/);
    assert.match(page, /rita@aurora\.com<\/span> <span class="badge ">sem resposta/);
    assert.ok((await q("SELECT 1 FROM sponsor_events WHERE sponsor_id = $1 AND type = 'reuniao' AND message LIKE 'Reunião marcada para%'", [sponsor.id])).length);
  });

  it('presencial leva o endereço e não cria Meet; validação recusa passado, sem e-mail e presencial sem endereço', async () => {
    const r = await meetings.create(sponsor.id, meetings.parseInput({ inicio: inDays(5, '10:30'), duracao: '60', formato: 'presencial', local: 'Av. Paulista, 1000', emails: 'rita@aurora.com', responsavel: u.gestao.id }, sponsor), u.gestao);
    assert.equal(r.meeting.mode, 'presencial'); assert.equal(r.meeting.meet_url, null);
    const post = last('POST'); assert.equal(post.body.location, 'Av. Paulista, 1000'); assert.equal(post.body.conferenceData, undefined);
    const bad = (body) => meetings.validate(meetings.parseInput({ duracao: '45', formato: 'meet', emails: 'rita@aurora.com', responsavel: u.gestao.id, inicio: inDays(2), ...body }, sponsor));
    assert.match(bad({ inicio: inDays(-1) }), /já passou/);
    assert.match(bad({ emails: 'sem-arroba, @' }), /Nenhum e-mail válido/);
    assert.match(bad({ emails: '' }), /pelo menos um e-mail/);
    assert.match(bad({ formato: 'presencial', local: '' }), /informe o endereço/);
    assert.match(bad({ duracao: '500' }), /15 minutos a 4 horas/);
    assert.equal(bad({}), null);
    const deny = await as.editor.act(`/patrocinadores/${sponsor.id}/reunioes`, { inicio: inDays(2), emails: 'a@b.com', responsavel: u.gestao.id });
    assert.notEqual(deny.status, 302, 'editor de vídeo não marca reunião de patrocinador');
  });

  it('remarcar avisa todo mundo e zera as respostas; criar o Meet depois; cancelar cancela no Google', async () => {
    const [m] = await q("SELECT * FROM sponsor_meetings WHERE mode = 'meet' ORDER BY id LIMIT 1");
    await q(`UPDATE sponsor_meetings SET attendees = '[{"email":"rita@aurora.com","response":"accepted"},{"email":"novo@aurora.com","response":"needsAction"}]' WHERE id = $1`, [m.id]);
    await as.prod.act(`/patrocinadores/${sponsor.id}/reunioes/${m.id}`, { inicio: inDays(4, '16:00'), duracao: '30', formato: 'meet', emails: 'rita@aurora.com, novo@aurora.com', responsavel: u.prod.id, titulo: 'Reunião · Clínica Aurora' }, { from: `/patrocinadores/${sponsor.id}` });
    const patch = last('PATCH');
    assert.equal(patch.id, 'ev1'); assert.equal(patch.query.sendUpdates, 'all'); assert.equal(patch.body.conferenceData, undefined, 'já tem Meet: não cria outro');
    const [after1] = await q('SELECT * FROM sponsor_meetings WHERE id = $1', [m.id]);
    assert.equal(after1.minutes, 30); assert.ok(after1.attendees.every((a) => a.response === 'needsAction'), 'horário novo: respostas zeradas');
    assert.ok((await q("SELECT 1 FROM sponsor_events WHERE message LIKE 'Reunião remarcada para%'")).length);

    const [pres] = await q("SELECT * FROM sponsor_meetings WHERE mode = 'presencial'");
    const meet = await meetings.addMeet(pres.id, u.gestao);
    assert.equal(meet.meeting.mode, 'meet'); assert.match(meet.meeting.meet_url, /meet\.google\.com/); assert.ok(last('PATCH').body.conferenceData.createRequest);

    await as.prod.act(`/patrocinadores/${sponsor.id}/reunioes/${pres.id}/cancelar`, {}, { from: `/patrocinadores/${sponsor.id}` });
    assert.deepEqual(last('PATCH').body, { status: 'cancelled' }); assert.equal(last('PATCH').query.sendUpdates, 'all');
    assert.equal((await q('SELECT status FROM sponsor_meetings WHERE id = $1', [pres.id]))[0].status, 'cancelada');
  });

  it('o Google recusando (sem delegação ou sem a conta configurada): a reunião fica guardada com o motivo e "Tentar de novo" resolve', async () => {
    g.failToken('unauthorized_client'); gcal._reset();
    const r = await meetings.create(sponsor.id, meetings.parseInput({ inicio: inDays(7), duracao: '45', formato: 'meet', emails: 'rita@aurora.com', responsavel: u.prod.id }, sponsor), u.prod);
    assert.equal(r.meeting.google_state, 'erro'); assert.match(r.meeting.google_error, /ainda não autorizou convites e Meet.*delegação no Admin do Google Workspace/);
    const page = (await as.prod.get(`/patrocinadores/${sponsor.id}`)).text;
    assert.match(page, /Não foi para o Google\./); assert.match(page, new RegExp(`/reunioes/${r.meeting.id}/tentar`));
    g.failToken(null); gcal._reset();
    await as.prod.act(`/patrocinadores/${sponsor.id}/reunioes/${r.meeting.id}/tentar`, {}, { from: `/patrocinadores/${sponsor.id}` });
    const [ok] = await q('SELECT * FROM sponsor_meetings WHERE id = $1', [r.meeting.id]);
    assert.equal(ok.google_state, 'ok'); assert.equal(ok.google_error, null); assert.ok(ok.meet_url);

    config.googleMeetConfigured = false;
    try {
      const w = await meetings.create(sponsor.id, meetings.parseInput({ inicio: inDays(8), duracao: '45', formato: 'meet', emails: 'rita@aurora.com', responsavel: u.prod.id }, sponsor), u.prod);
      assert.equal(w.meeting.google_state, 'pendente'); assert.equal(w.meeting.google_error, meetings.WAITING);
    } finally { config.googleMeetConfigured = true; }
    g.calls.length = 0;
    const t = await meetings.tick();
    assert.equal(t.retried, 1, 'a rotina manda o que ficou pendente'); assert.ok(g.calls.some((c) => c.method === 'POST'));
    g.failApi({ status: 503, message: 'Backend Error' });
    const down = await meetings.retry(r.meeting.id);
    assert.match(down.meeting.google_error, /não respondeu agora/); g.failApi(null);
  });

  it('a volta do Google: horário mudado lá, Meet criado lá, respostas e cancelamento aparecem no sistema', async () => {
    const r = await meetings.create(sponsor.id, meetings.parseInput({ inicio: inDays(10), duracao: '45', formato: 'meet', emails: 'rita@aurora.com', responsavel: u.prod.id }, sponsor), u.prod);
    const ev = g.events.get(r.meeting.google_event_id);
    const start = new Date(new Date(ev.start.dateTime).getTime() + 3600_000);
    g.events.set(ev.id, { ...ev, hangoutLink: 'https://meet.google.com/novo-link', start: { dateTime: start.toISOString() }, end: { dateTime: new Date(start.getTime() + 60 * 60_000).toISOString() },
      attendees: [{ email: 'rita@aurora.com', responseStatus: 'accepted' }, { email: 'prod@pulso.com', responseStatus: 'accepted' }, { email: 'pulso@group.calendar.google.com', organizer: true, responseStatus: 'accepted' }, { email: 'chefe@aurora.com', responseStatus: 'tentative' }] });
    await meetings.syncFromGoogle();
    const [m] = await q('SELECT * FROM sponsor_meetings WHERE id = $1', [r.meeting.id]);
    assert.equal(new Date(m.starts_at).getTime(), start.getTime()); assert.equal(m.minutes, 60); assert.equal(m.meet_url, 'https://meet.google.com/novo-link');
    assert.deepEqual(m.attendees, [{ email: 'rita@aurora.com', response: 'accepted' }, { email: 'chefe@aurora.com', response: 'tentative' }], 'só os de fora; quem foi acrescentado no Google entra');
    assert.ok((await q("SELECT 1 FROM sponsor_events WHERE message LIKE '%remarcada no Google Agenda%rita@aurora.com confirmou%'")).length);

    g.events.set(ev.id, { ...g.events.get(ev.id), status: 'cancelled' });
    await meetings.syncFromGoogle();
    assert.equal((await q('SELECT status FROM sponsor_meetings WHERE id = $1', [m.id]))[0].status, 'cancelada');
    const r2 = await meetings.create(sponsor.id, meetings.parseInput({ inicio: inDays(11), duracao: '45', formato: 'meet', emails: 'rita@aurora.com', responsavel: u.prod.id }, sponsor), u.prod);
    g.events.delete(r2.meeting.google_event_id);
    await meetings.syncFromGoogle();
    assert.equal((await q('SELECT status FROM sponsor_meetings WHERE id = $1', [r2.meeting.id]))[0].status, 'cancelada', 'apagado no Google: cancelada, sem erro em loop');
  });

  it('depois da reunião: "Aguardando resumo", colar o resumo e ver na linha; o resumo automático usa a mesma função', async () => {
    const [m] = await q("SELECT * FROM sponsor_meetings WHERE status = 'marcada' ORDER BY id LIMIT 1");
    await q("UPDATE sponsor_meetings SET starts_at = now() - interval '2 hours' WHERE id = $1", [m.id]);
    let page = (await as.prod.get(`/patrocinadores/${sponsor.id}`)).text;
    assert.match(page, /Anteriores/); assert.match(page, /Aguardando resumo/); assert.match(page, new RegExp(`modal-resumo-${m.id}`));
    await as.prod.act(`/patrocinadores/${sponsor.id}/reunioes/${m.id}/resumo`, { resumo_html: '<p>Fechamos o <strong>plano Ouro</strong>.</p><script>alert(1)</script>' }, { from: `/patrocinadores/${sponsor.id}` });
    const [s] = await q('SELECT * FROM sponsor_meetings WHERE id = $1', [m.id]);
    assert.match(s.summary, /plano Ouro/); assert.doesNotMatch(s.summary, /script/); assert.equal(s.summary_source, 'manual'); assert.equal(s.summary_by, u.prod.id);
    page = (await as.prod.get(`/patrocinadores/${sponsor.id}`)).text;
    assert.match(page, /Resumo recebido/); assert.match(page, /Fechamos o <strong>plano Ouro<\/strong>/);
    const auto = await meetings.saveSummary(m.id, '<p>Resumo do sistema externo</p>', { source: 'webhook' });
    assert.equal(auto.meeting.summary_source, 'webhook');
  });

  it('Calendário do painel mostra as reuniões; o espelho do Google não manda de novo; gravações seguem sem agir em nome de ninguém', async () => {
    const list = await cal.events({ user: { id: u.gestao.id, role: 'gestao' }, from: cal.todayISO(), to: cal.addDays(cal.todayISO(), 30), types: ['reuniao'] });
    assert.ok(list.length >= 1); assert.equal(list[0].type, 'reuniao'); assert.match(list[0].title, /^Reunião: Clínica Aurora/); assert.match(list[0].url, /#reunioes$/); assert.match(list[0].time, /^\d{2}:\d{2}$/);
    assert.ok(!gcal.MIRROR_TYPES().some((t) => t.key === 'reuniao')); assert.equal((await gcal.settings()).reuniao, undefined);
    g.subs.length = 0; gcal._reset();
    await gcal.sync();
    assert.ok(g.subs.every((s) => s === null), 'o espelho (gravações) usa o token da conta de serviço, sem "sub"');
  });

  it('teste de Integrações: cria um evento de teste com Meet e convidado, remarca, lê e apaga sem mandar e-mail', async () => {
    g.calls.length = 0;
    const r = await meetings.check();
    assert.deepEqual([r.ok, r.meet, r.invite, r.moved], [true, true, true, true]);
    assert.equal(g.calls[0].query.sendUpdates, 'none'); const del = last('DELETE');
    assert.equal(del.query.sendUpdates, 'none'); assert.ok(!g.events.has(del.id), 'apagado');
    const admin = h.client(app.base); await h.createUser({ name: 'Ana', email: 'adm@pulso.com', role: 'superadmin' }); await admin.login('adm@pulso.com');
    const page = (await admin.get('/integracoes')).text;
    assert.match(page, /Convite e Meet pelo Google/); assert.match(page, /pulso@acauamedia\.com/); assert.match(page, /value="reunioes"/);
    assert.doesNotMatch(page, /on_reuniao/, 'reuniões não aparecem no espelho');
  });
});
