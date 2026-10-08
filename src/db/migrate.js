const fs = require('fs');
const path = require('path');
const { getPool, close } = require('./pool');

const DIR = path.join(__dirname, 'migrations');
const LOCK_ID = 7_340_001; // advisory lock: evita 2 réplicas migrando juntas

async function migrate() {
  const client = await getPool().connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
    const applied = [];
    for (const file of files) {
      if (done.has(file)) continue;
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(DIR, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} falhou: ${err.message}`);
      }
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

module.exports = { migrate };

if (require.main === module) {
  require('../config').assertConfig();
  migrate()
    .then((applied) => console.log(applied.length ? `Migrations aplicadas: ${applied.join(', ')}` : 'Banco já atualizado.'))
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(close);
}
