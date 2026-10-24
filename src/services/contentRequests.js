// Pedidos de conteúdo: a gestão (ou a produtora) pede ao editor uma peça que nem sempre nasce de um episódio (trailer do canal,
// vídeo avulso, corte específico, post, carrossel, story). Caminho: pedido -> em produção -> em revisão -> aprovado (ou volta com
// ajustes). A entrega é vídeo (vira corte em episode_clips, com request_id) ou imagem (episode_covers kind 'entrega'). Só depois de
// aprovada ela aparece no Social para publicar.
const crypto = require('crypto');
const db = require('../db/pool');
const b2 = require('./b2');
const richText = require('./richText');
const { notify } = require('./notify');
const { can } = require('../permissions');
const { clean, parseInputDate } = require('../utils/format');

// media: o que o editor entrega (vídeo ou imagens). publish: como sai no Social (tipo do "Novo post").
const KINDS = {
  trailer: { label: 'Trailer do canal', media: 'video', publish: 'video' },
  video: { label: 'Vídeo avulso', media: 'video', publish: 'video' },
  corte: { label: 'Corte', media: 'video', publish: 'video' },
  post: { label: 'Post', media: 'image', publish: 'imagem' },
  carrossel: { label: 'Carrossel', media: 'image', publish: 'carrossel' },
  story: { label: 'Story', media: 'image', publish: 'story' },
  outro: { label: 'Outro', media: 'video', publish: 'video' },
};
const STATUSES = { pedido: 'Pedido', producao: 'Em produção', revisao: 'Em revisão', aprovado: 'Aprovado', cancelado: 'Cancelado' };
const FORMATS = { vertical: 'Vertical (9:16)', horizontal: 'Horizontal (16:9)', quadrado: 'Post (4:5)' };
const OPEN = ['pedido', 'producao', 'revisao'];
const MAX_IMAGE = 15 * 1024 * 1024;

const canRequest = (role) => can(role, 'production.manage') || can(role, 'production.review');
const canReview = (role) => can(role, 'production.review');
const isMine = (user, r) => String(r.assignee_id || '') === String(user.id);
// quem produz: o responsável, ou qualquer editor/gestão quando o pedido ainda não tem responsável
const canWork = (user, r) => isMine(user, r) || canReview(user.role) || (!r.assignee_id && can(user.role, 'production.edit'));

const SELECT = `SELECT r.*, a.name AS assignee_name, cb.name AS creator_name, e.number AS episode_number, e.title AS episode_title,
    (SELECT count(*)::int FROM episode_clips c WHERE c.request_id = r.id) AS videos,
    (SELECT count(*)::int FROM episode_covers c WHERE c.request_id = r.id) AS images
  FROM content_requests r LEFT JOIN users a ON a.id = r.assignee_id LEFT JOIN users cb ON cb.id = r.created_by LEFT JOIN episodes e ON e.id = r.episode_id`;

const get = (id) => db.query(`${SELECT} WHERE r.id = $1`, [id]).then((x) => x.rows[0] || null);
const list = ({ open = false, assigneeId = null, episodeId = null } = {}) => {
  const where = []; const p = [];
  where.push(open ? `r.status = ANY('{${OPEN.join(',')}}')` : 'true');
  if (assigneeId) { p.push(assigneeId); where.push(`r.assignee_id = $${p.length}`); }
  if (episodeId) { p.push(episodeId); where.push(`r.episode_id = $${p.length}`); }
  return db.query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY (r.due_on IS NULL), r.due_on, r.created_at DESC`, p).then((x) => x.rows);
};

function parse(body) {
  const v = {}; const errors = [];
  v.kind = Object.prototype.hasOwnProperty.call(KINDS, body.kind) ? body.kind : null;
  if (!v.kind) errors.push('Escolha o que é o conteúdo.');
  v.title = clean(body.title, 160);
  if (!v.title) errors.push('Dê um nome para o pedido.');
  if (body.briefing_html != null) { const r = richText.sanitize(body.briefing_html); v.briefing_html = r.html || null; v.briefing = r.text || null; v.attachmentIds = r.attachmentIds; } else v.briefing = String(body.briefing || '').trim().slice(0, 4000) || null;
  v.format = FORMATS[body.format] ? body.format : null;
  v.episode_id = /^\d+$/.test(String(body.episode_id || '')) ? Number(body.episode_id) : null;
  v.assignee_id = /^[0-9a-f-]{36}$/i.test(String(body.assignee_id || '')) ? body.assignee_id : null;
  if (body.due_on && !parseInputDate(body.due_on)) errors.push('Data de entrega inválida.');
  v.due_on = body.due_on && parseInputDate(body.due_on) ? body.due_on : null;
  return { values: v, error: errors[0] || null };
}

const url = (id) => `/conteudo/pedidos/${id}`;
const tell = (args) => notify({ type: 'tarefa', ...args }).catch((err) => console.error('[pedidos] aviso:', err.message));
const reviewers = () => db.query("SELECT id FROM users WHERE active AND role IN ('superadmin','gestao')").then((r) => r.rows.map((x) => x.id));
const kindLabel = (r) => KINDS[r.kind]?.label || 'Conteúdo';

async function create(values, user) {
  const { rows: [r] } = await db.query(
    `INSERT INTO content_requests (kind, title, briefing, briefing_html, format, episode_id, assignee_id, due_on, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [values.kind, values.title, values.briefing || null, values.briefing_html || null, values.format, values.episode_id, values.assignee_id, values.due_on, user.id]);
  if (values.assignee_id && values.assignee_id !== user.id) {
    await tell({ users: [values.assignee_id], actorId: user.id, title: `Pedido de conteúdo: ${values.title}`, body: `${user.name} pediu: ${KINDS[values.kind].label}${values.due_on ? ` para ${values.due_on.split('-').reverse().join('/')}` : ''}.`, url: url(r.id), entity: { type: 'content_request', id: r.id }, dedupe: `pedido-${r.id}` });
  }
  return get(r.id);
}

