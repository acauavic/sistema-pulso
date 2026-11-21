// Preferências de tela de cada pessoa: o que ela escolheu da última vez (ex.: ver as tarefas em quadro) volta igual na próxima,
// no computador e no celular. Ficam em `users.prefs` (JSONB) e chegam na sessão, sem consulta a mais por página.
const db = require('../db/pool');

const get = (user, key, fallback = null) => (user && user.prefs && user.prefs[key] != null ? user.prefs[key] : fallback);

// Grava só quando mudou (a tela é lida muitas vezes e gravada quase nunca). Falha de gravação nunca derruba a página.
async function set(user, key, value) {
  if (!user || get(user, key) === value) return;
  user.prefs = { ...(user.prefs || {}), [key]: value };
  try {
    await db.query('UPDATE users SET prefs = coalesce(prefs, \'{}\'::jsonb) || jsonb_build_object($2::text, $3::text) WHERE id = $1', [user.id, key, value]);
  } catch (err) {
    console.error('preferência não salva:', err.message);
  }
}

module.exports = { get, set };
