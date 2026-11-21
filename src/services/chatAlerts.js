// Avisos de mensagem (conversa nova, menção, reação, "adicionou você ao grupo"). NÃO são Notificações do sistema: não entram
// na lista do sino nem no contador de Avisos. Vão para o celular (push, com som e vibração), para o aviso flutuante com som do
// painel aberto e para o contador de Mensagens. Quem decide se avisa é o chat (preferência da pessoa e de cada conversa).
const db = require('../db/pool');
const realtime = require('./realtime');

// Devolve os avisos criados. A mesma chave para a mesma pessoa não avisa de novo (tarefa repetida, reação tirada e posta).
async function alert({ users = [], title, body = null, url = null, actorId = null, dedupe = null }) {
  const ids = [...new Set(users.filter(Boolean).map(String))].filter((id) => id !== String(actorId || ''));
  if (!ids.length) return [];
  const key = dedupe || `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await db.query(
    `INSERT INTO chat_alerts (user_id, dedupe_key, title, body, url, actor_id)
     SELECT u.id, $2, $3, $4, $5, $6 FROM users u WHERE u.active AND u.id = ANY($1::uuid[])
     ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING *`,
    [ids, key, String(title).slice(0, 300), body ? String(body).slice(0, 1000) : null, url, actorId]);
  const push = require('./push');
  for (const a of rows) {
    await push.queueChat(a).catch((err) => console.error('[mensagens] push:', err.message));
    await realtime.publish([a.user_id], { type: 'chat-alert', id: a.id, kind: 'mensagem', title: a.title, body: a.body, url: a.url });
  }
  return rows;
}

const purge = () => db.query("DELETE FROM chat_alerts WHERE created_at < now() - interval '30 days'");

module.exports = { alert, purge };
