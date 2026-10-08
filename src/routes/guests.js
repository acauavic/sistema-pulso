const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const mailer = require('../services/mailer');
const guestsSvc = require('../services/guests');
const tpl = require('../services/inviteTemplate');
const { audit } = require('../services/audit');
const { requirePerm } = require('../middleware');
const { GUEST_STATUSES, STATUS_BY_KEY, isStatus } = require('../constants');
const { wrap, isUuid, isIntId } = require('../utils/wrap');
const { clean, isEmail, parseInputDateTime, firstName } = require('../utils/format');

const router = express.Router();

const wantsJson = (req) => (req.get('accept') || '').includes('application/json');
const notFound = (res) => res.status(404).render('error', { title: 'Não encontrado', message: 'Convidado não encontrado.' });

async function findGuest(id) {
  if (!isIntId(id)) return null;
  const { rows } = await db.query(
    'SELECT g.*, u.name AS owner_name FROM guests g LEFT JOIN users u ON u.id = g.owner_id WHERE g.id = $1', [id]);
  return rows[0] || null;
}

async function formOptions() {
  const [users, templates] = await Promise.all([
    db.query('SELECT id, name FROM users WHERE active ORDER BY lower(name)'),
    db.query('SELECT id, name, is_default FROM invite_templates ORDER BY is_default DESC, lower(name)'),
  ]);
  return { owners: users.rows, templates: templates.rows };
}

// Lê e valida o formulário. Devolve { values, error }.
async function parseGuestForm(body, req) {
  const values = {
    name: clean(body.name, 150),
    email: clean(body.email, 254).toLowerCase(),
    phone: clean(body.phone, 40),
    instagram: clean(body.instagram, 80).replace(/^@/, ''),
    company: clean(body.company, 150),
    job_title: clean(body.job_title, 150),
    bio: clean(body.bio, 2000),
    topic: clean(body.topic, 300),
    notes: clean(body.notes, 4000),
    proposed_at: parseInputDateTime(body.proposed_at),
    owner_id: isUuid(body.owner_id) ? body.owner_id : null,
    template_id: isIntId(String(body.template_id || '')) ? Number(body.template_id) : null,
    status: isStatus(body.status) ? body.status : 'prospect',
    gender: body.gender === 'f' ? 'f' : 'm',
    is_plural: body.is_plural === '1' || body.is_plural === 'on',
  };
  let error = null;
  if (values.name.length < 2) error = 'Informe o nome do convidado.';
  else if (values.email && !isEmail(values.email)) error = 'E-mail do convidado inválido.';
  else if (body.proposed_at && !values.proposed_at) error = 'Data/hora inválida.';
  if (!error && values.owner_id) {
    const { rowCount } = await db.query('SELECT 1 FROM users WHERE id = $1 AND active', [values.owner_id]);
    if (!rowCount) error = 'Responsável inválido.';
  }
  if (!error && values.template_id) {
    const { rowCount } = await db.query('SELECT 1 FROM invite_templates WHERE id = $1', [values.template_id]);
    if (!rowCount) error = 'Modelo de convite inválido.';
  }
  return { values, error };
}

// ---- quadro / lista ----
router.get('/convidados', requirePerm('guests.read'), wrap(async (req, res) => {
  const view = req.query.view === 'lista' ? 'lista' : 'quadro';
  const q = clean(req.query.q, 100);
  const owner = req.query.owner === 'eu' ? req.user.id : (isUuid(req.query.owner) ? req.query.owner : '');
  const status = isStatus(req.query.status) ? req.query.status : '';
  const where = [];
  const params = [];
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(g.name ILIKE $${params.length} OR g.email ILIKE $${params.length} OR g.company ILIKE $${params.length} OR g.topic ILIKE $${params.length})`);
  }
  if (owner) { params.push(owner); where.push(`g.owner_id = $${params.length}`); }
  if (status && view === 'lista') { params.push(status); where.push(`g.status = $${params.length}`); }
  const [{ rows: guests }, { rows: owners }] = await Promise.all([
    db.query(
      `SELECT g.id, g.name, g.company, g.job_title, g.topic, g.status, g.proposed_at, g.invite_sent_at, g.invite_viewed_at,
              g.short_url, g.invite_token, g.owner_id, u.name AS owner_name, g.updated_at
         FROM guests g LEFT JOIN users u ON u.id = g.owner_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY g.updated_at DESC LIMIT 500`, params),
    db.query('SELECT id, name FROM users WHERE active ORDER BY lower(name)'),
  ]);
  const columns = GUEST_STATUSES.map((s) => ({ ...s, guests: guests.filter((g) => g.status === s.key) }));
  res.render('guests/index', { title: 'Convidados', view, q, ownerFilter: req.query.owner || '', status, guests, columns, owners, statuses: GUEST_STATUSES });
}));

// ---- criar ----
router.get('/convidados/novo', requirePerm('guests.write'), wrap(async (req, res) => {
  const opts = await formOptions();
  const defaultTpl = opts.templates.find((t) => t.is_default);
  res.render('guests/form', {
    title: 'Novo convidado', guest: null, error: null, ...opts, statuses: GUEST_STATUSES,
    values: { owner_id: req.user.id, template_id: defaultTpl?.id || '', status: 'prospect', gender: 'm', is_plural: false },
  });
}));

router.post('/convidados', requirePerm('guests.write'), wrap(async (req, res) => {
  const { values, error } = await parseGuestForm(req.body, req);
  if (error) {
    return res.status(400).render('guests/form', { title: 'Novo convidado', guest: null, error, values: { ...values, proposed_at: req.body.proposed_at }, ...(await formOptions()), statuses: GUEST_STATUSES });
  }
  const { rows: [guest] } = await db.query(
    `INSERT INTO guests (name, email, phone, instagram, company, job_title, bio, topic, notes, proposed_at, owner_id, template_id, status, created_by, gender, is_plural)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [values.name, values.email || null, values.phone || null, values.instagram || null, values.company || null, values.job_title || null,
      values.bio || null, values.topic || null, values.notes || null, values.proposed_at, values.owner_id, values.template_id, values.status, req.user.id,
      values.gender, values.is_plural]);
  await guestsSvc.addEvent(guest.id, req.user.id, 'criado', `Convidado cadastrado por ${req.user.name}`);
  await audit(req, 'convidado.criado', 'guest', guest.id, { name: values.name });
  await req.flash('ok', 'Convidado cadastrado. Agora é só gerar o link do convite.');
  res.redirect(`/convidados/${guest.id}`);
}));

