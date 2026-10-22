// Episódios: a linha de produção. O episódio nasce quando a conversa é gravada (do convidado ou, só com os hosts, do patrocinador)
// e segue até Publicado.
const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const uploadPost = require('../services/uploadPost');
const richText = require('../services/richText');
const attachmentsSvc = require('../services/attachments');
const b2 = require('../services/b2');
const prod = require('../services/production');
const sponsorsSvc = require('../services/sponsors');
const { audit } = require('../services/audit');
const recordChanges = require('../services/recordChanges');
const { requirePerm } = require('../middleware');
const { can } = require('../permissions');
const C = require('../constants');
const { wrap, isIntId, isUuid } = require('../utils/wrap');
const fmt = require('../utils/format');
const { clean, parseInputDate } = fmt;
const guestRules = require('../services/guestRules');
const jobs = require('../services/jobs');
const L = require('../services/platformLimits');
const tasksSvc = require('../services/tasks');
const commentsSvc = require('../services/comments');

const router = express.Router();
const wantsJson = (req) => (req.get('accept') || '').includes('application/json');
const notFound = (res) => res.status(404).render('error', { title: 'Não encontrado', message: 'Episódio não encontrado.' });
const back = (id, hash = '') => `/episodios/${id}${hash}`;
const MAX_PART = 70 * prod.MB;
const MAX_FILE = 200 * 1024 * prod.MB * 1; // 200 GB

async function findEpisode(id) {
  if (!isIntId(id)) return null;
  const { rows } = await db.query(
    `SELECT e.*, g.name AS guest_name, g.instagram AS guest_instagram, g.positioning AS guest_positioning, g.bio AS guest_bio, u.name AS editor_name
       FROM episodes e LEFT JOIN guests g ON g.id = e.guest_id LEFT JOIN users u ON u.id = e.editor_id WHERE e.id = $1`, [id]);
  return rows[0] || null;
}


// ---- edição dos dados básicos ----
async function parseForm(body, currentId = null) {
  const num = body.number === '' || body.number == null ? null : Number.parseInt(body.number, 10);
  const airedOn = parseInputDate(body.aired_on);
  const recordedOn = parseInputDate(body.recorded_on);
  const values = {
    number: Number.isInteger(num) && num > 0 && num < 100000 ? num : null,
    title: clean(body.title, 200),
    aired_on: Number.isNaN(airedOn) ? null : airedOn,
    recorded_on: Number.isNaN(recordedOn) ? null : recordedOn,
    notes: clean(body.notes, 2000) || null,
  };
  let error = null;
  if (values.title.length < 2) error = 'Informe o título do episódio.';
  else if (body.number && values.number == null) error = 'Número do episódio inválido.';
  else if (Number.isNaN(airedOn) || Number.isNaN(recordedOn)) error = 'Data inválida.';
  if (!error && values.number != null) {
    const { rowCount } = await db.query('SELECT 1 FROM episodes WHERE number = $1 AND ($2::int IS NULL OR id <> $2)', [values.number, currentId]);
    if (rowCount) error = `Já existe o episódio ${String(values.number).padStart(3, '0')}.`;
  }
  return { values, error };
}
const echo = (body, v) => ({ ...body, ...v, number: body.number || '', aired_on: body.aired_on || '', recorded_on: body.recorded_on || '' });

// ---- novo episódio = registrar uma gravação feita ----
// Quem sentou à mesa: um convidado já cadastrado, um convidado novo (cadastrado aqui) ou só os hosts (aí o episódio é de um patrocinador).
// Patrocinador: opcional com convidado, obrigatório só com os hosts; pode ser cadastrado aqui também.
const ORIGINS = ['convidado', 'novo_convidado', 'hosts'];
const formLocals = async (extra) => {
  const [guests, sponsors] = await Promise.all([
    db.query(`SELECT g.id, g.name, g.status, g.sponsor_id FROM guests g WHERE NOT EXISTS (SELECT 1 FROM episodes e WHERE e.guest_id = g.id)
               AND g.status NOT IN ('perdido', 'cancelado') ORDER BY (g.status = 'agendado') DESC, lower(g.name) LIMIT 1000`),
    db.query("SELECT id, company FROM sponsors WHERE stage <> 'perdido' ORDER BY lower(company)"),
  ]);
  return { statuses: C.EPISODE_STATUSES, guests: guests.rows, sponsors: sponsors.rows, profiles: C.PROFILES, kinds: C.SPONSOR_KINDS, guestStatuses: C.STATUS_BY_KEY, ...extra };
};

async function parseNew(body) {
  const base = await parseForm({ ...body, title: body.title || 'Episódio' }); // título vazio = automático
  const v = { ...base.values, origin: ORIGINS.includes(body.origem) ? body.origem : null, title: clean(body.title, 200) };
  let error = base.error;
  if (!v.origin) error = error || 'Escolha quem sentou à mesa.';
  const sponsorMode = body.patrocinador === 'novo' ? 'novo' : (isIntId(String(body.patrocinador || '')) ? 'existente' : 'nenhum');
  v.role = body.papel === 'insercao' ? 'insercao' : 'exclusivo';
  if (!error && v.origin === 'convidado') {
    v.guest_id = isIntId(String(body.guest_id || '')) ? Number(body.guest_id) : null;
    const { rows: [g] } = v.guest_id ? await db.query('SELECT g.*, EXISTS (SELECT 1 FROM episodes e WHERE e.guest_id = g.id) AS has_ep FROM guests g WHERE g.id = $1', [v.guest_id]) : { rows: [] };
    if (!g) error = 'Escolha o convidado.';
    else if (g.has_ep) error = 'Esse convidado já tem um episódio.';
    else v.guest = g;
  }
  if (!error && v.origin === 'novo_convidado') {
    v.newGuest = { name: clean(body.guest_name, 150), instagram: guestRules.normalizeInstagram(body.guest_instagram), profile: guestRules.normalizeProfile(body.guest_profile) };
    if (v.newGuest.name.length < 2) error = 'Informe o nome do convidado.';
    else if (!v.newGuest.instagram) error = 'Informe o Instagram do convidado (ex.: @maria.souza).';
    else if (!v.newGuest.profile) error = 'Escolha o perfil do convidado.';
    v.relation = ['representante', 'indicado'].includes(body.relacao) ? body.relacao : null;
  }
  if (!error && v.origin === 'hosts' && sponsorMode === 'nenhum') error = 'Episódio só com os hosts precisa de um patrocinador.';
  if (!error && sponsorMode === 'existente') {
    const { rows: [sp] } = await db.query('SELECT id, company FROM sponsors WHERE id = $1', [Number(body.patrocinador)]);
    if (!sp) error = 'Patrocinador inválido.'; else v.sponsor = { id: sp.id, company: sp.company, role: v.role };
  }
  if (!error && sponsorMode === 'novo') {
    v.newSponsor = { company: clean(body.sponsor_company, 150), kind: Object.prototype.hasOwnProperty.call(C.SPONSOR_KINDS, body.sponsor_kind) ? body.sponsor_kind : null };
    if (v.newSponsor.company.length < 2) error = 'Informe o nome do patrocinador.';
    else if (!v.newSponsor.kind) error = 'Escolha o tipo do patrocinador (marca pessoal ou negócio).';
  }
  return { values: v, error };
}