async function update(r, values, user) {
  await db.query(
    `UPDATE content_requests SET kind = $2, title = $3, briefing = $4, briefing_html = $5, format = $6, episode_id = $7, assignee_id = $8, due_on = $9, updated_at = now() WHERE id = $1`,
    [r.id, values.kind, values.title, values.briefing || null, values.briefing_html || null, values.format, values.episode_id, values.assignee_id, values.due_on]);
  if (values.assignee_id && String(values.assignee_id) !== String(r.assignee_id || '') && values.assignee_id !== user.id) {
    await tell({ users: [values.assignee_id], actorId: user.id, title: `Pedido de conteúdo: ${values.title}`, body: `${user.name} passou este pedido para você.`, url: url(r.id), entity: { type: 'content_request', id: r.id }, dedupe: `pedido-${r.id}-${values.assignee_id}` });
  }
  return get(r.id);
}

// Mudança de etapa, sempre a partir da etapa esperada (dois cliques não andam duas vezes).
async function move(r, from, to, extra = '') {
  const { rows: [row] } = await db.query(`UPDATE content_requests SET status = $3, updated_at = now() ${extra} WHERE id = $1 AND status = ANY($2) RETURNING *`, [r.id, [].concat(from), to]);
  return row || null;
}

async function start(r, user) { // sem responsável: quem começa assume
  const { rows: [row] } = await db.query("UPDATE content_requests SET status = 'producao', assignee_id = coalesce(assignee_id, $2), updated_at = now() WHERE id = $1 AND status = 'pedido' RETURNING id", [r.id, user.id]);
  return row ? { ok: true } : { error: 'Este pedido já está em produção.' };
}

async function deliveries(id) {
  const [videos, images] = await Promise.all([
    db.query('SELECT id, title, status, error, duration_ms, width, height, cover_id, episode_id, created_at FROM episode_clips WHERE request_id = $1 ORDER BY id', [id]),
    db.query('SELECT id, width, height, position, size_bytes, updated_at FROM episode_covers WHERE request_id = $1 ORDER BY position, id', [id]),
  ]);
  return { videos: videos.rows, images: images.rows };
}

async function deliver(r, user) {
  const d = await deliveries(r.id);
  const ready = d.videos.filter((v) => v.status === 'pronto').length + d.images.length;
  if (!ready) return { error: 'Envie a entrega antes de mandar para a revisão.' };
  if (d.videos.some((v) => ['enviando', 'processando'].includes(v.status))) return { error: 'Espere os vídeos terminarem de subir e ser lidos.' };
  const row = await move(r, 'producao', 'revisao', ', delivered_at = now()');
  if (!row) return { error: 'Este pedido não está em produção.' };
  const who = [...new Set([r.created_by, ...(await reviewers())])].filter((u) => u && u !== user.id);
  await tell({ users: who, actorId: user.id, title: `Entrega para revisar: ${r.title}`, body: `${user.name} entregou ${kindLabel(r).toLowerCase()}.`, url: url(r.id), entity: { type: 'content_request', id: r.id }, dedupe: `pedido-entrega-${r.id}-${r.rounds}` });
  return { ok: true };
}

