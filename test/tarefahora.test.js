const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const tasks = require('../src/services/tasks');
const { formatTime, formatDue, formatDueShort, toInputTime } = require('../src/utils/format');

describe('tarefas com hora', () => {
  const as = {}; const u = {}; let app;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const today = tasks.todayISO();
  const plus = (n) => tasks.addDays(today, n);
  const at = (hhmm, day = today) => new Date(`${day}T${hhmm}:00-03:00`);   // um instante em Brasília
  const notifs = (userId) => q('SELECT title, body, url FROM notifications WHERE user_id = $1 ORDER BY id', [userId]);
  const create = async (form) => (await as.gestao.act('/tarefas', form, { from: '/tarefas' }));
  const one = async (title) => (await q('SELECT *, to_char(due_time, \'HH24:MI\') AS hm FROM tasks WHERE title = $1', [title]))[0];

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role, name] of [['gestao', 'gestao', 'Gil Gestão'], ['prod', 'produtora', 'Paula Produtora']]) { u[k] = await h.createUser({ name, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('formatação: 14h, 14h30 e o texto do prazo', () => {
    assert.equal(formatTime('14:00'), '14h'); assert.equal(formatTime('14:30:00'), '14h30'); assert.equal(formatTime('09:05'), '9h05'); assert.equal(formatTime('25:00'), ''); assert.equal(formatTime(null), '');
    assert.equal(toInputTime('08:00:00'), '08:00');
    assert.equal(formatDue('2026-10-21', '14:00:00'), '21/10/2026 às 14h'); assert.equal(formatDue('2026-10-21', null), '21/10/2026'); assert.equal(formatDueShort('2026-10-21', '14:30'), '21/10 · 14h30'); assert.equal(formatDue(null, '14:00'), '');
  });

  it('parse: hora opcional e validada; sem data a hora vale hoje; limpar a data limpa a hora', () => {
    let r = tasks.parse({ title: 'A', due_on: plus(1), due_time: '14:00' });
    assert.equal(r.values.due_time, '14:00'); assert.equal(r.error, null);
    r = tasks.parse({ title: 'A', due_on: plus(1), due_time: '14:00:00' }); assert.equal(r.values.due_time, '14:00');
    r = tasks.parse({ title: 'A', due_on: plus(1), due_time: '25:99' }); assert.match(r.error, /Hora de vencimento inválida/);
    r = tasks.parse({ title: 'A', due_time: '09:30' }); assert.equal(r.values.due_on, today); assert.equal(r.values.due_time, '09:30');
    r = tasks.parse({ title: 'A', due_on: '', due_time: '' }); assert.equal(r.values.due_time, null);
    r = tasks.parse({ due_on: '' }, { partial: true }); assert.equal(r.values.due_time, null, 'sem data não há hora');
    r = tasks.parse({ status: 'feito' }, { partial: true }); assert.equal('due_time' in r.values, false, 'quem não mexe no prazo não mexe na hora');
  });

  it('criar com hora: guarda, avisa a pessoa com a hora e mostra nas telas', async () => {
    const r = await create({ title: 'Entregar o roteiro', assignee_id: String(u.prod.id), due_on: today, due_time: '14:00', kind: 'geral' });
    assert.equal(r.status, 302);
    const t = await one('Entregar o roteiro');
    assert.equal(t.hm, '14:00'); assert.equal(String(t.assignee_id), String(u.prod.id));
    const [n] = await notifs(u.prod.id);
    assert.match(n.title, /Gil Gestão criou uma tarefa para você: Entregar o roteiro/); assert.match(n.body, /Vence em \d\d\/\d\d\/\d{4} às 14h\./);
    const list = (await as.prod.get('/tarefas?escopo=todas')).text;
    assert.match(list, /· 14h/);
    const show = (await as.prod.get(`/tarefas/${t.id}`)).text;
    assert.match(show, /name="due_time" value="14:00"/); assert.match(show, /às 14h|14h/);
    const board = (await as.prod.get('/tarefas?escopo=todas&visao=quadro')).text;
    assert.match(board, /· 14h/);
    assert.match((await as.gestao.get('/tarefas')).text, /name="due_time"/, 'o campo de hora está na janela Nova tarefa');
  });

  it('só a hora: vale hoje; data sem hora continua dia inteiro', async () => {
    await create({ title: 'Só hora', assignee_id: String(u.prod.id), due_time: '16:45', kind: 'geral' });
    const a = await one('Só hora'); assert.equal(a.due_on.toISOString().slice(0, 10), today); assert.equal(a.hm, '16:45');
    await create({ title: 'Dia inteiro', assignee_id: String(u.prod.id), due_on: plus(2), kind: 'geral' });
    const b = await one('Dia inteiro'); assert.equal(b.hm, null);
  });

  it('editar o prazo (data ou hora) avisa o responsável; editar outra coisa não', async () => {
    const t = await one('Entregar o roteiro');
    const before = (await notifs(u.prod.id)).length;
    await as.gestao.act(`/tarefas/${t.id}`, { title: 'Entregar o roteiro', status: 'a_fazer', kind: 'geral', due_on: today, due_time: '16:30', assignee_id: String(u.prod.id) }, { from: `/tarefas/${t.id}` });
    assert.equal((await one('Entregar o roteiro')).hm, '16:30');
    const after = await notifs(u.prod.id);
    assert.equal(after.length, before + 1);
    assert.match(after.at(-1).title, /Gil Gestão mudou o prazo: Entregar o roteiro/); assert.match(after.at(-1).body, /Novo prazo: \d\d\/\d\d\/\d{4} às 16h30\./);
    await as.gestao.act(`/tarefas/${t.id}`, { title: 'Entregar o roteiro', status: 'a_fazer', kind: 'geral', due_on: today, due_time: '16:30', assignee_id: String(u.prod.id), description: 'só detalhes' }, { from: `/tarefas/${t.id}` });
    const again = await notifs(u.prod.id);
    assert.equal(again.length, before + 2, 'prazo igual: sem aviso de prazo; só o de alteração (a descrição mudou)');
    assert.match(again.at(-1).title, /alterou a tarefa: Entregar o roteiro/); assert.equal(again.at(-1).body, 'Mudou: descrição.');
    await as.gestao.act(`/tarefas/${t.id}`, { title: 'Entregar o roteiro', status: 'a_fazer', kind: 'geral', due_on: '', due_time: '14:00', assignee_id: String(u.prod.id) }, { from: `/tarefas/${t.id}` });
    // pela página de edição a hora sem data vale hoje (mesma regra de criar)
    assert.equal((await one('Entregar o roteiro')).hm, '14:00');
    await as.gestao.act(`/tarefas/${t.id}/status`, { status: 'fazendo' }, { from: '/tarefas' });
    assert.equal((await one('Entregar o roteiro')).hm, '14:00', 'mudar o status não perde a hora');
  });

  it('atraso: sem hora vence no fim do dia; com hora, naquela hora', () => {
    const t = (o) => ({ status: 'a_fazer', due_on: today, due_time: null, ...o });
    assert.equal(tasks.isLate(t({}), today, '23:59'), false, 'dia inteiro: só atrasa amanhã');
    assert.equal(tasks.isLate(t({ due_time: '14:00:00' }), today, '13:59'), false);
    assert.equal(tasks.isLate(t({ due_time: '14:00:00' }), today, '14:00'), false, 'na hora exata ainda não passou');
    assert.equal(tasks.isLate(t({ due_time: '14:00:00' }), today, '14:01'), true);
    assert.equal(tasks.isLate(t({ due_on: plus(-1) }), today, '00:01'), true);
    assert.equal(tasks.isLate(t({ due_on: plus(1), due_time: '00:10' }), today, '23:59'), false);
    assert.equal(tasks.isLate(t({ status: 'feito', due_time: '08:00' }), today, '23:00'), false);
    assert.equal(tasks.isLate(t({ due_on: null }), today, '23:00'), false);
  });

  it('avisos de prazo: vence hoje às 14h de manhã, "falta pouco" na última hora, atrasada quando a hora passa; uma vez por dia', async () => {
    await q("DELETE FROM tasks"); await q('DELETE FROM notifications');
    const mk = async (title, due_time, due_on = today) => (await q("INSERT INTO tasks (title, kind, status, assignee_id, due_on, due_time) VALUES ($1, 'geral', 'a_fazer', $2, $3, $4) RETURNING id", [title, u.prod.id, due_on, due_time]))[0].id;
    const t14 = await mk('Entregar às 14', '14:00'); await mk('Sem hora', null); await mk('Ontem', null, plus(-1));
    await tasks.dueTick(at('08:00'));
    let ns = (await notifs(u.prod.id)).map((n) => n.title);
    assert.ok(ns.includes('Tarefa vence hoje às 14h: Entregar às 14'), ns.join(' | '));
    assert.ok(ns.includes('Tarefa vence hoje: Sem hora')); assert.ok(ns.includes('Tarefa atrasada: Ontem'));
    assert.ok(!ns.some((x) => /Falta pouco/.test(x)), 'de manhã ainda não é a última hora');
    await tasks.dueTick(at('13:15'));
    ns = (await notifs(u.prod.id)).map((n) => n.title); assert.equal(ns.filter((x) => /Falta pouco: Entregar às 14/.test(x)).length, 1);
    assert.match((await notifs(u.prod.id)).find((n) => /Falta pouco/.test(n.title)).body, /Vence hoje às 14h\./);
    await tasks.dueTick(at('13:45')); assert.equal((await notifs(u.prod.id)).filter((n) => /Falta pouco/.test(n.title)).length, 1, 'não repete');
    await tasks.dueTick(at('14:20'));
    const late = (await notifs(u.prod.id)).filter((n) => /Tarefa atrasada: Entregar às 14/.test(n.title));
    assert.equal(late.length, 1); assert.equal(late[0].body, 'Venceu hoje às 14h.');
    await tasks.dueTick(at('15:00')); assert.equal((await notifs(u.prod.id)).filter((n) => /Tarefa atrasada: Entregar às 14/.test(n.title)).length, 1);
    await q("UPDATE tasks SET status = 'feito' WHERE id = $1", [t14]);
    const n0 = (await notifs(u.prod.id)).length; await tasks.dueTick(at('16:00')); assert.equal((await notifs(u.prod.id)).length, n0, 'feita: sem aviso');
  });

  it('a lista de hoje ordena pela hora e o calendário mostra a hora e o atraso', async () => {
    await q('DELETE FROM tasks');
    const ins = (title, t) => q("INSERT INTO tasks (title, kind, status, assignee_id, due_on, due_time) VALUES ($1, 'geral', 'a_fazer', $2, $3, $4)", [title, u.prod.id, today, t]);
    await ins('Tarde', '17:00'); await ins('Dia todo', null); await ins('Cedo', '07:00');
    const rows = await tasks.list({ user: { id: u.prod.id }, scope: 'todas' });
    assert.deepEqual(rows.map((r) => r.title), ['Cedo', 'Tarde', 'Dia todo']);
    const cal = require('../src/services/calendar');
    const ev = (await cal.events({ user: { id: u.gestao.id, role: 'gestao' }, from: today, to: today, types: ['tarefa'] })).filter((e) => e.type === 'tarefa');
    assert.deepEqual(ev.map((e) => [e.title, e.time]), [['Dia todo', null], ['Cedo', '07:00'], ['Tarde', '17:00']], 'a hora aparece e ordena o dia (o dia inteiro vem primeiro, como no calendário)');
    await q("UPDATE tasks SET due_time = '00:01' WHERE title = 'Cedo'");
    const late = (await cal.events({ user: { id: u.gestao.id, role: 'gestao' }, from: today, to: today, types: ['tarefa'] })).find((e) => e.title === 'Cedo');
    assert.equal(late.late, tasks.nowTime() > '00:01', 'atrasada pela hora');
  });
});
