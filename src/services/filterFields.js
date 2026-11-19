// Campos dos filtros combináveis de cada lista (ver services/filters.js). Convidados filtra no banco (`sql`); Conteúdo > Cortes
// filtra a lista já carregada (`get`), porque a situação no Social e o formato do vídeo saem de cálculo, não de coluna.
const db = require('../db/pool');
const C = require('../constants');
const catalog = require('./catalog');

const opt = (list) => list.map((x) => [x.key, x.label]);

async function people() {
  const { rows } = await db.query('SELECT id, name FROM users WHERE active ORDER BY lower(name)');
  return rows.map((u) => [String(u.id), u.name]);
}

// ---------------------------------------------------------------- Convidados (alias g = guests)
async function guestFields() {
  const [users, { rows: sponsors }] = await Promise.all([
    people(),
    db.query('SELECT id, company FROM sponsors ORDER BY lower(company)'),
  ]);
  const DATE = 'Datas'; const LINK = 'Conexões';
  return [
    { key: 'etapa', label: 'Etapa', type: 'enum', sql: 'g.status', options: opt(C.GUEST_STATUSES) },
    { key: 'responsavel', label: 'Responsável', type: 'user', sql: 'g.owner_id', options: users },
    { key: 'perfil', label: 'Perfil', type: 'enum', sql: 'g.profile', options: opt(C.PROFILES) },
    { key: 'nome', label: 'Nome', type: 'text', sql: 'g.name' },
    { key: 'email', label: 'E-mail', type: 'text', sql: 'g.email' },
    { key: 'whatsapp', label: 'WhatsApp', type: 'text', sql: 'g.phone' },
    { key: 'instagram', label: 'Instagram', type: 'text', sql: 'g.instagram' },
    { key: 'empresa', label: 'Empresa', type: 'text', sql: 'g.company' },
    { key: 'cargo', label: 'Cargo', type: 'text', sql: 'g.job_title' },
    { key: 'tema', label: 'Tema', type: 'text', sql: 'g.topic' },
    { key: 'alcance', label: 'Alcance', type: 'text', sql: 'g.reach' },
    { key: 'observacoes', label: 'Observações', type: 'text', sql: 'g.notes' },
    { key: 'genero', label: 'Gênero', type: 'enum', sql: 'g.gender', options: [['m', 'Masculino'], ['f', 'Feminino']] },
    { key: 'formato', label: 'Formato do convite', type: 'enum', sql: 'g.invite_format', options: [['mesa', 'De mesa'], ['plateia', 'Com plateia']] },
    { key: 'origem', label: 'Origem', type: 'enum', sql: "coalesce(g.origin, 'painel')", options: [['painel', 'Cadastrado no painel'], ['site', 'Pedido pelo site']] },
    { key: 'perda', label: 'Motivo de perda', type: 'enum', sql: 'g.loss_reason', options: Object.entries(C.LOSS_REASONS) },
    { key: 'gravacao', label: 'Data da gravação', type: 'date', date: 'tz', sql: 'g.proposed_at', group: DATE },
    { key: 'estreia', label: 'Estreia prevista', type: 'date', sql: 'g.premiere_on', group: DATE },
    { key: 'cadastro', label: 'Cadastrado em', type: 'date', date: 'tz', sql: 'g.created_at', group: DATE },
    { key: 'convite_enviado', label: 'Convite enviado em', type: 'date', date: 'tz', sql: 'g.invite_sent_at', group: DATE },
    { key: 'convite_visto', label: 'Convite visto em', type: 'date', date: 'tz', sql: 'g.invite_viewed_at', group: DATE },
    { key: 'resposta', label: 'Respondeu em', type: 'date', date: 'tz', sql: 'g.responded_at', group: DATE },
    { key: 'etapa_desde', label: 'Na etapa desde', type: 'date', date: 'tz', sql: 'g.stage_entered_at', group: DATE },
    { key: 'patrocinador', label: 'Patrocinador indicado', type: 'enum', sql: 'g.sponsor_id', options: sponsors.map((s) => [String(s.id), s.company]), group: LINK },
    { key: 'tem_episodio', label: 'Tem episódio', type: 'bool', sql: 'EXISTS (SELECT 1 FROM episodes e WHERE e.guest_id = g.id)', group: LINK },
    { key: 'publicado', label: 'Episódio publicado', type: 'bool', sql: "EXISTS (SELECT 1 FROM episodes e WHERE e.guest_id = g.id AND e.status = 'publicado')", group: LINK },
    { key: 'reservado', label: 'Reservado por patrocinador', type: 'bool', sql: 'EXISTS (SELECT 1 FROM sponsor_bookings b WHERE b.guest_id = g.id)', group: LINK },
    { key: 'tem_foto', label: 'Tem foto', type: 'bool', sql: 'g.photo_key IS NOT NULL', group: LINK },
    { key: 'plateia', label: 'Aberto para plateia', type: 'bool', sql: 'g.audience_enabled', group: LINK },
    { key: 'portal', label: 'Portal ativo', type: 'bool', sql: 'g.portal_enabled', group: LINK },
  ];
}