// ---- detalhe ----
router.get('/convidados/:id', requirePerm('guests.read'), wrap(async (req, res) => {
  const guest = await findGuest(req.params.id);
  if (!guest) return notFound(res);
  const { rows: events } = await db.query(
    `SELECT e.*, u.name AS user_name FROM guest_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.guest_id = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT 200`, [guest.id]);
  const defaultMessage =
    `Olá, ${firstName(guest.name)}! Tudo bem?\n\nÉ um prazer convidar você para participar do ${config.podcastName}.` +
    `${guest.topic ? ` Gostaríamos de conversar sobre: ${guest.topic}.` : ''}\n\nPreparamos um convite com todos os detalhes. É só clicar no botão abaixo e responder.`;
  res.render('guests/show', {
    title: guest.name, guest, events, statuses: GUEST_STATUSES, statusInfo: STATUS_BY_KEY[guest.status],
    longUrl: guest.invite_token ? guestsSvc.longInviteUrl(guest.invite_token) : null,
    defaultMessage, mailReady: config.mailConfigured, yourlsReady: config.yourlsConfigured,
  });
}));

// ---- editar ----
router.get('/convidados/:id/editar', requirePerm('guests.write'), wrap(async (req, res) => {
  const guest = await findGuest(req.params.id);
  if (!guest) return notFound(res);
  res.render('guests/form', { title: `Editar ${guest.name}`, guest, error: null, values: guest, ...(await formOptions()), statuses: GUEST_STATUSES });
}));

router.post('/convidados/:id', requirePerm('guests.write'), wrap(async (req, res) => {
  const guest = await findGuest(req.params.id);
  if (!guest) return notFound(res);
  const { values, error } = await parseGuestForm(req.body, req);
  if (error) {
    return res.status(400).render('guests/form', { title: `Editar ${guest.name}`, guest, error, values: { ...values, proposed_at: req.body.proposed_at }, ...(await formOptions()), statuses: GUEST_STATUSES });
  }
  await db.query(
    `UPDATE guests SET name=$2, email=$3, phone=$4, instagram=$5, company=$6, job_title=$7, bio=$8, topic=$9, notes=$10,
            proposed_at=$11, owner_id=$12, template_id=$13, status=$14, gender=$15, is_plural=$16, updated_at=now() WHERE id=$1`,
    [guest.id, values.name, values.email || null, values.phone || null, values.instagram || null, values.company || null, values.job_title || null,
      values.bio || null, values.topic || null, values.notes || null, values.proposed_at, values.owner_id, values.template_id, values.status,
      values.gender, values.is_plural]);
  if (values.status !== guest.status) {
    await guestsSvc.addEvent(guest.id, req.user.id, 'status', `Etapa: ${STATUS_BY_KEY[guest.status].label} → ${STATUS_BY_KEY[values.status].label}`);
  }
  await audit(req, 'convidado.editado', 'guest', guest.id);
  await req.flash('ok', 'Convidado atualizado.');
  res.redirect(`/convidados/${guest.id}`);
}));

