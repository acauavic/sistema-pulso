// "Bolinha" de responsável (como no ClickUp): troca quem cuida de um convidado, patrocinador, episódio (editor) ou tarefa.
const db = require('../db/pool');
const { can } = require('../permissions');
const { notify } = require('./notify');

const TYPES = {
  guest: { perm: 'guests.write', table: 'guests', col: 'owner_id', title: 'name', label: 'convidado', url: (id) => `/convidados/${id}`, notifType: 'comentario', what: 'responsável pelo convidado' },
  sponsor: { perm: 'sponsors.write', table: 'sponsors', col: 'owner_id', title: 'company', label: 'patrocinador', url: (id) => `/patrocinadores/${id}`, notifType: 'comentario', what: 'responsável pelo patrocinador' },
  episode: { perm: 'production.manage', table: 'episodes', col: 'editor_id', title: 'title', label: 'episódio', url: (id) => `/episodios/${id}`, notifType: 'tarefa', what: 'editor do episódio' },
  task: { perm: 'tasks.write', table: 'tasks', col: 'assignee_id', title: 'title', label: 'tarefa', url: (id) => `/tarefas/${id}`, notifType: 'tarefa', what: 'responsável pela tarefa' },
};

// Quem pode trocar: o papel com a permissão do tipo. Tarefa: a gestão troca qualquer uma; os outros só as que criaram ou que são deles.
async function setResponsible({ type, id, userId, actor }) {
  const def = TYPES[type];
  if (!def) return { error: 'Tipo inválido.', status: 400 };
  if (!can(actor.role, def.perm)) return { error: 'Seu perfil não troca o responsável deste item.', status: 403 };
  const { rows: [item] } = await db.query(`SELECT * FROM ${def.table} WHERE id = $1`, [id]);
  if (!item) return { error: 'Item não encontrado.', status: 404 };
  if (type === 'task' && !can(actor.role, 'tasks.manage') && ![item.created_by, item.assignee_id].map(String).includes(String(actor.id))) {
    return { error: 'Você só reatribui tarefas que criou ou que são suas.', status: 403 };
  }
  let user = null;
  if (userId) {
    ({ rows: [user] } = await db.query('SELECT id, name, role FROM users WHERE id = $1 AND active', [userId]));
    if (!user) return { error: 'Pessoa não encontrada ou inativa.', status: 400 };
    if (type === 'episode' && !['editor_video', 'gestao', 'superadmin'].includes(user.role)) return { error: 'O editor do episódio precisa ser do time de edição ou da gestão.', status: 400 };
  }
  await db.query(`UPDATE ${def.table} SET ${def.col} = $2${['guests', 'sponsors', 'episodes', 'tasks'].includes(def.table) ? ', updated_at = now()' : ''} WHERE id = $1`, [id, user ? user.id : null]);
  if (type === 'episode' && user) { // tarefas de rotina "do editor" que ainda estavam sem ninguém passam para o novo editor
    await db.query(`UPDATE tasks t SET assignee_id = $2, updated_at = now() FROM task_routines r
                     WHERE t.routine_id = r.id AND r.assignee_mode = 'editor' AND t.episode_id = $1 AND t.assignee_id IS NULL AND t.status <> 'feito'`, [id, user.id]);
  }
  if (user && String(user.id) !== String(item[def.col] || '')) {
    await notify({ type: def.notifType, users: [user.id], title: `${actor.name} colocou você como ${def.what}: ${item[def.title]}`, url: def.url(id), actorId: actor.id, entity: { type, id: Number(id) } });
  }
  return { ok: true, user };
}

module.exports = { TYPES, setResponsible };
