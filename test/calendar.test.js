const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const cal = require('../src/services/calendar');
const reminders = require('../src/services/reminders');

// Tudo em março de 2030: no futuro, então nada aparece como atrasado por acaso.
describe('calendário: tudo que tem data, filtros por perfil e visualizações', () => {
  let app; const as = {}; const u = {};
  const win = { from: '2030-03-01', to: '2030-03-31' };
  const ev = (user, over = {}) => cal.events({ user, ...win, types: cal.TYPES.map((t) => t.key), ...over });

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    for (const [k, name, role] of [['admin', 'Ana Admin', 'superadmin'], ['gestao', 'Gil Gestão', 'gestao'], ['prod', 'Paula Produtora', 'produtora'], ['editor', 'Edu Editor', 'editor_video']]) {
      u[k] = await h.createUser({ name, email: `${k}@t.com`, role });
      as[k] = h.client(app.base); assert.equal((await as[k].login(`${k}@t.com`)).status, 302);
    }
    const q = (sql, p) => h.db.query(sql, p);
    await q("INSERT INTO tasks (title, kind, status, assignee_id, due_on) VALUES ('Tarefa do Edu', 'geral', 'a_fazer', $1, '2030-03-05'), ('Tarefa da Paula', 'geral', 'a_fazer', $2, '2030-03-05'), ('Tarefa feita', 'geral', 'feito', $2, '2030-03-06')", [u.editor.id, u.prod.id]);
    for (let i = 1; i <= 4; i += 1) await q("INSERT INTO tasks (title, kind, status, assignee_id, due_on) VALUES ($1, 'geral', 'a_fazer', $2, '2030-03-25')", [`Muita coisa ${i}`, u.prod.id]);
    const { rows: [g] } = await q("INSERT INTO guests (name, instagram, profile, status, owner_id, phone, proposed_at, scheduled_studio, scheduled_hosts, scheduled_guest) VALUES ('Dra. Cal', 'dra.cal', 'medico', 'agendado', $1, '(11) 98888-7777', '2030-03-12 14:00-03', true, true, true) RETURNING id", [u.prod.id]);
    await reminders.syncGuest(g.id);
    await q("INSERT INTO guests (name, instagram, profile, status, owner_id, proposed_at) VALUES ('Em Ag', 'em.ag', 'medico', 'em_agendamento', $1, '2030-03-20 10:00-03'), ('Noite Cal', 'noite.cal', 'medico', 'agendado', $2, '2030-03-13T01:30:00Z')", [u.gestao.id, u.prod.id]);
    const { rows: [ep] } = await q("INSERT INTO episodes (number, title, status, aired_on, editor_id) VALUES (777, 'Episódio Cal', 'pronto_publicar', '2030-03-15', $1) RETURNING id", [u.editor.id]);
    await q("INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, status) VALUES ('entrada', 'plateia', 'Plateia do Zé', 19700, '2030-03-10', 'previsto'), ('saida', 'estudio', 'Estúdio sinal', 35000, '2030-03-10', 'previsto')");
    await q("INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, status, cancel_reason) VALUES ('saida', 'estudio', 'Conta cancelada', 100, '2030-03-10', 'cancelado', 'usuario')");
    await q("INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, status, paid_on) VALUES ('saida', 'estudio', 'Conta paga', 5000, '2030-03-11', 'pago', '2030-03-11')");
    const { rows: [pe] } = await q("INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, status, source) VALUES ('entrada', 'plateia', 'Plateia: Maria Plateia', 19700, '2030-03-14', 'previsto', 'plateia') RETURNING id");
    await q("INSERT INTO plateia_leads (ref, guest_name, name, phone, guest_id, amount_cents, entry_id, status) VALUES ('ref-cal', 'Dra. Cal', 'Maria Plateia', '5511999990000', $1, 19700, $2, 'confirmado')", [g.id, pe.id]);
    await q("INSERT INTO sponsors (company, stage, starts_on, ends_on, owner_id) VALUES ('Marca Cal', 'ativo', '2030-03-01', '2030-03-31', $1), ('Marca Fora', 'prospect', '2030-03-02', '2030-03-30', $1)", [u.gestao.id]);
    await q("INSERT INTO episode_publications (episode_id, title, platforms, scheduled_at, status, created_by) VALUES ($1, 'Post Cal', '{instagram,youtube}', '2030-03-18 10:00-03', 'agendado', $2)", [ep.id, u.prod.id]);
  });
  after(async () => { await app.close(); await h.db.close(); });

  const titles = (list, type) => list.filter((e) => !type || e.type === type).map((e) => e.title);

  describe('datas e janelas', () => {
    it('mês começa na segunda e cobre as semanas inteiras; semana e lista têm o rótulo certo', () => {
      const m = cal.range('mes', '2030-03-15');
      assert.equal(m.label, 'Março de 2030'); assert.equal(m.from, '2030-02-25'); assert.equal(m.to, '2030-03-31', 'março de 2030 termina num domingo: a grade fecha ali');
      assert.equal(m.weeks.length, 5);
      assert.ok(m.weeks.every((w) => w.length === 7)); assert.equal(m.weeks[0][0].iso, '2030-02-25'); assert.equal(m.weeks[0][0].inMonth, false); assert.equal(m.weeks[1][0].day, 4);
      assert.equal(m.prev, '2030-02-01'); assert.equal(m.next, '2030-04-01');
      const w = cal.range('semana', '2030-03-15');
      assert.deepEqual([w.from, w.to, w.days.length, w.label], ['2030-03-11', '2030-03-17', 7, '11 a 17 de março de 2030']);
      assert.equal(cal.range('semana', '2030-03-31').label, '25 a 31 de março de 2030', 'domingo ainda é a semana que começou na segunda');
      assert.match(cal.range('semana', '2030-04-02').label, /de abril de 2030$/);
      const l = cal.range('lista', '2030-03-15');
      assert.deepEqual([l.from, l.to, l.prev, l.next], ['2030-03-15', '2030-04-13', '2030-02-13', '2030-04-14']);
      assert.equal(cal.isISO('2030-02-30'), false); assert.equal(cal.isISO('2030-03-15'), true); assert.equal(cal.isISO('amanhã'), false);
    });
  });

  describe('eventos por tipo', () => {
    it('superadmin vê todos os tipos, com dia, hora, estado e destino certos', async () => {
      const list = await ev(u.admin);
      const by = (type) => list.filter((e) => e.type === type);
      assert.deepEqual(titles(list, 'tarefa').sort(), ['Muita coisa 1', 'Muita coisa 2', 'Muita coisa 3', 'Muita coisa 4', 'Tarefa da Paula', 'Tarefa do Edu', 'Tarefa feita']);
      assert.equal(list.find((e) => e.title === 'Tarefa feita').done, true);
      const grav = by('gravacao');
      const dra = grav.find((e) => e.title === 'Gravação: Dra. Cal');
      assert.deepEqual([dra.day, dra.time, dra.tentative, dra.done], ['2030-03-12', '14:00', false, false]);
      assert.equal(grav.find((e) => e.title === 'Gravação: Em Ag').tentative, true, 'em agendamento = a confirmar');
      const noite = grav.find((e) => e.title === 'Gravação: Noite Cal');
      assert.deepEqual([noite.day, noite.time], ['2030-03-12', '22:30'], 'o dia é o de Brasília, não o do servidor (UTC)');
      assert.deepEqual(by('lembrete').map((e) => `${e.day} ${e.time}`).sort(), ['2030-03-09 09:00', '2030-03-11 09:00', '2030-03-12 09:00', '2030-03-12 11:00']);
      assert.match(by('lembrete')[0].title, /^Lembrete .+: Dra\. Cal$/);
      const epi = by('episodio')[0];
      assert.deepEqual([epi.title, epi.day, epi.done], ['EP.777 Episódio Cal', '2030-03-15', false]);
      assert.equal(by('post')[0].time, '10:00'); assert.match(by('post')[0].sub, /instagram, youtube · agendado/);
      assert.deepEqual(by('receber').map((e) => [e.title, e.amount.replace(/\s/g, ' ')]), [['Plateia do Zé', '+R$ 197,00']], 'valor com sinal: + entra, − sai');
      assert.deepEqual(by('pagar').map((e) => e.title).sort(), ['Conta paga', 'Estúdio sinal'], 'conta cancelada não entra');
      assert.equal(by('pagar').find((e) => e.title === 'Conta paga').done, true);
      assert.deepEqual(titles(list, 'patrocinio').sort(), ['Fim da parceria: Marca Cal', 'Início da parceria: Marca Cal'], 'só parceria ganha ou ativa');
      assert.ok(list.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.day) && e.url.startsWith('/')));
      const days = list.map((e) => e.day); assert.deepEqual(days, [...days].sort(), 'em ordem de dia');
    });

    it('cada perfil só recebe os tipos do assunto que enxerga', async () => {
      const typesOf = async (user) => [...new Set((await ev(user)).map((e) => e.type))].sort();
      assert.deepEqual(await typesOf(u.admin), ['cobranca', 'episodio', 'gravacao', 'lembrete', 'patrocinio', 'pagar', 'post', 'receber', 'tarefa'].sort());
      assert.deepEqual(await typesOf(u.gestao), ['cobranca', 'episodio', 'gravacao', 'lembrete', 'patrocinio', 'pagar', 'post', 'receber', 'tarefa'].sort());
      assert.ok(!(await typesOf(u.prod)).some((t) => ['pagar', 'receber'].includes(t)), 'produtora não vê o financeiro');
      assert.ok((await typesOf(u.prod)).includes('post') && (await typesOf(u.prod)).includes('cobranca'), 'mas cobra a plateia');
      const editor = await typesOf(u.editor);
      assert.ok(!editor.some((t) => ['pagar', 'receber', 'post', 'cobranca'].includes(t)), 'editor de vídeo não vê financeiro, redes nem plateia');
      assert.deepEqual(editor, ['episodio', 'gravacao', 'lembrete', 'patrocinio', 'tarefa']);
      const forced = await ev(u.editor, { types: ['pagar', 'receber', 'post', 'tarefa'] });
      assert.deepEqual([...new Set(forced.map((e) => e.type))], ['tarefa'], 'pedir um tipo proibido não adianta');
    });

    it('filtros: tipos escolhidos e ocultar concluídos', async () => {
      assert.deepEqual([...new Set((await ev(u.admin, { types: ['gravacao', 'tarefa'] })).map((e) => e.type))].sort(), ['gravacao', 'tarefa']);
      const open = await ev(u.admin, { hideDone: true });
      assert.ok(!titles(open).includes('Tarefa feita') && !titles(open).includes('Conta paga'));
      assert.ok(titles(open).includes('Tarefa da Paula'));
    });

    it('"só os meus" = o que é da pessoa + o que é do perfil dela: gestão grava, paga e recebe; produtora lembra e cobra', async () => {
      const all = (t) => t.map((e) => `${e.type}:${e.title}`);
      // gestão: todas as gravações (de qualquer convidado), contas a pagar e a receber; não os lembretes nem as cobranças da produtora
      const g = all(await ev(u.gestao, { owner: u.gestao.id }));
      for (const t of ['gravacao:Gravação: Dra. Cal', 'gravacao:Gravação: Noite Cal', 'gravacao:Gravação: Em Ag', 'pagar:Estúdio sinal', 'receber:Plateia do Zé', 'receber:Plateia: Maria Plateia']) assert.ok(g.includes(t), `gestão deveria ver ${t}`);
      assert.ok(!g.some((x) => x.startsWith('lembrete:') || x.startsWith('cobranca:')), 'lembretes e cobranças não são do perfil da gestão');
      assert.ok(!g.includes('tarefa:Tarefa da Paula') && !g.includes('tarefa:Tarefa do Edu'), 'tarefa dos outros não entra');
      assert.ok(g.includes('patrocinio:Fim da parceria: Marca Cal'), 'o que está no nome da pessoa também entra (parceria da gestão)');
      // o superadmin tem os mesmos deveres da gestão
      assert.ok(all(await ev(u.admin, { owner: u.admin.id })).includes('pagar:Estúdio sinal'));
      // produtora: todos os lembretes e cobranças + o que é dela; nada de dinheiro e só as gravações dos convidados dela
      const p = all(await ev(u.prod, { owner: u.prod.id }));
      assert.equal(p.filter((x) => x.startsWith('lembrete:')).length, 4);
      assert.ok(p.includes('cobranca:Cobrar Maria Plateia'));
      assert.ok(p.includes('gravacao:Gravação: Dra. Cal') && p.includes('gravacao:Gravação: Noite Cal') && !p.includes('gravacao:Gravação: Em Ag'), 'gravação só dos convidados dela');
      assert.ok(p.includes('tarefa:Tarefa da Paula') && !p.includes('tarefa:Tarefa do Edu'));
      assert.ok(!p.some((x) => x.startsWith('pagar:') || x.startsWith('receber:')));
      // editor de vídeo não tem deveres de perfil: só o que está no nome dele
      const e = all(await ev(u.editor, { owner: u.editor.id }));
      assert.deepEqual(e.sort(), ['episodio:EP.777 Episódio Cal', 'tarefa:Tarefa do Edu']);
      // escolher uma pessoa vale o perfil dela
      const viaGestao = all(await ev(u.admin, { owner: u.gestao.id }));
      assert.ok(viaGestao.includes('pagar:Estúdio sinal') && viaGestao.includes('gravacao:Gravação: Dra. Cal'));
      const viaProd = all(await ev(u.admin, { owner: u.prod.id }));
      assert.ok(viaProd.includes('cobranca:Cobrar Maria Plateia') && viaProd.includes('lembrete:' + viaProd.find((x) => x.startsWith('lembrete:')).slice(9)) && !viaProd.some((x) => x.startsWith('pagar:')));
    });

    it('a cobrança da plateia aparece uma vez: como cobrança, ou como a receber se o tipo cobrança estiver desmarcado', async () => {
      const both = await ev(u.admin);
      assert.deepEqual(both.filter((e) => /Maria Plateia/.test(e.title)).map((e) => e.type), ['cobranca']);
      const c = both.find((e) => e.type === 'cobranca');
      assert.deepEqual([c.title, c.day, c.done, c.sub], ['Cobrar Maria Plateia', '2030-03-14', false, 'plateia']);
      assert.equal(c.amount.replace(/\s/g, ' '), '+R$ 197,00'); assert.match(c.url, /^\/plateia\/painel\?convidado=\d+$/);
      const onlyReceber = await ev(u.admin, { types: ['receber'] });
      assert.deepEqual(onlyReceber.map((e) => e.title).sort(), ['Plateia do Zé', 'Plateia: Maria Plateia']);
      assert.deepEqual((await ev(u.prod, { types: ['cobranca', 'receber'] })).map((e) => e.type), ['cobranca'], 'a produtora cobra, mas não vê o financeiro');
      await h.db.query("UPDATE fin_entries SET status = 'pago', paid_on = '2030-03-14' WHERE description = 'Plateia: Maria Plateia'");
      assert.equal((await ev(u.prod, { types: ['cobranca'] }))[0].done, true, 'recebeu: cobrança concluída');
      await h.db.query("UPDATE fin_entries SET status = 'previsto', paid_on = NULL WHERE description = 'Plateia: Maria Plateia'");
    });

    it('atrasado: tarefa, conta e lembrete que passaram do dia sem ser feitos', async () => {
      await h.db.query("INSERT INTO tasks (title, kind, status, due_on) VALUES ('Tarefa velha', 'geral', 'a_fazer', '2020-01-10')");
      await h.db.query("INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, status) VALUES ('saida', 'estudio', 'Conta velha', 100, '2020-01-10', 'previsto')");
      const old = await cal.events({ user: u.admin, from: '2020-01-01', to: '2020-01-31', types: ['tarefa', 'pagar'] });
      assert.deepEqual(old.map((e) => [e.title, e.late]).sort(), [['Conta velha', true], ['Tarefa velha', true]]);
    });
  });

  describe('a página', () => {
    it('mês, semana e lista mostram os eventos e respeitam o perfil', async () => {
      const mes = (await as.admin.get('/calendario?f=1&visao=mes&data=2030-03-15&resp=todos&tipos=gravacao&tipos=tarefa&tipos=receber')).text;
      assert.match(mes, /<details class="cal-filter" data-popover>/, 'os filtros ficam atrás de um botão');
      assert.match(mes, /<summary class="btn sm">[\s\S]*?Filtros <span class="nav-count">1<\/span>/);
      assert.match(mes, /<legend>Mostrar<\/legend>/); assert.match(mes, /data-check-all="tipos"/); assert.match(mes, /type="submit">Aplicar</);
      assert.equal((mes.match(/type="checkbox" name="tipos" value="/g) || []).length, 9, 'um item por tipo que o superadmin enxerga');
      assert.doesNotMatch((await as.admin.get('/calendario')).text, /Filtros <span class="nav-count">/, 'sem filtro, sem contador');
      assert.match(mes, /Março de 2030/); assert.match(mes, /Gravação: Dra\. Cal/); assert.match(mes, /\+R\$\s197,00/);
      assert.match(mes, /\+1 mais/, 'dia lotado (4 tarefas) mostra 3 e vira "+1 mais"'); assert.match(mes, /href="\/calendario\?f=1&amp;visao=semana[^"]*data=2030-03-25/);
      assert.match(mes, /class="cal-ev ev-gravacao is-tentative"/);
      assert.match(mes, /<a class="[^"]*" href="\/calendario\?v=tudo/); assert.match(mes, /Salvar esta visualização/, 'filtro avulso pode virar visualização');
      const semana = (await as.admin.get('/calendario?f=1&visao=semana&data=2030-03-12&resp=todos&tipos=gravacao&tipos=lembrete')).text;
      assert.match(semana, /11 a 17 de março de 2030/); assert.match(semana, /Lembrete no dia: Dra\. Cal/); assert.match(semana, /14:00/);
      const lista = (await as.admin.get('/calendario?f=1&visao=lista&data=2030-03-02&resp=todos&tipos=episodio&tipos=pagar&tipos=patrocinio')).text;
      assert.match(lista, /Sexta-feira, 15 de março/); assert.match(lista, /EP\.777 Episódio Cal/); assert.match(lista, /−R\$\s350,00/); assert.match(lista, /Fim da parceria: Marca Cal/);
      assert.doesNotMatch((await as.editor.get('/calendario?f=1&visao=lista&data=2030-03-01&resp=todos&tipos=pagar&tipos=tarefa')).text, /Estúdio sinal|A pagar/, 'editor não vê contas');
      const sem = await as.admin.get('/calendario?f=1&visao=mes&data=2030-03-15&resp=todos');
      assert.match(sem.text, /Nenhum tipo escolhido/, 'sem nenhum tipo marcado a página ensina o que fazer');
    });

    it('data inválida volta para hoje; "só os meus" avisa sobre as contas; visualizações da casa respeitam o perfil', async () => {
      const r = await as.prod.get('/calendario?data=2030-02-31&visao=banana&v=nao-existe');
      assert.equal(r.status, 200); assert.match(r.text, new RegExp(cal.range('mes', cal.todayISO()).label));
      const mine = (await as.prod.get('/calendario?v=meu')).text;
      assert.match(mine, /class="cal-chip on"[^>]*>Meu trabalho/);
      assert.match(mine, /“Só os meus” inclui o que é do seu perfil \(Produtora\): Lembretes da gravação, Cobranças da plateia\./);
      assert.match(mine, /Filtros <span class="nav-count">3<\/span>/, 'o botão conta o que está filtrado: tipos, responsável e concluídos');
      assert.match(mine, /Só os meus · Sem concluídos/);
      const gestaoMine = (await as.gestao.get('/calendario?v=meu')).text;
      assert.match(gestaoMine, /inclui o que é do seu perfil \(Gestão\): Gravações, A receber, A pagar\./);
      assert.doesNotMatch((await as.editor.get('/calendario?v=meu')).text, /inclui o que é do seu perfil/, 'editor de vídeo não tem deveres de perfil');
      assert.match((await as.admin.get(`/calendario?f=1&visao=semana&resp=${u.prod.id}&tipos=lembrete`)).text, /Além do que é de Paula Produtora, entra o que é do perfil Produtora: Lembretes da gravação, Cobranças da plateia\./);
      const prodViews = (await as.prod.get('/calendario')).text;
      assert.doesNotMatch(prodViews, />Dinheiro</, 'a visualização Dinheiro some para quem não vê o financeiro');
      assert.match((await as.gestao.get('/calendario')).text, />Dinheiro</);
      assert.equal((await h.client(app.base).get('/calendario')).status, 302, 'sem login não abre');
    });
  });

  describe('visualizações salvas', () => {
    const save = (who, fields) => as[who].act('/calendario/visualizacoes', fields, { from: '/calendario' });
    const cfg = { visao: 'lista', tipos: ['tarefa', 'gravacao'], resp: 'eu' };

    it('salvar abre a visualização; só aparece para quem criou; mesmo nome atualiza', async () => {
      const r = await save('prod', { nome: 'Minha semana', ...cfg, ocultar: '1' });
      assert.equal(r.status, 302); assert.match(r.location, /^\/calendario\?v=u\d+$/);
      const { rows: [row] } = await h.db.query("SELECT * FROM calendar_views WHERE name = 'Minha semana'");
      assert.deepEqual(row.config, { visao: 'lista', tipos: ['gravacao', 'tarefa'], resp: 'eu', ocultar: true });
      assert.equal(row.shared, false); assert.equal(row.user_id, u.prod.id);
      const page = (await as.prod.get(r.location)).text;
      assert.match(page, /class="cal-chip on"[^>]*>Minha semana/); assert.match(page, /Excluir a visualização “Minha semana”/);
      assert.doesNotMatch((await as.editor.get('/calendario')).text, /class="cal-chip[^"]*"[^>]*>Minha semana/, 'é pessoal');
      await save('prod', { nome: 'Minha semana', visao: 'mes', tipos: ['tarefa'], resp: 'todos' });
      const { rows } = await h.db.query("SELECT config FROM calendar_views WHERE name = 'Minha semana'");
      assert.equal(rows.length, 1); assert.deepEqual(rows[0].config.tipos, ['tarefa']); assert.equal(rows[0].config.visao, 'mes');
    });

    it('compartilhar é da gestão; a da equipe aparece para todos, já limitada ao que cada perfil vê', async () => {
      await save('prod', { nome: 'Tentou compartilhar', ...cfg, compartilhar: '1' });
      assert.equal((await h.db.query("SELECT shared FROM calendar_views WHERE name = 'Tentou compartilhar'")).rows[0].shared, false, 'produtora não compartilha');
      await save('gestao', { nome: 'Fluxo do mês', visao: 'lista', tipos: ['pagar', 'receber', 'tarefa'], resp: 'todos', compartilhar: '1' });
      const gestaoPage = (await as.gestao.get('/calendario')).text;
      assert.match(gestaoPage, /Fluxo do mês/);
      const prodPage = (await as.prod.get('/calendario')).text;
      assert.match(prodPage, /Fluxo do mês <span class="mono small muted">equipe<\/span>/);
      const { rows: [v] } = await h.db.query("SELECT id FROM calendar_views WHERE name = 'Fluxo do mês'");
      const opened = (await as.prod.get(`/calendario?v=u${v.id}&data=2030-03-01`)).text;
      assert.doesNotMatch(opened, /Estúdio sinal|Plateia do Zé/, 'a produtora abre a visualização, mas sem o financeiro');
      assert.match(opened, /Tarefa da Paula/);
      assert.doesNotMatch((await as.prod.get(`/calendario?v=u${v.id}`)).text, /Excluir a visualização/, 'não é dela para apagar');
    });

    it('validação e exclusão: nome obrigatório, nenhum tipo, só o dono (ou a gestão) apaga', async () => {
      const before = (await h.db.query('SELECT count(*)::int n FROM calendar_views')).rows[0].n;
      await save('prod', { nome: '   ', ...cfg });
      await save('prod', { nome: 'Sem tipos', visao: 'mes', tipos: ['pagar'], resp: 'todos' }); // produtora não vê pagar: sobra nada
      assert.equal((await h.db.query('SELECT count(*)::int n FROM calendar_views')).rows[0].n, before, 'nada salvo');
      const { rows: [mine] } = await h.db.query("SELECT id FROM calendar_views WHERE name = 'Minha semana'");
      assert.equal((await as.editor.act(`/calendario/visualizacoes/${mine.id}/excluir`, {}, { from: '/calendario' })).status, 302);
      assert.equal((await h.db.query('SELECT 1 FROM calendar_views WHERE id = $1', [mine.id])).rowCount, 1, 'outro usuário comum não apaga');
      await as.gestao.act(`/calendario/visualizacoes/${mine.id}/excluir`, {}, { from: '/calendario' });
      assert.equal((await h.db.query('SELECT 1 FROM calendar_views WHERE id = $1', [mine.id])).rowCount, 0, 'a gestão apaga');
      const { rows: [shared] } = await h.db.query("SELECT id FROM calendar_views WHERE name = 'Fluxo do mês'");
      await as.gestao.act(`/calendario/visualizacoes/${shared.id}/excluir`, {}, { from: '/calendario' });
      assert.equal((await h.db.query('SELECT count(*)::int n FROM calendar_views WHERE id = $1', [shared.id])).rows[0].n, 0, 'dono apaga a própria');
      assert.match((await as.gestao.get('/auditoria')).text, /calendario\.visualizacao_salva/);
      assert.equal((await as.admin.act('/calendario/visualizacoes/abc/excluir', {}, { from: '/calendario' })).status, 302, 'id inválido não derruba');
    });
  });
});
