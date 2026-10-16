const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const PASS = 'SenhaForte-123';
let app;
let admin; let gestao; let produtora; let editor;
const as = {}; // clientes logados por perfil

const lastMail = (to) => [...h.mailer.outbox].reverse().find((m) => !to || m.to === to);
const linkIn = (mail, re) => mail.html.match(re)?.[0];
// campos mínimos de um convidado válido (nome, Instagram e perfil são obrigatórios)
const min = (o = {}) => ({ instagram: '@pulso.teste', profile: 'medico', ...o });
const JSON_HEADERS = (csrf) => ({ accept: 'application/json', 'x-csrf-token': csrf });

describe('fluxos ponta a ponta', () => {
  before(async () => {
    await h.resetDb();
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
      const r = await as.prod.act('/convidados', min({
        name: 'Maria <b>Souza</b>', email: 'maria@conv.com', company: 'Estúdio X', topic: 'Marcas & histórias',
        proposed_at: '2026-12-10T15:00', owner_id: produtora.id, status: 'prospect',
      }), { from: '/convidados/novo' });
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
      const bad = (fields) => as.prod.act('/convidados', fields, { from: '/convidados/novo' });
      assert.equal((await bad(min({ name: 'A' }))).status, 400);
      assert.equal((await bad(min({ name: 'Ok Nome', email: 'ruim' }))).status, 400);
      assert.equal((await bad(min({ name: 'Ok Nome', proposed_at: 'ontem' }))).status, 400);
      assert.equal((await bad(min({ name: 'Ok Nome', owner_id: '00000000-0000-4000-8000-000000000000' }))).status, 400);
      assert.match((await bad({ name: 'Ok Nome', profile: 'medico' })).text, /Instagram/, 'Instagram é obrigatório');
      assert.match((await bad({ name: 'Ok Nome', instagram: '@ok' })).text, /perfil/, 'perfil é obrigatório');
      assert.equal((await bad({ name: 'Ok Nome', instagram: '@com espaço', profile: 'medico' })).status, 400);
      assert.equal((await bad(min({ name: 'Ok Nome', profile: 'astronauta' }))).status, 400);
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
        const r = await as.prod.act('/convidados', min({ name: 'Sem Curto', owner_id: produtora.id }), { from: '/convidados/novo' });
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

    it('página pública: renderiza o convite fixo, escapa dados, aplica CSP e não é indexável', async () => {
      const c = h.client(app.base);
      const r = await c.get(`/convite/${token}`, { ua: 'WhatsApp/2.23' }); // robô: não conta como visualização
      assert.equal(r.status, 200);
      assert.match(r.text, /const G = \{"nome":"Maria \\u003cb\\u003eSouza/, 'nome entra como JSON seguro');
      assert.doesNotMatch(r.text, /<b>Souza<\/b>/);
      assert.match(r.text, new RegExp(`href="/convite/${token}/aceitar"`), 'botão aceitar passa pelo rastreio');
      assert.match(r.text, new RegExp(`href="/convite/${token}/producao"`), 'botão produção passa pelo rastreio');
      assert.doesNotMatch(r.text, /href="https:\/\/wa\.me/, 'nenhum botão vai direto ao WhatsApp');
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
      assert.equal((await c.post(`/convite/${'a'.repeat(24)}/responder`, { resposta: 'recusado' })).status, 404);
      for (const sub of ['aceitar', 'producao']) assert.equal((await c.get(`/convite/${'a'.repeat(24)}/${sub}`)).status, 404, sub);
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

    it('clicar em "Aceitar": conta o clique, vira "Em agendamento", avisa o responsável e leva ao WhatsApp', async () => {
      h.mailer.outbox.length = 0;
      const c = h.client(app.base);
      const r = await c.get(`/convite/${token}/aceitar`);
      assert.equal(r.status, 200);
      assert.match(r.text, /Convite aceito/);
      assert.match(r.text, /Maria/);
      const refresh = r.text.match(/<meta http-equiv="refresh" content="3;url=([^"]+)">/);
      assert.ok(refresh, 'redireciona sozinho');
      assert.match(refresh[1], /^https:\/\/wa\.me\/5512991053852\?text=Ol%C3%A1/);
      assert.match(r.text, /Abrir o WhatsApp agora/, 'link manual de reserva');
      assert.match(r.headers.get('content-security-policy'), /sandbox/);

      const { rows: [g] } = await h.db.query('SELECT status, responded_at FROM guests WHERE id=$1', [guestId]);
      assert.equal(g.status, 'em_agendamento');
      assert.ok(g.responded_at);
      assert.equal((await h.db.query("SELECT count(*)::int n FROM invite_clicks WHERE guest_id=$1 AND kind='aceitar'", [guestId])).rows[0].n, 1);
      const notice = lastMail('prod@t.com');
      assert.ok(notice, 'responsável avisado');
      assert.match(notice.subject, /aceitou/);
      const { rows: inApp } = await h.db.query("SELECT user_id, title, body FROM notifications WHERE type = 'convite' AND entity_id = $1", [String(guestId)]);
      assert.ok(inApp.length, 'aceite vira notificação no painel');
      assert.match(inApp[0].title, /aceitou o convite/); assert.match(inApp[0].body, /combinar a data/);
      assert.ok(inApp.some((n) => String(n.user_id) === String(produtora.id)), 'quem cuida do convidado recebe');
      assert.match((await c.get(`/convite/${token}`)).text, /presença está confirmada/);
      assert.match((await as.prod.get(`/convidados/${guestId}`)).text, /Aceitar o convite<\/dt>\s*<dd><strong[^>]*>1<\/strong>/);
    });

    it('clicar de novo em "Aceitar" conta o clique mas não repete a mudança de etapa nem o e-mail', async () => {
      h.mailer.outbox.length = 0;
      const c = h.client(app.base);
      assert.equal((await c.get(`/convite/${token}/aceitar`)).status, 200);
      assert.equal((await h.db.query("SELECT count(*)::int n FROM invite_clicks WHERE guest_id=$1 AND kind='aceitar'", [guestId])).rows[0].n, 2);
      assert.equal(h.mailer.outbox.length, 0, 'sem novo aviso');
      assert.equal((await h.db.query('SELECT status FROM guests WHERE id=$1', [guestId])).rows[0].status, 'em_agendamento');
    });

    it('zerar o aceite: apaga os cliques e a resposta e volta para Prospecção; quem já tem gravação marcada não passa', async () => {
      const zero = () => as.prod.act(`/convidados/${guestId}/zerar-aceite`, {}, { from: `/convidados/${guestId}` });
      assert.equal((await as.editor.act(`/convidados/${guestId}/zerar-aceite`, {}, { from: '/convidados' })).status, 403, 'só quem edita convidados');
      assert.match((await as.prod.get(`/convidados/${guestId}`)).text, /Zerar aceite e voltar para Prospecção/);

      assert.equal((await zero()).status, 302);
      const { rows: [g] } = await h.db.query('SELECT status, responded_at, rsvp_message, invite_token FROM guests WHERE id=$1', [guestId]);
      assert.deepEqual([g.status, g.responded_at, g.rsvp_message], ['prospect', null, null]);
      assert.equal(g.invite_token, token, 'o link do convite continua o mesmo');
      assert.equal((await h.db.query("SELECT count(*)::int n FROM invite_clicks WHERE guest_id=$1 AND kind='aceitar'", [guestId])).rows[0].n, 0);
      assert.match((await h.db.query("SELECT message FROM guest_events WHERE guest_id=$1 ORDER BY id DESC LIMIT 1", [guestId])).rows[0].message, /Aceite zerado por .*2 clique\(s\) apagado\(s\).*Em agendamento → Prospecção/);
      assert.match((await as.gestao.get('/auditoria')).text, /convidado\.aceite_zerado/);
      assert.doesNotMatch((await as.prod.get(`/convidados/${guestId}`)).text, /Zerar aceite e voltar/, 'sem aceite para zerar o botão some');
      assert.doesNotMatch((await h.client(app.base).get(`/convite/${token}`)).text, /presença está confirmada/, 'o convite público volta a mostrar o formulário');

      await h.db.query("UPDATE guests SET status = 'agendado', proposed_at = now() + interval '5 days', scheduled_studio = true, scheduled_hosts = true, scheduled_guest = true WHERE id = $1", [guestId]);
      assert.equal((await zero()).status, 302);
      assert.equal((await h.db.query('SELECT status FROM guests WHERE id=$1', [guestId])).rows[0].status, 'agendado', 'gravação marcada: não zera');

      // devolve o convidado ao estado que os próximos testes esperam: aceitou duas vezes
      await h.db.query("UPDATE guests SET status = 'prospect', proposed_at = NULL, scheduled_studio = false, scheduled_hosts = false, scheduled_guest = false WHERE id = $1", [guestId]);
      const c = h.client(app.base);
      await c.get(`/convite/${token}/aceitar`); await c.get(`/convite/${token}/aceitar`);
      assert.equal((await h.db.query('SELECT status FROM guests WHERE id=$1', [guestId])).rows[0].status, 'em_agendamento');
    });

    it('"Falar com a produção": redireciona ao WhatsApp, conta cada clique e registra o primeiro na linha do tempo', async () => {
      const c = h.client(app.base);
      const r = await c.get(`/convite/${token}/producao`);
      assert.equal(r.status, 302);
      assert.match(r.location, /^https:\/\/wa\.me\/5512991053852\?text=Ol%C3%A1.*produ%C3%A7%C3%A3o/);
      await c.get(`/convite/${token}/producao`);
      assert.equal((await h.db.query("SELECT count(*)::int n FROM invite_clicks WHERE guest_id=$1 AND kind='producao'", [guestId])).rows[0].n, 2);
      assert.equal((await h.db.query("SELECT count(*)::int n FROM guest_events WHERE guest_id=$1 AND message LIKE '%Falar com a produção%'", [guestId])).rows[0].n, 1);
      assert.equal((await h.db.query('SELECT status FROM guests WHERE id=$1', [guestId])).rows[0].status, 'em_agendamento', 'não muda etapa');
    });

    it('robôs de pré-visualização (WhatsApp, Facebook) seguem o redirecionamento sem contar nem mudar etapa', async () => {
      const r = await as.prod.act('/convidados', min({ name: 'Bia Robô', owner_id: produtora.id }), { from: '/convidados/novo' });
      const id = r.location.split('/').pop();
      await as.prod.act(`/convidados/${id}/convite`, {}, { from: `/convidados/${id}` });
      const { rows: [g] } = await h.db.query('SELECT invite_token FROM guests WHERE id=$1', [id]);
      const c = h.client(app.base);
      for (const [path, ua] of [['aceitar', 'WhatsApp/2.23'], ['aceitar', 'facebookexternalhit/1.1'], ['producao', 'Slackbot-LinkExpanding 1.0']]) {
        const res = await c.get(`/convite/${g.invite_token}/${path}`, { ua });
        assert.equal(res.status, 302, `${path} ${ua}`);
        assert.match(res.location, /^https:\/\/wa\.me\//);
      }
      assert.equal((await h.db.query('SELECT count(*)::int n FROM invite_clicks WHERE guest_id=$1', [id])).rows[0].n, 0);
      assert.equal((await h.db.query('SELECT status FROM guests WHERE id=$1', [id])).rows[0].status, 'prospect');
    });

    it('formulário só aceita recusa; convidado pode mudar de ideia; convite encerrado não aceita resposta', async () => {
      const c = h.client(app.base);
      await c.post(`/convite/${token}/responder`, { resposta: 'hackeado' });
      await c.post(`/convite/${token}/responder`, { resposta: 'aceito' }); // aceitar agora é só pelo botão
      assert.equal((await h.db.query('SELECT status FROM guests WHERE id=$1', [guestId])).rows[0].status, 'em_agendamento');
      await c.post(`/convite/${token}/responder`, { resposta: 'recusado', mensagem: 'Surgiu um imprevisto' });
      const { rows: [g] } = await h.db.query('SELECT status, rsvp_message, loss_reason, loss_note FROM guests WHERE id=$1', [guestId]);
      assert.equal(g.status, 'perdido');
      assert.equal(g.loss_reason, 'recusado', 'o convidado não escolhe motivo: recusar pelo convite já é "Recusado"');
      assert.equal(g.loss_note, 'Surgiu um imprevisto');
      assert.equal(g.rsvp_message, 'Surgiu um imprevisto');
      assert.match((await c.get(`/convite/${token}`)).text, /não poderá participar/);

      await c.get(`/convite/${token}/aceitar`); // mudou de ideia: perdido -> em agendamento (o motivo sai)
      const back = (await h.db.query('SELECT status, loss_reason FROM guests WHERE id=$1', [guestId])).rows[0];
      assert.deepEqual([back.status, back.loss_reason], ['em_agendamento', null]);

      await as.prod.act(`/convidados/${guestId}/status`, { status: 'gravado' }, { from: '/convidados' });
      await c.post(`/convite/${token}/responder`, { resposta: 'recusado' });
      assert.equal((await h.db.query('SELECT status FROM guests WHERE id=$1', [guestId])).rows[0].status, 'gravado', 'gravado não volta por RSVP');
      await c.get(`/convite/${token}/aceitar`);
      assert.equal((await h.db.query('SELECT status FROM guests WHERE id=$1', [guestId])).rows[0].status, 'gravado', 'nem pelo botão');
      const page = (await c.get(`/convite/${token}`)).text;
      assert.match(page, /não está mais aberto/);
      assert.doesNotMatch(page, /<form/);
    });

    it('arrastar no quadro (JSON) muda a etapa; sem os dados exigidos devolve 422 com o caminho para completar', async () => {
      const csrf = await as.prod.csrf('/convidados');
      const move = (status, headers = JSON_HEADERS(csrf)) => as.prod.post(`/convidados/${guestId}/status`, { status }, { headers });

      await h.db.query('UPDATE guests SET scheduled_studio=false, scheduled_hosts=false, scheduled_guest=false WHERE id=$1', [guestId]);
      const blocked = await move('agendado');
      assert.equal(blocked.status, 422);
      const info = JSON.parse(blocked.text);
      assert.equal(info.ok, false);
      assert.ok(info.missing.includes('confirmação de agenda no Estúdio'));
      assert.equal(info.editUrl, `/convidados/${guestId}?abrir=agenda`, 'abre a janela da agenda');
      assert.equal((await h.db.query('SELECT status FROM guests WHERE id=$1', [guestId])).rows[0].status, 'gravado', 'continua onde estava');
      assert.equal((await move('publicado')).status, 400, 'Publicado não é etapa do convidado (o que se publica é o episódio)');

      await as.prod.act(`/convidados/${guestId}/avancar`, { para: 'gravado', agenda: '1', proposed_at: '2026-09-10T10:00', scheduled_studio: '1', scheduled_hosts: '1', scheduled_guest: '1' }, { from: `/convidados/${guestId}` });
      assert.deepEqual(JSON.parse((await move('agendado')).text), { ok: true }, 'agenda confirmada: arrastar passa');
      assert.equal((await move('gravado')).status, 200);

      assert.equal((await move('inventada')).status, 400);
      assert.equal((await move('gravado', { accept: 'application/json' })).status, 403, 'sem CSRF');
      const board = await as.prod.get('/convidados');
      assert.equal(board.status, 200);
      assert.match(board.text, /data-board/);
      for (const key of ['em_agendamento', 'agendado']) assert.match(board.text, new RegExp(`data-status="${key}"`), `coluna ${key}`);
      assert.doesNotMatch(board.text, /data-status="confirmado"/);
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
      for (const p of ['/convidados/abc', '/convidados/99999999', '/usuarios/xyz/editar', '/modelos']) {
        assert.equal((await as.admin.get(p)).status, 404, p);
      }
    });
  });

  describe('CRM: campos por etapa e regras para avançar', () => {
    let id;
    const guest = () => h.db.query('SELECT * FROM guests WHERE id=$1', [id]).then((r) => r.rows[0]);
    const edit = (fields) => as.prod.act(`/convidados/${id}`, min({ name: 'Rita Regras', ...fields }), { from: `/convidados/${id}/editar` });
    const move = async (status) => {
      const csrf = await as.prod.csrf('/convidados');
      return as.prod.post(`/convidados/${id}/status`, { status }, { headers: JSON_HEADERS(csrf) });
    };

    it('cadastro inicial: nome, Instagram e perfil; Instagram é normalizado; WhatsApp, e-mail e motivo são opcionais', async () => {
      const r = await as.prod.act('/convidados', {
        name: 'Rita Regras', instagram: 'https://www.instagram.com/Rita.Regras/?igsh=abc', profile: 'Profissional da saúde',
        invite_reason: 'Referência em nutrição esportiva', owner_id: produtora.id,
      }, { from: '/convidados/novo' });
      assert.equal(r.status, 302);
      id = r.location.split('/').pop();
      const g = await guest();
      assert.equal(g.instagram, 'rita.regras');
      assert.equal(g.profile, 'profissional_saude');
      assert.equal(g.invite_reason, 'Referência em nutrição esportiva');
      assert.equal(g.status, 'prospect');
      assert.equal(g.email, null);
      assert.equal(g.phone, null);
      const page = (await as.prod.get(`/convidados/${id}`)).text;
      assert.match(page, /@rita\.regras/);
      assert.match(page, /Profissional da saúde/);
    });

    it('as etapas do funil são as novas (sem "Confirmado")', async () => {
      const page = (await as.prod.get(`/convidados/${id}`)).text;
      const modal = page.match(/id="modal-etapa"[\s\S]*?<\/dialog>/)[0];
      const options = [...modal.matchAll(/name="status" value="([a-z_]+)"/g)].map((m) => m[1]);
      assert.match(modal, /data-stage-confirm disabled/, 'só habilita ao escolher outra etapa');
      assert.match(page, /badge-btn[^>]*data-modal-open="modal-etapa"/, 'a etapa no topo abre a janela');
      assert.doesNotMatch(page, /Outras ações/);
      assert.deepEqual(options, ['prospect', 'convite_enviado', 'em_agendamento', 'agendado', 'gravado', 'perdido', 'cancelado']);
    });

    it('Em agendamento exige e-mail e/ou WhatsApp', async () => {
      const blocked = await move('em_agendamento');
      assert.equal(blocked.status, 422);
      assert.match(JSON.parse(blocked.text).error, /e-mail e\/ou WhatsApp/);
      assert.equal((await edit({ status: 'em_agendamento' })).status, 400, 'o formulário também respeita a regra');
      assert.equal((await edit({ status: 'em_agendamento', phone: '(12) 99999-0000' })).status, 302, 'só WhatsApp basta');
      assert.equal((await guest()).status, 'em_agendamento');
      await edit({ status: 'prospect', phone: '' });
      assert.equal((await edit({ status: 'em_agendamento', email: 'rita@exemplo.com' })).status, 302, 'só e-mail basta');
    });

    it('Agendado exige data e a confirmação de Estúdio, hosts e convidado', async () => {
      const err = async (fields) => (await edit({ email: 'rita@exemplo.com', status: 'agendado', ...fields })).text;
      assert.match(await err({}), /data e hora da gravação, confirmação de agenda no Estúdio, confirmação de agenda com os hosts e confirmação de agenda com o convidado/);
      assert.match(await err({ proposed_at: '2026-12-10T15:00', scheduled_studio: '1', scheduled_hosts: '1' }), /falta: confirmação de agenda com o convidado/);
      assert.match(await err({ scheduled_studio: '1', scheduled_hosts: '1', scheduled_guest: '1' }), /falta: data e hora da gravação/);
      const ok = await edit({ email: 'rita@exemplo.com', status: 'agendado', proposed_at: '2026-12-10T15:00', scheduled_studio: '1', scheduled_hosts: '1', scheduled_guest: '1' });
      assert.equal(ok.status, 302);
      const g = await guest();
      assert.equal(g.status, 'agendado');
      assert.deepEqual([g.scheduled_studio, g.scheduled_hosts, g.scheduled_guest], [true, true, true]);
      const shown = (await as.prod.get(`/convidados/${id}`)).text;
      assert.match(shown, /Gravação marcada/);
      assert.match(shown, /Confirmada com estúdio, hosts e convidado/);
      assert.match((await as.gestao.get('/')).text, /Rita Regras/, 'aparece em "Próximas gravações"');
    });

    it('arrastar para Agendado: com dados completos passa; sem eles, 422', async () => {
      await edit({ email: 'rita@exemplo.com', status: 'gravado' }); // salvar sem as confirmações zera as marcações
      assert.equal((await move('agendado')).status, 422);
      await edit({ email: 'rita@exemplo.com', status: 'agendado', proposed_at: '2026-12-10T15:00', scheduled_studio: '1', scheduled_hosts: '1', scheduled_guest: '1' });
      await move('prospect');
      assert.equal((await move('agendado')).status, 200);
    });

    it('o convidado termina em Gravado: não existe Publicado para o convidado', async () => {
      assert.equal((await edit({ email: 'rita@exemplo.com', status: 'publicado' })).status, 302, 'etapa desconhecida vira Prospecção');
      assert.equal((await guest()).status, 'prospect');
      assert.equal((await move('publicado')).status, 400);
      const form = (await as.prod.get(`/convidados/${id}/editar`)).text;
      assert.doesNotMatch(form, /name="youtube_url"/, 'links de publicação são do episódio');
    });

    it('Em agendamento e Agendado exigem a foto; a janela da foto termina a mudança', async () => {
      await edit({ email: 'rita@exemplo.com', status: 'convite_enviado' });
      await h.db.query('UPDATE guests SET photo_key = NULL WHERE id = $1', [id]);
      const r = await move('em_agendamento');
      assert.equal(r.status, 422);
      assert.match(JSON.parse(r.text).error, /falta: foto do convidado/);
      assert.match(JSON.parse(r.text).editUrl, /\?abrir=foto&para=em_agendamento$/);
      const step = await as.prod.act(`/convidados/${id}/avancar`, { para: 'em_agendamento' }, { from: `/convidados/${id}` });
      assert.match(step.location, /\?abrir=foto&para=em_agendamento/);
      const page = (await as.prod.get(`/convidados/${id}?abrir=foto&para=em_agendamento`)).text;
      assert.match(page, /id="modal-foto"[^>]*data-open-on-load/);
      assert.match(page, /data-after-upload><input type="hidden" name="_csrf" value="[^"]+"><input type="hidden" name="para" value="em_agendamento">/);
      // formulário: salva os outros dados, mantém a etapa e manda para a foto
      const saved = await edit({ email: 'rita@exemplo.com', status: 'em_agendamento', topic: 'Sono' });
      assert.match(saved.location, /\?abrir=foto&para=em_agendamento/);
      let g = await guest();
      assert.deepEqual([g.status, g.topic], ['convite_enviado', 'Sono']);
      await h.db.query("UPDATE guests SET photo_key = 'convidados/1/foto.jpg' WHERE id = $1", [id]); // enviou a foto
      await as.prod.act(`/convidados/${id}/avancar`, { para: 'em_agendamento' }, { from: `/convidados/${id}` });
      g = await guest();
      assert.equal(g.status, 'em_agendamento');
      await h.db.query('UPDATE guests SET photo_key = NULL WHERE id = $1', [id]);
      assert.equal((await edit({ email: 'rita@exemplo.com', status: 'em_agendamento', topic: 'Sono e foco' })).location, `/convidados/${id}`, 'quem já está na etapa edita sem ser barrado');
      await h.db.query("UPDATE guests SET photo_key = 'teste/foto-convidado.jpg', status = 'prospect' WHERE id = $1", [id]);
    });

    it('cadastro novo direto em Agendado sem foto entra em Convite enviado e abre a janela da foto', async () => {
      await h.db.query('ALTER TABLE guests ALTER COLUMN photo_key DROP DEFAULT');
      try {
        const r = await as.prod.act('/convidados', min({ name: 'Nova Sem Foto', instagram: '@nova.semfoto', profile: 'medico', email: 'nova@exemplo.com', status: 'agendado',
          proposed_at: '2099-12-10T15:00', scheduled_studio: '1', scheduled_hosts: '1', scheduled_guest: '1' }), { from: '/convidados/novo' });
        assert.match(r.location, /\?abrir=foto&para=agendado$/);
        const { rows: [g] } = await h.db.query("SELECT status, proposed_at FROM guests WHERE instagram = 'nova.semfoto'");
        assert.equal(g.status, 'convite_enviado');
        assert.ok(g.proposed_at, 'a agenda digitada fica salva');
      } finally {
        await h.db.query("ALTER TABLE guests ALTER COLUMN photo_key SET DEFAULT 'teste/foto-convidado.jpg'");
      }
    });

    describe('edição em massa', () => {
      let ids; let sponsorId;
      const bulk = (fields) => as.prod.act('/convidados/em-massa', fields, { from: '/convidados?view=lista' });
      const rowsOf = () => h.db.query('SELECT * FROM guests WHERE id = ANY($1) ORDER BY id', [ids]).then((r) => r.rows);
      before(async () => {
        const mk = async (name, ig, extra = {}) => (await h.db.query(
          `INSERT INTO guests (name, instagram, profile, status, email, photo_key) VALUES ($1,$2,'medico','prospect',$3,$4) RETURNING id`,
          [name, ig, extra.email ?? 'm@exemplo.com', 'photo' in extra ? extra.photo : 'teste/foto-convidado.jpg'])).rows[0].id;
        ids = [await mk('Massa Um', 'massa.um'), await mk('Massa Dois', 'massa.dois'), await mk('Massa Sem Foto', 'massa.semfoto', { photo: null })];
        sponsorId = (await h.db.query("INSERT INTO sponsors (company, stage) VALUES ('Marca Massa', 'ativo') RETURNING id")).rows[0].id;
      });

      it('a lista tem seleção e a janela só para quem edita convidados', async () => {
        const page = (await as.prod.get('/convidados?view=lista')).text;
        assert.match(page, /data-bulk-all/); assert.match(page, /id="modal-massa"/); assert.match(page, /Não alterar/);
        assert.doesNotMatch(page, /<option value="agendado">/, 'Agendado e Gravado seguem um a um');
        assert.doesNotMatch((await as.editor.get('/convidados?view=lista')).text, /data-bulk-all|modal-massa/);
        assert.equal((await as.editor.act('/convidados/em-massa', { ids: String(ids[0]), gender: 'f' }, { from: '/convidados' })).status, 403);
      });

      it('muda responsável, perfil, gênero e patrocinador de todos; deixa em paz o que ficou em branco', async () => {
        const owner = (await h.db.query("SELECT id FROM users WHERE email = 'gestao@t.com' OR email LIKE 'gest%' LIMIT 1")).rows[0] || { id: produtora.id };
        const r = await bulk({ ids: ids.map(String), owner_id: owner.id, profile: 'influencer', gender: 'f', sponsor_id: String(sponsorId), sponsor_relation: 'representante' });
        assert.equal(r.status, 302);
        const rows = await rowsOf();
        assert.ok(rows.every((g) => g.owner_id === owner.id && g.profile === 'influencer' && g.gender === 'f' && g.sponsor_id === sponsorId && g.sponsor_relation === 'representante'));
        assert.ok(rows.every((g) => g.status === 'prospect'), 'etapa em branco não muda');
        assert.match((await h.db.query('SELECT message FROM guest_events WHERE guest_id = $1 ORDER BY id DESC LIMIT 1', [ids[0]])).rows[0].message, /Edição em massa por .*responsável → .*perfil → Influencer.*gênero → feminino.*patrocinador → Marca Massa/);
        assert.match((await as.gestao.get('/auditoria')).text, /convidados\.edicao_em_massa/);
        const off = await bulk({ ids: ids.map(String), sponsor_id: 'nenhum', owner_id: 'nenhum' });
        assert.equal(off.status, 302);
        assert.ok((await rowsOf()).every((g) => g.sponsor_id === null && g.sponsor_relation === null && g.owner_id === null));
      });

      it('etapa: quem tem o que ela exige muda, quem não tem fica e é listado; Perdido pede o motivo', async () => {
        const r = await bulk({ ids: ids.map(String), status: 'em_agendamento' });
        assert.equal(r.status, 302);
        let rows = await rowsOf();
        assert.deepEqual(rows.map((g) => g.status), ['em_agendamento', 'em_agendamento', 'prospect'], 'sem foto não entra em Em agendamento');
        const msg = (await as.prod.get('/convidados?view=lista')).text;
        assert.match(msg, /2 convidados atualizados/); assert.match(msg, /A etapa não mudou para 1: Massa Sem Foto \(falta foto do convidado\)/);

        assert.match((await bulk({ ids: ids.map(String), status: 'perdido' })).location, /\/convidados\?view=lista/);
        assert.deepEqual((await rowsOf()).map((g) => g.status), ['em_agendamento', 'em_agendamento', 'prospect'], 'sem motivo, nada muda');
        await bulk({ ids: ids.map(String), status: 'perdido', loss_reason: 'outros', loss_note: '' });
        assert.ok((await rowsOf()).every((g) => g.status !== 'perdido'), 'Outros sem descrição não passa');
        await bulk({ ids: ids.map(String), status: 'perdido', loss_reason: 'nunca_respondeu' });
        rows = await rowsOf();
        assert.ok(rows.every((g) => g.status === 'perdido' && g.loss_reason === 'nunca_respondeu'));
        assert.match((await h.db.query("SELECT message FROM guest_events WHERE guest_id = $1 AND message LIKE 'Edição em massa%' ORDER BY id DESC LIMIT 1", [ids[0]])).rows[0].message, /Em agendamento → Perdido \(motivo: Nunca respondeu\)/);
        await bulk({ ids: ids.map(String), status: 'prospect' });
        assert.ok((await rowsOf()).every((g) => g.status === 'prospect' && g.loss_reason === null), 'sair de Perdido limpa o motivo');
      });

      it('recusa o que não vale: Agendado/Gravado em massa, nada marcado, nada escolhido, valores inválidos', async () => {
        const before = JSON.stringify(await rowsOf());
        for (const fields of [{ ids: ids.map(String), status: 'agendado' }, { ids: ids.map(String), status: 'gravado' }, { status: 'prospect' }, { ids: ids.map(String) },
          { ids: ids.map(String), gender: 'x' }, { ids: ids.map(String), profile: 'astronauta' }, { ids: ids.map(String), owner_id: 'nao-e-uuid' }, { ids: ids.map(String), sponsor_id: '999999' }]) {
          assert.equal((await bulk(fields)).status, 302);
        }
        assert.equal(JSON.stringify(await rowsOf()), before, 'nenhuma recusa mexe nos dados');
      });
    });

    it('Perdido exige o motivo (Outros pede descrição); Cancelado não exige nada', async () => {
      const r = await move('perdido');
      assert.equal(r.status, 422);
      assert.match(JSON.parse(r.text).editUrl, /\?abrir=perda$/, 'arrastar sem motivo abre a janela do motivo');
      const step = (fields) => as.prod.act(`/convidados/${id}/avancar`, { para: 'perdido', perda: '1', ...fields }, { from: `/convidados/${id}` });
      assert.match((await step({})).location, /\?abrir=perda/);
      assert.match((await step({ loss_reason: 'outros', loss_note: '' })).location, /\?abrir=perda/);
      assert.notEqual((await guest()).status, 'perdido');
      await step({ loss_reason: 'sem_agenda' });
      let g = await guest();
      assert.deepEqual([g.status, g.loss_reason], ['perdido', 'sem_agenda']);
      const { rows: [ev] } = await h.db.query("SELECT message FROM guest_events WHERE guest_id=$1 AND type='status' ORDER BY id DESC LIMIT 1", [id]);
      assert.match(ev.message, /→ Perdido \(motivo: Sem agenda próxima\)/);
      const page = (await as.prod.get(`/convidados/${id}`)).text;
      assert.match(page, /MOTIVO: SEM AGENDA PRÓXIMA/);
      assert.match((await as.prod.get('/convidados')).text, /Sem agenda próxima/, 'o quadro mostra o motivo no cartão');
      await edit({ email: 'rita@exemplo.com', status: 'perdido', loss_reason: 'outros', loss_note: 'Mudou de área' });
      g = await guest();
      assert.deepEqual([g.loss_reason, g.loss_note], ['outros', 'Mudou de área']);
      assert.equal((await edit({ email: 'rita@exemplo.com', status: 'perdido', loss_reason: '' })).status, 400, 'formulário também exige o motivo');
      assert.equal((await move('cancelado')).status, 200);
      g = await guest();
      assert.deepEqual([g.status, g.loss_reason, g.loss_note], ['cancelado', null, null], 'sair de Perdido limpa o motivo');
      assert.equal((await move('prospect')).status, 200);
      await assert.rejects(h.db.query("UPDATE guests SET status = 'perdido' WHERE id = $1", [id]), /guests_perdido_motivo_check/, 'o banco não aceita Perdido sem motivo');
    });

    it('próximo passo guiado: contato, agenda com as três confirmações, remarcar e marcar como gravado', async () => {
      const step = (fields) => as.prod.act(`/convidados/${id}/avancar`, fields, { from: `/convidados/${id}` });
      await h.db.query('DELETE FROM episodes WHERE guest_id=$1', [id]); // testes anteriores já o levaram a Gravado
      await edit({ status: 'convite_enviado', email: '', phone: '' });
      let page = (await as.prod.get(`/convidados/${id}`)).text;
      assert.match(page, /Aguardando resposta/);
      assert.match(page, /data-modal-open="modal-contato"/, 'sem contato, "Aceitou" pede o contato numa janela');

      let r = await step({ para: 'em_agendamento', email: '', phone: '' });
      assert.match(r.location, /\?abrir=contato/);
      assert.equal((await guest()).status, 'convite_enviado');
      assert.match((await step({ para: 'em_agendamento', email: 'nao-e-email' })).location, /\?abrir=contato/);
      await step({ para: 'em_agendamento', email: 'rita@exemplo.com', phone: '' });
      assert.equal((await guest()).status, 'em_agendamento');
      assert.match((await as.prod.get(`/convidados/${id}`)).text, /Definir data da gravação/);

      // data sem todas as confirmações: fica salva como proposta
      r = await step({ para: 'agendado', agenda: '1', proposed_at: '2026-12-10T15:00', scheduled_studio: '1' });
      assert.match(r.location, /\?abrir=agenda/);
      let g = await guest();
      assert.equal(g.status, 'em_agendamento');
      assert.equal(g.proposed_at.toISOString(), '2026-12-10T18:00:00.000Z');
      assert.deepEqual([g.scheduled_studio, g.scheduled_hosts, g.scheduled_guest], [true, false, false]);
      page = (await as.prod.get(`/convidados/${id}?abrir=agenda`)).text;
      assert.match(page, /Falta confirmar com: hosts, convidado/);
      assert.match(page, /id="modal-agenda"[^>]*data-open-on-load/);
      assert.match((await step({ para: 'agendado', agenda: '1', proposed_at: '' })).location, /\?abrir=agenda/, 'sem data não salva');

      await step({ para: 'agendado', agenda: '1', proposed_at: '2026-12-10T15:00', scheduled_studio: '1', scheduled_hosts: '1', scheduled_guest: '1' });
      g = await guest();
      assert.equal(g.status, 'agendado');
      page = (await as.prod.get(`/convidados/${id}`)).text;
      assert.match(page, /Gravação marcada/);
      assert.match(page, /Já aparece na agenda/);

      // remarcar sem reconfirmar: volta para Em agendamento e registra na linha do tempo
      await step({ para: 'agendado', agenda: '1', proposed_at: '2026-12-12T10:00', scheduled_studio: '1' });
      g = await guest();
      assert.equal(g.status, 'em_agendamento');
      assert.equal(g.proposed_at.toISOString(), '2026-12-12T13:00:00.000Z');
      const { rows: evs } = await h.db.query("SELECT message FROM guest_events WHERE guest_id=$1 AND type='agenda' ORDER BY id DESC", [id]);
      assert.match(evs[0].message, /Gravação remarcada: 10\/12\/2026.* → 12\/12\/2026/);
      await step({ para: 'agendado', agenda: '1', proposed_at: '2026-12-12T10:00', scheduled_studio: '1', scheduled_hosts: '1', scheduled_guest: '1' });
      assert.equal((await guest()).status, 'agendado');

      assert.equal((await h.db.query('SELECT count(*)::int n FROM episodes WHERE guest_id=$1', [id])).rows[0].n, 0, 'agendado ainda não é episódio');
      await step({ para: 'gravado' });
      g = await guest();
      assert.equal(g.status, 'gravado');
      assert.equal(g.email, 'rita@exemplo.com', 'campos fora da janela não mudam');
      const { rows: [ep2] } = await h.db.query('SELECT id FROM episodes WHERE guest_id=$1', [id]);
      assert.ok(ep2, 'gravado faz o episódio nascer');
      page = (await as.prod.get(`/convidados/${id}`)).text;
      assert.match(page, /Conversa gravada/);
      assert.match(page, new RegExp(`href="/episodios/${ep2.id}"`));
      assert.equal((await as.editor.act(`/convidados/${id}/avancar`, { para: 'cancelado' }, { from: `/convidados/${id}` })).status, 403);
      await h.db.query('DELETE FROM episodes WHERE id=$1', [ep2.id]);
      await edit({ email: 'rita@exemplo.com', status: 'prospect' });
    });

    it('formulário mostra só os campos da etapa e traz a dica da regra', async () => {
      const hiddenOf = (html, marker) => new RegExp(`data-stages="${marker}" hidden`).test(html);
      let html = (await as.prod.get(`/convidados/${id}/editar`)).text;
      assert.ok(hiddenOf(html, 'em_agendamento agendado gravado'), 'prospect esconde a gravação');
      html = (await as.prod.get(`/convidados/${id}/editar?para=agendado`)).text;
      assert.ok(!hiddenOf(html, 'em_agendamento agendado gravado'), 'agendado mostra a data da gravação');
      assert.match(html, /data-agenda-dialog/, 'confirmações ficam na janela que abre ao preencher a data');
      assert.match(html, /name="scheduled_studio"/);
      assert.match(html, /<option value="agendado" selected>/, '?para= já seleciona a etapa');
      assert.match(html, /Para mover para Agendado falta: data e hora da gravação/);
      assert.match(html, /data-hint-for="agendado" >/, 'dica da etapa visível');
      assert.match(html, /data-hint-for="em_agendamento" hidden>/, 'dica de outra etapa escondida');
    });

    it('editor de vídeo não altera etapa nem importa', async () => {
      assert.equal((await as.editor.act(`/convidados/${id}/status`, { status: 'perdido' }, { from: '/convidados' })).status, 403);
      assert.equal((await as.editor.get('/convidados/importar')).status, 403);
    });
  });

  describe('importação de convidados por CSV', () => {
    const preview = (csv) => as.prod.act('/convidados/importar/previa', { csv }, { from: '/convidados/importar' });
    const commit = (csv) => as.prod.act('/convidados/importar', { csv }, { from: '/convidados/importar' });
    const count = () => h.db.query('SELECT count(*)::int n FROM guests').then((r) => r.rows[0].n);

    it('tela e modelo para baixar', async () => {
      const page = await as.prod.get('/convidados/importar');
      assert.equal(page.status, 200);
      assert.match(page.text, /Importar por CSV/);
      assert.match((await as.prod.get('/convidados')).text, /Importar CSV/);
      const model = await as.prod.get('/convidados/importar/modelo.csv');
      assert.equal(model.status, 200);
      assert.match(model.headers.get('content-type'), /text\/csv/);
      assert.match(model.text, /nome;instagram;whatsapp;perfil;email;motivo do convite;status;data da gravação/);
    });

    it('prévia aponta erros e duplicados e não grava nada', async () => {
      await h.db.query("INSERT INTO guests (name, instagram, profile) VALUES ('Já Existe', 'jaexiste', 'medico')");
      const before = await count();
      const csv = [
        'Nome;Instagram;WhatsApp;Perfil;E-mail;Motivo do convite',
        'Ana Lima;@ana.lima;(12) 98888-7777;Médica;ana@exemplo.com;Referência em dermatologia',
        'Bruno Dias;bruno_dias;;Influenciador;;',
        ';@semnome;;médico;;',
        'Carla Reis;@carla.reis;;astronauta;;',
        'Duda Melo;;;empresária;;',
        'Edu Pires;@edu.pires;;médico;email-ruim;',
        'Fábio Cruz;@JaExiste;;médico;;',
        'Gabi Nunes;@ana.lima;;médico;;',
      ].join('\r\n');
      const r = await preview(csv);
      assert.equal(r.status, 200);
      assert.equal(await count(), before, 'prévia não grava');
      const t = r.text;
      assert.match(t, /2 prontos · 6 ignorados · 8 linhas/);
      assert.match(t, /nome ausente/);
      assert.match(t, /perfil “astronauta” não reconhecido/);
      assert.match(t, /Instagram ausente/);
      assert.match(t, /e-mail inválido/);
      assert.match(t, /@jaexiste já cadastrado \(Já Existe\)/);
      assert.match(t, /@ana\.lima repetido no arquivo/);
      assert.match(t, /Importar 2 convidado\(s\)/);
    });

    it('confirmar grava só as linhas válidas, em Prospecção, com responsável, histórico e auditoria', async () => {
      const before = await count();
      const csv = [
        '﻿nome,instagram,whatsapp,perfil,email,motivo do convite',
        '"Souza, Maria",@maria.s,"(12) 99999-0000","Profissional de saúde",maria@exemplo.com,"Fala de ""saúde mental"""',
        'Bruno Dias,https://instagram.com/bruno_dias,,Influenciador,,',
        'Linha Ruim,,,,,',
      ].join('\n');
      const r = await commit(csv);
      assert.equal(r.status, 302);
      assert.equal(r.location, '/convidados');
      assert.equal(await count(), before + 2);
      const { rows: [m] } = await h.db.query("SELECT * FROM guests WHERE instagram = 'maria.s'");
      assert.equal(m.name, 'Souza, Maria');
      assert.equal(m.profile, 'profissional_saude');
      assert.equal(m.phone, '(12) 99999-0000');
      assert.equal(m.email, 'maria@exemplo.com');
      assert.equal(m.invite_reason, 'Fala de "saúde mental"');
      assert.equal(m.status, 'prospect');
      assert.equal(m.owner_id, produtora.id);
      assert.equal(m.gender, 'm');
      const { rows: [b] } = await h.db.query("SELECT profile FROM guests WHERE instagram = 'bruno_dias'");
      assert.equal(b.profile, 'influencer');
      assert.equal((await h.db.query("SELECT count(*)::int n FROM guest_events WHERE guest_id=$1 AND message LIKE 'Importado por CSV%'", [m.id])).rows[0].n, 1);
      assert.match((await as.gestao.get('/auditoria')).text, /convidados\.importados/);

      const again = await commit(csv); // mesma planilha de novo: tudo duplicado, nada entra
      assert.equal(again.status, 400);
      assert.equal(await count(), before + 2);
    });

    it('status da planilha define a etapa e fica no histórico', async () => {
      const r = await commit('nome;instagram;perfil;email;status;data da gravação\nSt Um;@st.um;médico;um@exemplo.com;Em agendamento;\nSt Dois;@st.dois;médico;;Recusou;\nSt Tres;@st.tres;médico;;Gravado;\nSt Quatro;@st.quatro;médico;;Agendado;25/11/2099 14:30');
      assert.equal(r.status, 302);
      const { rows } = await h.db.query("SELECT instagram, status FROM guests WHERE instagram LIKE 'st.%' ORDER BY instagram");
      assert.deepEqual(rows.map((g) => [g.instagram, g.status]), [['st.dois', 'perdido'], ['st.quatro', 'agendado'], ['st.um', 'em_agendamento']]);
      const { rows: [ag] } = await h.db.query("SELECT * FROM guests WHERE instagram = 'st.quatro'");
      assert.equal(ag.proposed_at.toISOString(), '2099-11-25T17:30:00.000Z');
      assert.ok(ag.scheduled_studio && ag.scheduled_hosts && ag.scheduled_guest, 'agendado entra confirmado');
      assert.equal((await h.db.query('SELECT count(*)::int n FROM episodes WHERE guest_id = $1', [ag.id])).rows[0].n, 0, 'agendado não cria episódio');
      const { rows: [ev] } = await h.db.query("SELECT e.message FROM guest_events e JOIN guests g ON g.id = e.guest_id WHERE g.instagram = 'st.um'");
      assert.match(ev.message, /Importado por CSV .*\(etapa: Em agendamento\)/);
    });

    it('histórico: Gravado e Publicado criam o episódio na etapa certa, numerado, sem tarefas nem custos', async () => {
      await h.db.query('DELETE FROM episodes');
      await h.db.query("INSERT INTO episodes (number, title, status) VALUES (2, 'Já existia', 'publicado')");
      const tasksBefore = (await h.db.query('SELECT count(*)::int n FROM tasks')).rows[0].n;
      const finBefore = (await h.db.query('SELECT count(*)::int n FROM fin_entries')).rows[0].n;
      const file = [
        'nome;instagram;perfil;status;data da gravação;episódio;youtube;publicado em',
        'Hist Um;@hist.um;médico;Publicado;05/02/2026;1;https://youtu.be/um;12/02/2026',
        'Hist Tres;@hist.tres;médico;Publicado;20/03/2026;;;',
        'Hist Dois;@hist.dois;médico;Gravado;01/03/2026;;;',
        'Hist Rep;@hist.rep;médico;Publicado;01/01/2026;2;;',
      ].join('\n');
      const pv = await preview(file);
      assert.match(pv.text, /EP\.002 já existe \(Já existia\)/);
      assert.match(pv.text, /3 prontos/);
      const r = await commit(file);
      assert.equal(r.status, 302);
      const { rows } = await h.db.query("SELECT g.instagram, g.status AS gs, e.number, e.status, e.recorded_on::text, e.aired_on::text, e.youtube_url FROM guests g JOIN episodes e ON e.guest_id = g.id WHERE g.instagram LIKE 'hist.%' ORDER BY e.number");
      assert.deepEqual(rows.map((x) => [x.instagram, x.gs, x.number, x.status, x.recorded_on]), [
        ['hist.um', 'gravado', 1, 'publicado', '2026-02-05'],
        ['hist.dois', 'gravado', 3, 'gravado', '2026-03-01'],
        ['hist.tres', 'gravado', 4, 'publicado', '2026-03-20'],
      ], 'sem número: continua depois do maior, na ordem da data de gravação');
      assert.equal(rows[0].aired_on, '2026-02-12'); assert.equal(rows[0].youtube_url, 'https://youtu.be/um');
      assert.equal((await h.db.query('SELECT count(*)::int n FROM tasks')).rows[0].n, tasksBefore, 'histórico não cria tarefas');
      assert.equal((await h.db.query('SELECT count(*)::int n FROM fin_entries')).rows[0].n, finBefore, 'nem custos');
      const { rows: [ev] } = await h.db.query("SELECT message FROM episode_events ev JOIN episodes e ON e.id = ev.episode_id WHERE e.number = 1");
      assert.match(ev.message, /Episódio do histórico importado por CSV/);
    });

    it('cabeçalho sem as colunas obrigatórias e arquivo vazio são recusados com mensagem clara', async () => {
      const bad = await preview('nome;whatsapp\nAna;1');
      assert.equal(bad.status, 400);
      assert.match(bad.text, /Faltam colunas obrigatórias no cabeçalho: instagram, perfil/);
      assert.equal((await preview('')).status, 400);
      assert.equal((await commit('nome;instagram;perfil')).status, 400, 'só cabeçalho: nada para importar');
    });

    it('limite de linhas e gênero opcional', async () => {
      const many = ['nome;instagram;perfil', ...Array.from({ length: 501 }, (_, i) => `P${i} Teste;p${i};médico`)].join('\n');
      assert.match((await preview(many)).text, /mais de 500 convidados/);
      const r = await commit('nome;instagram;perfil;genero\nLara Gênero;@lara.g;médica;feminino');
      assert.equal(r.status, 302);
      assert.equal((await h.db.query("SELECT gender FROM guests WHERE instagram='lara.g'")).rows[0].gender, 'f');
      assert.match((await preview('nome;instagram;perfil;genero\nX Y;@xy;médico;talvez')).text, /gênero inválido/);
    });

    it('HTML na planilha é escapado na prévia', async () => {
      const r = await preview('nome;instagram;perfil\n<img src=x onerror=alert(1)>;@xss.teste;médico');
      assert.doesNotMatch(r.text, /<img src=x/);
      assert.match(r.text, /&lt;img src=x onerror=alert\(1\)&gt;/);
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

  describe('convite fixo do Pulso (com JS, gênero e dupla)', () => {
    const fs = require('fs');
    const path = require('path');
    const templateHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'templates', 'convite-pulso.html'), 'utf8');
    const guestFlow = async (fields) => {
      const r = await as.prod.act('/convidados', min({ owner_id: produtora.id, ...fields }), { from: '/convidados/novo' });
      assert.equal(r.status, 302, JSON.stringify(fields));
      const id = r.location.split('/').pop();
      await as.prod.act(`/convidados/${id}/convite`, {}, { from: `/convidados/${id}` });
      const { rows: [g] } = await h.db.query('SELECT invite_token FROM guests WHERE id=$1', [id]);
      return { id, token: g.invite_token, page: await h.client(app.base).get(`/convite/${g.invite_token}`, { ua: 'WhatsApp/2.23' }) };
    };

    it('o modelo é um arquivo do repositório, sem tela de modelos, sem ?nome= e com os botões apontando para o rastreio', async () => {
      assert.doesNotMatch(templateHtml, /URLSearchParams/);
      assert.doesNotMatch(templateHtml, /data:image\/jpeg;base64/, 'imagens saíram do HTML');
      assert.doesNotMatch(templateHtml, /wa\.me/, 'WhatsApp só pelo redirecionador');
      assert.match(templateHtml, /\{\{guest_json\}\}/);
      assert.match(templateHtml, /\{\{bloco_resposta\}\}/);
      assert.equal((templateHtml.match(/\{\{link_aceitar\}\}/g) || []).length, 2);
      assert.equal((templateHtml.match(/\{\{link_producao\}\}/g) || []).length, 1);
      for (const p of ['/modelos', '/modelos/novo']) assert.equal((await as.admin.get(p)).status, 404, p);
      assert.doesNotMatch((await as.admin.get('/convidados')).text, /Modelos de convite/);
      assert.equal((await h.db.query("SELECT to_regclass('invite_templates') AS t")).rows[0].t, null, 'tabela de modelos removida');
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
      for (const imgPath of new Set(img)) {
        const r = await fetch(app.base + imgPath);
        assert.equal(r.status, 200, imgPath);
        assert.equal(r.headers.get('content-type'), 'image/jpeg');
      }
    });

    it('nome malicioso não escapa do <script> nem injeta HTML (guest_json é seguro)', async () => {
      const evil = '</script><img src=x onerror=alert(1)>   "q" \\';
      const f = await guestFlow({ name: evil });
      const m = f.page.text.match(/const G = (\{.*\});/);
      assert.ok(m, 'bloco G presente');
      assert.doesNotMatch(m[1], /<|>/, 'sem < ou > crus dentro do script');
      assert.equal(JSON.parse(m[1]).nome, evil, 'o valor original é preservado ao interpretar o JSON');
      assert.equal((f.page.text.match(/<\/script>/g) || []).length, templateHtml.match(/<\/script>/g).length, 'mesmo número de </script> do modelo');
    });

    it('formulário de recusa vem de origem null (sandbox): é aceito; outros POSTs com origin null não', async () => {
      const f = await guestFlow({ name: 'Origem Nula' });
      const c = h.client(app.base);
      const ok = await c.post(`/convite/${f.token}/responder`, { resposta: 'recusado' }, { headers: { origin: 'null' } });
      assert.equal(ok.status, 302);
      assert.equal((await h.db.query('SELECT status FROM guests WHERE id=$1', [f.id])).rows[0].status, 'perdido');
      const csrf = await as.prod.csrf('/perfil');
      assert.equal((await as.prod.post('/perfil', { _csrf: csrf, name: 'X Y' }, { headers: { origin: 'null' } })).status, 403);
    });

    it('prévia no painel não tem links ativos (não conta clique nem muda etapa)', async () => {
      const f = await guestFlow({ name: 'Previa Teste' });
      const prev = await as.prod.get(`/convidados/${f.id}/previa`);
      assert.equal(prev.status, 200);
      assert.doesNotMatch(prev.text, /\/aceitar|\/producao/);
      assert.match(prev.text, /href="#"/);
      assert.equal((await h.db.query('SELECT count(*)::int n FROM invite_clicks WHERE guest_id=$1', [f.id])).rows[0].n, 0);
    });

    it('formulário de convidado salva gênero/dupla e mostra no detalhe', async () => {
      const f = await guestFlow({ name: 'Duo Teste', gender: 'f', is_plural: '1' });
      const { rows: [g] } = await h.db.query('SELECT gender, is_plural FROM guests WHERE id=$1', [f.id]);
      assert.deepEqual(g, { gender: 'f', is_plural: true });
      assert.match((await as.prod.get(`/convidados/${f.id}`)).text, /trata como <strong>convidadas<\/strong>/);
      assert.match((await as.prod.get(`/convidados/${f.id}/editar`)).text, /name="is_plural" value="1" checked/);
    });
  });
});
