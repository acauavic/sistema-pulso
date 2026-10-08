const db = require('../db/pool');

// Registro de auditoria. Nunca derruba a requisição: falha de log só vai pro console.
async function audit(req, action, entity = null, entityId = null, meta = null) {
  try {
    await db.query(
      `INSERT INTO audit_log (user_id, user_email, action, entity, entity_id, meta, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.user?.id || null, req.user?.email || null, action, entity, entityId == null ? null : String(entityId),
        meta ? JSON.stringify(meta) : null, req.ip],
    );
  } catch (err) {
    console.error('audit falhou:', err.message);
  }
}

module.exports = { audit };
