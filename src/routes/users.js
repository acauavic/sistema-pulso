const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const sessions = require('../auth/sessions');
const { createAuthToken, revokeAuthTokens } = require('../auth/tokens');
const mailer = require('../services/mailer');
const { audit } = require('../services/audit');
const { requirePerm } = require('../middleware');
const { canManageUser, assignableRoles, isRole } = require('../permissions');
const { wrap, isUuid } = require('../utils/wrap');
const { isEmail, clean } = require('../utils/format');

const router = express.Router();

const PG_UNIQUE = '23505';

async function findUser(id) {
  if (!isUuid(id)) return null;
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

// O sistema nunca pode ficar sem um superadmin ativo.
async function otherActiveSuperadmins(excludeId) {
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM users WHERE role = 'superadmin' AND active AND id <> $1", [excludeId]);
  return rows[0].n;
}

async function sendAccessLink(user, invitedBy) {
  const token = await createAuthToken(user.id, 'invite');
  await mailer.sendUserInvite({ to: user.email, name: user.name, url: `${config.appBaseUrl}/senha/${token}`, invitedBy });
}

const notFound = (res) => res.status(404).render('error', { title: 'Não encontrado', message: 'Usuário não encontrado.' });
const forbidden = (res, message = 'Você não pode alterar este usuário.') =>
  res.status(403).render('error', { title: 'Sem permissão', message });

// ---- listagem ----
router.get('/usuarios', requirePerm('users.read'), wrap(async (req, res) => {
  const q = clean(req.query.q, 100);
  const role = isRole(req.query.role) ? req.query.role : '';
  const status = ['ativo', 'inativo', 'pendente'].includes(req.query.status) ? req.query.status : '';
  const where = [];
  const params = [];
  if (q) { params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); where.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length})`); }
  if (role) { params.push(role); where.push(`role = $${params.length}`); }
  if (status === 'ativo') where.push('active AND password_hash IS NOT NULL');
  if (status === 'inativo') where.push('NOT active');
  if (status === 'pendente') where.push('active AND password_hash IS NULL');
  const { rows } = await db.query(
    `SELECT id, name, email, role, active, (password_hash IS NOT NULL) AS has_password, last_login_at, created_at
       FROM users ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY active DESC, lower(name)`, params);
  res.render('users/list', { title: 'Usuários', users: rows, q, role, status, canManageUser, myRole: req.user.role });
}));

// ---- criar ----
// Onde a pessoa trabalha e se vê o dinheiro de cada lugar: a tela mostra uma linha por projeto.
const projectsSvc = require('../services/projects');
const rolesSvc = require('../services/roles');
const projectRows = async (userId) => {
  await projectsSvc.refresh();
  const mine = userId ? await projectsSvc.membershipsOf(userId) : [];
  const by = new Map(mine.map((m) => [Number(m.project_id), m]));
  return projectsSvc.all().map((p) => ({ id: p.id, name: p.name, member: by.has(p.id), roleId: by.get(p.id) ? by.get(p.id).role_id : null }));
};
// O que a tela mandou: projeto[] marcados e a função de cada um (funcao_<id>; vazio = a padrão). Sem o campo `acesso`, a tela
// não mexeu nisso (os projetos de hoje ficam como estão). Projeto novo nasce com o padrão marcado.
const projectsFromBody = (body, fallbackId, allowed) => {
  if (!body.acesso) return null;
  const ids = [].concat(body.projetos || []).map(Number).filter(Boolean);
  const list = ids.length ? ids : (fallbackId ? [fallbackId] : []);
  return list.map((id) => {
    const rid = Number(body[`funcao_${id}`]);
    return { id, finance: true, roleId: allowed.some((r) => r.id === rid) ? rid : null };
  });
};
// A função escolhida (role_id), ou o perfil em texto de antes (role). Só vale a que quem edita pode dar.
const roleFromBody = (body, allowed) => {
  const byId = allowed.find((r) => r.id === Number(body.role_id));
  if (byId) return byId;
  return body.role ? allowed.find((r) => r.builtin && r.key === body.role) || null : null;
};
const accessUntil = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);

router.get('/usuarios/novo', requirePerm('users.write'), wrap(async (req, res) => {
  res.render('users/form', {
    title: 'Novo usuário', target: null, values: { role: 'produtora', role_id: (rolesSvc.byKey('produtora') || {}).id, house: true }, roles: rolesSvc.assignable(req.user), error: null,
    projectRows: await projectRows(null), isSelf: false,
  });
}));

router.post('/usuarios', requirePerm('users.write'), wrap(async (req, res) => {
  const roles = rolesSvc.assignable(req.user);
  const role = roleFromBody(req.body, roles);
  const values = {
    name: clean(req.body.name, 120), email: clean(req.body.email, 254).toLowerCase(), role: role ? role.base : req.body.role, role_id: role ? role.id : null,
    house: req.body.house === '1' || (role && role.base === 'superadmin'), // o superadmin é sempre da casa
    access_until: accessUntil(req.body.access_until),
  };
  const chosen = projectsFromBody(req.body, projectsSvc.defaultId(), roles) || [{ id: projectsSvc.defaultId(), finance: true }];
  const error =
    values.name.length < 2 ? 'Informe o nome.'
      : !isEmail(values.email) ? 'E-mail inválido.'
        : !role ? 'Função inválida para o seu nível de acesso.'
          : null;
  if (error) return res.status(400).render('users/form', { title: 'Novo usuário', target: null, values, roles, error, projectRows: await projectRows(null), isSelf: false });

  let user;
  try {
    ({ rows: [user] } = await db.query(
      'INSERT INTO users (name, email, role, role_id, house, access_until) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [values.name, values.email, values.role, values.role_id, values.house, values.access_until]));
  } catch (err) {
    if (err.code === PG_UNIQUE) return res.status(409).render('users/form', { title: 'Novo usuário', target: null, values, roles, error: 'Já existe um usuário com este e-mail.', projectRows: await projectRows(null), isSelf: false });
    throw err;
  }
  const set = await projectsSvc.setUserProjects(user.id, chosen); // onde ela trabalha e onde vê o dinheiro
  if (set.error) await projectsSvc.addMember(user.id, projectsSvc.defaultId(), { finance: true });
  await audit(req, 'usuario.criado', 'user', user.id, { email: user.email, role: user.role });
  try {
    await sendAccessLink(user, req.user.name);
    await req.flash('ok', `Usuário criado. Enviamos o link para ${user.email} definir a senha.`);
  } catch (err) {
    console.error('Falha ao enviar convite de usuário:', err.message);
    await req.flash('error', `Usuário criado, mas o e-mail NÃO foi enviado (${err.message}). Use "Reenviar acesso" quando o e-mail estiver funcionando.`);
  }
  return res.redirect('/usuarios');
}));

// ---- editar ----
router.get('/usuarios/:id/editar', requirePerm('users.write'), wrap(async (req, res) => {
  const target = await findUser(req.params.id);
  if (!target) return notFound(res);
  if (!canManageUser(req.user.role, target.role)) return forbidden(res);
  return res.render('users/form', {
    title: `Editar ${target.name}`, target, values: target, roles: rolesSvc.assignable(req.user), error: null,
    isSelf: target.id === req.user.id, projectRows: await projectRows(target.id),
  });
}));

router.post('/usuarios/:id', requirePerm('users.write'), wrap(async (req, res) => {
  const target = await findUser(req.params.id);
  if (!target) return notFound(res);
  if (!canManageUser(req.user.role, target.role)) return forbidden(res);

  const isSelf = target.id === req.user.id;
  const roles = rolesSvc.assignable(req.user);
  const role = isSelf ? rolesSvc.get(target.role_id) : roleFromBody(req.body, roles); // ninguém muda a própria função
  const values = {
    name: clean(req.body.name, 120),
    email: clean(req.body.email, 254).toLowerCase(),
    role: role ? role.base : target.role,
    role_id: role ? role.id : target.role_id,
    // equipe da casa: ninguém muda a sua (não dá para se trancar fora), e o superadmin é sempre da casa
    house: isSelf || !req.body.acesso ? target.house : (req.body.house === '1' || (role && role.base === 'superadmin')),
    access_until: isSelf || !req.body.acesso ? target.access_until : accessUntil(req.body.access_until),
  };
  const chosen = projectsFromBody(req.body, null, roles); // null = a tela não mandou a parte de acesso
  const rerender = async (status, error) => res.status(status).render('users/form', {
    title: `Editar ${target.name}`, target, values: { ...target, ...values }, roles, error, isSelf, projectRows: await projectRows(target.id),
  });

  if (values.name.length < 2) return rerender(400, 'Informe o nome.');
  if (chosen && !chosen.length) return rerender(400, 'Marque pelo menos um projeto: toda pessoa trabalha em algum.');
  if (!isEmail(values.email)) return rerender(400, 'E-mail inválido.');
  if (!isSelf && !role) return rerender(400, 'Função inválida para o seu nível de acesso.');
  // trocar o e-mail de quem já tem senha e depois "Enviar nova senha" daria a conta da pessoa a quem trocou: só o superadmin pode
  const emailChanged = values.email !== target.email;
  if (emailChanged && !isSelf && target.password_hash && req.user.role !== 'superadmin') {
    return rerender(403, 'Esta pessoa já tem senha: só o superadmin troca o e-mail dela. Se ela mudou de e-mail, peça a um superadmin.');
  }
  if (target.role === 'superadmin' && values.role !== 'superadmin' && (await otherActiveSuperadmins(target.id)) === 0) {
    return rerender(400, 'Este é o único superadmin ativo. Promova outra pessoa antes de rebaixá-lo.');
  }

  if (chosen) {
    const set = await projectsSvc.setUserProjects(target.id, chosen);
    if (set.error) return rerender(400, set.error);
  }
  try {
    await db.query('UPDATE users SET name = $2, email = $3, role = $4, role_id = $5, house = $6, access_until = $7, updated_at = now() WHERE id = $1',
      [target.id, values.name, values.email, values.role, values.role_id, values.house, values.access_until]);
  } catch (err) {
    if (err.code === PG_UNIQUE) return rerender(409, 'Já existe um usuário com este e-mail.');
    throw err;
  }
  if (values.role !== target.role || values.house !== target.house || emailChanged) await sessions.destroyUserSessions(target.id); // força novo login
  if (emailChanged) await revokeAuthTokens(target.id); // convite/redefinição que já foi para o e-mail antigo deixa de valer
  await audit(req, 'usuario.editado', 'user', target.id, {
    de: { email: target.email, role: target.role, casa: target.house }, para: { email: values.email, role: values.role, casa: values.house },
    funcao: values.role_id !== target.role_id ? (rolesSvc.get(values.role_id) || {}).name : undefined,
    projetos: chosen ? chosen.map((c) => `${c.id}${c.roleId ? ` (${(rolesSvc.get(c.roleId) || {}).name})` : ''}`).join(', ') : undefined,
  });
  await req.flash('ok', 'Usuário atualizado.');
  return res.redirect('/usuarios');
}));

// ---- ativar / desativar ----
router.post('/usuarios/:id/status', requirePerm('users.write'), wrap(async (req, res) => {
  const target = await findUser(req.params.id);
  if (!target) return notFound(res);
  if (!canManageUser(req.user.role, target.role)) return forbidden(res);
  const active = req.body.active === 'true';
  if (target.id === req.user.id && !active) return forbidden(res, 'Você não pode desativar a si mesmo.');
  if (!active && target.role === 'superadmin' && (await otherActiveSuperadmins(target.id)) === 0) {
    return forbidden(res, 'Este é o único superadmin ativo e não pode ser desativado.');
  }
  await db.query('UPDATE users SET active = $2, updated_at = now() WHERE id = $1', [target.id, active]);
  if (!active) await sessions.destroyUserSessions(target.id);
  await audit(req, active ? 'usuario.reativado' : 'usuario.desativado', 'user', target.id, { email: target.email });
  await req.flash('ok', active ? 'Usuário reativado.' : 'Usuário desativado e desconectado.');
  return res.redirect('/usuarios');
}));

// ---- reenviar link de acesso / forçar redefinição ----
router.post('/usuarios/:id/reenviar', requirePerm('users.write'), wrap(async (req, res) => {
  const target = await findUser(req.params.id);
  if (!target) return notFound(res);
  if (!canManageUser(req.user.role, target.role)) return forbidden(res);
  if (!target.active) return forbidden(res, 'Reative o usuário antes de enviar o acesso.');
  try {
    await sendAccessLink(target, req.user.name);
    await audit(req, 'usuario.acesso_reenviado', 'user', target.id, { email: target.email });
    await req.flash('ok', `Link de acesso enviado para ${target.email}.`);
  } catch (err) {
    console.error('Falha ao reenviar acesso:', err.message);
    await req.flash('error', `Não foi possível enviar o e-mail: ${err.message}`);
  }
  return res.redirect('/usuarios');
}));

// ---- excluir (só superadmin) ----
router.post('/usuarios/:id/excluir', requirePerm('users.delete'), wrap(async (req, res) => {
  const target = await findUser(req.params.id);
  if (!target) return notFound(res);
  if (target.id === req.user.id) return forbidden(res, 'Você não pode excluir a si mesmo.');
  if (target.role === 'superadmin' && target.active && (await otherActiveSuperadmins(target.id)) === 0) {
    return forbidden(res, 'Este é o único superadmin ativo e não pode ser excluído.');
  }
  await audit(req, 'usuario.excluido', 'user', target.id, { email: target.email, role: target.role, name: target.name });
  await db.query('DELETE FROM users WHERE id = $1', [target.id]); // convidados/eventos ficam (FK SET NULL)
  await req.flash('ok', `Usuário ${target.name} excluído.`);
  return res.redirect('/usuarios');
}));

module.exports = router;
