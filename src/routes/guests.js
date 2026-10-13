const express = require('express');
const { can } = require('../permissions');
const db = require('../db/pool');
const config = require('../config');
const mailer = require('../services/mailer');
const guestsSvc = require('../services/guests');
const production = require('../services/production');
const reminders = require('../services/reminders');
const guestPhotos = require('../services/guestPhotos');
const bulk = require('../services/guestBulk');
const rules = require('../services/guestRules');
const tpl = require('../services/inviteTemplate');
const { audit } = require('../services/audit');
const { requirePerm } = require('../middleware');
const { GUEST_STATUSES, STATUS_BY_KEY, isStatus, PROFILES, PROFILE_BY_KEY, CLICK_KINDS, LOSS_REASONS } = require('../constants');

// Texto do histórico ao mudar de etapa (Perdido leva o motivo).
const stageMessage = (from, to, g) => `Etapa: ${STATUS_BY_KEY[from].label} → ${STATUS_BY_KEY[to].label}${to === 'perdido' && g.loss_reason ? ` (motivo: ${LOSS_REASONS[g.loss_reason]}${g.loss_note ? `: “${g.loss_note}”` : ''})` : ''}`;
const lossFields = (b) => ({ loss_reason: Object.prototype.hasOwnProperty.call(LOSS_REASONS, b.loss_reason) ? b.loss_reason : null, loss_note: clean(b.loss_note, 500) || null });
const { wrap, isUuid, isIntId } = require('../utils/wrap');
const { clean, isEmail, parseInputDateTime, firstName } = require('../utils/format');

const router = express.Router();

const wantsJson = (req) => (req.get('accept') || '').includes('application/json');
const notFound = (res) => res.status(404).render('error', { title: 'Não encontrado', message: 'Convidado não encontrado.' });
const flag = (v) => v === '1' || v === 'on' || v === 'true';

async function findGuest(id) {
  if (!isIntId(id)) return null;
  const { rows } = await db.query(
    'SELECT g.*, u.name AS owner_name FROM guests g LEFT JOIN users u ON u.id = g.owner_id WHERE g.id = $1', [id]);
  return rows[0] || null;
}

async function formOptions() {
  const users = await db.query('SELECT id, name FROM users WHERE active ORDER BY lower(name)');
  const sponsors = await db.query("SELECT id, company FROM sponsors WHERE stage <> 'perdido' ORDER BY lower(company)");
  return { owners: users.rows, sponsors: sponsors.rows, statuses: GUEST_STATUSES, profiles: PROFILES, stageHints: rules.STAGE_HINTS, lossReasons: LOSS_REASONS };
}

const formView = (res, status, locals) => res.status(status).render('guests/form', locals);

// Lê e valida o formulário. Devolve { values, error, pendingStage }.
// O formulário não envia foto: se só ela falta para a etapa escolhida, salva o resto sem mudar a etapa (pendingStage)
// e a página do convidado abre a janela da foto, que termina a mudança. No cadastro novo, quem confere é a rota.
async function parseGuestForm(body, guest = null) {
  const values = {
    name: clean(body.name, 150),
    email: clean(body.email, 254).toLowerCase(),
    phone: clean(body.phone, 40),
    instagram: rules.normalizeInstagram(body.instagram),
    profile: rules.normalizeProfile(body.profile),
    invite_reason: clean(body.invite_reason, 1000),
    company: clean(body.company, 150),
    job_title: clean(body.job_title, 150),
    positioning: clean(body.positioning, 1000),
    topic: clean(body.topic, 500),
    bio: clean(body.bio, 2000),
    notes: clean(body.notes, 4000),
    proposed_at: parseInputDateTime(body.proposed_at),
    owner_id: isUuid(body.owner_id) ? body.owner_id : null,
    status: isStatus(body.status) ? body.status : 'prospect',
    gender: body.gender === 'f' ? 'f' : 'm',
    is_plural: flag(body.is_plural),
    scheduled_studio: flag(body.scheduled_studio),
    scheduled_hosts: flag(body.scheduled_hosts),
    scheduled_guest: flag(body.scheduled_guest),
    sponsor_id: isIntId(body.sponsor_id) ? Number(body.sponsor_id) : null,
    sponsor_relation: ['representante', 'indicado'].includes(body.sponsor_relation) ? body.sponsor_relation : null,
    ...lossFields(body),
  };
  if (values.status !== 'perdido') { values.loss_reason = null; values.loss_note = null; }
  if (!values.sponsor_id) values.sponsor_relation = null;
  else if (!values.sponsor_relation) values.sponsor_relation = 'indicado';
  let error = null;
  let pendingStage = null;
  if (values.name.length < 2) error = 'Informe o nome do convidado.';
  else if (!values.instagram) error = 'Informe o Instagram do convidado (ex.: @maria.souza).';
  else if (!values.profile) error = 'Escolha o perfil do convidado.';
  else if (values.email && !isEmail(values.email)) error = 'E-mail do convidado inválido.';
  else if (body.proposed_at && !values.proposed_at) error = 'Data/hora inválida.';
  if (!error && values.owner_id) {
    const { rowCount } = await db.query('SELECT 1 FROM users WHERE id = $1 AND active', [values.owner_id]);
    if (!rowCount) error = 'Responsável inválido.';
  }
  if (!error && values.sponsor_id) {
    const { rowCount } = await db.query('SELECT 1 FROM sponsors WHERE id = $1', [values.sponsor_id]);
    if (!rowCount) error = 'Patrocinador inválido.';
  }
  if (!error) {
    // quem já está na etapa não é barrado ao editar outros dados
    const photo_key = !guest || guest.status === values.status ? 'ok' : guest.photo_key;
    const missing = rules.missingFor(values.status, { ...values, photo_key });
    if (missing.length && missing.every((m) => m === rules.PHOTO)) { pendingStage = values.status; values.status = guest.status; }
    else if (missing.length) error = rules.missingMessage(STATUS_BY_KEY[values.status].label, missing);
  }
  return { values, error, pendingStage };
}

