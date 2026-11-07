const { Pool } = require('pg');
const config = require('../config');
const requestCache = require('../utils/requestCache');

let pool;

function getPool() {
  // Pool de conexões: até 15 por processo (2 cópias do painel + o worker ≈ 45, bem abaixo das 100 do Postgres).
  // Conexão parada 30 s volta ao banco; pedir conexão espera no máximo 15 s (erro claro em vez de travar a página).
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl, max: Number(process.env.DB_POOL_MAX || 15), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000 });
    pool.on('error', (err) => console.error('banco (conexão ociosa):', err.message)); // queda do Postgres não derruba o processo
  }
  return pool;
}

module.exports = {
  getPool,
  // Dentro de uma requisição, cada consulta soma no tempo de banco dela (Server-Timing e Gestão > Desempenho).
  query: (text, params) => {
    const perf = requestCache.perf();
    if (!perf) return getPool().query(text, params);
    const startedAt = Date.now(); const t0 = process.hrtime.bigint();
    return getPool().query(text, params).finally(() => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      perf.dbMs += ms; perf.dbCount += 1;
      if (perf.spans.length < 200) perf.spans.push({ text: String(text).replace(/\s+/g, ' ').slice(0, 300), startedAt, ms });
    });
  },
  async close() {
    if (pool) await pool.end();
    pool = null;
  },
};
