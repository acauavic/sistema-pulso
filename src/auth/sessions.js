const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config');

const COOKIE = 'pulso_sid';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function cookieOptions(extra = '') {
  const secure = config.isProd ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax${secure}${extra}`;
}

async function createSession(res, userId, req) {
  const token = newToken();
  const maxAge = config.sessionDays * 86400;
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + ($3 || ' seconds')::interval, $4, $5)`,
    [sha256(token), userId, String(maxAge), req.ip, String(req.get('user-agent') || '').slice(0, 300)],
  );
  res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAge}; ${cookieOptions()}`);
}

function clearCookie(res) {
  res.append('Set-Cookie', `${COOKIE}=; Max-Age=0; ${cookieOptions()}`);
}

// Resolve o usuário da sessão. Desativado/sem senha = sem sessão.
async function loadSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const tokenHash = sha256(token);
  const { rows } = await db.query(
    `SELECT s.token_hash, s.flash,
            u.id, u.name, u.email, u.role, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row || !row.active) return null;
  return {
    tokenHash: row.token_hash,
    flash: row.flash,
    csrf: crypto.createHmac('sha256', config.sessionSecret).update(row.token_hash).digest('hex'),
    user: { id: row.id, name: row.name, email: row.email, role: row.role },
  };
}

async function destroySession(tokenHash) {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

async function destroyUserSessions(userId, exceptHash = null) {
  await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash IS DISTINCT FROM $2', [userId, exceptHash]);
}

async function setFlash(tokenHash, type, message) {
  await db.query('UPDATE sessions SET flash = $2 WHERE token_hash = $1', [tokenHash, JSON.stringify({ type, message })]);
}

async function clearFlash(tokenHash) {
  await db.query('UPDATE sessions SET flash = NULL WHERE token_hash = $1', [tokenHash]);
}

// Limpeza oportunista de sessões e tokens vencidos.
async function purgeExpired() {
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  await db.query("DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days'");
}

module.exports = {
  COOKIE, sha256, newToken, parseCookies,
  createSession, clearCookie, loadSession, destroySession, destroyUserSessions,
  setFlash, clearFlash, purgeExpired,
};
