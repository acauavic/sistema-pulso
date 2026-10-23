// Central de patrocinadores (painel da equipe): CRM em quadro, regras de etapa, links públicos, briefing,
// episódios contemplados, entregáveis e arquivos (Backblaze).
const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const sponsorsSvc = require('../services/sponsors');
const guestRules = require('../services/guestRules');
const { audit } = require('../services/audit');
const recordChanges = require('../services/recordChanges');
const { requirePerm } = require('../middleware');
const C = require('../constants');
const { wrap, isUuid, isIntId } = require('../utils/wrap');
const { clean, isEmail, parseBRL, parseInputDate, formatBRL: fmtMoney } = require('../utils/format');
const { can } = require('../permissions');

const router = express.Router();
const wantsJson = (req) => (req.get('accept') || '').includes('application/json');
const notFound = (res) => res.status(404).render('error', { title: 'Não encontrado', message: 'Patrocinador não encontrado.' });
const back = (id, hash = '') => `/patrocinadores/${id}${hash}`;
const MAX_UPLOAD = 12 * 1024 * 1024;

async function findSponsor(id) {
  if (!isIntId(id)) return null;
  const { rows } = await db.query(
    'SELECT s.*, u.name AS owner_name FROM sponsors s LEFT JOIN users u ON u.id = s.owner_id WHERE s.id = $1', [id]);
  return rows[0] || null;
}

async function formOptions() {
  const users = await db.query('SELECT id, name FROM users WHERE active ORDER BY lower(name)');
  return {
    owners: users.rows, stages: C.SPONSOR_STAGES, kinds: C.SPONSOR_KINDS, tiers: C.SPONSOR_TIERS, stageHints: sponsorsSvc.STAGE_HINTS,
  };
}

async function parseSponsorForm(body) {
  const value = parseBRL(body.value);
  const website = guestRules.normalizeUrl(body.website);
  const paidAt = parseInputDate(body.paid_at);
  const startsOn = parseInputDate(body.starts_on);
  const endsOn = parseInputDate(body.ends_on);
  const values = {
    company: clean(body.company, 150),
    website: website.value || null,
    kind: Object.prototype.hasOwnProperty.call(C.SPONSOR_KINDS, body.kind) ? body.kind : null,
    tier: Object.prototype.hasOwnProperty.call(C.SPONSOR_TIERS, body.tier) ? body.tier : null,
    value_cents: Number.isNaN(value) ? null : value,
    contact_name: clean(body.contact_name, 150),
    contact_email: clean(body.contact_email, 254).toLowerCase(),
    contact_phone: clean(body.contact_phone, 40),
    stage: C.isSponsorStage(body.stage) ? body.stage : 'prospect',
    owner_id: isUuid(body.owner_id) ? body.owner_id : null,
    paid_at: Number.isNaN(paidAt) ? null : paidAt,
    starts_on: Number.isNaN(startsOn) ? null : startsOn,
    ends_on: Number.isNaN(endsOn) ? null : endsOn,
    notes: clean(body.notes, 4000),
  };
  let error = null;
  if (values.company.length < 2) error = 'Informe o nome da empresa.';
  else if (!values.kind) error = 'Escolha o tipo de patrocinador (marca pessoal ou negócio).';
  else if (website.error) error = 'O site da empresa não parece válido.';
  else if (Number.isNaN(value)) error = 'Valor inválido. Use algo como 15.000,00.';
  else if (values.contact_email && !isEmail(values.contact_email)) error = 'E-mail do responsável inválido.';
  else if (Number.isNaN(paidAt) || Number.isNaN(startsOn) || Number.isNaN(endsOn)) error = 'Data inválida.';
  else if (values.starts_on && values.ends_on && values.ends_on < values.starts_on) error = 'O fim da vigência não pode ser antes do início.';
  if (!error && values.owner_id) {
    const { rowCount } = await db.query('SELECT 1 FROM users WHERE id = $1 AND active', [values.owner_id]);
    if (!rowCount) error = 'Responsável da equipe inválido.';
  }
  if (!error) {
    const missing = sponsorsSvc.missingFor(values.stage, values);
    if (missing.length) error = `Para mover para ${C.SPONSOR_STAGE_BY_KEY[values.stage].label} falta: ${listJoin(missing)}.`;
  }
  return { values, error };
}

