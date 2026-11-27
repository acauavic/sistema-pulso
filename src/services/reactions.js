// Reações com emoji nos comentários: os comentários dos itens (kind 'comment') e os da revisão do vídeo (kind 'review').
// Clicar de novo no mesmo emoji tira a reação. Quem escreveu o comentário recebe um aviso (tipo 'reacao', que cada pessoa pode silenciar).
const db = require('../db/pool');
const comments = require('./comments');
const { notify } = require('./notify');

const EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '🙏'];
const COLUMN = { comment: 'comment_id', review: 'review_id' };

// { idDoComentario: [{ emoji, count, users: [{ id, name }] }] }, na ordem da paleta.
async function forComments(kind, ids) {
  if (!COLUMN[kind] || !ids.length) return {};
  const col = COLUMN[kind];
  const { rows } = await db.query(
    `SELECT r.${col} AS cid, r.emoji, r.user_id, u.name FROM comment_reactions r JOIN users u ON u.id = r.user_id
      WHERE r.${col} = ANY($1::int[]) ORDER BY r.created_at, r.id`, [ids]);
  const out = {};
  for (const r of rows) {
    const list = (out[r.cid] ||= []);
    let group = list.find((g) => g.emoji === r.emoji);
    if (!group) { group = { emoji: r.emoji, count: 0, users: [] }; list.push(group); }
    group.count += 1; group.users.push({ id: r.user_id, name: r.name });
  }
  for (const list of Object.values(out)) list.sort((a, b) => EMOJIS.indexOf(a.emoji) - EMOJIS.indexOf(b.emoji));
  return out;
}

// Texto, autor e destino do comentário, conforme o tipo: null se não existe.
async function target(kind, id) {
  if (kind === 'comment') {
    const { rows: [c] } = await db.query('SELECT id, author_id, body, entity_type, entity_id FROM comments WHERE id = $1', [id]);
    if (!c) return null;
    const def = comments.ENTITIES[c.entity_type];
    return { ...c, type: c.entity_type, label: def.label, url: def.url(c.entity_id), load: () => def.load(c.entity_id) };
  }
  const { rows: [c] } = await db.query('SELECT id, author_id, body, episode_id FROM episode_comments WHERE id = $1', [id]);
  if (!c) return null;
  return { ...c, type: 'episode', entity_id: c.episode_id, label: 'revisão do episódio', url: `/episodios/${c.episode_id}#revisao`, load: () => comments.ENTITIES.episode.load(c.episode_id) };
}

const dedupeKey = (kind, id, userId, emoji) => `reaction-${kind}-${id}-${userId}-${emoji}`;

async function toggle({ kind, id, emoji, user }) {
  if (!COLUMN[kind] || !EMOJIS.includes(emoji)) return { error: 'Reação inválida.', status: 400 };
  const t = await target(kind, id);
  if (!t) return { error: 'Comentário não encontrado.', status: 404 };
  if (!comments.canSee(user.role, t.type)) return { error: 'Sem acesso a este item.', status: 403 };
  const col = COLUMN[kind];
  const key = dedupeKey(kind, t.id, user.id, emoji);
  const { rowCount: removed } = await db.query(`DELETE FROM comment_reactions WHERE ${col} = $1 AND user_id = $2 AND emoji = $3`, [t.id, user.id, emoji]);
  if (removed) {
    // clique por engano: o aviso que ninguém leu some junto
    await db.query('DELETE FROM notifications WHERE dedupe_key = $1 AND read_at IS NULL', [key]);
  } else {
    await db.query(`INSERT INTO comment_reactions (${col}, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [t.id, user.id, emoji]);
    const entity = t.author_id ? await t.load() : null;
    if (entity) {
      const said = t.body || 'Comentário com anexo.';
      await notify({
        type: 'reacao', users: [t.author_id], title: `${user.name} reagiu com ${emoji} ao seu comentário em ${t.label}: ${entity.title}`,
        body: said.length > 160 ? `${said.slice(0, 157)}…` : said, url: t.url, actorId: user.id, entity: { type: t.type, id: t.entity_id }, dedupe: key,
      });
    }
  }
  return { ok: true, reactions: (await forComments(kind, [t.id]))[t.id] || [] };
}

module.exports = { EMOJIS, forComments, toggle };
