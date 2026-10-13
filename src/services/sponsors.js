// Central de patrocinadores: regras de etapa, links públicos, briefing (formulário), arquivos no Backblaze e dados do portal.
const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config');
const b2 = require('./b2');
const { clean } = require('../utils/format');
const { normalizeUrl } = require('./guestRules');
const { SPONSOR_GOALS, FILE_KINDS } = require('../constants');

async function addEvent(sponsorId, userId, type, message) {
  await db.query('INSERT INTO sponsor_events (sponsor_id, user_id, type, message) VALUES ($1,$2,$3,$4)',
    [sponsorId, userId || null, type, String(message).slice(0, 1000)]);
}

// ---- o que precisa estar preenchido para entrar em cada etapa ----
const REQUIREMENTS = {
  ganho: (s) => [
    !s.tier && 'cota (Ouro ou Diamond)',
    s.value_cents == null && 'valor do patrocínio',
    !s.contact_name && 'nome do responsável na empresa',
    !(s.contact_email || s.contact_phone) && 'e-mail e/ou WhatsApp do responsável na empresa',
  ].filter(Boolean),
  ativo: (s) => [
    !s.tier && 'cota (Ouro ou Diamond)',
    s.value_cents == null && 'valor do patrocínio',
    !s.paid_at && 'data do pagamento confirmado',
  ].filter(Boolean),
};
const STAGE_HINTS = {
  ganho: 'Para entrar em Ganho: cota, valor, nome e e-mail e/ou WhatsApp do responsável na empresa (para enviar o formulário).',
  ativo: 'Para entrar em Ativo: cota, valor e a data do pagamento confirmado.',
};
const missingFor = (stage, sponsor) => (REQUIREMENTS[stage] ? REQUIREMENTS[stage](sponsor) : []);

// ---- links públicos (um token por patrocinador; cada página se libera pela etapa) ----
const publicPath = (token, page = '') => `/patrocinador/${token}${page}`;
const publicUrl = (token, page = '') => `${config.publicBaseUrl}${publicPath(token, page)}`;

async function ensureToken(sponsor, { regenerate = false } = {}) {
  if (sponsor.public_token && !regenerate) return sponsor.public_token;
  const token = crypto.randomBytes(18).toString('base64url');
  await db.query('UPDATE sponsors SET public_token = $2, token_generated_at = now(), updated_at = now() WHERE id = $1', [sponsor.id, token]);
  return token;
}

function whatsappUrl(kind, sponsor) {
  const text = kind === 'quero'
    ? `Oi, quero ser um patrocinador do ${config.podcastName}! Sou da ${sponsor.company}.`
    : `Oi, quero saber mais sobre como funciona para ser parceiro do ${config.podcastName}. Sou da ${sponsor.company}.`;
  return `https://wa.me/${config.whatsappPatrocinio}?text=${encodeURIComponent(text)}`;
}

const recordClick = (sponsorId, kind) => db.query('INSERT INTO sponsor_clicks (sponsor_id, kind) VALUES ($1,$2)', [sponsorId, kind]);

async function clickStats(sponsorId) {
  const { rows } = await db.query(
    'SELECT kind, count(*)::int AS total, max(created_at) AS last FROM sponsor_clicks WHERE sponsor_id = $1 GROUP BY kind', [sponsorId]);
  const stats = { quero: { total: 0 }, equipe: { total: 0 } };
  for (const r of rows) stats[r.kind] = { total: r.total, last: r.last };
  return stats;
}

// ---- briefing (formulário de cadastro do patrocinador) ----
const BRIEF_TEXT = [['offer', 3000], ['presentation', 6000], ['key_points', 4000], ['restrictions', 3000]];