// ---- quadro de produção / lista ----
router.get('/episodios', requirePerm('episodes.read'), wrap(async (req, res) => {
  const view = req.query.view === 'lista' ? 'lista' : 'quadro';
  const mine = req.query.editor === 'eu';
  const { rows } = await db.query(
    `SELECT e.*, g.name AS guest_name, u.name AS editor_name,
            (SELECT count(*)::int FROM sponsor_episodes se WHERE se.episode_id = e.id) AS sponsors,
            (SELECT count(*)::int FROM episode_files f WHERE f.episode_id = e.id AND f.status = 'pronto') AS files,
            (SELECT count(*)::int FROM tasks t WHERE t.episode_id = e.id) AS tasks,
            (SELECT count(*)::int FROM tasks t WHERE t.episode_id = e.id AND t.status = 'feito') AS tasks_done,
            (SELECT count(*)::int FROM episode_comments c WHERE c.episode_id = e.id AND NOT c.resolved) AS open_comments
       FROM episodes e LEFT JOIN guests g ON g.id = e.guest_id LEFT JOIN users u ON u.id = e.editor_id
      ${mine ? 'WHERE e.editor_id = $1' : ''}
      ORDER BY e.number DESC NULLS LAST, e.id DESC LIMIT 500`, mine ? [req.user.id] : []);
  const columns = C.EPISODE_STAGES.map((s) => ({ ...s, items: rows.filter((e) => e.status === s.key) }));
  res.render('episodes/index', { title: 'Episódios', view, mine, episodes: rows, columns, stages: C.EPISODE_STAGES, statuses: C.EPISODE_STATUSES });
}));

router.get('/episodios/novo', requirePerm('episodes.write'), wrap(async (req, res) => {
  const { rows: [last] } = await db.query('SELECT coalesce(max(number), 0) + 1 AS next FROM episodes');
  const pre = { number: last.next, recorded_on: tasksSvc.todayISO(), origem: 'convidado', papel: 'exclusivo' };
  if (isIntId(String(req.query.convidado || ''))) pre.guest_id = Number(req.query.convidado);
  if (isIntId(String(req.query.patrocinador || ''))) { pre.patrocinador = req.query.patrocinador; pre.origem = 'hosts'; }
  res.render('episodes/new', await formLocals({ title: 'Novo episódio', error: null, values: pre }));
}));

router.post('/episodios', requirePerm('episodes.write'), wrap(async (req, res) => {
  const { values: v, error } = await parseNew(req.body);
  if (error) return res.status(400).render('episodes/new', await formLocals({ title: 'Novo episódio', error, values: echo(req.body, {}) }));
  const sponsorsSvc2 = require('../services/sponsors');
  if (v.newSponsor) {
    const { rows: [sp] } = await db.query("INSERT INTO sponsors (company, kind, stage, owner_id, created_by) VALUES ($1, $2, 'negociacao', $3, $3) RETURNING id, company", [v.newSponsor.company, v.newSponsor.kind, req.user.id]);
    await sponsorsSvc2.addEvent(sp.id, req.user.id, 'criado', `Patrocinador cadastrado por ${req.user.name} ao registrar um episódio`);
    v.sponsor = { id: sp.id, company: sp.company, role: v.role };
  }
  const guestsSvc = require('../services/guests');
  let guest = v.guest || null;
  if (v.newGuest) {
    const { rows: [g] } = await db.query(
      `INSERT INTO guests (name, instagram, profile, status, owner_id, sponsor_id, sponsor_relation, created_by) VALUES ($1,$2,$3,'gravado',$4,$5,$6,$4) RETURNING *`,
      [v.newGuest.name, v.newGuest.instagram, v.newGuest.profile, req.user.id, v.sponsor && v.relation ? v.sponsor.id : null, v.sponsor && v.relation ? v.relation : null]);
    guest = g;
    await guestsSvc.addEvent(g.id, req.user.id, 'criado', `Convidado cadastrado por ${req.user.name} ao registrar o episódio (já gravado)`);
  } else if (guest && guest.status !== 'gravado') {
    await db.query("UPDATE guests SET status = 'gravado', updated_at = now() WHERE id = $1", [guest.id]);
    await guestsSvc.addEvent(guest.id, req.user.id, 'status', `Etapa: ${C.STATUS_BY_KEY[guest.status].label} → Gravado (episódio registrado)`);
  }
  const recordedOn = v.recorded_on || tasksSvc.todayISO();
  const title = v.title || (guest ? `Conversa com ${guest.name}` : `Episódio ${v.sponsor.company}`);
  const ep = await prod.createEpisode({ title, guestId: guest ? guest.id : null, recordedOn, userId: req.user.id, sponsor: v.sponsor || null, origin: guest ? `convidado ${guest.name}` : `patrocinador ${v.sponsor.company} (só os hosts)` });
  await db.query('UPDATE episodes SET number = coalesce($2, number), aired_on = $3, notes = $4 WHERE id = $1', [ep.id, v.number, v.aired_on, v.notes]);
  if (v.sponsor) await sponsorsSvc2.addEvent(v.sponsor.id, req.user.id, 'episodio', `Episódio registrado: ${title} (${v.sponsor.role === 'exclusivo' ? 'exclusivo' : 'inserção'})`);
  await audit(req, 'episodio.criado', 'episode', ep.id, { title, origem: v.origin });
  await req.flash('ok', 'Episódio registrado. Próximo passo: subir o material bruto.');
  res.redirect(back(ep.id, '#material'));
}));

// ---- modelos de checklist (antes de /:id) ----
router.get('/episodios/checklists', requirePerm('production.checklists'), wrap(async (req, res) => {
  const { rows: templates } = await db.query('SELECT * FROM checklist_templates ORDER BY position, id');
  const { rows: items } = await db.query('SELECT template_id, text FROM checklist_template_items ORDER BY template_id, position');
  for (const t of templates) t.items = items.filter((i) => i.template_id === t.id).map((i) => i.text);
  res.render('episodes/checklists', { title: 'Checklists padrão', templates, gates: C.CHECKLIST_GATES });
}));

const parseTemplate = (body) => ({
  name: clean(body.name, 120),
  gate: Object.prototype.hasOwnProperty.call(C.CHECKLIST_GATES, body.gate) ? body.gate : 'revisao',
  required: body.required === '1' || body.required === 'on',
  active: body.active === '1' || body.active === 'on',
  items: String(body.items || '').split(/\r?\n/).map((l) => clean(l, 300)).filter(Boolean).slice(0, 60),
});

async function saveTemplateItems(client, templateId, items) {
  await client.query('DELETE FROM checklist_template_items WHERE template_id = $1', [templateId]);
  for (let i = 0; i < items.length; i += 1) await client.query('INSERT INTO checklist_template_items (template_id, position, text) VALUES ($1,$2,$3)', [templateId, i + 1, items[i]]);
}

router.post('/episodios/checklists', requirePerm('production.checklists'), wrap(async (req, res) => {
  const t = parseTemplate(req.body);
  if (t.name.length < 2 || !t.items.length) {
    await req.flash('error', 'Dê um nome ao checklist e escreva ao menos um item (um por linha).');
    return res.redirect('/episodios/checklists');
  }
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows: [pos] } = await client.query('SELECT coalesce(max(position), 0) + 1 AS p FROM checklist_templates');
    const { rows: [created] } = await client.query('INSERT INTO checklist_templates (name, gate, required, active, position) VALUES ($1,$2,$3,true,$4) RETURNING id', [t.name, t.gate, t.required, pos.p]);
    await saveTemplateItems(client, created.id, t.items);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  await audit(req, 'checklist.criado', 'checklist', null, { name: t.name });
  await req.flash('ok', 'Checklist criado. Ele vale para os próximos episódios que entrarem em edição.');
  res.redirect('/episodios/checklists');
}));

