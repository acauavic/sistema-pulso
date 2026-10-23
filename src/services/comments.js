// Comentários em convidados, patrocinadores, episódios, cortes e tarefas. Menção com @Nome avisa a pessoa;
// quem é responsável pelo item e quem já comentou também recebe a notificação.
const db = require('../db/pool');
const { notify } = require('./notify');
const { can } = require('../permissions');
const richText = require('./richText');

// Cada tipo de item: como achar, quem é o responsável, o título e o endereço, e quem pode ver.
const ENTITIES = {
  guest: { perm: 'guests.read', label: 'convidado', load: (id) => q1('SELECT id, name AS title, owner_id AS responsible FROM guests WHERE id = $1', [id]), url: (id) => `/convidados/${id}#comentarios` },
  sponsor: { perm: 'sponsors.read', label: 'patrocinador', load: (id) => q1('SELECT id, company AS title, owner_id AS responsible FROM sponsors WHERE id = $1', [id]), url: (id) => `/patrocinadores/${id}#comentarios` },
  episode: { perm: 'episodes.read', label: 'episódio', load: (id) => q1("SELECT id, coalesce('EP.' || lpad(number::text, 3, '0') || ' · ', '') || title AS title, editor_id AS responsible FROM episodes WHERE id = $1", [id]), url: (id) => `/episodios/${id}#comentarios` },
  clip: { perm: 'episodes.read', label: 'corte', load: (id) => q1('SELECT id, title, created_by AS responsible FROM episode_clips WHERE id = $1', [id]), url: (id) => `/cortes/${id}#comentarios` },
  task: { perm: 'tasks.read', label: 'tarefa', load: (id) => q1('SELECT id, title, assignee_id AS responsible, created_by AS creator FROM tasks WHERE id = $1', [id]), url: (id) => `/tarefas/${id}#comentarios` },
};
async function q1(sql, params) { const { rows } = await db.query(sql, params); return rows[0] || null; }

const isEntity = (type) => Object.prototype.hasOwnProperty.call(ENTITIES, type);
const canSee = (role, type) => isEntity(type) && can(role, ENTITIES[type].perm);

// @Nome: procura os nomes das pessoas ativas no texto (o nome completo ou o primeiro nome, se for único).
async function findMentions(body) {
  if (!body.includes('@')) return [];
  const { rows: users } = await db.query('SELECT id, name FROM users WHERE active');
  const text = body.toLocaleLowerCase('pt-BR');
  const firsts = {};
  for (const u of users) { const f = u.name.split(/\s+/)[0].toLocaleLowerCase('pt-BR'); firsts[f] = (firsts[f] || 0) + 1; }
  const hit = (needle) => { const i = text.indexOf(`@${needle}`); if (i < 0) return false; const after = text[i + needle.length + 1]; return !after || !/[\p{L}\p{N}]/u.test(after); };
  return users.filter((u) => {
    const full = u.name.toLocaleLowerCase('pt-BR'); const first = full.split(/\s+/)[0];
    return hit(full) || (firsts[first] === 1 && hit(first));
  }).map((u) => u.id);
}

async function list(type, id) {
  const { rows } = await db.query(
    `SELECT c.*, u.name AS author_name FROM comments c LEFT JOIN users u ON u.id = c.author_id
      WHERE c.entity_type = $1 AND c.entity_id = $2 ORDER BY c.created_at, c.id`, [type, id]);
  const files = await require('./attachments').forComments(rows.map((c) => c.id));
  return rows.map((c) => ({ ...c, attachments: files[c.id] || [] }));
}

