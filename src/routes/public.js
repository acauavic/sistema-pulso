// Páginas públicas do convite (sem login). Acesso só por token secreto e imprevisível.
const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const guestsSvc = require('../services/guests');
const mailer = require('../services/mailer');
const tpl = require('../services/inviteTemplate');
const pages = require('../services/publicPages');
const { createLimiter } = require('../auth/rateLimit');
const { RSVP_OPEN, ACCEPT_FROM, STATUS_BY_KEY } = require('../constants');
const { firstName } = require('../utils/format');
const { wrap } = require('../utils/wrap');
const { clean } = require('../utils/format');

const router = express.Router();
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const BOT_RE = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|linkedin|skype|embedly|curl|wget/i;

const viewLimiter = createLimiter({ name: 'convite_ver', max: 120, windowMs: 10 * 60_000 });
const rsvpLimiter = createLimiter({ name: 'convite_resposta', max: 15, windowMs: 10 * 60_000 });

const gone = (res) => res.status(404).set(tpl.publicHeaders()).type('html').send(pages.notFoundHtml());

const isBot = (req) => BOT_RE.test(req.get('user-agent') || '');

async function guestByToken(token) {
  if (!TOKEN_RE.test(token)) return null;
  const { rows } = await db.query('SELECT * FROM guests WHERE invite_token = $1', [token]);
  return rows[0] || null;
}

const rsvpStateOf = (guest) => {
  if (!guest.responded_at) return null;
  if (guest.status === 'perdido' && guest.loss_reason === 'recusado') return 'recusado';
  if (['em_agendamento', 'agendado', 'gravado'].includes(guest.status)) return 'aceito';
  return null;
};

router.get('/convite/:token', wrap(async (req, res) => {
  if (!await viewLimiter.hit(req.ip)) return res.status(429).send('Muitas requisições.');
  const guest = await guestByToken(req.params.token);
  if (!guest) return gone(res);

  if (!guest.invite_viewed_at && !isBot(req)) {
    const { rowCount } = await db.query('UPDATE guests SET invite_viewed_at = now() WHERE id = $1 AND invite_viewed_at IS NULL', [guest.id]);
    if (rowCount) await guestsSvc.addEvent(guest.id, null, 'convite_visto', 'Convidado abriu o convite');
  }
  const rendered = await guestsSvc.renderInvite(guest, {
    rsvpState: rsvpStateOf(guest), closed: !RSVP_OPEN.includes(guest.status),
  });
  if (!rendered) return gone(res);
  return res.set(tpl.publicHeaders()).type('html').send(rendered.html);
}));

// Avisa o responsável (melhor esforço: falha de e-mail não atrapalha o convidado).
async function notifyOwner(guest, accepted, message) {
  try { // aviso no painel: quem cuida do convidado + quem a gestão escolheu (Gestão > Notificações, "Respostas ao convite")
    await require('../services/notify').notify({
      type: 'convite', users: [guest.owner_id], broadcast: true,
      title: accepted ? `${guest.name} aceitou o convite` : `${guest.name} recusou o convite`,
      body: accepted ? 'Foi para Em agendamento. Próximo passo: combinar a data da gravação.' : (message ? `Recado: “${message}”` : 'Foi para Perdido (motivo: Recusado).'),
      url: `/convidados/${guest.id}`, entity: { type: 'guest', id: guest.id },
    });
  } catch (err) {
    console.error('Falha ao avisar no painel:', err.message);
  }
  if (!guest.owner_id) return;
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

// Botões "Aceitar o convite" / "Confirmar presença": registra o clique, move para "Em agendamento"
// e leva ao WhatsApp da produção. Robôs de pré-visualização só são redirecionados (não contam).
router.get('/convite/:token/aceitar', wrap(async (req, res) => {
  if (!await viewLimiter.hit(req.ip)) return res.status(429).send('Muitas requisições.');
  const guest = await guestByToken(req.params.token);
  if (!guest) return gone(res);
  const target = await guestsSvc.whatsappUrl('aceitar', guest);
  if (isBot(req)) return res.redirect(302, target);

  await guestsSvc.recordClick(guest.id, 'aceitar');
  const { rowCount } = await db.query(
    `UPDATE guests SET status = 'em_agendamento', responded_at = now(), updated_at = now()
      WHERE id = $1 AND status = ANY($2)`, [guest.id, ACCEPT_FROM]);
  if (rowCount) {
    await guestsSvc.addEvent(guest.id, null, 'resposta', 'Aceitou o convite (clicou em “Aceitar o convite”)');
    await notifyOwner(guest, true, '');
  } else {
    await guestsSvc.addEvent(guest.id, null, 'clique',
      `Clicou em “Aceitar o convite” de novo (etapa atual: ${STATUS_BY_KEY[guest.status].label})`);
  }
  return res.set(tpl.publicHeaders()).type('html').send(pages.acceptedHtml({ firstName: firstName(guest.name), whatsappUrl: target }));
}));

// Botão "Falar com a produção": só conta o clique e redireciona.
router.get('/convite/:token/producao', wrap(async (req, res) => {
  if (!await viewLimiter.hit(req.ip)) return res.status(429).send('Muitas requisições.');
  const guest = await guestByToken(req.params.token);
  if (!guest) return gone(res);
  const target = await guestsSvc.whatsappUrl('producao', guest);
  if (isBot(req)) return res.redirect(302, target);

  const { rows } = await db.query('SELECT 1 FROM invite_clicks WHERE guest_id = $1 AND kind = $2 LIMIT 1', [guest.id, 'producao']);
  await guestsSvc.recordClick(guest.id, 'producao');
  if (!rows.length) await guestsSvc.addEvent(guest.id, null, 'clique', 'Clicou em “Falar com a produção”');
  return res.redirect(302, target);
}));

// Recusa (com recado opcional). Aceitar é o botão do WhatsApp.
router.post('/convite/:token/responder', wrap(async (req, res) => {
  if (!await rsvpLimiter.hit(req.ip)) return res.status(429).send('Muitas requisições. Tente novamente em instantes.');
  const guest = await guestByToken(req.params.token);
  if (!guest) return gone(res);
  const back = `/convite/${req.params.token}`;
  if (req.body.resposta !== 'recusado' || !RSVP_OPEN.includes(guest.status)) return res.redirect(back);

  const message = clean(req.body.mensagem, 600);
  await db.query(`UPDATE guests SET status = 'perdido', loss_reason = 'recusado', loss_note = $2, responded_at = now(), rsvp_message = $2,
                    updated_at = now() WHERE id = $1`, [guest.id, message || null]);
  await guestsSvc.addEvent(guest.id, null, 'resposta', `Recusou o convite${message ? `: “${message}”` : ''}`);
  await notifyOwner(guest, false, message);
  return res.redirect(back);
}));

module.exports = router;
