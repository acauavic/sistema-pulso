const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const sessions = require('./auth/sessions');
const { can, ROLES } = require('./permissions');
const fmt = require('./utils/format');
const { icon } = require('./utils/icons');
const releases = require('./services/releases');

// Cabeçalhos de segurança + CSP restritiva para o painel (sem scripts inline).
function securityHeaders(req, res, next) {
  res.locals.assetV = ASSET_VERSION;
  if (config.isProd) res.set('Strict-Transport-Security', 'max-age=31536000'); // atrás do Traefik com HTTPS: o navegador não volta ao http
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob: https://*.backblazeb2.com; style-src 'self'; script-src 'self'; connect-src 'self'; " +
      "frame-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'",
  });
  next();
}

// Mutação só se o Origin (quando enviado) for o nosso host: reforça o SameSite=Lax.
function originCheck(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // A página pública do convite roda em sandbox (Origin: null) e é protegida pelo token secreto da URL.
  if (/^\/convite\/[^/]+\/responder$/.test(req.path)) return next();
  // Páginas do patrocinador mandam Referrer-Policy: no-referrer, e por isso o navegador envia "Origin: null" no POST do
  // formulário. Essas rotas têm token CSRF próprio (sessão do patrocinador), então aceitam null (e só null ou o próprio host).
  const allowNull = /^\/patrocinador\/(cadastro|logo|audio|resposta|concluir)$/.test(req.path);
  const origin = req.get('origin');
  if (origin && origin !== 'null') {
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    if (host !== req.get('host') && origin !== config.appBaseUrl) return res.status(403).send('Origem não permitida.');
  } else if (origin === 'null' && !allowNull) {
    return res.status(403).send('Origem não permitida.');
  }
  return next();
}

// Dados do menu nas páginas do painel: notificações não lidas, minhas tarefas abertas e a lista de pessoas (para a "bolinha" de responsável).
async function navData(req, res, next) {
  if (!req.user || req.method !== 'GET' || /json|event-stream/.test(req.get('accept') || '')) return next();
  try {
    const db = require('./db/pool');
    const [counts, users] = await Promise.all([
      db.query(`SELECT (SELECT count(*)::int FROM notifications WHERE user_id = $1 AND read_at IS NULL) AS unread,
                       (SELECT count(*)::int FROM tasks WHERE assignee_id = $1 AND status <> 'feito') AS tasks,
                       (SELECT release_seen FROM users WHERE id = $1) AS release_seen,
                       CASE WHEN $2 THEN (SELECT count(*)::int FROM episode_publications WHERE status = 'revisao') ELSE 0 END AS reviews`, [req.user.id, can(req.user.role, 'social.publish')]),
      db.query('SELECT id, name FROM users WHERE active ORDER BY lower(name)'),
    ]);
    res.locals.navCounts = counts.rows[0];
    res.locals.teamUsers = users.rows;
  } catch (err) {
    console.error('menu:', err.message);
  }
  return next();
}

// Carrega sessão (se houver) e injeta helpers de renderização.
async function attachSession(req, res, next) {
  try {
    const session = await sessions.loadSession(req);
    req.session = session;
    req.user = session ? session.user : null;
    const flash = session && session.flash;
    if (flash) await sessions.clearFlash(session.tokenHash);

    res.locals.currentUser = req.user;
    res.locals.csrf = session ? session.csrf : '';
    res.locals.flash = flash || null;
    res.locals.can = (perm) => Boolean(req.user && can(req.user.role, perm));
    res.locals.ROLES = ROLES;
    res.locals.fmt = fmt;
    res.locals.icon = icon;
    res.locals.podcastName = config.podcastName;
    res.locals.currentPath = req.path;
    res.locals.navCounts = null;
    res.locals.appVersion = releases.current().version;
    res.locals.releaseInfo = releases.current();
    res.locals.teamUsers = [];

    req.flash = async (type, message) => {
      if (req.session) await sessions.setFlash(req.session.tokenHash, type, message);
    };
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.method === 'GET') return res.redirect('/login');
  return res.status(401).send('Sessão expirada. Faça login novamente.');
}

function requirePerm(permission) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if (can(req.user.role, permission)) return next();
    return res.status(403).render('error', { title: 'Sem permissão', message: 'Seu perfil não tem acesso a esta área.' });
  };
}

// CSRF para ações autenticadas (campo _csrf no form, ou header x-csrf-token no fetch).
// Fluxos sem login (login, esqueci a senha, link do e-mail) dependem do Origin check e de tokens secretos.
const sameSecret = (a, b) => {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const CSRF_EXEMPT = /^\/(login|esqueci-senha|senha\/)/;

function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.session || CSRF_EXEMPT.test(req.path)) return next();
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (typeof sent === 'string' && sameSecret(sent, req.session.csrf)) return next();
  return res.status(403).render('error', { title: 'Requisição inválida', message: 'Token de segurança inválido ou expirado. Volte, recarregue a página e tente de novo.' });
}

const staticDir = path.join(__dirname, 'public');

// Versão dos arquivos de /static (hash do conteúdo, calculado ao subir). Vai na URL (?v=…) para que o navegador
// não use CSS/JS antigo do cache de 1h depois de um deploy.
const ASSET_VERSION = (() => {
  const h = crypto.createHash('sha1');
  for (const f of ['app.css', 'app.js', 'theme.js', 'patrocinador.css', 'brief.js', 'producao.js', 'editor.js', 'design/engine.js', 'collab.js', 'social.js', 'assistant.js', 'plateia.css', 'plateia.js']) {
    try { h.update(fs.readFileSync(path.join(staticDir, f))); } catch { /* arquivo ausente: ignora */ }
  }
  return h.digest('hex').slice(0, 10);
})();

module.exports = { securityHeaders, originCheck, attachSession, navData, requireAuth, requirePerm, verifyCsrf, staticDir };
