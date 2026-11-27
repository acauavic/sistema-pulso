// Importação de convidados por CSV: 1) prévia com erros e duplicados; 2) confirmação grava só as linhas válidas.
const express = require('express');
const csv = require('../services/csvImport');
const { analyse, importGuests } = require('../services/guestImport');
const { audit } = require('../services/audit');
const { requirePerm } = require('../middleware');
const { wrap } = require('../utils/wrap');
const { PROFILE_BY_KEY, STATUS_BY_KEY } = require('../constants');

const router = express.Router();
const MAX_CSV_CHARS = 300_000;

const page = (res, locals = {}) => res.render('guests/import', {
  title: 'Importar convidados', csvText: '', result: null, headerError: null, projectId: null, profileLabels: PROFILE_BY_KEY, statusInfo: STATUS_BY_KEY,
  importStatuses: csv.IMPORT_STATUSES.map((k) => STATUS_BY_KEY[k].label), maxRows: csv.MAX_ROWS, ...locals,
});

router.get('/convidados/importar', requirePerm('guests.write'), (req, res) => page(res));

router.get('/convidados/importar/modelo.csv', requirePerm('guests.write'), (req, res) => {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="modelo-convidados.csv"' }).send(csv.TEMPLATE_CSV);
});

// Em que projeto os convidados entram: o escolhido no menu; em "Todos", o da tela (campo Projeto).
const targetOf = (req) => require('../services/scope').target(req, req.body);
const NO_PROJECT = 'Escolha em que projeto os convidados entram.';

router.post('/convidados/importar/previa', requirePerm('guests.write'), wrap(async (req, res) => {
  const text = String(req.body.csv || '').slice(0, MAX_CSV_CHARS + 1);
  const projectId = targetOf(req);
  if (text.length > MAX_CSV_CHARS) return page(res.status(400), { headerError: `Arquivo grande demais: até ${MAX_CSV_CHARS / 1000} mil caracteres (umas ${csv.MAX_ROWS} linhas). Divida em partes menores.`, projectId });
  if (!projectId) return page(res.status(400), { csvText: text, headerError: NO_PROJECT });
  const { rows, headerError } = await analyse(text, projectId);
  const ok = rows.filter((r) => !r.errors.length && !r.duplicate);
  page(res.status(headerError ? 400 : 200), { csvText: text, headerError, projectId, result: headerError ? null : { rows, ok: ok.length } });
}));

router.post('/convidados/importar', requirePerm('guests.write'), wrap(async (req, res) => {
  const text = String(req.body.csv || '').slice(0, MAX_CSV_CHARS);
  const projectId = targetOf(req);
  const r = await importGuests(text, req.user, projectId);
  if (r.headerError) return page(res.status(400), { csvText: text, headerError: r.headerError, projectId });
  await audit(req, 'convidados.importados', 'guest', null, { criados: r.created.length, episodios: r.episodes, ignorados: r.skipped });
  await req.flash('ok', `${r.created.length} convidado(s) importado(s)${r.episodes ? `, com ${r.episodes} episódio(s) do histórico` : ''}${r.skipped ? `; ${r.skipped} linha(s) ignorada(s) por erro ou duplicidade` : ''}.`);
  res.redirect('/convidados');
}));

module.exports = router;
