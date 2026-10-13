// Calendário: tudo que tem data num lugar só, com filtros e visualizações salvas (pessoais ou da equipe).
const express = require('express');
const db = require('../db/pool');
const cal = require('../services/calendar');
const { audit } = require('../services/audit');
const { requirePerm } = require('../middleware');
const { can, ROLES } = require('../permissions');
const { wrap, isIntId } = require('../utils/wrap');

const router = express.Router();

// Endereço da própria página mantendo o que está escolhido (modo, tipos, responsável, concluídos) e trocando só o pedido.
function hrefFor(cfg) {
  return (over = {}) => {
    const c = { ...cfg, ...over };
    const q = new URLSearchParams({ f: '1', visao: c.visao, resp: c.resp, data: c.data });
    for (const k of c.tipos) q.append('tipos', k);
    if (c.ocultar) q.set('ocultar', '1');
    return `/calendario?${q.toString()}`;
  };
}

router.get('/calendario', requirePerm('calendar.read'), wrap(async (req, res) => {
  const user = req.user;
  const views = await cal.views(user);
  const picked = views.find((v) => v.key === String(req.query.v || '')) || null;
  const cfg = cal.resolve(req.query, picked && picked.config, user);
  const win = cal.range(cfg.visao, cfg.data);
  const [list, { rows: people }] = await Promise.all([
    cal.events({ user, from: win.from, to: win.to, types: cfg.tipos, owner: cfg.owner, hideDone: cfg.ocultar }),
    db.query('SELECT id, name FROM users WHERE active ORDER BY lower(name)'),
  ]);
  const byDay = {};
  for (const e of list) (byDay[e.day] = byDay[e.day] || []).push(e);
  const active = views.find((v) => cal.sameConfig(v.config, cfg)) || null;
  const types = cal.allowedTypes(user);
  const typeKeys = types.map((t) => t.key);
  const person = cfg.owner ? people.find((p) => String(p.id) === String(cfg.owner)) : null;
  const ownerRole = cfg.owner ? (cfg.owner === user.id ? user.role : (await db.query('SELECT role FROM users WHERE id = $1', [cfg.owner])).rows[0]?.role) : null;
  const duties = (role) => cal.dutiesOf(role).filter((t) => typeKeys.includes(t.key)).map((t) => t.label);
  const shown = types.filter((t) => cfg.tipos.includes(t.key)).map((t) => t.label);
  const summary = [
    cfg.tipos.length === typeKeys.length ? 'Todos os tipos' : !shown.length ? 'Nenhum tipo' : shown.length > 3 ? `${shown.slice(0, 3).join(', ')} e mais ${shown.length - 3}` : shown.join(', '),
    cfg.resp === 'eu' ? 'Só os meus' : person ? `De ${person.name}` : null, cfg.ocultar ? 'Sem concluídos' : null,
  ].filter(Boolean).join(' · ');
  res.render('calendar/index', {
    filterCount: (cfg.tipos.length !== typeKeys.length ? 1 : 0) + (cfg.resp !== 'todos' ? 1 : 0) + (cfg.ocultar ? 1 : 0), filterSummary: summary,
    myDuties: duties(user.role), myRoleLabel: ROLES[user.role].label,
    ownerInfo: cfg.owner && cfg.owner !== user.id && ownerRole ? { name: person ? person.name : 'essa pessoa', roleLabel: ROLES[ownerRole].label, duties: duties(ownerRole) } : null,
    title: 'Calendário', cfg, win, byDay, list, views, active, people, types, modes: cal.MODES, today: cal.todayISO(),
    href: hrefFor(cfg), viewHref: (v) => `/calendario?v=${v.key}&data=${cfg.data}`, dayLabel: cal.dayLabel, dayShort: cal.dayShort, canShare: can(user.role, 'calendar.share'),
    deletable: active && active.kind !== 'casa' && (active.ownerId === user.id || can(user.role, 'calendar.share')) ? active : null,
  });
}));

router.post('/calendario/visualizacoes', requirePerm('calendar.read'), wrap(async (req, res) => {
  const result = await cal.saveView({ user: req.user, name: req.body.nome, config: { visao: req.body.visao, tipos: req.body.tipos, resp: req.body.resp, ocultar: req.body.ocultar }, shared: req.body.compartilhar === '1' });
  if (result.error) { await req.flash('error', result.error); return res.redirect('/calendario'); }
  await audit(req, 'calendario.visualizacao_salva', 'calendar_view', result.id, { nome: result.name });
  await req.flash('ok', `Visualização “${result.name}” ${result.updated ? 'atualizada' : 'salva'}.`);
  res.redirect(`/calendario?v=u${result.id}`);
}));

router.post('/calendario/visualizacoes/:id/excluir', requirePerm('calendar.read'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return res.redirect('/calendario');
  const result = await cal.deleteView({ user: req.user, id: Number(req.params.id) });
  if (result.error) { await req.flash('error', result.error); return res.redirect('/calendario'); }
  await audit(req, 'calendario.visualizacao_excluida', 'calendar_view', req.params.id);
  await req.flash('ok', 'Visualização excluída.');
  res.redirect('/calendario');
}));

module.exports = router;