// ---------------------------------------------------------------- Conteúdo > Cortes (linhas de episode_clips + pub)
const formatOf = (c) => {
  if (!c.width || !c.height) return null;
  if (c.height > c.width * 1.05) return 'vertical';
  if (c.width > c.height * 1.05) return 'horizontal';
  return 'quadrado';
};
const pubOf = (c) => (c.pub ? c.pub.stage : 'nao');

// Tipos de vídeo de Gestão > Categorias: os ativos na ordem e, no fim, os desativados (vídeos antigos ainda podem ter).
function videoTypeOptions() {
  const K = require('./contentRequests').KINDS;
  const active = catalog.videoOptions();
  const off = Object.keys(K).filter((k) => catalog.isVideoType(k, { active: false }) && !active.includes(k));
  return [...active.map((k) => [k, K[k]?.label || k]), ...off.map((k) => [k, `${K[k]?.label || k} (desativada)`])];
}

async function clipFields() {
  await catalog.refresh();
  const [users, { rows: eps }] = await Promise.all([
    people(),
    db.query('SELECT id, number, title FROM episodes ORDER BY number DESC NULLS LAST, id DESC LIMIT 200'),
  ]);
  const DATE = 'Datas'; const LINK = 'Conexões';
  return [
    { key: 'categoria', label: 'Categoria', type: 'enum', get: (c) => c.video_type, options: videoTypeOptions() },
    { key: 'social', label: 'Situação no Social', type: 'enum', get: pubOf, options: [['nao', 'Não publicado'], ['fila', 'Na fila (agendado ou em revisão)'], ['publicado', 'Publicado']] },
    { key: 'status', label: 'Vídeo', type: 'enum', get: (c) => c.status, options: [['pronto', 'Pronto'], ['enviando', 'Enviando'], ['processando', 'Processando'], ['erro', 'Com erro']] },
    { key: 'formato', label: 'Formato', type: 'enum', get: formatOf, options: [['vertical', 'Vertical (9:16)'], ['horizontal', 'Horizontal (16:9)'], ['quadrado', 'Quadrado']] },
    { key: 'gancho', label: 'Gancho (título do post)', type: 'text', get: (c) => c.post_title },
    { key: 'nome', label: 'Nome interno', type: 'text', get: (c) => c.title },
    { key: 'legenda', label: 'Legenda', type: 'text', get: (c) => c.caption },
    { key: 'convidado', label: 'Convidado', type: 'text', get: (c) => c.guest_name },
    { key: 'duracao', label: 'Duração (segundos)', type: 'number', get: (c) => (c.duration_ms ? Math.round(c.duration_ms / 1000) : null) },
    { key: 'quem', label: 'Quem subiu', type: 'user', get: (c) => (c.video_by || c.created_by ? String(c.video_by || c.created_by) : null), options: users },
    { key: 'criado', label: 'Enviado em', type: 'date', get: (c) => c.created_at, group: DATE },
    { key: 'publicado_em', label: 'Publicado em', type: 'date', get: (c) => (c.pub && c.pub.stage === 'publicado' ? c.pub.at : null), group: DATE },
    { key: 'episodio', label: 'Episódio', type: 'enum', get: (c) => (c.episode_id ? String(c.episode_id) : null), options: eps.map((e) => [String(e.id), `${e.number ? `EP.${String(e.number).padStart(3, '0')} · ` : ''}${e.title}`]), group: LINK },
    { key: 'pedido', label: 'Veio de um pedido', type: 'bool', get: (c) => Boolean(c.request_id), group: LINK },
    { key: 'capa', label: 'Tem capa escolhida', type: 'bool', get: (c) => Boolean(c.cover_id), group: LINK },
    { key: 'portal', label: 'Vai para o portal do convidado', type: 'bool', get: (c) => Boolean(c.for_guest), group: LINK },
    { key: 'teste', label: 'Reel de teste', type: 'bool', get: (c) => Boolean(c.pub && c.pub.trial), group: LINK },
  ];
}

// ---------------------------------------------------------------- visualizações salvas
async function savedViews(entity, userId) {
  const { rows } = await db.query(
    `SELECT v.id, v.name, v.query, v.shared, v.user_id, u.name AS owner_name FROM saved_filters v JOIN users u ON u.id = v.user_id
      WHERE v.entity = $1 AND (v.user_id = $2 OR v.shared) ORDER BY (v.user_id = $2) DESC, lower(v.name)`, [entity, userId]);
  return rows;
}

module.exports = { guestFields, clipFields, savedViews, formatOf, videoTypeOptions };
