// Link do estúdio: o estúdio sobe o material da gravação direto para o episódio, por um link público (/estudio/<token>), sem login.
// Nasce com o episódio (gravação feita). Fica aberto até o estúdio clicar "Terminei o envio", alguém fechar no painel ou passar
// 7 dias sem uso. "Pedir reenvio" fecha o atual e cria outro (o material que já chegou continua no episódio).
// O link só deixa enviar: não mostra nem baixa nada, e só enxerga os arquivos que ele mesmo criou (episode_files.upload_link_id).
const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config');

const IDLE_DAYS = 7;
const MAX_TOTAL_BYTES = 1024 ** 4; // 1 TB somados por link
const MAX_FILES = 500;
const TOKEN_RE = /^[A-Za-z0-9_-]{40,60}$/;

const EXT = {
  bruto_video: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mxf', 'mts', 'm2ts', 'braw', 'r3d', 'mpg', 'mpeg', 'wmv', 'insv', 'lrv'],
  bruto_audio: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'aif', 'aiff', 'ogg', 'opus', 'wma'],
  foto: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff', 'dng', 'cr2', 'cr3', 'arw', 'nef', 'gif'],
};
// Tipo pelo nome do arquivo (o estúdio não classifica; a equipe organiza depois).
function kindFor(name) {
  const ext = String(name).match(/\.([A-Za-z0-9]{1,6})$/)?.[1]?.toLowerCase() || '';
  for (const [kind, list] of Object.entries(EXT)) if (list.includes(ext)) return kind;
  return 'outro';
}
// Arquivos de sistema que vêm junto quando se arrasta uma pasta: não sobem.
const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*|\.[^/]*)$/i;
const isJunk = (path) => JUNK.test(String(path));

