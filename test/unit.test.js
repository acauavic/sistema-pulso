const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const { can, canManageUser, assignableRoles, PERMISSIONS, ROLES } = require('../src/permissions');
const { hashPassword, verifyPassword, passwordPolicyError } = require('../src/auth/password');
const tpl = require('../src/services/inviteTemplate');
const fmt = require('../src/utils/format');
const { createLimiter } = require('../src/auth/rateLimit');
const { keywordCandidates } = require('../src/services/yourls');

test('permissões: todo perfil listado existe e superadmin tem tudo', () => {
  for (const [perm, roles] of Object.entries(PERMISSIONS)) {
    assert.ok(roles.includes('superadmin'), `superadmin precisa de ${perm}`);
    for (const r of roles) assert.ok(ROLES[r], `perfil desconhecido ${r} em ${perm}`);
  }
});

test('permissões: editor de vídeo só lê convidados; gestão não gerencia superadmin', () => {
  assert.equal(can('editor_video', 'guests.read'), true);
  assert.equal(can('editor_video', 'guests.write'), false);
  assert.equal(can('editor_video', 'users.read'), false);
  assert.equal(can('produtora', 'users.write'), false);
  assert.equal(canManageUser('gestao', 'superadmin'), false);
  assert.equal(canManageUser('gestao', 'produtora'), true);
  assert.equal(canManageUser('superadmin', 'superadmin'), true);
  assert.equal(canManageUser('produtora', 'editor_video'), false);
  assert.ok(!assignableRoles('gestao').includes('superadmin'));
  assert.ok(assignableRoles('superadmin').includes('superadmin'));
  assert.deepEqual(assignableRoles('produtora'), []);
});

test('senha: hash scrypt verifica certo e rejeita errado/vazio', async () => {
  const h = await hashPassword('SenhaForte-123');
  assert.match(h, /^scrypt\$/);
  assert.equal(await verifyPassword('SenhaForte-123', h), true);
  assert.equal(await verifyPassword('senhaforte-123', h), false);
  assert.equal(await verifyPassword('x', null), false);
  assert.equal(await verifyPassword('x', 'lixo'), false);
  assert.notEqual(h, await hashPassword('SenhaForte-123'), 'salt aleatório');
});

test('senha: política exige 10+ caracteres e não aceita repetição', () => {
  assert.ok(passwordPolicyError('curta'));
  assert.ok(passwordPolicyError('aaaaaaaaaaaa'));
  assert.equal(passwordPolicyError('uma-senha-ok-123'), null);
});

test('modelo: variáveis são escapadas, desconhecidas somem, bloco_resposta é HTML', () => {
  const html = tpl.render('<p>{{nome}} {{ tema }} {{inexistente}}</p>{{bloco_resposta}}', {
    nome: '<script>alert(1)</script>', tema: 'A & B "x"', bloco_resposta: '<form>ok</form>',
  });
  assert.equal(html, '<p>&lt;script&gt;alert(1)&lt;/script&gt; A &amp; B &quot;x&quot; </p><form>ok</form>');
  assert.equal(tpl.render('Oi {{nome}}', { nome: 'A & B' }, { escape: false }), 'Oi A & B');
});

test('modelo: bloco de resposta reflete estado e convite encerrado', () => {
  assert.match(tpl.responseBlock('/x', { state: 'aceito' }), /confirmada/);
  assert.doesNotMatch(tpl.responseBlock('/x', { closed: true }), /<form/);
  assert.match(tpl.responseBlock('/x'), /<form[^>]+action="\/x"/);
});

test('datas: input datetime-local <-> UTC em America/Sao_Paulo', () => {
  const d = fmt.parseInputDateTime('2026-03-12T14:30');
  assert.equal(d.toISOString(), '2026-03-12T17:30:00.000Z');
  assert.equal(fmt.toInputValue(d), '2026-03-12T14:30');
  assert.equal(fmt.parseInputDateTime('lixo'), null);
  assert.equal(fmt.formatDateTime(null), '—');
});

test('utils: slugify, firstName, isEmail', () => {
  assert.equal(fmt.slugify('José da Conceição'), 'jose-da-conceicao');
  assert.equal(fmt.firstName('  Maria  Souza '), 'Maria');
  assert.equal(fmt.isEmail('a@b.co'), true);
  assert.equal(fmt.isEmail('a@b'), false);
  assert.equal(fmt.isEmail('a b@c.com'), false);
});

test('rate limit: bloqueia após o máximo e libera com reset', () => {
  const l = createLimiter({ max: 2, windowMs: 1000 });
  assert.equal(l.hit('k'), true);
  assert.equal(l.hit('k'), true);
  assert.equal(l.hit('k'), false);
  assert.equal(l.blocked('k'), true);
  l.reset('k');
  assert.equal(l.blocked('k'), false);
  assert.equal(l.hit('k'), true);
});

test('YOURLS: keywords seguem a convenção dos links manuais (nome curto, depois nome+sobrenome)', () => {
  assert.deepEqual(keywordCandidates('Pedro Passeto', () => 'ab12'), ['pedro', 'pedropasseto', 'pedro-ab12']);
  assert.deepEqual(keywordCandidates('Hussein', () => 'ab12'), ['hussein', 'hussein-ab12']);
  assert.deepEqual(keywordCandidates('José da Conceição', () => 'ab12'), ['jose', 'josaconceicao'.replace('josa', 'jose'), 'jose-ab12']);
  assert.deepEqual(keywordCandidates('???', () => 'ab12'), ['convite', 'convite-ab12']);
});

test('modelo: guest_json é seguro dentro de <script>', () => {
  const out = tpl.buildVariables({ name: '</script><!--\u2028"x"', gender: 'f', is_plural: true }).guest_json;
  assert.doesNotMatch(out, /[<>&\u2028\u2029]/);
  assert.deepEqual(JSON.parse(out), { nome: '</script><!--\u2028"x"', plural: true, sexo: 'f' });
  assert.equal(tpl.buildVariables({ name: 'A' }).genero, 'm');
  assert.equal(tpl.buildVariables({ name: 'A', gender: 'f' }).genero, 'f');
});

test.after(async () => { await require('../src/db/pool').close(); });
