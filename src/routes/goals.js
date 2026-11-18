// Gestão > Equipe > Metas: até 3 metas por pessoa, contadas sozinhas (src/services/goals.js). Cada pessoa vê as dela no Início.
const express = require('express');
const db = require('../db/pool');
const { requirePerm } = require('../middleware');
const { wrap } = require('../utils/wrap');
const { audit } = require('../services/audit');
const goals = require('../services/goals');
const { ROLES } = require('../permissions');

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// os tipos de vídeo da meta "Vídeos entregues" (Gestão > Categorias; cortes do episódio contam em "Cortes subidos")
const videoTypes = () => {
  const K = require('../services/contentRequests').KINDS;
  return require('../services/catalog').videoOptions().filter((k) => K[k] && K[k].media === 'video' && !K[k].continuous).map((k) => ({ key: k, label: K[k].label }));
};

router.get('/gestao/metas', requirePerm('goals.manage'), wrap(async (req, res) => {
  res.render('gestao/metas', {
    title: 'Metas', people: await goals.overview(), METRICS: goals.METRICS, CATEGORIES: goals.CATEGORIES, PERIODS: goals.PERIODS, DISPLAYS: goals.DISPLAYS,
    MAX: goals.MAX_PER_PERSON, ROLES, videoTypes: videoTypes(), openFor: UUID.test(String(req.query.pessoa || '')) ? req.query.pessoa : '',
  });
}));

router.post('/gestao/metas/:userId', requirePerm('goals.manage'), wrap(async (req, res) => {
  const id = String(req.params.userId);
  const { rows: [person] } = UUID.test(id) ? await db.query('SELECT id, name FROM users WHERE id = $1 AND active', [id]) : { rows: [] };
  if (!person) { await req.flash('error', 'Pessoa não encontrada.'); return res.redirect('/gestao/metas'); }
  const first = person.name.split(' ')[0];
  const { goals: list, error } = goals.parseSlots(req.body);
  if (error) { await req.flash('error', error); return res.redirect(`/gestao/metas?pessoa=${person.id}#metas-${person.id}`); }
  await goals.saveFor(person.id, list, req.user.id);
  await audit(req, 'metas.salvas', 'user', person.id, { pessoa: person.name, metas: list.map((g) => `${goals.METRICS[g.metric].label} · ${g.target} ${goals.PERIODS[g.period]}`) });
  await req.flash('ok', list.length ? `Metas de ${first} salvas.` : `${first} ficou sem metas.`);
  res.redirect(`/gestao/metas#metas-${person.id}`);
}));

module.exports = router;
