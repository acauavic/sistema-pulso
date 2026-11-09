// Avisos em tempo real para o navegador (Server-Sent Events). Qualquer processo publica com pg_notify; cada réplica web
// escuta o canal (LISTEN) e entrega para as abas abertas de quem é o aviso. Sem Redis: o Postgres já faz o papel de barramento.
const db = require('../db/pool');

const CHANNEL = 'pulso_events';
const clients = new Map(); // userId -> Set(res)
let listener = null;

// Publica para algumas pessoas. event: { type: 'notification' | 'job' | ..., title, body, url, ... }
async function publish(userIds, event) {
  const users = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!users.length) return;
  const payload = JSON.stringify({ users, event });
  if (Buffer.byteLength(payload) > 7500) return; // limite do NOTIFY (~8 KB)
  await db.query('SELECT pg_notify($1, $2)', [CHANNEL, payload]).catch((err) => console.error('tempo real:', err.message));
}

function deliverLocal(users, event) {
  for (const u of users || []) {
    for (const res of clients.get(String(u)) || []) res.write(`event: ${event.type || 'message'}\ndata: ${JSON.stringify(event)}\n\n`);
  }
}

// Recados entre as cópias do painel (ex.: mensagens do chat quando o RabbitMQ não está disponível).
const topics = new Map();
const on = (topic, fn) => topics.set(topic, fn);
async function broadcast(topic, data) {
  const payload = JSON.stringify({ topic, data });
  if (Buffer.byteLength(payload) > 7500) throw new Error('recado grande demais para o NOTIFY');
  await db.query('SELECT pg_notify($1, $2)', [CHANNEL, payload]);
}

function deliver(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (msg.topic) { Promise.resolve(topics.get(msg.topic)?.(msg.data)).catch((err) => console.error('tempo real:', err.message)); return; }
  deliverLocal(msg.users, msg.event);
}
const isConnected = (userId) => clients.has(String(userId));

async function listen() {
  if (listener) return;
  try {
    listener = await db.getPool().connect();
    listener.on('notification', (n) => deliver(n.payload));
    listener.on('error', (err) => { console.error('tempo real (LISTEN):', err.message); listener = null; setTimeout(listen, 5000).unref(); });
    await listener.query(`LISTEN ${CHANNEL}`);
  } catch (err) {
    console.error('tempo real: sem LISTEN (os avisos chegam pela conferência periódica):', err.message);
    listener = null;
  }
}
const stop = () => { if (listener) { listener.release(); listener = null; } for (const set of clients.values()) for (const res of set) res.end(); clients.clear(); };

// GET /eventos: a aba fica conectada; um comentário a cada 25 s mantém a conexão viva atrás do proxy.
function handler(req, res) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 10000\n\n');
  const id = String(req.user.id);
  if (!clients.has(id)) clients.set(id, new Set());
  clients.get(id).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => { clearInterval(ping); clients.get(id)?.delete(res); if (!clients.get(id)?.size) clients.delete(id); });
}

const connectedCount = () => [...clients.values()].reduce((n, s) => n + s.size, 0);

module.exports = { CHANNEL, publish, listen, stop, handler, connectedCount, deliverLocal, on, broadcast, isConnected };