// O formulário reexibe o que foi digitado (inclusive o que não passou na validação).
const echoValues = (body, values) => ({
  ...values, instagram: body.instagram || '', profile: body.profile || '', proposed_at: body.proposed_at,
});

const COLUMNS = ['name', 'email', 'phone', 'instagram', 'profile', 'invite_reason', 'company', 'job_title', 'positioning', 'topic', 'bio',
  'notes', 'proposed_at', 'owner_id', 'status', 'gender', 'is_plural', 'scheduled_studio', 'scheduled_hosts', 'scheduled_guest',
  'sponsor_id', 'sponsor_relation', 'loss_reason', 'loss_note'];
const NULLABLE = new Set(['email', 'phone', 'invite_reason', 'company', 'job_title', 'positioning', 'topic', 'bio', 'notes', 'loss_reason', 'loss_note']);
const columnValues = (values) => COLUMNS.map((c) => (NULLABLE.has(c) ? values[c] || null : values[c]));

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
    where.push(`(g.name ILIKE $${params.length} OR g.email ILIKE $${params.length} OR g.instagram ILIKE $${params.length} OR g.company ILIKE $${params.length} OR g.topic ILIKE $${params.length})`);
  }
  if (owner) { params.push(owner); where.push(`g.owner_id = $${params.length}`); }
  if (status && view === 'lista') { params.push(status); where.push(`g.status = $${params.length}`); }
  const [{ rows: guests }, { rows: owners }, { rows: sponsors }] = await Promise.all([
    db.query(
      `SELECT g.id, g.name, g.instagram, g.profile, g.company, g.job_title, g.topic, g.status, g.proposed_at, g.invite_sent_at, g.invite_viewed_at,
              g.short_url, g.invite_token, g.owner_id, u.name AS owner_name, g.updated_at, g.loss_reason
         FROM guests g LEFT JOIN users u ON u.id = g.owner_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY g.updated_at DESC LIMIT 500`, params),
    db.query('SELECT id, name FROM users WHERE active ORDER BY lower(name)'),
    can(req.user.role, 'guests.write') && view === 'lista' ? db.query("SELECT id, company FROM sponsors WHERE stage <> 'perdido' ORDER BY lower(company)") : { rows: [] },
  ]);
  const columns = GUEST_STATUSES.map((s) => ({ ...s, guests: guests.filter((g) => g.status === s.key) }));
  res.render('guests/index', { lossReasons: LOSS_REASONS, sponsors, bulkStatuses: bulk.BULK_STATUSES, genders: [['m', 'Masculino'], ['f', 'Feminino']], profiles: PROFILES, title: 'Convidados', view, q, ownerFilter: req.query.owner || '', status, guests, columns, owners, statuses: GUEST_STATUSES, profileLabels: PROFILE_BY_KEY });
}));