// ---- mudar etapa (formulário ou arrastar no quadro) ----
router.post('/convidados/:id/status', requirePerm('guests.write'), wrap(async (req, res) => {
  const guest = await findGuest(req.params.id);
  if (!guest) return wantsJson(req) ? res.status(404).json({ ok: false }) : notFound(res);
  if (!isStatus(req.body.status)) return wantsJson(req) ? res.status(400).json({ ok: false, error: 'Etapa inválida' }) : res.status(400).send('Etapa inválida');
  if (req.body.status !== guest.status) {
    await db.query('UPDATE guests SET status = $2, updated_at = now() WHERE id = $1', [guest.id, req.body.status]);
    await guestsSvc.addEvent(guest.id, req.user.id, 'status', `Etapa: ${STATUS_BY_KEY[guest.status].label} → ${STATUS_BY_KEY[req.body.status].label}`);
    await audit(req, 'convidado.etapa', 'guest', guest.id, { de: guest.status, para: req.body.status });
  }
  if (wantsJson(req)) return res.json({ ok: true });
  await req.flash('ok', 'Etapa atualizada.');
  return res.redirect(`/convidados/${guest.id}`);
}));

// ---- anotação na linha do tempo ----
router.post('/convidados/:id/nota', requirePerm('guests.write'), wrap(async (req, res) => {
  const guest = await findGuest(req.params.id);
  if (!guest) return notFound(res);
  const note = clean(req.body.nota, 1000);
  if (note) {
    await guestsSvc.addEvent(guest.id, req.user.id, 'nota', note);
    await db.query('UPDATE guests SET updated_at = now() WHERE id = $1', [guest.id]);
  }
  res.redirect(`/convidados/${guest.id}#timeline`);
}));

// ---- link do convite (token + YOURLS) ----
router.post('/convidados/:id/convite', requirePerm('guests.invite'), wrap(async (req, res) => {
  const guest = await findGuest(req.params.id);
  if (!guest) return notFound(res);
  const regenerate = req.body.regenerar === '1';
  const result = await guestsSvc.generateInvite(guest, req.user.id, { regenerate });
  await audit(req, regenerate ? 'convite.regenerado' : 'convite.gerado', 'guest', guest.id, { short: result.shortUrl });
  if (result.warning) await req.flash('error', `Link do convite criado, mas o encurtador falhou: ${result.warning}. Você pode usar o link completo ou tentar de novo.`);
  else await req.flash('ok', regenerate ? 'Novo link gerado. O link anterior deixou de funcionar.' : 'Link do convite gerado!');
  res.redirect(`/convidados/${guest.id}#convite`);
}));

// ---- prévia do convite (mesmo HTML que o convidado vê, sem botões ativos) ----
router.get('/convidados/:id/previa', requirePerm('guests.read'), wrap(async (req, res) => {
  const guest = await findGuest(req.params.id);
  if (!guest) return notFound(res);
  const rendered = await guestsSvc.renderInvite(guest, { preview: true });
  if (!rendered) return res.status(404).send('Nenhum modelo de convite cadastrado.');
  res.set(tpl.publicHeaders("'self'")).type('html').send(rendered.html);
}));

// ---- enviar por e-mail (Brevo) ----
router.post('/convidados/:id/enviar', requirePerm('guests.invite'), wrap(async (req, res) => {
  let guest = await findGuest(req.params.id);
  if (!guest) return notFound(res);
  const back = `/convidados/${guest.id}#convite`;
  if (!guest.email) {
    await req.flash('error', 'Cadastre o e-mail do convidado antes de enviar.');
    return res.redirect(back);
  }
  const message = clean(req.body.mensagem, 2000);
  if (!message) {
    await req.flash('error', 'Escreva a mensagem do e-mail.');
    return res.redirect(back);
  }
  const invite = await guestsSvc.generateInvite(guest, req.user.id); // garante token + link curto
  guest = await findGuest(guest.id);
  const rendered = await guestsSvc.renderInvite(guest);
  const subject = clean(req.body.assunto, 200) || rendered?.subject || `Convite para o ${config.podcastName}`;
  try {
    await mailer.sendGuestInvite({
      to: guest.email, guestName: guest.name, subject, message,
      url: invite.shortUrl || invite.longUrl, replyTo: req.user.email,
    });
  } catch (err) {
    console.error('Falha ao enviar convite:', err.message);
    await req.flash('error', `Não foi possível enviar o e-mail: ${err.message}`);
    return res.redirect(back);
  }
  await db.query(
    `UPDATE guests SET invite_sent_at = now(),
            status = CASE WHEN status = 'prospect' THEN 'convite_enviado' ELSE status END, updated_at = now() WHERE id = $1`, [guest.id]);
  await guestsSvc.addEvent(guest.id, req.user.id, 'convite_enviado', `Convite enviado por e-mail para ${guest.email}`);
  await audit(req, 'convite.enviado', 'guest', guest.id, { to: guest.email });
  await req.flash('ok', `Convite enviado para ${guest.email}.`);
  res.redirect(back);
}));

// ---- excluir ----
router.post('/convidados/:id/excluir', requirePerm('guests.delete'), wrap(async (req, res) => {
  const guest = await findGuest(req.params.id);
  if (!guest) return notFound(res);
  await audit(req, 'convidado.excluido', 'guest', guest.id, { name: guest.name });
  await db.query('DELETE FROM guests WHERE id = $1', [guest.id]);
  await req.flash('ok', `${guest.name} foi removido(a).`);
  res.redirect('/convidados');
}));

module.exports = router;
