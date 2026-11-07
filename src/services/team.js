// Pessoas ativas da equipe (id e nome), para listas de responsável e a "bolinha" do menu. O menu e a página pedem a mesma
// lista: na mesma requisição ela vai ao banco uma vez só.
const db = require('../db/pool');
const { memo } = require('../utils/requestCache');

const activeUsers = () => memo('equipe:ativos', () => db.query('SELECT id, name FROM users WHERE active ORDER BY lower(name)'))
  .then((r) => ({ rows: r.rows.slice() })); // cópia: quem recebe pode mexer na lista sem afetar o resto da página

module.exports = { activeUsers };
