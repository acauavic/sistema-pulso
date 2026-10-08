const express = require('express');
const db = require('../db/pool');
const tpl = require('../services/inviteTemplate');
const { audit } = require('../services/audit');
const { requirePerm } = require('../middleware');
const { wrap, isIntId } = require('../utils/wrap');
const { clean } = require('../utils/format');

const router = express.Router();
const MAX_HTML = 200_000;

const SAMPLE_GUEST = {
  name: 'Maria Souza', company: 'Estúdio Exemplo', job_title: 'Fundadora', topic: 'Os bastidores de construir uma marca',
  proposed_at: new Date(Date.now() + 14 * 86400_000), invite_token: 'previa', short_url: null,
};

async function findTemplate(id) {
  if (!isIntId(id)) return null;
  const { rows } = await db.query('SELECT * FROM invite_templates WHERE id = $1', [id]);
  return rows[0] || null;
}

const notFound = (res) => res.status(404).render('error', { title: 'Não encontrado', message: 'Modelo não encontrado.' });

router.get('/modelos', requirePerm('templates.read'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT t.id, t.name, t.subject, t.is_default, t.updated_at, count(g.id)::int AS uses
       FROM invite_templates t LEFT JOIN guests g ON g.template_id = t.id
      GROUP BY t.id ORDER BY t.is_default DESC, lower(t.name)`);
  res.render('templates/list', { title: 'Modelos de convite', templates: rows });
}));

router.get('/modelos/novo', requirePerm('templates.write'), wrap(async (req, res) => {
  const { rows: [base] } = await db.query('SELECT html_body FROM invite_templates WHERE is_default LIMIT 1');
  res.render('templates/form', {
    title: 'Novo modelo', template: null, error: null, variables: tpl.VARIABLES,
    values: { name: '', subject: 'Convite para o {{podcast}}', html_body: base?.html_body || '' },
  });
}));

function parseForm(body) {
  const values = { name: clean(body.name, 120), subject: clean(body.subject, 200), html_body: String(body.html_body || '').slice(0, MAX_HTML + 1) };
  let error = null;
  if (values.name.length < 2) error = 'Dê um nome ao modelo.';
  else if (!values.subject) error = 'Informe o assunto do e-mail.';
  else if (values.html_body.trim().length < 20) error = 'Cole o HTML do convite.';
  else if (values.html_body.length > MAX_HTML) error = 'O HTML passa de 200 KB. Reduza imagens embutidas (use links https).';
  return { values, error };
}

const missingBlockWarning = (html) =>
  html.includes('{{bloco_resposta}}') || /\{\{\s*bloco_resposta\s*\}\}/.test(html)
    ? ''
    : ' Atenção: o modelo não tem {{bloco_resposta}}, então o convidado não terá os botões de aceitar/recusar.';

router.post('/modelos', requirePerm('templates.write'), wrap(async (req, res) => {
  const { values, error } = parseForm(req.body);
  if (error) return res.status(400).render('templates/form', { title: 'Novo modelo', template: null, error, values, variables: tpl.VARIABLES });
  const { rows: [t] } = await db.query(
    'INSERT INTO invite_templates (name, subject, html_body, is_default) VALUES ($1,$2,$3, NOT EXISTS (SELECT 1 FROM invite_templates)) RETURNING id',
    [values.name, values.subject, values.html_body]);
  await audit(req, 'modelo.criado', 'template', t.id, { name: values.name });
  await req.flash(missingBlockWarning(values.html_body) ? 'error' : 'ok', `Modelo criado.${missingBlockWarning(values.html_body)}`);
  res.redirect('/modelos');
}));

router.get('/modelos/:id/editar', requirePerm('templates.write'), wrap(async (req, res) => {
  const template = await findTemplate(req.params.id);
  if (!template) return notFound(res);
  res.render('templates/form', { title: `Editar ${template.name}`, template, values: template, error: null, variables: tpl.VARIABLES });
}));

router.post('/modelos/:id', requirePerm('templates.write'), wrap(async (req, res) => {
  const template = await findTemplate(req.params.id);
  if (!template) return notFound(res);
  const { values, error } = parseForm(req.body);
  if (error) return res.status(400).render('templates/form', { title: `Editar ${template.name}`, template, values, error, variables: tpl.VARIABLES });
  await db.query('UPDATE invite_templates SET name=$2, subject=$3, html_body=$4, updated_at=now() WHERE id=$1',
    [template.id, values.name, values.subject, values.html_body]);
  await audit(req, 'modelo.editado', 'template', template.id);
  await req.flash(missingBlockWarning(values.html_body) ? 'error' : 'ok', `Modelo salvo.${missingBlockWarning(values.html_body)}`);
  res.redirect('/modelos');
}));

// Prévia com dados fictícios, dentro do iframe do painel.
router.get('/modelos/:id/previa', requirePerm('templates.read'), wrap(async (req, res) => {
  const template = await findTemplate(req.params.id);
  if (!template) return notFound(res);
  const vars = tpl.buildVariables(SAMPLE_GUEST, { owner: req.user.name, publicUrl: 'https://exemplo.com/convite/previa', rsvpAction: '#' });
  res.set(tpl.publicHeaders("'self'")).type('html').send(tpl.render(template.html_body, vars));
}));

router.post('/modelos/:id/padrao', requirePerm('templates.write'), wrap(async (req, res) => {
  const template = await findTemplate(req.params.id);
  if (!template) return notFound(res);
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE invite_templates SET is_default = false WHERE is_default');
    await client.query('UPDATE invite_templates SET is_default = true WHERE id = $1', [template.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await audit(req, 'modelo.padrao', 'template', template.id);
  await req.flash('ok', `“${template.name}” agora é o modelo padrão.`);
  res.redirect('/modelos');
}));

router.post('/modelos/:id/excluir', requirePerm('templates.write'), wrap(async (req, res) => {
  const template = await findTemplate(req.params.id);
  if (!template) return notFound(res);
  if (template.is_default) {
    await req.flash('error', 'O modelo padrão não pode ser excluído. Defina outro como padrão primeiro.');
    return res.redirect('/modelos');
  }
  await db.query('DELETE FROM invite_templates WHERE id = $1', [template.id]); // convidados ficam com template_id nulo -> usam o padrão
  await audit(req, 'modelo.excluido', 'template', template.id, { name: template.name });
  await req.flash('ok', 'Modelo excluído.');
  res.redirect('/modelos');
}));

module.exports = router;
