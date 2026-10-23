const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const mailer = require('../services/mailer');
const yourls = require('../services/yourls');
const { audit } = require('../services/audit');
const { requirePerm } = require('../middleware');
const { GUEST_STATUSES } = require('../constants');
const { wrap } = require('../utils/wrap');
const { can } = require('../permissions');

const router = express.Router();

// Início de quem só edita vídeo (production.edit sem production.manage): a fila de edição, os episódios dele e as tarefas dele.
// Nada de convidados, patrocinadores ou financeiro.
async function editorHome(req, res) {
  const me = req.user.id;
  const [{ rows: queue }, { rows: mine }, { rows: tasks }] = await Promise.all([
    db.query("SELECT id, number, title, recorded_on FROM episodes WHERE status = 'disponivel_edicao' ORDER BY number NULLS LAST, id"),
    db.query(`SELECT id, number, title, status, review_round FROM episodes WHERE editor_id = $1 AND status IN ('em_edicao', 'em_revisao', 'em_finalizacao', 'pronto_publicar')
               ORDER BY CASE status WHEN 'em_edicao' THEN 0 WHEN 'em_revisao' THEN 1 ELSE 2 END, number DESC NULLS LAST`, [me]),
    db.query("SELECT id, title, status, due_on, to_char(due_time, 'HH24:MI') AS due_time FROM tasks WHERE assignee_id = $1 AND status <> 'feito' ORDER BY due_on NULLS LAST, due_time NULLS LAST, id LIMIT 8", [me]),
  ]);
  const adjust = mine.filter((e) => e.status === 'em_edicao' && e.review_round > 0);
  res.render('dashboard-editor', { title: 'Início', queue, mine, tasks: tasks.map((t) => ({ ...t, late: require('../services/tasks').isLate(t) })), adjustCount: adjust.length, today: require('../services/calendar').todayISO(), EPISODE_STATUSES: require('../constants').EPISODE_STATUSES });
}

router.get('/', wrap(async (req, res) => {
  if (can(req.user.role, 'production.edit') && !can(req.user.role, 'production.manage')) return editorHome(req, res);
  const [counts, upcoming, recent, mine] = await Promise.all([
    db.query('SELECT status, count(*)::int AS n FROM guests GROUP BY status'),
    db.query(`SELECT id, name, topic, proposed_at FROM guests
               WHERE status = 'agendado' AND proposed_at >= now() ORDER BY proposed_at LIMIT 6`),
    db.query(`SELECT e.type, e.message, e.created_at, g.id AS guest_id, g.name AS guest_name, u.name AS user_name
                FROM guest_events e JOIN guests g ON g.id = e.guest_id LEFT JOIN users u ON u.id = e.user_id
               ORDER BY e.created_at DESC, e.id DESC LIMIT 10`),
    db.query(`SELECT count(*)::int AS n FROM guests WHERE owner_id = $1 AND status IN ('prospect','convite_enviado')`, [req.user.id]),
  ]);
  const byStatus = Object.fromEntries(counts.rows.map((r) => [r.status, r.n]));
  let money = null;
  if (can(req.user.role, 'finance.read')) {
    const fin = require('../services/finance');
    const [c, stock, { rows: [week] }] = await Promise.all([fin.counts(), fin.stockItems(), db.query(
      "SELECT coalesce(sum(amount_cents) FILTER (WHERE direction = 'saida' AND due_on <= CURRENT_DATE + 7), 0)::bigint AS out7 FROM fin_entries WHERE status = 'previsto'")]);
    money = { late: c.atrasados, out7: Number(week.out7), toBuy: stock.filter((i) => i.active && ['comprar', 'acabou'].includes(i.state)).length };
  }
  const outreach = require('../services/outreach');
  const outToday = can(req.user.role, 'guests.write') || can(req.user.role, 'sponsors.write') ? await outreach.todayFor(req.user) : null;
  if (outToday) outToday.items = outToday.items.map((x) => ({ ...x, d: outreach.describe(x) }));
  res.render('dashboard', {
    money, outToday, CHANNELS: outreach.CHANNELS, outBase: (k) => outreach.KINDS[k].base,
    title: 'Início', cards: GUEST_STATUSES.map((s) => ({ ...s, n: byStatus[s.key] || 0 })),
    upcoming: upcoming.rows, recent: recent.rows, myOpen: mine.rows[0].n,
  });
}));

router.get('/auditoria', requirePerm('audit.read'), wrap(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 300');
  res.render('audit', { title: 'Auditoria', rows });
}));