// Lê o formulário (público ou da equipe). Devolve { values, error }.
function parseBrief(body) {
  const values = {
    landing_perk: clean(body.landing_perk, 1000),
    slogan: clean(body.slogan, 200),
    goal: Object.prototype.hasOwnProperty.call(SPONSOR_GOALS, body.goal) ? body.goal : null,
    goal_other: clean(body.goal_other, 500),
  };
  for (const [field, max] of BRIEF_TEXT) values[field] = clean(body[field], max);
  const landing = normalizeUrl(body.landing_url);
  values.landing_url = landing.value || null;
  const error = landing.error ? 'O endereço da página de divulgação não parece válido (use https://…).' : null;
  return { values, error };
}

async function loadBrief(sponsorId) {
  const { rows } = await db.query('SELECT * FROM sponsor_briefs WHERE sponsor_id = $1', [sponsorId]);
  return rows[0] || {};
}

async function saveBrief(sponsorId, v) {
  await db.query(
    `INSERT INTO sponsor_briefs (sponsor_id, landing_url, landing_perk, offer, presentation, key_points, restrictions, slogan, goal, goal_other)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (sponsor_id) DO UPDATE SET landing_url=$2, landing_perk=$3, offer=$4, presentation=$5, key_points=$6,
       restrictions=$7, slogan=$8, goal=$9, goal_other=$10, updated_at=now()`,
    [sponsorId, v.landing_url, v.landing_perk || null, v.offer || null, v.presentation || null, v.key_points || null,
      v.restrictions || null, v.slogan || null, v.goal, v.goal_other || null]);
  await reconcileBrief(sponsorId);
}

// ---- perguntas, uma por vez: respondida, pendente (pulou) ou ainda por responder ----
// skippable: pode escolher "responder depois" (vira pendência). na: pode marcar "não se aplica" (conta como respondida).
const BRIEF_QUESTIONS = [
  { key: 'logo', title: 'Logo da marca', short: 'Logo', skippable: true, na: null },
  { key: 'landing', title: 'Página para a gente divulgar', short: 'Página', skippable: true, na: 'Não temos uma página' },
  { key: 'offer', title: 'Oferta ou ação especial', short: 'Oferta', skippable: true, na: 'Preferimos só apresentar a empresa' },
  { key: 'presentation', title: 'Como apresentar a empresa', short: 'Apresentação', skippable: true, na: null },
  { key: 'key_points', title: 'Principais pontos a destacar', short: 'Destaques', skippable: true, na: null },
  { key: 'restrictions', title: 'Restrições de comunicação', short: 'Restrições', skippable: false, na: 'Não há restrições' },
  { key: 'slogan', title: 'Slogan ou frase-chave', short: 'Slogan', skippable: false, na: 'Não temos slogan' },
  { key: 'goal', title: 'Objetivo do patrocínio', short: 'Objetivo', skippable: false, na: null },
];
const QUESTION_KEYS = BRIEF_QUESTIONS.map((q) => q.key);
const hasText = (v) => Boolean(String(v ?? '').trim());
const HAS_VALUE = {
  logo: (b, ctx) => Boolean(ctx.hasLogo),
  landing: (b) => hasText(b.landing_url) || hasText(b.landing_perk),
  offer: (b) => hasText(b.offer),
  presentation: (b) => hasText(b.presentation),
  key_points: (b) => hasText(b.key_points),
  restrictions: (b) => hasText(b.restrictions),
  slogan: (b) => hasText(b.slogan),
  goal: (b) => hasText(b.goal) || hasText(b.goal_other),
};

