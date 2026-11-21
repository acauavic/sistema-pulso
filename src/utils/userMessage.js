// Erro para a pessoa: a frase do próprio sistema passa ("Não há quadros analisados para montar as capas."); texto técnico do
// provedor (HTTP, código de erro, variável de ambiente, inglês, JSON) vira a frase de reserva, e o original vai para o log.
const TECH = /\b(HTTP|status|ECONN\w*|ETIMEDOUT|ENOTFOUND|ENOSPC|fetch failed|timeout|aborted|undefined|null|json|token|stack|Error:|failed|invalid|unauthorized|forbidden|request)\b|\(\d{3}\)|\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b|[{}<>]/i;

function userMessage(err, fallback, { log = '' } = {}) {
  const raw = String((err && err.message) || err || '').trim();
  if (log) console.error(`${log}:`, raw);
  if (!raw || raw.length > 220 || TECH.test(raw) || !/^[A-ZÀ-Ú]/.test(raw)) return fallback;
  return /[.!?]$/.test(raw) ? raw : `${raw}.`;
}

module.exports = { userMessage };