router.post('/episodios/checklists/:tid', requirePerm('production.checklists'), wrap(async (req, res) => {
  if (!isIntId(req.params.tid)) return notFound(res);
  const t = parseTemplate(req.body);
  if (t.name.length < 2 || !t.items.length) {
    await req.flash('error', 'O checklist precisa de nome e de ao menos um item.');
    return res.redirect('/episodios/checklists');
  }
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query('UPDATE checklist_templates SET name=$2, gate=$3, required=$4, active=$5 WHERE id=$1', [req.params.tid, t.name, t.gate, t.required, t.active]);
    if (!rowCount) { await client.query('ROLLBACK'); return notFound(res); }
    await saveTemplateItems(client, req.params.tid, t.items);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  await audit(req, 'checklist.editado', 'checklist', req.params.tid);
  await req.flash('ok', 'Checklist salvo. Episódios que já estão em produção mantêm a cópia que receberam.');
  res.redirect('/episodios/checklists');
}));

router.post('/episodios/checklists/:tid/excluir', requirePerm('production.checklists'), wrap(async (req, res) => {
  if (!isIntId(req.params.tid)) return notFound(res);
  await db.query('DELETE FROM checklist_templates WHERE id = $1', [req.params.tid]);
  await audit(req, 'checklist.excluido', 'checklist', req.params.tid);
  await req.flash('ok', 'Checklist excluído.');
  res.redirect('/episodios/checklists');
}));

// ---- detalhe do episódio ----
router.get('/episodios/:id', requirePerm('episodes.read'), wrap(async (req, res) => {
  const ep = await findEpisode(req.params.id);
  if (!ep) return notFound(res);
  const [files, events, tasks, checklist, comments, sponsors, users, moves, meta, frames, job, transcript, coverRows, contentRows, pubRows] = await Promise.all([
    db.query(`SELECT f.*, u.name AS uploader FROM episode_files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.episode_id = $1 ORDER BY f.created_at DESC, f.id DESC`, [ep.id]),
    db.query('SELECT e.*, u.name AS user_name FROM episode_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.episode_id = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT 100', [ep.id]),
    db.query('SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.episode_id = $1 ORDER BY t.id', [ep.id]),
    db.query('SELECT * FROM episode_checklist_items WHERE episode_id = $1 ORDER BY position, id', [ep.id]),
    db.query('SELECT c.*, u.name AS author_name FROM episode_comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.episode_id = $1 ORDER BY c.at_ms NULLS FIRST, c.id', [ep.id]),
    prod.sponsorAssets(ep.id),
    db.query("SELECT id, name FROM users WHERE active AND role IN ('editor_video','gestao','superadmin') ORDER BY lower(name)"),
    prod.availableMoves(ep, req.user.role),
    db.query('SELECT * FROM episode_metadata WHERE episode_id = $1', [ep.id]),
    db.query("SELECT id, at_ms, width, height, analysis, score FROM episode_frames WHERE episode_id = $1 AND clip_id IS NULL AND NOT (coalesce(analysis, '{}'::jsonb) ? 'custom') ORDER BY score DESC NULLS LAST, at_ms", [ep.id]),
    jobs.latest(ep.id, 'finalizacao'),
    db.query('SELECT duration_ms, length(text) AS chars, jsonb_array_length(segments) AS segments FROM episode_transcripts WHERE episode_id = $1', [ep.id]),
    db.query('SELECT id, kind, group_key, position, label, lint, width, height, size_bytes, approved, auto, updated_at FROM episode_covers WHERE episode_id = $1 AND clip_id IS NULL ORDER BY kind, group_key, position, id', [ep.id]),
    db.query(`SELECT (SELECT count(*)::int FROM episode_clips WHERE episode_id = $1) AS clips,
                     (SELECT count(*)::int FROM episode_covers WHERE episode_id = $1 AND clip_id IS NULL AND kind IN ('post_quote','post_split','carousel')) AS posts`, [ep.id]),
    db.query('SELECT * FROM episode_publications WHERE episode_id = $1 AND clip_id IS NULL ORDER BY created_at DESC, id DESC LIMIT 30', [ep.id]),
  ]);
  const social = can(req.user.role, 'production.review') && config.uploadPostConfigured && ['pronto_publicar', 'publicado'].includes(ep.status) ? await uploadPost.connected() : null;
  const stageIndex = C.EPISODE_STAGES.findIndex((s) => s.key === ep.status);
  const openComments = comments.rows.filter((c) => !c.resolved).length;
  // Abas por etapa: a revisão só aparece enquanto o episódio está em revisão; a finalização, de "em finalização" em diante.
  const tabs = [{ key: 'resumo', label: 'Resumo' }];
  const finIdx = C.EPISODE_STAGES.findIndex((s) => s.key === 'em_finalizacao');
  tabs.push({ key: 'material', label: 'Material' }); // o episódio já nasce gravado
  if (ep.status === 'em_revisao') tabs.push({ key: 'revisao', label: 'Revisão', badge: openComments || null });
  if (stageIndex >= finIdx) tabs.push({ key: 'finalizacao', label: 'Finalização' });
  let finData = null;
  const finSvc = require('../services/finance');
  if (can(req.user.role, 'finance.read')) {
    finData = { ...(await finSvc.episodeFinance(ep.id)), settings: await finSvc.settings() };
    tabs.push({ key: 'financeiro', label: 'Financeiro' });
  }
  tabs.push({ key: 'historico', label: 'Histórico' });
  const defaultTab = ep.status === 'em_revisao' ? 'revisao' : stageIndex >= finIdx ? 'finalizacao' : 'material';
  files.rows.forEach((f) => { f.stalled = prod.isStalled(f); }); // envio que parou no meio: "não terminou"
  const edited = files.rows.filter((f) => f.kind === 'editado' && f.status === 'pronto');
  const latestEdited = edited[0] || null; // a mais nova primeiro
  res.render('episodes/show', {
    mediaType: require('../services/previews').mediaType, hasPreview: require('../services/previews').hasPreview,
    title: ep.title, ep, files: files.rows, events: events.rows, tasks: tasks.rows, checklist: checklist.rows, comments: await withReviewFiles(comments.rows),
    sponsors, users: users.rows, moves, latestEdited, edited, C, L,
    epComments: await commentsSvc.list('episode', ep.id),
    content: { ...contentRows.rows[0], total: contentRows.rows[0].clips + contentRows.rows[0].posts }, tabs, defaultTab, publications: pubRows.rows, social, uploadPost, uploadLive: config.uploadPost.live,
    covers: coverRows.rows, meta: meta.rows[0] || null, frames: frames.rows, job, transcript: transcript.rows[0] || null,
    aiReady: config.groqConfigured && config.geminiConfigured && config.storageConfigured,
    finData, fin: finSvc, money: fmt.formatBRL, today: finSvc.todayISO(), here: req.originalUrl,
    stageIndex, allSponsors: (await db.query("SELECT id, company FROM sponsors WHERE stage NOT IN ('perdido') ORDER BY lower(company)")).rows,
    partSizeMb: Math.round(prod.partSizeFor(0) / prod.MB), storageReady: config.storageConfigured,
    perm: {
      manage: can(req.user.role, 'production.manage'), upload: can(req.user.role, 'production.upload'),
      edit: can(req.user.role, 'production.edit'), review: can(req.user.role, 'production.review'), write: can(req.user.role, 'episodes.write'),
    },
  });
}));

router.get('/episodios/:id/editar', requirePerm('episodes.write'), wrap(async (req, res) => {
  const ep = await findEpisode(req.params.id);
  if (!ep) return notFound(res);
  res.render('episodes/form', { title: `Editar ${ep.title}`, episode: ep, error: null, values: ep, statuses: C.EPISODE_STATUSES });
}));

