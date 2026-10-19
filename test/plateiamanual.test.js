const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const audience = require('../src/services/audience');
const tasksSvc = require('../src/services/tasks');

describe('Plateia: adicionar pessoa à mão e lembrete no dia da gravação', () => {
  const as = {}; const u = {}; let app;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const one = (sql, p) => q(sql, p).then((r) => r[0]);
  const today = tasksSvc.todayISO();
  const at = (hhmm) => new Date(`${today}T${hhmm}:00-03:00`);          // hoje, no horário de Brasília
  const mk = async (name, { status = 'agendado', when = at('15:00'), owner = null } = {}) =>
    (await one("INSERT INTO guests (name, status, proposed_at, owner_id, email, scheduled_studio, scheduled_hosts, scheduled_guest) VALUES ($1,$2,$3,$4,'a@b.com',true,true,true) RETURNING id", [name, status, when, owner])).id;
  const add = (client, form) => client.act('/plateia/painel/leads', form, { from: '/plateia/painel' });
  const leads = (gid) => q('SELECT * FROM plateia_leads WHERE guest_id = $1 ORDER BY id', [gid]);
  const reminders = (gid) => q('SELECT * FROM tasks WHERE guest_id = $1 AND auto_key LIKE $2 ORDER BY id', [gid, 'plateia-lembrete-%']);
  const morning = at('10:00');
  let g1; let g2; let g3;

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role, name] of [['gestao', 'gestao', 'Gil Gestão'], ['prod', 'produtora', 'Paula Produtora'], ['prod2', 'produtora', 'Ana Produtora'], ['editor', 'editor_video', 'Edu Editor']]) {
      u[k] = await h.createUser({ name, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`);
    }
    g1 = await mk('Dra. Hoje', { owner: null });
    g2 = await mk('Dr. Amanhã', { when: new Date(at('15:00').getTime() + 86400_000) });
    g3 = await mk('Dr. Sem Agenda', { status: 'em_agendamento' });
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('a produção adiciona uma pessoa à mão: vira pedido novo da gravação, marcada como da equipe', async () => {
    const r = await add(as.prod, { guest_id: g1, name: 'Marina Costa', country: 'BR', phone: '(11) 91234-5678', status: 'novo' });
    assert.equal(r.status, 302);
    const [l] = await leads(g1);
    assert.equal(l.name, 'Marina Costa'); assert.equal(l.phone, '+5511912345678'); assert.equal(l.status, 'novo');
    assert.equal(String(l.added_by), String(u.prod.id), 'guarda quem adicionou');
    assert.equal(l.guest_name, 'Dra. Hoje'); assert.ok(l.recording_at);
    assert.equal(l.terms_accepted_at, null, 'sem aceite online: veio por fora da página');
    const page = (await as.prod.get(`/plateia/painel?convidado=${g1}`)).text;
    assert.match(page, /Marina Costa/); assert.match(page, /adicionada pela equipe/); assert.match(page, /Adicionar pessoa/);
    assert.equal((await q("SELECT 1 FROM plateia_events WHERE type = 'lead'")).length, 0, 'não entra no funil da página pública');
  });

  it('recusa o que não dá: WhatsApp inválido, repetido, gravação que não está agendada, sem nome; editor não acessa', async () => {
    const bad = async (form) => { const n = (await q('SELECT count(*)::int AS n FROM plateia_leads'))[0].n; await add(as.prod, form); assert.equal((await q('SELECT count(*)::int AS n FROM plateia_leads'))[0].n, n, JSON.stringify(form)); };
    await bad({ guest_id: g1, name: 'Sem Zap', country: 'BR', phone: '1234' });
    await bad({ guest_id: g1, name: 'Marina de novo', country: 'BR', phone: '11 91234-5678' });
    await bad({ guest_id: g3, name: 'Fora', country: 'BR', phone: '11 98888-7777' });
    await bad({ guest_id: g1, name: '', country: 'BR', phone: '11 98888-7777' });
    await bad({ guest_id: g1, name: 'Selecionada sem valor', country: 'BR', phone: '11 98888-7777', status: 'confirmado', paid: '0', amount: '' });
    assert.equal((await as.editor.get('/plateia/painel')).status, 403);
    assert.notEqual((await add(as.editor, { guest_id: g1, name: 'Intruso', country: 'BR', phone: '11 97777-6666' })).status, 200);
    assert.equal((await q("SELECT 1 FROM plateia_leads WHERE name = 'Intruso'")).length, 0);
  });

  it('já combinada por fora: entra Selecionada, isenta ou com conta a receber no financeiro', async () => {
    await add(as.prod, { guest_id: g1, name: 'Bia Isenta', country: 'BR', phone: '11 95555-4444', status: 'confirmado', paid: 'isento' });
    await add(as.prod, { guest_id: g1, name: 'Caio Pagante', country: 'BR', phone: '11 94444-3333', status: 'confirmado', paid: '0', amount: '197,00', due_on: today });
    const bia = (await leads(g1)).find((l) => l.name === 'Bia Isenta'); const caio = (await leads(g1)).find((l) => l.name === 'Caio Pagante');
    assert.equal(bia.status, 'confirmado'); assert.equal(Number(bia.amount_cents), 0); assert.equal(bia.entry_id, null);
    assert.equal(caio.status, 'confirmado'); assert.equal(Number(caio.amount_cents), 19700); assert.ok(caio.entry_id, 'conta a receber criada');
    assert.equal((await one('SELECT status FROM fin_entries WHERE id = $1', [caio.entry_id])).status, 'previsto');
  });

  it('no dia da gravação, quem tem gente selecionada ganha UMA tarefa de lembrete (não uma por pessoa)', async () => {
    assert.equal(await audience.reminderTick(at('05:00')), 0, 'antes das 6h da manhã não cria');
    assert.equal(await audience.reminderTick(morning), 1);
    const [t] = await reminders(g1);
    assert.equal((await reminders(g1)).length, 1);
    assert.equal(t.due_on.toISOString().slice(0, 10), today); assert.equal(t.status, 'a_fazer'); assert.equal(t.kind, 'geral');
    assert.match(t.title, /Lembrar a plateia: gravação com Dra\. Hoje às 15h/);
    assert.equal(String(t.assignee_id), String(u.prod2.id), 'sem responsável no convidado: a primeira produtora (ordem alfabética)');
    assert.match(t.description, /Bia Isenta/); assert.match(t.description, /Caio Pagante/); assert.match(t.description, /2 pessoas selecionadas/);
    assert.doesNotMatch(t.description, /Marina Costa/, 'quem ainda é só pedido não entra no lembrete');
    assert.equal((await q("SELECT 1 FROM notifications WHERE user_id = $1 AND title LIKE '%Lembrar a plateia%'", [u.prod2.id])).length, 1, 'a produtora é avisada');
    assert.equal(await audience.reminderTick(morning), 0, 'a segunda checagem não repete');
    assert.equal((await reminders(g1)).length, 1);
  });

  it('quem for selecionado depois, no mesmo dia, entra na descrição; tarefa feita não é mexida', async () => {
    await add(as.prod, { guest_id: g1, name: 'Duda Tardia', country: 'BR', phone: '11 93333-2222', status: 'confirmado', paid: 'isento' });
    assert.equal(await audience.reminderTick(morning), 0);
    let [t] = await reminders(g1);
    assert.match(t.description, /Duda Tardia/); assert.match(t.description, /3 pessoas selecionadas/);
    await q("UPDATE tasks SET status = 'feito' WHERE id = $1", [t.id]);
    await add(as.prod, { guest_id: g1, name: 'Edu Atrasado', country: 'BR', phone: '11 92222-1111', status: 'confirmado', paid: 'isento' });
    await audience.reminderTick(morning);
    [t] = await reminders(g1);
    assert.doesNotMatch(t.description, /Edu Atrasado/, 'depois de feita, não mexe');
  });

  it('o responsável do convidado é quem recebe, se for produtora; não cria sem selecionados, para outro dia ou depois da gravação', async () => {
    const g4 = await mk('Dr. Com Dona', { owner: u.prod.id });
    await add(as.prod, { guest_id: g4, name: 'Fábio Selecionado', country: 'BR', phone: '11 91111-0000', status: 'confirmado', paid: 'isento' });
    await audience.reminderTick(morning);
    assert.equal(String((await reminders(g4))[0].assignee_id), String(u.prod.id));
    // sem selecionados (só pedido novo): nada
    const g5 = await mk('Dra. Só Pedido', {});
    await add(as.prod, { guest_id: g5, name: 'Só Pedido', country: 'BR', phone: '11 90000-1111', status: 'novo' });
    // outro dia
    await add(as.prod, { guest_id: g2, name: 'Gui Amanhã', country: 'BR', phone: '11 98989-8989', status: 'confirmado', paid: 'isento' });
    // já passou da hora
    const g6 = await mk('Dr. Já Gravou', { when: at('08:00') });
    await add(as.prod, { guest_id: g6, name: 'Hugo Perdeu', country: 'BR', phone: '11 97979-7979', status: 'confirmado', paid: 'isento' });
    await audience.reminderTick(morning);
    assert.equal((await reminders(g5)).length, 0); assert.equal((await reminders(g2)).length, 0); assert.equal((await reminders(g6)).length, 0);
  });
});
