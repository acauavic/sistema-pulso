const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const { can, canManageUser, assignableRoles, PERMISSIONS, ROLES } = require('../src/permissions');
const { hashPassword, verifyPassword, passwordPolicyError } = require('../src/auth/password');
const tpl = require('../src/services/inviteTemplate');
const rules = require('../src/services/guestRules');
const csv = require('../src/services/csvImport');
const reminders = require('../src/services/reminders');
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

test('rate limit (no Postgres, vale para todas as réplicas): bloqueia após o máximo e libera com reset', async () => {
  const h = require('./helpers');
  await h.resetDb();
  const l = createLimiter({ name: 'teste', max: 2, windowMs: 60_000 });
  const outro = createLimiter({ name: 'outro', max: 2, windowMs: 60_000 });
  assert.equal(await l.hit('k'), true);
  assert.equal(await l.hit('k'), true);
  assert.equal(await l.hit('k'), false);
  assert.equal(await l.blocked('k'), true);
  assert.equal(await outro.blocked('k'), false, 'cada limitador conta separado');
  await l.reset('k');
  assert.equal(await l.blocked('k'), false);
  assert.equal(await l.hit('k'), true);
  assert.throws(() => createLimiter({ max: 1, windowMs: 1 }), /nome/);
  await h.db.close();
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

test('modelo: bloco de resposta só tem a recusa; reflete estado e convite encerrado', () => {
  assert.match(tpl.responseBlock('/x', { state: 'recusado' }), /não poderá participar/);
  const open = tpl.responseBlock('/x');
  assert.match(open, /value="recusado"/);
  assert.doesNotMatch(open, /value="aceito"/, 'aceitar é pelo botão do WhatsApp');
});

test('modelo: links dos botões vêm de buildVariables e viram # na prévia', () => {
  const v = tpl.buildVariables({ name: 'A' }, { links: { aceitar: '/convite/t/aceitar', producao: '/convite/t/producao' } });
  assert.equal(v.link_aceitar, '/convite/t/aceitar');
  assert.equal(v.link_producao, '/convite/t/producao');
  assert.equal(tpl.buildVariables({ name: 'A' }).link_aceitar, '#');
  assert.match(tpl.inviteHtml(), /\{\{link_aceitar\}\}/);
});

test('regras: pendências por etapa', () => {
  const none = {};
  assert.deepEqual(rules.missingFor('prospect', none), []);
  assert.deepEqual(rules.missingFor('cancelado', none), []);
  assert.deepEqual(rules.missingFor('perdido', none), ['o motivo da perda']);
  assert.equal(rules.missingFor('perdido', { loss_reason: 'outros', loss_note: ' ' }).length, 1);
  assert.deepEqual(rules.missingFor('perdido', { loss_reason: 'outros', loss_note: 'Mudou de área' }), []);
  assert.deepEqual(rules.missingFor('perdido', { loss_reason: 'nunca_respondeu' }), []);
  assert.deepEqual(rules.missingFor('gravado', none), []);
  assert.equal(rules.missingFor('em_agendamento', none).length, 2);
  assert.deepEqual(rules.missingFor('em_agendamento', { phone: '1' }), ['foto do convidado'], 'Em agendamento pede a foto');
  assert.deepEqual(rules.missingFor('em_agendamento', { email: 'a@b.co', photo_key: 'x' }), []);
  assert.equal(rules.missingFor('agendado', none).length, 5);
  const agenda = { proposed_at: new Date(), scheduled_studio: true, scheduled_hosts: true, scheduled_guest: true };
  assert.deepEqual(rules.missingFor('agendado', agenda), ['foto do convidado'], 'Agendado pede a foto');
  assert.deepEqual(rules.missingFor('agendado', { ...agenda, photo_key: 'x' }), []);
  assert.deepEqual(rules.agendaMissing(agenda), [], 'remarcar olha só a agenda, não a foto');
  assert.equal(rules.missingMessage('Agendado', ['a', 'b', 'c']), 'Para mover para Agendado falta: a, b e c.');
});

test('lembretes da gravação: 3 dias, 1 dia, no dia e 3 horas; gravação cedo e lembretes colados', () => {
  const brt = (s) => new Date(`${s}:00-03:00`);
  const at = (rec, o = {}) => reminders.plan(brt(rec), { morning: '09:00', now: new Date(0), ...o })
    .map((i) => [i.kind, new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(i.due), i.withAddress]);
  assert.deepEqual(at('2026-11-10T16:00'), [['d3', '2026-11-07 09:00', false], ['d1', '2026-11-09 09:00', false], ['dia', '2026-11-10 09:00', false], ['h3', '2026-11-10 13:00', false]]);
  assert.deepEqual(at('2026-11-10T10:00'), [['d3', '2026-11-07 09:00', false], ['d1', '2026-11-09 09:00', true]], 'cedo: só até o dia anterior, com o endereço');
  assert.deepEqual(at('2026-11-10T13:15'), [['d3', '2026-11-07 09:00', false], ['d1', '2026-11-09 09:00', false], ['h3', '2026-11-10 10:15', true]], 'colados: fica o de 3 horas');
  assert.deepEqual(at('2026-11-10T14:00').map((x) => x[0]), ['d3', 'd1', 'dia', 'h3']);
  assert.deepEqual(at('2026-11-10T16:00', { now: brt('2026-11-09T10:00') }).map((x) => x[0]), ['d1', 'dia', 'h3'], 'o de 3 dias passou; o de 1 dia ainda vale até a manhã do dia');
  const s = { address: 'Rua X, 10', messages: { d3: 'Oi, {primeiro_nome}: {dia}, {data}, {hora}.', d1: 'Até amanhã às {hora}.', dia: '{endereco}', h3: 'Tudo certo?' } };
  const g = { name: 'Dra. Ana Souza', proposed_at: brt('2026-11-10T16:30') };
  assert.equal(reminders.message('d3', g, s), 'Oi, Ana: terça-feira, 10/11, 16h30.');
  assert.equal(reminders.message('d1', g, s, { withAddress: true }), 'Até amanhã às 16h30.\n\nEndereço: Rua X, 10');
  assert.equal(reminders.message('dia', g, s, { withAddress: true }), 'Rua X, 10', 'não repete o endereço');
  assert.equal(reminders.whatsappNumber('(11) 98888-7777'), '5511988887777');
  assert.equal(reminders.whatsappNumber('+55 11 98888 7777'), '5511988887777');
  assert.equal(reminders.whatsappNumber(''), null);
});

test('guia de perfis do assistente: toda permissão tem descrição e cada perfil recebe o que pode e o que não pode', () => {
  const guide = require('../src/services/assistantGuide');
  const { PERMISSIONS: perms } = require('../src/permissions');
  for (const perm of Object.keys(perms)) assert.ok(guide.ACTIONS[perm]?.text, `permissão ${perm} sem descrição em assistantGuide.js`);
  for (const perm of Object.keys(guide.ACTIONS)) assert.ok(perms[perm], `descrição de permissão que não existe mais: ${perm}`);
  const editor = guide.guide('editor_video');
  assert.ok(editor.can.some((a) => a.perm === 'production.edit')); assert.ok(editor.cannot.some((a) => a.perm === 'guests.write'));
  assert.deepEqual(editor.cannot.find((a) => a.perm === 'users.delete').whoCan, ['Superadmin']);
  const admin = guide.guide('superadmin');
  assert.equal(admin.cannot.length, 0, 'superadmin faz tudo');
  assert.equal(admin.can.length + editor.can.length + editor.cannot.length - admin.can.length, Object.keys(perms).length);
});

test('regras: Instagram, perfil, gênero e URLs', () => {
  assert.equal(rules.normalizeInstagram('@Maria.Souza'), 'maria.souza');
  assert.equal(rules.normalizeInstagram('https://www.instagram.com/maria_s/?igsh=1'), 'maria_s');
  assert.equal(rules.normalizeInstagram('instagram.com/maria/'), 'maria');
  assert.equal(rules.normalizeInstagram('com espaço'), null);
  assert.equal(rules.normalizeInstagram(''), null);
  assert.equal(rules.normalizeInstagram('a'.repeat(31)), null);
  for (const [input, key] of [['Médico', 'medico'], ['médica', 'medico'], ['INFLUENCER', 'influencer'], ['Influenciadora', 'influencer'], ['Empresário', 'empresario'],
    ['empresária', 'empresario'], ['Profissional da saúde', 'profissional_saude'], ['profissional de saude', 'profissional_saude'], ['medico', 'medico']]) {
    assert.equal(rules.normalizeProfile(input), key, input);
  }
  assert.equal(rules.normalizeProfile('astronauta'), null);
  assert.equal(rules.normalizeProfile(''), null);
  assert.equal(rules.normalizeGender('Feminino'), 'f');
  assert.equal(rules.normalizeGender(''), 'm');
  assert.equal(rules.normalizeGender('talvez'), null);
  assert.equal(rules.normalizeUrl('youtu.be/abc', rules.YOUTUBE_HOSTS).value, 'https://youtu.be/abc');
  assert.equal(rules.normalizeUrl('https://www.youtube.com/watch?v=1', rules.YOUTUBE_HOSTS).value, 'https://www.youtube.com/watch?v=1');
  assert.ok(rules.normalizeUrl('https://youtube.com.evil.com/x', rules.YOUTUBE_HOSTS).error);
  assert.ok(rules.normalizeUrl('javascript:alert(1)', rules.SPOTIFY_HOSTS).error);
  assert.deepEqual(rules.normalizeUrl('', rules.SPOTIFY_HOSTS), { value: null });
});

test('csv: separadores, aspas, quebra de linha dentro do campo, BOM e linhas em branco', () => {
  assert.deepEqual(csv.parseCsv('a;b;c\n1;2;3\n'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(csv.parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n\r\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);
  assert.deepEqual(csv.parseCsv('﻿a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(csv.parseCsv('a;b\n"linha 1\nlinha 2";z'), [['a', 'b'], ['linha 1\nlinha 2', 'z']]);
  assert.deepEqual(csv.parseCsv(''), []);
});

test('csv: cabeçalhos com acento/variações são reconhecidos e a validação é linha a linha', () => {
  const { rows, headerError } = csv.parseGuests('Nome Completo;@Instagram;Celular;Tipo de perfil;E-mail;Motivo\nAna;@ana;11 9;médica;a@b.co;porque\n;@x;;médico;;');
  assert.equal(headerError, null);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].errors, []);
  assert.deepEqual(rows[0].data, { name: 'Ana', instagram: 'ana', profile: 'medico', email: 'a@b.co', gender: 'm', status: 'prospect', proposed_at: null, loss_reason: null, loss_note: null, episode: null, phone: '11 9', invite_reason: 'porque', notes: null });
  assert.equal(rows[0].line, 2);
  assert.deepEqual(rows[1].errors, ['nome ausente']);
  assert.match(csv.parseGuests('nome;perfil\nA;médico').headerError, /instagram/);
});

test('csv: coluna de status (etapa) opcional com as regras de cada etapa', () => {
  const { rows } = csv.parseGuests([
    'nome;instagram;perfil;whatsapp;Etapa',
    'A1;@a1;médico;;Convite enviado',
    'A2;@a2;médico;11 9;em agendamento',
    'A3;@a3;médico;;Em agendamento',
    'A4;@a4;médico;;RECUSADO',
    'A5;@a5;médico;;cancelado',
    'A6;@a6;médico;;Agendado',
    'A7;@a7;médico;;gravado',
    'A8;@a8;médico;;astronauta',
    'A9;@a9;médico;;',
  ].join('\n'));
  assert.deepEqual(rows.map((r) => r.data.status), ['convite_enviado', 'em_agendamento', 'em_agendamento', 'perdido', 'cancelado', 'agendado', 'gravado', null, 'prospect']);
  assert.deepEqual(rows.map((r) => r.errors.length), [0, 0, 1, 0, 0, 1, 1, 1, 0]);
  assert.match(rows[2].errors[0], /Em agendamento pede e-mail ou WhatsApp/);
  assert.match(rows[5].errors[0], /Agendado pede data e hora da gravação/);
  assert.match(rows[6].errors[0], /Gravado pede a data da gravação/);
  assert.match(rows[7].errors[0], /status “astronauta” não reconhecido/);
});

test('csv: histórico (Gravado e Publicado) com episódio, links e data só com o dia', () => {
  const { rows } = csv.parseGuests([
    'nome;instagram;perfil;status;data da gravação;episódio;youtube;spotify;publicado em',
    'H1;@h1;médico;Publicado;10/03/2026;EP.003;https://youtu.be/abc;https://open.spotify.com/episode/x;20/03/2026',
    'H2;@h2;médico;Gravado;12/09/2026;;;;',
    'H3;@h3;médico;Gravado;;;;;',
    'H4;@h4;médico;Gravado;10/03/2099;;;;',
    'H5;@h5;médico;Publicado;10/03/2026;três;https://vimeo.com/1;;',
    'H6;@h6;médico;Gravado;10/03/2026;;https://youtu.be/abc;;',
    'H7;@h7;médico;Agendado;10/12/2099 10:00;4;;;',
  ].join('\n'));
  assert.deepEqual(rows[0].errors, []);
  assert.equal(rows[0].data.status, 'gravado');
  assert.deepEqual({ ...rows[0].data.episode, aired_at: rows[0].data.episode.aired_at.toISOString() },
    { number: 3, title: null, status: 'publicado', youtube_url: 'https://youtu.be/abc', spotify_url: 'https://open.spotify.com/episode/x', aired_at: '2026-03-20T15:00:00.000Z' });
  assert.equal(rows[0].data.proposed_at.toISOString(), '2026-03-10T15:00:00.000Z', 'só o dia vira meio-dia em Brasília');
  assert.deepEqual(rows[1].errors, []); assert.equal(rows[1].data.episode.status, 'gravado'); assert.equal(rows[1].data.episode.number, null);
  assert.match(rows[2].errors[0], /Gravado pede a data da gravação/);
  assert.match(rows[3].errors[0], /data no futuro/);
  assert.match(rows[4].errors.join(' | '), /número do episódio “três” inválido.*YouTube inválido/);
  assert.match(rows[5].errors[0], /use o status Publicado/);
  assert.match(rows[6].errors[0], /só valem para Gravado ou Publicado/);
});

test('csv: Perdido com motivo da perda', () => {
  const { rows } = csv.parseGuests([
    'nome;instagram;perfil;status;motivo da perda',
    'C1;@c1;médico;Perdido;Nunca respondeu',
    'C2;@c2;médico;Perdido;Mudou de área',
    'C3;@c3;médico;Perdido;',
    'C4;@c4;médico;Recusou;',
    'C5;@c5;médico;perdido;sem agenda',
  ].join('\n'));
  assert.deepEqual(rows.map((r) => [r.data.status, r.data.loss_reason, r.data.loss_note]), [
    ['perdido', 'nunca_respondeu', null], ['perdido', 'outros', 'Mudou de área'], ['perdido', null, null], ['perdido', 'recusado', null], ['perdido', 'sem_agenda', null]]);
  assert.deepEqual(rows.map((r) => r.errors.length), [0, 0, 1, 0, 0]);
  assert.match(rows[2].errors[0], /Perdido pede o motivo da perda/);
});

test('csv: data e hora da gravação (Brasília) e Agendado', () => {
  const at = (d, t) => rules.parseRecordingAt(d, t);
  assert.equal(at('25/11/2026 14:30').value.toISOString(), '2026-11-25T17:30:00.000Z');
  assert.equal(at('25/11/26', '14h').value.toISOString(), '2026-11-25T17:00:00.000Z');
  assert.equal(at('2026-11-25 às 9h30').value.toISOString(), '2026-11-25T12:30:00.000Z');
  assert.equal(at('25/11/2026 14:30:00').value.toISOString(), '2026-11-25T17:30:00.000Z');
  assert.deepEqual(at('', ''), { value: null });
  assert.match(at('25/11/2026').error, /falta a hora/);
  assert.match(at('31/02/2027 10:00').error, /inválida/);
  assert.match(at('25/11/2026 25:00').error, /inválida/);
  assert.match(at('amanhã').error, /inválida/);
  const { rows } = csv.parseGuests([
    'nome;instagram;perfil;status;data da gravação;hora',
    'B1;@b1;médico;Agendado;25/11/2099;14:30',
    'B2;@b2;médico;Agendado;01/01/2020;10:00',
    'B3;@b3;médico;;10/12/2099;9h',
  ].join('\n'));
  assert.deepEqual(rows[0].errors, []);
  assert.equal(rows[0].data.status, 'agendado');
  assert.equal(rows[0].data.proposed_at.toISOString(), '2099-11-25T17:30:00.000Z');
  assert.match(rows[1].errors[0], /já passou/);
  assert.deepEqual(rows[2].errors, []);
  assert.equal(rows[2].data.status, 'prospect');
});

test.after(async () => { await require('../src/db/pool').close(); });

test('urls: esquemas estranhos são recusados, "site sem https" e localhost com porta passam', () => {
  for (const bad of ['ftp://x', 'javascript:alert(1)', 'data:text/html,<b>x', 'file:///etc/passwd', 'mailto:a@b.co']) assert.ok(rules.normalizeUrl(bad).error, bad);
  assert.equal(rules.normalizeUrl('aurora.com.br').value, 'https://aurora.com.br/');
  assert.equal(rules.normalizeUrl('http://aurora.com.br/x').value, 'http://aurora.com.br/x');
  assert.equal(rules.normalizeUrl('localhost:3000').value, 'https://localhost:3000/');
});

test('valores em reais: parseBRL e formatBRL', () => {
  assert.equal(fmt.parseBRL('15.000,00'), 1500000);
  assert.equal(fmt.parseBRL('15000'), 1500000);
  assert.equal(fmt.parseBRL('R$ 6.000,5'), 600050);
  assert.equal(fmt.parseBRL('6.000'), 600000);
  assert.equal(fmt.parseBRL(''), null);
  assert.ok(Number.isNaN(fmt.parseBRL('abc')));
  assert.ok(Number.isNaN(fmt.parseBRL('1,2,3')));
  assert.match(fmt.formatBRL(1500000), /R\$\s15\.000,00/);
  assert.equal(fmt.formatBRL(null), '—');
});

test('datas sem hora: parse, formatação e dia por extenso (sem deslocar por fuso)', () => {
  assert.equal(fmt.parseInputDate('2026-10-23'), '2026-10-23');
  assert.ok(Number.isNaN(fmt.parseInputDate('2026-02-30')));
  assert.equal(fmt.parseInputDate(''), null);
  assert.equal(fmt.formatDay('2026-10-23'), '23/10/2026');
  assert.equal(fmt.formatDay(new Date(2026, 9, 23)), '23/10/2026');
  assert.equal(fmt.formatDayShort('2026-10-23'), '23/10');
  assert.equal(fmt.formatDayLong('2026-10-23'), '23 de outubro de 2026');
  assert.equal(fmt.formatDayLong(null), '');
});

test('backblaze: assinatura SigV4 confere com o exemplo oficial da AWS e a codificação segue o padrão', () => {
  const b2 = require('../src/services/b2');
  const r = b2.signRequest({
    method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', headers: { range: 'bytes=0-9' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', amzDate: '20130524T000000Z',
  });
  assert.equal(r.signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  assert.match(r.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=/);
  assert.equal(b2.uriEncode("café (1)!'*"), 'caf%C3%A9%20%281%29%21%27%2A');
});

test('relativeDays conta dias no calendário de Brasília', () => {
  const now = new Date('2026-10-08T23:30:00-03:00');
  assert.equal(fmt.relativeDays(new Date('2026-10-08T08:00:00-03:00'), now), 'hoje');
  assert.equal(fmt.relativeDays(new Date('2026-10-09T00:10:00-03:00'), now), 'amanhã', 'virou o dia em Brasília');
  assert.equal(fmt.relativeDays(new Date('2026-10-13T15:00:00-03:00'), now), 'em 5 dias');
  assert.equal(fmt.relativeDays(new Date('2026-10-07T15:00:00-03:00'), now), 'ontem');
  assert.equal(fmt.relativeDays(new Date('2026-10-01T15:00:00-03:00'), now), 'há 7 dias');
  assert.equal(fmt.relativeDays(null, now), '');
});
