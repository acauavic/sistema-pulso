// Pauta e roteiro: escrever, mandar para o WhatsApp e registrar a resposta de quem aprova (que está fora do sistema).
const express = require('express');
const { requirePerm } = require('../middleware');
const { wrap, isIntId } = require('../utils/wrap');
const { audit } = require('../services/audit');
const scope = require('../services/scope');
const pautas = require('../services/pautas');

const router = express.Router();
const backTo = (req, fallback) => { const v = String(req.body.voltar || ''); return /^\/(?!\/)[\w\-/?=&#.%]*$/.test(v) ? v : fallback; };

// Escrever ou editar (o documento nasce aqui, ligado ao vídeo ou ao convidado).
router.post('/pautas', requirePerm('pautas.write'), wrap(async (req, res) => {
  const episodeId = isIntId(req.body.episode_id) ? Number(req.body.episode_id) : null;
  const guestId = !episodeId && isIntId(req.body.guest_id) ? Number(req.body.guest_id) : null;
  const back = backTo(req, episodeId ? `/episodios/${episodeId}#pauta` : `/convidados/${guestId}#pauta`);
  if (!episodeId && !guestId) { await req.flash('error', 'Não sei de qual vídeo é esta pauta.'); return res.redirect('/episodios'); }
  const owner = episodeId
    ? await require('../db/pool').query('SELECT project_id FROM episodes WHERE id = $1', [episodeId])
    : await require('../db/pool').query('SELECT project_id FROM guests WHERE id = $1', [guestId]);
  if (!owner.rows.length) { await req.flash('error', 'Não encontrei o vídeo desta pauta.'); return res.redirect('/episodios'); }
  scope.assert(req, owner.rows[0].project_id);
  const out = await pautas.save({ episodeId, guestId, kind: req.body.kind, body: req.body, user: req.user });
  if (out.error) await req.flash('error', out.error);
  else {
    await audit(req, 'pauta.escrita', 'pauta', out.pauta.id, { tipo: out.pauta.kind, episodio: episodeId, convidado: guestId });
    await req.flash('ok', `${pautas.KINDS[out.pauta.kind].label} salva.`);
  }
  return res.redirect(back);
}));

// Carrega a pauta e confere o recorte de projeto da pessoa.
async function load(req, res) {
  if (!isIntId(req.params.id)) return null;
  const pauta = await pautas.get(req.params.id);
  if (!pauta) return null;
  scope.assert(req, pauta.project_id);
  return pauta;
}
const home = (p) => (p.episode_id ? `/episodios/${p.episode_id}#pauta` : `/convidados/${p.guest_id}#pauta`);

// "Copiar para o WhatsApp": o texto já foi para a área de transferência no navegador; aqui fica o registro.
router.post('/pautas/:id/enviada', requirePerm('pautas.write'), wrap(async (req, res) => {
  const pauta = await load(req, res);
  if (!pauta) return res.status(404).render('error', { title: 'Não encontrado', message: 'Pauta não encontrada.' });
  const out = await pautas.send(pauta.id, { to: req.body.to, user: req.user });
  if (out.error) await req.flash('error', out.error);
  else {
    await audit(req, 'pauta.enviada', 'pauta', pauta.id, { para: out.pauta.sent_to });
    await req.flash('ok', `${pautas.KINDS[pauta.kind].label} marcada como enviada para ${out.pauta.sent_to}.`);
  }
  return res.redirect(backTo(req, home(pauta)));
}));

// A resposta que veio pelo WhatsApp: aprovada, ou com ajustes pedidos.
router.post('/pautas/:id/resposta', requirePerm('pautas.write'), wrap(async (req, res) => {
  const pauta = await load(req, res);
  if (!pauta) return res.status(404).render('error', { title: 'Não encontrado', message: 'Pauta não encontrada.' });
  const approved = req.body.resposta === 'aprovada';
  const out = await pautas.answer(pauta.id, { approved, by: req.body.by, note: req.body.note, user: req.user });
  if (out.error) await req.flash('error', out.error);
  else {
    await audit(req, approved ? 'pauta.aprovada' : 'pauta.ajustes', 'pauta', pauta.id, { tipo: pauta.kind });
    await req.flash('ok', approved ? `${pautas.KINDS[pauta.kind].label} aprovada.` : 'Ajustes registrados. A pauta voltou para quem escreve.');
  }
  return res.redirect(backTo(req, home(pauta)));
}));

module.exports = router;
