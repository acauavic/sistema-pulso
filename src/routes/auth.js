const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const sessions = require('../auth/sessions');
const { hashPassword, verifyPassword, passwordPolicyError, burnPasswordCheck } = require('../auth/password');
const { createAuthToken, peekAuthToken, consumeAuthToken } = require('../auth/tokens');
const { createLimiter } = require('../auth/rateLimit');
const mailer = require('../services/mailer');
const { audit } = require('../services/audit');
const { requireAuth } = require('../middleware');
const { wrap } = require('../utils/wrap');
const { isEmail, clean } = require('../utils/format');

const router = express.Router();

const loginLimiterIp = createLimiter({ max: 30, windowMs: 15 * 60_000 }); // só tentativas FALHAS contam
const loginLimiterEmail = createLimiter({ max: 8, windowMs: 15 * 60_000 });
const forgotLimiter = createLimiter({ max: 5, windowMs: 15 * 60_000 });

const NOTICES = {
  senha: 'Senha definida! Entre com seu e-mail e a nova senha.',
  saiu: 'Você saiu da sua conta.',
};

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  return res.render('login', { title: 'Entrar', error: null, email: '', notice: NOTICES[req.query.ok] || null });
});

router.post('/login', wrap(async (req, res) => {
  const email = clean(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const fail = (status, error) => res.status(status).render('login', { title: 'Entrar', error, email, notice: null });

  if (loginLimiterIp.blocked(req.ip) || loginLimiterEmail.blocked(email)) {
    return fail(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
  }
  const { rows } = await db.query('SELECT * FROM users WHERE lower(email) = $1', [email]);
  const user = rows[0];
  const ok = user && user.active && user.password_hash && (await verifyPassword(password, user.password_hash));
  if (!user || !user.password_hash) await burnPasswordCheck(password);
  if (!ok) {
    loginLimiterIp.hit(req.ip);
    loginLimiterEmail.hit(email);
    await audit({ user: null, ip: req.ip }, 'login.falha', 'user', user?.id, { email });
    return fail(401, 'E-mail ou senha incorretos.');
  }
  loginLimiterEmail.reset(email);
  await sessions.createSession(res, user.id, req);
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  await audit({ user, ip: req.ip }, 'login.ok', 'user', user.id);
  return res.redirect('/');
}));

router.post('/logout', wrap(async (req, res) => {
  if (req.session) {
    if ((req.body._csrf || '') !== req.session.csrf) return res.status(403).send('Requisição inválida.');
    await audit(req, 'logout', 'user', req.user.id);
    await sessions.destroySession(req.session.tokenHash);
  }
  sessions.clearCookie(res);
  return res.redirect('/login?ok=saiu');
}));

// ---- esqueci a senha ----
router.get('/esqueci-senha', (req, res) => res.render('forgot', { title: 'Esqueci minha senha', sent: false, email: '' }));

router.post('/esqueci-senha', wrap(async (req, res) => {
  const email = clean(req.body.email, 254).toLowerCase();
  const render = () => res.render('forgot', { title: 'Esqueci minha senha', sent: true, email });
  if (!isEmail(email) || !forgotLimiter.hit(req.ip) || !forgotLimiter.hit(email)) return render(); // resposta idêntica sempre
  const { rows } = await db.query('SELECT id, name, email, active FROM users WHERE lower(email) = $1', [email]);
  const user = rows[0];
  if (user && user.active) {
    try {
      const token = await createAuthToken(user.id, 'reset');
      await mailer.sendPasswordReset({ to: user.email, name: user.name, url: `${config.appBaseUrl}/senha/${token}` });
      await audit({ user, ip: req.ip }, 'senha.reset_solicitado', 'user', user.id);
    } catch (err) {
      console.error('Falha ao enviar reset de senha:', err.message);
    }
  }
  return render();
}));

// ---- definir / redefinir senha (link do e-mail) ----
router.get('/senha/:token', wrap(async (req, res) => {
  const info = await peekAuthToken(req.params.token, ['invite', 'reset']);
  if (!info) return res.status(410).render('error', { title: 'Link inválido', message: 'Este link expirou ou já foi usado. Peça um novo em "Esqueci minha senha".' });
  return res.render('set-password', { title: info.purpose === 'invite' ? 'Definir senha' : 'Nova senha', info, error: null, token: req.params.token });
}));

router.post('/senha/:token', wrap(async (req, res) => {
  const { password, confirm } = req.body;
  const info = await peekAuthToken(req.params.token, ['invite', 'reset']);
  if (!info) return res.status(410).render('error', { title: 'Link inválido', message: 'Este link expirou ou já foi usado. Peça um novo em "Esqueci minha senha".' });
  const error = passwordPolicyError(password) || (password !== confirm ? 'As senhas não conferem.' : null);
  if (error) return res.status(400).render('set-password', { title: 'Definir senha', info, error, token: req.params.token });

  const consumed = await consumeAuthToken(req.params.token, ['invite', 'reset']);
  if (!consumed) return res.status(410).render('error', { title: 'Link inválido', message: 'Este link já foi usado.' });
  await db.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [consumed.id, await hashPassword(password)]);
  await sessions.destroyUserSessions(consumed.id); // derruba sessões antigas
  await audit({ user: { id: consumed.id, email: consumed.email }, ip: req.ip }, `senha.${consumed.purpose === 'invite' ? 'definida' : 'redefinida'}`, 'user', consumed.id);
  return res.redirect('/login?ok=senha');
}));

// ---- perfil ----
router.get('/perfil', requireAuth, (req, res) => res.render('profile', { title: 'Meu perfil', error: null }));

router.post('/perfil', requireAuth, wrap(async (req, res) => {
  const name = clean(req.body.name, 120);
  if (name.length < 2) {
    await req.flash('error', 'Informe seu nome.');
    return res.redirect('/perfil');
  }
  await db.query('UPDATE users SET name = $2, updated_at = now() WHERE id = $1', [req.user.id, name]);
  await audit(req, 'perfil.atualizado', 'user', req.user.id);
  await req.flash('ok', 'Perfil atualizado.');
  return res.redirect('/perfil');
}));

router.post('/perfil/senha', requireAuth, wrap(async (req, res) => {
  const { current, password, confirm } = req.body;
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  let error = null;
  if (!(await verifyPassword(current || '', rows[0]?.password_hash))) error = 'Senha atual incorreta.';
  else error = passwordPolicyError(password) || (password !== confirm ? 'As senhas não conferem.' : null);
  if (error) {
    await req.flash('error', error);
    return res.redirect('/perfil');
  }
  await db.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [req.user.id, await hashPassword(password)]);
  await sessions.destroyUserSessions(req.user.id, req.session.tokenHash); // mantém só esta sessão
  await audit(req, 'senha.alterada', 'user', req.user.id);
  await req.flash('ok', 'Senha alterada. Outras sessões foram encerradas.');
  return res.redirect('/perfil');
}));

module.exports = router;
