// Duplicatas: comparar dois cadastros e juntar, marcar "não é duplicata" e a lista em Gestão > Sistema > Duplicatas.
const express = require('express');
const db = require('../db/pool');
const dup = require('../services/duplicates');
const { audit } = require('../services/audit');
const { requirePerm } = require('../middleware');
const { can } = require('../permissions');
const { wrap, isIntId } = require('../utils/wrap');

const router = express.Router();
const WRITE = { guest: 'guests.write', sponsor: 'sponsors.write' };

// Valida tipo, ids e permissão. Devolve { kind, a, b } ou responde e devolve null.
function parse(req, res) {
  const kind = dup.KIND_OF_SLUG[req.params.tipo];
  if (!kind || !isIntId(req.params.a) || !isIntId(req.params.b) || req.params.a === req.params.b) { res.status(404).render('error', { title: 'Não encontrado', message: 'Página não encontrada.' }); return null; }
  if (!can(req.user.role, WRITE[kind])) { res.status(403).render('error', { title: 'Sem permissão', message: 'Você não tem permissão para isso.' }); return null; }
  return { kind, a: Number(req.params.a), b: Number(req.params.b) };
}
const backTo = (req, fallback) => { const v = String(req.body?.voltar || req.query?.voltar || ''); return v.startsWith('/') && !v.startsWith('//') ? v : fallback; };

router.get('/gestao/duplicatas', requirePerm('duplicates.manage'), wrap(async (req, res) => {
  const [guest, sponsor] = await Promise.all([dup.pairs('guest'), dup.pairs('sponsor')]);
  res.render('gestao/duplicatas', { title: 'Duplicatas', data: { guest, sponsor } });
}));

router.get('/duplicatas/:tipo/:a/:b', wrap(async (req, res) => {
  const p = parse(req, res); if (!p) return;
  const table = dup.TABLE[p.kind];
  const { rows } = await db.query(`SELECT t.*, u.name AS owner_name FROM ${table} t LEFT JOIN users u ON u.id = t.owner_id WHERE t.id = ANY($1::int[]) ORDER BY t.id`, [[p.a, p.b]]);
  if (rows.length < 2) { await req.flash('error', 'Um dos cadastros não existe mais.'); return res.redirect(backTo(req, dup.URL[p.kind](rows[0]?.id || p.a))); }
  const [A, B] = rows;
  const [sA, sB] = await Promise.all([dup.summary(p.kind, A.id), dup.summary(p.kind, B.id)]);
  res.render('duplicates/compare', {
    title: 'Comparar e juntar', kind: p.kind, slug: req.params.tipo, A, B, sA, sB,
    cmp: dup.compare(p.kind, dup.keys(p.kind, A), dup.keys(p.kind, B)),
    conflicts: dup.conflicts(p.kind, A, B), keepId: dup.pickKeep(p.kind, A, B, sA, sB),
    lostA: dup.lostLinks(p.kind, A, B), lostB: dup.lostLinks(p.kind, B, A),
    labelOf: (key) => dup.stageLabel(p.kind, key), back: backTo(req, dup.URL[p.kind](p.a)),
  });
}));

router.post('/duplicatas/:tipo/:a/:b/juntar', wrap(async (req, res) => {
  const p = parse(req, res); if (!p) return;
  const keepId = Number(req.body.manter);
  if (![p.a, p.b].includes(keepId)) { await req.flash('error', 'Escolha qual cadastro fica.'); return res.redirect(`/duplicatas/${req.params.tipo}/${p.a}/${p.b}`); }
  const dropId = keepId === p.a ? p.b : p.a;
  const choices = {};
  for (const f of Object.keys(dup.FIELDS[p.kind])) if (req.body[`campo_${f}`] != null) choices[f] = req.body[`campo_${f}`];
  const r = await dup.merge(p.kind, keepId, dropId, choices, req.user);
  if (r.error) { await req.flash('error', r.error); return res.redirect(`/duplicatas/${req.params.tipo}/${p.a}/${p.b}`); }
  await audit(req, p.kind === 'guest' ? 'convidado.juntado' : 'patrocinador.juntado', p.kind, keepId, { ficou: keepId, saiu: dropId, saiu_nome: r.drop.name, campos: choices });
  await req.flash('ok', `${r.drop.name} foi juntado a ${r.keep.name} e foi para a lixeira.`, r.trash && { undo: r.trash.batch });
  res.redirect(dup.URL[p.kind](keepId));
}));

router.post('/duplicatas/:tipo/:a/:b/dispensar', wrap(async (req, res) => {
  const p = parse(req, res); if (!p) return;
  await dup.dismiss(p.kind, p.a, p.b, req.user.id);
  await req.flash('ok', 'Certo: esses dois não vão mais aparecer como duplicata.');
  res.redirect(backTo(req, dup.URL[p.kind](p.a)));
}));

router.post('/duplicatas/:tipo/:a/:b/avisar', wrap(async (req, res) => {
  const p = parse(req, res); if (!p) return;
  await dup.undismiss(p.kind, p.a, p.b);
  await req.flash('ok', 'O aviso de duplicata voltou para esses dois.');
  res.redirect(backTo(req, '/gestao/duplicatas'));
}));

module.exports = router;
