// Links de aprovação, do lado do painel: gerar (pauta/roteiro, vídeo em revisão, capas) e cancelar. A página que quem aprova
// abre fica em routes/approvalPublic.js.
const express = require('express');
const db = require('../db/pool');
const { requirePerm } = require('../middleware');
const { can } = require('../permissions');
const { wrap, isIntId } = require('../utils/wrap');
const { audit } = require('../services/audit');
const scope = require('../services/scope');
const approvals = require('../services/approvals');
const pautas = require('../services/pautas');

const router = express.Router();
const backTo = (req, fallback) => { const v = String(req.body.voltar || ''); return /^\/(?!\/)[\w\-/?=&#.%]*$/.test(v) ? v : fallback; };
const notFound = (res) => res.status(404).render('error', { title: 'Não encontrado', message: 'Não encontrei o que você procurava.' });
const OK = 'Link gerado. Copie a mensagem e mande no grupo: a resposta chega sozinha.';

router.post('/pautas/:id/link', requirePerm('pautas.write'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return notFound(res);
  const pauta = await pautas.get(req.params.id);
  if (!pauta) return notFound(res);
  scope.assert(req, pauta.project_id);
  const home = pauta.episode_id ? `/episodios/${pauta.episode_id}#pauta` : `/convidados/${pauta.guest_id}#pauta`;
  const out = await approvals.createForPauta(pauta.id, { to: req.body.to, user: req.user });
  if (out.error) { await req.flash('error', out.error); return res.redirect(backTo(req, home)); }
  await audit(req, 'aprovacao.link', 'pauta', pauta.id, { tipo: pauta.kind, para: out.link.sent_to });
  await req.flash('ok', OK);
  return res.redirect(backTo(req, home));
}));

async function episodeOf(req) {
  if (!isIntId(req.params.id)) return null;
  const { rows: [ep] } = await db.query('SELECT * FROM episodes WHERE id = $1', [req.params.id]);
  if (!ep) return null;
  scope.assert(req, ep.project_id);
  return ep;
}

for (const [kind, create, hash] of [['video', approvals.createForVideo, '#revisao'], ['capas', approvals.createForCovers, '?capas=youtube#capas']]) {
  router.post(`/episodios/:id/aprovacao/${kind}`, requirePerm('production.review'), wrap(async (req, res) => {
    const ep = await episodeOf(req);
    if (!ep) return notFound(res);
    const out = await create(ep, { to: req.body.to, user: req.user });
    if (out.error) await req.flash('error', out.error);
    else { await audit(req, 'aprovacao.link', 'episode', ep.id, { tipo: kind, para: out.link.sent_to }); await req.flash('ok', OK); }
    return res.redirect(backTo(req, `/episodios/${ep.id}${hash}`));
  }));
}

// Cancelar um link que ainda espera resposta (quem recebeu passa a ver "Este link foi cancelado").
router.post('/aprovacoes/:id/revogar', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return notFound(res);
  const l = await approvals.byId(req.params.id);
  if (!l) return notFound(res);
  scope.assert(req, l.project_id);
  if (!can(req.user, l.kind === 'pauta' ? 'pautas.write' : 'production.review')) return res.status(403).render('error', { title: 'Sem permissão', message: 'Seu perfil não pode cancelar este link.' });
  const done = await approvals.revoke(l.id, req.user);
  if (done) { await audit(req, 'aprovacao.cancelada', l.kind === 'pauta' ? 'pauta' : 'episode', l.pauta_id || l.episode_id, { link: l.id }); await req.flash('ok', 'Link cancelado.'); }
  else await req.flash('error', 'Este link já foi respondido ou cancelado.');
  return res.redirect(backTo(req, l.ep_id ? `/episodios/${l.ep_id}` : '/episodios'));
}));

module.exports = router;
