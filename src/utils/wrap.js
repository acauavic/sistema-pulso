// Repassa erros de handlers async pro middleware de erro do Express.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isIntId = (v) => (typeof v === 'string' || typeof v === 'number') && /^\d{1,9}$/.test(String(v));

module.exports = { wrap, isUuid, isIntId };
