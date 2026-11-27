// Gestão > Sistema > Projetos: nome, sigla e como cada projeto chama os seus vídeos, e quem participa de cada um.
// Quem participa de um projeto só não vê seletor nem sigla em lugar nenhum. Ver services/projects.js e services/scope.js.
const express = require('express');
const db = require('../db/pool');
const { requirePerm } = require('../middleware');
const { wrap, isUuid, isIntId } = require('../utils/wrap');
const { audit } = require('../services/audit');
const projects = require('../services/projects');

const router = express.Router();
const PATH = '/gestao/projetos';
// rótulo de cada módulo que um projeto pode usar (projects.modules)
const MODULES = [['convidados', 'Convidados'], ['patrocinio', 'Patrocínio'], ['producao', 'Produção'], ['convites', 'Convites'], ['portal', 'Portal do convidado'],
  ['plateia', 'Plateia'], ['media_kit', 'Media kit'], ['redes', 'Redes'], ['financeiro', 'Financeiro'], ['tarefas', 'Tarefas']];

router.get(PATH, requirePerm('projects.manage'), wrap(async (req, res) => {
  await projects.refresh(true);
  const list = projects.all();
  const [people, ...members] = await Promise.all([db.query('SELECT id, name, role FROM users WHERE active ORDER BY lower(name)'), ...list.map((p) => projects.members(p.id))]);
  res.render('gestao/projetos', {
    title: 'Projetos', people: people.rows,
    projects: list.map((p, i) => ({ ...p, members: members[i], memberIds: members[i].map((m) => m.user_id), moduleLabels: MODULES.filter(([k]) => projects.has(p, k)).map(([, l]) => l) })),
  });
}));

router.post(`${PATH}/:id`, requirePerm('projects.manage'), wrap(async (req, res) => {
  if (!isIntId(req.params.id) || !projects.get(req.params.id)) return res.redirect(PATH);
  const r = await projects.update(Number(req.params.id), req.body);
  if (r.error) await req.flash('error', r.error);
  else {
    await audit(req, 'projeto.editado', 'project', r.project.id, { nome: r.project.name, sigla: r.project.sigla });
    await req.flash('ok', `${r.project.name} atualizado.`);
  }
  return res.redirect(PATH);
}));

router.post(`${PATH}/:id/pessoas`, requirePerm('projects.manage'), wrap(async (req, res) => {
  const project = isIntId(req.params.id) ? projects.get(req.params.id) : null;
  if (!project) return res.redirect(PATH);
  const ids = [].concat(req.body.users || []).filter(isUuid);
  const r = await projects.setMembers(project.id, ids);
  if (r.error) await req.flash('error', r.error);
  else {
    await audit(req, 'projeto.pessoas', 'project', project.id, { nome: project.name, pessoas: ids.length });
    await req.flash('ok', `${ids.length === 1 ? '1 pessoa participa' : `${ids.length} pessoas participam`} do ${project.name}.`);
  }
  return res.redirect(PATH);
}));

module.exports = router;
