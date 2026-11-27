// Pauta (temas e perguntas) e roteiro (o texto do vídeo): um documento por vídeo, ou do convidado enquanto o episódio não existe.
// Quem aprova está no WhatsApp, fora do sistema: o sistema não manda nada sozinho. "Copiar para o WhatsApp" copia o texto e
// marca Enviada; a resposta é registrada por gestão ou produtora. Tudo fica no histórico.
const db = require('../db/pool');
const richText = require('./richText');

const KINDS = {
  pauta: { label: 'Pauta', hint: 'Temas, perguntas e a ordem da conversa' },
  roteiro: { label: 'Roteiro', hint: 'O texto que vai ser dito no vídeo' },
};
// O chip de cada estado segue as cores que já existem: nada de verde, que é a cor de ação.
const STATES = {
  a_fazer: { label: 'A fazer', badge: 'b-st-pre_producao' },
  elaboracao: { label: 'Em elaboração', badge: 'b-st-gravado' },
  aprovacao: { label: 'Enviada para aprovação', badge: 'b-st-agendado' }, // plum: está com gente de fora
  ajustes: { label: 'Ajustes pedidos', badge: 'b-amber' },
  aprovada: { label: 'Aprovada', badge: 'b-green' },
};
const ORDER = Object.keys(STATES);
const isKind = (k) => Object.prototype.hasOwnProperty.call(KINDS, k);

const SELECT = `SELECT p.*, u.name AS owner_name, e.number AS episode_number, e.title AS episode_title, e.status AS episode_status,
    g.name AS guest_name
  FROM pautas p LEFT JOIN users u ON u.id = p.owner_id LEFT JOIN episodes e ON e.id = p.episode_id LEFT JOIN guests g ON g.id = p.guest_id`;

const get = (id) => db.query(`${SELECT} WHERE p.id = $1`, [id]).then((r) => r.rows[0] || null);

// Os documentos de um vídeo (ou de um convidado): sempre os dois tipos, com o que ainda não existe como "A fazer".
async function forOwner({ episodeId = null, guestId = null } = {}) {
  const { rows } = await db.query(`${SELECT} WHERE ${episodeId ? 'p.episode_id = $1' : 'p.guest_id = $1'} ORDER BY p.kind`, [episodeId || guestId]);
  return Object.keys(KINDS).map((kind) => rows.find((r) => r.kind === kind) || { kind, state: 'a_fazer', novo: true });
}