// Caminho relativo seguro ("CAM_A/CLIP/C0001.MP4"): sem "..", sem barra no começo, segmentos limpos. Devolve { path, label, filename }:
// o rótulo inicial é a pasta de cima (a câmera, em geral) e o nome do arquivo junta o resto com "_".
function splitPath(raw) {
  const parts = String(raw || '').replace(/\\/g, '/').split('/').map((s) => s.normalize('NFC').replace(/[\u0000-\u001f:*?"<>|]/g, '_').trim())
    .filter((s) => s && s !== '.' && s !== '..');
  if (!parts.length) return null;
  const path = parts.join('/').slice(0, 400);
  if (parts.length === 1) return { path, label: null, filename: parts[0] };
  return { path, label: parts[0].slice(0, 80), filename: parts.slice(1).join('_') };
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
const urlOf = (link) => `${config.appBaseUrl.replace(/\/+$/, '')}/estudio/${link.token}`;
const lastUse = (l) => new Date(l.last_activity_at || l.created_at).getTime();
const isOpen = (l, now = Date.now()) => Boolean(l && !l.finished_at && !l.closed_at && now - lastUse(l) < IDLE_DAYS * 86400000);

// Cria o link aberto do episódio (devolve o que já existe aberto, se houver: dois cliques não criam dois).
async function create(episodeId, userId = null) {
  const open = await current(episodeId);
  if (open && isOpen(open)) return open;
  if (open && !open.finished_at && !open.closed_at) await expire(open);
  try {
    const { rows: [l] } = await db.query('INSERT INTO episode_upload_links (episode_id, token, created_by) VALUES ($1, $2, $3) RETURNING *', [episodeId, newToken(), userId]);
    return l;
  } catch (err) {
    if (err.code !== '23505') throw err;
    return current(episodeId);
  }
}

// O link mais recente do episódio (aberto, concluído ou fechado), ou null.
async function current(episodeId) {
  const { rows: [l] } = await db.query('SELECT * FROM episode_upload_links WHERE episode_id = $1 ORDER BY id DESC LIMIT 1', [episodeId]);
  return l || null;
}

// Link pelo token, só se estiver aberto (fechado, concluído, vencido ou inexistente = null, sem dizer qual).
async function byToken(token) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const { rows: [l] } = await db.query(
    `SELECT l.*, e.number AS episode_number, e.title AS episode_title, g.name AS guest_name
       FROM episode_upload_links l JOIN episodes e ON e.id = l.episode_id LEFT JOIN guests g ON g.id = e.guest_id WHERE l.token = $1`, [token]);
  if (!l) return null;
  if (!isOpen(l)) { if (!l.finished_at && !l.closed_at) await expire(l); return null; }
  return l;
}

async function touch(link, { first = false } = {}) {
  await db.query(`UPDATE episode_upload_links SET last_activity_at = now()${first ? ', first_upload_at = coalesce(first_upload_at, now())' : ''} WHERE id = $1`, [link.id]);
}

// Arquivos deste link (os que a página mostra).
async function files(linkId) {
  const { rows } = await db.query(
    "SELECT id, kind, label, filename, source_path, size_bytes, status, part_size, created_at FROM episode_files WHERE upload_link_id = $1 ORDER BY id", [linkId]);
  return rows;
}
async function summary(linkId) {
  const { rows: [s] } = await db.query(
    `SELECT count(*) FILTER (WHERE status = 'pronto')::int AS ready, count(*) FILTER (WHERE status = 'enviando')::int AS sending,
            coalesce(sum(size_bytes) FILTER (WHERE status = 'pronto'), 0)::bigint AS bytes, coalesce(sum(size_bytes), 0)::bigint AS all_bytes, count(*)::int AS all_files
       FROM episode_files WHERE upload_link_id = $1`, [linkId]);
  return { ready: s.ready, sending: s.sending, bytes: Number(s.bytes), allBytes: Number(s.all_bytes), allFiles: s.all_files };
}
// Cabe mais um arquivo deste tamanho no link? (1 TB e 500 arquivos)
async function fits(link, size) {
  const s = await summary(link.id);
  return s.allFiles < MAX_FILES && s.allBytes + Number(size) <= MAX_TOTAL_BYTES;
}

// Fecha o link e cancela no Backblaze os envios dele que ficaram pela metade (liberam espaço; outro link não os retoma).
async function closeOut(link, fields, params) {
  const { rows: [l] } = await db.query(`UPDATE episode_upload_links SET ${fields} WHERE id = $1 AND finished_at IS NULL AND closed_at IS NULL RETURNING *`, [link.id, ...params]);
  if (!l) return null;
  const prod = require('./production');
  const { rows: half } = await db.query("SELECT * FROM episode_files WHERE upload_link_id = $1 AND status = 'enviando'", [link.id]);
  for (const f of half) await prod.cancelUpload(f).catch((err) => console.error('Link do estúdio: cancelar envio parado:', err.message));
  return { link: l, canceled: half.length };
}
const expire = (link) => closeOut(link, "closed_at = now(), close_reason = 'expirado'", []);
const finish = (link) => closeOut(link, 'finished_at = now()', []);
const close = (link, userId, reason = 'fechado') => closeOut(link, 'closed_at = now(), closed_by = $2, close_reason = $3', [userId || null, reason]);

// Pedir reenvio: fecha o aberto (se houver) e cria outro.
async function resend(episodeId, userId) {
  const cur = await current(episodeId);
  if (cur && !cur.finished_at && !cur.closed_at) await close(cur, userId, 'reenvio');
  return create(episodeId, userId);
}

// Estado para o cartão do painel: aguardando | enviando | concluido | fechado (ou null: episódio sem link).
async function panelState(episodeId) {
  const l = await current(episodeId);
  if (!l) return null;
  const s = await summary(l.id);
  let state = 'aguardando';
  if (l.finished_at) state = 'concluido';
  else if (l.closed_at || !isOpen(l)) state = 'fechado';
  else if (s.ready || s.sending) state = 'enviando';
  return { link: l, url: urlOf(l), state, ...s };
}

const users = async (link) => {
  const { rows } = await db.query("SELECT id FROM users WHERE active AND role IN ('produtora', 'gestao')");
  return [...new Set([...rows.map((r) => r.id), ...(link.created_by ? [link.created_by] : [])])];
};
const epTag = (n) => (n ? `EP.${String(n).padStart(3, '0')}` : 'episódio');
// Avisos para a produção, a gestão e quem gerou o link (o estúdio não é usuário: ninguém é pulado).
async function notifyTeam(link, kind) {
  const s = await summary(link.id);
  const tag = epTag(link.episode_number);
  const title = kind === 'inicio' ? `O estúdio começou a enviar o material do ${tag}` : `Material do ${tag} recebido pelo link do estúdio`;
  const body = kind === 'inicio' ? (link.guest_name || link.episode_title || '') : `${s.ready} arquivo${s.ready === 1 ? '' : 's'} · ${link.guest_name || link.episode_title || ''}`;
  await require('./notify').notify({ type: 'episodio', users: await users(link), title, body, url: `/episodios/${link.episode_id}#material`, entity: { type: 'episode', id: link.episode_id }, dedupe: `estudio-${kind}-${link.id}` });
}

module.exports = { IDLE_DAYS, MAX_TOTAL_BYTES, MAX_FILES, TOKEN_RE, kindFor, isJunk, splitPath, urlOf, isOpen, create, current, byToken, touch, files, summary, fits, finish, close, expire, resend, panelState, notifyTeam, epTag };
