// Gestão > Equipe > Funções: criar funções e escolher o que cada uma acessa, por área. Cada pessoa tem uma função padrão e
// pode ter outra em cada projeto (na janela do usuário).
const express = require('express');
const { requirePerm } = require('../middleware');
const { AREAS, PERM_LABELS, ROLES } = require('../permissions');
const { wrap, isIntId } = require('../utils/wrap');
const { audit } = require('../services/audit');
const roles = require('../services/roles');

const router = express.Router();
const PATH = '/gestao/funcoes';

router.get(PATH, requirePerm('roles.manage'), wrap(async (req, res) => {
  await roles.refresh(true);
  res.render('gestao/funcoes', {
    title: 'Funções', list: roles.all(), usage: await roles.usage(), AREAS, PERM_LABELS, ROLES, R: roles, editar: Number(req.query.editar) || null,
  });
}));

router.post(PATH, requirePerm('roles.manage'), wrap(async (req, res) => {
  const out = await roles.save(null, req.body, req.user);
  if (out.error) { await req.flash('error', out.error); return res.redirect(PATH); }
  await audit(req, 'funcao.criada', 'role', out.id, { nome: req.body.name, permissoes: roles.get(out.id).perms.length });
  await req.flash('ok', 'Função criada. Escolha quem tem essa função em Usuários.');
  return res.redirect(PATH);
}));

const act = (suffix, fn, msg, action) => router.post(`${PATH}/:id${suffix}`, requirePerm('roles.manage'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return res.redirect(PATH);
  const before = roles.get(req.params.id);
  const out = await fn(req);
  if (out.error) { await req.flash('error', out.error); return res.redirect(`${PATH}${suffix === '' ? `?editar=${req.params.id}` : ''}`); }
  await audit(req, action, 'role', req.params.id, { nome: before && before.name });
  await req.flash('ok', msg);
  return res.redirect(PATH);
}));

act('', (req) => roles.save(Number(req.params.id), req.body, req.user), 'Função salva. Vale no próximo clique de quem tem essa função.', 'funcao.editada');
act('/duplicar', (req) => roles.duplicate(Number(req.params.id), req.user), 'Cópia criada: ajuste o que ela acessa.', 'funcao.duplicada');
act('/padrao', (req) => roles.restore(Number(req.params.id)), 'A função voltou ao padrão de fábrica.', 'funcao.padrao');
act('/excluir', (req) => roles.remove(Number(req.params.id)), 'Função excluída.', 'funcao.excluida');

module.exports = router;
