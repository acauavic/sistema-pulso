// Limitador de tentativas guardado no Postgres (tabela rate_hits): vale para todas as réplicas do painel ao mesmo tempo.
// Cada limitador tem um nome (bucket); a chave costuma ser o IP ou o e-mail. A limpeza das linhas velhas é uma rotina do sistema.
const db = require('../db/pool');

function createLimiter({ name, max, windowMs }) {
  if (!name) throw new Error('createLimiter: informe o nome do limitador');
  const win = String(windowMs);
  const count = async (key) => (await db.query(
    "SELECT count(*)::int AS n FROM rate_hits WHERE bucket = $1 AND key = $2 AND at > now() - ($3 || ' milliseconds')::interval", [name, String(key), win])).rows[0].n;
  return {
    // true = pode seguir; false = bloqueado (registra a tentativa)
    async hit(key) {
      await db.query('INSERT INTO rate_hits (bucket, key) VALUES ($1, $2)', [name, String(key)]);
      return (await count(key)) <= max;
    },
    // true = já estourou o limite (não registra nova tentativa)
    async blocked(key) { return (await count(key)) >= max; },
    async reset(key) { await db.query('DELETE FROM rate_hits WHERE bucket = $1 AND key = $2', [name, String(key)]); },
  };
}

// Rotina: apaga tentativas com mais de 1 dia (nenhum limitador olha tão longe).
const purge = () => db.query("DELETE FROM rate_hits WHERE at < now() - interval '1 day'");

module.exports = { createLimiter, purge };
