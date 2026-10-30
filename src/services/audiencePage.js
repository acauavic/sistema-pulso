// Plateia: página própria de um convidado (/plateia/com/:slug) e os links de parceiro com participação isenta.
// A página só existe enquanto o convidado está na agenda pública (Agendado, aberto para plateia, gravação no futuro): o pedido
// segue o mesmo caminho da página geral (lead, avaliação, seleção). Quem entra pelo link de um parceiro pede sem cobrança, até o
// limite de vagas do link; esgotado, vê o valor normal.
const crypto = require('crypto');
const db = require('../db/pool');
const { slugify } = require('../utils/format');

const MAX_PHOTOS = 6;
// Pedido que ainda ocupa uma vaga do parceiro (quem não foi selecionado ou desistiu devolve a vaga).
const HOLDING = "status NOT IN ('nao_selecionado', 'desistiu')";
const PAGE_FIELDS = 'audience_page_enabled, audience_slug, audience_intro, audience_arrival, audience_extra_title, audience_extra';

// Endereço da página: nome do convidado, sem repetir o de outro.
async function ensureSlug(guest) {
  if (guest.audience_slug) return guest.audience_slug;
  const base = slugify(guest.name).slice(0, 60) || `convidado-${guest.id}`;
  for (let n = 1; n < 50; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const { rows } = await db.query('UPDATE guests SET audience_slug = $2 WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM guests WHERE audience_slug = $2 AND id <> $1) RETURNING audience_slug', [guest.id, slug]);
    if (rows[0]) return rows[0].audience_slug;
  }
  throw new Error('Não consegui criar o endereço da página.');
}

async function setEnabled(guestId, on) {
  const { rows: [g] } = await db.query('SELECT id, name, audience_slug FROM guests WHERE id = $1', [guestId]);
  if (!g) return null;
  if (on) await ensureSlug(g);
  await db.query('UPDATE guests SET audience_page_enabled = $2 WHERE id = $1', [g.id, on]);
  return g;
}

// "19:30", "19h30", "19h" -> "19:30:00"; vazio -> null; inválido -> NaN.
function parseTime(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?:[:h](\d{2})?)?$/);
  if (!m) return NaN;
  const h = Number(m[1]); const min = Number(m[2] || 0);
  return h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00` : NaN;
}
const timeLabel = (t) => { if (!t) return ''; const [h, m] = String(t).split(':').map(Number); return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`; };

const text = (v, n) => { const s = String(v ?? '').replace(/\r/g, '').trim().slice(0, n); return s || null; };
function parse(body) {
  const arrival = parseTime(body.arrival);
  if (Number.isNaN(arrival)) return { error: 'Horário de chegada inválido. Use, por exemplo, 19:30.' };
  const v = { intro: text(body.intro, 1200), arrival, extraTitle: text(body.extra_title, 80), extra: text(body.extra, 1500) };
  if (v.extraTitle && !v.extra) return { error: 'O bloco extra tem título, mas falta o texto.' };
  return { values: v };
}
async function update(guestId, v) {
  await db.query('UPDATE guests SET audience_intro = $2, audience_arrival = $3, audience_extra_title = $4, audience_extra = $5 WHERE id = $1',
    [guestId, v.intro, v.arrival, v.extraTitle, v.extra]);
}

const photos = (guestId) => db.query('SELECT id, storage_key FROM guest_audience_photos WHERE guest_id = $1 ORDER BY position, id', [guestId]).then((r) => r.rows);
async function addPhoto(guestId, key) {
  const { rows: [n] } = await db.query('SELECT count(*)::int AS n, coalesce(max(position), -1) + 1 AS next FROM guest_audience_photos WHERE guest_id = $1', [guestId]);
  if (n.n >= MAX_PHOTOS) return { error: `A página aceita até ${MAX_PHOTOS} fotos. Tire uma antes de enviar outra.` };
  const { rows: [p] } = await db.query('INSERT INTO guest_audience_photos (guest_id, storage_key, position) VALUES ($1, $2, $3) RETURNING id', [guestId, key, n.next]);
  return { id: p.id };
}

// ---------------------------------------------------------------- parceiros
async function partners(guestId) {
  const { rows } = await db.query(
    `SELECT p.*, (SELECT count(*)::int FROM plateia_leads l WHERE l.partner_id = p.id AND l.${HOLDING}) AS used,
            (SELECT count(*)::int FROM plateia_leads l WHERE l.partner_id = p.id) AS total
       FROM plateia_partners p WHERE p.guest_id = $1 ORDER BY p.active DESC, p.id`, [guestId]);
  return rows.map((p) => ({ ...p, left: p.slots == null ? null : Math.max(0, p.slots - p.used) }));
}

function parsePartner(body) {
  const name = text(body.name, 80);
  if (!name || name.length < 2) return { error: 'Dê o nome do parceiro (aparece na página para quem recebe o link).' };
  const raw = String(body.slots ?? '').trim();
  const slots = raw ? Number.parseInt(raw, 10) : null;
  if (raw && (!Number.isInteger(slots) || slots < 1 || slots > 500)) return { error: 'Vagas: um número de 1 a 500 (ou deixe vazio para sem limite).' };
  return { values: { name, slots } };
}
async function createPartner(guestId, { name, slots }, userId) {
  const token = crypto.randomBytes(6).toString('base64url');
  const { rows: [p] } = await db.query('INSERT INTO plateia_partners (guest_id, name, token, slots, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *', [guestId, name, token, slots, userId]);
  return p;
}
async function updatePartner(guestId, id, { name, slots, active }) {
  const { rows: [row] } = await db.query(
    'UPDATE plateia_partners SET name = coalesce($3, name), slots = CASE WHEN $4::boolean THEN $5 ELSE slots END, active = coalesce($6, active) WHERE id = $2 AND guest_id = $1 RETURNING *',
    [guestId, id, name ?? null, slots !== undefined, slots ?? null, active ?? null]);
  return row || null;
}

// O parceiro do link, se ainda vale para esta gravação, e se ainda há vaga isenta: { partner, full }.
async function partnerFor(guestId, token) {
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(String(token || ''))) return { partner: null, full: false };
  const { rows: [p] } = await db.query(
    `SELECT p.*, (SELECT count(*)::int FROM plateia_leads l WHERE l.partner_id = p.id AND l.${HOLDING}) AS used
       FROM plateia_partners p WHERE p.token = $1 AND p.guest_id = $2 AND p.active`, [token, guestId]);
  if (!p) return { partner: null, full: false };
  return { partner: p, full: p.slots != null && p.used >= p.slots };
}

// ---------------------------------------------------------------- página pública
// O convidado da página, se ela está ativa e a gravação está na agenda pública (senão a página mostra que encerrou).
async function bySlug(slug) {
  if (!/^[a-z0-9-]{1,80}$/.test(String(slug || ''))) return null;
  const { rows: [g] } = await db.query(
    `SELECT id, name, instagram, job_title, company, topic, bio, proposed_at, audience_status, (photo_key IS NOT NULL) AS has_photo, ${PAGE_FIELDS},
            (status = 'agendado' AND audience_enabled AND proposed_at > now()) AS on_agenda
       FROM guests WHERE audience_slug = $1 AND audience_page_enabled`, [slug]);
  return g || null;
}

module.exports = { MAX_PHOTOS, HOLDING, ensureSlug, setEnabled, parse, update, parseTime, timeLabel, photos, addPhoto, partners, parsePartner, createPartner, updatePartner, partnerFor, bySlug };
