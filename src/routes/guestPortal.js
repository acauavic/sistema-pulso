// Portal do convidado, lado da equipe: a aba "Portal" no cadastro do convidado (ligar, datas, aviso, fotos, collab no YouTube,
// envio do link) e a marcação de um corte como exclusivo do convidado.
const express = require('express');
const db = require('../db/pool');
const portal = require('../services/guestPortal');
const { audit } = require('../services/audit');
const { requirePerm } = require('../middleware');
const { wrap, isIntId } = require('../utils/wrap');

const router = express.Router();
const back = (id) => `/convidados/${id}#portal`;

async function guestOr404(req, res) {
  if (!isIntId(req.params.id)) { res.status(404).send('Convidado não encontrado.'); return null; }
  const g = await portal.byId(req.params.id);
  if (!g) { res.status(404).send('Convidado não encontrado.'); return null; }
  return g;
}

router.post('/convidados/:id/portal', requirePerm('guests.write'), wrap(async (req, res) => {
  const g = await guestOr404(req, res); if (!g) return;
  const on = req.body.on === '1';
  if (on && !g.episode_id) { await req.flash('error', 'O portal nasce com o episódio: marque o convidado como Gravado primeiro.'); return res.redirect(back(g.id)); }
  await portal.setEnabled(g.id, on);
  await audit(req, on ? 'portal.ativado' : 'portal.desativado', 'guest', g.id);
  await req.flash('ok', on ? 'Portal ativado. Escolha as fotos e mande o link quando os cortes começarem.' : 'Portal desativado: o link deixa de abrir.');
  res.redirect(back(g.id));
}));

router.post('/convidados/:id/portal/novo-link', requirePerm('guests.write'), wrap(async (req, res) => {
  const g = await guestOr404(req, res); if (!g) return;
  await portal.regenerate(g.id);
  await audit(req, 'portal.novo_link', 'guest', g.id);
  await req.flash('ok', 'Novo link gerado. O anterior parou de funcionar: mande o novo para o convidado.');
  res.redirect(back(g.id));
}));

router.post('/convidados/:id/portal/estender', requirePerm('guests.write'), wrap(async (req, res) => {
  const g = await guestOr404(req, res); if (!g) return;
  await portal.extend(g.id);
  await audit(req, 'portal.estendido', 'guest', g.id);
  await req.flash('ok', `Portal liberado por mais ${portal.VALID_DAYS} dias.`);
  res.redirect(back(g.id));
}));

router.post('/convidados/:id/portal/datas', requirePerm('guests.write'), wrap(async (req, res) => {
  const g = await guestOr404(req, res); if (!g) return;
  const r = portal.parseDates(req.body);
  if (r.error) { await req.flash('error', r.error); return res.redirect(back(g.id)); }
  await portal.saveDates(g.id, r.values);
  await req.flash('ok', 'Cronograma salvo.');
  res.redirect(back(g.id));
}));

router.post('/convidados/:id/portal/aviso', requirePerm('guests.write'), wrap(async (req, res) => {
  const g = await guestOr404(req, res); if (!g) return;
  if (!await portal.setNotify(g.id, String(req.body.canal || ''))) await req.flash('error', 'Escolha como avisar.');
  else await req.flash('ok', 'Forma de aviso salva.');
  res.redirect(back(g.id));
}));

router.post('/convidados/:id/portal/fotos', requirePerm('guests.write'), wrap(async (req, res) => {
  const g = await guestOr404(req, res); if (!g) return;
  await portal.setPhotos(g, req.body.fotos);
  await req.flash('ok', 'Fotos do portal salvas.');
  res.redirect(back(g.id));
}));

router.post('/convidados/:id/portal/youtube', requirePerm('guests.write'), wrap(async (req, res) => {
  const g = await guestOr404(req, res); if (!g) return;
  const done = req.body.feito === '1';
  await portal.setYoutube(g.id, done);
  await audit(req, done ? 'portal.youtube_collab' : 'portal.youtube_collab_desfeito', 'guest', g.id);
  await req.flash('ok', done ? 'Collab no YouTube marcada. O episódio aparece como collab no portal.' : 'Collab no YouTube desmarcada.');
  res.redirect(back(g.id));
}));

// Mandar o link: por e-mail sai daqui; pelo WhatsApp abre a conversa com a mensagem pronta (a equipe envia do aparelho).
router.post('/convidados/:id/portal/enviar', requirePerm('guests.invite'), wrap(async (req, res) => {
  const g = await guestOr404(req, res); if (!g) return;
  if (!g.portal_enabled) return res.redirect(back(g.id));
  if (req.body.canal === 'whatsapp') {
    const wa = portal.waTo(g, portal.linkMessage(g));
    if (!wa) { await req.flash('error', 'O convidado não tem WhatsApp no cadastro.'); return res.redirect(back(g.id)); }
    await portal.markSent(g);
    await audit(req, 'portal.link_whatsapp', 'guest', g.id);
    return res.redirect(303, wa);
  }
  try {
    const r = await portal.sendLinkEmail(g);
    if (r.error) await req.flash('error', r.error);
    else { await audit(req, 'portal.link_email', 'guest', g.id); await req.flash('ok', `Link do portal enviado para ${g.email}.`); }
  } catch (err) {
    await req.flash('error', `O e-mail não saiu: ${err.message}`);
  }
  res.redirect(back(g.id));
}));

// Avisos pendentes (posts novos em collab) num só WhatsApp.
router.post('/convidados/:id/portal/avisar', requirePerm('guests.invite'), wrap(async (req, res) => {
  const g = await guestOr404(req, res); if (!g) return;
  const posts = await portal.pending(g);
  const wa = posts.length ? portal.waTo(g, portal.newsMessage(g, posts)) : null;
  if (!wa) { await req.flash('error', posts.length ? 'O convidado não tem WhatsApp no cadastro.' : 'Nada novo para avisar.'); return res.redirect(back(g.id)); }
  await portal.markWhatsappSent(g);
  res.redirect(303, wa);
}));

// Corte exclusivo do convidado (padrão) ou fora do portal.
router.post('/cortes/:id/convidado', requirePerm('guests.write'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return res.status(404).send('Corte não encontrado.');
  const on = req.body.on === '1';
  const { rows: [c] } = await db.query('UPDATE episode_clips SET for_guest = $2 WHERE id = $1 RETURNING id, episode_id', [req.params.id, on]);
  if (!c) return res.status(404).send('Corte não encontrado.');
  await req.flash('ok', on ? 'O corte volta para o portal do convidado (enquanto não for publicado).' : 'O corte saiu do portal do convidado.');
  const v = String(req.body.voltar || '');
  res.redirect(/^\/convidados\/\d+$/.test(v) ? `${v}#portal` : `/cortes/${c.id}`);
}));

module.exports = router;