const listJoin = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}` : items[0] || '');
const COLUMNS = ['company', 'website', 'kind', 'tier', 'value_cents', 'contact_name', 'contact_email', 'contact_phone', 'stage', 'owner_id', 'paid_at', 'starts_on', 'ends_on', 'notes'];
const NULLABLE = new Set(['contact_name', 'contact_email', 'contact_phone', 'notes']);
const columnValues = (v) => COLUMNS.map((c) => (NULLABLE.has(c) ? v[c] || null : v[c]));
const echo = (body, v) => ({ ...v, value: body.value || '', website: body.website || '', paid_at: body.paid_at || '', starts_on: body.starts_on || '', ends_on: body.ends_on || '' });

// ---- quadro / lista ----
router.get('/patrocinadores', requirePerm('sponsors.read'), wrap(async (req, res) => {
  const view = req.query.view === 'lista' ? 'lista' : 'quadro';
  const q = clean(req.query.q, 100);
  const owner = req.query.owner === 'eu' ? req.user.id : (isUuid(req.query.owner) ? req.query.owner : '');
  const stage = C.isSponsorStage(req.query.stage) ? req.query.stage : '';
  const where = [];
  const params = [];
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(s.company ILIKE $${params.length} OR s.contact_name ILIKE $${params.length} OR s.contact_email ILIKE $${params.length})`);
  }
  if (owner) { params.push(owner); where.push(`s.owner_id = $${params.length}`); }
  if (stage && view === 'lista') { params.push(stage); where.push(`s.stage = $${params.length}`); }
  const [{ rows: sponsors }, { rows: owners }, totals] = await Promise.all([
    db.query(
      `SELECT s.id, s.company, s.kind, s.tier, s.value_cents, s.contact_name, s.stage, s.public_token, s.brief_completed_at, s.updated_at, s.owner_id, u.name AS owner_name,
              b.skipped AS b_skipped, b.na AS b_na, b.landing_url, b.landing_perk, b.offer, b.presentation, b.key_points, b.restrictions, b.slogan, b.goal, b.goal_other,
              EXISTS (SELECT 1 FROM sponsor_files f WHERE f.sponsor_id = s.id AND f.kind = 'logo') AS has_logo
         FROM sponsors s LEFT JOIN users u ON u.id = s.owner_id LEFT JOIN sponsor_briefs b ON b.sponsor_id = s.id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY s.updated_at DESC LIMIT 500`, params),
    db.query('SELECT id, name FROM users WHERE active ORDER BY lower(name)'),
    db.query("SELECT stage, count(*)::int AS n, coalesce(sum(value_cents),0)::bigint AS total FROM sponsors GROUP BY stage"),
  ]);
  for (const s of sponsors) { // andamento do formulário (só depois de Ganho)
    if (!['ganho', 'ativo', 'inativo'].includes(s.stage)) continue;
    s.form = sponsorsSvc.briefState({ skipped: s.b_skipped || [], na: s.b_na || [], landing_url: s.landing_url, landing_perk: s.landing_perk, offer: s.offer, presentation: s.presentation, key_points: s.key_points, restrictions: s.restrictions, slogan: s.slogan, goal: s.goal, goal_other: s.goal_other }, { hasLogo: s.has_logo });
  }
  const sumBy = Object.fromEntries(totals.rows.map((r) => [r.stage, Number(r.total)]));
  const columns = C.SPONSOR_STAGES.map((s) => ({ ...s, items: sponsors.filter((x) => x.stage === s.key), total: sumBy[s.key] || 0 }));
  res.render('sponsors/index', { title: 'Patrocinadores', view, q, ownerFilter: req.query.owner || '', stage, sponsors, columns, owners, stages: C.SPONSOR_STAGES, kinds: C.SPONSOR_KINDS, tiers: C.SPONSOR_TIERS });
}));

// ---- criar ----
router.get('/patrocinadores/novo', requirePerm('sponsors.write'), wrap(async (req, res) => {
  res.render('sponsors/form', { title: 'Novo patrocinador', sponsor: null, error: null, notice: null, ...(await formOptions()), values: { owner_id: req.user.id, stage: 'prospect' } });
}));

router.post('/patrocinadores', requirePerm('sponsors.write'), wrap(async (req, res) => {
  const { values, error } = await parseSponsorForm(req.body);
  if (error) return res.status(400).render('sponsors/form', { title: 'Novo patrocinador', sponsor: null, error, notice: null, values: echo(req.body, values), ...(await formOptions()) });
  const { rows: [s] } = await db.query(
    `INSERT INTO sponsors (${COLUMNS.join(', ')}, created_by) VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(',')}, $${COLUMNS.length + 1}) RETURNING id`,
    [...columnValues(values), req.user.id]);
  if (values.tier) await require('../services/plans').applyToSponsor(s.id);
  await sponsorsSvc.addEvent(s.id, req.user.id, 'criado', `Patrocinador cadastrado por ${req.user.name}`);
  await audit(req, 'patrocinador.criado', 'sponsor', s.id, { company: values.company });
  await req.flash('ok', 'Patrocinador cadastrado.');
  res.redirect(back(s.id));
}));

