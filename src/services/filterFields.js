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
// projectIds (aqui e nas outras listas): as opções de conexão (patrocinador, episódio) só do recorte de projetos; sem ele, todas
async function guestFields(projectIds = null) {
  const [users, { rows: sponsors }] = await Promise.all([
    people(),
    db.query('SELECT id, company FROM sponsors WHERE ($1::int[] IS NULL OR project_id = ANY($1)) ORDER BY lower(company)', [projectIds]),
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
    { key: 'atualizado', label: 'Atualizado em', type: 'date', date: 'tz', sql: 'g.updated_at', group: DATE },
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

async function clipFields(projectIds = null) {
  await catalog.refresh();
  const [users, { rows: eps }] = await Promise.all([
    people(),
    db.query('SELECT id, number, title FROM episodes WHERE ($1::int[] IS NULL OR project_id = ANY($1)) ORDER BY number DESC NULLS LAST, id DESC LIMIT 200', [projectIds]),
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
    { key: 'atualizado', label: 'Atualizado em', type: 'date', get: (c) => c.updated_at, group: DATE },
    { key: 'publicado_em', label: 'Publicado em', type: 'date', get: (c) => (c.pub && c.pub.stage === 'publicado' ? c.pub.at : null), group: DATE },
    { key: 'episodio', label: 'Episódio', type: 'enum', get: (c) => (c.episode_id ? String(c.episode_id) : null), options: eps.map((e) => [String(e.id), `${e.number ? `EP.${String(e.number).padStart(3, '0')} · ` : ''}${e.title}`]), group: LINK },
    { key: 'pedido', label: 'Veio de um pedido', type: 'bool', get: (c) => Boolean(c.request_id), group: LINK },
    { key: 'capa', label: 'Tem capa escolhida', type: 'bool', get: (c) => Boolean(c.cover_id), group: LINK },
    { key: 'portal', label: 'Vai para o portal do convidado', type: 'bool', get: (c) => Boolean(c.for_guest), group: LINK },
    { key: 'teste', label: 'Reel de teste', type: 'bool', get: (c) => Boolean(c.pub && c.pub.trial), group: LINK },
  ];
}

const epLabel = (e) => `${e.number ? `EP.${String(e.number).padStart(3, '0')} · ` : ''}${e.title}`;
async function episodeOptions(projectIds = null) {
  const { rows } = await db.query('SELECT id, number, title FROM episodes WHERE ($1::int[] IS NULL OR project_id = ANY($1)) ORDER BY number DESC NULLS LAST, id DESC LIMIT 200', [projectIds]);
  return rows.map((e) => [String(e.id), epLabel(e)]);
}

// ---------------------------------------------------------------- Episódios (alias e = episodes, g = guests)
async function episodeFields() {
  const users = await people();
  const DATE = 'Datas'; const LINK = 'Conexões';
  return [
    { key: 'etapa', label: 'Etapa', type: 'enum', sql: 'e.status', options: opt(C.EPISODE_STAGES) },
    { key: 'editor', label: 'Editor', type: 'user', sql: 'e.editor_id', options: users },
    { key: 'titulo', label: 'Título', type: 'text', sql: 'e.title' },
    { key: 'numero', label: 'Número', type: 'number', sql: 'e.number' },
    { key: 'convidado', label: 'Convidado', type: 'text', sql: 'g.name' },
    { key: 'observacoes', label: 'Observações', type: 'text', sql: 'e.notes' },
    { key: 'obs_editor', label: 'Recado para o editor', type: 'text', sql: 'e.editor_notes' },
    { key: 'youtube', label: 'Link do YouTube', type: 'text', sql: 'e.youtube_url' },
    { key: 'spotify', label: 'Link do Spotify', type: 'text', sql: 'e.spotify_url' },
    { key: 'rodada', label: 'Rodadas de revisão', type: 'number', sql: 'e.review_round' },
    { key: 'minutos', label: 'Minutos de gravação', type: 'number', sql: 'e.recording_minutes' },
    { key: 'veiculacao', label: 'Data de veiculação', type: 'date', sql: 'e.aired_on', group: DATE },
    { key: 'gravado', label: 'Gravado em', type: 'date', sql: 'e.recorded_on', group: DATE },
    { key: 'publicado', label: 'Publicado em', type: 'date', date: 'tz', sql: 'e.published_at', group: DATE },
    { key: 'criado', label: 'Criado em', type: 'date', date: 'tz', sql: 'e.created_at', group: DATE },
    { key: 'atualizado', label: 'Atualizado em', type: 'date', date: 'tz', sql: 'e.updated_at', group: DATE },
    { key: 'tem_convidado', label: 'Tem convidado', type: 'bool', sql: 'e.guest_id IS NOT NULL', group: LINK },
    { key: 'tem_patrocinador', label: 'Tem patrocinador', type: 'bool', sql: 'EXISTS (SELECT 1 FROM sponsor_episodes se WHERE se.episode_id = e.id)', group: LINK },
    { key: 'tem_material', label: 'Tem material enviado', type: 'bool', sql: "EXISTS (SELECT 1 FROM episode_files f WHERE f.episode_id = e.id AND f.status = 'pronto')", group: LINK },
    { key: 'ajustes', label: 'Tem ajustes em aberto', type: 'bool', sql: 'EXISTS (SELECT 1 FROM episode_comments c WHERE c.episode_id = e.id AND NOT c.resolved)', group: LINK },
    { key: 'tarefas', label: 'Tem tarefas por fazer', type: 'bool', sql: "EXISTS (SELECT 1 FROM tasks t WHERE t.episode_id = e.id AND t.status <> 'feito')", group: LINK },
    { key: 'cortes', label: 'Tem cortes', type: 'bool', sql: 'EXISTS (SELECT 1 FROM episode_clips k WHERE k.episode_id = e.id)', group: LINK },
    { key: 'media_kit', label: 'Destaque no media kit', type: 'bool', sql: 'e.kit_featured', group: LINK },
  ];
}

// ---------------------------------------------------------------- Patrocinadores (alias s = sponsors)
async function sponsorFields() {
  const users = await people();
  const DATE = 'Datas'; const LINK = 'Conexões';
  return [
    { key: 'etapa', label: 'Etapa', type: 'enum', sql: 's.stage', options: opt(C.SPONSOR_STAGES) },
    { key: 'responsavel', label: 'Responsável', type: 'user', sql: 's.owner_id', options: users },
    { key: 'tipo', label: 'Tipo', type: 'enum', sql: 's.kind', options: Object.entries(C.SPONSOR_KINDS) },
    { key: 'plano', label: 'Plano', type: 'enum', sql: 's.tier', options: Object.entries(C.SPONSOR_TIERS) },
    { key: 'empresa', label: 'Empresa', type: 'text', sql: 's.company' },
    { key: 'contato', label: 'Contato', type: 'text', sql: 's.contact_name' },
    { key: 'email', label: 'E-mail', type: 'text', sql: 's.contact_email' },
    { key: 'telefone', label: 'Telefone', type: 'text', sql: 's.contact_phone' },
    { key: 'site', label: 'Site', type: 'text', sql: 's.website' },
    { key: 'observacoes', label: 'Observações', type: 'text', sql: 's.notes' },
    { key: 'valor', label: 'Valor (R$)', type: 'number', sql: 's.value_cents / 100.0' },
    { key: 'origem', label: 'Origem', type: 'enum', sql: "coalesce(s.origin, 'painel')", options: [['painel', 'Cadastrado no painel'], ['site', 'Pedido pelo site']] },
    { key: 'criado', label: 'Cadastrado em', type: 'date', date: 'tz', sql: 's.created_at', group: DATE },
    { key: 'atualizado', label: 'Atualizado em', type: 'date', date: 'tz', sql: 's.updated_at', group: DATE },
    { key: 'etapa_desde', label: 'Na etapa desde', type: 'date', date: 'tz', sql: 's.stage_entered_at', group: DATE },
    { key: 'inicio', label: 'Início do contrato', type: 'date', sql: 's.starts_on', group: DATE },
    { key: 'fim', label: 'Fim do contrato', type: 'date', sql: 's.ends_on', group: DATE },
    { key: 'pago', label: 'Pago em', type: 'date', sql: 's.paid_at', group: DATE },
    { key: 'kit_visto', label: 'Media kit visto em', type: 'date', date: 'tz', sql: 's.kit_viewed_at', group: DATE },
    { key: 'briefing', label: 'Briefing concluído em', type: 'date', date: 'tz', sql: 's.brief_completed_at', group: DATE },
    { key: 'tem_logo', label: 'Tem logo', type: 'bool', sql: "EXISTS (SELECT 1 FROM sponsor_files f WHERE f.sponsor_id = s.id AND f.kind = 'logo' AND f.status = 'pronto')", group: LINK },
    { key: 'tem_episodio', label: 'Tem episódio vinculado', type: 'bool', sql: 'EXISTS (SELECT 1 FROM sponsor_episodes se WHERE se.sponsor_id = s.id)', group: LINK },
    { key: 'reserva', label: 'Tem gravação reservada', type: 'bool', sql: 'EXISTS (SELECT 1 FROM sponsor_bookings b WHERE b.sponsor_id = s.id)', group: LINK },
    { key: 'oficial', label: 'Patrocinador oficial no site', type: 'bool', sql: 's.site_official', group: LINK },
    { key: 'escondido', label: 'Escondido do site', type: 'bool', sql: 's.site_hidden', group: LINK },
    { key: 'media_kit', label: 'Aparece no media kit', type: 'bool', sql: 's.kit_show', group: LINK },
  ];
}

// ---------------------------------------------------------------- Conteúdo > Quadro (cartões de contentBoard.build)
async function boardFields(projectIds = null) {
  const DATE = 'Datas'; const LINK = 'Conexões';
  const { STAGES } = require('./contentBoard');
  return [
    { key: 'tipo', label: 'Tipo', type: 'enum', get: (k) => k.type, options: [['pedido', 'Pedido'], ['corte', 'Vídeo'], ['post', 'Post'], ['story', 'Story'], ['carrossel', 'Carrossel']] },
    { key: 'etapa', label: 'Etapa', type: 'enum', get: (k) => k.stage, options: opt(STAGES) },
    { key: 'conteudo', label: 'Tipo de conteúdo', type: 'text', get: (k) => k.kind },
    { key: 'titulo', label: 'Título', type: 'text', get: (k) => k.title },
    { key: 'responsavel', label: 'Responsável (pedido)', type: 'text', get: (k) => (k.type === 'pedido' && k.who !== 'sem responsável' ? k.who : null) },
    { key: 'prioridade', label: 'Prioridade', type: 'bool', get: (k) => Boolean(k.priority) },
    { key: 'atrasado', label: 'Atrasado', type: 'bool', get: (k) => Boolean(k.late) },
    { key: 'prazo', label: 'Prazo (pedido)', type: 'date', get: (k) => k.due, group: DATE },
    { key: 'criado', label: 'Criado em', type: 'date', get: (k) => k.created, group: DATE },
    { key: 'atualizado', label: 'Atualizado em', type: 'date', get: (k) => k.updated || k.at, group: DATE },
    { key: 'publicado_em', label: 'Publicado em', type: 'date', get: (k) => (k.pub && k.pub.stage === 'publicado' ? k.pub.at : null), group: DATE },
    { key: 'episodio', label: 'Episódio', type: 'enum', get: (k) => (k.episodeId ? String(k.episodeId) : null), options: await episodeOptions(projectIds), group: LINK },
    { key: 'capa', label: 'Tem capa', type: 'bool', get: (k) => Boolean(k.thumb), group: LINK },
    { key: 'teste', label: 'Reel de teste', type: 'bool', get: (k) => Boolean(k.pub && k.pub.trial), group: LINK },
  ];
}

// ---------------------------------------------------------------- Conteúdo > Posts e carrosséis (linhas de episode_covers + pub)
async function postFields(projectIds = null) {
  const DATE = 'Datas'; const LINK = 'Conexões';
  return [
    { key: 'tipo', label: 'Tipo', type: 'enum', get: (p) => p.kind, options: [['post_quote', 'Post de frase'], ['post_split', 'Tela dividida'], ['carousel', 'Carrossel']] },
    { key: 'social', label: 'Situação no Social', type: 'enum', get: pubOf, options: [['nao', 'Não publicado'], ['fila', 'Na fila (agendado ou em revisão)'], ['publicado', 'Publicado']] },
    { key: 'aprovado', label: 'Aprovado', type: 'bool', get: (p) => Boolean(p.approved) },
    { key: 'automatico', label: 'Feito pela IA', type: 'bool', get: (p) => Boolean(p.auto) },
    { key: 'texto', label: 'Texto', type: 'text', get: (p) => p.label },
    { key: 'criado', label: 'Criado em', type: 'date', get: (p) => p.created_at, group: DATE },
    { key: 'atualizado', label: 'Atualizado em', type: 'date', get: (p) => p.updated_at, group: DATE },
    { key: 'episodio', label: 'Episódio', type: 'enum', get: (p) => (p.episode_id ? String(p.episode_id) : null), options: await episodeOptions(projectIds), group: LINK },
  ];
}

// ---------------------------------------------------------------- Conteúdo > Pedidos (linhas de contentRequests.list)
async function requestFields(projectIds = null) {
  const R = require('./contentRequests');
  await catalog.refresh();
  const users = await people();
  const DATE = 'Datas'; const LINK = 'Conexões';
  const today = require('./filters').brDate(new Date());
  return [
    { key: 'situacao', label: 'Situação', type: 'enum', get: (r) => r.status, options: Object.entries(R.STATUSES) },
    { key: 'tipo', label: 'Tipo', type: 'enum', get: (r) => r.kind, options: Object.keys(R.KINDS).map((k) => [k, R.KINDS[k].label]) },
    { key: 'responsavel', label: 'Responsável', type: 'user', get: (r) => (r.assignee_id ? String(r.assignee_id) : null), options: users },
    { key: 'pedido_por', label: 'Pedido por', type: 'user', get: (r) => (r.created_by ? String(r.created_by) : null), options: users },
    { key: 'titulo', label: 'Título', type: 'text', get: (r) => r.title },
    { key: 'briefing', label: 'Briefing', type: 'text', get: (r) => r.briefing },
    { key: 'formato', label: 'Formato', type: 'enum', get: (r) => r.format, options: Object.entries(R.FORMATS) },
    { key: 'prioridade', label: 'Prioridade', type: 'bool', get: (r) => Boolean(r.priority) },
    { key: 'atrasado', label: 'Atrasado', type: 'bool', get: (r) => R.isLate(r, today) },
    { key: 'prazo', label: 'Prazo', type: 'date', get: (r) => r.due_on, group: DATE },
    { key: 'criado', label: 'Pedido em', type: 'date', get: (r) => r.created_at, group: DATE },
    { key: 'atualizado', label: 'Atualizado em', type: 'date', get: (r) => r.updated_at, group: DATE },
    { key: 'episodio', label: 'Episódio', type: 'enum', get: (r) => (r.episode_id ? String(r.episode_id) : null), options: await episodeOptions(projectIds), group: LINK },
  ];
}

// ---------------------------------------------------------------- visualizações salvas
async function savedViews(entity, userId) {
  const { rows } = await db.query(
    `SELECT v.id, v.name, v.query, v.shared, v.user_id, u.name AS owner_name FROM saved_filters v JOIN users u ON u.id = v.user_id
      WHERE v.entity = $1 AND (v.user_id = $2 OR v.shared) ORDER BY (v.user_id = $2) DESC, lower(v.name)`, [entity, userId]);
  return rows;
}

module.exports = { guestFields, clipFields, episodeFields, sponsorFields, boardFields, postFields, requestFields, savedViews, formatOf, videoTypeOptions };