// ---- integrações: status + testes seguros (sem expor segredos) ----
router.get('/integracoes', requirePerm('integrations.manage'), wrap(async (req, res) => {
  res.render('integrations', {
    google: { ...(await require('../services/googleCalendar').status()), types: await require('../services/googleCalendar').settings() },
    inviteOn: await require('../services/calendarInvites').enabled(),
    calTypes: require('../services/calendar').TYPES, timed: require('../services/googleCalendar').TIMED,
    title: 'Integrações',
    smtp: { ok: config.mailConfigured, dry: config.mailDryRun, host: config.brevo.host, port: config.brevo.port, from: config.brevo.from },
    yourls: { ok: config.yourlsConfigured, base: config.yourls.base },
    infinitepay: { ok: config.infinitepayConfigured, handle: config.infinitepay.handle, webhook: config.infinitepayConfigured ? require('../services/infinitePay').webhookUrl() : '' },
    appBaseUrl: config.appBaseUrl,
    social: { active: await require('../services/socialApi').activeId(), providers: require('../services/socialApi').list().map((p) => ({ id: p.id, label: p.label, configured: p.configured(), live: p.live(), env: p.env, liveEnv: p.liveEnv })) },
  });
}));

// Redes sociais: por qual provedor as publicações saem (Upload-Post ou Zernio) e teste de conexão (só leitura).
router.post('/integracoes/redes', requirePerm('integrations.manage'), wrap(async (req, res) => {
  const api = require('../services/socialApi');
  try {
    const before = await api.activeId();
    await api.choose(String(req.body.provedor || ''));
    await audit(req, 'integracao.redes_provedor', 'system', null, { de: before, para: req.body.provedor });
    await req.flash('ok', `Publicações passam a sair pelo ${api.get(req.body.provedor).label}. As que já saíram continuam sendo acompanhadas por onde foram.`);
  } catch (err) { await req.flash('error', err.message); }
  res.redirect('/integracoes#redes');
}));

router.post('/integracoes/redes/testar', requirePerm('integrations.manage'), wrap(async (req, res) => {
  const api = require('../services/socialApi');
  const p = api.get(String(req.body.provedor || ''));
  const conn = await p.connected({ force: true });
  const names = Object.entries(conn.platforms || {}).map(([k, a]) => `${api.PLATFORMS[k]?.label || k}${a.handle ? ` (@${String(a.handle).replace(/^@/, '')})` : ''}${a.reauth ? ' — reconectar' : ''}`);
  await req.flash(conn.ok ? 'ok' : 'error', conn.ok ? `${p.label} respondeu. Contas conectadas: ${names.join(', ') || 'nenhuma'}.` : `${p.label}: ${conn.error}`);
  res.redirect('/integracoes#redes');
}));

// Link de teste de R$ 1,00 (só gera o link para conferir o handle; ninguém é cobrado se não pagar).
router.post('/integracoes/infinitepay', requirePerm('integrations.manage'), wrap(async (req, res) => {
  try {
    const ip = require('../services/infinitePay');
    const { rows: [lead] } = await db.query("SELECT id, name, phone, guest_name, recording_at FROM plateia_leads ORDER BY id DESC LIMIT 1");
    if (!lead) throw new Error('Ainda não há nenhum pedido na plateia para testar.');
    const link = await ip.createLink({ lead, amountCents: 100, userId: req.user.id, description: 'Teste de integração Pulso (R$ 1,00)' });
    await audit(req, 'integracao.teste_infinitepay', 'system', null, {});
    await req.flash('ok', `A InfinitePay respondeu. Link de teste de R$ 1,00: ${link.url}`);
  } catch (err) {
    await req.flash('error', `InfinitePay: ${err.message}`);
  }
  res.redirect('/integracoes');
}));

router.post('/integracoes/google/tipos', requirePerm('integrations.manage'), wrap(async (req, res) => {
  const gcal = require('../services/googleCalendar');
  const saved = await gcal.saveSettings(req.body);
  await require('../services/calendarInvites').setEnabled(req.body.invite === 'on');
  await audit(req, 'integracao.google_tipos', 'system', null, { ligados: Object.keys(saved).filter((k) => saved[k].enabled), convite_email: req.body.invite === 'on' });
  gcal.kick();
  await req.flash('ok', 'Pronto: a agenda do Google será ajustada em instantes.');
  res.redirect('/integracoes');
}));

router.post('/integracoes/google', requirePerm('integrations.manage'), wrap(async (req, res) => {
  const gcal = require('../services/googleCalendar');
  try {
    if (req.body.acao === 'sincronizar') {
      const r = await gcal.sync();
      await audit(req, 'integracao.google_sync', 'system', null, { ...r, errors: r.errors.length });
      const txt = `Google Agenda: ${r.created} criado(s), ${r.updated} atualizado(s), ${r.removed} removido(s), ${r.unchanged} sem mudança.`;
      await req.flash(r.errors.length ? 'error' : 'ok', r.errors.length ? `${txt} Falhas: ${r.errors.slice(0, 3).join(' | ')}` : txt);
    } else {
      const r = await gcal.ping();
      await req.flash('ok', `Google Agenda respondeu. A conta de serviço ${r.serviceAccount} consegue acessar a agenda.`);
    }
  } catch (err) {
    await req.flash('error', err.message);
  }
  res.redirect('/integracoes');
}));

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
