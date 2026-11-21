const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const tasks = require('../src/services/tasks');
const notify = require('../src/services/notify');

describe('avisos de tarefa que já não fazem sentido ficam lidos', () => {
  const as = {}; const u = {}; let app;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const today = tasks.todayISO();
  const at = (hhmm, day = today) => new Date(`${day}T${hhmm}:00-03:00`);
  const unread = (userId, taskId) => q("SELECT title FROM notifications WHERE user_id = $1 AND entity_type = 'task' AND entity_id = $2 AND read_at IS NULL ORDER BY id", [userId, taskId]).then((r) => r.map((x) => x.title));
  const make = async (title) => (await tasks.create({ values: { title, kind: 'geral', status: 'a_fazer', due_on: today }, user: u.gestao, assigneeId: u.prod.id, notifyAssignee: false })).id;
  const setStatus = async (c, id, status, extra = {}) => {
    const r = await c.act(`/tarefas/${id}/status`, { status, ...extra }, { from: `/tarefas/${id}` });
    assert.ok([200, 302].includes(r.status), `status ${status}: ${r.status}`);
  };

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role, name] of [['gestao', 'gestao', 'Gil Gestão'], ['prod', 'produtora', 'Paula Produtora']]) { u[k] = await h.createUser({ name, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('Fazendo marca como lidos o "vence hoje" e o "bloqueada" de todo mundo; o de outra tarefa fica', async () => {
    const id = await make('Confirmar a pauta');
    const other = await make('Mandar o roteiro');
    await tasks.dueTick(at('09:00'));
    assert.deepEqual(await unread(u.prod.id, id), ['Tarefa vence hoje: Confirmar a pauta']);
    await setStatus(as.prod, id, 'bloqueada', { block_reason: 'Falta a data' });
    assert.deepEqual(await unread(u.gestao.id, id), ['Tarefa bloqueada: Confirmar a pauta']);
    assert.ok(await notify.unreadCount(u.prod.id) >= 2);

    await setStatus(as.prod, id, 'fazendo');
    assert.deepEqual(await unread(u.prod.id, id), [], 'o aviso de prazo deixou de ser pendente');
    assert.deepEqual(await unread(u.gestao.id, id), [], 'o aviso de bloqueio também, para quem o recebeu');
    assert.deepEqual(await unread(u.prod.id, other), ['Tarefa vence hoje: Mandar o roteiro'], 'outra tarefa não muda');
  });

  it('Feito limpa os de prazo e o "concluiu" que nasce na mesma mudança continua não lido', async () => {
    const id = await make('Subir a capa');
    await tasks.dueTick(at('09:00'));
    await setStatus(as.prod, id, 'feito');
    assert.deepEqual(await unread(u.prod.id, id), []);
    assert.deepEqual(await unread(u.gestao.id, id), ['Paula Produtora concluiu: Subir a capa']);
  });

  it('o aviso de que a tarefa foi criada ou atribuída para a pessoa (e o de prazo mudado) também fica lido quando ela começa', async () => {
    const id = (await tasks.create({ values: { title: 'Gravar a abertura', kind: 'geral', status: 'a_fazer', due_on: today }, user: u.gestao, assigneeId: u.prod.id })).id;
    const t = await tasks.get(id);
    await tasks.update(t, { due_on: tasks.addDays(today, 2) }, u.gestao);
    assert.deepEqual(await unread(u.prod.id, id), ['Gil Gestão criou uma tarefa para você: Gravar a abertura', 'Gil Gestão mudou o prazo: Gravar a abertura']);
    await setStatus(as.prod, id, 'fazendo');
    assert.deepEqual(await unread(u.prod.id, id), []);
  });

  it('se outra pessoa move a tarefa, o "criou para você" de quem recebeu continua pendente (o de prazo some)', async () => {
    const id = (await tasks.create({ values: { title: 'Editar o teaser', kind: 'geral', status: 'a_fazer', due_on: today }, user: u.gestao, assigneeId: u.prod.id })).id;
    await tasks.dueTick(at('09:00'));
    await setStatus(as.gestao, id, 'fazendo');
    assert.deepEqual(await unread(u.prod.id, id), ['Gil Gestão criou uma tarefa para você: Editar o teaser']);
  });

  it('voltar para A fazer não mexe em nada; o prazo continua avisando nos dias seguintes', async () => {
    const id = await make('Revisar o corte');
    await tasks.dueTick(at('09:00'));
    await setStatus(as.prod, id, 'fazendo');
    await setStatus(as.prod, id, 'a_fazer');
    assert.deepEqual(await unread(u.prod.id, id), [], 'o que foi lido não volta a ser pendente');
    await setStatus(as.prod, id, 'fazendo');
    await tasks.dueTick(at('09:00', tasks.addDays(today, 1)));
    assert.deepEqual(await unread(u.prod.id, id), ['Tarefa atrasada: Revisar o corte'], 'em Fazendo, o aviso do dia seguinte chega como hoje');
  });
});