// ---- detalhe ----
router.get('/patrocinadores/:id', requirePerm('sponsors.read'), wrap(async (req, res) => {
  const sponsor = await findSponsor(req.params.id);
  if (!sponsor) return notFound(res);
  const [events, brief, files, deliverables, linked, episodes, clicks] = await Promise.all([
    db.query(`SELECT e.*, u.name AS user_name FROM sponsor_events e LEFT JOIN users u ON u.id = e.user_id
               WHERE e.sponsor_id = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT 100`, [sponsor.id]),
    sponsorsSvc.loadBrief(sponsor.id),
    db.query('SELECT * FROM sponsor_files WHERE sponsor_id = $1 ORDER BY created_at DESC, id DESC', [sponsor.id]),
    require('../services/plans').deliverablesOf(sponsor.id),
    db.query('SELECT episode_id, role FROM sponsor_episodes WHERE sponsor_id = $1', [sponsor.id]),
    db.query('SELECT e.id, e.number, e.title, e.aired_on, e.recorded_on, e.status, g.name AS guest_name FROM episodes e LEFT JOIN guests g ON g.id = e.guest_id ORDER BY e.number DESC NULLS LAST, e.id DESC LIMIT 200'),
    sponsorsSvc.clickStats(sponsor.id),
  ]);
  const [agenda, guestLinks] = await Promise.all([ // gravações marcadas (ainda sem episódio) que dá para reservar
    db.query(`SELECT g.id, g.name, g.status, g.proposed_at, g.sponsor_id, b.role FROM guests g
                LEFT JOIN sponsor_bookings b ON b.guest_id = g.id AND b.sponsor_id = $1
               WHERE g.status IN ('em_agendamento', 'agendado') AND NOT EXISTS (SELECT 1 FROM episodes e WHERE e.guest_id = g.id)
               ORDER BY g.proposed_at NULLS LAST, lower(g.name)`, [sponsor.id]),
    db.query('SELECT id, name, status, sponsor_relation FROM guests WHERE sponsor_id = $1 ORDER BY lower(name)', [sponsor.id]),
  ]);
  const [thread, linkedTasks] = await Promise.all([
    require('../services/comments').list('sponsor', sponsor.id),
    db.query("SELECT t.id, t.title, t.status, t.due_on, t.due_time, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.sponsor_id = $1 ORDER BY (t.status = 'feito'), t.due_on NULLS LAST", [sponsor.id]),
  ]);
  const outreach = require('../services/outreach');
  const [outHist, outKnown, outEval] = await Promise.all([outreach.history('sponsor', sponsor.id), outreach.knownAddresses('sponsor', sponsor.id, sponsor), sponsor.stage === outreach.KINDS.sponsor.stage ? outreach.evaluateAll('sponsor', { ids: [sponsor.id] }) : new Map()]);
  const outSm = outEval.get(sponsor.id) || null;
  const finSvc = require('../services/finance');
  const finView = can(req.user.role, 'finance.read')
    ? { finSummary: await finSvc.sponsorSummary(sponsor.id), fin: finSvc, money: fmtMoney, today: finSvc.todayISO(), here: req.originalUrl } : { finSummary: null };
  res.render('sponsors/show', {
    outreachCtx: { kind: 'sponsor', sm: outSm, d: outSm ? outreach.describe(outSm) : null, hist: outHist, known: outKnown, firstChannel: (outSm && outSm.lastChannel) || (sponsor.contact_phone ? 'whatsapp' : sponsor.contact_email ? 'email' : 'instagram'), today: require('../services/calendar').todayISO(), CHANNELS: outreach.CHANNELS, RESULTS: outreach.RESULTS, base: '/patrocinadores', subjectId: sponsor.id },
    ...finView, openModal: ['ganho', 'ativo'].includes(req.query.abrir) ? req.query.abrir : null, agenda: agenda.rows, guestLinks: guestLinks.rows, guestStatuses: C.STATUS_BY_KEY,
    comments: thread, linkedTasks: linkedTasks.rows,
    title: sponsor.company, sponsor, events: events.rows, brief, files: files.rows,
    formState: sponsorsSvc.briefState(brief, { hasLogo: files.rows.some((f) => f.kind === 'logo') }), formQuestions: sponsorsSvc.BRIEF_QUESTIONS, deliverables, planInfo: await require('../services/plans').plans(),
    roleByEpisode: Object.fromEntries(linked.rows.map((r) => [r.episode_id, r.role])), episodes: episodes.rows, clicks,
    stageInfo: C.SPONSOR_STAGE_BY_KEY[sponsor.stage], C, stages: C.SPONSOR_STAGES,
    links: sponsor.public_token ? {
      kit: sponsorsSvc.publicUrl(sponsor.public_token), form: sponsorsSvc.publicUrl(sponsor.public_token, '/cadastro'), portal: sponsorsSvc.publicUrl(sponsor.public_token, '/portal'),
    } : null,
    storageReady: config.storageConfigured, groqReady: config.groqConfigured,
  });
}));

// ---- editar ----
router.get('/patrocinadores/:id/editar', requirePerm('sponsors.write'), wrap(async (req, res) => {
  const sponsor = await findSponsor(req.params.id);
  if (!sponsor) return notFound(res);
  const target = C.isSponsorStage(req.query.para) ? req.query.para : sponsor.stage;
  const missing = sponsorsSvc.missingFor(target, sponsor);
  const notice = target !== sponsor.stage && missing.length ? `Para mover para ${C.SPONSOR_STAGE_BY_KEY[target].label} falta: ${listJoin(missing)}.` : null;
  res.render('sponsors/form', { title: `Editar ${sponsor.company}`, sponsor, error: null, notice, ...(await formOptions()), values: { ...sponsor, stage: target } });
}));

