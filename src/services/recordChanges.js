// Avisa o responsável quando outra pessoa altera ou exclui um cadastro (convidado, patrocinador, episódio, corte, tarefa).
// Dois tipos de notificação, cada um configurável na gestão e silenciável por pessoa: "alteracao" e "exclusao".
// O aviso de alteração diz o que mudou; quem fez a ação nunca é avisado (o notify cuida disso).
const db = require('../db/pool');
const { notify } = require('./notify');

const PLACES = {
  guest: {
    table: 'guests', label: 'convidado', art: 'o', title: 'name', responsible: 'owner_id', url: (id) => `/convidados/${id}`,
    fields: {
      name: 'nome', email: 'e-mail', phone: 'telefone', instagram: 'Instagram', profile: 'perfil', invite_reason: 'motivo do convite', company: 'empresa', job_title: 'cargo',
      positioning: 'posicionamento', topic: 'tema', bio: 'bio', notes: 'observações', proposed_at: 'data da gravação', owner_id: 'responsável', status: 'etapa',
      scheduled_studio: 'estúdio', scheduled_hosts: 'hosts', scheduled_guest: 'confirmação do convidado', sponsor_id: 'patrocinador', sponsor_relation: 'relação com o patrocinador',
      loss_reason: 'motivo da perda', loss_note: 'nota da perda',
    },
  },
  sponsor: {
    table: 'sponsors', label: 'patrocinador', art: 'o', title: 'company', responsible: 'owner_id', url: (id) => `/patrocinadores/${id}`,
    fields: {
      company: 'empresa', website: 'site', kind: 'tipo', tier: 'plano', value_cents: 'valor', contact_name: 'contato', contact_email: 'e-mail do contato', contact_phone: 'telefone do contato',
      stage: 'etapa', owner_id: 'responsável', paid_at: 'pagamento', starts_on: 'início', ends_on: 'fim', notes: 'observações',
    },
  },
  episode: {
    table: 'episodes', label: 'episódio', art: 'o', title: 'title', responsible: 'editor_id', url: (id) => `/episodios/${id}`,
    fields: { number: 'número', title: 'título', aired_on: 'data de veiculação', recorded_on: 'data da gravação', notes: 'observações', editor_id: 'editor' },
  },
  clip: {
    table: 'episode_clips', label: 'corte', art: 'o', title: 'title', responsible: 'created_by', url: (id) => `/cortes/${id}`,
    fields: { title: 'título', post_title: 'título do post', caption: 'legenda' },
  },
  task: {
    // status, prazo, hora e responsável da tarefa já têm aviso próprio (services/tasks.js): aqui só o resto
    table: 'tasks', label: 'tarefa', art: 'a', title: 'title', responsible: 'assignee_id', url: (id) => `/tarefas/${id}`,
    fields: { title: 'título', description: 'descrição', kind: 'tipo', episode_id: 'episódio', guest_id: 'convidado', sponsor_id: 'patrocinador' },
  },
};

const isPlace = (type) => Object.prototype.hasOwnProperty.call(PLACES, type);

// Foto do cadastro como está agora (antes de editar ou de apagar).
async function snapshot(type, id) {
  if (!isPlace(type)) return null;
  const { rows } = await db.query(`SELECT * FROM ${PLACES[type].table} WHERE id = $1`, [id]);
  return rows[0] || null;
}

// Valor comparável: vazio e nulo são iguais; data vira texto.
const norm = (v) => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.join(',');
  return String(v).trim();
};

// Nomes (para o aviso) dos campos que mudaram entre as duas fotos.
function changedFields(type, before, after) {
  const { fields } = PLACES[type];
  return Object.keys(fields).filter((k) => norm(before[k]) !== norm(after[k])).map((k) => fields[k]);
}

const listWords = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}` : items[0]);

// Chame depois de salvar. before: snapshot de antes. Sem mudança real nos campos acompanhados, não avisa ninguém.
async function updated({ type, before, actor }) {
  if (!isPlace(type) || !before) return [];
  const def = PLACES[type];
  const after = await snapshot(type, before.id);
  if (!after) return [];
  const changes = changedFields(type, before, after);
  if (!changes.length) return [];
  const users = [...new Set([before[def.responsible], after[def.responsible]].filter(Boolean).map(String))];
  return notify({
    type: 'alteracao', users, title: `${actor.name} alterou ${def.art} ${def.label}: ${after[def.title]}`, body: `Mudou: ${listWords(changes)}.`,
    url: def.url(after.id), actorId: actor.id, entity: { type, id: after.id },
  });
}

// Chame depois de apagar. row: snapshot de antes de apagar.
async function deleted({ type, row, actor }) {
  if (!isPlace(type) || !row) return [];
  const def = PLACES[type];
  return notify({
    type: 'exclusao', users: [row[def.responsible]], title: `${actor.name} excluiu ${def.art} ${def.label}: ${row[def.title]}`,
    actorId: actor.id, entity: { type, id: row.id },
  });
}

module.exports = { PLACES, isPlace, snapshot, changedFields, updated, deleted };