// Estado de cada pergunta: 'respondida' | 'nao_se_aplica' | 'pendente' (pulou) | 'aberta' (ainda não respondeu).
function briefState(brief = {}, ctx = {}) {
  const skipped = brief.skipped || []; const na = brief.na || [];
  const states = {};
  for (const q of BRIEF_QUESTIONS) {
    if (HAS_VALUE[q.key](brief, ctx)) states[q.key] = 'respondida';
    else if (q.na && na.includes(q.key)) states[q.key] = 'nao_se_aplica';
    else if (q.skippable && skipped.includes(q.key)) states[q.key] = 'pendente';
    else states[q.key] = 'aberta';
  }
  const count = (s) => Object.values(states).filter((x) => x === s).length;
  const answered = count('respondida') + count('nao_se_aplica');
  return {
    states, total: BRIEF_QUESTIONS.length, answered, pending: count('pendente'), open: count('aberta'), complete: answered === BRIEF_QUESTIONS.length,
    pendingTitles: BRIEF_QUESTIONS.filter((q) => states[q.key] === 'pendente').map((q) => q.short),
    unfinished: BRIEF_QUESTIONS.filter((q) => ['pendente', 'aberta'].includes(states[q.key])).map((q) => q.short),
  };
}

async function hasLogoFile(sponsorId) {
  return (await db.query("SELECT 1 FROM sponsor_files WHERE sponsor_id = $1 AND kind = 'logo' LIMIT 1", [sponsorId])).rows.length > 0;
}

// Estado atual do patrocinador (lê o briefing e a logo do banco).
async function briefStatus(sponsorId) {
  const [brief, hasLogo] = await Promise.all([loadBrief(sponsorId), hasLogoFile(sponsorId)]);
  return { brief, ...briefState(brief, { hasLogo }), hasLogo };
}

// Depois de qualquer gravação: tira de "pendente"/"não se aplica" o que passou a ter resposta, e marca o formulário completo quando tudo foi respondido.
async function reconcileBrief(sponsorId) {
  const st = await briefStatus(sponsorId);
  const skipped = (st.brief.skipped || []).filter((k) => st.states[k] === 'pendente');
  const na = (st.brief.na || []).filter((k) => st.states[k] === 'nao_se_aplica');
  if (st.brief.sponsor_id && (skipped.length !== (st.brief.skipped || []).length || na.length !== (st.brief.na || []).length)) {
    await db.query('UPDATE sponsor_briefs SET skipped = $2, na = $3 WHERE sponsor_id = $1', [sponsorId, skipped, na]);
  }
  let justCompleted = false;
  if (st.complete) {
    const { rowCount } = await db.query('UPDATE sponsors SET brief_completed_at = coalesce(brief_completed_at, now()), updated_at = now() WHERE id = $1 AND brief_completed_at IS NULL', [sponsorId]);
    justCompleted = rowCount > 0;
  }
  return { ...st, justCompleted };
}

// Aplica UMA resposta do formulário em etapas. action: 'responder' | 'pular' | 'nao_se_aplica'. Devolve { error } ou { ok }.
async function applyAnswer(sponsorId, question, action, values = {}) {
  const q = BRIEF_QUESTIONS.find((x) => x.key === question);
  if (!q) return { error: 'Pergunta desconhecida.' };
  await db.query('INSERT INTO sponsor_briefs (sponsor_id) VALUES ($1) ON CONFLICT (sponsor_id) DO NOTHING', [sponsorId]);
  const brief = await loadBrief(sponsorId);
  let skipped = (brief.skipped || []).filter((k) => k !== question);
  let na = (brief.na || []).filter((k) => k !== question);
  const set = {};
  if (action === 'pular') {
    if (!q.skippable) return { error: 'Esta pergunta precisa ser respondida agora.' };
    if (!HAS_VALUE[question](brief, { hasLogo: await hasLogoFile(sponsorId) })) skipped = [...skipped, question];
  } else if (action === 'nao_se_aplica') {
    if (!q.na) return { error: 'Esta pergunta não aceita "não se aplica".' };
    na = [...na, question];
    Object.assign(set, { landing: { landing_url: null, landing_perk: null }, offer: { offer: null }, restrictions: { restrictions: null }, slogan: { slogan: null } }[question] || {});
  } else if (action === 'responder') {
    if (question === 'logo') {
      if (!(await hasLogoFile(sponsorId))) return { error: 'Envie a logo em PNG ou escolha "Responder depois".' };
    } else if (question === 'landing') {
      const url = normalizeUrl(values.landing_url);
      if (url.error) return { error: 'O endereço da página não parece válido (use https://…).' };
      const perk = clean(values.landing_perk, 1000);
      if (!url.value && !perk) return { error: 'Cole o link da página ou conte o brinde. Se não tiver, use "Não temos uma página".' };
      Object.assign(set, { landing_url: url.value || null, landing_perk: perk || null });
    } else if (question === 'goal') {
      const goal = Object.prototype.hasOwnProperty.call(SPONSOR_GOALS, values.goal) ? values.goal : null;
      const other = clean(values.goal_other, 500);
      if (!goal && !other) return { error: 'Escolha o objetivo principal.' };
      Object.assign(set, { goal, goal_other: other || null });
    } else {
      const max = { offer: 3000, presentation: 6000, key_points: 4000, restrictions: 3000, slogan: 200 }[question];
      const text = clean(values[question], max);
      if (!text) return { error: q.skippable ? 'Escreva a resposta ou escolha "Responder depois".' : (q.na ? `Escreva a resposta ou escolha "${q.na}".` : 'Escreva a resposta.') };
      set[question] = text;
    }
  } else return { error: 'Ação desconhecida.' };
  const cols = Object.keys(set);
  await db.query(`UPDATE sponsor_briefs SET skipped = $2, na = $3, updated_at = now()${cols.map((c, i) => `, ${c} = $${i + 4}`).join('')} WHERE sponsor_id = $1`, [sponsorId, skipped, na, ...cols.map((c) => set[c])]);
  return { ok: true, ...(await reconcileBrief(sponsorId)) };
}

