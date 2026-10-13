// Notificações do painel: tarefas, comentários, agendamentos concluídos e rotinas do sistema.
// Respeita a configuração geral (gestão) e o que cada pessoa silenciou. Nunca avisa a própria pessoa que fez a ação.
const db = require('../db/pool');
const config = require('../config');
const mailer = require('./mailer');
const { NOTIFICATION_TYPES } = require('../constants');
const jobs = require('./jobs');
const realtime = require('./realtime');

const TYPES = Object.keys(NOTIFICATION_TYPES);

async function settings() {
  const { rows } = await db.query('SELECT * FROM notification_settings');
  const out = Object.fromEntries(TYPES.map((t) => [t, { type: t, in_app: true, email: false, roles: [] }]));
  for (const r of rows) out[r.type] = r;
  return out;
}

// Pessoas ativas com estes papéis (para os avisos gerais: agendamento, rotinas).
async function usersWithRoles(roles) {
  if (!roles?.length) return [];
  const { rows } = await db.query('SELECT id FROM users WHERE active AND role = ANY($1)', [roles]);
  return rows.map((r) => r.id);
}

// Cria as notificações. users: ids (repetidos e nulos são ignorados). broadcast: soma quem tem os papéis configurados para o tipo.
// dedupe: mesma chave para a mesma pessoa não duplica (ex.: "tarefa vence hoje" uma vez por dia).
async function notify({ type, users = [], broadcast = false, title, body = null, url = null, actorId = null, entity = null, dedupe = null }) {
  if (!TYPES.includes(type)) throw new Error(`Tipo de notificação desconhecido: ${type}`);
  const cfg = (await settings())[type];
  if (!cfg.in_app && !cfg.email) return [];
  let ids = [...users];
  if (broadcast) ids.push(...(await usersWithRoles(cfg.roles)));
  ids = [...new Set(ids.filter(Boolean).map(String))].filter((id) => id !== String(actorId || ''));
  if (!ids.length) return [];
  const { rows: active } = await db.query(
    `SELECT u.id, u.email, u.name FROM users u WHERE u.active AND u.id = ANY($1::uuid[])
       AND NOT EXISTS (SELECT 1 FROM notification_mutes m WHERE m.user_id = u.id AND m.type = $2)`, [ids, type]);
  const created = [];
  for (const u of active) {
    const { rows: [n] } = await db.query(
      `INSERT INTO notifications (user_id, type, title, body, url, actor_id, entity_type, entity_id, dedupe_key, read_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $10 THEN NULL ELSE now() END)
       ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING *`,
      [u.id, type, String(title).slice(0, 300), body ? String(body).slice(0, 1000) : null, url, actorId, entity?.type || null, entity?.id || null, dedupe, cfg.in_app]);
    if (!n) continue;
    created.push(n);
    // e-mail vai pela fila (com novas tentativas), fora da requisição
    if (cfg.email && u.email) await jobs.enqueue('email_notificacao', { refId: n.id, maxAttempts: 5 });
  }
  // aviso na hora para quem está com o painel aberto (badge + aviso flutuante)
  for (const n of created.filter((x) => !x.read_at)) await realtime.publish([n.user_id], { type: 'notification', id: n.id, kind: n.type, title: n.title, body: n.body, url: n.url ? `/notificacoes/${n.id}/abrir` : null });
  return created;
}

jobs.register('email_notificacao', async (job) => {
  const { rows: [n] } = await db.query('SELECT n.*, u.email FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.id = $1 AND u.active', [job.ref_id]);
  if (!n || n.emailed_at || !n.email) return { skipped: true };
  await mailer.sendNotification({ to: n.email, title: n.title, text: n.body || '', url: n.url ? `${config.appBaseUrl}${n.url}` : null });
  await db.query('UPDATE notifications SET emailed_at = now() WHERE id = $1', [n.id]);
  return { sent: true };
});

const unreadCount = (userId) => db.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId]).then((r) => r.rows[0].n);

async function list(userId, { type = null, unread = false, limit = 50, before = null } = {}) {
  const params = [userId]; const where = ['n.user_id = $1'];
  if (type && TYPES.includes(type)) { params.push(type); where.push(`n.type = $${params.length}`); }
  if (unread) where.push('n.read_at IS NULL');
  if (before) { params.push(before); where.push(`n.id < $${params.length}`); }
  params.push(Math.min(200, limit));
  const { rows } = await db.query(
    `SELECT n.*, a.name AS actor_name FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
      WHERE ${where.join(' AND ')} ORDER BY n.created_at DESC, n.id DESC LIMIT $${params.length}`, params);
  return rows;
}

const markRead = (userId, id) => db.query('UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING *', [id, userId]).then((r) => r.rows[0] || null);
const markAllRead = (userId, type = null) => db.query(
  `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL ${type && TYPES.includes(type) ? 'AND type = $2' : ''}`, type && TYPES.includes(type) ? [userId, type] : [userId]);

module.exports = { TYPES, settings, notify, unreadCount, list, markRead, markAllRead, usersWithRoles };
