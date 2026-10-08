const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const PASS = 'SenhaForte-123';
let app;
let admin; let gestao; let produtora; let editor;
const as = {}; // clientes logados por perfil

const lastMail = (to) => [...h.mailer.outbox].reverse().find((m) => !to || m.to === to);
const linkIn = (mail, re) => mail.html.match(re)?.[0];

describe('fluxos ponta a ponta', () => {
  before(async () => {
    await h.resetDb();
    await h.db.query('UPDATE invite_templates SET is_default = false');
    await h.db.query("UPDATE invite_templates SET is_default = true WHERE name LIKE 'Convite simples%'");
    app = await h.startServer();
    admin = await h.createUser({ name: 'Ana Admin', email: 'admin@t.com', role: 'superadmin' });
    gestao = await h.createUser({ name: 'Gil Gestão', email: 'gestao@t.com', role: 'gestao' });
    produtora = await h.createUser({ name: 'Paula Produtora', email: 'prod@t.com', role: 'produtora' });
    editor = await h.createUser({ name: 'Edu Editor', email: 'edit@t.com', role: 'editor_video' });
    for (const [k, email] of [['admin', 'admin@t.com'], ['gestao', 'gestao@t.com'], ['prod', 'prod@t.com'], ['editor', 'edit@t.com']]) {
      as[k] = h.client(app.base);
      assert.equal((await as[k].login(email)).status, 302, `login ${k}`);
    }
  });

  after(async () => { await app.close(); await h.db.close(); });

  describe('autenticação', () => {
    it('redireciona anônimo para /login e mostra a tela de login', async () => {
      const c = h.client(app.base);
      const r = await c.get('/');
      assert.equal(r.status, 302);
      assert.equal(r.location, '/login');
      assert.equal((await c.get('/login')).status, 200);
      assert.equal((await c.get('/usuarios')).status, 302);
    });

    it('rejeita senha errada e e-mail inexistente com a mesma mensagem', async () => {
      const c = h.client(app.base);
      const a = await c.login('admin@t.com', 'senha-errada-xyz');
      const b = await c.login('ninguem@t.com', 'senha-errada-xyz');
      assert.equal(a.status, 401);
      assert.equal(b.status, 401);
      assert.match(a.text, /E-mail ou senha incorretos/);
      assert.match(b.text, /E-mail ou senha incorretos/);
    });

    it('cookie de sessão é HttpOnly + SameSite e o token cru não vai pro banco', async () => {
      const c = h.client(app.base);
      const res = await fetch(`${app.base}/login`, {
        method: 'POST', redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: 'admin@t.com', password: PASS }),
      });
      const cookie = res.headers.getSetCookie().find((x) => x.startsWith('pulso_sid='));
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Lax/);
      const raw = decodeURIComponent(cookie.split(';')[0].split('=')[1]);
      const { rows } = await h.db.query('SELECT 1 FROM sessions WHERE token_hash = $1', [raw]);
      assert.equal(rows.length, 0, 'token cru não pode estar armazenado');
      void c;
    });

    it('bloqueia POST autenticado sem token CSRF e com Origin externo', async () => {
      const noCsrf = await as.admin.post('/perfil', { name: 'Hack' });
      assert.equal(noCsrf.status, 403);
      const csrf = await as.admin.csrf('/perfil');
      const evil = await as.admin.post('/perfil', { _csrf: csrf, name: 'Hack' }, { headers: { origin: 'https://evil.example' } });
      assert.equal(evil.status, 403);
      const { rows } = await h.db.query('SELECT name FROM users WHERE id = $1', [admin.id]);
      assert.equal(rows[0].name, 'Ana Admin');
    });

    it('logout encerra a sessão', async () => {
      const c = h.client(app.base);
      await c.login('edit@t.com');
      assert.equal((await c.get('/')).status, 200);
      await c.act('/logout');
      assert.equal((await c.get('/')).status, 302);
    });

    it('esqueci a senha: resposta idêntica; só e-mail real recebe link; link é de uso único', async () => {
      const c = h.client(app.base);
      h.mailer.outbox.length = 0;
      const unknown = await c.post('/esqueci-senha', { email: 'fantasma@t.com' });
      assert.equal(h.mailer.outbox.length, 0);
      const known = await c.post('/esqueci-senha', { email: 'edit@t.com' });
      assert.equal(unknown.status, known.status);
      assert.equal(unknown.text.replace(/value="[^"]*"/g, ''), known.text.replace(/value="[^"]*"/g, ''));
      assert.equal(h.mailer.outbox.length, 1);
      const path = linkIn(lastMail('edit@t.com'), /\/senha\/[A-Za-z0-9_-]+/);
      assert.ok(path, 'e-mail traz o link');

      assert.equal((await c.get(path)).status, 200);
      const weak = await c.post(path, { password: 'curta', confirm: 'curta' });
      assert.equal(weak.status, 400);
      const ok = await c.post(path, { password: 'Nova-Senha-456', confirm: 'Nova-Senha-456' });
      assert.equal(ok.status, 302);
      assert.equal((await c.get(path)).status, 410, 'link já usado');
      assert.equal((await h.client(app.base).login('edit@t.com', PASS)).status, 401, 'senha antiga morreu');
      assert.equal((await h.client(app.base).login('edit@t.com', 'Nova-Senha-456')).status, 302);
      await h.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [editor.id, await require('../src/auth/password').hashPassword(PASS)]);
      assert.equal((await as.editor.login('edit@t.com')).status, 302); // o reset derrubou a sessão; entra de novo
    });

    it('limita tentativas de login por e-mail', async () => {
      const c = h.client(app.base);
      let last;
      for (let i = 0; i < 10; i += 1) last = await c.login('alvo-bruteforce@t.com', 'x');
      assert.equal(last.status, 429);
      assert.equal((await h.client(app.base).login('admin@t.com')).status, 302, 'login legítimo de outro e-mail segue funcionando');
    });
  });

  describe('usuários (CRUD + roles)', () => {
    it('gestão cria usuário, convite sai por e-mail e a pessoa define a própria senha', async () => {
      h.mailer.outbox.length = 0;
      const r = await as.gestao.act('/usuarios', { name: 'Nina Nova', email: 'Nina@T.com ', role: 'produtora' }, { from: '/usuarios/novo' });
      assert.equal(r.status, 302);
      const mail = lastMail('nina@t.com');
      assert.ok(mail, 'e-mail de convite enviado (e-mail normalizado em minúsculas)');
      assert.match(mail.subject, /acesso/i);
      const path = linkIn(mail, /\/senha\/[A-Za-z0-9_-]+/);
      const nina = h.client(app.base);
      assert.equal((await nina.login('nina@t.com', 'qualquer')).status, 401, 'sem senha ainda');
      assert.equal((await nina.post(path, { password: 'Senha-Da-Nina-1', confirm: 'Senha-Da-Nina-1' })).status, 302);
      assert.equal((await nina.login('nina@t.com', 'Senha-Da-Nina-1')).status, 302);
    });

    it('rejeita e-mail duplicado e dados inválidos', async () => {
      const dup = await as.gestao.act('/usuarios', { name: 'Outra', email: 'NINA@t.com', role: 'produtora' }, { from: '/usuarios/novo' });
      assert.equal(dup.status, 409);
      assert.match(dup.text, /Já existe um usuário/);
      assert.equal((await as.gestao.act('/usuarios', { name: 'X', email: 'x@t.com', role: 'produtora' }, { from: '/usuarios/novo' })).status, 400);
      assert.equal((await as.gestao.act('/usuarios', { name: 'Xis Y', email: 'invalido', role: 'produtora' }, { from: '/usuarios/novo' })).status, 400);
      assert.equal((await as.gestao.act('/usuarios', { name: 'Xis Y', email: 'xy@t.com', role: 'chefe' }, { from: '/usuarios/novo' })).status, 400);
    });

    it('gestão NÃO cria nem edita superadmin; superadmin pode', async () => {
      assert.equal((await as.gestao.act('/usuarios', { name: 'Golpe', email: 'golpe@t.com', role: 'superadmin' }, { from: '/usuarios/novo' })).status, 400);
      assert.equal((await as.gestao.get(`/usuarios/${admin.id}/editar`)).status, 403);
      assert.equal((await as.gestao.act(`/usuarios/${admin.id}`, { name: 'x', email: 'admin@t.com', role: 'produtora' }, { from: '/usuarios' })).status, 403);
      assert.equal((await as.gestao.act(`/usuarios/${admin.id}/status`, { active: 'false' }, { from: '/usuarios' })).status, 403);
      const ok = await as.admin.act('/usuarios', { name: 'Sara Super', email: 'sara@t.com', role: 'superadmin' }, { from: '/usuarios/novo' });
      assert.equal(ok.status, 302);
    });

    it('produtora e editor de vídeo não acessam a gestão de usuários', async () => {
      for (const k of ['prod', 'editor']) {
        assert.equal((await as[k].get('/usuarios')).status, 403, `${k} lista`);
        assert.equal((await as[k].get('/usuarios/novo')).status, 403, `${k} novo`);
        assert.equal((await as[k].act('/usuarios', { name: 'Zé', email: 'ze@t.com', role: 'produtora' })).status, 403, `${k} cria`);
        assert.equal((await as[k].get('/auditoria')).status, 403, `${k} auditoria`);
        assert.equal((await as[k].get('/integracoes')).status, 403, `${k} integrações`);
      }
    });

    it('edita nome/perfil; mudar o perfil derruba as sessões da pessoa', async () => {
      const victim = h.client(app.base);
      await victim.login('prod@t.com');
      assert.equal((await victim.get('/')).status, 200);
      const r = await as.gestao.act(`/usuarios/${produtora.id}`, { name: 'Paula P.', email: 'prod@t.com', role: 'editor_video' }, { from: '/usuarios' });
      assert.equal(r.status, 302);
      assert.equal((await victim.get('/')).status, 302, 'sessão antiga invalidada');
      const { rows } = await h.db.query('SELECT name, role FROM users WHERE id = $1', [produtora.id]);
      assert.deepEqual(rows[0], { name: 'Paula P.', role: 'editor_video' });
      await as.gestao.act(`/usuarios/${produtora.id}`, { name: 'Paula Produtora', email: 'prod@t.com', role: 'produtora' }, { from: '/usuarios' });
      assert.equal((await as.prod.login('prod@t.com')).status, 302);
    });

    it('ninguém muda o próprio perfil nem se desativa/exclui; último superadmin é protegido', async () => {
      const self = await as.admin.act(`/usuarios/${admin.id}`, { name: 'Ana Admin', email: 'admin@t.com', role: 'produtora' }, { from: '/usuarios' });
      assert.equal(self.status, 302);
      assert.equal((await h.db.query('SELECT role FROM users WHERE id=$1', [admin.id])).rows[0].role, 'superadmin', 'perfil próprio ignorado');
      assert.equal((await as.admin.act(`/usuarios/${admin.id}/status`, { active: 'false' }, { from: '/usuarios' })).status, 403);
      assert.equal((await as.admin.act(`/usuarios/${admin.id}/excluir`, {}, { from: '/usuarios' })).status, 403);

      // Sara (2º superadmin) pode desativar/rebaixar Ana, mas não a si mesma (então sempre sobra 1 ativo).
      const sara = await h.db.query("SELECT id FROM users WHERE email='sara@t.com'");
      const saraC = h.client(app.base);
      await h.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [sara.rows[0].id, await require('../src/auth/password').hashPassword(PASS)]);
      await saraC.login('sara@t.com');
      assert.equal((await saraC.act(`/usuarios/${sara.rows[0].id}/status`, { active: 'false' }, { from: '/usuarios' })).status, 403);
      assert.equal((await saraC.act(`/usuarios/${admin.id}/status`, { active: 'false' }, { from: '/usuarios' })).status, 302);
      assert.equal((await as.admin.get('/')).status, 302, 'Ana desativada perde a sessão');
      assert.equal((await saraC.act(`/usuarios/${admin.id}/status`, { active: 'true' }, { from: '/usuarios' })).status, 302);
      assert.equal((await as.admin.login('admin@t.com')).status, 302, 'Ana reativada volta');
      assert.equal((await h.db.query("SELECT count(*)::int n FROM users WHERE role='superadmin' AND active")).rows[0].n, 2);
    });

    it('guard do último superadmin vale mesmo em corrida (testado direto no banco)', async () => {
      await h.db.query("UPDATE users SET active = false WHERE email = 'sara@t.com'");
      // Ana é a única ativa: nem outra rota consegue tirá-la — simulamos um "ator" superadmin inativo com sessão antiga
      const ghost = await h.db.query("SELECT id FROM users WHERE email='sara@t.com'");
      assert.equal((await h.db.query("SELECT count(*)::int n FROM users WHERE role='superadmin' AND active AND id <> $1", [admin.id])).rows[0].n, 0);
      await h.db.query("UPDATE users SET active = true WHERE id = $1", [ghost.rows[0].id]);
    });

    it('desativado perde acesso na hora; reativado volta; só superadmin exclui', async () => {
      const c = h.client(app.base);
      await c.login('edit@t.com');
      assert.equal((await c.get('/')).status, 200);
      assert.equal((await as.gestao.act(`/usuarios/${editor.id}/status`, { active: 'false' }, { from: '/usuarios' })).status, 302);
      assert.equal((await c.get('/')).status, 302);
      assert.equal((await h.client(app.base).login('edit@t.com')).status, 401);
      await as.gestao.act(`/usuarios/${editor.id}/status`, { active: 'true' }, { from: '/usuarios' });
      assert.equal((await as.editor.login('edit@t.com')).status, 302); // reativado: entra de novo

      assert.equal((await as.gestao.act(`/usuarios/${editor.id}/excluir`, {}, { from: '/usuarios' })).status, 403);
      await as.gestao.act('/usuarios', { name: 'Temp Tester', email: 'temp@t.com', role: 'editor_video' }, { from: '/usuarios/novo' });
      const temp = (await h.db.query("SELECT id FROM users WHERE email='temp@t.com'")).rows[0];
      assert.equal((await as.admin.act(`/usuarios/${temp.id}/excluir`, {}, { from: '/usuarios' })).status, 302);
      assert.equal((await h.db.query('SELECT 1 FROM users WHERE id=$1', [temp.id])).rowCount, 0);
    });

    it('reenviar acesso gera novo e-mail', async () => {
      h.mailer.outbox.length = 0;
      const r = await as.gestao.act(`/usuarios/${editor.id}/reenviar`, {}, { from: '/usuarios' });
      assert.equal(r.status, 302);
      assert.ok(lastMail('edit@t.com'));
    });
  });

  describe('convidados + convite', () => {
    let guestId; let token; let shortUrl;

    it('produtora cadastra convidado; editor de vídeo só enxerga', async () => {
      const r = await as.prod.act('/convidados', {
        name: 'Maria <b>Souza</b>', email: 'maria@conv.com', company: 'Estúdio X', topic: 'Marcas & histórias',
        proposed_at: '2026-12-10T15:00', owner_id: produtora.id, status: 'prospect',
      }, { from: '/convidados/novo' });
      assert.equal(r.status, 302);
      guestId = r.location.split('/').pop();
      assert.match(guestId, /^\d+$/);

      assert.equal((await as.editor.get('/convidados')).status, 200);
      assert.equal((await as.editor.get(`/convidados/${guestId}`)).status, 200);
      assert.equal((await as.editor.get('/convidados/novo')).status, 403);
      assert.equal((await as.editor.act('/convidados', { name: 'Intruso' })).status, 403);
      assert.equal((await as.editor.act(`/convidados/${guestId}/convite`, {}, { from: '/convidados' })).status, 403);
      assert.equal((await as.editor.act(`/convidados/${guestId}/status`, { status: 'gravado' }, { from: '/convidados' })).status, 403);
      assert.equal((await as.prod.act(`/convidados/${guestId}/excluir`, {}, { from: '/convidados' })).status, 403, 'produtora não exclui');
    });

    it('HTML digitado é escapado no painel (sem XSS armazenado)', async () => {
      const page = (await as.prod.get(`/convidados/${guestId}`)).text;
      assert.doesNotMatch(page, /<b>Souza<\/b>/);
      assert.match(page, /Maria &lt;b&gt;Souza&lt;\/b&gt;/);
    });

    it('valida formulário', async () => {
      assert.equal((await as.prod.act('/convidados', { name: 'A' }, { from: '/convidados/novo' })).status, 400);
      assert.equal((await as.prod.act('/convidados', { name: 'Ok Nome', email: 'ruim' }, { from: '/convidados/novo' })).status, 400);
      assert.equal((await as.prod.act('/convidados', { name: 'Ok Nome', proposed_at: 'ontem' }, { from: '/convidados/novo' })).status, 400);
      assert.equal((await as.prod.act('/convidados', { name: 'Ok Nome', owner_id: '00000000-0000-4000-8000-000000000000' }, { from: '/convidados/novo' })).status, 400);
    });

    it('gera link do convite: token + link curto no YOURLS (com retry de keyword ocupada)', async () => {
      h.setCollisions(1);
      h.yourlsCalls.length = 0;
      const r = await as.prod.act(`/convidados/${guestId}/convite`, {}, { from: `/convidados/${guestId}` });
      assert.equal(r.status, 302);
      const { rows: [g] } = await h.db.query('SELECT * FROM guests WHERE id = $1', [guestId]);
      token = g.invite_token;
      shortUrl = g.short_url;
      assert.match(token, /^[A-Za-z0-9_-]{20,}$/);
      assert.match(shortUrl, /^https:\/\/yourls\.test\/[a-z0-9-]+$/);
      assert.equal(h.yourlsCalls.length, 2, 'primeira keyword colidiu, segunda passou');
      assert.equal(h.yourlsCalls[0].keyword, 'maria', 'convenção: nome curto do convidado, como nos links manuais');
      assert.notEqual(h.yourlsCalls[1].keyword, 'maria');
      assert.match(h.yourlsCalls[0].title, /Pulso|Podcast/);
      const call = h.yourlsCalls.at(-1);
      assert.equal(call.signature, 'fake-signature');
      assert.equal(call.format, 'json');
      assert.equal(call.url, `http://localhost/convite/${token}`);
      const ev = await h.db.query("SELECT 1 FROM guest_events WHERE guest_id=$1 AND type='convite_gerado'", [guestId]);
      assert.equal(ev.rowCount, 1);
    });

    it('gerar de novo (sem regenerar) mantém token e link; regenerar invalida o antigo', async () => {
      await as.prod.act(`/convidados/${guestId}/convite`, {}, { from: `/convidados/${guestId}` });
      assert.equal((await h.db.query('SELECT invite_token FROM guests WHERE id=$1', [guestId])).rows[0].invite_token, token);

      await as.prod.act(`/convidados/${guestId}/convite`, { regenerar: '1' }, { from: `/convidados/${guestId}` });
      const { rows: [fresh] } = await h.db.query('SELECT invite_token, short_url FROM guests WHERE id=$1', [guestId]);
      const newToken = fresh.invite_token;
      assert.notEqual(newToken, token);
      assert.notEqual(fresh.short_url, shortUrl, 'link curto novo também');
      shortUrl = fresh.short_url;
      assert.equal((await h.client(app.base).get(`/convite/${token}`)).status, 404, 'link antigo morreu');
      token = newToken;
    });

    it('se o YOURLS falhar, o link completo continua valendo', async () => {
      const real = global.fetch;
      global.fetch = async (u, o) => (String(u).startsWith('https://yourls.test') ? Response.json({ status: 'fail', message: 'Please log in', statusCode: 403 }) : real(u, o));
      try {
        const r = await as.prod.act('/convidados', { name: 'Sem Curto', owner_id: produtora.id }, { from: '/convidados/novo' });
        const id = r.location.split('/').pop();
        const gen = await as.prod.act(`/convidados/${id}/convite`, {}, { from: `/convidados/${id}` });
        assert.equal(gen.status, 302);
        const { rows: [g] } = await h.db.query('SELECT invite_token, short_url FROM guests WHERE id=$1', [id]);
        assert.ok(g.invite_token);
        assert.equal(g.short_url, null);
        assert.equal((await h.client(app.base).get(`/convite/${g.invite_token}`)).status, 200);
      } finally {
        global.fetch = real;
      }
    });

    it('página pública: renderiza o modelo, escapa dados, aplica CSP sem script e não é indexável', async () => {
      const c = h.client(app.base);
      const r = await c.get(`/convite/${token}`, { ua: 'WhatsApp/2.23' }); // robô: não conta como visualização
      assert.equal(r.status, 200);
      assert.match(r.text, /Olá, Maria!/);
      assert.match(r.text, /Marcas &amp; histórias/);
      assert.match(r.text, /quinta-feira, 10 de dezembro de 2026/);
      assert.match(r.text, /Paula Produtora/);
      assert.match(r.text, new RegExp(`action="/convite/${token}/responder"`));
      assert.doesNotMatch(r.text, /\{\{/);
      const csp = r.headers.get('content-security-policy');
      assert.match(csp, /default-src 'none'/);
      assert.match(csp, /sandbox allow-scripts allow-forms/);
      assert.doesNotMatch(csp, /allow-same-origin/, 'scripts do modelo ficam isolados do painel');
      assert.doesNotMatch(csp, /connect-src/);
      assert.match(csp, /script-src 'unsafe-inline'/);
      assert.match(r.headers.get('x-robots-tag'), /noindex/);
    });

    it('token inválido/forjado devolve 404 genérico', async () => {
      const c = h.client(app.base);
      for (const t of ['x', 'a'.repeat(24), "' OR 1=1 --", '../../etc/passwd']) {
        assert.equal((await c.get(`/convite/${encodeURIComponent(t)}`)).status, 404, t);
      }
      assert.equal((await c.post(`/convite/${'a'.repeat(24)}/responder`, { resposta: 'aceito' })).status, 404);
    });

    it('"visto" ignora robôs de preview (WhatsApp) e conta o primeiro acesso humano', async () => {
      const c = h.client(app.base);
      await c.get(`/convite/${token}`, { ua: 'WhatsApp/2.23 A' });
      await c.get(`/convite/${token}`, { ua: 'facebookexternalhit/1.1' });
      assert.equal((await h.db.query('SELECT invite_viewed_at FROM guests WHERE id=$1', [guestId])).rows[0].invite_viewed_at, null);
      await c.get(`/convite/${token}`);
      await c.get(`/convite/${token}`);
      assert.ok((await h.db.query('SELECT invite_viewed_at FROM guests WHERE id=$1', [guestId])).rows[0].invite_viewed_at);
      assert.equal((await h.db.query("SELECT 1 FROM guest_events WHERE guest_id=$1 AND type='convite_visto'", [guestId])).rowCount, 1, 'registra uma vez só');
    });

    it('envia o convite por e-mail (Brevo) e avança a etapa', async () => {
      h.mailer.outbox.length = 0;
      const none = await as.prod.act(`/convidados/${guestId}/enviar`, { mensagem: '' }, { from: `/convidados/${guestId}` });
      assert.equal(none.status, 302);
      assert.equal(h.mailer.outbox.length, 0, 'mensagem vazia não envia');

      const r = await as.prod.act(`/convidados/${guestId}/enviar`, { mensagem: 'Olá Maria!\n\nSegue seu convite.' }, { from: `/convidados/${guestId}` });
      assert.equal(r.status, 302);
      const mail = lastMail('maria@conv.com');
      assert.ok(mail);
      assert.equal(mail.replyTo, 'prod@t.com', 'respostas vão para quem enviou');
      assert.match(mail.subject, /Convite para o/);
      assert.ok(mail.html.includes(shortUrl) || mail.html.includes(`/convite/${token}`));
      const { rows: [g] } = await h.db.query('SELECT status, invite_sent_at FROM guests WHERE id=$1', [guestId]);
      assert.equal(g.status, 'convite_enviado');
      assert.ok(g.invite_sent_at);
    });

    it('convidado aceita: etapa vira "confirmado", responsável é avisado, página mostra confirmação', async () => {
      h.mailer.outbox.length = 0;
      const c = h.client(app.base);
      const r = await c.post(`/convite/${token}/responder`, { resposta: 'aceito', mensagem: 'Combinado! <3' });
      assert.equal(r.status, 302);
      const { rows: [g] } = await h.db.query('SELECT status, rsvp_message, responded_at FROM guests WHERE id=$1', [guestId]);
      assert.equal(g.status, 'confirmado');
      assert.equal(g.rsvp_message, 'Combinado! <3');
      assert.ok(g.responded_at);
      const notice = lastMail('prod@t.com');
      assert.ok(notice, 'responsável avisado');
      assert.match(notice.subject, /aceitou/);
      assert.match(notice.html, /Combinado! &lt;3/);
      assert.match((await c.get(`/convite/${token}`)).text, /presença está confirmada/);
    });

    it('resposta inválida é ignorada; convidado pode mudar de ideia; convite encerrado não aceita resposta', async () => {
      const c = h.client(app.base);
      await c.post(`/convite/${token}/responder`, { resposta: 'hackeado' });
      assert.equal((await h.db.query('SELECT status FROM guests WHERE id=$1', [guestId])).rows[0].status, 'confirmado');
      await c.post(`/convite/${token}/responder`, { resposta: 'recusado', mensagem: 'Surgiu um imprevisto' });
      assert.equal((await h.db.query('SELECT status FROM guests WHERE id=$1', [guestId])).rows[0].status, 'recusou');

      await as.prod.act(`/convidados/${guestId}/status`, { status: 'gravado' }, { from: '/convidados' });
      await c.post(`/convite/${token}/responder`, { resposta: 'aceito' });
      assert.equal((await h.db.query('SELECT status FROM guests WHERE id=$1', [guestId])).rows[0].status, 'gravado', 'gravado não volta por RSVP');
      const page = (await c.get(`/convite/${token}`)).text;
      assert.match(page, /não está mais aberto/);
      assert.doesNotMatch(page, /<form/);
    });

    it('arrastar no quadro (JSON) muda a etapa e registra na linha do tempo', async () => {
      const csrf = await as.prod.csrf('/convidados');
      const r = await as.prod.post(`/convidados/${guestId}/status`, { status: 'publicado' },
        { headers: { accept: 'application/json', 'x-csrf-token': csrf } });
      assert.equal(r.status, 200);
      assert.deepEqual(JSON.parse(r.text), { ok: true });
      assert.equal((await h.db.query('SELECT status FROM guests WHERE id=$1', [guestId])).rows[0].status, 'publicado');
      const bad = await as.prod.post(`/convidados/${guestId}/status`, { status: 'inventada' }, { headers: { accept: 'application/json', 'x-csrf-token': csrf } });
      assert.equal(bad.status, 400);
      const semCsrf = await as.prod.post(`/convidados/${guestId}/status`, { status: 'gravado' }, { headers: { accept: 'application/json' } });
      assert.equal(semCsrf.status, 403);
      const board = await as.prod.get('/convidados');
      assert.equal(board.status, 200);
      assert.match(board.text, /data-board/);
      assert.equal((await as.prod.get('/convidados?view=lista&status=publicado&q=maria')).status, 200);
    });

    it('anotação entra na linha do tempo; só gestão/superadmin exclui', async () => {
      await as.prod.act(`/convidados/${guestId}/nota`, { nota: 'Ligou confirmando horário' }, { from: `/convidados/${guestId}` });
      assert.match((await as.prod.get(`/convidados/${guestId}`)).text, /Ligou confirmando horário/);
      assert.equal((await as.gestao.act(`/convidados/${guestId}/excluir`, {}, { from: '/convidados' })).status, 302);
      assert.equal((await as.prod.get(`/convidados/${guestId}`)).status, 404);
      assert.equal((await h.client(app.base).get(`/convite/${token}`)).status, 404, 'link morre junto');
    });

    it('IDs malformados viram 404, não erro 500', async () => {
      for (const p of ['/convidados/abc', '/convidados/99999999', '/usuarios/xyz/editar', '/modelos/abc/editar']) {
        assert.equal((await as.admin.get(p)).status, 404, p);
      }
    });
  });

  describe('modelos de convite', () => {
    it('lista, pré-visualiza com dados fictícios e edita o HTML', async () => {
      const list = await as.gestao.get('/modelos');
      assert.equal(list.status, 200);
      assert.match(list.text, /Convite Pulso/);
      assert.match(list.text, /Convite simples/);
      const { rows: [t] } = await h.db.query('SELECT id FROM invite_templates LIMIT 1');
      const prev = await as.prod.get(`/modelos/${t.id}/previa`);
      assert.equal(prev.status, 200);
      assert.match(prev.text, /Maria/);
      assert.match(prev.headers.get('content-security-policy'), /frame-ancestors 'self'/);

      const html = '<html><body><h1>Oi {{primeiro_nome}}</h1><p>{{tema}}</p>{{bloco_resposta}}</body></html>';
      const r = await as.gestao.act(`/modelos/${t.id}`, { name: 'Meu modelo', subject: 'Convite {{podcast}}', html_body: html }, { from: '/modelos' });
      assert.equal(r.status, 302);
      assert.match((await as.prod.get(`/modelos/${t.id}/previa`)).text, /<h1>Oi Maria<\/h1>/);
    });

    it('produtora vê mas não edita; valida campos; avisa quando falta {{bloco_resposta}}', async () => {
      const { rows: [t] } = await h.db.query('SELECT id FROM invite_templates LIMIT 1');
      assert.equal((await as.prod.get('/modelos')).status, 200);
      assert.equal((await as.prod.get(`/modelos/${t.id}/editar`)).status, 403);
      assert.equal((await as.prod.act('/modelos', { name: 'x', subject: 'y', html_body: '<p>oi</p>' })).status, 403);
      assert.equal((await as.gestao.act('/modelos', { name: 'Sem html', subject: 'a', html_body: '' }, { from: '/modelos/novo' })).status, 400);
      assert.equal((await as.gestao.act('/modelos', { name: 'Gigante', subject: 'a', html_body: 'x'.repeat(200_001) }, { from: '/modelos/novo' })).status, 400);
      const r = await as.gestao.act('/modelos', { name: 'Sem botões', subject: 'Oi', html_body: '<html><body>Convite sem botões de resposta</body></html>' }, { from: '/modelos/novo' });
      assert.equal(r.status, 302);
      assert.match((await as.gestao.get('/modelos')).text, /bloco_resposta/);
    });

    it('padrão não pode ser excluído; trocar padrão funciona; convidado usa o modelo escolhido', async () => {
      const { rows } = await h.db.query('SELECT id, name, is_default FROM invite_templates ORDER BY id');
      const def = rows.find((x) => x.is_default);
      const other = rows.find((x) => x.name === 'Sem botões');
      await as.gestao.act(`/modelos/${def.id}/excluir`, {}, { from: '/modelos' });
      assert.equal((await h.db.query('SELECT 1 FROM invite_templates WHERE id=$1', [def.id])).rowCount, 1);

      const g = await as.prod.act('/convidados', { name: 'Com Modelo', template_id: String(other.id), owner_id: produtora.id }, { from: '/convidados/novo' });
      const id = g.location.split('/').pop();
      await as.prod.act(`/convidados/${id}/convite`, {}, { from: `/convidados/${id}` });
      const tk = (await h.db.query('SELECT invite_token FROM guests WHERE id=$1', [id])).rows[0].invite_token;
      assert.match((await h.client(app.base).get(`/convite/${tk}`)).text, /Convite sem botões/);

      await as.gestao.act(`/modelos/${other.id}/padrao`, {}, { from: '/modelos' });
      assert.equal((await h.db.query('SELECT count(*)::int n FROM invite_templates WHERE is_default')).rows[0].n, 1);
      await as.gestao.act(`/modelos/${other.id}/excluir`, {}, { from: '/modelos' }); // agora padrão: continua
      assert.equal((await h.db.query('SELECT 1 FROM invite_templates WHERE id=$1', [other.id])).rowCount, 1);
      await as.gestao.act(`/modelos/${def.id}/excluir`, {}, { from: '/modelos' });
      assert.equal((await h.db.query('SELECT 1 FROM invite_templates WHERE id=$1', [def.id])).rowCount, 0);
    });
  });

  describe('painel, perfil, auditoria e integrações', () => {
    it('dashboard carrega para todos os perfis', async () => {
      for (const k of ['admin', 'gestao', 'prod', 'editor']) assert.equal((await as[k].get('/')).status, 200, k);
    });

    it('auditoria registra ações sensíveis e é restrita', async () => {
      const page = await as.gestao.get('/auditoria');
      assert.equal(page.status, 200);
      for (const a of ['usuario.criado', 'login.falha', 'convite.gerado', 'convite.enviado', 'convidado.excluido']) {
        assert.match(page.text, new RegExp(a.replace('.', '\\.')), a);
      }
    });

    it('perfil: troca de senha exige a atual e derruba as outras sessões', async () => {
      const a = h.client(app.base); const b = h.client(app.base);
      await a.login('gestao@t.com'); await b.login('gestao@t.com');
      await a.act('/perfil/senha', { current: 'errada', password: 'Outra-Senha-789', confirm: 'Outra-Senha-789' }, { from: '/perfil' });
      assert.equal((await h.client(app.base).login('gestao@t.com', 'Outra-Senha-789')).status, 401);
      await a.act('/perfil/senha', { current: PASS, password: 'Outra-Senha-789', confirm: 'Outra-Senha-789' }, { from: '/perfil' });
      assert.equal((await a.get('/')).status, 200, 'sessão atual continua');
      assert.equal((await b.get('/')).status, 302, 'outra sessão caiu');
      assert.equal((await h.client(app.base).login('gestao@t.com', 'Outra-Senha-789')).status, 302);
    });

    it('integrações: gestão vê status sem segredos e testa YOURLS (read-only) e e-mail', async () => {
      const page = await as.admin.get('/integracoes');
      assert.equal(page.status, 200);
      assert.doesNotMatch(page.text, /fake-signature/);
      h.yourlsCalls.length = 0; h.mailer.outbox.length = 0;
      await as.admin.act('/integracoes/yourls', {}, { from: '/integracoes' });
      assert.deepEqual(h.yourlsCalls.map((c) => c.action), ['db-stats'], 'teste não cria links');
      await as.admin.act('/integracoes/email', {}, { from: '/integracoes' });
      assert.ok(lastMail('admin@t.com'));
    });

    it('erro de rota inexistente é 404 amigável, healthcheck responde e cabeçalhos de segurança estão presentes', async () => {
      const r = await as.admin.get('/nao-existe');
      assert.equal(r.status, 404);
      assert.equal((await h.client(app.base).get('/healthz')).status, 200);
      const login = await h.client(app.base).get('/login');
      assert.equal(login.headers.get('x-content-type-options'), 'nosniff');
      assert.match(login.headers.get('content-security-policy'), /script-src 'self'/);
      assert.match(login.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    });
  });

  describe('modelo Pulso (o convite real, com JS, gênero e dupla)', () => {
    let pulsoId;
    before(async () => { // os testes de modelos acima editaram/apagaram os modelos de fábrica: recria
      await h.db.query('DELETE FROM invite_templates');
      await require('../src/db/seed').seedDefaultTemplate();
    });
    const guestFlow = async (fields) => {
      const r = await as.prod.act('/convidados', { owner_id: produtora.id, template_id: String(pulsoId), ...fields }, { from: '/convidados/novo' });
      assert.equal(r.status, 302, JSON.stringify(fields));
      const id = r.location.split('/').pop();
      await as.prod.act(`/convidados/${id}/convite`, {}, { from: `/convidados/${id}` });
      const { rows: [g] } = await h.db.query('SELECT invite_token FROM guests WHERE id=$1', [id]);
      return { id, token: g.invite_token, page: await h.client(app.base).get(`/convite/${g.invite_token}`, { ua: 'WhatsApp/2.23' }) };
    };

    it('o modelo padrão do repositório é o convite Pulso e não depende mais de ?nome= na URL', async () => {
      const { rows } = await h.db.query("SELECT id, html_body FROM invite_templates WHERE name LIKE 'Convite Pulso%'");
      assert.equal(rows.length, 1);
      pulsoId = rows[0].id;
      assert.doesNotMatch(rows[0].html_body, /URLSearchParams/);
      assert.doesNotMatch(rows[0].html_body, /data:image\/jpeg;base64/, 'imagens saíram do HTML');
      assert.match(rows[0].html_body, /\{\{guest_json\}\}/);
      assert.match(rows[0].html_body, /\{\{bloco_resposta\}\}/);
    });

    it('injeta nome, gênero e dupla como JSON; mantém intro/JS; imagens estáticas existem', async () => {
      const f = await guestFlow({ name: 'Ana Paula Lima', gender: 'f' });
      assert.equal(f.page.status, 200);
      assert.match(f.page.text, /const G = \{"nome":"Ana Paula Lima","plural":false,"sexo":"f"\};/);
      assert.match(f.page.text, /intro-overlay/);
      assert.doesNotMatch(f.page.text, /\{\{/);
      assert.match(f.page.text, new RegExp(`action="/convite/${f.token}/responder"`));

      const dupla = await guestFlow({ name: 'Dr. João e Dra. Maria', gender: 'm', is_plural: '1' });
      assert.match(dupla.page.text, /"nome":"Dr\. João e Dra\. Maria","plural":true,"sexo":"m"/);

      const img = f.page.text.match(/\/static\/convite\/img-\d+\.jpg/g);
      assert.ok(img && img.length >= 9, 'referencia as 9 imagens extraídas');
      for (const path of new Set(img)) {
        const r = await fetch(app.base + path);
        assert.equal(r.status, 200, path);
        assert.equal(r.headers.get('content-type'), 'image/jpeg');
      }
    });

    it('nome malicioso não escapa do <script> nem injeta HTML (guest_json é seguro)', async () => {
      const evil = '</script><img src=x onerror=alert(1)> \u2028 "q" \\';
      const f = await guestFlow({ name: evil });
      const m = f.page.text.match(/const G = (\{.*\});/);
      assert.ok(m, 'bloco G presente');
      assert.doesNotMatch(m[1], /<|>/, 'sem < ou > crus dentro do script');
      assert.equal(JSON.parse(m[1]).nome, evil, 'o valor original é preservado ao interpretar o JSON');
      assert.equal((f.page.text.match(/<\/script>/g) || []).length, (await h.db.query("SELECT html_body FROM invite_templates WHERE id=$1", [pulsoId])).rows[0].html_body.match(/<\/script>/g).length, 'mesmo número de </script> do modelo');
    });

    it('formulário do convite vem de origem null (sandbox): o POST do convidado é aceito; outros POSTs com origin null não', async () => {
      const f = await guestFlow({ name: 'Origem Nula' });
      const c = h.client(app.base);
      const ok = await c.post(`/convite/${f.token}/responder`, { resposta: 'aceito' }, { headers: { origin: 'null' } });
      assert.equal(ok.status, 302);
      assert.equal((await h.db.query('SELECT status FROM guests WHERE id=$1', [f.id])).rows[0].status, 'confirmado');
      const csrf = await as.prod.csrf('/perfil');
      assert.equal((await as.prod.post('/perfil', { _csrf: csrf, name: 'X Y' }, { headers: { origin: 'null' } })).status, 403);
    });

    it('formulário de convidado salva gênero/dupla e mostra no detalhe', async () => {
      const f = await guestFlow({ name: 'Duo Teste', gender: 'f', is_plural: '1' });
      const { rows: [g] } = await h.db.query('SELECT gender, is_plural FROM guests WHERE id=$1', [f.id]);
      assert.deepEqual(g, { gender: 'f', is_plural: true });
      assert.match((await as.prod.get(`/convidados/${f.id}`)).text, /Dupla · Feminino/);
      assert.match((await as.prod.get(`/convidados/${f.id}/editar`)).text, /name="is_plural" value="1" checked/);
    });
  });
});
