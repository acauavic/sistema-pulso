// Web Push: alertas no navegador/celular mesmo com o painel fechado. As chaves VAPID vêm do ambiente
// (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY; gere com `npx web-push generate-vapid-keys`). Sem elas, o push fica desligado
// e o painel continua avisando só com a aba aberta.
const webpush = require('web-push');
const db = require('../db/pool');
const config = require('../config');
const jobs = require('./jobs');

const configured = () => Boolean(config.push.publicKey && config.push.privateKey);
let vapidFor = '';
function ensureVapid() {
  if (vapidFor === config.push.publicKey) return;
  webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);
  vapidFor = config.push.publicKey;
}

const B64URL = /^[A-Za-z0-9_-]+=*$/;
// O servidor chama o endereço que o navegador informa: só aceitamos os serviços de push dos navegadores (Chrome, Edge, Firefox,
// Safari, Opera e Brave usam o do Google), para ninguém apontar o servidor para um endereço interno.
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com', 'push.apple.com', 'notify.windows.com'];
const allowedHost = (host) => PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

// Guarda (ou move para esta pessoa) a inscrição do aparelho. Devolve null se os dados não parecem uma inscrição válida.
async function subscribe(userId, sub, userAgent = '') {
  const endpoint = String(sub?.endpoint || '');
  const p256dh = String(sub?.keys?.p256dh || '');
  const auth = String(sub?.keys?.auth || '');
  let url;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || !allowedHost(url.hostname.toLowerCase()) || endpoint.length > 1000 || !B64URL.test(p256dh) || !B64URL.test(auth) || p256dh.length > 200 || auth.length > 100) return null;
  const { rows: [row] } = await db.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent, failures = 0
     RETURNING id`, [userId, endpoint, p256dh, auth, String(userAgent).slice(0, 300)]);
  return row;
}

const unsubscribe = (userId, endpoint) => db.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, String(endpoint || '')]);
const countFor = (userId) => db.query('SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1', [userId]).then((r) => r.rows[0].n);

// Envia para todos os aparelhos da pessoa. Aparelho que o serviço diz não existir mais (404/410) é apagado.
async function sendToUser(userId, payload) {
  if (!configured()) return { sent: 0, skipped: 'sem chaves VAPID' };
  ensureVapid();
  const { rows } = await db.query('SELECT * FROM push_subscriptions WHERE user_id = $1', [userId]);
  let sent = 0;
  for (const s of rows) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 12 * 3600, urgency: 'normal' });
      await db.query('UPDATE push_subscriptions SET last_ok_at = now(), failures = 0 WHERE id = $1', [s.id]);
      sent += 1;
    } catch (err) {
      if ([404, 410].includes(err.statusCode)) await db.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
      else await db.query('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = $1', [s.id]);
      if (![404, 410].includes(err.statusCode)) console.error('Push:', err.statusCode || '', err.body || err.message);
    }
  }
  await db.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND failures >= 20', [userId]); // aparelho que só falha
  return { sent };
}

const payloadFor = (n) => ({ id: String(n.id), title: n.title, body: n.body || '', url: n.url ? `/notificacoes/${n.id}/abrir` : '/notificacoes', tag: `n-${n.id}` });

// Chamado por notify() para cada notificação nova: vai pela fila (leve), fora da requisição.
async function queue(notification) {
  if (!configured()) return;
  const { rows: [has] } = await db.query('SELECT 1 FROM push_subscriptions WHERE user_id = $1 LIMIT 1', [notification.user_id]);
  if (has) await jobs.enqueue('push_notificacao', { refId: notification.id, maxAttempts: 2 });
}

jobs.register('push_notificacao', async (job) => {
  const { rows: [n] } = await db.query('SELECT n.* FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.id = $1 AND u.active', [job.ref_id]);
  if (!n || n.read_at) return { skipped: true };
  return sendToUser(n.user_id, payloadFor(n));
});

module.exports = { configured, publicKey: () => config.push.publicKey || '', subscribe, unsubscribe, countFor, sendToUser, queue };
