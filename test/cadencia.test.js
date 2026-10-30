const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const outreach = require('../src/services/outreach');
const cal = require('../src/services/calendar');
const notifySvc = require('../src/services/notify');

describe('cadência de abordagem: follow-ups por canal, possível perdido, meta diária e painel', () => {
  const day = (n) => cal.addDays(cal.todayISO(), n);
  const q = (sql, p) => h.db.query(sql, p);
  let app; const as = {}; const u = {};
  const ago = (n) => `${day(-n)} 12:00-03`;
  const guest = async (name, over = {}) => (await q("INSERT INTO guests (name, instagram, email, phone, profile, status, owner_id) VALUES ($1, 'insta.x', 'x@ex.com', '+5511999990000', 'medico', 'convite_enviado', $2) RETURNING id", [name, over.owner || u.prod.id])).rows[0].id;
  const enter = (id, n, table = 'guests') => q(`UPDATE ${table} SET stage_entered_at = $2 WHERE id = $1`, [id, ago(n)]);
  const attempt = (kind, id, channel, n, over = {}) => q('INSERT INTO outreach_attempts (subject_type, subject_id, channel, address, result, at, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [kind, id, channel, over.address ?? '@x', over.result || 'enviado', ago(n), over.user || u.prod.id]);

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    for (const [k, name, role] of [['admin', 'Ana Admin', 'superadmin'], ['gestao', 'Gil Gestão', 'gestao'], ['prod', 'Paula Produtora', 'produtora'], ['editor', 'Edu Editor', 'editor_video']]) {
      u[k] = await h.createUser({ name, email: `${k}@t.com`, role });
      as[k] = h.client(app.base); assert.equal((await as[k].login(`${k}@t.com`)).status, 302);
    }
    require('../src/services/googleCalendar').kickDelay.ms = 600_000;
  });
  after(async () => { await app.close(); await h.db.close(); });

  const evalOne = async (kind, id) => (await outreach.evaluateAll(kind, { ids: [id] })).get(id);

  it('convidado: conta a partir de quando entrou em Convite enviado; atrasa, vence hoje, fica em dia e vira possível perdido', async () => {
    const id = await guest('Ana Convidada');
    await enter(id, 1); let e = await evalOne('guest', id);
    assert.deepEqual([e.state, e.attempts, e.daysTo], ['em_dia', 0, 2], 'primeiro follow-up em 3 dias');
    await enter(id, 3); assert.equal((await evalOne('guest', id)).state, 'hoje');
    await enter(id, 5); e = await evalOne('guest', id); assert.deepEqual([e.state, e.daysTo], ['atrasado', -2]);

    await attempt('guest', id, 'instagram', 0); e = await evalOne('guest', id);
    assert.deepEqual([e.state, e.attempts, e.daysTo], ['em_dia', 1, 4], 'depois da 1ª abordagem espera 4 dias (2º intervalo)');
    await q('UPDATE outreach_attempts SET at = $2 WHERE subject_id = $1', [id, ago(4)]); assert.equal((await evalOne('guest', id)).state, 'hoje');
    // 4 abordagens em canais e endereços diferentes: a cadência acaba e, passada a última espera, é possível perdido
    await q('DELETE FROM outreach_attempts'); await enter(id, 40);
    await attempt('guest', id, 'instagram', 30, { address: '@a' }); await attempt('guest', id, 'email', 22, { address: 'a@x.com' }); await attempt('guest', id, 'whatsapp', 15, { address: '+55 11 1' }); await attempt('guest', id, 'email', 8, { address: 'b@x.com' });
    e = await evalOne('guest', id);
    assert.deepEqual([e.state, e.attempts, e.byChannel.email, e.byChannel.instagram, e.byChannel.whatsapp], ['possivel_perdido', 4, 2, 1, 1]);
    await q('UPDATE outreach_attempts SET at = $2 WHERE subject_id = $1 AND channel = $3 AND address = $4', [id, ago(3), 'email', 'b@x.com']);
    e = await evalOne('guest', id); assert.deepEqual([e.state, e.daysTo], ['em_dia', 4], 'ainda esperando a última resposta');
    // respondeu: a cadência para
    await attempt('guest', id, 'instagram', 0, { result: 'respondeu' });
    e = await evalOne('guest', id); assert.equal(e.state, 'respondeu'); assert.equal(e.replyChannel, 'instagram');
  });

  it('reentrar na etapa começa um ciclo novo; sair da etapa tira da cadência', async () => {
    const id = await guest('Bia Voltou');
    await enter(id, 20); await attempt('guest', id, 'email', 10);
    assert.equal((await evalOne('guest', id)).attempts, 1);
    await q("UPDATE guests SET status = 'em_agendamento' WHERE id = $1", [id]);
    assert.equal((await outreach.evaluateAll('guest', { ids: [id] })).size, 0, 'fora de Convite enviado não há cadência');
    await q("UPDATE guests SET status = 'convite_enviado' WHERE id = $1", [id]);
    assert.equal((await evalOne('guest', id)).attempts, 0, 'o gatilho renovou stage_entered_at: as abordagens antigas não contam no ciclo novo');
    assert.equal((await q('SELECT 1 FROM outreach_attempts WHERE subject_id = $1', [id])).rowCount, 1, 'mas o histórico continua');
  });

  it('patrocinador: sem abordagem = a abordar; a primeira abordagem inicia o relógio', async () => {
    const { rows: [s] } = await q("INSERT INTO sponsors (company, contact_email, contact_phone, stage, owner_id) VALUES ('Marca X', 'm@x.com', '+5511988887777', 'prospect', $1) RETURNING id", [u.prod.id]);
    assert.equal((await evalOne('sponsor', s.id)).state, 'a_abordar');
    await attempt('sponsor', s.id, 'whatsapp', 1); let e = await evalOne('sponsor', s.id);
    assert.deepEqual([e.state, e.attempts, e.daysTo], ['em_dia', 1, 2], '3 dias depois da 1ª abordagem');
    await attempt('sponsor', s.id, 'email', 6); await q('UPDATE outreach_attempts SET at = $2 WHERE subject_id = $1 AND channel = $3', [s.id, ago(4), 'whatsapp']);
    e = await evalOne('sponsor', s.id); assert.equal(e.state, 'em_dia');
  });

  it('registrar pela tela: canal, endereço novo, data, resposta, apagar e permissões', async () => {
    const id = await guest('Caio Registro');
    const post = (who, body, gid = id) => as[who].act(`/convidados/${gid}/abordagens`, body, { from: `/convidados/${gid}` });
    let r = await post('prod', { canal: 'instagram', addr_instagram: '@insta.x', resultado: 'enviado', quando: day(0), nota: 'visualizou' });
    assert.equal(r.status, 302);
    r = await post('prod', { canal: 'email', addr_email: '__novo', novo_email: 'outro@ex.com', resultado: 'enviado', quando: day(0) });
    r = await post('prod', { canal: 'whatsapp', addr_whatsapp: '__novo', novo_whatsapp: '   ', resultado: 'enviado' }); // endereço novo vazio é recusado
    const rows = (await q('SELECT channel, address, note, result FROM outreach_attempts WHERE subject_id = $1 ORDER BY id', [id])).rows;
    assert.deepEqual(rows.map((x) => [x.channel, x.address]), [['instagram', '@insta.x'], ['email', 'outro@ex.com']]);
    assert.equal(rows[0].note, 'visualizou');
    await post('prod', { canal: 'instagram', addr_instagram: '__novo', novo_instagram: 'perfil.novo', quando: day(-2) });
    assert.equal((await q("SELECT address FROM outreach_attempts WHERE subject_id = $1 AND address = '@perfil.novo'", [id])).rowCount, 1, 'o @ é completado');
    assert.equal((await q('SELECT 1 FROM outreach_attempts WHERE subject_id = $1', [id])).rowCount, 3);
    await post('prod', { canal: 'telefone', addr_telefone: '+5511999990000', quando: day(1) }); // futuro
    await post('prod', { canal: 'inexistente' });
    assert.equal((await q('SELECT 1 FROM outreach_attempts WHERE subject_id = $1', [id])).rowCount, 3, 'data futura e canal inválido não gravam');

    const page = (await as.prod.get(`/convidados/${id}`)).text;
    assert.match(page, /Registrar abordagem/); assert.match(page, /id="abordagens"/); assert.match(page, /outro@ex\.com/); assert.match(page, /@perfil\.novo/);
    assert.match(page, /Próximo follow-up/);
    assert.equal((await post('editor', { canal: 'email', addr_email: 'a@b.com' })).status, 403, 'editor de vídeo não registra');

    const del = (await q('SELECT id FROM outreach_attempts WHERE subject_id = $1 ORDER BY id LIMIT 1', [id])).rows[0].id;
    assert.equal((await as.editor.act(`/abordagens/${del}/excluir`, {}, { from: '/' })).status, 403);
    assert.equal((await as.prod.act(`/abordagens/${del}/excluir`, {}, { from: '/' })).status, 302);
    assert.equal((await q('SELECT 1 FROM outreach_attempts WHERE id = $1', [del])).rowCount, 0);
    await post('prod', { canal: 'instagram', addr_instagram: '@insta.x', resultado: 'respondeu' });
    assert.match((await as.prod.get(`/convidados/${id}`)).text, /Respondeu em/);
    await q('DELETE FROM guests WHERE id = $1', [id]);
    assert.equal((await q('SELECT 1 FROM outreach_attempts WHERE subject_id = $1 AND subject_type = $2', [id, 'guest'])).rowCount, 0, 'apagar o convidado leva o histórico junto');
  });

  it('quadro e lista mostram o estado; filtro de follow-ups pendentes', async () => {
    const late = await guest('Duda Atrasada'); await enter(late, 9);
    const ok = await guest('Edu EmDia'); await enter(ok, 0);
    const board = (await as.prod.get('/convidados')).text;
    assert.match(board, /outreach-chip bad/); assert.match(board, /atrasado 6d/); assert.match(board, /follow-up em 3d/);
    const only = (await as.prod.get('/convidados?view=lista&followup=1')).text;
    assert.match(only, /Duda Atrasada/); assert.doesNotMatch(only, /Edu EmDia/); assert.match(only, /Só follow-ups pendentes/);
  });

  it('o Início mostra os follow-ups de hoje e a meta diária de patrocinadores', async () => {
    const { rows: [s] } = await q("INSERT INTO sponsors (company, stage, owner_id) VALUES ('Marca Hoje', 'prospect', $1) RETURNING id", [u.prod.id]);
    let page = (await as.prod.get('/')).text;
    assert.match(page, /id="today-h"/); assert.match(page, /Duda Atrasada/); assert.match(page, /0<\/span><span class="muted"> \/ 5<\/span>/, 'meta padrão da produtora: 5');
    assert.match(page, /1 patrocinador seu ainda sem abordagem/);
    await as.prod.act(`/patrocinadores/${s.id}/abordagens`, { canal: 'whatsapp', addr_whatsapp: '__novo', novo_whatsapp: '+5511911112222' }, { from: '/' });
    page = (await as.prod.get('/')).text; assert.match(page, /1<\/span><span class="muted"> \/ 5<\/span>/);
    assert.doesNotMatch((await as.editor.get('/')).text, /id="today-h"/, 'editor de vídeo não vê a meta');
  });

  it('painel da gestão: por canal, por pessoa, meta, fila e preenchimento; só gestão e superadmin', async () => {
    assert.equal((await as.prod.get('/gestao/cadencia')).status, 403);
    assert.equal((await as.editor.get('/gestao/cadencia')).status, 403);
    const page = await as.gestao.get('/gestao/cadencia?dias=30');
    assert.equal(page.status, 200);
    for (const re of [/Abordagens por canal/, /Instagram/, /WhatsApp/, /Paula Produtora/, /Duda Atrasada/, /sem nenhuma abordagem registrada/, /Meta cumprida/, /Possíveis perdidos/]) assert.match(page.text, re);
    const rep = await outreach.report(30);
    assert.ok(rep.sent >= 4 && rep.channels.find((c) => c.key === 'whatsapp').sent >= 1 && rep.replies >= 1);
    const paula = rep.people.find((p) => p.name === 'Paula Produtora');
    assert.equal(paula.target, 5); assert.ok(paula.sponsor.sent >= 1); assert.ok(paula.overdue >= 1);
    assert.ok((await as.admin.get('/gestao/cadencia')).status === 200);
  });

  it('configurar: intervalos, meta padrão e meta por pessoa', async () => {
    const r = await as.gestao.act('/gestao/cadencia/config', { guest: '2, 3', sponsor: '4,6,8', goal_default: '3', [`goal_${u.prod.id}`]: '8', [`goal_${u.gestao.id}`]: '2' }, { from: '/gestao/cadencia' });
    assert.equal(r.status, 302);
    const cfg = await outreach.config(); assert.deepEqual([cfg.guest, cfg.sponsor, cfg.sponsorGoal], [[2, 3], [4, 6, 8], 3]);
    const g = await outreach.goals([{ id: u.prod.id, role: 'produtora' }, { id: u.gestao.id, role: 'gestao' }, { id: u.admin.id, role: 'superadmin' }]);
    assert.deepEqual([g.get(u.prod.id), g.get(u.gestao.id), g.get(u.admin.id)], [8, 2, 0]);
    await as.gestao.act('/gestao/cadencia/config', { guest: 'abc', sponsor: '', goal_default: '', [`goal_${u.prod.id}`]: '' }, { from: '/gestao/cadencia' });
    const back = await outreach.config(); assert.deepEqual([back.guest, back.sponsor, back.sponsorGoal], [[2, 3], [4, 6, 8], 3], 'valor inválido mantém o que estava');
    assert.equal((await outreach.goals([{ id: u.prod.id, role: 'produtora' }])).get(u.prod.id), 3, 'sem meta própria: vale o padrão');
    assert.equal((await as.prod.act('/gestao/cadencia/config', { guest: '1' }, { from: '/' })).status, 403);
    await as.gestao.act('/gestao/cadencia/config', { guest: '3,4,7,7', sponsor: '3,5,7,14', goal_default: '5' }, { from: '/gestao/cadencia' });
  });

  it('aviso diário: um resumo por pessoa, sem repetir no mesmo dia', async () => {
    const noon = new Date(`${cal.todayISO()}T15:00:00Z`);
    const weekday = ![0, 6].includes(new Date(`${cal.todayISO()}T12:00:00Z`).getUTCDay());
    const n = await outreach.dailyNotice(noon);
    if (!weekday) return assert.equal(n, 0, 'fim de semana não avisa');
    assert.ok(n >= 1);
    const notes = (await q("SELECT user_id, title FROM notifications WHERE type = 'cadencia'")).rows;
    assert.ok(notes.some((x) => x.user_id === u.prod.id && /Follow-ups de hoje/.test(x.title)));
    assert.equal(await outreach.dailyNotice(noon), 0, 'já avisou hoje');
    assert.equal(await outreach.dailyNotice(new Date(`${cal.todayISO()}T08:00:00Z`)), 0, 'antes das 8h (Brasília) não avisa');
  });
});
