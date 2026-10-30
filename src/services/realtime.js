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

function deliver(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  for (const u of msg.users || []) {
    for (const res of clients.get(u) || []) res.write(`event: ${msg.event.type || 'message'}\ndata: ${JSON.stringify(msg.event)}\n\n`);
  }
}

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

module.exports = { CHANNEL, publish, listen, stop, handler, connectedCount };
