// Importação de convidados por CSV: 1) prévia com erros e duplicados; 2) confirmação grava só as linhas válidas.
const express = require('express');
const db = require('../db/pool');
const csv = require('../services/csvImport');
const { audit } = require('../services/audit');
const { formatDateTime } = require('../utils/format');
const { requirePerm } = require('../middleware');
const { wrap } = require('../utils/wrap');
const production = require('../services/production');
const { PROFILE_BY_KEY, STATUS_BY_KEY } = require('../constants');

const router = express.Router();
const MAX_CSV_CHARS = 300_000;

const page = (res, locals = {}) => res.render('guests/import', {
  title: 'Importar convidados', csvText: '', result: null, headerError: null, profileLabels: PROFILE_BY_KEY, statusInfo: STATUS_BY_KEY,
  importStatuses: csv.IMPORT_STATUSES.map((k) => STATUS_BY_KEY[k].label), maxRows: csv.MAX_ROWS, ...locals,
});

router.get('/convidados/importar', requirePerm('guests.write'), (req, res) => page(res));

router.get('/convidados/importar/modelo.csv', requirePerm('guests.write'), (req, res) => {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="modelo-convidados.csv"' }).send(csv.TEMPLATE_CSV);
});

async function analyse(text) {
  const parsed = csv.parseGuests(text);
  if (!parsed.headerError) await csv.markDuplicates(parsed.rows);
  return parsed;
}

router.post('/convidados/importar/previa', requirePerm('guests.write'), wrap(async (req, res) => {
  const text = String(req.body.csv || '').slice(0, MAX_CSV_CHARS + 1);
  if (text.length > MAX_CSV_CHARS) return page(res.status(400), { headerError: 'Arquivo grande demais. Divida em partes menores.' });
  const { rows, headerError } = await analyse(text);
  const ok = rows.filter((r) => !r.errors.length && !r.duplicate);
  page(res.status(headerError ? 400 : 200), { csvText: text, headerError, result: headerError ? null : { rows, ok: ok.length } });
}));

router.post('/convidados/importar', requirePerm('guests.write'), wrap(async (req, res) => {
  const text = String(req.body.csv || '').slice(0, MAX_CSV_CHARS);
  const { rows, headerError } = await analyse(text); // reavalia no servidor: nada do que veio da prévia é confiável
  if (headerError) return page(res.status(400), { csvText: text, headerError });
  const toImport = rows.filter((r) => !r.errors.length && !r.duplicate);
  if (!toImport.length) return page(res.status(400), { csvText: text, headerError: 'Nenhuma linha válida para importar.' });

  const client = await db.getPool().connect();
  const created = [];
  try {
    await client.query('BEGIN');
    for (const { data } of toImport) {
      const { rows: [g] } = await client.query(
        `INSERT INTO guests (name, instagram, phone, profile, email, invite_reason, gender, owner_id, created_by, status,
                            proposed_at, scheduled_studio, scheduled_hosts, scheduled_guest)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$11,$11) RETURNING id`,
        [data.name, data.instagram, data.phone || null, data.profile, data.email || null, data.invite_reason || null, data.gender, req.user.id,
          data.status, data.proposed_at, data.status === 'agendado']);
      const details = [data.status !== 'prospect' && `etapa: ${STATUS_BY_KEY[data.status].label}`, data.proposed_at && `gravação ${formatDateTime(data.proposed_at)}`].filter(Boolean);
      const stage = details.length ? ` (${details.join(', ')})` : '';
      await client.query('INSERT INTO guest_events (guest_id, user_id, type, message) VALUES ($1,$2,$3,$4)',
        [g.id, req.user.id, 'criado', `Importado por CSV por ${req.user.name}${stage}`]);
      created.push(g.id);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  for (const id of created) await production.syncFromGuest(id, req.user.id); // igual ao cadastro manual
  await audit(req, 'convidados.importados', 'guest', null, { criados: created.length, ignorados: rows.length - created.length });
  const skipped = rows.length - created.length;
  await req.flash('ok', `${created.length} convidado(s) importado(s)${skipped ? `; ${skipped} linha(s) ignorada(s) por erro ou duplicidade` : ''}.`);
  res.redirect('/convidados');
}));

module.exports = router;
