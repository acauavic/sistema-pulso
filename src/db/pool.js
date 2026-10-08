const { Pool } = require('pg');
const config = require('../config');

let pool;

function getPool() {
  if (!pool) pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  return pool;
}

module.exports = {
  getPool,
  query: (text, params) => getPool().query(text, params),
  async close() {
    if (pool) await pool.end();
    pool = null;
  },
};
