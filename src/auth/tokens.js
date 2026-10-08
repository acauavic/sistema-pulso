// Tokens de uso único enviados por e-mail: definir senha (convite) e redefinir senha.
const db = require('../db/pool');
const { sha256, newToken } = require('./sessions');

const TTL_HOURS = { invite: 72, reset: 1 };

async function createAuthToken(userId, purpose) {
  const token = newToken();
  // um token ativo por usuário/finalidade: o novo invalida o anterior
  await db.query('DELETE FROM auth_tokens WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL', [userId, purpose]);
  await db.query(
    `INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' hours')::interval)`,
    [sha256(token), userId, purpose, String(TTL_HOURS[purpose])],
  );
  return token;
}

// Só consulta (para mostrar o formulário). Não consome.
async function peekAuthToken(token, purposes) {
  if (!token || typeof token !== 'string') return null;
  const { rows } = await db.query(
    `SELECT t.purpose, u.id, u.name, u.email, u.active
       FROM auth_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()
        AND t.purpose = ANY($2) AND u.active`,
    [sha256(token), purposes],
  );
  return rows[0] || null;
}

// Consome de forma atômica: duas requisições simultâneas não usam o mesmo token.
async function consumeAuthToken(token, purposes) {
  if (!token || typeof token !== 'string') return null;
  const { rows } = await db.query(
    `UPDATE auth_tokens t SET used_at = now()
       FROM users u
      WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()
        AND t.purpose = ANY($2) AND u.id = t.user_id AND u.active
    RETURNING t.purpose, u.id, u.name, u.email`,
    [sha256(token), purposes],
  );
  return rows[0] || null;
}

module.exports = { createAuthToken, peekAuthToken, consumeAuthToken, TTL_HOURS };
