// Gestão > Sistema > Categorias: tipos de vídeo e categorias de tarefa (criar, renomear, ativar e desativar). Ver services/catalog.js.
const express = require('express');
const { requirePerm } = require('../middleware');
const { wrap } = require('../utils/wrap');
const { audit } = require('../services/audit');
const catalog = require('../services/catalog');

const router = express.Router();
const PATH = '/gestao/categorias';
const TYPE = { video: 'video', tarefa: 'task' };
const back = (slug) => `${PATH}#${slug}`;

router.get(PATH, requirePerm('catalog.manage'), wrap(async (req, res) => {
  const [videos, tasks, vUse, tUse] = await Promise.all([catalog.list('video'), catalog.list('task'), catalog.usage('video'), catalog.usage('task')]);
  res.render('gestao/categorias', { title: 'Categorias', videos, tasks, vUse, tUse });
}));

router.post(`${PATH}/:slug`, requirePerm('catalog.manage'), wrap(async (req, res) => {
  const type = TYPE[req.params.slug];
  if (!type) return res.redirect(PATH);
  const r = await catalog.create(type, req.body.label);
  if (r.error) await req.flash('error', r.error);
  else {
    await audit(req, type === 'video' ? 'categoria.tipo_video_criado' : 'categoria.tarefa_criada', 'catalog', r.key, { nome: r.label });
    await req.flash('ok', `"${r.label}" criado. Já aparece nas listas de escolha.`);
  }
  return res.redirect(back(req.params.slug));
}));

router.post(`${PATH}/:slug/:key`, requirePerm('catalog.manage'), wrap(async (req, res) => {
  const type = TYPE[req.params.slug];
  if (!type || !/^[a-z0-9_]{1,50}$/.test(req.params.key)) return res.redirect(PATH);
  const changes = {};
  if (req.body.label !== undefined) changes.label = req.body.label;
  if (req.body.ativo !== undefined) changes.active = req.body.ativo === '1';
  const r = await catalog.update(type, req.params.key, changes);
  if (r.error) await req.flash('error', r.error);
  else {
    await audit(req, 'categoria.editada', 'catalog', req.params.key, changes);
    await req.flash('ok', changes.active === false ? 'Desativado. Some das listas de escolha; o que já existe continua com o nome.' : 'Salvo.');
  }
  return res.redirect(back(req.params.slug));
}));

module.exports = router;