// ---- criar ----
router.get('/convidados/novo', requirePerm('guests.write'), wrap(async (req, res) => {
  formView(res, 200, {
    title: 'Novo convidado', guest: null, error: null, ...(await formOptions()),
    values: { owner_id: req.user.id, status: 'prospect', gender: 'm', is_plural: false, sponsor_id: isIntId(req.query.patrocinador) ? Number(req.query.patrocinador) : null, sponsor_relation: 'indicado' },
  });
}));

// ---- edição em massa (Lista): etapa, responsável, perfil, gênero e patrocinador. Antes de /convidados/:id ----
router.post('/convidados/em-massa', requirePerm('guests.write'), wrap(async (req, res) => {
  const back = '/convidados?view=lista';
  const { ids, changes, error } = await bulk.parse(req.body);
  if (error) { await req.flash('error', error); return res.redirect(back); }
  const result = await bulk.apply({ ids, changes, user: req.user });
  await audit(req, 'convidados.edicao_em_massa', 'guest', null, {
    selecionados: ids.length, atualizados: result.updated, etapa_nao_mudou: result.stageSkipped.length,
    mudancas: Object.keys(changes).filter((k) => !['owner_name', 'sponsor_name'].includes(k)),
  });
  const { text, tone } = bulk.summary(result);
  await req.flash(tone, text);
  res.redirect(back);
}));

router.post('/convidados', requirePerm('guests.write'), wrap(async (req, res) => {
  const { values, error } = await parseGuestForm(req.body);
  if (error) {
    return formView(res, 400, { title: 'Novo convidado', guest: null, error, values: echoValues(req.body, values), ...(await formOptions()) });
  }
  const { rows: [guest] } = await db.query(
    `INSERT INTO guests (${COLUMNS.join(', ')}, created_by)
     VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(',')}, $${COLUMNS.length + 1}) RETURNING id, photo_key`,
    [...columnValues(values), req.user.id]);
  // cadastro novo direto em Em agendamento/Agendado: sem foto, entra em Convite enviado e a janela da foto termina a mudança
  const pendingStage = rules.missingFor(values.status, { ...values, photo_key: guest.photo_key }).includes(rules.PHOTO) ? values.status : null;
  if (pendingStage) await db.query("UPDATE guests SET status = 'convite_enviado' WHERE id = $1", [guest.id]);
  await guestsSvc.addEvent(guest.id, req.user.id, 'criado', `Convidado cadastrado por ${req.user.name}`);
  await production.syncFromGuest(guest.id, req.user.id); // já cadastrado como Gravado: o episódio nasce
  await audit(req, 'convidado.criado', 'guest', guest.id, { name: values.name });
  if (pendingStage) {
    await req.flash('error', `Convidado cadastrado. Para ir para ${STATUS_BY_KEY[pendingStage].label}, envie a foto.`);
    return res.redirect(`/convidados/${guest.id}?abrir=foto&para=${pendingStage}`);
  }
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
  const clicks = await guestsSvc.clickStats(guest.id);
  const [thread, linkedTasks, episode] = await Promise.all([
    require('../services/comments').list('guest', guest.id),
    db.query("SELECT t.id, t.title, t.status, t.due_on, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.guest_id = $1 ORDER BY (t.status = 'feito'), t.due_on NULLS LAST", [guest.id]),
    db.query('SELECT id, number, status, youtube_url, spotify_url FROM episodes WHERE guest_id = $1', [guest.id]),
  ]);
  const { rows: bookings } = await db.query('SELECT b.role, s.id, s.company FROM sponsor_bookings b JOIN sponsors s ON s.id = b.sponsor_id WHERE b.guest_id = $1 ORDER BY s.company', [guest.id]);
  const { rows: [linkedSponsor] } = guest.sponsor_id ? await db.query('SELECT id, company FROM sponsors WHERE id = $1', [guest.sponsor_id]) : { rows: [] };
  const { rows: [pl] } = await db.query("SELECT count(*)::int AS leads, count(*) FILTER (WHERE status = 'confirmado')::int AS confirmed FROM plateia_leads WHERE guest_id = $1", [guest.id]);
  const reminderList = await reminders.forGuest(guest);
  res.render('guests/show', {
    reminderList, photoFrame: guestPhotos.FRAME,
    plateia: { ...pl, storageReady: config.storageConfigured, canSeeLeads: can(req.user.role, 'audience.read') }, bookings, linkedSponsor: linkedSponsor || null, episodeStages: require('../constants').EPISODE_STATUSES,
    episode: episode.rows[0] || null, lossReasons: LOSS_REASONS, pendingStage: isStatus(req.query.para) ? req.query.para : null, storageReady: config.storageConfigured, openModal: ['contato', 'agenda', 'email', 'perda', 'foto'].includes(req.query.abrir) ? req.query.abrir : null,
    title: guest.name, guest, events, clicks, comments: thread, linkedTasks: linkedTasks.rows, clickKinds: CLICK_KINDS, profileLabels: PROFILE_BY_KEY,
    statuses: GUEST_STATUSES, statusInfo: STATUS_BY_KEY[guest.status],
    longUrl: guest.invite_token ? guestsSvc.longInviteUrl(guest.invite_token) : null,
    defaultMessage, mailReady: config.mailConfigured, yourlsReady: config.yourlsConfigured,
  });
}));

