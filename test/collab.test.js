const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const tasksSvc = require('../src/services/tasks');
const notifySvc = require('../src/services/notify');
const search = require('../src/services/search');

describe('colaboração: comentários, notificações, responsável, tarefas, rotinas, gestão e busca', () => {
  let app; const as = {}; const u = {};
  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    for (const [k, name, role] of [['admin', 'Ana Admin', 'superadmin'], ['gestao', 'Gil Gestão', 'gestao'], ['prod', 'Paula Produtora', 'produtora'], ['editor', 'Edu Editor', 'editor_video'], ['editor2', 'Eva Editora', 'editor_video']]) {
      u[k] = await h.createUser({ name, email: `${k}@t.com`, role });
      as[k] = h.client(app.base); assert.equal((await as[k].login(`${k}@t.com`)).status, 302);
    }
  });
  after(async () => { await app.close(); await h.db.close(); });

  const notes = (userId, type = null) => h.db.query(`SELECT * FROM notifications WHERE user_id = $1 ${type ? 'AND type = $2' : ''} ORDER BY id`, type ? [userId, type] : [userId]).then((r) => r.rows);
  const clear = () => h.db.query('DELETE FROM notifications');
  const json = async (c, method, path, body) => {
    const token = await c.csrf('/');
    const r = await fetch(`${app.base}${path}`, { method, headers: { cookie: c.cookie(), accept: 'application/json', 'content-type': 'application/json', 'x-csrf-token': token }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* html */ }
    return { status: r.status, json: j, text, location: r.headers.get('location') };
  };
  const form = async (c, path, data) => c.act(path, data, { from: '/' });
  const guest = async (owner, extra = {}) => (await h.db.query("INSERT INTO guests (name, instagram, profile, owner_id, status) VALUES ($1, 'x', 'medico', $2, $3) RETURNING *", [extra.name || 'Dr. Marcos Lima', owner, extra.status || 'prospect'])).rows[0];

  describe('comentários com menção', () => {
    let g;
    before(async () => { await clear(); g = await guest(u.prod.id); });

    it('menção com @ avisa a pessoa; o responsável pelo item é avisado de que comentaram; quem comentou não é avisado', async () => {
      const r = await form(as.gestao, '/comentarios', { tipo: 'guest', id: String(g.id), texto: 'Oi @Edu Editor, confere a pauta? E @Paula também.', voltar: `/convidados/${g.id}` });
      assert.equal(r.status, 302); assert.equal(r.location, `/convidados/${g.id}`);
      const [c] = (await h.db.query('SELECT * FROM comments')).rows;
      assert.deepEqual(c.mentions.sort(), [u.editor.id, u.prod.id].sort(), 'nome completo e primeiro nome (único) viram menção');
      const ed = await notes(u.editor.id, 'comentario');
      assert.equal(ed.length, 1); assert.match(ed[0].title, /Gil Gestão mencionou você em convidado: Dr\. Marcos Lima/);
      assert.equal(ed[0].url, `/convidados/${g.id}#comentarios`);
      assert.equal((await notes(u.prod.id, 'comentario')).length, 1, 'a responsável mencionada recebe uma só notificação');
      assert.equal((await notes(u.gestao.id)).length, 0, 'quem comentou não é avisado');
      const page = (await as.prod.get(`/convidados/${g.id}`)).text;
      assert.match(page, /<span class="mention">@Edu Editor<\/span>/);
      assert.match(page, /id="comentarios"/);
    });

    it('quem já comentou e o responsável recebem os próximos comentários; texto é escapado', async () => {
      await clear();
      await form(as.editor, '/comentarios', { tipo: 'guest', id: String(g.id), texto: 'Pauta ok <script>alert(1)</script>' });
      assert.equal((await notes(u.gestao.id, 'comentario')).length, 1, 'quem já comentou');
      assert.match((await notes(u.prod.id, 'comentario'))[0].title, /Edu Editor comentou em convidado/);
      assert.equal((await notes(u.editor.id)).length, 0);
      const page = (await as.prod.get(`/convidados/${g.id}`)).text;
      assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
      assert.doesNotMatch(page, /<script>alert\(1\)/);
    });

    it('validação e permissão: vazio, tipo desconhecido, item inexistente; apagar só o próprio (ou a gestão)', async () => {
      assert.equal((await json(as.gestao, 'POST', '/comentarios', { tipo: 'guest', id: g.id, texto: '  ' })).status, 422);
      assert.equal((await json(as.gestao, 'POST', '/comentarios', { tipo: 'planeta', id: 1, texto: 'x' })).status, 400);
      assert.equal((await json(as.gestao, 'POST', '/comentarios', { tipo: 'guest', id: 999999, texto: 'x' })).status, 404);
      const mine = (await h.db.query("SELECT id FROM comments WHERE author_id = $1", [u.editor.id])).rows[0];
      await form(as.editor2, `/comentarios/${mine.id}/excluir`, {});
      assert.equal((await h.db.query('SELECT count(*)::int n FROM comments WHERE id=$1', [mine.id])).rows[0].n, 1, 'outra editora não apaga');
      await form(as.editor, `/comentarios/${mine.id}/excluir`, {});
      assert.equal((await h.db.query('SELECT count(*)::int n FROM comments WHERE id=$1', [mine.id])).rows[0].n, 0);
    });

    it('comentários também em patrocinador, episódio, tarefa e corte (avisando o responsável de cada um)', async () => {
      await clear();
      const { rows: [s] } = await h.db.query("INSERT INTO sponsors (company, owner_id) VALUES ('Rede Vida', $1) RETURNING id", [u.prod.id]);
      const { rows: [e] } = await h.db.query("INSERT INTO episodes (number, title, status, editor_id) VALUES (7, 'Conversa', 'em_edicao', $1) RETURNING id", [u.editor.id]);
      const { rows: [c] } = await h.db.query("INSERT INTO episode_clips (title, status, created_by) VALUES ('Corte 1', 'pronto', $1) RETURNING id", [u.editor2.id]);
      const t = await tasksSvc.create({ values: { title: 'Fechar pauta' }, user: u.gestao, assigneeId: u.prod.id, notifyAssignee: false });
      for (const [tipo, id, who] of [['sponsor', s.id, u.prod.id], ['episode', e.id, u.editor.id], ['clip', c.id, u.editor2.id], ['task', t.id, u.prod.id]]) {
        assert.equal((await json(as.admin, 'POST', '/comentarios', { tipo, id, texto: `Comentário em ${tipo}` })).status, 200, tipo);
        assert.ok((await notes(who, 'comentario')).some((n) => n.entity_type === tipo), `${tipo}: responsável avisado`);
      }
      assert.ok((await notes(u.gestao.id, 'comentario')).some((n) => n.entity_type === 'task'), 'quem criou a tarefa também é avisado');
      for (const p of [`/patrocinadores/${s.id}`, `/episodios/${e.id}`, `/cortes/${c.id}`, `/tarefas/${t.id}`]) assert.match((await as.admin.get(p)).text, /Comentário em/, p);
    });
  });

  describe('notificações: página, contador, leitura, preferências e configuração', () => {
    before(async () => {
      await clear();
      await notifySvc.notify({ type: 'tarefa', users: [u.editor.id], title: 'Tarefa A', url: '/tarefas' });
      await notifySvc.notify({ type: 'rotina', users: [u.editor.id], title: 'Análise pronta', url: '/episodios' });
    });

    it('a página lista, filtra por tipo e o resumo traz o contador de não lidas', async () => {
      const page = (await as.editor.get('/notificacoes')).text;
      assert.match(page, /Tarefa A/); assert.match(page, /Análise pronta/);
      assert.match((await as.editor.get('/notificacoes?tipo=tarefa')).text, /Tarefa A/);
      assert.doesNotMatch((await as.editor.get('/notificacoes?tipo=tarefa')).text, /Análise pronta/);
      const r = await json(as.editor, 'GET', '/notificacoes/resumo');
      assert.equal(r.json.unread, 2); assert.equal(r.json.latest.length, 2);
      assert.match((await as.editor.get('/')).text, /data-unread[^>]*>2</, 'o menu mostra o contador');
    });

    it('abrir marca como lida e leva ao item; "marcar todas" zera; ninguém lê a notificação de outra pessoa', async () => {
      const [n] = await notes(u.editor.id, 'tarefa');
      const other = await as.gestao.get(`/notificacoes/${n.id}/abrir`);
      assert.equal(other.location, '/notificacoes');
      assert.equal((await notes(u.editor.id, 'tarefa'))[0].read_at, null, 'continua não lida');
      const open = await as.editor.get(`/notificacoes/${n.id}/abrir`);
      assert.equal(open.location, '/tarefas');
      assert.ok((await notes(u.editor.id, 'tarefa'))[0].read_at);
      await form(as.editor, '/notificacoes/lidas', {});
      assert.equal((await json(as.editor, 'GET', '/notificacoes/resumo')).json.unread, 0);
    });

    it('cada pessoa pode silenciar tipos para si', async () => {
      await form(as.editor, '/notificacoes/preferencias', { silenciar: 'rotina' });
      await notifySvc.notify({ type: 'rotina', users: [u.editor.id, u.editor2.id], title: 'Corte pronto' });
      assert.equal((await notes(u.editor.id, 'rotina')).length, 1, 'nada novo para quem silenciou');
      assert.equal((await notes(u.editor2.id, 'rotina')).length, 1);
      await form(as.editor, '/notificacoes/preferencias', {});
    });

    it('a gestão configura por tipo: painel, e-mail e quem recebe os avisos gerais (só gestão acessa)', async () => {
      assert.equal((await as.editor.get('/gestao/notificacoes')).status, 403);
      assert.match((await as.gestao.get('/gestao/notificacoes')).text, /Agendamentos concluídos/);
      const body = { tarefa_in_app: '1', tarefa_email: '1', comentario_in_app: '', agendamento_in_app: '1', agendamento_roles: 'produtora', rotina_in_app: '1', rotina_roles: 'gestao' };
      assert.equal((await form(as.gestao, '/gestao/notificacoes', body)).status, 302);
      const set = Object.fromEntries((await h.db.query('SELECT * FROM notification_settings')).rows.map((r) => [r.type, r]));
      assert.equal(set.tarefa.email, true); assert.equal(set.comentario.in_app, false); assert.deepEqual(set.agendamento.roles, ['produtora']);
      h.mailer.outbox.length = 0;
      await notifySvc.notify({ type: 'tarefa', users: [u.editor2.id], title: 'Com e-mail', url: '/tarefas/1' });
      assert.equal(h.mailer.outbox.length, 0, 'o e-mail vai pela fila, fora da requisição');
      while (await require('../src/services/jobs').runNext()) { /* roda a fila */ }
      assert.ok(h.mailer.outbox.some((m) => m.to === 'editor2@t.com' && /Com e-mail/.test(m.subject)), 'e-mail enviado');
      const before = (await notes(u.editor2.id, 'comentario')).length;
      await notifySvc.notify({ type: 'comentario', users: [u.editor2.id], title: 'Sem painel' });
      assert.equal((await notes(u.editor2.id, 'comentario')).length, before, 'tipo desligado não cria nada');
      await notifySvc.notify({ type: 'rotina', broadcast: true, title: 'Aviso geral' });
      assert.ok((await notes(u.gestao.id, 'rotina')).some((n) => n.title === 'Aviso geral'));
      assert.ok(!(await notes(u.admin.id, 'rotina')).some((n) => n.title === 'Aviso geral'), 'superadmin saiu da lista do aviso geral');
      await h.db.query("UPDATE notification_settings SET in_app = true, email = false, roles = CASE type WHEN 'agendamento' THEN '{superadmin,gestao}'::text[] WHEN 'rotina' THEN '{superadmin,gestao}'::text[] ELSE '{}' END");
    });
  });

  describe('alertas no navegador (Web Push)', () => {
    const json = async (who, path, body) => {
      const csrf = await as[who].csrf('/notificacoes');
      const r = await fetch(app.base + path, { method: 'POST', headers: { cookie: as[who].cookie(), 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    const ecdh = require('node:crypto').createECDH('prime256v1'); ecdh.generateKeys();
    const sub = (n) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/envio-${n}`, keys: { p256dh: ecdh.getPublicKey('base64url'), auth: 'c2VncmVkby1kZS0xNmI' } });

    it('service worker na raiz, manifesto e o bloco na página de notificações', async () => {
      const sw = await as.editor.get('/sw.js');
      assert.equal(sw.status, 200); assert.match(sw.headers.get('content-type'), /javascript/); assert.match(sw.text, /showNotification/);
      const mf = await as.editor.get('/manifest.webmanifest');
      assert.equal(mf.status, 200); assert.equal(JSON.parse(mf.text).short_name, 'Pulso');
      assert.match((await as.editor.get('/notificacoes')).text, /data-push data-push-key=""/);
    });

    it('sem chaves VAPID o servidor recusa a inscrição com mensagem clara', async () => {
      const r = await json('editor', '/notificacoes/push/inscrever', { subscription: sub(1) });
      assert.equal(r.status, 503); assert.match(r.body.error, /não estão configurados/);
    });

    it('com chaves: inscreve (só https e chaves válidas), notificação nova entra na fila, sair remove', async () => {
      const keys = require('web-push').generateVAPIDKeys();
      Object.assign(h.config.push, { publicKey: keys.publicKey, privateKey: keys.privateKey });
      try {
        assert.match((await as.editor.get('/notificacoes')).text, new RegExp(`data-push-key="${keys.publicKey}"`));
        assert.equal((await json('editor', '/notificacoes/push/inscrever', { subscription: { ...sub(2), endpoint: 'http://inseguro.test/x' } })).status, 400);
        for (const bad of ['https://169.254.169.254/latest', 'https://localhost/x', 'https://servico-interno.local/x', 'https://fcm.googleapis.com.evil.test/x', 'https://fcm.googleapis.com:8443/x', 'https://user@fcm.googleapis.com/x']) {
          assert.equal((await json('editor', '/notificacoes/push/inscrever', { subscription: { ...sub(2), endpoint: bad } })).status, 400, `endereço recusado: ${bad}`);
        }
        assert.equal((await json('editor', '/notificacoes/push/inscrever', { subscription: { endpoint: 'https://a.test/x', keys: { p256dh: '<script>', auth: 'x' } } })).status, 400);
        assert.equal((await json('editor', '/notificacoes/push/inscrever', { subscription: sub(2) })).status, 200);
        assert.equal((await json('editor', '/notificacoes/push/inscrever', { subscription: sub(2) })).status, 200, 'repetir não duplica');
        assert.equal((await h.db.query('SELECT count(*)::int n FROM push_subscriptions WHERE user_id = $1', [u.editor.id])).rows[0].n, 1);

        await h.db.query("DELETE FROM jobs WHERE kind = 'push_notificacao'");
        const created = await notifySvc.notify({ type: 'tarefa', users: [u.editor.id, u.prod.id], title: 'Tarefa com alerta', url: '/tarefas' });
        const n = created.find((x) => String(x.user_id) === String(u.editor.id));
        const { rows: queued } = await h.db.query("SELECT ref_id FROM jobs WHERE kind = 'push_notificacao'");
        assert.deepEqual(queued.map((j) => String(j.ref_id)), [String(n.id)], 'só quem tem aparelho inscrito entra na fila');

        assert.equal((await json('editor', '/notificacoes/push/sair', { endpoint: sub(2).endpoint })).status, 200);
        assert.equal((await h.db.query('SELECT count(*)::int n FROM push_subscriptions WHERE user_id = $1', [u.editor.id])).rows[0].n, 0);
        const t = await json('editor', '/notificacoes/push/teste', {});
        assert.equal(t.status, 422); assert.match(t.body.error, /Nenhum aparelho/);
      } finally {
        Object.assign(h.config.push, { publicKey: '', privateKey: '' });
      }
    });
  });

  describe('lembretes da gravação', () => {
    const production = require('../src/services/production');
    const reminders = require('../src/services/reminders');
    let gid;
    const rows = () => h.db.query('SELECT kind, sent_at, notified_at FROM guest_reminders WHERE guest_id = $1 ORDER BY due_at', [gid]).then((r) => r.rows);
    const inDays = (n, hhmm) => { const d = new Date(Date.now() + n * 86400_000); return new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)}T${hhmm}:00-03:00`); };

    it('Agendado monta os quatro lembretes; na hora avisa a produção e quem cuida; o WhatsApp abre com a mensagem e marca como enviado', async () => {
      await clear();
      await h.db.query("UPDATE notification_settings SET in_app = true, roles = '{produtora}' WHERE type = 'lembrete'"); // o padrão da migração 026
      gid = (await h.db.query(`INSERT INTO guests (name, instagram, profile, owner_id, status, phone, proposed_at, scheduled_studio, scheduled_hosts, scheduled_guest)
        VALUES ('Dra. Lia Lembrete', 'lia.lembrete', 'medico', $1, 'agendado', '(11) 98888-7777', $2, true, true, true) RETURNING id`, [u.gestao.id, inDays(6, '16:00')])).rows[0].id;
      await production.syncFromGuest(gid, u.gestao.id);
      assert.deepEqual((await rows()).map((r) => r.kind), ['d3', 'd1', 'dia', 'h3']);
      await h.db.query("UPDATE guest_reminders SET due_at = now() - interval '1 minute' WHERE guest_id = $1 AND kind = 'd3'", [gid]);
      await reminders.tick();
      await reminders.tick(); // de novo: não repete
      const { rows: notes } = await h.db.query("SELECT user_id, title FROM notifications WHERE type = 'lembrete'");
      assert.deepEqual(notes.map((n) => String(n.user_id)).sort(), [u.gestao.id, u.prod.id].map(String).sort(), 'responsável + produtora, uma vez');
      assert.match(notes[0].title, /Lembrete de 3 dias antes: Dra\. Lia Lembrete/);

      const page = (await as.prod.get(`/convidados/${gid}`)).text;
      assert.match(page, /Lembretes da gravação/);
      assert.match(page, /Enviar pelo WhatsApp/);
      assert.match(page, /na hora/);
      const csrf = await as.prod.csrf(`/convidados/${gid}`);
      const r = await as.prod.post(`/convidados/${gid}/lembretes/d3/whatsapp`, { _csrf: csrf });
      assert.equal(r.status, 303);
      assert.match(r.location, /^https:\/\/wa\.me\/5511988887777\?text=Oi%2C%20Lia/);
      assert.ok((await rows())[0].sent_at, 'marcado como enviado');
      assert.equal((await as.editor.post(`/convidados/${gid}/lembretes/d1/enviado`, { _csrf: await as.editor.csrf('/') })).status, 403, 'editor de vídeo não mexe');
    });

    it('a rotina não avisa lembrete vencido: se a hora do próximo já passou, o anterior não vale mais', async () => {
      await h.db.query("UPDATE guests SET status = 'agendado', proposed_at = $2, scheduled_studio = true, scheduled_hosts = true, scheduled_guest = true WHERE id = $1", [gid, inDays(2, '16:00')]);
      await production.syncFromGuest(gid, u.gestao.id);
      await h.db.query("UPDATE guest_reminders SET notified_at = NULL, sent_at = NULL, due_at = CASE kind WHEN 'd3' THEN now() - interval '30 hours' WHEN 'd1' THEN now() - interval '2 hours' ELSE due_at END WHERE guest_id = $1", [gid]);
      await clear();
      await reminders.tick();
      const { rows } = await h.db.query("SELECT title FROM notifications WHERE type = 'lembrete'");
      assert.ok(rows.length && rows.every((n) => /1 dia antes/.test(n.title)), 'só o de 1 dia antes, o de 3 dias já perdeu a vez');
      assert.equal((await h.db.query("SELECT notified_at FROM guest_reminders WHERE guest_id = $1 AND kind = 'd3'", [gid])).rows[0].notified_at, null);
    });

    it('aba Lembretes em Notificações: fila do que está na hora, próximos e enviados; o envio volta para a aba', async () => {
      await h.db.query("UPDATE guests SET status = 'agendado', proposed_at = $2, scheduled_studio = true, scheduled_hosts = true, scheduled_guest = true WHERE id = $1", [gid, inDays(6, '16:00')]);
      await production.syncFromGuest(gid, u.gestao.id);
      await h.db.query("UPDATE guest_reminders SET due_at = now() - interval '1 minute', sent_at = NULL WHERE guest_id = $1 AND kind = 'd3'", [gid]);
      const page = await as.prod.get('/notificacoes/lembretes');
      assert.equal(page.status, 200);
      assert.match(page.text, /Na hora de mandar/); assert.match(page.text, /Dra\. Lia Lembrete/); assert.match(page.text, /3 dias antes/);
      assert.match(page.text, /href="\/notificacoes\/lembretes"[^>]*aria-current="page"/);
      assert.match((await as.prod.get('/notificacoes')).text, /Lembretes da gravação <span class="nav-count">1<\/span>/, 'a aba mostra quantos esperam');
      assert.match(page.text, /name="voltar" value="\/notificacoes\/lembretes"/);
      const sent = await as.prod.post(`/convidados/${gid}/lembretes/d3/enviado`, { _csrf: await as.prod.csrf('/notificacoes/lembretes'), voltar: '/notificacoes/lembretes' });
      assert.equal(sent.location, '/notificacoes/lembretes');
      const after = (await as.prod.get('/notificacoes/lembretes')).text;
      assert.match(after, /Nenhum lembrete pendente/); assert.match(after, /Enviados nos últimos 7 dias/);
      assert.equal((await as.editor.get('/notificacoes/lembretes')).status, 200, 'a equipe toda vê a fila');
      assert.doesNotMatch((await as.editor.get('/notificacoes/lembretes')).text, /Enviar pelo WhatsApp/, 'mas só quem edita convidados envia');
      const evil = await as.prod.post(`/convidados/${gid}/lembretes/d1/enviado`, { _csrf: await as.prod.csrf('/'), voltar: '//outro-site.com' });
      assert.match(evil.location, /^\/convidados\//, 'voltar só aceita caminho do próprio painel');
    });

    it('remarcar refaz o ciclo; sair de Agendado cancela o que não foi enviado', async () => {
      await h.db.query('UPDATE guests SET proposed_at = $2 WHERE id = $1', [gid, inDays(8, '10:00')]);
      await production.syncFromGuest(gid, u.gestao.id);
      const after = await rows();
      assert.deepEqual(after.map((r) => r.kind), ['d3', 'd1'], 'gravação cedo: sem lembretes no dia');
      assert.ok(after.every((r) => !r.sent_at), 'a data nova começa do zero');
      await h.db.query("UPDATE guests SET status = 'cancelado' WHERE id = $1", [gid]);
      await production.syncFromGuest(gid, u.gestao.id);
      assert.equal((await rows()).length, 0);
    });

    it('Gestão > Lembretes: só a gestão edita; horário inválido é recusado; mensagem aparece com exemplo', async () => {
      assert.equal((await as.prod.get('/gestao/lembretes')).status, 403);
      const page = await as.gestao.get('/gestao/lembretes');
      assert.equal(page.status, 200); assert.match(page.text, /Endereço do estúdio/); assert.match(page.text, /Exemplo com/);
      const bad = await as.gestao.act('/gestao/lembretes', { campo: 'hora', valor: '23:00' }, { from: '/gestao/lembretes' });
      assert.match(bad.location, /editar=hora/);
      await as.gestao.act('/gestao/lembretes', { campo: 'endereco', valor: 'Alameda Rio Negro, 500, Alphaville' }, { from: '/gestao/lembretes' });
      assert.match((await as.gestao.get('/gestao/lembretes')).text, /Alameda Rio Negro, 500/);
      await as.gestao.act('/gestao/lembretes', { campo: 'hora', valor: '08:30' }, { from: '/gestao/lembretes' });
      assert.match((await as.gestao.get('/gestao/lembretes')).text, />08:30</);
    });
  });

  describe('agendamento concluído', () => {
    it('convidado agendado: avisa o responsável e a gestão uma vez (salvar de novo não repete)', async () => {
      await clear();
      const r = await as.prod.act('/convidados', { name: 'Dra. Júlia Prado', instagram: '@julia', profile: 'medico', email: 'j@x.com', owner_id: u.editor2.id, status: 'agendado', proposed_at: '2026-11-20T15:00', scheduled_studio: '1', scheduled_hosts: '1', scheduled_guest: '1' }, { from: '/convidados/novo' });
      assert.equal(r.status, 302, r.text.slice(0, 200));
      const id = r.location.split('/').pop();
      for (const who of [u.editor2.id, u.gestao.id, u.admin.id]) {
        const n = await notes(who, 'agendamento');
        assert.equal(n.length, 1, who); assert.match(n[0].title, /Gravação agendada: Dra\. Júlia Prado/); assert.match(n[0].body, /20\/11\/2026/);
      }
      assert.equal((await notes(u.prod.id, 'agendamento')).length, 0, 'quem agendou não é avisado da própria ação');
      await as.prod.act(`/convidados/${id}`, { name: 'Dra. Júlia Prado', instagram: '@julia', profile: 'medico', email: 'j@x.com', owner_id: u.editor2.id, status: 'agendado', proposed_at: '2026-11-20T15:00', scheduled_studio: '1', scheduled_hosts: '1', scheduled_guest: '1', notes: 'ajuste' }, { from: `/convidados/${id}/editar` });
      assert.equal((await notes(u.gestao.id, 'agendamento')).length, 1);
    });
  });

  describe('responsável na bolinha', () => {
    it('troca o responsável do convidado, do patrocinador e o editor do episódio, avisando a pessoa; respeita as permissões', async () => {
      await clear();
      const g = await guest(u.prod.id, { name: 'Bolinha Teste' });
      const r = await json(as.prod, 'POST', '/responsavel', { tipo: 'guest', id: g.id, user_id: u.gestao.id });
      assert.equal(r.status, 200); assert.equal(r.json.user.name, 'Gil Gestão');
      assert.equal((await h.db.query('SELECT owner_id FROM guests WHERE id=$1', [g.id])).rows[0].owner_id, u.gestao.id);
      assert.match((await notes(u.gestao.id))[0].title, /Paula Produtora colocou você como responsável pelo convidado: Bolinha Teste/);
      assert.equal((await json(as.editor, 'POST', '/responsavel', { tipo: 'guest', id: g.id, user_id: u.editor.id })).status, 403, 'editor não mexe no CRM');
      assert.equal((await json(as.prod, 'POST', '/responsavel', { tipo: 'guest', id: g.id, user_id: null })).json.user, null, 'tirar o responsável');
      const { rows: [e] } = await h.db.query("INSERT INTO episodes (number, title, status) VALUES (40, 'Ep bolinha', 'gravado') RETURNING id");
      assert.equal((await json(as.prod, 'POST', '/responsavel', { tipo: 'episode', id: e.id, user_id: u.prod.id })).status, 400, 'produtora não é editora');
      assert.equal((await json(as.prod, 'POST', '/responsavel', { tipo: 'episode', id: e.id, user_id: u.editor.id })).status, 200);
      assert.equal((await json(as.prod, 'POST', '/responsavel', { tipo: 'planeta', id: 1, user_id: null })).status, 400);
      assert.equal((await json(as.prod, 'POST', '/responsavel', { tipo: 'guest', id: 'abc' })).status, 400);
      const board = (await as.prod.get('/convidados')).text;
      assert.match(board, /data-dot data-tipo="guest" data-id="\d+"/, 'a bolinha aparece no quadro');
    });

    it('tarefa: quem não gerencia só reatribui as que criou ou que são suas', async () => {
      const t = await tasksSvc.create({ values: { title: 'Da gestão' }, user: u.gestao, assigneeId: u.prod.id, notifyAssignee: false });
      assert.equal((await json(as.editor, 'POST', '/responsavel', { tipo: 'task', id: t.id, user_id: u.editor.id })).status, 403);
      const mine = await tasksSvc.create({ values: { title: 'Do editor' }, user: u.editor, assigneeId: u.editor.id, notifyAssignee: false });
      assert.equal((await json(as.editor, 'POST', '/responsavel', { tipo: 'task', id: mine.id, user_id: u.editor2.id })).status, 200);
      assert.ok((await notes(u.editor2.id, 'tarefa')).some((n) => /responsável pela tarefa: Do editor/.test(n.title)));
    });
  });

  describe('tarefas: lista, quadro, calendário, status e bloqueio', () => {
    let t;
    it('criar avisa o responsável; a lista mostra minhas, hoje e todas', async () => {
      await clear();
      const today = tasksSvc.todayISO();
      const r = await form(as.gestao, '/tarefas', { title: 'Revisar roteiro', assignee_id: u.editor.id, due_on: today, kind: 'geral', description: 'Ver blocos 2 e 3', voltar: '/tarefas' });
      assert.equal(r.status, 302);
      t = (await h.db.query("SELECT * FROM tasks WHERE title='Revisar roteiro'")).rows[0];
      assert.equal(t.status, 'a_fazer'); assert.equal(t.created_by, u.gestao.id);
      assert.match((await notes(u.editor.id, 'tarefa'))[0].title, /Gil Gestão criou uma tarefa para você: Revisar roteiro/);
      assert.match((await as.editor.get('/tarefas')).text, /Revisar roteiro/);
      assert.match((await as.editor.get('/tarefas?escopo=hoje')).text, /Revisar roteiro/);
      assert.doesNotMatch((await as.editor2.get('/tarefas')).text, /Revisar roteiro/, 'não é minha');
      assert.match((await as.editor2.get('/tarefas?escopo=todas')).text, /Revisar roteiro/);
      assert.equal((await form(as.gestao, '/tarefas', { title: '' })).status, 302);
      assert.equal((await h.db.query("SELECT count(*)::int n FROM tasks WHERE title = ''")).rows[0].n, 0);
    });

    it('quadro com as 4 colunas e calendário do mês com a tarefa no dia do vencimento', async () => {
      const board = (await as.editor.get('/tarefas?visao=quadro')).text;
      for (const s of ['a_fazer', 'fazendo', 'feito', 'bloqueada']) assert.match(board, new RegExp(`data-status-col="${s}"`));
      assert.match(board, new RegExp(`data-task="${t.id}"`));
      const cal = (await as.editor.get(`/tarefas?visao=calendario&mes=${tasksSvc.todayISO().slice(0, 7)}`)).text;
      assert.match(cal, /class="calendar"/);
      assert.match(cal, /cal-day [^"]*today[\s\S]*Revisar roteiro/);
      assert.equal((await as.editor.get('/tarefas?visao=calendario&mes=2027-02')).status, 200);
    });

    it('bloqueada exige motivo e avisa quem criou; feito avisa quem criou; outra pessoa não mexe', async () => {
      await clear();
      const noReason = await json(as.editor, 'POST', `/tarefas/${t.id}/status`, { status: 'bloqueada' });
      assert.equal(noReason.status, 422); assert.match(noReason.json.error, /motivo/);
      const blocked = await json(as.editor, 'POST', `/tarefas/${t.id}/status`, { status: 'bloqueada', block_reason: 'Falta o roteiro final' });
      assert.equal(blocked.status, 200); assert.equal(blocked.json.task.block_reason, 'Falta o roteiro final');
      const gn = await notes(u.gestao.id, 'tarefa');
      assert.match(gn[0].title, /Tarefa bloqueada: Revisar roteiro/); assert.match(gn[0].body, /Falta o roteiro final/);
      assert.equal((await json(as.editor2, 'POST', `/tarefas/${t.id}/status`, { status: 'feito' })).status, 403);
      const done = await json(as.editor, 'POST', `/tarefas/${t.id}/status`, { status: 'feito' });
      assert.equal(done.json.task.status, 'feito'); assert.equal(done.json.task.block_reason, null); assert.ok(done.json.task.completed_at);
      assert.ok((await notes(u.gestao.id, 'tarefa')).some((n) => /Edu Editor concluiu: Revisar roteiro/.test(n.title)));
      assert.equal((await json(as.editor, 'POST', `/tarefas/${t.id}/status`, { status: 'voando' })).status, 400);
    });

    it('a página da tarefa edita, liga ao convidado e só quem criou (ou a gestão) apaga', async () => {
      const g = await guest(u.prod.id, { name: 'Ligado à tarefa' });
      const r = await form(as.editor, `/tarefas/${t.id}`, { title: 'Revisar roteiro final', status: 'fazendo', due_on: '2027-01-15', kind: 'geral', description: '', episode_id: '', guest_id: String(g.id), sponsor_id: '' });
      assert.equal(r.status, 302);
      const row = (await h.db.query('SELECT * FROM tasks WHERE id=$1', [t.id])).rows[0];
      assert.equal(row.title, 'Revisar roteiro final'); assert.equal(row.guest_id, g.id); assert.equal(row.completed_at, null);
      assert.match((await as.prod.get(`/convidados/${g.id}`)).text, /Revisar roteiro final/, 'aparece no convidado');
      assert.equal((await form(as.editor, `/tarefas/${t.id}`, { title: 'x', status: 'bloqueada', block_reason: '' })).status, 302);
      assert.notEqual((await h.db.query('SELECT status FROM tasks WHERE id=$1', [t.id])).rows[0].status, 'bloqueada', 'bloqueio sem motivo não salva');
      assert.equal((await as.editor2.act(`/tarefas/${t.id}`, { title: 'invasão' }, { from: '/' })).status, 403);
      assert.equal((await as.editor.act(`/tarefas/${t.id}/excluir`, {}, { from: '/' })).status, 403, 'o responsável não apaga o que a gestão criou');
      assert.equal((await as.gestao.act(`/tarefas/${t.id}/excluir`, {}, { from: '/' })).status, 302);
      assert.equal((await h.db.query('SELECT count(*)::int n FROM tasks WHERE id=$1', [t.id])).rows[0].n, 0);
    });

    it('rotina do sistema: avisa tarefas que vencem hoje e atrasadas, uma vez por dia', async () => {
      await clear();
      const today = tasksSvc.todayISO();
      await tasksSvc.create({ values: { title: 'Vence hoje', due_on: today }, user: u.gestao, assigneeId: u.editor2.id, notifyAssignee: false });
      await tasksSvc.create({ values: { title: 'Atrasada', due_on: tasksSvc.addDays(today, -3) }, user: u.gestao, assigneeId: u.editor2.id, notifyAssignee: false });
      await tasksSvc.create({ values: { title: 'Futura', due_on: tasksSvc.addDays(today, 5) }, user: u.gestao, assigneeId: u.editor2.id, notifyAssignee: false });
      await tasksSvc.dueTick();
      const titles = (await notes(u.editor2.id, 'tarefa')).map((n) => n.title).sort();
      assert.deepEqual(titles, ['Tarefa atrasada: Atrasada', 'Tarefa vence hoje: Vence hoje']);
      await tasksSvc.dueTick();
      assert.equal((await notes(u.editor2.id, 'tarefa')).length, 2, 'sem repetir no mesmo dia');
    });
  });

  describe('rotinas de tarefas (vencimento padrão, editável)', () => {
    it('o episódio nasce com as tarefas das rotinas, vencimento contado da gravação e responsável pela regra', async () => {
      const r = await as.prod.act('/convidados', { name: 'Dr. Rotina', instagram: '@rot', profile: 'medico', email: 'r@x.com', owner_id: u.editor2.id, status: 'gravado', proposed_at: '2025-12-01T10:00', scheduled_studio: '1', scheduled_hosts: '1', scheduled_guest: '1' }, { from: '/convidados/novo' });
      const gid = r.location.split('/').pop();
      const ep = (await h.db.query('SELECT * FROM episodes WHERE guest_id=$1', [gid])).rows[0];
      const tasks = (await h.db.query("SELECT kind, due_on::text AS due, assignee_id FROM tasks WHERE episode_id=$1 ORDER BY kind", [ep.id])).rows;
      const by = Object.fromEntries(tasks.map((x) => [x.kind, x]));
      assert.equal(by.cortes.due, '2025-12-08'); assert.equal(by.bastidores.due, '2025-12-04'); assert.equal(by.extra.due, '2025-12-11');
      assert.equal(by.bastidores.assignee_id, u.editor2.id, 'bastidores: responsável pelo convidado');
      assert.equal(by.cortes.assignee_id, null, 'cortes: editor ainda não definido');
      await json(as.prod, 'POST', '/responsavel', { tipo: 'episode', id: ep.id, user_id: u.editor.id });
      assert.equal((await h.db.query("SELECT assignee_id FROM tasks WHERE episode_id=$1 AND kind='cortes'", [ep.id])).rows[0].assignee_id, u.editor.id, 'ao definir o editor, a tarefa "do editor" vai para ele');
    });

    it('a gestão cria, edita e apaga rotinas; uma rotina de etapa cria a tarefa quando o episódio chega lá', async () => {
      assert.equal((await as.editor.get('/gestao/rotinas')).status, 403);
      assert.match((await as.gestao.get('/gestao/rotinas')).text, /Produzir os cortes do episódio/);
      const r = await form(as.gestao, '/gestao/rotinas', { trigger: 'etapa:em_revisao', kind: 'geral', title: 'Revisar o vídeo editado', anchor: 'gatilho', offset_days: '2', assignee_mode: 'usuario', assignee_id: u.gestao.id, active: '1' });
      assert.equal(r.status, 302);
      const routine = (await h.db.query("SELECT * FROM task_routines WHERE title='Revisar o vídeo editado'")).rows[0];
      assert.equal(routine.offset_days, 2);
      assert.equal((await form(as.gestao, '/gestao/rotinas', { trigger: 'nada', title: 'x' })).status, 302);
      assert.equal((await h.db.query("SELECT count(*)::int n FROM task_routines WHERE title='x'")).rows[0].n, 0);
      const { rows: [e] } = await h.db.query("INSERT INTO episodes (number, title, status) VALUES (55, 'Rotina etapa', 'em_revisao') RETURNING id");
      const made = await tasksSvc.applyRoutines('etapa:em_revisao', e.id, u.editor);
      assert.equal(made.length, 1);
      assert.equal(made[0].assignee_id, u.gestao.id);
      assert.equal(new Date(made[0].due_on).toISOString().slice(0, 10), tasksSvc.addDays(tasksSvc.todayISO(), 2));
      assert.equal((await tasksSvc.applyRoutines('etapa:em_revisao', e.id, u.editor)).length, 0, 'não repete no mesmo episódio');
      await form(as.gestao, `/gestao/rotinas/${routine.id}`, { trigger: 'etapa:em_revisao', kind: 'geral', title: 'Revisar o vídeo editado', anchor: 'gatilho', offset_days: '1', assignee_mode: 'ninguem', active: '' });
      assert.equal((await h.db.query('SELECT active, offset_days FROM task_routines WHERE id=$1', [routine.id])).rows[0].active, false);
      await form(as.gestao, `/gestao/rotinas/${routine.id}/excluir`, {});
      assert.equal((await h.db.query('SELECT count(*)::int n FROM task_routines WHERE id=$1', [routine.id])).rows[0].n, 0);
      assert.equal((await h.db.query('SELECT routine_id FROM tasks WHERE id=$1', [made[0].id])).rows[0].routine_id, null, 'a tarefa criada fica');
    });
  });

  describe('busca global', () => {
    it('acha dados e ações, respeitando permissões', async () => {
      const r = await json(as.gestao, 'GET', '/busca?q=Marcos');
      assert.ok(r.json.groups.some((g) => g.label === 'Convidados' && g.items.some((i) => i.title === 'Dr. Marcos Lima')));
      const act = await json(as.gestao, 'GET', '/busca?q=nova tarefa');
      assert.equal(act.json.groups[0].label, 'Ações e atalhos'); assert.equal(act.json.groups[0].items[0].url, '/tarefas?nova=1');
      const ep = await json(as.gestao, 'GET', '/busca?q=ep 7');
      assert.ok(ep.json.groups.some((g) => g.label === 'Episódios'));
      assert.ok(!(await json(as.editor, 'GET', '/busca?q=convidar')).json.groups.some((g) => g.items.some((i) => i.id === 'convidar-usuario')), 'editor não vê atalho de convidar usuário');
      assert.ok(!(await json(as.editor, 'GET', '/busca?q=gil')).json.groups.some((g) => g.label === 'Pessoas'), 'editor não busca pessoas');
      const empty = await json(as.gestao, 'GET', '/busca?q=');
      assert.equal(empty.json.groups[0].label, 'Atalhos');
      assert.ok(typeof empty.json.tips === 'number', 'quem gerencia a busca vê quantas sugestões há');
    });

    it('não liga para acento, maiúsculas nem ordem das palavras; acha também o que é do Social', async () => {
      await h.db.query("INSERT INTO guests (name, instagram, profile) VALUES ('João Ávila', 'joao.avila', 'medico')");
      for (const q of ['joao avila', 'JOÃO', 'avila joao', 'Ávila']) {
        assert.ok((await json(as.gestao, 'GET', `/busca?q=${encodeURIComponent(q)}&registrar=0`)).json.groups.some((g) => g.label === 'Convidados' && g.items.some((i) => i.title === 'João Ávila')), q);
      }
      await h.db.query("INSERT INTO social_rules (name, trigger, message) VALUES ('Resposta de inserção', 'comentario', 'oi')");
      await h.db.query("INSERT INTO social_ideas (episode_id, kind, title, fingerprint) SELECT id, 'corte', 'Gestão é cuidado', 'gestao e cuidado' FROM episodes LIMIT 1");
      assert.ok((await json(as.gestao, 'GET', '/busca?q=insercao&registrar=0')).json.groups.some((g) => g.label === 'Automações'));
      assert.ok(!(await json(as.editor, 'GET', '/busca?q=insercao&registrar=0')).json.groups.some((g) => g.label === 'Automações'), 'editor de vídeo não vê as redes');
      const noise = await json(as.gestao, 'GET', '/busca?q=dra&registrar=0');
      assert.ok(!noise.json.groups.some((g) => g.items.some((i) => i.id === 'rotinas')), 'palavra-chave só casa no começo da palavra ("dra" não é "padrão")');
    });

    it('registra buscas e sugere à gestão o que incluir (buscas sem resultado, páginas sem atalho, dados novos); atalho criado aparece no Ctrl+K', async () => {
      await json(as.prod, 'GET', '/busca?q=contrato assinado');
      await json(as.editor, 'GET', '/busca?q=Contrato assinado');
      const pages = search.pagesOf(require('../src/app').createApp());
      assert.ok(pages.includes('/tarefas') && pages.includes('/gestao/busca'));
      assert.ok(!pages.some((p) => p.startsWith('/patrocinador/')), 'páginas públicas ficam de fora');
      const tips = await search.suggestions(require('../src/app').createApp());
      assert.ok(tips.some((t) => t.key === 'busca:contrato assinado' && /2 vezes sem resultado/.test(t.title)));
      assert.ok(tips.some((t) => t.key === 'tabela:sponsor_deliverables'), 'tabela sem busca vira sugestão');
      const page = (await as.gestao.get('/gestao/busca')).text;
      assert.match(page, /Buscaram “contrato assinado” 2 vezes sem resultado/);
      assert.equal((await as.editor.get('/gestao/busca')).status, 403);
      assert.equal((await form(as.gestao, '/gestao/busca/atalhos', { label: 'Contratos', url: '/patrocinadores?etapa=ativo', keywords: 'contrato assinado', sugestao: 'busca:contrato assinado' })).status, 302);
      const found = await json(as.prod, 'GET', '/busca?q=contrato');
      assert.ok(found.json.groups.some((g) => g.items.some((i) => i.title === 'Contratos' && i.url === '/patrocinadores?etapa=ativo')));
      assert.ok(!(await search.suggestions(require('../src/app').createApp())).some((t) => t.key === 'busca:contrato assinado'), 'a sugestão atendida some');
      assert.equal((await form(as.gestao, '/gestao/busca/atalhos', { label: 'Fora', url: 'https://evil.example' })).status, 302);
      assert.equal((await h.db.query("SELECT count(*)::int n FROM search_shortcuts WHERE label='Fora'")).rows[0].n, 0, 'só endereços do próprio painel');
      await form(as.gestao, '/gestao/busca/dispensar', { key: 'tabela:sponsor_deliverables' });
      assert.ok(!(await search.suggestions(require('../src/app').createApp())).some((t) => t.key === 'tabela:sponsor_deliverables'));
    });

    it('a escolha feita na busca fica registrada (vira sugestão de atalho quando é frequente)', async () => {
      await json(as.gestao, 'GET', '/busca?q=Marcos');
      assert.equal((await json(as.gestao, 'POST', '/busca/escolha', { q: 'Marcos', url: '/convidados/1' })).status, 200);
      assert.equal((await h.db.query("SELECT picked FROM search_log WHERE lower(q)='marcos' ORDER BY id DESC LIMIT 1")).rows[0].picked, '/convidados/1');
    });
  });

  describe('painel de gestão e menu', () => {
    it('gestão reúne usuários, logs, notificações, rotinas, busca e integrações; editor não entra', async () => {
      const page = (await as.gestao.get('/gestao')).text;
      for (const t of ['Usuários', 'Logs', 'Notificações', 'Rotinas de tarefas', 'Busca global', 'Integrações']) assert.match(page, new RegExp(t), t);
      assert.equal((await as.editor.get('/gestao')).status, 403);
      for (const p of ['/usuarios', '/auditoria', '/integracoes']) assert.match((await as.gestao.get(p)).text, /class="subnav"/, `${p} com as abas da gestão`);
    });

    it('o menu tem busca (Ctrl+K), Notificações, Tarefas e só mostra Gestão para quem pode; a lista da equipe vai para a bolinha', async () => {
      const g = (await as.gestao.get('/')).text;
      assert.match(g, /data-palette-open/); assert.match(g, /<dialog class="palette"/);
      assert.match(g, /href="\/notificacoes"/); assert.match(g, /href="\/tarefas"/); assert.match(g, /href="\/gestao"/);
      assert.match(g, /<script type="application\/json" id="team-users">\[\{"id":/);
      assert.doesNotMatch((await as.editor.get('/')).text, /href="\/gestao"/);
    });
  });
});