// Para o quadro e para o "Seu dia": as pautas do recorte, com o que está atrasado primeiro.
async function list({ projectIds = null, states = null } = {}) {
  const where = []; const params = [];
  if (projectIds) { params.push(projectIds); where.push(`p.project_id = ANY($${params.length}::int[])`); }
  if (states) { params.push(states); where.push(`p.state = ANY($${params.length}::text[])`); }
  const { rows } = await db.query(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY (p.due_on IS NULL), p.due_on, p.id DESC LIMIT 500`, params);
  return rows;
}

const addEvent = (id, userId, type, message, q = db) => q.query(
  'INSERT INTO pauta_events (pauta_id, user_id, type, message) VALUES ($1, $2, $3, $4)', [id, userId || null, type, String(message).slice(0, 500)]);

const events = (id) => db.query(
  `SELECT ev.*, u.name AS user_name FROM pauta_events ev LEFT JOIN users u ON u.id = ev.user_id
    WHERE ev.pauta_id = $1 ORDER BY ev.created_at DESC, ev.id DESC LIMIT 100`, [id]).then((r) => r.rows);

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const isIsoDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const link = (v) => (/^https?:\/\/[^\s]+$/i.test(String(v || '').trim()) ? String(v).trim().slice(0, 500) : null);

// Escrever ou editar. O documento nasce quando alguém escreve: ganha o projeto do vídeo (ou do convidado) e vai para Em elaboração.
// Devolve { pauta } ou { error }.
async function save({ episodeId = null, guestId = null, kind, body = {}, user }) {
  if (!isKind(kind)) return { error: 'Documento desconhecido.' };
  const owner = episodeId
    ? await db.query('SELECT project_id FROM episodes WHERE id = $1', [episodeId])
    : await db.query('SELECT project_id FROM guests WHERE id = $1', [guestId]);
  if (!owner.rows.length) return { error: 'Não encontrei o vídeo desta pauta.' };
  const rich = richText.sanitize(body.body_html || '');
  const url = link(body.link);
  if (!rich.html && !url) return { error: 'Escreva a pauta ou cole o link do documento.' };
  const values = {
    project_id: owner.rows[0].project_id,
    body_html: rich.html || null,
    body: rich.text || null,
    link: url,
    owner_id: /^[0-9a-f-]{36}$/i.test(String(body.owner_id || '')) ? body.owner_id : null,
    due_on: isIsoDay(body.due_on) ? body.due_on : null,
  };
  const { rows: [pauta] } = await db.query(
    `INSERT INTO pautas (project_id, episode_id, guest_id, kind, body_html, body, link, owner_id, due_on, state, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'elaboracao', $10)
     ON CONFLICT (${episodeId ? 'episode_id' : 'guest_id'}, kind) WHERE ${episodeId ? 'episode_id' : 'guest_id'} IS NOT NULL
     DO UPDATE SET body_html = EXCLUDED.body_html, body = EXCLUDED.body, link = EXCLUDED.link, owner_id = EXCLUDED.owner_id,
                   due_on = EXCLUDED.due_on, updated_at = now(),
                   state = CASE WHEN pautas.state IN ('a_fazer', 'ajustes') THEN 'elaboracao' ELSE pautas.state END
     RETURNING *`,
    [values.project_id, episodeId, guestId, kind, values.body_html, values.body, values.link, values.owner_id, values.due_on, user.id]);
  await addEvent(pauta.id, user.id, 'escrita', `${KINDS[kind].label} escrita por ${user.name}`);
  return { pauta };
}

// Copiou para o WhatsApp: fica registrado para quem e quando. Daqui em diante a bola está com quem aprova.
async function send(id, { to, user }) {
  const pauta = await get(id);
  if (!pauta) return { error: 'Pauta não encontrada.' };
  if (!pauta.body && !pauta.link) return { error: 'Escreva a pauta antes de mandar para aprovação.' };
  const who = clean(to, 120) || 'o grupo do WhatsApp';
  const { rows: [row] } = await db.query(
    "UPDATE pautas SET state = 'aprovacao', sent_at = now(), sent_to = $2, review_note = NULL, updated_at = now() WHERE id = $1 RETURNING *", [id, who]);
  await addEvent(id, user.id, 'enviada', `Enviada para ${who} por ${user.name}`);
  return { pauta: row };
}

// A resposta de quem aprova (que está fora do sistema) entra por gestão ou produtora.
async function answer(id, { approved, by = '', note = '', user }) {
  const pauta = await get(id);
  if (!pauta) return { error: 'Pauta não encontrada.' };
  if (approved) {
    const who = clean(by, 120);
    const { rows: [row] } = await db.query(
      "UPDATE pautas SET state = 'aprovada', approved_by = $2, review_note = NULL, updated_at = now() WHERE id = $1 RETURNING *", [id, who || null]);
    await addEvent(id, user.id, 'aprovada', `Aprovada${who ? ` por ${who}` : ''} · registrado por ${user.name}`);
    return { pauta: row };
  }
  const what = clean(note, 500);
  if (!what) return { error: 'Diga o que pediram para ajustar.' };
  const { rows: [row] } = await db.query(
    "UPDATE pautas SET state = 'ajustes', review_note = $2, updated_at = now() WHERE id = $1 RETURNING *", [id, what]);
  await addEvent(id, user.id, 'ajustes', `Pediram ajustes: ${what}`);
  return { pauta: row };
}

// O texto que vai para o WhatsApp: puro, legível, sem HTML. Com link, vai o link.
function whatsappText(pauta, { prefix = 'EP.' } = {}) {
  const head = [KINDS[pauta.kind].label.toUpperCase(),
    pauta.episode_number ? `${prefix}${String(pauta.episode_number).padStart(3, '0')}` : null,
    pauta.episode_title || pauta.guest_name || null].filter(Boolean).join(' · ');
  const corpo = pauta.link ? pauta.link : richText.toText(pauta.body_html || '') || pauta.body || '';
  const prazo = pauta.due_on ? `\n\nPrazo para a resposta: ${new Date(pauta.due_on).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}` : '';
  return `${head}\n\n${corpo}${prazo}`.trim();
}

// O convidado virou episódio: a pauta escrita no cadastro acompanha (sem duplicar o que o episódio já tem).
async function moveToEpisode(guestId, episodeId) {
  await db.query(
    `UPDATE pautas p SET episode_id = $2, guest_id = NULL, updated_at = now()
      WHERE p.guest_id = $1 AND NOT EXISTS (SELECT 1 FROM pautas x WHERE x.episode_id = $2 AND x.kind = p.kind)`, [guestId, episodeId]);
}

// Para o "Seu dia": as pautas que travaram — atrasadas, ou que voltaram com ajustes. No máximo 5.
async function stuck({ projectIds = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const params = [today]; let w = '';
  if (projectIds) { params.push(projectIds); w = ` AND p.project_id = ANY($${params.length}::int[])`; }
  const { rows } = await db.query(
    `${SELECT} WHERE p.state <> 'aprovada' AND (p.state = 'ajustes' OR (p.due_on IS NOT NULL AND p.due_on < $1::date))${w}
      ORDER BY (p.state <> 'ajustes'), p.due_on NULLS LAST, p.id LIMIT 5`, params);
  return rows;
}

module.exports = { KINDS, STATES, ORDER, isKind, get, forOwner, list, events, save, send, answer, whatsappText, moveToEpisode, stuck };
