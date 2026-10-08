// Limitador simples em memória (1 réplica). Chave -> timestamps das tentativas recentes.
function createLimiter({ max, windowMs }) {
  const hits = new Map();

  function prune(now) {
    if (hits.size < 5000) return;
    for (const [key, list] of hits) {
      if (!list.length || now - list[list.length - 1] > windowMs) hits.delete(key);
    }
  }

  return {
    // true = pode seguir; false = bloqueado
    hit(key) {
      const now = Date.now();
      prune(now);
      const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
      list.push(now);
      hits.set(key, list);
      return list.length <= max;
    },
    // true = já estourou o limite (não registra nova tentativa)
    blocked(key) {
      const now = Date.now();
      return (hits.get(key) || []).filter((t) => now - t < windowMs).length >= max;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

module.exports = { createLimiter };