// ---- arquivos (Backblaze) ----
const extOf = (contentType, filename) => {
  const fromName = String(filename || '').match(/\.([A-Za-z0-9]{1,5})$/)?.[1];
  if (fromName) return fromName.toLowerCase();
  return { 'image/png': 'png', 'image/jpeg': 'jpg', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' }[contentType] || 'bin';
};

// Guarda no bucket e registra. `replace`: apaga os anteriores do mesmo tipo (logo, moldura, qrcode).
async function storeFile({ sponsorId, kind, field = null, buffer, filename, contentType, transcript = null, fromSponsor = false, replace = false }) {
  if (!FILE_KINDS.includes(kind)) throw new Error('Tipo de arquivo inválido.');
  const key = await b2.keyFor('patrocinadores', sponsorId, `${kind}-${crypto.randomBytes(8).toString('hex')}.${extOf(contentType, filename)}`);
  await b2.putObject(key, buffer, contentType);
  const { rows: [file] } = await db.query(
    `INSERT INTO sponsor_files (sponsor_id, kind, field, storage_key, filename, content_type, size_bytes, transcript, from_sponsor)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [sponsorId, kind, field, key, String(filename || '').slice(0, 200) || null, contentType, buffer.length, transcript, fromSponsor]);
  if (replace) {
    const { rows: old } = await db.query('DELETE FROM sponsor_files WHERE sponsor_id = $1 AND kind = $2 AND id <> $3 RETURNING storage_key', [sponsorId, kind, file.id]);
    for (const o of old) await b2.deleteObject(o.storage_key).catch((err) => console.error('Falha ao apagar arquivo antigo:', err.message));
  }
  return file;
}

async function deleteFile(file) {
  await db.query('DELETE FROM sponsor_files WHERE id = $1', [file.id]);
  await b2.deleteObject(file.storage_key).catch((err) => console.error('Falha ao apagar arquivo:', err.message));
}

// Envia um arquivo do bucket como resposta HTTP (o bucket é privado: tudo passa por aqui).
async function sendFile(res, file, { inline = true } = {}) {
  const obj = await b2.getObject(file.storage_key);
  if (!obj) return res.status(404).send('Arquivo não encontrado.');
  const safeName = encodeURIComponent(file.filename || `arquivo-${file.id}`);
  res.set({
    'Content-Type': file.content_type || 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${safeName}`,
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
  });
  return res.send(Buffer.from(await obj.arrayBuffer()));
}

