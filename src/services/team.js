// Pessoas ativas da equipe (id e nome), para listas de responsável, a lista do chat e a "bolinha" do menu. O menu e a
// página pedem a mesma lista: na mesma requisição ela vai ao banco uma vez só.
// `pids`: a pessoa só encontra quem divide um projeto com ela (sem ids, a equipe toda — rotinas e páginas da casa).
const db = require('../db/pool');
const { memo } = require('../utils/requestCache');

const activeUsers = (pids = null) => {
  const ids = pids ? [...new Set(pids.map(Number).filter(Number.isInteger))].sort((a, b) => a - b) : null;
  const run = ids
    ? memo(`equipe:ativos:${ids.join('-')}`, () => db.query(
      `SELECT u.id, u.name FROM users u
        WHERE u.active AND EXISTS (SELECT 1 FROM project_members pm WHERE pm.user_id = u.id AND pm.project_id = ANY($1::int[]))
        ORDER BY lower(u.name)`, [ids]))
    : memo('equipe:ativos', () => db.query('SELECT id, name FROM users WHERE active ORDER BY lower(name)'));
  return run.then((r) => ({ rows: r.rows.slice() })); // cópia: quem recebe pode mexer na lista sem afetar o resto da página
};

module.exports = { activeUsers };