// ---- editar ----
router.get('/convidados/:id/editar', requirePerm('guests.write'), wrap(async (req, res) => {
  const guest = await findGuest(req.params.id);
  if (!guest) return notFound(res);
  // ?para=<etapa>: abre o cadastro já na etapa pretendida (usado quando faltam dados para mover)
  const target = isStatus(req.query.para) ? req.query.para : guest.status;
  const missing = rules.missingFor(target, guest);
  const notice = target !== guest.status && missing.length ? rules.missingMessage(STATUS_BY_KEY[target].label, missing) : null;
  formView(res, 200, { title: `Editar ${guest.name}`, guest, error: null, notice, values: { ...guest, status: target }, ...(await formOptions()) });
}));

router.post('/convidados/:id', requirePerm('guests.write'), wrap(async (req, res) => {
  const guest = await findGuest(req.params.id);
  if (!guest) return notFound(res);
  const { values, error, pendingStage } = await parseGuestForm(req.body, guest);
  if (error) {
    return formView(res, 400, { title: `Editar ${guest.name}`, guest, error, values: echoValues(req.body, values), ...(await formOptions()) });
  }
  await db.query(
    `UPDATE guests SET ${COLUMNS.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`,
    [guest.id, ...columnValues(values)]);
  if (values.status !== guest.status) {
    await guestsSvc.addEvent(guest.id, req.user.id, 'status', stageMessage(guest.status, values.status, values));
  }
  if (guest.sponsor_id && guest.sponsor_id !== values.sponsor_id) { // trocou/tirou o patrocinador: a reserva automática sai
    await db.query('DELETE FROM sponsor_bookings WHERE guest_id = $1 AND sponsor_id = $2', [guest.id, guest.sponsor_id]);
  }
  await production.syncFromGuest(guest.id, req.user.id);
  await audit(req, 'convidado.editado', 'guest', guest.id);
  if (pendingStage) {
    await req.flash('error', `Salvo. Para ir para ${STATUS_BY_KEY[pendingStage].label}, envie a foto.`);
    return res.redirect(`/convidados/${guest.id}?abrir=foto&para=${pendingStage}`);
  }
  await req.flash('ok', 'Convidado atualizado.');
  res.redirect(`/convidados/${guest.id}`);
}));

// Etapa que exige dados -> janela da página do convidado que pede só esses dados. Se só falta a foto, a janela da foto
// (que, depois do envio, termina a mudança de etapa).
const STEP_MODAL = { em_agendamento: 'contato', agendado: 'agenda', perdido: 'perda' };
const stepUrl = (id, target, missing) => (missing.length && missing.every((m) => m === rules.PHOTO)
  ? `/convidados/${id}?abrir=foto&para=${target}`
  : STEP_MODAL[target] ? `/convidados/${id}?abrir=${STEP_MODAL[target]}` : `/convidados/${id}/editar?para=${target}`);

// ---- mudar etapa (formulário ou arrastar no quadro) ----
router.post('/convidados/:id/status', requirePerm('guests.write'), wrap(async (req, res) => {
  const guest = await findGuest(req.params.id);
  if (!guest) return wantsJson(req) ? res.status(404).json({ ok: false }) : notFound(res);
  if (!isStatus(req.body.status)) return wantsJson(req) ? res.status(400).json({ ok: false, error: 'Etapa inválida' }) : res.status(400).send('Etapa inválida');
  const target = req.body.status;
  const missing = target === guest.status ? [] : rules.missingFor(target, guest);
  if (missing.length) {
    const message = rules.missingMessage(STATUS_BY_KEY[target].label, missing);
    const editUrl = stepUrl(guest.id, target, missing);
    if (wantsJson(req)) return res.status(422).json({ ok: false, error: message, missing, editUrl });
    await req.flash('error', message);
    return res.redirect(editUrl);
  }
  if (target !== guest.status) {
    await db.query('UPDATE guests SET status = $2, updated_at = now() WHERE id = $1', [guest.id, target]);
    await guestsSvc.addEvent(guest.id, req.user.id, 'status', stageMessage(guest.status, target, guest));
    await production.syncFromGuest(guest.id, req.user.id);
    await audit(req, 'convidado.etapa', 'guest', guest.id, { de: guest.status, para: target });
  }
  if (wantsJson(req)) return res.json({ ok: true });
  await req.flash('ok', 'Etapa atualizada.');
  return res.redirect(`/convidados/${guest.id}`);
}));