router.post('/episodios/:id', requirePerm('episodes.write'), wrap(async (req, res) => {
  const ep = await findEpisode(req.params.id);
  if (!ep) return notFound(res);
  const { values, error } = await parseForm(req.body, ep.id);
  if (error) return res.status(400).render('episodes/form', { title: `Editar ${ep.title}`, episode: ep, error, values: echo(req.body, values), statuses: C.EPISODE_STATUSES });
  const before = await recordChanges.snapshot('episode', ep.id);
  await db.query('UPDATE episodes SET number=$2, title=$3, aired_on=$4, recorded_on=$5, notes=$6, updated_at=now() WHERE id=$1',
    [ep.id, values.number, values.title, values.aired_on, values.recorded_on, values.notes]);
  try { await require('../services/finance').onEpisodeDates(ep.id); } catch (err) { console.error('Financeiro (datas):', err.message); }
  await audit(req, 'episodio.editado', 'episode', ep.id);
  await recordChanges.updated({ type: 'episode', before, actor: req.user });
  await req.flash('ok', 'Episódio atualizado.');
  res.redirect(back(ep.id));
}));

router.post('/episodios/:id/excluir', requirePerm('episodes.delete'), wrap(async (req, res) => {
  const ep = await findEpisode(req.params.id);
  if (!ep) return notFound(res);
  await audit(req, 'episodio.excluido', 'episode', ep.id, { title: ep.title });
  await prod.purgeEpisodeFiles(ep.id);
  await require('../services/finance').onEpisodeDeleted(ep.id);
  const gone = await recordChanges.snapshot('episode', ep.id);
  await db.query('DELETE FROM episodes WHERE id = $1', [ep.id]);
  await recordChanges.deleted({ type: 'episode', row: gone, actor: req.user });
  await req.flash('ok', 'Episódio removido.');
  res.redirect('/episodios');
}));

// ---- mudar de etapa ----
router.post('/episodios/:id/etapa', requirePerm('episodes.read'), wrap(async (req, res) => {
  const ep = await findEpisode(req.params.id);
  if (!ep) return wantsJson(req) ? res.status(404).json({ ok: false }) : notFound(res);
  const result = await prod.move(ep, String(req.body.to || ''), req.user);
  if (result.error) {
    if (wantsJson(req)) return res.status(422).json({ ok: false, error: result.error, missing: result.missing || [] });
    await req.flash('error', result.error);
    return res.redirect(back(ep.id));
  }
  await audit(req, 'episodio.etapa', 'episode', ep.id, { de: ep.status, para: req.body.to });
  if (wantsJson(req)) return res.json({ ok: true });
  await req.flash('ok', `Etapa: ${C.EPISODE_STATUSES[req.body.to]}.`);
  return res.redirect(back(ep.id));
}));

// ---- observações para o editor e links de publicação ----
// Patrocínio do episódio, direto da Visão geral: cada patrocinador com papel (inserção, exclusivo) ou fora.
router.post('/episodios/:id/patrocinadores', requirePerm('production.manage'), wrap(async (req, res) => {
  const ep = await findEpisode(req.params.id);
  if (!ep) return notFound(res);
  const picks = [];
  for (const [key, role] of Object.entries(req.body)) {
    const m = key.match(/^role_(\d{1,9})$/);
    if (m && ['insercao', 'exclusivo'].includes(role)) picks.push([Number(m[1]), role]);
  }
  const settingsSvc = require('../services/settings');
  if (await settingsSvc.blockInsertion()) {
    const { rows: names } = await db.query('SELECT id, company FROM sponsors WHERE id = ANY($1)', [picks.map((x) => x[0])]);
    const err = settingsSvc.conflict(picks.map(([sponsor, role]) => ({ sponsor, role })), Object.fromEntries(names.map((n) => [n.id, n.company])));
    if (err) { await req.flash('error', err); return res.redirect(back(ep.id, '#visao')); }
  }
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM sponsor_episodes WHERE episode_id = $1', [ep.id]);
    for (const [sid, role] of picks) await client.query('INSERT INTO sponsor_episodes (sponsor_id, episode_id, role) SELECT id, $2, $3 FROM sponsors WHERE id = $1', [sid, ep.id, role]);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  await prod.addEvent(ep.id, req.user.id, 'patrocinio', picks.length ? 'Patrocínio do episódio atualizado' : 'Patrocínio do episódio removido');
  await audit(req, 'episodio.patrocinio', 'episode', ep.id);
  await req.flash('ok', 'Patrocínio atualizado.');
  res.redirect(back(ep.id, '#visao'));
}));

router.post('/episodios/:id/observacoes', requirePerm('production.manage'), wrap(async (req, res) => {
  const ep = await findEpisode(req.params.id);
  if (!ep) return notFound(res);
  await db.query('UPDATE episodes SET editor_notes = $2, updated_at = now() WHERE id = $1', [ep.id, clean(req.body.editor_notes, 5000) || null]);
  await prod.addEvent(ep.id, req.user.id, 'observacoes', 'Observações para o editor atualizadas');
  await req.flash('ok', 'Observações salvas.');
  res.redirect(back(ep.id, '#visao'));
}));

router.post('/episodios/:id/editor', requirePerm('production.manage'), wrap(async (req, res) => {
  const ep = await findEpisode(req.params.id);
  if (!ep) return notFound(res);
  const editorId = isUuid(req.body.editor_id) ? req.body.editor_id : null;
  const result = await require('../services/responsible').setResponsible({ type: 'episode', id: ep.id, userId: editorId, actor: req.user });
  if (result.error) { await req.flash('error', 'Editor inválido.'); return res.redirect(back(ep.id, '#visao')); }
  await prod.addEvent(ep.id, req.user.id, 'editor', editorId ? 'Editor definido' : 'Editor removido');
  res.redirect(back(ep.id, '#visao'));
}));

router.post('/episodios/:id/links', requirePerm('production.review'), wrap(async (req, res) => {
  const ep = await findEpisode(req.params.id);
  if (!ep) return notFound(res);
  const yt = guestRules.normalizeUrl(req.body.youtube_url, guestRules.YOUTUBE_HOSTS);
  const sp = guestRules.normalizeUrl(req.body.spotify_url, guestRules.SPOTIFY_HOSTS);
  if (yt.error || sp.error) {
    await req.flash('error', yt.error ? 'O link do YouTube precisa ser youtube.com ou youtu.be.' : 'O link do Spotify precisa ser spotify.com.');
    return res.redirect(back(ep.id, '#publicacao'));
  }
  await db.query('UPDATE episodes SET youtube_url = $2, spotify_url = $3, updated_at = now() WHERE id = $1', [ep.id, yt.value || null, sp.value || null]);
  await prod.addEvent(ep.id, req.user.id, 'links', 'Links de publicação atualizados');
  res.redirect(back(ep.id, '#publicacao'));
}));

// ---- arquivos: envio em partes pelo servidor, leitura por link assinado ----
const EXT = {
  video: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mxf', 'mts', 'm2ts', 'braw', 'r3d', 'mpg', 'mpeg', 'wmv'],
  audio: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'aif', 'aiff', 'ogg', 'opus', 'wma'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff', 'dng', 'cr2', 'cr3', 'arw', 'nef', 'gif'],
};
const ACCEPT = {
  bruto_video: EXT.video, bruto_audio: EXT.audio, foto: EXT.image, bastidor: [...EXT.video, ...EXT.image],
  editado: ['mp4', 'mov', 'm4v', 'mkv', 'webm'], outro: null,
};
const extOf = (name) => String(name).match(/\.([A-Za-z0-9]{1,6})$/)?.[1]?.toLowerCase() || '';

