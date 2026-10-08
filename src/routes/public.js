// Páginas públicas do convite (sem login). Acesso só por token secreto e imprevisível.
const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const guestsSvc = require('../services/guests');
const mailer = require('../services/mailer');
const tpl = require('../services/inviteTemplate');
const { createLimiter } = require('../auth/rateLimit');
const { RSVP_OPEN } = require('../constants');
const { wrap } = require('../utils/wrap');
const { clean } = require('../utils/format');

const router = express.Router();
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const BOT_RE = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|linkedin|skype|embedly|curl|wget/i;

const viewLimiter = createLimiter({ max: 120, windowMs: 10 * 60_000 });
const rsvpLimiter = createLimiter({ max: 15, windowMs: 10 * 60_000 });

const gone = (res) =>
  res.status(404).set(tpl.publicHeaders()).type('html').send(
    '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Convite não encontrado</title><body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;text-align:center;color:#334155">' +
    '<h1 style="font-size:22px">Convite não encontrado</h1><p>Este link não é válido ou foi substituído por um mais recente. Fale com a equipe do podcast para receber um novo.</p></body></html>');

async function guestByToken(token) {
  if (!TOKEN_RE.test(token)) return null;
  const { rows } = await db.query('SELECT * FROM guests WHERE invite_token = $1', [token]);
  return rows[0] || null;
}

const rsvpStateOf = (guest) => {
  if (!guest.responded_at) return null;
  if (guest.status === 'confirmado') return 'aceito';
  if (guest.status === 'recusou') return 'recusado';
  return null;
};

router.get('/convite/:token', wrap(async (req, res) => {
  if (!viewLimiter.hit(req.ip)) return res.status(429).send('Muitas requisições.');
  const guest = await guestByToken(req.params.token);
  if (!guest) return gone(res);

  if (!guest.invite_viewed_at && !BOT_RE.test(req.get('user-agent') || '')) {
    const { rowCount } = await db.query('UPDATE guests SET invite_viewed_at = now() WHERE id = $1 AND invite_viewed_at IS NULL', [guest.id]);
    if (rowCount) await guestsSvc.addEvent(guest.id, null, 'convite_visto', 'Convidado abriu o convite');
  }
  const rendered = await guestsSvc.renderInvite(guest, {
    rsvpState: rsvpStateOf(guest), closed: !RSVP_OPEN.includes(guest.status),
  });
  if (!rendered) return gone(res);
  return res.set(tpl.publicHeaders()).type('html').send(rendered.html);
}));

router.post('/convite/:token/responder', wrap(async (req, res) => {
  if (!rsvpLimiter.hit(req.ip)) return res.status(429).send('Muitas requisições. Tente novamente em instantes.');
  const guest = await guestByToken(req.params.token);
  if (!guest) return gone(res);
  const back = `/convite/${req.params.token}`;
  const accepted = req.body.resposta === 'aceito';
  if (!['aceito', 'recusado'].includes(req.body.resposta) || !RSVP_OPEN.includes(guest.status)) return res.redirect(back);

  const message = clean(req.body.mensagem, 600);
  const status = accepted ? 'confirmado' : 'recusou';
  await db.query('UPDATE guests SET status = $2, responded_at = now(), rsvp_message = $3, updated_at = now() WHERE id = $1',
    [guest.id, status, message || null]);
  await guestsSvc.addEvent(guest.id, null, 'resposta',
    `${accepted ? 'Aceitou' : 'Recusou'} o convite${message ? `: “${message}”` : ''}`);

  // avisa o responsável (melhor esforço: falha de e-mail não atrapalha o convidado)
  if (guest.owner_id) {
    try {
      const { rows } = await db.query('SELECT email FROM users WHERE id = $1 AND active', [guest.owner_id]);
      if (rows[0]) {
        await mailer.sendRsvpNotice({
          to: rows[0].email, guestName: guest.name, accepted, message,
          url: `${config.appBaseUrl}/convidados/${guest.id}`,
        });
      }
    } catch (err) {
      console.error('Falha ao avisar responsável:', err.message);
    }
  }
  return res.redirect(back);
}));

module.exports = router;
