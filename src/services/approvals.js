// Aprovação por link: quem aprova pauta, roteiro, vídeo e capas está fora do sistema (no WhatsApp) e só recebe um link.
// O link abre uma página pública no endereço e com a marca do projeto; a pessoa escreve o nome, aprova ou pede ajustes.
// Regras: cada link vale para UMA versão (a cópia da pauta enviada, a versão do vídeo editado); mudou depois, o link antigo
// mostra "substituída" e não aceita resposta. Um link responde uma vez só. Vale 30 dias e pode ser revogado.
const crypto = require('crypto');
const db = require('../db/pool');
const richText = require('./richText');
const { publicUrl } = require('./publicUrl');

const TTL_DAYS = 30;
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const KIND_LABEL = { pauta: 'Pauta', roteiro: 'Roteiro', video: 'Vídeo', capas: 'Capas' };
const newToken = () => crypto.randomBytes(24).toString('base64url');
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanBlock = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, max);
const epNo = (n, prefix) => (n == null ? '' : `${prefix || 'EP.'}${String(n).padStart(3, '0')}`);

const pageUrl = (link) => publicUrl(link.project_id, `/aprovar/${link.token}`);

// ---------------------------------------------------------------- pauta: cópia por envio
async function latestVersion(pautaId, q = db) {
  const { rows: [v] } = await q.query('SELECT * FROM pauta_versions WHERE pauta_id = $1 ORDER BY n DESC LIMIT 1', [pautaId]);
  return v || null;
}
const sameContent = (a, b) => (a.body_html || '') === (b.body_html || '') && (a.link || '') === (b.link || '') && (a.body || '') === (b.body || '');

// A cópia que vai no link: a última, se o texto não mudou; senão, uma nova.
async function snapshot(pauta, userId, q = db) {
  const last = await latestVersion(pauta.id, q);
  if (last && sameContent(last, pauta)) return last;
  const { rows: [v] } = await q.query(
    `INSERT INTO pauta_versions (pauta_id, n, body, body_html, link, created_by)
     VALUES ($1, coalesce((SELECT max(n) FROM pauta_versions WHERE pauta_id = $1), 0) + 1, $2, $3, $4, $5) RETURNING *`,
    [pauta.id, pauta.body, pauta.body_html, pauta.link, userId || null]);
  return v;
}

