const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config');
const yourls = require('./yourls');
const tpl = require('./inviteTemplate');

async function addEvent(guestId, userId, type, message) {
  await db.query('INSERT INTO guest_events (guest_id, user_id, type, message) VALUES ($1, $2, $3, $4)',
    [guestId, userId || null, type, String(message).slice(0, 1000)]);
}

const longInviteUrl = (token) => `${config.publicBaseUrl}/convite/${token}`;

// Gera (ou regenera) o link do convite: token secreto + link curto no YOURLS.
// Se o YOURLS falhar, o link longo continua válido e o erro é devolvido em `warning`.
async function generateInvite(guest, userId, { regenerate = false } = {}) {
  let token = guest.invite_token;
  const fresh = !token || regenerate;
  if (fresh) token = crypto.randomBytes(18).toString('base64url');
  const longUrl = longInviteUrl(token);

  let shortUrl = fresh ? null : guest.short_url;
  let keyword = fresh ? null : guest.short_keyword;
  let warning = null;
  if (!shortUrl) {
    try {
      ({ shortUrl, keyword } = await yourls.shorten(longUrl, {
        title: `${config.podcastName} — Convite (${guest.name})`, guestName: guest.name,
      }));
    } catch (err) {
      warning = err.message;
    }
  }
  await db.query(
    `UPDATE guests SET invite_token = $2, short_url = $3, short_keyword = $4,
            invite_generated_at = CASE WHEN $5 THEN now() ELSE COALESCE(invite_generated_at, now()) END,
            updated_at = now()
      WHERE id = $1`,
    [guest.id, token, shortUrl, keyword, fresh]);
  if (fresh) {
    await addEvent(guest.id, userId, 'convite_gerado',
      `${regenerate ? 'Novo link' : 'Link'} do convite gerado${shortUrl ? `: ${shortUrl}` : ' (sem link curto)'}`);
  } else if (shortUrl && shortUrl !== guest.short_url) {
    await addEvent(guest.id, userId, 'convite_gerado', `Link curto gerado: ${shortUrl}`);
  }
  return { token, longUrl, shortUrl, warning };
}

async function loadTemplate(templateId) {
  if (templateId) {
    const { rows } = await db.query('SELECT * FROM invite_templates WHERE id = $1', [templateId]);
    if (rows[0]) return rows[0];
  }
  const { rows } = await db.query('SELECT * FROM invite_templates ORDER BY is_default DESC, id LIMIT 1');
  return rows[0] || null;
}

// Monta HTML + assunto do convite deste convidado.
async function renderInvite(guest, { rsvpState = null, closed = false, preview = false } = {}) {
  const template = await loadTemplate(guest.template_id);
  if (!template) return null;
  let ownerName = null;
  if (guest.owner_id) {
    const { rows } = await db.query('SELECT name FROM users WHERE id = $1', [guest.owner_id]);
    ownerName = rows[0]?.name || null;
  }
  const token = guest.invite_token || 'previa';
  const vars = tpl.buildVariables(guest, {
    owner: ownerName,
    shortUrl: guest.short_url,
    publicUrl: longInviteUrl(token),
    rsvpAction: preview ? '#' : `/convite/${token}/responder`,
  });
  vars.bloco_resposta = tpl.responseBlock(preview ? '#' : `/convite/${token}/responder`, { state: rsvpState, closed });
  return {
    template,
    html: tpl.render(template.html_body, vars),
    subject: tpl.render(template.subject, vars, { escape: false }),
    vars,
  };
}

module.exports = { addEvent, generateInvite, renderInvite, loadTemplate, longInviteUrl };