const uploadError = (res, status, error) => res.status(status).json({ ok: false, error });
// Backblaze sem espaço: 507 com código próprio (o navegador para a fila inteira em vez de insistir arquivo por arquivo).
async function storageGuard(res, fn) {
  try { return await fn(); } catch (err) {
    if (err.code !== 'STORAGE_FULL') throw err;
    await prod.storageFull();
    return res.status(507).json({ ok: false, code: 'storage_full', error: prod.STORAGE_FULL_MSG });
  }
}

async function loadFile(req) {
  if (!isIntId(req.params.id) || !isIntId(req.params.fid)) return null;
  const { rows: [file] } = await db.query('SELECT * FROM episode_files WHERE id = $1 AND episode_id = $2', [req.params.fid, req.params.id]);
  return file || null;
}
// Para as rotas de envio: arquivo existente e que este perfil pode mexer (bruto = produção; editado = editor).
async function loadOwnFile(req) {
  const file = await loadFile(req);
  return file && fileAccess(req.user, file.kind) ? file : null;
}

// Material bruto é da produção (production.upload); o vídeo editado é de quem edita (production.edit). A rota deixa entrar os dois
// e cada arquivo é conferido pelo tipo (fileAccess).
const uploadAccess = (req, res, next) => (req.user && (can(req.user.role, 'production.upload') || can(req.user.role, 'production.edit'))
  ? next() : res.status(403).json({ ok: false, error: 'Seu perfil não envia arquivos.' }));
const fileAccess = (user, kind) => can(user.role, kind === 'editado' ? 'production.edit' : 'production.upload');

router.post('/episodios/:id/arquivos/iniciar', uploadAccess, wrap(async (req, res) => {
  if (!config.storageConfigured) return uploadError(res, 503, 'Armazenamento (Backblaze) não configurado.');
  const ep = await findEpisode(req.params.id);
  if (!ep) return uploadError(res, 404, 'Episódio não encontrado.');
  const kind = String(req.body.kind || '');
  if (!Object.prototype.hasOwnProperty.call(C.EPISODE_FILE_KINDS, kind)) return uploadError(res, 400, 'Tipo de arquivo inválido.');
  if (!fileAccess(req.user, kind)) return uploadError(res, 403, kind === 'editado' ? 'Só quem edita sobe o vídeo editado.' : 'O material bruto é enviado pela produção.');
  const filename = prod.safeName(req.body.nome);
  const size = Number(req.body.tamanho);
  if (!Number.isSafeInteger(size) || size <= 0) return uploadError(res, 400, 'Arquivo vazio.');
  if (size > MAX_FILE) return uploadError(res, 400, 'Arquivo grande demais (limite de 200 GB).');
  const allowed = ACCEPT[kind];
  if (allowed && !allowed.includes(extOf(filename))) return uploadError(res, 400, `Formato não aceito para "${C.EPISODE_FILE_KINDS[kind]}" (${allowed.slice(0, 6).join(', ')}…).`);
  // "Substituir" um arquivo do mesmo episódio: envio que tinha parado sai já; arquivo completo só quando o novo terminar.
  let replacesId = null;
  if (req.body.substituir != null && req.body.substituir !== '') {
    const { rows: [old] } = isIntId(String(req.body.substituir))
      ? await db.query("SELECT * FROM episode_files WHERE id = $1 AND episode_id = $2 AND kind <> 'editado'", [req.body.substituir, ep.id]) : { rows: [] };
    if (old && fileAccess(req.user, old.kind)) {
      if (old.status === 'enviando') await prod.cancelUpload(old); else replacesId = old.id;
    }
  }
  return storageGuard(res, async () => {
    const { file, partSize, totalParts } = await prod.startUpload({
      episode: ep, kind, label: clean(req.body.rotulo, 80), filename, contentType: req.body.tipo, size, userId: req.user.id, replacesId,
    });
    res.json({ ok: true, id: file.id, partSize, totalParts });
  });
}));

// Descartar os envios que pararam no meio (libera o espaço que as partes ocupam no Backblaze).
router.post('/episodios/:id/arquivos/descartar-parados', requirePerm('production.upload'), wrap(async (req, res) => {
  const ep = await findEpisode(req.params.id);
  if (!ep) return notFound(res);
  const { rows } = await db.query("SELECT * FROM episode_files WHERE episode_id = $1 AND kind <> 'editado' AND status = 'enviando'", [ep.id]);
  const stalled = rows.filter((f) => prod.isStalled(f));
  for (const f of stalled) await prod.cancelUpload(f);
  if (stalled.length) await prod.addEvent(ep.id, req.user.id, 'arquivo', `${stalled.length} envio${stalled.length > 1 ? 's' : ''} que não terminaram foram descartados`);
  await req.flash('ok', stalled.length ? `${stalled.length} envio${stalled.length > 1 ? 's descartados' : ' descartado'}.` : 'Nenhum envio parado para descartar.');
  res.redirect(back(ep.id, '#material'));
}));

// O que já existe no material bruto (para a janela de envio reconhecer arquivos repetidos e envios que pararam no meio).
router.get('/episodios/:id/arquivos/existentes', uploadAccess, wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return uploadError(res, 404, 'Episódio não encontrado.');
  const { rows } = await db.query("SELECT id, kind, label, filename, size_bytes, status, part_size, created_at, last_part_at FROM episode_files WHERE episode_id = $1 AND kind <> 'editado' ORDER BY id", [req.params.id]);
  const { rows: parts } = await db.query('SELECT p.file_id, count(*)::int AS n FROM episode_file_parts p JOIN episode_files f ON f.id = p.file_id WHERE f.episode_id = $1 GROUP BY p.file_id', [req.params.id]);
  const got = Object.fromEntries(parts.map((p) => [p.file_id, p.n]));
  res.json({
    ok: true,
    files: rows.map((f) => ({
      id: f.id, kind: f.kind, label: f.label, name: f.filename, size: Number(f.size_bytes), status: f.status, stalled: prod.isStalled(f),
      parts: got[f.id] || 0, totalParts: f.status === 'enviando' ? Math.max(1, Math.ceil(Number(f.size_bytes) / f.part_size)) : null,
    })),
  });
}));

router.put('/episodios/:id/arquivos/:fid/parte/:n', uploadAccess, express.raw({ type: () => true, limit: MAX_PART }), wrap(async (req, res) => {
  const file = await loadOwnFile(req);
  if (!file || file.status !== 'enviando') return uploadError(res, 404, 'Envio não encontrado ou já concluído.');
  const n = Number.parseInt(req.params.n, 10);
  const total = Math.max(1, Math.ceil(Number(file.size_bytes) / file.part_size));
  if (!Number.isInteger(n) || n < 1 || n > total) return uploadError(res, 400, 'Parte inválida.');
  const expected = n < total ? file.part_size : Number(file.size_bytes) - file.part_size * (total - 1);
  if (!Buffer.isBuffer(req.body) || req.body.length !== expected) return uploadError(res, 400, `A parte ${n} deveria ter ${expected} bytes e chegou com ${Buffer.isBuffer(req.body) ? req.body.length : 0}.`);
  return storageGuard(res, async () => { await prod.receivePart(file, n, req.body); res.json({ ok: true }); });
}));

router.get('/episodios/:id/arquivos/:fid/partes', uploadAccess, wrap(async (req, res) => {
  const file = await loadOwnFile(req);
  if (!file) return uploadError(res, 404, 'Arquivo não encontrado.');
  const { rows } = await db.query('SELECT part_number FROM episode_file_parts WHERE file_id = $1 ORDER BY part_number', [file.id]);
  res.json({ ok: true, status: file.status, parts: rows.map((r) => r.part_number), size: Number(file.size_bytes), partSize: file.part_size, totalParts: Math.max(1, Math.ceil(Number(file.size_bytes) / file.part_size)) });
}));

