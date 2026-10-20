// Anexos de tarefas e comentários: imagens (coladas ou enviadas), documentos (PDF, HTML, ZIP) e áudios (com transcrição).
// O arquivo vai para o bucket privado do Backblaze; a tela pega por /anexos/:id (endereço assinado e curto). O tipo vem dos primeiros
// bytes do arquivo, não do que o navegador diz. Documentos sempre baixam (nunca abrem no painel): HTML anexado não roda aqui.
const crypto = require('crypto');
const db = require('../db/pool');
const b2 = require('./b2');
const groq = require('./groq');
const config = require('../config');
const { can } = require('../permissions');

const LIMITS = { image: 10 * 1024 * 1024, audio: 8 * 1024 * 1024, file: 25 * 1024 * 1024 };
const FILE_TYPES = { pdf: 'application/pdf', html: 'text/html', htm: 'text/html', zip: 'application/zip' };
const AUDIO_EXT = { 'audio/webm': 'webm', 'video/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };
const MAX_BODY = LIMITS.file;

function imageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 100) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: 'png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  if (['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString())) return { type: 'image/gif', ext: 'gif' };
  return null;
}

const extOf = (name) => (String(name).match(/\.([A-Za-z0-9]{1,5})$/)?.[1] || '').toLowerCase();
const safeName = (name) => String(name || 'arquivo').normalize('NFC').replace(/[\u0000-\u001f\u007f/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'arquivo';

// { kind, type, ext } ou { error, status }
function detect({ buf, filename, contentType }) {
  if (!Buffer.isBuffer(buf) || buf.length < 1) return { error: 'O arquivo veio vazio.', status: 400 };
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  const img = imageType(buf);
  if (img) return buf.length > LIMITS.image ? { error: 'Imagem grande demais (limite de 10 MB).', status: 413 } : { kind: 'image', ...img };
  if (AUDIO_EXT[ct]) return buf.length > LIMITS.audio ? { error: 'Áudio grande demais (limite de 8 MB, uns 2 minutos).', status: 413 } : { kind: 'audio', type: ct === 'video/webm' ? 'audio/webm' : ct, ext: AUDIO_EXT[ct] };
  const ext = extOf(filename);
  if (FILE_TYPES[ext]) {
    if (buf.length > LIMITS.file) return { error: 'Arquivo grande demais (limite de 25 MB).', status: 413 };
    if (ext === 'pdf' && buf.subarray(0, 5).toString() !== '%PDF-') return { error: 'Esse arquivo não parece um PDF.', status: 415 };
    if (ext === 'zip' && !(buf[0] === 0x50 && buf[1] === 0x4b)) return { error: 'Esse arquivo não parece um ZIP.', status: 415 };
    if (['html', 'htm'].includes(ext) && buf.subarray(0, 2048).includes(0)) return { error: 'Esse arquivo não parece um HTML.', status: 415 };
    return { kind: 'file', type: FILE_TYPES[ext], ext: ext === 'htm' ? 'html' : ext };
  }
  return { error: 'Formato não aceito. Envie imagem (PNG, JPG, WebP, GIF), PDF, HTML ou ZIP.', status: 415 };
}

async function store({ buf, filename, contentType, user, durationMs = null }) {
  const d = detect({ buf, filename, contentType });
  if (d.error) return d;
  if (!config.storageConfigured) return { error: 'Armazenamento (Backblaze) não configurado neste servidor.', status: 503 };
  const key = await b2.keyFor('anexos', `${d.kind}-${crypto.randomBytes(10).toString('hex')}.${d.ext}`);
  await b2.putObject(key, buf, d.type);
  let transcript = null; let transcribeError = null;
  if (d.kind === 'audio') {
    if (config.groqConfigured) {
      try { transcript = await groq.transcribe(buf, { filename: `audio.${d.ext}`, contentType: d.type }) || null; } catch (err) { console.error('[anexos] transcrição:', err.message); transcribeError = 'Não consegui transcrever o áudio agora.'; }
    } else transcribeError = 'A transcrição de voz não está configurada neste servidor.';
  }
  const name = d.kind === 'audio' ? `Áudio ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date()).replace(',', '')}.${d.ext}` : safeName(filename);
  const { rows: [att] } = await db.query(
    `INSERT INTO attachments (kind, filename, content_type, size_bytes, storage_key, transcript, duration_ms, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [d.kind, name, d.type, buf.length, key, transcript, Number.isFinite(durationMs) && durationMs > 0 ? Math.min(Math.round(durationMs), 3_600_000) : null, user.id]);
  return { attachment: att, transcribeError };
}

// Liga ao item os anexos que a pessoa enviou e ainda estavam soltos (ou já eram desse item). Nunca rouba anexo de outra pessoa.
async function link(ids, entityType, entityId, user) {
  const list = [...new Set((ids || []).map(Number).filter(Number.isInteger))].slice(0, 60);
  if (!list.length) return 0;
  const { rowCount } = await db.query(
    `UPDATE attachments SET entity_type = $2, entity_id = $3
      WHERE id = ANY($1) AND ((entity_id IS NULL AND uploaded_by = $4) OR (entity_type = $2 AND entity_id = $3))`, [list, entityType, entityId, user.id]);
  return rowCount;
}

// Anexos dos comentários da revisão do vídeo: { [commentId]: [anexos] }
async function forReviews(ids) {
  if (!ids.length) return {};
  const { rows } = await db.query("SELECT * FROM attachments WHERE entity_type = 'review' AND entity_id = ANY($1) ORDER BY id", [ids]);
  const out = {};
  for (const a of rows) (out[a.entity_id] ||= []).push(a);
  return out;
}

const forEntity = async (type, id) => (await db.query('SELECT * FROM attachments WHERE entity_type = $1 AND entity_id = $2 ORDER BY id', [type, id])).rows;

// Anexos de vários comentários de uma vez: { [commentId]: [anexos] }
async function forComments(commentIds) {
  if (!commentIds.length) return {};
  const { rows } = await db.query("SELECT * FROM attachments WHERE entity_type = 'comment' AND entity_id = ANY($1) ORDER BY id", [commentIds]);
  const out = {};
  for (const a of rows) (out[a.entity_id] ||= []).push(a);
  return out;
}

// Quem vê: solto = só quem enviou; de tarefa = quem lê tarefas; de comentário = quem lê o item do comentário.
async function canView(user, att) {
  if (!att.entity_id) return String(att.uploaded_by) === String(user.id);
  if (att.entity_type === 'task') return can(user.role, 'tasks.read');
  if (att.entity_type === 'review') return can(user.role, 'episodes.read');
  const { rows: [c] } = await db.query('SELECT entity_type FROM comments WHERE id = $1', [att.entity_id]);
  return Boolean(c) && require('./comments').canSee(user.role, c.entity_type);
}

const canRemove = (user, att) => String(att.uploaded_by) === String(user.id) || can(user.role, 'tasks.manage');

async function remove(att) {
  await b2.deleteObject(att.storage_key).catch((err) => console.error('[anexos] apagar do bucket:', err.message));
  await db.query('DELETE FROM attachments WHERE id = $1', [att.id]);
}

// Rotina de limpeza: anexo solto há mais de 2 dias, ou cujo item (tarefa/comentário) deixou de existir.
async function purge() {
  const { rows } = await db.query(
    `SELECT * FROM attachments WHERE (entity_id IS NULL AND created_at < now() - interval '2 days')
        OR (entity_type = 'task' AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = entity_id))
        OR (entity_type = 'comment' AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.id = entity_id))
        OR (entity_type = 'review' AND NOT EXISTS (SELECT 1 FROM episode_comments c WHERE c.id = entity_id)) LIMIT 200`);
  for (const a of rows) await remove(a);
  return rows.length;
}

const presign = (att, { download = false } = {}) => b2.presignGet(att.storage_key, { expires: 6 * 3600, download: download || att.kind === 'file' ? att.filename : null, contentType: att.content_type });

module.exports = { LIMITS, MAX_BODY, FILE_TYPES, detect, imageType, store, link, forEntity, forComments, forReviews, canView, canRemove, remove, purge, presign };