// "O que mudou" desde a versão que voltou com ajustes: parágrafos novos e os que saíram (comparação por parágrafo, sem acento de
// formatação, que é o que importa para quem aprova pelo celular).
function paragraphs(v) {
  const text = v ? (v.link ? v.link : (richText.toText(v.body_html || '') || v.body || '')) : '';
  return text.split(/\n+/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function changes(before, after) {
  if (!before || !after) return null;
  const a = paragraphs(before); const b = paragraphs(after);
  const setA = new Set(a); const setB = new Set(b);
  const added = b.filter((p) => !setA.has(p)); const removed = a.filter((p) => !setB.has(p));
  return added.length || removed.length ? { added, removed } : null;
}

// A versão que voltou com ajustes por último (a comparação parte dela).
async function lastRejectedVersion(pautaId, beforeVersionN) {
  const { rows: [v] } = await db.query(
    `SELECT v.* FROM approval_links l JOIN pauta_versions v ON v.id = l.pauta_version_id
      WHERE l.pauta_id = $1 AND l.answer = 'ajustes' AND v.n < $2 ORDER BY v.n DESC LIMIT 1`, [pautaId, beforeVersionN]);
  return v || null;
}

// ---------------------------------------------------------------- criar
async function insertLink(fields, q = db) {
  const { rows: [link] } = await q.query(
    `INSERT INTO approval_links (token, project_id, kind, pauta_id, pauta_version_id, episode_id, file_id, sent_to, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + ($10 || ' days')::interval) RETURNING *`,
    [newToken(), fields.projectId, fields.kind, fields.pautaId || null, fields.versionId || null, fields.episodeId || null, fields.fileId || null,
      fields.sentTo || null, fields.userId || null, String(TTL_DAYS)]);
  return link;
}
// Link novo para o mesmo item: o anterior que ainda esperava resposta é substituído (revogado sem autor).
const supersede = (where, params, q = db) => q.query(
  `UPDATE approval_links SET revoked_at = now() WHERE ${where} AND answered_at IS NULL AND revoked_at IS NULL`, params);

async function createForPauta(pautaId, { to, user }) {
  const pautas = require('./pautas');
  const pauta = await pautas.get(pautaId);
  if (!pauta) return { error: 'Pauta não encontrada.' };
  if (!pauta.body && !pauta.link) return { error: 'Escreva a pauta antes de mandar para aprovação.' };
  const sent = await pautas.send(pauta.id, { to, user });
  if (sent.error) return sent;
  const version = await snapshot(pauta, user.id);
  await supersede('pauta_id = $1', [pauta.id]);
  const link = await insertLink({ projectId: pauta.project_id, kind: 'pauta', pautaId: pauta.id, versionId: version.id, sentTo: sent.pauta.sent_to, userId: user.id });
  return { link, pauta: { ...pauta, ...sent.pauta } };
}

const latestEdited = (episodeId) => db.query(
  "SELECT id, version, storage_key FROM episode_files WHERE episode_id = $1 AND kind = 'editado' AND status = 'pronto' ORDER BY version DESC, id DESC LIMIT 1",
  [episodeId]).then((r) => r.rows[0] || null);

async function createForVideo(ep, { to, user }) {
  if (ep.status !== 'em_revisao') return { error: 'O link de aprovação do vídeo sai quando ele está em revisão.' };
  const file = await latestEdited(ep.id);
  if (!file) return { error: 'Suba o vídeo editado antes de mandar para aprovação.' };
  await supersede("episode_id = $1 AND kind = 'video'", [ep.id]);
  const link = await insertLink({ projectId: ep.project_id, kind: 'video', episodeId: ep.id, fileId: file.id, sentTo: clean(to, 120) || 'o grupo do WhatsApp', userId: user.id });
  await require('./production').addEvent(ep.id, user.id, 'aprovacao', `Link de aprovação do vídeo (v${file.version}) enviado para ${link.sent_to} por ${user.name}`);
  return { link };
}

const thumbs = (episodeId) => db.query(
  "SELECT id, model, angle, approved, updated_at FROM episode_covers WHERE episode_id = $1 AND clip_id IS NULL AND kind = 'youtube_thumb' ORDER BY position, id",
  [episodeId]).then((r) => r.rows);

async function createForCovers(ep, { to, user }) {
  if (!(await thumbs(ep.id)).length) return { error: 'Gere as capas antes de mandar para aprovação.' };
  await supersede("episode_id = $1 AND kind = 'capas'", [ep.id]);
  const link = await insertLink({ projectId: ep.project_id, kind: 'capas', episodeId: ep.id, sentTo: clean(to, 120) || 'o grupo do WhatsApp', userId: user.id });
  await require('./production').addEvent(ep.id, user.id, 'aprovacao', `Link de aprovação das capas enviado para ${link.sent_to} por ${user.name}`);
  return { link };
}

// ---------------------------------------------------------------- ler
const SELECT = `SELECT l.*, p.kind AS pauta_kind, p.state AS pauta_state, p.body AS pauta_body, p.body_html AS pauta_body_html, p.link AS pauta_link,
    p.due_on AS pauta_due_on, p.owner_id AS pauta_owner_id,
    coalesce(e.id, pe.id) AS ep_id, coalesce(e.number, pe.number) AS ep_number, coalesce(e.title, pe.title) AS ep_title,
    coalesce(e.status, pe.status) AS ep_status, coalesce(e.editor_id, pe.editor_id) AS ep_editor_id, g.name AS guest_name,
    pr.number_prefix, pr.public_name, pr.name AS project_name
  FROM approval_links l
  LEFT JOIN pautas p ON p.id = l.pauta_id
  LEFT JOIN episodes e ON e.id = l.episode_id
  LEFT JOIN episodes pe ON pe.id = p.episode_id
  LEFT JOIN guests g ON g.id = coalesce(p.guest_id, e.guest_id, pe.guest_id)
  JOIN projects pr ON pr.id = l.project_id`;

async function byToken(token) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const { rows: [l] } = await db.query(`${SELECT} WHERE l.token = $1`, [token]);
  return l || null;
}
const byId = (id) => db.query(`${SELECT} WHERE l.id = $1`, [id]).then((r) => r.rows[0] || null);

// Estado do link: aberto, respondido, vencido, revogado (ou substituído por um mais novo) ou substituído (a versão mudou).
async function stateOf(l) {
  if (l.answered_at) return 'respondido';
  if (l.revoked_at) return l.revoked_by ? 'revogado' : 'substituido';
  if (new Date(l.expires_at) < new Date()) return 'vencido';
  if (l.kind === 'pauta') {
    const v = await db.query('SELECT * FROM pauta_versions WHERE id = $1', [l.pauta_version_id]).then((r) => r.rows[0]);
    if (!v || !sameContent(v, { body: l.pauta_body, body_html: l.pauta_body_html, link: l.pauta_link })) return 'substituido';
  }
  if (l.kind === 'video') {
    const file = await latestEdited(l.episode_id);
    if (!file || file.id !== l.file_id || l.ep_status !== 'em_revisao') return 'substituido';
  }
  return 'aberto';
}

// Título que aparece no link e na mensagem: "Pauta · V.004 · Título".
function headline(l) {
  const what = l.kind === 'pauta' ? KIND_LABEL[l.pauta_kind] : KIND_LABEL[l.kind];
  const ep = l.ep_number ? epNo(l.ep_number, l.number_prefix) : '';
  return [what, ep, l.ep_title || l.guest_name].filter(Boolean).join(' · ');
}

// A mensagem para colar no WhatsApp.
function message(l) {
  const ask = l.kind === 'video' ? 'Para assistir e aprovar' : l.kind === 'capas' ? 'Para ver e aprovar as capas' : 'Para ler e aprovar';
  const due = l.kind === 'pauta' && l.pauta_due_on ? `\nPrazo: ${new Date(l.pauta_due_on).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}` : '';
  return `${headline(l)}\n\n${ask}: ${pageUrl(l)}${due}`;
}

// O que a página pública mostra, conforme o tipo.
async function content(l) {
  if (l.kind === 'pauta') {
    const v = await db.query('SELECT * FROM pauta_versions WHERE id = $1', [l.pauta_version_id]).then((r) => r.rows[0]);
    const before = v ? await lastRejectedVersion(l.pauta_id, v.n) : null;
    return { version: v, html: v ? richText.display(v.body_html, v.body) : '', link: v && v.link, diff: changes(before, v) };
  }
  if (l.kind === 'video') {
    const { rows: [file] } = await db.query('SELECT id, version, storage_key FROM episode_files WHERE id = $1', [l.file_id]);
    const { rows: comments } = await db.query(
      `SELECT at_ms, end_ms, body, external_name FROM episode_comments WHERE approval_link_id = $1 ORDER BY at_ms NULLS LAST, id`, [l.id]);
    return { file, comments };
  }
  return { covers: await thumbs(l.episode_id) };
}

// Os links de um item, para a tela do painel (o mais novo primeiro).
async function listFor({ pautaId = null, episodeId = null, kind = null }) {
  const where = pautaId ? 'l.pauta_id = $1' : `l.episode_id = $1 AND l.kind = $2`;
  const params = pautaId ? [pautaId] : [episodeId, kind];
  const { rows } = await db.query(`${SELECT} WHERE ${where} ORDER BY l.created_at DESC, l.id DESC LIMIT 10`, params);
  for (const r of rows) { r.state = await stateOf(r); r.url = pageUrl(r); r.message = message(r); }
  return rows;
}

// ---------------------------------------------------------------- responder
// Quem está de fora vira um "ator" sem conta: o nome que escreveu, marcado "pelo link". `trusted` deixa a mudança de etapa
// acontecer sem perfil (quem decidiu foi quem a equipe mandou o link).
const actorOf = (name) => ({ id: null, name: `${name} (pelo link)`, role: null });

async function notifyAnswer(l, approved, name) {
  const users = [l.created_by, l.pauta_owner_id, l.kind === 'video' ? l.ep_editor_id : null].filter(Boolean);
  if (!users.length) return;
  const title = `${headline(l)}: ${approved ? 'aprovado' : 'ajustes pedidos'} por ${name}`;
  const url = l.ep_id ? `/episodios/${l.ep_id}${l.kind === 'pauta' ? '#pauta' : l.kind === 'capas' ? '?capas=youtube#capas' : '#revisao'}` : '/episodios?view=pautas';
  await require('./notify').notify({ type: 'aprovacao', users: [...new Set(users)], title, body: l.answer_note || null, url,
    entity: l.ep_id ? { type: 'episode', id: l.ep_id } : null, projectId: l.project_id });
}

// Devolve { ok, link } ou { error }. `comments`: [{ at_ms, end_ms, body }] (só vídeo); `covers`: ids aprovados (só capas).
async function answer(token, { approved, name, note = '', comments = [], covers = [] }) {
  const l = await byToken(token);
  if (!l) return { error: 'Link não encontrado.', code: 404 };
  const state = await stateOf(l);
  if (state !== 'aberto') return { error: 'Este link não aceita mais resposta.', state };
  const who = clean(name, 80);
  if (!who) return { error: 'Escreva o seu nome.' };
  const what = cleanBlock(note, 2000);
  const notes = (Array.isArray(comments) ? comments : []).map((c) => ({
    at: Number.isFinite(Number(c.at_ms)) && Number(c.at_ms) >= 0 ? Math.round(Number(c.at_ms)) : null,
    end: Number.isFinite(Number(c.end_ms)) && Number(c.end_ms) > 0 ? Math.round(Number(c.end_ms)) : null,
    body: cleanBlock(c.body, 2000),
  })).filter((c) => c.body).slice(0, 50);
  if (!approved && !what && !notes.length) return { error: 'Diga o que precisa mudar.' };

  // a resposta vale uma vez: quem chega primeiro marca o link
  const { rows: [marked] } = await db.query(
    `UPDATE approval_links SET answered_at = now(), answer = $2, answer_name = $3, answer_note = $4
      WHERE id = $1 AND answered_at IS NULL AND revoked_at IS NULL RETURNING id`, [l.id, approved ? 'aprovado' : 'ajustes', who, what || null]);
  if (!marked) return { error: 'Este link já foi respondido.', state: 'respondido' };
  const done = { ...l, answered_at: new Date(), answer: approved ? 'aprovado' : 'ajustes', answer_name: who, answer_note: what || null };

  if (l.kind === 'pauta') {
    const ev = (type, msg) => db.query('INSERT INTO pauta_events (pauta_id, user_id, type, message) VALUES ($1, NULL, $2, $3)', [l.pauta_id, type, msg.slice(0, 500)]);
    if (approved) {
      await db.query("UPDATE pautas SET state = 'aprovada', approved_by = $2, review_note = NULL, updated_at = now() WHERE id = $1", [l.pauta_id, `${who} (pelo link)`]);
      await ev('aprovada', `Aprovada por ${who} pelo link${what ? `: ${what}` : ''}`);
    } else {
      await db.query("UPDATE pautas SET state = 'ajustes', review_note = $2, updated_at = now() WHERE id = $1", [l.pauta_id, what.slice(0, 500)]);
      await ev('ajustes', `${who} pediu ajustes pelo link: ${what}`);
    }
  }

  if (l.kind === 'video') {
    const { rows: [file] } = await db.query('SELECT id, version FROM episode_files WHERE id = $1', [l.file_id]);
    const insert = (c) => db.query(
      `INSERT INTO episode_comments (episode_id, file_id, version, at_ms, end_ms, body, body_html, external_name, approval_link_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [l.episode_id, file.id, file.version, c.at, c.at != null && c.end && c.end > c.at ? c.end : null, c.body,
        `<p>${require('../utils/format').escHtml(c.body).replace(/\n/g, '<br>')}</p>`, who, l.id]);
    for (const c of notes) await insert(c);
    // pedir ajustes sem comentário na minutagem: o recado entra como comentário geral (é o que o editor vê na lista)
    if (!approved && what) await insert({ at: null, end: null, body: what });
    const prod = require('./production');
    const { rows: [ep] } = await db.query('SELECT * FROM episodes WHERE id = $1', [l.episode_id]);
    await prod.addEvent(ep.id, null, 'aprovacao', `${approved ? 'Aprovado' : 'Ajustes pedidos'} por ${who} pelo link (v${file.version})${notes.length ? ` · ${notes.length} comentário(s)` : ''}`);
    const moved = await prod.move(ep, approved ? 'em_finalizacao' : 'em_edicao', actorOf(who), { trusted: true });
    if (moved.error) console.error('Aprovação por link (etapa):', moved.error);
    if (approved && what) await insert({ at: null, end: null, body: what }).then(() =>
      db.query('UPDATE episode_comments SET resolved = true, resolved_at = now() WHERE approval_link_id = $1 AND at_ms IS NULL', [l.id]));
  }

  if (l.kind === 'capas') {
    const ids = (Array.isArray(covers) ? covers : [covers]).map(Number).filter(Number.isInteger);
    const prod = require('./production');
    if (approved) {
      const { rows } = await db.query(
        `UPDATE episode_covers SET approved = true, stale = false WHERE episode_id = $1 AND clip_id IS NULL AND kind = 'youtube_thumb' AND id = ANY($2::int[]) RETURNING id`,
        [l.episode_id, ids]);
      await prod.addEvent(l.episode_id, null, 'aprovacao', `${rows.length} capa(s) aprovada(s) por ${who} pelo link${what ? `: ${what}` : ''}`);
    } else {
      await prod.addEvent(l.episode_id, null, 'aprovacao', `${who} pediu ajustes nas capas pelo link: ${what}`);
    }
  }

  try { await notifyAnswer(done, approved, who); } catch (err) { console.error('Aprovação por link (aviso):', err.message); }
  return { ok: true, link: done };
}

async function revoke(id, user) {
  const { rows: [l] } = await db.query(
    'UPDATE approval_links SET revoked_at = now(), revoked_by = $2 WHERE id = $1 AND answered_at IS NULL AND revoked_at IS NULL RETURNING *', [id, user.id]);
  return l || null;
}

// Capas: a escolha de capas aprovadas precisa ter ao menos uma.
const needsCover = (l, approved, covers) => l.kind === 'capas' && approved && !(Array.isArray(covers) ? covers : [covers]).filter(Boolean).length;

module.exports = {
  TTL_DAYS, TOKEN_RE, KIND_LABEL, pageUrl, snapshot, latestVersion, changes, paragraphs, createForPauta, createForVideo, createForCovers,
  byToken, byId, stateOf, headline, message, content, listFor, answer, revoke, thumbs, needsCover,
};