router.post('/episodios/:id/arquivos/:fid/concluir', uploadAccess, wrap(async (req, res) => {
  const file = await loadOwnFile(req);
  if (!file) return uploadError(res, 404, 'Arquivo não encontrado.');
  if (file.status === 'pronto') return res.json({ ok: true });
  let result;
  const sent = await storageGuard(res, async () => { result = await prod.finishUpload(file); });
  if (!result) return sent;
  if (result.error) return uploadError(res, 409, result.error);
  const f = result.file;
  if (result.replaced) await prod.addEvent(f.episode_id, req.user.id, 'arquivo', `Arquivo substituído: ${result.replaced.filename}`);
  if (f.kind === 'editado') { // o vídeo pilar do episódio só pode ser horizontal
    const check = await prod.checkEditedVideo(f);
    if (check.error) { await prod.deleteFile(f); return uploadError(res, 422, check.error); }
  }
  await prod.addFileEvent(f, req.user.id);
  await db.query('UPDATE episodes SET updated_at = now() WHERE id = $1', [f.episode_id]);
  res.json({ ok: true, id: f.id });
}));

router.post('/episodios/:id/arquivos/:fid/cancelar', uploadAccess, wrap(async (req, res) => {
  const file = await loadOwnFile(req);
  if (!file) return uploadError(res, 404, 'Arquivo não encontrado.');
  if (file.status !== 'enviando') return uploadError(res, 409, 'Esse arquivo já foi enviado; use "remover".');
  await prod.cancelUpload(file);
  res.json({ ok: true });
}));

// Leitura: redireciona para um link assinado temporário do bucket privado (o navegador baixa/reproduz direto de lá).
const redirectToFile = (inline) => wrap(async (req, res) => {
  const file = await loadFile(req);
  if (!file || file.status !== 'pronto') return notFound(res);
  const isVideo = ['editado', 'bruto_video'].includes(file.kind);
  const url = await b2.presignGet(file.storage_key, {
    expires: inline ? 6 * 3600 : 900,
    download: inline ? null : file.filename,
    contentType: inline && isVideo && !file.content_type.startsWith('video/') ? 'video/mp4' : null,
  });
  res.set('Cache-Control', 'no-store').redirect(302, url);
});
router.get('/episodios/:id/arquivos/:fid/baixar', requirePerm('episodes.read'), redirectToFile(false));
// Galeria: miniatura (t) ou visualização grande (p) de foto ou vídeo, servida do disco do servidor. Cada arquivo tem id único
// e a miniatura nunca muda: o navegador guarda para sempre (immutable), sem pedir de novo.
router.get('/episodios/:id/arquivos/:fid/previa', requirePerm('episodes.read'), wrap(async (req, res) => {
  const file = await loadFile(req);
  if (!file) return res.status(404).end();
  const size = req.query.t === 'p' ? 'p' : 't';
  const disk = await require('../services/previews').get(file, size);
  if (!disk) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=31536000, immutable').type('image/jpeg').sendFile(disk);
}));

// Miniatura feita pelo navegador logo depois do envio (sai do arquivo que a pessoa já tem: nada é baixado do Backblaze).
router.post('/episodios/:id/arquivos/:fid/previa', uploadAccess, express.raw({ type: () => true, limit: '3mb' }), wrap(async (req, res) => {
  const file = await loadOwnFile(req);
  if (!file || file.status !== 'pronto') return uploadError(res, 404, 'Arquivo não encontrado.');
  const r = await require('../services/previews').receive(file, req.query.t === 'p' ? 'p' : 't', req.body);
  if (r.error) return uploadError(res, r.status || 400, r.error);
  res.json({ ok: true });
}));
router.get('/episodios/:id/arquivos/:fid/ver', requirePerm('episodes.read'), redirectToFile(true));

router.post('/episodios/:id/arquivos/:fid/excluir', uploadAccess, wrap(async (req, res) => {
  const file = await loadFile(req);
  if (!file) return notFound(res);
  if (!fileAccess(req.user, file.kind)) return res.status(403).render('error', { title: 'Sem permissão', message: file.kind === 'editado' ? 'Só quem edita remove o vídeo editado.' : 'O material bruto é removido pela produção.' });
  await prod.deleteFile(file);
  await prod.addEvent(file.episode_id, req.user.id, 'arquivo', `Arquivo removido: ${file.filename}`);
  res.redirect(back(file.episode_id, '#material'));
}));

// ---- IA de finalização: status, nova análise, metadados e quadros ----
router.get('/episodios/:id/ia/status', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return res.status(404).json({ ok: false });
  const job = await jobs.latest(req.params.id, 'finalizacao');
  res.json({ ok: true, job: job ? { status: job.status, message: job.message, progress: job.progress, error: job.error } : null });
}));

router.post('/episodios/:id/ia/gerar', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!can(req.user.role, 'production.manage') && !can(req.user.role, 'production.review')) return res.status(403).render('error', { title: 'Sem permissão', message: 'Seu perfil não pede análise por IA.' });
  const ep = await findEpisode(req.params.id);
  if (!ep) return notFound(res);
  if (!(config.groqConfigured && config.geminiConfigured && config.storageConfigured)) {
    await req.flash('error', 'A IA não está configurada neste servidor (GROQ_APIKEY, GEMINI_KEY e Backblaze).');
    return res.redirect(back(ep.id, '#finalizacao'));
  }
  const { rowCount } = await db.query("SELECT 1 FROM episode_files WHERE episode_id = $1 AND kind = 'editado' AND status = 'pronto'", [ep.id]);
  if (!rowCount) { await req.flash('error', 'Envie o vídeo editado antes de pedir a análise.'); return res.redirect(back(ep.id, '#finalizacao')); }
  await jobs.enqueue('finalizacao', { episodeId: ep.id });
  await prod.addEvent(ep.id, req.user.id, 'ia', 'Nova análise por IA pedida');
  res.redirect(back(ep.id, '#finalizacao'));
}));

