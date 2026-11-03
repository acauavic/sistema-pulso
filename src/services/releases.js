// Versões do sistema (dados em src/releases.js): versão atual, histórico e o aviso "atualizado" de cada pessoa.
const db = require('../db/pool');
const list = require('../releases');

const KINDS = { novo: 'Novo', ajuste: 'Ajuste', correcao: 'Correção' };
const current = () => list[0];

// Marca a versão atual como vista por esta pessoa (some o aviso).
async function markSeen(userId) {
  await db.query('UPDATE users SET release_seen = $2 WHERE id = $1 AND release_seen IS DISTINCT FROM $2', [userId, current().version]);
}

module.exports = { list, current, markSeen, KINDS };