// ---- próximo passo guiado: salva só os campos da janela e, se der, muda a etapa ----
// Campos aceitos: contato (email/phone), agenda (proposed_at + confirmações, com agenda=1) e perda (loss_reason/loss_note, com perda=1).
// Remarcar (nova data) exige confirmar de novo; sem as três confirmações o convidado volta para Em agendamento.
const fmtWhen = (d) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(d);

router.post('/convidados/:id/avancar', requirePerm('guests.write'), wrap(async (req, res) => {
  const guest = await findGuest(req.params.id);
  if (!guest) return notFound(res);
  const b = req.body;
  const target = isStatus(b.para) ? b.para : guest.status;
  const next = { ...guest };
  let error = null;
  if ('email' in b) { next.email = clean(b.email, 254).toLowerCase() || null; if (next.email && !isEmail(next.email)) error = 'E-mail do convidado inválido.'; }
  if ('phone' in b) next.phone = clean(b.phone, 40) || null;
  if (b.agenda === '1') {
    const at = parseInputDateTime(b.proposed_at);
    if (!at) error = error || 'Informe a data e a hora da gravação.';
    else next.proposed_at = at;
    next.scheduled_studio = flag(b.scheduled_studio);
    next.scheduled_hosts = flag(b.scheduled_hosts);
    next.scheduled_guest = flag(b.scheduled_guest);
  }
  if (b.perda === '1') Object.assign(next, lossFields(b));
  const modal = STEP_MODAL[target];
  const backUrl = `/convidados/${guest.id}${modal && target !== guest.status ? `?abrir=${modal}` : ''}`;
  if (error) { await req.flash('error', error); return res.redirect(backUrl); }

  let status = guest.status;
  const missing = target === guest.status ? [] : rules.missingFor(target, next);
  if (target !== guest.status && !missing.length) status = target;
  // a agenda caiu (remarcou sem as três confirmações): volta para Em agendamento
  if (status === 'agendado' && rules.agendaMissing(next).length) status = 'em_agendamento';

  await db.query(
    `UPDATE guests SET email=$2, phone=$3, proposed_at=$4, scheduled_studio=$5, scheduled_hosts=$6, scheduled_guest=$7,
            loss_reason=$9, loss_note=$10, status=$8, updated_at=now() WHERE id=$1`,
    [guest.id, next.email, next.phone, next.proposed_at, next.scheduled_studio, next.scheduled_hosts, next.scheduled_guest, status,
      status === 'perdido' ? next.loss_reason : null, status === 'perdido' ? next.loss_note : null]);
  if (status === guest.status) await require('../services/reminders').syncGuest(guest.id); // remarcou em Agendado: refaz os lembretes
  const moved = b.agenda === '1' && guest.proposed_at && next.proposed_at && guest.proposed_at.getTime() !== next.proposed_at.getTime();
  if (moved) await guestsSvc.addEvent(guest.id, req.user.id, 'agenda', `Gravação remarcada: ${fmtWhen(guest.proposed_at)} → ${fmtWhen(next.proposed_at)}`);
  else if (b.agenda === '1' && !guest.proposed_at) await guestsSvc.addEvent(guest.id, req.user.id, 'agenda', `Data da gravação: ${fmtWhen(next.proposed_at)}`);
  if (status !== guest.status) {
    await guestsSvc.addEvent(guest.id, req.user.id, 'status', stageMessage(guest.status, status, next));
    await production.syncFromGuest(guest.id, req.user.id);
    await audit(req, 'convidado.etapa', 'guest', guest.id, { de: guest.status, para: status });
  } else {
    await audit(req, 'convidado.editado', 'guest', guest.id);
  }
  if (missing.length) {
    await req.flash('error', `Salvo. ${rules.missingMessage(STATUS_BY_KEY[target].label, missing)}`);
    return res.redirect(stepUrl(guest.id, target, missing));
  }
  if (status === 'em_agendamento' && guest.status === 'agendado') await req.flash('error', 'Gravação remarcada. Falta confirmar a nova data com estúdio, hosts e convidado para voltar a Agendado.');
  else await req.flash('ok', status !== guest.status ? `Etapa: ${STATUS_BY_KEY[status].label}.` : 'Salvo.');
  res.redirect(`/convidados/${guest.id}`);
}));