router.post('/episodios/:id/metadados', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!can(req.user.role, 'production.review') && !can(req.user.role, 'production.manage')) return res.status(403).render('error', { title: 'Sem permissão', message: 'Seu perfil não edita os textos de publicação.' });
  const ep = await findEpisode(req.params.id);
  if (!ep) return notFound(res);
  const b = req.body;
  const v = {
    yt_title: L.tidy(clean(b.yt_title, 400)).replace(/\n/g, ' '),
    yt_description: String(b.yt_description || '').replace(/\r\n/g, '\n').trim().slice(0, 20000),
    yt_tags: clean(b.yt_tags, 1500),
    sp_title: L.tidy(clean(b.sp_title, 400)).replace(/\n/g, ' '),
    sp_description: String(b.sp_description || '').replace(/\r\n/g, '\n').trim().slice(0, 20000),
    thumb_text: L.tidy(clean(b.thumb_text, 200)).replace(/\n/g, ' '),
    chapters: String(b.chapters || '').replace(/\r\n/g, '\n').trim().slice(0, 4000),
    thumb_frame_id: isIntId(String(b.thumb_frame_id || '')) ? Number(b.thumb_frame_id) : null,
  };
  const problems = [];
  if (v.yt_title) problems.push(...L.checkYoutubeTitle(v.yt_title).issues);
  if (v.yt_description) problems.push(...L.checkYoutubeDescription(v.yt_description).issues);
  if (v.yt_tags && v.yt_tags.length > L.LIMITS.youtube.tagsChars) problems.push(`As tags passam de ${L.LIMITS.youtube.tagsChars} caracteres (${v.yt_tags.length}).`);
  if (v.sp_title) problems.push(...L.checkSpotifyTitle(v.sp_title).issues.map((s) => s.replace('O título', 'O título do Spotify')));
  if (v.sp_description) problems.push(...L.checkSpotifyDescription(v.sp_description).issues.map((s) => s.replace('A descrição', 'A descrição do Spotify')));
  if (v.thumb_text.length > 40) problems.push('O texto da thumbnail passa de 40 caracteres.');
  if (v.chapters) {
    const { rows: [tr] } = await db.query('SELECT duration_ms FROM episode_transcripts WHERE episode_id = $1', [ep.id]);
    problems.push(...L.parseChapters(v.chapters, { durationMs: tr?.duration_ms || null }).issues.map((s) => `Capítulos: ${s}`));
  }
  if (v.thumb_frame_id) {
    const { rowCount } = await db.query('SELECT 1 FROM episode_frames WHERE id = $1 AND episode_id = $2', [v.thumb_frame_id, ep.id]);
    if (!rowCount) v.thumb_frame_id = null;
  }
  if (problems.length) {
    await req.flash('error', `Nada foi salvo: ${problems.slice(0, 3).join(' ')}`);
    return res.redirect(back(ep.id, '#finalizacao'));
  }
  await db.query(
    `INSERT INTO episode_metadata (episode_id, yt_title, yt_description, yt_tags, sp_title, sp_description, thumb_text, thumb_frame_id, chapters)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (episode_id) DO UPDATE SET yt_title=$2, yt_description=$3, yt_tags=$4, sp_title=$5, sp_description=$6, thumb_text=$7, thumb_frame_id=$8, chapters=$9, updated_at=now()`,
    [ep.id, v.yt_title || null, v.yt_description || null, v.yt_tags || null, v.sp_title || null, v.sp_description || null, v.thumb_text || null, v.thumb_frame_id, v.chapters || null]);
  await prod.addEvent(ep.id, req.user.id, 'metadados', 'Textos de publicação atualizados');
  await req.flash('ok', 'Textos de publicação salvos.');
  res.redirect(back(ep.id, '#finalizacao'));
}));

router.get(['/episodios/:id/quadros/:fid', '/quadros/:fid'], requirePerm('episodes.read'), wrap(async (req, res) => {
  if ((req.params.id !== undefined && !isIntId(req.params.id)) || !isIntId(req.params.fid)) return notFound(res);
  const { rows: [f] } = req.params.id === undefined
    ? await db.query('SELECT storage_key FROM episode_frames WHERE id = $1', [req.params.fid])
    : await db.query('SELECT storage_key FROM episode_frames WHERE id = $1 AND episode_id = $2', [req.params.fid, req.params.id]);
  if (!f) return notFound(res);
  res.set('Cache-Control', 'private, max-age=300').redirect(302, await b2.presignGet(f.storage_key, { expires: 3600 }));
}));

// ---- checklists do episódio ----
// Quantos comentários há na revisão e quantos seguem abertos (a tela atualiza o contador da aba sem recarregar).
const withReviewFiles = async (rows) => { const f = await attachmentsSvc.forReviews(rows.map((c) => c.id)); return rows.map((c) => ({ ...c, attachments: f[c.id] || [] })); };
const commentCounts = async (epId) => (await db.query('SELECT count(*)::int AS total, count(*) FILTER (WHERE NOT resolved)::int AS open FROM episode_comments WHERE episode_id = $1', [epId])).rows[0];
const canTick = (role) => can(role, 'production.edit') || can(role, 'production.review') || can(role, 'production.manage');

router.post('/episodios/:id/checklist/:iid/marcar', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canTick(req.user.role)) return res.status(403).json({ ok: false });
  if (!isIntId(req.params.id) || !isIntId(req.params.iid)) return res.status(404).json({ ok: false });
  const done = req.body.done === '1' || req.body.done === true || req.body.done === 'true';
  const { rowCount } = await db.query(
    'UPDATE episode_checklist_items SET done = $3, done_by = $4, done_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE id = $1 AND episode_id = $2',
    [req.params.iid, req.params.id, done, done ? req.user.id : null]);
  if (!rowCount) return res.status(404).json({ ok: false });
  if (wantsJson(req)) return res.json({ ok: true });
  res.redirect(back(req.params.id, '#checklists'));
}));

router.post('/episodios/:id/checklist', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canTick(req.user.role)) return res.status(403).render('error', { title: 'Sem permissão', message: 'Seu perfil não edita checklists.' });
  const ep = await findEpisode(req.params.id);
  if (!ep) return notFound(res);
  const text = clean(req.body.text, 300);
  const gate = Object.prototype.hasOwnProperty.call(C.CHECKLIST_GATES, req.body.gate) ? req.body.gate : 'revisao';
  if (text) {
    const { rows: [pos] } = await db.query('SELECT coalesce(max(position), 0) + 1 AS p FROM episode_checklist_items WHERE episode_id = $1', [ep.id]);
    await db.query(
      'INSERT INTO episode_checklist_items (episode_id, template_id, group_name, gate, required, position, text) VALUES ($1,NULL,$2,$3,$4,$5,$6)',
      [ep.id, 'Itens deste episódio', gate, req.body.required === '1', pos.p, text]);
  }
  res.redirect(back(ep.id, '#checklists'));
}));

router.post('/episodios/:id/checklist/:iid/excluir', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canTick(req.user.role)) return res.status(403).render('error', { title: 'Sem permissão', message: 'Seu perfil não edita checklists.' });
  if (!isIntId(req.params.id) || !isIntId(req.params.iid)) return notFound(res);
  await db.query('DELETE FROM episode_checklist_items WHERE id = $1 AND episode_id = $2 AND template_id IS NULL', [req.params.iid, req.params.id]); // só itens avulsos
  res.redirect(back(req.params.id, '#checklists'));
}));

// ---- tarefas do episódio (as mesmas da área Tarefas; aqui já ficam ligadas ao episódio) ----
router.post('/episodios/:id/tarefas', requirePerm('production.manage'), wrap(async (req, res) => {
  const ep = await findEpisode(req.params.id);
  if (!ep) return notFound(res);
  const { values, error } = tasksSvc.parse({ ...req.body, status: req.body.status || 'a_fazer' });
  if (error) { await req.flash('error', error); return res.redirect(back(ep.id, '#tarefas')); }
  const task = await tasksSvc.create({ values, user: req.user, assigneeId: isUuid(req.body.assignee_id) ? req.body.assignee_id : null, links: { episodeId: ep.id } });
  await prod.addEvent(ep.id, req.user.id, 'tarefa', `Tarefa criada: ${task.title}`);
  res.redirect(back(ep.id, '#tarefas'));
}));

// Quem produz (editor, produtora, gestão) pode mudar o andamento; só quem gerencia reatribui e muda o prazo.
router.post('/episodios/:id/tarefas/:tid', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canTick(req.user.role)) return res.status(403).render('error', { title: 'Sem permissão', message: 'Seu perfil não altera tarefas.' });
  if (!isIntId(req.params.id) || !isIntId(req.params.tid)) return notFound(res);
  const { rows: [cur] } = await db.query('SELECT * FROM tasks WHERE id = $1 AND episode_id = $2', [req.params.tid, req.params.id]);
  if (!cur) return notFound(res);
  const manage = can(req.user.role, 'production.manage');
  const body = { ...req.body };
  if (!manage) { delete body.due_on; delete body.due_time; }
  const { values, error } = tasksSvc.parse({ title: cur.title, kind: cur.kind, ...body }, { partial: true });
  if (error) { await req.flash('error', error); return res.redirect(back(cur.episode_id, '#tarefas')); }
  const result = await tasksSvc.update(cur, values, req.user, { assigneeId: manage && body.assignee_id !== undefined ? (isUuid(body.assignee_id) ? body.assignee_id : null) : undefined });
  if (result.error) { await req.flash('error', result.error); return res.redirect(back(cur.episode_id, '#tarefas')); }
  if (result.task.status !== cur.status) await prod.addEvent(cur.episode_id, req.user.id, 'tarefa', `${cur.title}: ${C.TASK_STATUSES[result.task.status]}`);
  res.redirect(back(cur.episode_id, '#tarefas'));
}));

