// Rotinas do sistema (publicar agendados, automações, avisos de tarefas, limpeza…). Com várias réplicas, cada rotina roda em
// um processo por vez: trava consultiva do Postgres (pg_try_advisory_lock) — quem não pega a trava pula a volta.
// A última execução de cada rotina fica em `scheduler_runs` (Gestão > Sistema mostra).
const os = require('os');
const db = require('../db/pool');

const tasks = [];
const timers = [];
const every = (name, ms, fn, { delayMs = 5000 } = {}) => tasks.push({ name, ms, fn, delayMs });

// Roda a rotina se ninguém estiver rodando a mesma agora. Devolve true se rodou.
async function runOnce(name, fn) {
  const client = await db.getPool().connect();
  let locked = false;
  try {
    ({ rows: [{ locked }] } = await client.query("SELECT pg_try_advisory_lock(hashtext('pulso:' || $1)) AS locked", [name]));
    if (!locked) return false;
    await db.query(`INSERT INTO scheduler_runs (name, started_at, runs) VALUES ($1, now(), 1)
                    ON CONFLICT (name) DO UPDATE SET started_at = now(), runs = scheduler_runs.runs + 1`, [name]);
    try {
      await fn();
      await db.query('UPDATE scheduler_runs SET finished_at = now(), ok = true, error = NULL WHERE name = $1', [name]);
    } catch (err) {
      console.error(`[rotina ${name}]`, err.message);
      await db.query('UPDATE scheduler_runs SET finished_at = now(), ok = false, error = $2 WHERE name = $1', [name, String(err.message).slice(0, 500)]);
    }
    return true;
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('pulso:' || $1))", [name]).catch(() => {});
    client.release();
  }
}

// Sinal de vida deste processo (Gestão > Sistema mostra quem está rodando a fila e as rotinas).
const beat = (role, info = {}) => db.query(
  `INSERT INTO worker_heartbeats (worker, role, info) VALUES ($1, $2, $3)
   ON CONFLICT (worker) DO UPDATE SET seen_at = now(), role = EXCLUDED.role, info = EXCLUDED.info`,
  [`${os.hostname()}:${process.pid}`, role, JSON.stringify(info)]).catch((err) => console.error('heartbeat:', err.message));

function start({ role = 'worker' } = {}) {
  for (const t of tasks) {
    const run = () => runOnce(t.name, t.fn).catch((err) => console.error(`[rotina ${t.name}]`, err.message));
    timers.push(setTimeout(run, t.delayMs).unref(), setInterval(run, t.ms).unref());
  }
  beat(role, { tasks: tasks.map((t) => t.name) });
  timers.push(setInterval(() => beat(role, { tasks: tasks.map((t) => t.name) }), 30_000).unref());
}
// Ao encerrar: para as rotinas e tira este processo da lista (não fica "parado" na tela de Sistema).
const stop = async () => {
  while (timers.length) clearTimeout(timers.pop());
  await db.query('DELETE FROM worker_heartbeats WHERE worker = $1', [`${os.hostname()}:${process.pid}`]).catch(() => {});
};

module.exports = { every, runOnce, start, stop, beat, tasks };
