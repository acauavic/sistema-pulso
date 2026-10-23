// Sessão do patrocinador (magic link reutilizável). O link com o token abre a página, cria uma sessão e redireciona para
// uma URL limpa; o cookie (HttpOnly) é que autoriza o resto. O link continua valendo até a equipe gerar outro, e gerar outro
// derruba todas as sessões abertas.
const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config');
const { sha256, newToken, parseCookies } = require('../auth/sessions');

const COOKIE = 'pulso_sp';
const DAYS = 30;
const PATH = '/patrocinador';

const options = (extra = '') => `Path=${PATH}; HttpOnly; SameSite=Lax${config.isProd ? '; Secure' : ''}${extra}`;

async function create(res, sponsorId, req) {
  const token = newToken();
  await db.query(
    "INSERT INTO sponsor_sessions (sponsor_id, token_hash, expires_at, user_agent) VALUES ($1,$2, now() + ($3 || ' days')::interval, $4)",
    [sponsorId, sha256(token), String(DAYS), String(req.get('user-agent') || '').slice(0, 300)]);
  res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Max-Age=${DAYS * 86400}; ${options()}`);
}

// { sponsor, csrf } ou null. Atualiza o "visto por último" no máximo uma vez por hora.
async function load(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const hash = sha256(token);
  const { rows } = await db.query(
    `SELECT s.*, ss.id AS session_id, ss.last_seen_at
       FROM sponsor_sessions ss JOIN sponsors s ON s.id = ss.sponsor_id
      WHERE ss.token_hash = $1 AND ss.expires_at > now()`, [hash]);
  const sponsor = rows[0];
  if (!sponsor) return null;
  if (Date.now() - new Date(sponsor.last_seen_at).getTime() > 3600_000) {
    await db.query('UPDATE sponsor_sessions SET last_seen_at = now() WHERE id = $1', [sponsor.session_id]);
  }
  return { sponsor, csrf: crypto.createHmac('sha256', config.sessionSecret).update(`sp:${hash}`).digest('hex') };
}

const csrfOk = (session, sent) => {
  if (!session || typeof sent !== 'string' || sent.length !== session.csrf.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(session.csrf));
};

const revokeAll = (sponsorId) => db.query('DELETE FROM sponsor_sessions WHERE sponsor_id = $1', [sponsorId]);
const purgeExpired = () => db.query('DELETE FROM sponsor_sessions WHERE expires_at < now()');

module.exports = { COOKIE, DAYS, create, load, csrfOk, revokeAll, purgeExpired };