router.post('/episodios/:id/tarefas/:tid/excluir', requirePerm('production.manage'), wrap(async (req, res) => {
  if (!isIntId(req.params.id) || !isIntId(req.params.tid)) return notFound(res);
  await db.query('DELETE FROM tasks WHERE id = $1 AND episode_id = $2', [req.params.tid, req.params.id]);
  res.redirect(back(req.params.id, '#tarefas'));
}));

// ---- revisão: comentários na minutagem ----
// Renderiza um pedaço de página (o comentário recém-criado) com as variáveis do layout, para o navegador só inserir.
const renderPartial = (res, view, data) => new Promise((resolve, reject) => res.render(view, data, (err, html) => (err ? reject(err) : resolve(html))));
router.post('/episodios/:id/comentarios', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canTick(req.user.role)) return res.status(403).json({ ok: false, error: 'Seu perfil não comenta.' });
  const ep = await findEpisode(req.params.id);
  if (!ep) return res.status(404).json({ ok: false });
  const rich = req.body.body_html != null && String(req.body.body_html).trim() ? richText.sanitize(req.body.body_html) : null;
  const ids = [...(rich ? rich.attachmentIds : []), ...[].concat(req.body.anexos || [])];
  const body = rich ? rich.text.slice(0, 4000) : clean(req.body.body, 2000);
  if (!body && !ids.length && !(rich && rich.html)) return res.status(400).json({ ok: false, error: 'Escreva o comentário.' });
  const at = req.body.at_ms === '' || req.body.at_ms == null ? null : Number.parseInt(req.body.at_ms, 10);
  if (at != null && (!Number.isInteger(at) || at < 0 || at > 24 * 3600 * 1000)) return res.status(400).json({ ok: false, error: 'Minutagem inválida.' });
  let fileId = null;
  if (isIntId(String(req.body.file_id || ''))) {
    const { rowCount } = await db.query("SELECT 1 FROM episode_files WHERE id = $1 AND episode_id = $2 AND kind = 'editado'", [req.body.file_id, ep.id]);
    if (rowCount) fileId = Number(req.body.file_id);
  }
  const { rows: [c] } = await db.query('INSERT INTO episode_comments (episode_id, file_id, at_ms, body, body_html, author_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [ep.id, fileId, at, body, rich ? rich.html || null : null, req.user.id]);
  const linked = ids.length ? await attachmentsSvc.link(ids, 'review', c.id, req.user) : 0;
  const files = linked ? (await attachmentsSvc.forReviews([c.id]))[c.id] || [] : [];
  const said = body || (files.find((f) => f.kind === 'audio')?.transcript ? `Áudio: ${files.find((f) => f.kind === 'audio').transcript}` : 'Anexo enviado.');
  await prod.addEvent(ep.id, req.user.id, 'comentario', `Comentário${at != null ? ` em ${require('../utils/format').formatClock(at)}` : ''}: ${said.slice(0, 140)}`);
  if (wantsJson(req)) {
    const html = await renderPartial(res, 'episodes/_review_comment', { c: { ...c, author_name: req.user.name, attachments: files }, ep, tickable: true });
    return res.json({ ok: true, id: c.id, html, comment: { id: c.id, at_ms: at, clock: at != null ? fmt.formatClock(at) : null, body, author: req.user.name, when: fmt.formatDateTime(new Date()), resolved: false }, counts: await commentCounts(ep.id) });
  }
  res.redirect(back(ep.id, '#revisao'));
}));

router.post('/episodios/:id/comentarios/:cid/editar', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!isIntId(req.params.id) || !isIntId(req.params.cid)) return res.status(404).json({ ok: false });
  if (!canTick(req.user.role)) return res.status(403).json({ ok: false, error: 'Seu perfil não comenta.' });
  const ep = await findEpisode(req.params.id);
  const { rows: [c] } = await db.query('SELECT * FROM episode_comments WHERE id = $1 AND episode_id = $2', [req.params.cid, req.params.id]);
  if (!ep || !c) return res.status(404).json({ ok: false, error: 'Comentário não encontrado.' });
  if (String(c.author_id) !== String(req.user.id)) return res.status(403).json({ ok: false, error: 'Só quem escreveu pode editar.' });
  const edit = await require('../services/comments').prepareEdit({ attType: 'review', commentId: c.id, user: req.user, body: req.body.body, html: req.body.body_html, attachmentIds: [].concat(req.body.anexos || []), removeIds: [].concat(req.body.remover || []), maxLength: 4000 });
  if (edit.error) return res.status(422).json({ ok: false, error: edit.error });
  const { rows: [saved] } = await db.query('UPDATE episode_comments SET body = $2, body_html = $3, edited_at = now() WHERE id = $1 RETURNING *', [c.id, edit.text, edit.html]);
  const files = (await attachmentsSvc.forReviews([c.id]))[c.id] || [];
  const html = await renderPartial(res, 'episodes/_review_comment', { c: { ...saved, author_name: req.user.name, attachments: files }, ep, tickable: true });
  res.json({ ok: true, id: c.id, html, counts: await commentCounts(ep.id) });
}));

router.post('/episodios/:id/comentarios/:cid/resolver', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canTick(req.user.role)) return res.status(403).json({ ok: false });
  if (!isIntId(req.params.id) || !isIntId(req.params.cid)) return res.status(404).json({ ok: false });
  const resolved = req.body.resolved === '1' || req.body.resolved === true || req.body.resolved === 'true';
  const { rowCount } = await db.query(
    'UPDATE episode_comments SET resolved = $3, resolved_by = $4, resolved_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE id = $1 AND episode_id = $2',
    [req.params.cid, req.params.id, resolved, resolved ? req.user.id : null]);
  if (!rowCount) return res.status(404).json({ ok: false });
  if (wantsJson(req)) return res.json({ ok: true, resolved, counts: await commentCounts(req.params.id) });
  res.redirect(back(req.params.id, '#revisao'));
}));

router.post('/episodios/:id/comentarios/:cid/excluir', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!isIntId(req.params.id) || !isIntId(req.params.cid)) return notFound(res);
  const { rows: [c] } = await db.query('SELECT * FROM episode_comments WHERE id = $1 AND episode_id = $2', [req.params.cid, req.params.id]);
  if (!c) return notFound(res);
  if (c.author_id !== req.user.id && !can(req.user.role, 'production.review')) {
    if (wantsJson(req)) return res.status(403).json({ ok: false, error: 'Só quem escreveu (ou a gestão) apaga o comentário.' });
    return res.status(403).render('error', { title: 'Sem permissão', message: 'Só quem escreveu (ou a gestão) apaga o comentário.' });
  }
  await db.query('DELETE FROM episode_comments WHERE id = $1', [c.id]);
  if (wantsJson(req)) return res.json({ ok: true, counts: await commentCounts(req.params.id) });
  res.redirect(back(req.params.id, '#revisao'));
}));

module.exports = router;