async function approve(r, user) {
  const row = await move(r, 'revisao', 'aprovado', ', approved_at = now(), review_note = NULL');
  if (!row) return { error: 'Este pedido não está em revisão.' };
  if (r.assignee_id && r.assignee_id !== user.id) await tell({ users: [r.assignee_id], actorId: user.id, title: `Entrega aprovada: ${r.title}`, body: 'Já está disponível no Social para publicar.', url: url(r.id), entity: { type: 'content_request', id: r.id }, dedupe: `pedido-aprovado-${r.id}` });
  return { ok: true };
}

async function askChanges(r, user, note) {
  const text = clean(note, 1000);
  if (!text) return { error: 'Diga o que ajustar.' };
  const { rows: [row] } = await db.query("UPDATE content_requests SET status = 'producao', rounds = rounds + 1, review_note = $2, updated_at = now() WHERE id = $1 AND status = 'revisao' RETURNING *", [r.id, text]);
  if (!row) return { error: 'Este pedido não está em revisão.' };
  if (r.assignee_id) await tell({ users: [r.assignee_id], actorId: user.id, title: `Ajustes pedidos: ${r.title}`, body: text, url: url(r.id), entity: { type: 'content_request', id: r.id }, dedupe: `pedido-ajuste-${r.id}-${row.rounds}` });
  return { ok: true };
}

async function cancel(r) { return (await move(r, OPEN, 'cancelado')) ? { ok: true } : { error: 'Não dá para cancelar um pedido já aprovado.' }; }
async function reopen(r) { return (await move(r, ['cancelado'], 'pedido')) ? { ok: true } : { error: 'Pedido não está cancelado.' }; }

// Episódio válido para o corte entregue (só gravados aceitam cortes): senão o vídeo fica avulso.
async function clipEpisode(r) {
  if (!r.episode_id) return null;
  const { ELIGIBLE_STATUSES } = require('./clips');
  const { rows: [e] } = await db.query('SELECT status FROM episodes WHERE id = $1', [r.episode_id]);
  return e && ELIGIBLE_STATUSES.includes(e.status) ? r.episode_id : null;
}

// Imagem entregue (post, story, slide do carrossel): guardada como está, na ordem de chegada.
async function addImage(r, buffer) {
  const type = require('./attachments').imageType(buffer);
  if (!type || type.ext === 'gif') return { error: 'Envie JPG, PNG ou WebP.' };
  if (buffer.length > MAX_IMAGE) return { error: 'Imagem grande demais (limite de 15 MB).' };
  let width; let height;
  try { const img = await require('@napi-rs/canvas').loadImage(buffer); width = img.width; height = img.height; } catch { return { error: 'Não consegui abrir esta imagem.' }; }
  const key = await b2.keyFor('pedidos', r.id, `entrega-${crypto.randomBytes(6).toString('hex')}.${type.ext}`);
  await b2.putObject(key, buffer, type.type);
  const { rows: [pos] } = await db.query('SELECT coalesce(max(position), -1) + 1 AS n FROM episode_covers WHERE request_id = $1', [r.id]);
  const { rows: [c] } = await db.query(
    `INSERT INTO episode_covers (episode_id, kind, group_key, position, label, spec, storage_key, mime, width, height, size_bytes, auto, request_id)
     VALUES ($1, 'entrega', $2, $3, $4, '{}', $5, $6, $7, $8, $9, false, $10) RETURNING id, width, height, position, size_bytes, updated_at`,
    [r.episode_id, `pedido-${r.id}`, pos.n, r.title, key, type.type, width, height, buffer.length, r.id]);
  return { ok: true, image: c };
}

async function removeImage(r, coverId) {
  const { rows: [c] } = await db.query('DELETE FROM episode_covers WHERE id = $1 AND request_id = $2 RETURNING storage_key', [coverId, r.id]);
  if (c) await b2.deleteObject(c.storage_key).catch((err) => console.error('[pedidos] apagar imagem:', err.message));
  return Boolean(c);
}

const isLate = (r, today) => Boolean(r.due_on) && OPEN.includes(r.status) && String(r.due_on instanceof Date ? r.due_on.toISOString() : r.due_on).slice(0, 10) < today;

module.exports = { KINDS, STATUSES, FORMATS, OPEN, MAX_IMAGE, canRequest, canReview, canWork, isMine, get, list, parse, create, update, start, deliveries, deliver, approve, askChanges, cancel, reopen, clipEpisode, addImage, removeImage, isLate, url };