router.post('/patrocinadores/:id', requirePerm('sponsors.write'), wrap(async (req, res) => {
  const sponsor = await findSponsor(req.params.id);
  if (!sponsor) return notFound(res);
  const { values, error } = await parseSponsorForm(req.body);
  if (error) return res.status(400).render('sponsors/form', { title: `Editar ${sponsor.company}`, sponsor, error, notice: null, values: echo(req.body, values), ...(await formOptions()) });
  const before = await recordChanges.snapshot('sponsor', sponsor.id);
  await db.query(`UPDATE sponsors SET ${COLUMNS.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [sponsor.id, ...columnValues(values)]);
  if (values.stage !== sponsor.stage) {
    await sponsorsSvc.addEvent(sponsor.id, req.user.id, 'etapa', `Etapa: ${C.SPONSOR_STAGE_BY_KEY[sponsor.stage].label} → ${C.SPONSOR_STAGE_BY_KEY[values.stage].label}`);
  }
  if (values.tier !== sponsor.tier) await syncTier(sponsor, values.tier, req.user);
  await audit(req, 'patrocinador.editado', 'sponsor', sponsor.id);
  await recordChanges.updated({ type: 'sponsor', before, actor: req.user });
  await req.flash('ok', 'Patrocinador atualizado.');
  res.redirect(back(sponsor.id));
}));

// Etapa que exige dados -> janela da página do patrocinador que pede só esses dados.
const STEP_MODAL = { ganho: 'ganho', ativo: 'ativo' };

// ---- mudar etapa (formulário ou arrastar no quadro) ----
router.post('/patrocinadores/:id/etapa', requirePerm('sponsors.write'), wrap(async (req, res) => {
  const sponsor = await findSponsor(req.params.id);
  if (!sponsor) return wantsJson(req) ? res.status(404).json({ ok: false }) : notFound(res);
  if (!C.isSponsorStage(req.body.status)) return wantsJson(req) ? res.status(400).json({ ok: false, error: 'Etapa inválida' }) : res.status(400).send('Etapa inválida');
  const target = req.body.status;
  const missing = target === sponsor.stage ? [] : sponsorsSvc.missingFor(target, sponsor);
  if (missing.length) {
    const message = `Para mover para ${C.SPONSOR_STAGE_BY_KEY[target].label} falta: ${listJoin(missing)}.`;
    const editUrl = STEP_MODAL[target] ? `/patrocinadores/${sponsor.id}?abrir=${STEP_MODAL[target]}` : `/patrocinadores/${sponsor.id}/editar?para=${target}`;
    if (wantsJson(req)) return res.status(422).json({ ok: false, error: message, missing, editUrl });
    await req.flash('error', message);
    return res.redirect(editUrl);
  }
  if (target !== sponsor.stage) {
    await db.query('UPDATE sponsors SET stage = $2, updated_at = now() WHERE id = $1', [sponsor.id, target]);
    await sponsorsSvc.addEvent(sponsor.id, req.user.id, 'etapa', `Etapa: ${C.SPONSOR_STAGE_BY_KEY[sponsor.stage].label} → ${C.SPONSOR_STAGE_BY_KEY[target].label}`);
    await audit(req, 'patrocinador.etapa', 'sponsor', sponsor.id, { de: sponsor.stage, para: target });
  }
  if (wantsJson(req)) return res.json({ ok: true });
  await req.flash('ok', 'Etapa atualizada.');
  return res.redirect(back(sponsor.id));
}));

// Cota mudou: os entregáveis do plano acompanham (os personalizados ficam).
async function syncTier(sponsor, tier, user) {
  const r = await require('../services/plans').applyToSponsor(sponsor.id);
  await sponsorsSvc.addEvent(sponsor.id, user.id, 'entregavel', tier
    ? `Cota ${C.SPONSOR_TIERS[tier]}: ${r.added} entregável(is) do plano adicionado(s)${r.removed ? `, ${r.removed} do plano anterior retirado(s)` : ''}`
    : `Sem cota: ${r.removed} entregável(is) do plano retirado(s)`);
}

// ---- próximo passo guiado: a janela manda só os campos que faltam para a etapa; salva e, se der, muda a etapa ----
router.post('/patrocinadores/:id/avancar', requirePerm('sponsors.write'), wrap(async (req, res) => {
  const sponsor = await findSponsor(req.params.id);
  if (!sponsor) return notFound(res);
  const b = req.body;
  const target = C.isSponsorStage(b.para) ? b.para : sponsor.stage;
  const next = { ...sponsor };
  let error = null;
  if ('tier' in b) next.tier = Object.prototype.hasOwnProperty.call(C.SPONSOR_TIERS, b.tier) ? b.tier : null;
  if ('value' in b) { const v = parseBRL(b.value); if (Number.isNaN(v)) error = 'Valor inválido. Use algo como 15.000,00.'; else next.value_cents = v; }
  if ('contact_name' in b) next.contact_name = clean(b.contact_name, 150) || null;
  if ('contact_phone' in b) next.contact_phone = clean(b.contact_phone, 40) || null;
  if ('contact_email' in b) { next.contact_email = clean(b.contact_email, 254).toLowerCase() || null; if (next.contact_email && !isEmail(next.contact_email)) error = error || 'E-mail do responsável inválido.'; }
  for (const f of ['paid_at', 'starts_on', 'ends_on']) {
    if (!(f in b)) continue;
    const d = parseInputDate(b[f]);
    if (Number.isNaN(d)) error = error || 'Data inválida.'; else next[f] = d;
  }
  const day = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : String(v));
  if (!error && next.starts_on && next.ends_on && day(next.ends_on) < day(next.starts_on)) error = 'O fim da vigência não pode ser antes do início.';
  const reopen = `/patrocinadores/${sponsor.id}${STEP_MODAL[target] && target !== sponsor.stage ? `?abrir=${STEP_MODAL[target]}` : ''}`;
  if (error) { await req.flash('error', error); return res.redirect(reopen); }
  const missing = target === sponsor.stage ? [] : sponsorsSvc.missingFor(target, next);
  const stage = missing.length ? sponsor.stage : target;
  const before = await recordChanges.snapshot('sponsor', sponsor.id);
  await db.query(
    `UPDATE sponsors SET tier=$2, value_cents=$3, contact_name=$4, contact_phone=$5, contact_email=$6, paid_at=$7, starts_on=$8, ends_on=$9, stage=$10, updated_at=now() WHERE id=$1`,
    [sponsor.id, next.tier, next.value_cents, next.contact_name, next.contact_phone, next.contact_email, next.paid_at, next.starts_on, next.ends_on, stage]);
  if (next.tier !== sponsor.tier) await syncTier(sponsor, next.tier, req.user);
  if (stage !== sponsor.stage) {
    await sponsorsSvc.addEvent(sponsor.id, req.user.id, 'etapa', `Etapa: ${C.SPONSOR_STAGE_BY_KEY[sponsor.stage].label} → ${C.SPONSOR_STAGE_BY_KEY[stage].label}`);
    await audit(req, 'patrocinador.etapa', 'sponsor', sponsor.id, { de: sponsor.stage, para: stage });
  } else {
    await audit(req, 'patrocinador.editado', 'sponsor', sponsor.id);
  }
  await recordChanges.updated({ type: 'sponsor', before, actor: req.user });
  if (missing.length) {
    await req.flash('error', `Salvo. Para mover para ${C.SPONSOR_STAGE_BY_KEY[target].label} falta: ${listJoin(missing)}.`);
    return res.redirect(reopen);
  }
  await req.flash('ok', stage !== sponsor.stage ? `Etapa: ${C.SPONSOR_STAGE_BY_KEY[stage].label}.` : 'Salvo.');
  res.redirect(back(sponsor.id));
}));

router.post('/patrocinadores/:id/nota', requirePerm('sponsors.write'), wrap(async (req, res) => {
  const sponsor = await findSponsor(req.params.id);
  if (!sponsor) return notFound(res);
  const note = clean(req.body.nota, 1000);
  if (note) {
    await sponsorsSvc.addEvent(sponsor.id, req.user.id, 'nota', note);
    await db.query('UPDATE sponsors SET updated_at = now() WHERE id = $1', [sponsor.id]);
  }
  res.redirect(back(sponsor.id, '#timeline'));
}));

// ---- links públicos (media kit / formulário / portal) ----
router.post('/patrocinadores/:id/links', requirePerm('sponsors.write'), wrap(async (req, res) => {
  const sponsor = await findSponsor(req.params.id);
  if (!sponsor) return notFound(res);
  const regenerate = req.body.regenerar === '1';
  await sponsorsSvc.ensureToken(sponsor, { regenerate });
  if (regenerate) await require('../services/sponsorSessions').revokeAll(sponsor.id);
  await sponsorsSvc.addEvent(sponsor.id, req.user.id, 'link', regenerate ? 'Novos links gerados (os anteriores deixaram de funcionar)' : 'Links do patrocinador gerados');
  await audit(req, regenerate ? 'patrocinador.links_regenerados' : 'patrocinador.links_gerados', 'sponsor', sponsor.id);
  await req.flash('ok', regenerate ? 'Novos links gerados. Os anteriores deixaram de funcionar.' : 'Links gerados.');
  res.redirect(back(sponsor.id, '#links'));
}));

// ---- briefing (a equipe também pode preencher/ajustar) ----
router.get('/patrocinadores/:id/briefing', requirePerm('sponsors.write'), wrap(async (req, res) => {
  const sponsor = await findSponsor(req.params.id);
  if (!sponsor) return notFound(res);
  res.render('sponsors/brief-edit', { title: `Briefing — ${sponsor.company}`, sponsor, brief: await sponsorsSvc.loadBrief(sponsor.id), error: null, goals: C.SPONSOR_GOALS });
}));

router.post('/patrocinadores/:id/briefing', requirePerm('sponsors.write'), wrap(async (req, res) => {
  const sponsor = await findSponsor(req.params.id);
  if (!sponsor) return notFound(res);
  const { values, error } = sponsorsSvc.parseBrief(req.body);
  if (error) return res.status(400).render('sponsors/brief-edit', { title: `Briefing — ${sponsor.company}`, sponsor, brief: { ...values, landing_url: req.body.landing_url }, error, goals: C.SPONSOR_GOALS });
  await sponsorsSvc.saveBrief(sponsor.id, values);
  await db.query('UPDATE sponsors SET updated_at = now() WHERE id = $1', [sponsor.id]);
  await sponsorsSvc.addEvent(sponsor.id, req.user.id, 'briefing', `Briefing editado por ${req.user.name}`);
  await audit(req, 'patrocinador.briefing', 'sponsor', sponsor.id);
  await req.flash('ok', 'Briefing salvo.');
  res.redirect(back(sponsor.id, '#briefing'));
}));

// ---- episódios contemplados ----
router.post('/patrocinadores/:id/episodios', requirePerm('sponsors.write'), wrap(async (req, res) => {
  const sponsor = await findSponsor(req.params.id);
  if (!sponsor) return notFound(res);
  const picks = []; const bookings = [];
  for (const [key, role] of Object.entries(req.body)) {
    const m = key.match(/^(role|booking)_(\d{1,9})$/);
    if (m && ['insercao', 'exclusivo'].includes(role)) (m[1] === 'role' ? picks : bookings).push([Number(m[2]), role]);
  }
  const settingsSvc = require('../services/settings');
  if (await settingsSvc.blockInsertion()) { // cada episódio/gravação escolhido junto com o que os outros patrocinadores já têm nele
    const names = { [sponsor.id]: sponsor.company };
    const check = async (rows, mine) => {
      for (const [id, role] of mine) {
        const others = rows.filter((r) => r.ref === id);
        others.forEach((o) => { names[o.sponsor_id] = o.company; });
        const err = settingsSvc.conflict([{ sponsor: sponsor.id, role }, ...others.map((o) => ({ sponsor: o.sponsor_id, role: o.role }))], names);
        if (err) return err;
      }
      return null;
    };
    const { rows: onEp } = await db.query('SELECT se.episode_id AS ref, se.sponsor_id, se.role, s.company FROM sponsor_episodes se JOIN sponsors s ON s.id = se.sponsor_id WHERE se.sponsor_id <> $1', [sponsor.id]);
    const { rows: onBk } = await db.query('SELECT b.guest_id AS ref, b.sponsor_id, b.role, s.company FROM sponsor_bookings b JOIN sponsors s ON s.id = b.sponsor_id WHERE b.sponsor_id <> $1', [sponsor.id]);
    const err = (await check(onEp, picks)) || (await check(onBk, bookings));
    if (err) { await req.flash('error', err); return res.redirect(back(sponsor.id, '#entregas')); }
  }
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM sponsor_episodes WHERE sponsor_id = $1', [sponsor.id]);
    for (const [episodeId, role] of picks) {
      await client.query('INSERT INTO sponsor_episodes (sponsor_id, episode_id, role) SELECT $1, id, $3 FROM episodes WHERE id = $2', [sponsor.id, episodeId, role]);
    }
    // reservas de gravações marcadas (convidados ainda sem episódio)
    await client.query('DELETE FROM sponsor_bookings WHERE sponsor_id = $1', [sponsor.id]);
    for (const [guestId, role] of bookings) {
      await client.query(`INSERT INTO sponsor_bookings (sponsor_id, guest_id, role) SELECT $1, g.id, $3 FROM guests g
                           WHERE g.id = $2 AND NOT EXISTS (SELECT 1 FROM episodes e WHERE e.guest_id = g.id)`, [sponsor.id, guestId, role]);
    }
    await client.query('UPDATE sponsors SET updated_at = now() WHERE id = $1', [sponsor.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await sponsorsSvc.addEvent(sponsor.id, req.user.id, 'episodios', `Episódios do patrocínio atualizados (${picks.length})`);
  await req.flash('ok', 'Episódios atualizados.');
  res.redirect(back(sponsor.id, '#episodios'));
}));

// ---- entregáveis ----
// Do plano (herdam título, descrição e quantidade; a equipe pode sobrescrever) ou só deste patrocinador (personalizados).
function parseDeliverable(body) {
  const qty = Number.parseInt(body.quantity, 10);
  const link = guestRules.normalizeUrl(body.link_url);
  return {
    kind: Object.prototype.hasOwnProperty.call(C.DELIVERABLE_KINDS, body.kind) ? body.kind : null,
    title: clean(body.title, 120) || null,
    description: clean(body.description, 500) || null,
    quantity: Number.isInteger(qty) && qty > 0 && qty < 1000 ? qty : null,
    status: Object.prototype.hasOwnProperty.call(C.DELIVERABLE_STATUSES, body.status) ? body.status : 'pendente',
    link_url: link.value || null,
    linkError: Boolean(link.error),
    notes: clean(body.notes, 500) || null,
  };
}

router.post('/patrocinadores/:id/entregaveis', requirePerm('sponsors.write'), wrap(async (req, res) => {
  const sponsor = await findSponsor(req.params.id);
  if (!sponsor) return notFound(res);
  const d = parseDeliverable(req.body);
  if ((!d.kind && !d.title) || d.linkError) {
    await req.flash('error', d.linkError ? 'O link do entregável não parece válido.' : 'Escolha o tipo ou dê um nome ao entregável.');
    return res.redirect(back(sponsor.id, '#entregas'));
  }
  const { rows: [file] } = ['moldura', 'qr_code'].includes(d.kind)
    ? await db.query("SELECT id FROM sponsor_files WHERE sponsor_id = $1 AND kind = $2 ORDER BY id DESC LIMIT 1", [sponsor.id, d.kind === 'qr_code' ? 'qrcode' : 'moldura'])
    : { rows: [] };
  await db.query('INSERT INTO sponsor_deliverables (sponsor_id, kind, title, description, quantity, status, link_url, notes, file_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [sponsor.id, d.kind, d.title, d.description, d.quantity, d.status, d.link_url, d.notes, file?.id || null]);
  await db.query('UPDATE sponsors SET updated_at = now() WHERE id = $1', [sponsor.id]);
  await sponsorsSvc.addEvent(sponsor.id, req.user.id, 'entregavel', `Entregável personalizado adicionado: ${d.title || C.DELIVERABLE_KINDS[d.kind]}${d.quantity ? ` (${d.quantity})` : ''}`);
  res.redirect(back(sponsor.id, '#entregas'));
}));

router.post('/patrocinadores/:id/entregaveis/:did', requirePerm('sponsors.write'), wrap(async (req, res) => {
  const sponsor = await findSponsor(req.params.id);
  if (!sponsor || !isIntId(req.params.did)) return notFound(res);
  if (req.body.status_only === '1') { // troca rápida de status na lista
    const st = Object.prototype.hasOwnProperty.call(C.DELIVERABLE_STATUSES, req.body.status) ? req.body.status : null;
    const { rowCount } = st ? await db.query('UPDATE sponsor_deliverables SET status = $3 WHERE id = $1 AND sponsor_id = $2', [req.params.did, sponsor.id, st]) : { rowCount: 0 };
    if (rowCount) await sponsorsSvc.addEvent(sponsor.id, req.user.id, 'entregavel', `Entregável atualizado: ${C.DELIVERABLE_STATUSES[st]}`);
    return res.redirect(back(sponsor.id, '#entregas'));
  }
  const d = parseDeliverable(req.body);
  if (d.linkError) {
    await req.flash('error', 'O link do entregável não parece válido.');
    return res.redirect(back(sponsor.id, '#entregas'));
  }
  const { rows: [cur] } = await db.query(
    `SELECT d.*, pi.title AS plan_title, pi.description AS plan_description, pi.quantity AS plan_quantity FROM sponsor_deliverables d LEFT JOIN plan_items pi ON pi.id = d.plan_item_id
      WHERE d.id = $1 AND d.sponsor_id = $2`, [req.params.did, sponsor.id]);
  if (!cur) return notFound(res);
  let { title, description, quantity } = d;
  if (cur.plan_item_id) { // igual ao plano = herda (guarda nulo, para acompanhar mudanças do plano)
    if (req.body.restaurar === '1' || title === cur.plan_title) title = null;
    if (req.body.restaurar === '1' || description === cur.plan_description) description = null;
    if (req.body.restaurar === '1' || quantity === cur.plan_quantity) quantity = null;
  } else if (!title && !cur.kind) title = cur.title; // personalizado sem tipo precisa de nome
  await db.query('UPDATE sponsor_deliverables SET status = $3, quantity = $4, link_url = $5, notes = $6, title = $7, description = $8 WHERE id = $1 AND sponsor_id = $2',
    [cur.id, sponsor.id, d.status, quantity, d.link_url, d.notes, title, description]);
  await db.query('UPDATE sponsors SET updated_at = now() WHERE id = $1', [sponsor.id]);
  await sponsorsSvc.addEvent(sponsor.id, req.user.id, 'entregavel', req.body.restaurar === '1' ? 'Entregável voltou ao padrão do plano' : `Entregável atualizado: ${C.DELIVERABLE_STATUSES[d.status]}`);
  res.redirect(back(sponsor.id, '#entregas'));
}));

router.post('/patrocinadores/:id/entregaveis/:did/excluir', requirePerm('sponsors.write'), wrap(async (req, res) => {
  const sponsor = await findSponsor(req.params.id);
  if (!sponsor || !isIntId(req.params.did)) return notFound(res);
  await db.query('DELETE FROM sponsor_deliverables WHERE id = $1 AND sponsor_id = $2', [req.params.did, sponsor.id]);
  res.redirect(back(sponsor.id, '#entregas'));
}));

// Reaplica o plano da cota: traz de volta o que foi retirado e tira o que o plano não tem mais.
router.post('/patrocinadores/:id/plano', requirePerm('sponsors.write'), wrap(async (req, res) => {
  const sponsor = await findSponsor(req.params.id);
  if (!sponsor) return notFound(res);
  const r = await require('../services/plans').applyToSponsor(sponsor.id);
  await sponsorsSvc.addEvent(sponsor.id, req.user.id, 'entregavel', `Plano reaplicado: ${r.added} adicionado(s), ${r.removed} retirado(s)`);
  await req.flash('ok', r.added || r.removed ? `Plano reaplicado: ${r.added} entregável(is) adicionado(s), ${r.removed} retirado(s).` : 'Os entregáveis já estão iguais ao plano.');
  res.redirect(back(sponsor.id, '#entregas'));
}));

// ---- arquivos: envio (corpo cru, feito por fetch no painel), leitura e exclusão ----
const STAFF_KINDS = { moldura: ['image/png', 'image/jpeg', 'image/webp'], qrcode: ['image/png', 'image/jpeg', 'image/webp'], material: null };
router.post('/patrocinadores/:id/arquivo', requirePerm('sponsors.write'),
  express.raw({ type: () => true, limit: MAX_UPLOAD }),
  wrap(async (req, res) => {
    const sponsor = await findSponsor(req.params.id);
    if (!sponsor) return res.status(404).json({ ok: false, error: 'Patrocinador não encontrado.' });
    const kind = String(req.query.tipo || '');
    const type = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(STAFF_KINDS, kind)) return res.status(400).json({ ok: false, error: 'Tipo de arquivo inválido.' });
    if (STAFF_KINDS[kind] && !STAFF_KINDS[kind].includes(type)) return res.status(400).json({ ok: false, error: 'Envie uma imagem PNG, JPG ou WebP.' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ ok: false, error: 'Arquivo vazio.' });
    const file = await sponsorsSvc.storeFile({
      sponsorId: sponsor.id, kind, buffer: req.body, filename: clean(req.query.nome, 150), contentType: type || 'application/octet-stream', replace: kind !== 'material',
    });
    const deliverableKind = { moldura: 'moldura', qrcode: 'qr_code' }[kind];
    if (deliverableKind) await db.query('UPDATE sponsor_deliverables SET file_id = $2 WHERE sponsor_id = $1 AND kind = $3', [sponsor.id, file.id, deliverableKind]);
    await db.query('UPDATE sponsors SET updated_at = now() WHERE id = $1', [sponsor.id]);
    await sponsorsSvc.addEvent(sponsor.id, req.user.id, 'arquivo', `Arquivo enviado: ${kind}${file.filename ? ` (${file.filename})` : ''}`);
    res.json({ ok: true, id: file.id });
  }));

router.get('/patrocinadores/:id/arquivos/:fid', requirePerm('sponsors.read'), wrap(async (req, res) => {
  if (!isIntId(req.params.id) || !isIntId(req.params.fid)) return notFound(res);
  const { rows: [file] } = await db.query('SELECT * FROM sponsor_files WHERE id = $1 AND sponsor_id = $2', [req.params.fid, req.params.id]);
  if (!file) return notFound(res);
  return sponsorsSvc.sendFile(res, file, { inline: req.query.baixar !== '1' });
}));

router.post('/patrocinadores/:id/arquivos/:fid/excluir', requirePerm('sponsors.write'), wrap(async (req, res) => {
  if (!isIntId(req.params.id) || !isIntId(req.params.fid)) return notFound(res);
  const { rows: [file] } = await db.query('SELECT * FROM sponsor_files WHERE id = $1 AND sponsor_id = $2', [req.params.fid, req.params.id]);
  if (!file) return notFound(res);
  await sponsorsSvc.deleteFile(file);
  await sponsorsSvc.addEvent(file.sponsor_id, req.user.id, 'arquivo', `Arquivo removido: ${file.kind}${file.filename ? ` (${file.filename})` : ''}`);
  res.redirect(back(file.sponsor_id, '#arquivos'));
}));

// ---- excluir ----
router.post('/patrocinadores/:id/excluir', requirePerm('sponsors.delete'), wrap(async (req, res) => {
  const sponsor = await findSponsor(req.params.id);
  if (!sponsor) return notFound(res);
  const { rows: files } = await db.query('SELECT * FROM sponsor_files WHERE sponsor_id = $1', [sponsor.id]);
  await audit(req, 'patrocinador.excluido', 'sponsor', sponsor.id, { company: sponsor.company });
  await require('../services/finance').onSponsorDeleted(sponsor.id);
  const gone = await recordChanges.snapshot('sponsor', sponsor.id);
  await db.query('DELETE FROM sponsors WHERE id = $1', [sponsor.id]);
  await recordChanges.deleted({ type: 'sponsor', row: gone, actor: req.user });
  for (const f of files) await require('../services/b2').deleteObject(f.storage_key).catch((err) => console.error('Falha ao apagar arquivo:', err.message));
  await req.flash('ok', `${sponsor.company} foi removido(a).`);
  res.redirect('/patrocinadores');
}));

module.exports = router;