// html: comentário do editor rico (limpo aqui); attachmentIds: áudios e documentos enviados antes (imagens do texto entram sozinhas).
async function add({ type, id, author, body, html = null, attachmentIds = [] }) {
  if (!isEntity(type)) return { error: 'Tipo de item desconhecido.' };
  if (!canSee(author.role, type)) return { error: 'Sem acesso a este item.', status: 403 };
  const rich = html != null && String(html).trim() ? richText.sanitize(html) : null;
  const text = rich ? rich.text.slice(0, 4000) : String(body || '').replace(/\r/g, '').trim().slice(0, 4000);
  const ids = [...(rich ? rich.attachmentIds : []), ...[].concat(attachmentIds || [])];
  if (!text && !ids.length && !(rich && rich.html)) return { error: 'Escreva o comentário.' };
  const entity = await ENTITIES[type].load(id);
  if (!entity) return { error: 'Item não encontrado.', status: 404 };
  const mentions = await findMentions(text);
  const { rows: [comment] } = await db.query(
    'INSERT INTO comments (entity_type, entity_id, author_id, body, body_html, mentions) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [type, entity.id, author.id, text, rich ? rich.html || null : null, mentions]);
  const linked = ids.length ? await require('./attachments').link(ids, 'comment', comment.id, author) : 0;
  const { rows: [audio] } = linked ? await db.query("SELECT transcript FROM attachments WHERE entity_type = 'comment' AND entity_id = $1 AND kind = 'audio' ORDER BY id LIMIT 1", [comment.id]) : { rows: [] };
  const said = text || (audio ? `Áudio: ${audio.transcript || '(sem transcrição)'}` : 'Enviou um anexo.');
  const { rows: before } = await db.query('SELECT DISTINCT author_id FROM comments WHERE entity_type = $1 AND entity_id = $2 AND id <> $3 AND author_id IS NOT NULL', [type, entity.id, comment.id]);
  const def = ENTITIES[type];
  const url = def.url(entity.id);
  const preview = said.length > 160 ? `${said.slice(0, 157)}…` : said;
  // quem foi mencionado recebe "mencionou você"; os outros (responsável, quem criou, quem já comentou) recebem "comentou"
  await notify({ type: 'comentario', users: mentions, title: `${author.name} mencionou você em ${def.label}: ${entity.title}`, body: preview, url, actorId: author.id, entity: { type, id: entity.id }, dedupe: `comment-${comment.id}` });
  const others = [entity.responsible, entity.creator, ...before.map((r) => r.author_id)].filter((u) => u && !mentions.includes(u));
  await notify({ type: 'comentario', users: others, title: `${author.name} comentou em ${def.label}: ${entity.title}`, body: preview, url, actorId: author.id, entity: { type, id: entity.id }, dedupe: `comment-${comment.id}` });
  return { comment: { ...comment, author_name: author.name } };
}

// Apaga: quem escreveu, ou a gestão.
async function remove(commentId, user) {
  const { rows: [c] } = await db.query('SELECT * FROM comments WHERE id = $1', [commentId]);
  if (!c) return { error: 'Comentário não encontrado.', status: 404 };
  if (String(c.author_id) !== String(user.id) && !can(user.role, 'tasks.manage')) return { error: 'Só quem escreveu pode apagar.', status: 403 };
  await db.query('DELETE FROM comments WHERE id = $1', [c.id]);
  return { ok: true, comment: c };
}

// Prepara o novo conteúdo de um comentário editado (comum 'comment' ou da revisão do vídeo 'review'): limpa o HTML, liga os
// anexos novos, apaga os que a pessoa tirou (removeIds) e as imagens que saíram do texto. Devolve { text, html } ou { error }.
async function prepareEdit({ attType, commentId, user, body, html, attachmentIds = [], removeIds = [], maxLength = 4000 }) {
  const attachments = require('./attachments');
  const rich = html != null && String(html).trim() ? richText.sanitize(html) : null;
  const text = rich ? rich.text.slice(0, maxLength) : String(body || '').replace(/\r/g, '').trim().slice(0, maxLength);
  const kept = await attachments.forEntity(attType, commentId);
  const dropIds = new Set([].concat(removeIds || []).map(Number));
  const newIds = [...(rich ? rich.attachmentIds : []), ...[].concat(attachmentIds || [])];
  const stays = kept.filter((a) => !dropIds.has(Number(a.id)) && !(a.kind === 'image' && !(rich ? rich.attachmentIds : []).map(Number).includes(Number(a.id))));
  if (!text && !stays.length && !newIds.length && !(rich && rich.html)) return { error: 'Escreva o comentário.' };
  await attachments.link(newIds, attType, commentId, user);
  for (const a of kept.filter((x) => !stays.includes(x))) await attachments.remove(a);
  return { text, html: rich ? rich.html || null : null };
}

// Edita: só quem escreveu. Quem foi mencionado agora (e antes não era) recebe o aviso de menção.
async function update(commentId, user, { body, html = null, attachmentIds = [], removeIds = [] }) {
  const { rows: [c] } = await db.query('SELECT * FROM comments WHERE id = $1', [commentId]);
  if (!c) return { error: 'Comentário não encontrado.', status: 404 };
  if (String(c.author_id) !== String(user.id)) return { error: 'Só quem escreveu pode editar.', status: 403 };
  if (!canSee(user.role, c.entity_type)) return { error: 'Sem acesso a este item.', status: 403 };
  const edit = await prepareEdit({ attType: 'comment', commentId: c.id, user, body, html, attachmentIds, removeIds });
  if (edit.error) return edit;
  const mentions = await findMentions(edit.text);
  const { rows: [comment] } = await db.query(
    'UPDATE comments SET body = $2, body_html = $3, mentions = $4, edited_at = now() WHERE id = $1 RETURNING *', [c.id, edit.text, edit.html, mentions]);
  const fresh = mentions.filter((m) => !(c.mentions || []).map(String).includes(String(m)));
  if (fresh.length) {
    const def = ENTITIES[c.entity_type]; const entity = await def.load(c.entity_id);
    if (entity) {
      const said = edit.text || 'Comentário editado.';
      await notify({ type: 'comentario', users: fresh, title: `${user.name} mencionou você em ${def.label}: ${entity.title}`, body: said.length > 160 ? `${said.slice(0, 157)}…` : said, url: def.url(entity.id), actorId: user.id, entity: { type: c.entity_type, id: entity.id }, dedupe: `comment-${c.id}-edit` });
    }
  }
  return { ok: true, comment };
}

module.exports = { ENTITIES, isEntity, canSee, findMentions, list, add, update, prepareEdit, remove };
