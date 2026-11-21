// Extrato da parceria por link (/extrato/:token): só leitura, para o parceiro ver a conta sem entrar no sistema. Abre no
// endereço e com a marca do projeto.
const express = require('express');
const partnership = require('../services/partnership');
const projects = require('../services/projects');
const host = require('../services/hostContext');
const { createLimiter } = require('../auth/rateLimit');
const { icon } = require('../utils/icons');
const fmt = require('../utils/format');
const { wrap } = require('../utils/wrap');

const router = express.Router();
const limiter = createLimiter({ name: 'extrato_parceria', max: 120, windowMs: 10 * 60_000 });
const HEADERS = {
  'Content-Security-Policy': "default-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
};
const money = (c) => (Number(c) < 0 ? `− ${fmt.formatBRL(-Number(c))}` : fmt.formatBRL(c));

router.get('/extrato/:token', wrap(async (req, res) => {
  if (!await limiter.hit(req.ip)) return res.status(429).send('Muitas requisições.');
  const l = await partnership.byToken(req.params.token);
  if (!l) return res.status(404).set(HEADERS).render('approval/missing', { title: 'Link não encontrado', icon, assetV: res.locals.assetV });
  const go = host.wrongHost(req, l.project_id);
  if (go) return res.redirect(302, go);
  const L = await partnership.ledger(l.project_id);
  if (!L) return res.status(404).set(HEADERS).render('approval/missing', { title: 'Link não encontrado', icon, assetV: res.locals.assetV });
  const [months, settled] = await Promise.all([partnership.months(l.project_id), partnership.settlements(l.project_id)]);
  const project = projects.get(l.project_id);
  res.set(HEADERS).render('partnership/statement', {
    title: `Extrato da parceria · ${projects.publicName(l.project_id) || (project && project.name)}`, L, months, settled, money, fmt, icon,
    publicName: projects.publicName(l.project_id) || (project && project.name), preview: partnership.preview(L), assetV: res.locals.assetV,
  });
}));

module.exports = router;