// ---- zerar o aceite: o convidado volta para Prospecção, o contador de aceites e a resposta são apagados ----
// Serve para aceite por engano, clique de teste ou de quem se arrependeu. Quem já tem gravação marcada não passa por aqui.
router.post('/convidados/:id/zerar-aceite', requirePerm('guests.write'), wrap(async (req, res) => {
  const guest = await findGuest(req.params.id);
  if (!guest) return notFound(res);
  const back = `/convidados/${guest.id}`;
  if (['agendado', 'gravado'].includes(guest.status)) {
    await req.flash('error', `${guest.name} já tem gravação marcada (${STATUS_BY_KEY[guest.status].label}). Cancele a gravação antes de zerar o aceite.`);
    return res.redirect(back);
  }
  const { rowCount: clicks } = await db.query("DELETE FROM invite_clicks WHERE guest_id = $1 AND kind = 'aceitar'", [guest.id]);
  await db.query("UPDATE guests SET status = 'prospect', responded_at = NULL, rsvp_message = NULL, updated_at = now() WHERE id = $1", [guest.id]);
  await guestsSvc.addEvent(guest.id, req.user.id, 'status',
    `Aceite zerado por ${req.user.name}: ${clicks} clique(s) apagado(s)${guest.status !== 'prospect' ? `; etapa ${STATUS_BY_KEY[guest.status].label} → Prospecção` : ''}`);
  await production.syncFromGuest(guest.id, req.user.id);
  await audit(req, 'convidado.aceite_zerado', 'guest', guest.id, { de: guest.status, cliques: clicks });
  await req.flash('ok', `Aceite zerado. ${firstName(guest.name)} voltou para Prospecção.`);
  res.redirect(back);
}));

// ---- lembretes da gravação: enviar pelo WhatsApp (marca como enviado e abre a conversa) ou marcar à mão ----
const backTo = (req, fallback) => { const v = String(req.body.voltar || ''); return /^\/(?!\/)[\w\-/?=&#.%]*$/.test(v) ? v : fallback; };
// "enviado": primeira vez (clicar de novo não soma). "reenviado": mandou outra vez. O link do WhatsApp é um <a> comum (data-mark-sent):
// o navegador abre a conversa sozinho e o registro vai em segundo plano por aqui (responde JSON). Sem JavaScript, o "Já enviei" é um formulário.
router.post('/convidados/:id/lembretes/:kind/:acao(enviado|reenviado)', requirePerm('guests.write'), wrap(async (req, res) => {
  const guest = await findGuest(req.params.id);
  if (!guest || !reminders.KINDS[req.params.kind]) return wantsJson(req) ? res.status(404).json({ ok: false }) : notFound(res);
  const back = backTo(req, `/convidados/${guest.id}#lembretes`);
  const item = (await reminders.forGuest(guest)).find((r) => r.kind === req.params.kind);
  if (!item) {
    if (wantsJson(req)) return res.status(409).json({ ok: false, error: 'Esse lembrete não vale mais (a gravação mudou ou já passou).' });
    await req.flash('error', 'Esse lembrete não vale mais (a gravação mudou ou já passou).');
    return res.redirect(back);
  }
  const again = req.params.acao === 'reenviado';
  await reminders.markSent(guest.id, item.kind, req.user, { again });
  if (wantsJson(req)) return res.json({ ok: true });
  await req.flash('ok', `Lembrete de ${item.label.toLowerCase()} marcado como ${again ? 'reenviado' : 'enviado'}.`);
  res.redirect(back);
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
  const subject = clean(req.body.assunto, 200) || rendered.subject;
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
  await require('../services/finance').onGuestDeleted(guest.id);
  if (guest.photo_key) await require('../services/b2').deleteObject(guest.photo_key).catch(() => {});
  await db.query('DELETE FROM guests WHERE id = $1', [guest.id]);
  await req.flash('ok', `${guest.name} foi removido(a).`);
  res.redirect('/convidados');
}));

module.exports = router;
