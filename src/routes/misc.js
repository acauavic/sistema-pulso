const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const mailer = require('../services/mailer');
const yourls = require('../services/yourls');
const { audit } = require('../services/audit');
const { requirePerm } = require('../middleware');
const { GUEST_STATUSES } = require('../constants');
const { wrap } = require('../utils/wrap');

const router = express.Router();

router.get('/', wrap(async (req, res) => {
  const [counts, upcoming, recent, mine] = await Promise.all([
    db.query('SELECT status, count(*)::int AS n FROM guests GROUP BY status'),
    db.query(`SELECT id, name, topic, proposed_at FROM guests
               WHERE status = 'confirmado' AND proposed_at >= now() ORDER BY proposed_at LIMIT 6`),
    db.query(`SELECT e.type, e.message, e.created_at, g.id AS guest_id, g.name AS guest_name, u.name AS user_name
                FROM guest_events e JOIN guests g ON g.id = e.guest_id LEFT JOIN users u ON u.id = e.user_id
               ORDER BY e.created_at DESC, e.id DESC LIMIT 10`),
    db.query(`SELECT count(*)::int AS n FROM guests WHERE owner_id = $1 AND status IN ('prospect','convite_enviado')`, [req.user.id]),
  ]);
  const byStatus = Object.fromEntries(counts.rows.map((r) => [r.status, r.n]));
  res.render('dashboard', {
    title: 'Início', cards: GUEST_STATUSES.map((s) => ({ ...s, n: byStatus[s.key] || 0 })),
    upcoming: upcoming.rows, recent: recent.rows, myOpen: mine.rows[0].n,
  });
}));

router.get('/auditoria', requirePerm('audit.read'), wrap(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 300');
  res.render('audit', { title: 'Auditoria', rows });
}));

// ---- integrações: status + testes seguros (sem expor segredos) ----
router.get('/integracoes', requirePerm('integrations.manage'), (req, res) => {
  res.render('integrations', {
    title: 'Integrações',
    smtp: { ok: config.mailConfigured, dry: config.mailDryRun, host: config.brevo.host, port: config.brevo.port, from: config.brevo.from },
    yourls: { ok: config.yourlsConfigured, base: config.yourls.base },
    appBaseUrl: config.appBaseUrl,
  });
});

router.post('/integracoes/yourls', requirePerm('integrations.manage'), wrap(async (req, res) => {
  try {
    const stats = await yourls.ping();
    await req.flash('ok', `YOURLS respondeu: ${stats.total_links ?? '?'} links cadastrados.`);
  } catch (err) {
    await req.flash('error', `YOURLS falhou: ${err.message}`);
  }
  res.redirect('/integracoes');
}));

router.post('/integracoes/email', requirePerm('integrations.manage'), wrap(async (req, res) => {
  try {
    await mailer.sendMail({
      to: req.user.email,
      subject: `Teste de e-mail — ${config.podcastName}`,
      html: `<p>Se você recebeu esta mensagem, o SMTP da Brevo está funcionando.</p>`,
    });
    await audit(req, 'integracao.teste_email', 'system', null, { to: req.user.email });
    await req.flash('ok', `E-mail de teste enviado para ${req.user.email}.`);
  } catch (err) {
    await req.flash('error', `Falha no envio: ${err.message}`);
  }
  res.redirect('/integracoes');
}));

module.exports = router;
