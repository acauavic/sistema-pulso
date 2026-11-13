// Publica o que a transação das mensagens deixou na chat_outbox. Regra: tenta o RabbitMQ (com confirmação); sem ele, entrega pelo
// Postgres (pg_notify e a fila de trabalhos) para o chat nunca parar. Publicar duas vezes é inofensivo: quem recebe ignora o repetido.
const db = require('../db/pool');
const bus = require('./chatBus');
const realtime = require('./realtime');
const jobs = require('./jobs');

const TOPIC = 'chat';
let running = null;
let again = false;
let timer = null;

async function fallback(routingKey, event) {
  if (routingKey.startsWith('evento.')) { await realtime.broadcast(TOPIC, { routingKey, event }); return; }
  const task = routingKey.startsWith('espera.') ? 'tarefa.aviso' : routingKey;
  await jobs.enqueue('chat_tarefa', { refId: event.id, payload: { routingKey: task, event }, maxAttempts: 5, delayMs: routingKey.startsWith('espera.') ? bus.WAIT_MS : 0 });
}

let transport = async (routingKey, event) => {
  if (bus.isConnected()) {
    try { await bus.publish(routingKey, event); return 'rabbit'; } catch (err) { console.error('[mensagens] RabbitMQ não confirmou, segue pelo Postgres:', err.message); }
  }
  await fallback(routingKey, event);
  return 'postgres';
};
const setTransport = (fn) => { const previous = transport; transport = fn; return previous; };

async function publishBatch(limit) {
  const client = await db.getPool().connect();
  let count = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM chat_outbox WHERE published_at IS NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED', [limit]);
    for (const row of rows) {
      try {
        const via = await transport(row.routing_key, { id: Number(row.id), ...row.payload });
        await client.query('UPDATE chat_outbox SET published_at = now(), via = $2, attempts = attempts + 1, last_error = NULL WHERE id = $1', [row.id, via]);
        count += 1;
      } catch (err) {
        await client.query('UPDATE chat_outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1', [row.id, String(err.message).slice(0, 300)]);
        break; // fica para a próxima volta, na ordem
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
  return count;
}

// Publica tudo o que estiver pendente; devolve quantos foram.
async function tick() {
  let total = 0;
  for (;;) {
    const n = await publishBatch(100);
    total += n;
    if (n < 100) return total;
  }
}

// Depois do COMMIT: publica na hora (sem esperar a volta do relógio). Chamadas durante uma publicação viram mais uma volta.
function kick() {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do { again = false; await tick(); } while (again);
    } catch (err) { console.error('[mensagens] publicar:', err.message); } finally { running = null; }
  })();
  return running;
}
const drain = async () => { while (running) await running; };

// Rede de segurança: pega o que ficou para trás (processo caiu entre o COMMIT e a publicação, falha passageira).
function start(everyMs = 3000) {
  if (timer) return;
  timer = setInterval(kick, everyMs);
  timer.unref?.();
}
function stop() { clearInterval(timer); timer = null; }

module.exports = { TOPIC, tick, kick, drain, start, stop, setTransport, fallback };
