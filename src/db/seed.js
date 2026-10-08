const fs = require('fs');
const path = require('path');
const db = require('./pool');

// Garante que existe ao menos um modelo de convite (o padrão do repositório).
async function seedDefaultTemplate() {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM invite_templates');
  if (rows[0].n > 0) return false;
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'templates', file), 'utf8');
  const subject = 'Convite para o {{podcast}}';
  await db.query('INSERT INTO invite_templates (name, subject, html_body, is_default) VALUES ($1, $2, $3, true)',
    ['Convite Pulso (padrão)', subject, read('convite-pulso.html')]);
  await db.query('INSERT INTO invite_templates (name, subject, html_body, is_default) VALUES ($1, $2, $3, false)',
    ['Convite simples (exemplo)', subject, read('convite-simples.html')]);
  return true;
}

module.exports = { seedDefaultTemplate };
