// Correções da revisão de segurança (v1.86.1): troca de e-mail entre pessoas da gestão, links de senha que caem ao trocar
// e-mail/senha, login travado por e-mail + IP, IPv6 interno na prévia de link, nomes no ZIP, envio do estúdio antes do corpo,
// anexo de conversa, token do parceiro da plateia e prazo máximo da sessão.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { createAuthToken, peekAuthToken } = require('../src/auth/tokens');

describe('Revisão de segurança', () => {
  let app; const u = {}; const as = {};
  const q = (sql, p) => h.db.query(sql, p);

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['super', 'superadmin'], ['gestao', 'gestao'], ['gestao2', 'gestao'], ['prod', 'produtora']]) {
      u[k] = await h.createUser({ name: `Pessoa ${k}`, email: `${k}@t.com`, role });
      as[k] = h.client(app.base); await as[k].login(`${k}@t.com`);
    }
    u.novo = await h.createUser({ name: 'Ainda sem senha', email: 'novo@t.com', role: 'produtora', password: null });
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('a gestão não troca o e-mail de quem já tem senha (só o superadmin); trocar derruba os links que já saíram', async () => {
    let r = await as.gestao.act(`/usuarios/${u.gestao2.id}`, { name: 'Pessoa gestao2', email: 'invasor@t.com', role: 'gestao' }, { from: `/usuarios/${u.gestao2.id}/editar` });
    assert.equal(r.status, 403);
    assert.equal((await q('SELECT email FROM users WHERE id = $1', [u.gestao2.id])).rows[0].email, 'gestao2@t.com');
    // quem ainda não definiu a senha pode ter o e-mail corrigido pela gestão (ex.: digitado errado no convite)
    const convite = await createAuthToken(u.novo.id, 'invite');
    r = await as.gestao.act(`/usuarios/${u.novo.id}`, { name: 'Ainda sem senha', email: 'novo-certo@t.com', role: 'produtora' }, { from: `/usuarios/${u.novo.id}/editar` });
    assert.equal(r.status, 302);
    assert.equal(await peekAuthToken(convite, ['invite']), null, 'o convite que foi para o e-mail errado não vale mais');
    // o superadmin troca
    const reset = await createAuthToken(u.gestao2.id, 'reset');
    r = await as.super.act(`/usuarios/${u.gestao2.id}`, { name: 'Pessoa gestao2', email: 'gestao2-novo@t.com', role: 'gestao' }, { from: `/usuarios/${u.gestao2.id}/editar` });
    assert.equal(r.status, 302);
    assert.equal(await peekAuthToken(reset, ['reset']), null);
  });

  it('definir a senha por um link derruba os outros links da pessoa', async () => {
    const a = await createAuthToken(u.prod.id, 'invite');
    const b = await createAuthToken(u.prod.id, 'reset');
    const anon = h.client(app.base);
    const r = await anon.post(`/senha/${b}`, { password: 'OutraSenhaForte-456', confirm: 'OutraSenhaForte-456' });
    assert.equal(r.status, 302);
    assert.equal(await peekAuthToken(a, ['invite']), null);
  });

  it('errar a senha de alguém de um lugar não trava o login dessa pessoa de outro lugar', async () => {
    const atacante = h.client(app.base);
    for (let i = 0; i < 9; i++) await atacante.post('/login', { email: 'gestao@t.com', password: 'errada-123456' }, { headers: { 'x-forwarded-for': '203.0.113.9' } });
    const r1 = await atacante.post('/login', { email: 'gestao@t.com', password: 'SenhaForte-123' }, { headers: { 'x-forwarded-for': '203.0.113.9' } });
    assert.equal(r1.status, 429, 'do IP que errou, bloqueia');
    const dona = h.client(app.base);
    const r2 = await dona.post('/login', { email: 'gestao@t.com', password: 'SenhaForte-123' }, { headers: { 'x-forwarded-for': '198.51.100.7' } });
    assert.equal(r2.status, 302, 'de outro IP, a dona entra');
  });

  it('prévia de link: IPv6 que esconde um endereço interno é recusado', () => {
    const { isPrivateIp } = require('../src/services/linkPreview');
    for (const ip of ['::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:127.0.0.1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '::7f00:1', '::1', 'fe80::1', 'fd12::1', '2001:0:1::1']) {
      assert.equal(isPrivateIp(ip), true, ip);
    }
    for (const ip of ['2606:4700::1', '::ffff:808:808', '8.8.8.8']) assert.equal(isPrivateIp(ip), false, ip);
  });

  it('ZIP: nome vindo de fora não sai da pasta ao extrair', () => {
    const { safeEntryName, uniqueNames } = require('../src/utils/zipStream');
    assert.equal(safeEntryName('../../x.png'), 'x.png');
    assert.equal(safeEntryName('a\\..\\b.txt'), 'a/b.txt');
    assert.equal(safeEntryName('/etc/passwd'), 'etc/passwd');
    assert.equal(safeEntryName('bastidores/foto.jpg'), 'bastidores/foto.jpg');
    assert.deepEqual(uniqueNames(['../logo.png', 'logo.png']), ['logo.png', 'logo-2.png']);
  });

  it('link do estúdio: link errado ou tamanho que não confere é recusado antes de ler o corpo', async () => {
    const big = Buffer.alloc(1024 * 1024, 1);
    let r = await fetch(`${app.base}/estudio/nao-existe/arquivos/1/parte/1`, { method: 'PUT', body: big });
    assert.equal(r.status, 404);
  });

  it('anexo de conversa: só quem enviou apaga (a gestão das tarefas não)', () => {
    const { canRemove } = require('../src/services/attachments');
    const prod = { id: u.prod.id, role: 'produtora' };
    assert.equal(canRemove(prod, { uploaded_by: u.gestao.id, entity_type: 'chat' }), false);
    assert.equal(canRemove(prod, { uploaded_by: u.gestao.id, entity_type: 'task' }), true);
    assert.equal(canRemove({ id: u.gestao.id, role: 'gestao' }, { uploaded_by: u.gestao.id, entity_type: 'chat' }), true);
  });

  it('sessão com mais de 90 dias deixa de valer', async () => {
    const c = h.client(app.base); await c.login('super@t.com');
    assert.equal((await c.get('/')).status, 200);
    await q("UPDATE sessions SET created_at = now() - interval '91 days' WHERE user_id = $1", [u.super.id]);
    assert.equal((await c.get('/')).status, 302);
  });

  it('link de parceiro da plateia nasce com 144 bits', async () => {
    const page = require('../src/services/audiencePage');
    const { rows: [g] } = await q("INSERT INTO guests (name, instagram, profile, status) VALUES ('Dra. Plateia', 'dra.plateia', 'medico', 'agendado') RETURNING id");
    const p = await page.createPartner(g.id, { name: 'Parceiro', slots: 2 }, u.gestao.id);
    assert.equal(Buffer.from(p.token, 'base64url').length, 18);
  });
});
