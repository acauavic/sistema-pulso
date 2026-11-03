const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { ASSET_VERSION } = require('../src/middleware');
const { can } = require('../src/permissions');

describe('app no celular (PWA)', () => {
  const as = {}; const u = {}; let app;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role, name] of [['gestao', 'gestao', 'Gil Gestão'], ['editor', 'editor_video', 'Edu Editor']]) { u[k] = await h.createUser({ name, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('service worker com a versão dos arquivos, cache dos arquivos fixos e página sem conexão', async () => {
    const sw = await as.gestao.get('/sw.js');
    assert.equal(sw.status, 200); assert.match(sw.headers.get('cache-control'), /no-cache/);
    assert.ok(sw.text.includes(`const VERSION = '${ASSET_VERSION}'`), 'a versão vai no service worker: deploy novo troca o cache');
    assert.doesNotMatch(sw.text, /__ASSET_VERSION__/);
    assert.match(sw.text, /req\.mode === 'navigate'/); assert.match(sw.text, /\/static\/offline\.html/);
    assert.match(sw.text, /setAppBadge/, 'o número de não lidas vai para o ícone do app');
    assert.doesNotMatch(sw.text, /cache\.put\(req[^)]*\)[^;]*navigate/, 'páginas não ficam guardadas');
    const off = await as.gestao.get('/static/offline.html');
    assert.equal(off.status, 200); assert.match(off.text, /Sem conexão/); assert.match(off.text, /\/static\/offline\.js/); assert.doesNotMatch(off.text, /style=|<%/);
  });

  it('manifesto: app em tela cheia, ícones (inclusive maskable) e atalhos que abrem', async () => {
    const mf = JSON.parse((await as.gestao.get('/manifest.webmanifest')).text);
    assert.equal(mf.id, '/'); assert.equal(mf.display, 'standalone'); assert.equal(mf.start_url, '/'); assert.equal(mf.lang, 'pt-BR');
    assert.ok(mf.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512'));
    for (const i of mf.icons) assert.equal((await as.gestao.get(i.src)).status, 200, i.src);
    assert.deepEqual(mf.shortcuts.map((s) => s.url), ['/tarefas?nova=1', '/tarefas', '/calendario', '/notificacoes']);
    for (const s of mf.shortcuts) assert.equal((await as.gestao.get(s.url)).status, 200, `atalho ${s.url}`);
    assert.match((await as.gestao.get('/tarefas?nova=1')).text, /id="modal-task-new"[^>]*data-open-on-load/, '"Nova tarefa" já abre a janela');
  });

  it('layout: barra de baixo conforme o perfil, contador nos dois lugares, instalar e a janela do iPhone', async () => {
    const t = (await as.gestao.get('/tarefas')).text;
    assert.match(t, /name="viewport" content="[^"]*viewport-fit=cover/);
    assert.match(t, /<meta name="push-key" content="">/);
    const nav = t.match(/<nav class="tabnav"[\s\S]*?<\/nav>/)[0];
    assert.match(nav, /href="\/tarefas" class="on" aria-current="page"/, 'a aba da página atual fica ativa');
    for (const label of ['Painel', 'Tarefas', 'Agenda', 'Avisos', 'Menu']) assert.match(nav, new RegExp(`<span>${label}</span>`));
    assert.match(nav, /data-nav-toggle aria-expanded="false"/);
    assert.equal((t.match(/data-unread/g) || []).length, 2, 'contador no menu e na barra de baixo');
    assert.match(t, /data-pwa-install hidden/); assert.match(t, /id="modal-pwa-ios"/); assert.match(t, /\/static\/pwa\.js\?v=/);
    // a barra de baixo respeita as permissões do perfil
    const navEd = (await as.editor.get('/')).text.match(/<nav class="tabnav"[\s\S]*?<\/nav>/)[0];
    const expected = [['Tarefas', 'tasks.read'], ['Agenda', 'calendar.read'], ['Convidados', 'guests.read'], ['Episódios', 'episodes.read']].filter(([, p]) => can('editor_video', p)).slice(0, 2).map(([l]) => l);
    for (const label of ['Painel', ...expected, 'Avisos', 'Menu']) assert.match(navEd, new RegExp(`<span>${label}</span>`), `editor vê ${label}`);
    // o cartão de instalar/ligar alertas só existe no Início
    assert.match((await as.gestao.get('/')).text, /data-app-card hidden/);
    assert.match((await as.editor.get('/')).text, /data-app-card hidden/, 'o Início do editor também tem o cartão');
    assert.doesNotMatch(t, /data-app-card/);
  });

  it('a chave pública do push vai na página quando o servidor tem as chaves', async () => {
    const keys = require('web-push').generateVAPIDKeys();
    Object.assign(h.config.push, { publicKey: keys.publicKey, privateKey: keys.privateKey });
    try {
      assert.match((await as.gestao.get('/')).text, new RegExp(`<meta name="push-key" content="${keys.publicKey}">`));
    } finally { Object.assign(h.config.push, { publicKey: '', privateKey: '' }); }
    assert.doesNotMatch((await h.client(app.base).get('/login')).text, /name="push-key"/, 'sem login, sem chave');
  });

  it('alerta leva o número de não lidas para o ícone do app', async () => {
    const webpush = require('web-push');
    const push = require('../src/services/push');
    const jobs = require('../src/services/jobs');
    const notifySvc = require('../src/services/notify');
    const keys = webpush.generateVAPIDKeys();
    Object.assign(h.config.push, { publicKey: keys.publicKey, privateKey: keys.privateKey });
    const sent = []; const orig = webpush.sendNotification;
    webpush.sendNotification = async (sub, body) => { sent.push(JSON.parse(body)); return { statusCode: 201 }; };
    try {
      await q('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)', [u.gestao.id, 'https://fcm.googleapis.com/fcm/send/abc', 'BAAA', 'x']);
      await q("DELETE FROM jobs WHERE kind = 'push_notificacao'");
      await notifySvc.notify({ type: 'tarefa', users: [u.gestao.id], title: 'Primeira', url: '/tarefas' });
      await notifySvc.notify({ type: 'tarefa', users: [u.gestao.id], title: 'Segunda', url: '/tarefas' });
      while (await jobs.runNext()) { /* processa a fila */ }
      const unread = (await q('SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [u.gestao.id]))[0].n;
      assert.equal(sent.length, 2);
      assert.equal(sent[1].title, 'Segunda'); assert.equal(sent[1].unread, unread, 'o número vai junto');
      assert.ok(push.configured());
    } finally {
      webpush.sendNotification = orig;
      Object.assign(h.config.push, { publicKey: '', privateKey: '' });
    }
  });

  it('sessão em uso se renova (o app instalado não cai no login toda semana); parada, expira', async () => {
    const c = h.client(app.base); await c.login('gestao@t.com');
    const fresh = await c.get('/');
    assert.equal(fresh.status, 200);
    assert.equal((fresh.headers.getSetCookie?.() || []).filter((x) => x.startsWith('pulso_sid=')).length, 0, 'sessão nova não é regravada a cada página');
    // falta 1 dia: passou da metade dos 7 dias, a próxima visita estende
    await q("UPDATE sessions SET expires_at = now() + interval '1 day' WHERE user_id = $1", [u.gestao.id]);
    const r = await c.get('/tarefas');
    assert.equal(r.status, 200);
    assert.ok((r.headers.getSetCookie?.() || []).some((x) => /^pulso_sid=[^;]+; Max-Age=604800/.test(x)), 'cookie renovado por mais 7 dias');
    const [s] = await q("SELECT expires_at > now() + interval '6 days' AS ok FROM sessions WHERE user_id = $1 ORDER BY expires_at DESC LIMIT 1", [u.gestao.id]);
    assert.ok(s.ok);
    // sessão vencida continua vencida
    await q("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [u.gestao.id]);
    const gone = await c.get('/tarefas');
    assert.equal(gone.status, 302); assert.match(gone.location, /login/);
  });

  it('arquivos do app versionados: todo .css, .js e .html de src/public entra no hash (nenhum arquivo novo fica de fora)', () => {
    const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
    const dir = path.join(__dirname, '../src/public'); const h = crypto.createHash('sha1'); const seen = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name)).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (/\.(css|js|html)$/.test(e.name)) { seen.push(e.name); h.update(e.name); h.update(fs.readFileSync(p)); }
    });
    walk(dir);
    for (const f of ['pwa.js', 'push.js', 'portal.css', 'portal.js', 'reenviar.js']) assert.ok(seen.includes(f), f);
    assert.equal(ASSET_VERSION, h.digest('hex').slice(0, 10));
  });
});
