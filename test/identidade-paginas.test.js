// Identidade do painel nas páginas servidas: marca Health Scale Studio no login, no menu e na página sem conexão.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('identidade: marca do painel nas páginas', () => {
  let app; let anon; let gestao;
  before(async () => {
    await h.resetDb(); app = await h.startServer(); anon = h.client(app.base);
    await h.createUser({ name: 'Gil Gestão', email: 'gestao@t.com', role: 'gestao' }); gestao = h.client(app.base); await gestao.login('gestao@t.com');
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('login: título, assinatura com o logotipo e a paleta nova; nada do wordmark do Pulso', async () => {
    const t = (await anon.get('/login')).text;
    assert.match(t, /<title>[^<]*· Health Scale Studio<\/title>/);
    assert.match(t, /class="brand brand-sign"/); assert.match(t, /\/static\/brand\/studio\/health-scale-logo\.png/);
    assert.match(t, /<meta name="theme-color" content="#0E0F0D">/);
    assert.match(t, /archivo-latin-wght-normal\.woff2" as="font"/, 'a fonte do painel começa a baixar junto com o CSS');
    assert.doesNotMatch(t, /class="wordmark"|pulso<span class="dot">|movimentando a saúde/);
    assert.match(t, /class="signal/);
  });

  it('painel logado: marca no menu (ícone + HEALTH SCALE / STUDIO), que some no menu recolhido só pelo CSS', async () => {
    const t = (await gestao.get('/')).text;
    assert.match(t, /class="brand brand-menu"/); assert.match(t, /HEALTH SCALE/); assert.match(t, />STUDIO</);
    assert.match(t, /aria-label="Health Scale Studio: início"/);
    assert.match(t, /<meta name="apple-mobile-web-app-title" content="Studio">/);
    assert.doesNotMatch(t, /wm-rest|class="wordmark"/);
  });

  it('esqueci a senha e página sem conexão seguem o login', async () => {
    const f = (await anon.get('/esqueci-senha')).text;
    assert.match(f, /class="brand brand-sign"/); assert.doesNotMatch(f, /class="wordmark"/);
    const off = (await anon.get('/static/offline.html')).text;
    assert.match(off, /class="brand brand-sign"/); assert.match(off, /Sem conexão/); assert.match(off, /Health Scale Studio/);
    assert.doesNotMatch(off, /wordmark|O Pulso está|style=|#333333/);
  });

  it('e-mails da equipe saem como Health Scale Studio; os do convidado continuam com a marca do Pulso', async () => {
    const mailer = require('../src/services/mailer');
    mailer.outbox.length = 0;
    await mailer.sendUserInvite({ to: 'nova@t.com', name: 'Ana', url: 'http://x/definir', invitedBy: 'Gil' });
    await mailer.sendPasswordReset({ to: 'nova@t.com', name: 'Ana', url: 'http://x/senha' });
    await mailer.sendNotification({ to: 'nova@t.com', title: 'Tarefa nova', text: 'Revisar o corte', url: 'http://x/tarefas/1' });
    await mailer.sendRsvpNotice({ to: 'nova@t.com', guestName: 'Dr. Fulano', accepted: true, message: '', url: 'http://x/convidados/1' });
    await mailer.sendSponsorNotice({ to: 'nova@t.com', title: 'Briefing recebido', text: 'A marca respondeu', url: 'http://x/patrocinadores/1' });
    const equipe = mailer.outbox.splice(0);
    assert.equal(equipe.length, 5);
    for (const m of equipe) {
      assert.match(m.html, /Health<\/span>/, m.subject); assert.match(m.html, /STUDIO/); assert.match(m.html, /#9EDD55/);
      assert.doesNotMatch(m.html, /pulso<span|#C8FF42/i, `${m.subject}: e-mail interno sem a marca do Pulso`);
      assert.equal(m.fromName, 'Health Scale Studio');
    }
    assert.equal(equipe[0].subject, 'Seu acesso ao Health Scale Studio');
    assert.match(equipe[0].html, /Health Scale Studio/);
    assert.equal(equipe[1].subject, 'Redefinição de senha: Health Scale Studio');

    await mailer.sendGuestInvite({ to: 'convidado@t.com', guestName: 'Dr. Fulano', subject: 'Convite', message: 'Venha gravar', url: 'http://x/convite/abc' });
    const [convite] = mailer.outbox.splice(0);
    assert.match(convite.html, /pulso<span style="color:#C8FF42">/, 'o convidado continua recebendo o e-mail do Pulso');
    assert.doesNotMatch(convite.html, /STUDIO/);
    assert.equal(convite.fromName, undefined, 'o remetente do convite é o do projeto (o padrão)');
  });

  it('nenhum "Pulso Gestão" sobra no código do painel', () => {
    const fs = require('node:fs'); const path = require('node:path');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const src = path.join(__dirname, '..', 'src');
    for (const f of walk(src).filter((f) => /\.(js|ejs|css|html|webmanifest)$/.test(f) && !path.basename(f).startsWith('._') && !f.endsWith(path.join('src', 'releases.js'))))
      assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /Pulso Gestão/, path.relative(src, f));
  });
});
