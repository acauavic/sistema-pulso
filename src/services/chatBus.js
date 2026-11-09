// Ligação com o RabbitMQ das mensagens. Só carrega códigos (qual conversa, qual mensagem, para quem): o texto fica no Postgres.
// - evento.*: cada cópia do painel tem a sua fila temporária e entrega para as abas abertas.
// - tarefa.*: fila durável, consumida pelo worker (avisos e resumos). Só sai da fila depois de confirmada;
//   falhou 5 vezes, vai para pulso.chat.mortas (a contagem aparece em Integrações).
// - espera.*: fila com prazo: a mensagem fica 20 s e cai em tarefa.aviso (quem leu nesse tempo não recebe aviso).
const os = require('os');
const crypto = require('crypto');
const amqp = require('amqplib');
const config = require('../config');

const EXCHANGE = 'pulso.chat';
const DEAD_EXCHANGE = 'pulso.chat.mortas';
const Q_TASKS = 'pulso.chat.tarefas';
const Q_WAIT = 'pulso.chat.espera';
const Q_DEAD = 'pulso.chat.mortas';
const WAIT_MS = 20_000;
const CONFIRM_MS = 5_000;
const DELIVERY_LIMIT = 5;

let url = null;
let conn = null;
let pub = null;
let handlers = {};
let connected = false;
let stopping = false;
let retryTimer = null;
let retryMs = 1000;
let connecting = null;

const isConfigured = () => Boolean(url || config.rabbit.url);
const isConnected = () => connected && Boolean(pub);
const safeError = (err) => String(err?.message || err).replace(/amqps?:\/\/[^@\s]+@/g, 'amqp://***@'); // o log nunca mostra a senha

async function topology(ch) {
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertExchange(DEAD_EXCHANGE, 'fanout', { durable: true });
  await ch.assertQueue(Q_DEAD, { durable: true });
  await ch.bindQueue(Q_DEAD, DEAD_EXCHANGE, '');
  await ch.assertQueue(Q_TASKS, { durable: true, arguments: { 'x-queue-type': 'quorum', 'x-delivery-limit': DELIVERY_LIMIT, 'x-dead-letter-exchange': DEAD_EXCHANGE } });
  await ch.bindQueue(Q_TASKS, EXCHANGE, 'tarefa.#');
  await ch.assertQueue(Q_WAIT, { durable: true, arguments: { 'x-message-ttl': WAIT_MS, 'x-dead-letter-exchange': EXCHANGE, 'x-dead-letter-routing-key': 'tarefa.aviso' } });
  await ch.bindQueue(Q_WAIT, EXCHANGE, 'espera.#');
}

const decode = (msg) => JSON.parse(msg.content.toString('utf8'));

async function consumeLive(fn) {
  const ch = await conn.createChannel();
  await ch.prefetch(32);
  const q = `pulso.chat.vivo.${os.hostname()}.${process.pid}.${crypto.randomBytes(3).toString('hex')}`;
  await ch.assertQueue(q, { exclusive: true, autoDelete: true, arguments: { 'x-message-ttl': 60_000 } });
  await ch.bindQueue(q, EXCHANGE, 'evento.#');
  await ch.consume(q, async (msg) => {
    if (!msg) return;
    try { await fn(msg.fields.routingKey, decode(msg)); } catch (err) { console.error('[mensagens] entrega ao vivo:', safeError(err)); }
    try { ch.ack(msg); } catch { /* canal fechou: o Rabbit reentrega ou o navegador busca ao reconectar */ }
  });
}

async function consumeTasks(fn) {
  const ch = await conn.createChannel();
  await ch.prefetch(8);
  await ch.consume(Q_TASKS, async (msg) => {
    if (!msg) return;
    try {
      await fn(msg.fields.routingKey, decode(msg));
      ch.ack(msg);
    } catch (err) {
      console.error('[mensagens] tarefa falhou, volta para a fila:', safeError(err));
      try { ch.nack(msg, false, true); } catch { /* canal fechou: o Rabbit reentrega */ }
    }
  });
}

function schedule() {
  if (stopping || retryTimer || !isConfigured()) return;
  retryTimer = setTimeout(() => { retryTimer = null; connect(); }, retryMs);
  retryTimer.unref?.();
  retryMs = Math.min(retryMs * 2, 30_000);
}

function dropped(from) {
  if (conn !== from) return;
  connected = false; pub = null; conn = null;
  schedule();
}

function connect() {
  if (connecting || stopping || !isConfigured()) return connecting;
  connecting = (async () => {
    let c = null;
    try {
      c = await amqp.connect(url || config.rabbit.url, { heartbeat: 30, timeout: 10_000, clientProperties: { connection_name: `pulso-${os.hostname()}` } });
      c.on('error', (err) => console.error('[mensagens] RabbitMQ:', safeError(err)));
      c.on('close', () => dropped(c));
      const ch = await c.createConfirmChannel();
      ch.on('error', (err) => console.error('[mensagens] canal do RabbitMQ:', safeError(err)));
      await topology(ch);
      conn = c; pub = ch;
      if (handlers.live) await consumeLive(handlers.live);
      if (handlers.tasks) await consumeTasks(handlers.tasks);
      connected = true; retryMs = 1000;
      console.log('[mensagens] RabbitMQ conectado.');
      handlers.onConnect?.();
    } catch (err) {
      console.error('[mensagens] sem RabbitMQ (segue pelo Postgres e tenta de novo):', safeError(err));
      connected = false; pub = null; conn = null;
      if (c) c.close().catch(() => {});
      schedule();
    } finally { connecting = null; }
  })();
  return connecting;
}

// live(routingKey, evento) nas cópias do painel; tasks(routingKey, evento) no worker.
async function start(opts = {}) {
  const { url: override, ...rest } = opts;
  url = override || null; handlers = rest; stopping = false; retryMs = 1000;
  if (isConfigured()) await connect();
}

async function stop() {
  stopping = true;
  clearTimeout(retryTimer); retryTimer = null;
  const c = conn; conn = null; pub = null; connected = false;
  if (c) await c.close().catch(() => {});
}

// Resolve quando o Rabbit confirma que guardou; rejeita se não confirmar a tempo.
function publish(routingKey, event) {
  return new Promise((resolve, reject) => {
    if (!pub) { reject(new Error('RabbitMQ desconectado')); return; }
    const timer = setTimeout(() => reject(new Error('RabbitMQ não confirmou a tempo')), CONFIRM_MS);
    try {
      pub.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(event)), { persistent: true, contentType: 'application/json', messageId: String(event.id) }, (err) => {
        clearTimeout(timer);
        if (err) reject(err); else resolve();
      });
    } catch (err) { clearTimeout(timer); reject(err); }
  });
}

async function status() {
  const out = { configured: isConfigured(), connected: isConnected(), dead: null };
  if (out.connected) { try { out.dead = (await pub.checkQueue(Q_DEAD)).messageCount; } catch { /* mostra sem a contagem */ } }
  return out;
}

module.exports = { EXCHANGE, Q_TASKS, Q_WAIT, Q_DEAD, WAIT_MS, start, stop, publish, isConfigured, isConnected, status };