// ---- agenda do media kit: convidados em Agendado (gravação confirmada), agrupados por mês ----
async function kitAgendaHtml() {
  const { rows } = await db.query(
    `SELECT name, instagram, proposed_at FROM guests WHERE status = 'agendado' AND (proposed_at IS NULL OR proposed_at >= now() - interval '1 day')
      ORDER BY proposed_at NULLS LAST, lower(name) LIMIT 24`);
  const { esc } = require('./inviteTemplate');
  if (!rows.length) return '<p class="slide-lede">A agenda dos próximos convidados é fechada semana a semana. Pergunte à equipe quem vem por aí.</p>';
  const monthOf = (d) => (d ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', month: 'long' }).format(d) : 'Em breve');
  const groups = [];
  for (const g of rows) {
    const m = monthOf(g.proposed_at);
    const label = m.charAt(0).toUpperCase() + m.slice(1);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(g);
  }
  return groups.map((grp) => `<div class="confirmed-month">${esc(grp.label)}</div>
      <div class="confirmed-grid">${grp.items.map((g) => `
        <div class="confirmed-card">
          <div class="confirmed-avatar img-slot"><span class="plus">+</span><span class="cap">Foto</span></div>
          <div class="confirmed-name">${esc(g.name)}</div>
          ${g.instagram ? `<div class="confirmed-handle">@${esc(g.instagram)}</div>` : ''}
        </div>`).join('')}
      </div>`).join('\n      ');
}

// ---- dados do portal do patrocinador ativo ----
async function portalData(sponsor) {
  const [deliverables, episodes, files] = await Promise.all([
    require('./plans').deliverablesOf(sponsor.id),
    db.query(
      // episódios gravados + gravações reservadas na agenda (convidado ainda sem episódio)
      `SELECT * FROM (
         SELECT e.id, e.number, e.title, coalesce(e.aired_on, e.recorded_on) AS aired_on, e.status, se.role, false AS booking,
                g.name AS guest_name, g.instagram AS guest_instagram, g.positioning AS guest_positioning, g.bio AS guest_bio
           FROM sponsor_episodes se JOIN episodes e ON e.id = se.episode_id LEFT JOIN guests g ON g.id = e.guest_id
          WHERE se.sponsor_id = $1
         UNION ALL
         SELECT NULL, NULL, 'Conversa com ' || g.name, (g.proposed_at AT TIME ZONE 'America/Sao_Paulo')::date,
                CASE WHEN g.status = 'agendado' THEN 'gravacao_marcada' ELSE 'previsto' END, b.role, true,
                g.name, g.instagram, g.positioning, g.bio
           FROM sponsor_bookings b JOIN guests g ON g.id = b.guest_id
          WHERE b.sponsor_id = $1 AND g.status NOT IN ('perdido', 'cancelado')
       ) x ORDER BY aired_on NULLS LAST, number NULLS LAST`, [sponsor.id]),
    db.query("SELECT id, kind, filename FROM sponsor_files WHERE sponsor_id = $1 AND kind IN ('moldura','qrcode','logo') ORDER BY id DESC", [sponsor.id]),
  ]);
  const latest = (kind) => files.rows.find((f) => f.kind === kind) || null;
  return {
    deliverables, episodes: episodes.rows,
    moldura: latest('moldura'), qrcode: latest('qrcode'), logo: latest('logo'),
  };
}

module.exports = {
  addEvent, missingFor, STAGE_HINTS, publicPath, publicUrl, ensureToken, whatsappUrl, recordClick, clickStats,
  BRIEF_QUESTIONS, QUESTION_KEYS, briefState, briefStatus, reconcileBrief, applyAnswer, hasLogoFile,
  parseBrief, loadBrief, saveBrief, storeFile, deleteFile, sendFile, portalData, kitAgendaHtml,
};
