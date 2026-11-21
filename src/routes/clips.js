// Conteúdo derivado do episódio, fora do card do episódio: cortes (o editor sobe vários vídeos, o sistema lê e o editor atribui a um
// episódio já gravado), posts e carrosséis; e a publicação nas redes (Upload-Post ou Zernio, ver socialApi). Cortar/atribuir: gestão e editor. Publicar: só gestão.
const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const b2 = require('../services/b2');
const jobs = require('../services/jobs');
const clips = require('../services/clips');
const publishing = require('../services/publishing');
const up = require('../services/uploadPost');
const socialApi = require('../services/socialApi');
const L = require('../services/platformLimits');
const fmt = require('../utils/format');
const C = require('../constants');
const { audit } = require('../services/audit');
const recordChanges = require('../services/recordChanges');
const { requirePerm } = require('../middleware');
const { can } = require('../permissions');
const { wrap, isIntId } = require('../utils/wrap');

const router = express.Router();
const MAX_PART = 70 * 1024 * 1024;
const POST_KINDS = ['post_quote', 'post_split', 'carousel'];
const canCut = (role) => can(role, 'production.review') || can(role, 'production.edit');
const canPublish = (role) => can(role, 'production.review');
const canCover = (role) => can(role, 'covers.edit'); // escolher e editar a capa (a produtora também)
const wantsJson = (req) => /json/.test(req.get('accept') || '');
const notFound = (res) => res.status(404).render('error', { title: 'Não encontrado', message: 'Não encontrado.' });
const deny = (req, res, msg = 'Sua função não faz isso.') => (wantsJson(req) ? res.status(403).json({ ok: false, error: msg }) : res.status(403).render('error', { title: 'Sem permissão', message: msg }));
const uploadError = (res, status, error) => res.status(status).json({ ok: false, error });
const extOf = (name) => String(name).match(/\.([A-Za-z0-9]{1,6})$/)?.[1]?.toLowerCase() || '';
const clockMs = (s) => L.parseClock(String(s || '').trim());

async function findClip(req) {
  if (!isIntId(req.params.id)) return null;
  const { rows: [c] } = await db.query('SELECT * FROM episode_clips WHERE id = $1', [req.params.id]);
  return c || null;
}

// Episódios que já foram gravados: os únicos que aceitam cortes.
// projectIds: só os episódios do recorte (scope.idsOf); sem ele, todos
const eligibleEpisodes = (projectIds = null) => db.query(
  `SELECT e.id, e.number, e.title, e.status, e.project_id, g.name AS guest_name FROM episodes e LEFT JOIN guests g ON g.id = e.guest_id
    WHERE e.status = ANY($1) AND ($2::int[] IS NULL OR e.project_id = ANY($2)) ORDER BY e.number DESC NULLS LAST, e.id DESC`, [clips.ELIGIBLE_STATUSES, projectIds]);

// ---------------------------------------------------------------- tela de conteúdo
router.get('/conteudo', requirePerm('episodes.read'), wrap(async (req, res) => {
  const only = isIntId(req.query.episodio) ? Number(req.query.episodio) : null;
  // cada aba é uma página: só monta o que a aba aberta mostra (o quadro, os cortes, os posts ou os pedidos)
  const vista = ['quadro', 'cortes', 'posts', 'pedidos'].includes(req.query.vista) ? req.query.vista : 'quadro';
  const board = require('../services/contentBoard');
  const R = require('../services/contentRequests');
  // recorte: os projetos da pessoa, ou o escolhido no menu. Imagem herda o projeto do episódio ou do pedido dela.
  const pids = require('../services/scope').idsOf(req);
  const coverProject = `coalesce(e.project_id, r.project_id, ${Number(require('../services/projects').defaultId())})`;
  const clipFilter = `(c.request_id IS NULL OR r.status = 'aprovado' OR r.kind = 'cortes') AND c.project_id = ANY($1::int[]) ${only ? 'AND c.episode_id = $2' : ''}`;
  const [clipRows, episodes, postCountRow, idx, reqs, people, episodeList] = await Promise.all([
    db.query(
      `SELECT c.*, e.number AS ep_number, e.title AS ep_title, g.name AS guest_name, r.title AS request_title FROM episode_clips c
         LEFT JOIN episodes e ON e.id = c.episode_id LEFT JOIN guests g ON g.id = e.guest_id LEFT JOIN content_requests r ON r.id = c.request_id
        WHERE ${clipFilter} ORDER BY (c.episode_id IS NULL) DESC, c.created_at DESC, c.id DESC`, only ? [pids, only] : [pids]),
    eligibleEpisodes(pids),
    db.query(`SELECT count(*)::int AS n FROM episode_covers c LEFT JOIN episodes e ON e.id = c.episode_id LEFT JOIN content_requests r ON r.id = c.request_id
               WHERE c.clip_id IS NULL AND c.kind = ANY($1) AND ${coverProject} = ANY($2::int[]) ${only ? 'AND c.episode_id = $3' : ''}`, only ? [POST_KINDS, pids, only] : [POST_KINDS, pids]),
    board.publicationIndex(),
    R.list({ episodeId: only, projectIds: pids }), db.query("SELECT id, name, role FROM users WHERE active AND role IN ('editor_video','gestao','superadmin') ORDER BY (role = 'editor_video') DESC, name"),
    db.query('SELECT id, number, title, project_id FROM episodes WHERE project_id = ANY($1::int[]) ORDER BY number DESC NULLS LAST, id DESC LIMIT 80', [pids]),
  ]);
  const byEpisode = {};
  for (const e of episodes.rows) byEpisode[e.id] = e;

  // filtros combináveis (botão Filtros) de cada aba: campos próprios, mesma tela
  const fieldsDef = require('../services/filterFields'); const filterUiSvc = require('../services/filterUi');
  let filterUi = null;

  // Quadro
  let columns = []; let hiddenOld = 0;
  const tipo = ['video', 'imagem', 'pedido'].includes(req.query.tipo) ? req.query.tipo : '';
  if (vista === 'quadro') {
    const built = await board.build({ episodeId: only, projectIds: pids, recentDays: req.query.publicados === 'todos' || only ? null : 60 }); // de um episódio: tudo o que já saiu
    hiddenOld = built.hiddenOld;
    const f = await filterUiSvc.build(req, { entity: 'board', action: '/conteudo', fields: await fieldsDef.boardFields(pids),
      keep: { vista: 'quadro', tipo, episodio: only || '', publicados: req.query.publicados === 'todos' ? 'todos' : '' } });
    filterUi = f.ui;
    const keep = (c) => (!tipo || (tipo === 'pedido' ? c.type === 'pedido' : tipo === 'video' ? c.media === 'video' && c.type !== 'pedido' : c.type !== 'pedido' && c.media !== 'video')) && f.passes(c);
    const views = await require('../services/postMetrics').forClips(built.cards.filter((k) => k.type === 'corte').map((k) => Number(String(k.key).slice(1))));
    // coluna com muitos cartões (ex.: 150 prontos para postar): mostra os 30 primeiros e leva à lista com filtro e seleção
    columns = built.columns.map((col) => {
      const cards = col.cards.filter(keep).map((k) => (k.type === 'corte' ? { ...k, views: views[Number(String(k.key).slice(1))]?.views || 0 } : k));
      const cap = col.key === 'pronto' ? 30 : cards.length;
      return { ...col, total: cards.length, cards: cards.slice(0, cap) };
    });
  }

  // Cortes: situação (só os prontos para postar), ordem e páginas de 60
  const situacao = req.query.situacao === 'pronto' ? 'pronto' : '';
  const ordem = ['antigos', 'episodio', 'duracao'].includes(req.query.ordem) ? req.query.ordem : 'recentes';
  const allClips = clipRows.rows.map((c) => ({ ...c, pub: board.stateOf(idx.byClip.get(c.id)) }));
  const readyCount = allClips.filter((c) => c.status === 'pronto' && (c.episode_id || c.request_id) && !c.pub).length;
  let list = []; let clipPager = null; let clipTotals = null; let running = false;
  if (vista === 'cortes') {
    // categoria, situação no Social, formato, datas, conexões…
    const f = await filterUiSvc.build(req, { entity: 'clip', action: '/conteudo', fields: await fieldsDef.clipFields(pids),
      keep: { vista: 'cortes', situacao, ordem: ordem === 'recentes' ? '' : ordem, episodio: only || '' } });
    filterUi = f.ui; const { passes } = f;
    const natural = (a, b) => String(a.title).localeCompare(String(b.title), 'pt-BR', { numeric: true });
    const sorters = {
      recentes: (a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id,
      antigos: (a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id,
      episodio: (a, b) => (a.ep_number ?? 9999) - (b.ep_number ?? 9999) || natural(a, b),
      duracao: (a, b) => (a.duration_ms || 0) - (b.duration_ms || 0) || natural(a, b),
    };
    const filtered = allClips.filter((c) => (!situacao || (c.status === 'pronto' && !c.pub && (c.episode_id || c.request_id))) && passes(c)).sort(sorters[ordem]);
    const { pageOf, paginate } = require('../utils/pager');
    const pg = pageOf(req, req.query.todos === '1' ? 1000 : 60);
    const out = paginate(req, filtered.slice(pg.offset, pg.offset + pg.limit), pg);
    clipPager = out.pager;
    clipTotals = { assigned: filtered.filter((c) => c.episode_id).length, unassigned: filtered.filter((c) => !c.episode_id).length };
    const ids = out.rows.map((c) => c.id);
    const [{ rows: covers }, views] = await Promise.all([
      ids.length ? db.query('SELECT id, clip_id, updated_at FROM episode_covers WHERE clip_id = ANY($1) ORDER BY position', [ids]) : { rows: [] },
      require('../services/postMetrics').forClips(ids),
    ]);
    list = out.rows.map((c) => ({ ...c, covers: covers.filter((x) => x.clip_id === c.id), views: views[c.id] || null }));
    running = list.some((c) => ['enviando', 'processando'].includes(c.status));
  }

  // Posts e carrosséis
  const postGroups = [];
  if (vista === 'posts') {
    const [posts, withFrames] = await Promise.all([
      db.query(
        `SELECT c.id, c.episode_id, c.kind, c.group_key, c.position, c.label, c.lint, c.approved, c.auto, c.width, c.height, c.size_bytes, c.updated_at, c.created_at
           FROM episode_covers c LEFT JOIN episodes e ON e.id = c.episode_id LEFT JOIN content_requests r ON r.id = c.request_id
          WHERE c.clip_id IS NULL AND c.kind = ANY($1) AND ${coverProject} = ANY($2::int[]) ${only ? 'AND c.episode_id = $3' : ''}
          ORDER BY c.episode_id DESC, c.kind, c.group_key, c.position, c.id`, only ? [POST_KINDS, pids, only] : [POST_KINDS, pids]),
      db.query('SELECT DISTINCT episode_id FROM episode_frames WHERE clip_id IS NULL AND episode_id IS NOT NULL'),
    ]);
    const f = await filterUiSvc.build(req, { entity: 'post', action: '/conteudo', fields: await fieldsDef.postFields(pids), keep: { vista: 'posts', episodio: only || '' } });
    filterUi = f.ui;
    const shownPosts = posts.rows.map((p) => ({ ...p, pub: board.stateOf(idx.byCover.get(p.id)) })).filter(f.passes);
    const hasFrames = new Set(withFrames.rows.map((r) => r.episode_id));
    for (const e of episodes.rows) {
      const mine = shownPosts.filter((p) => p.episode_id === e.id);
      if ((only && e.id !== only) || (!mine.length && (f.ui.count || !hasFrames.has(e.id)))) continue; // filtrando: só episódios com posts que passam
      postGroups.push({ episode: e, covers: mine, canGenerate: hasFrames.has(e.id) });
    }
  }

  // Pedidos
  let shownRequests = reqs;
  if (vista === 'pedidos') {
    const f = await filterUiSvc.build(req, { entity: 'request', action: '/conteudo', fields: await fieldsDef.requestFields(pids), keep: { vista: 'pedidos', episodio: only || '' } });
    filterUi = f.ui;
    shownRequests = reqs.filter(f.passes);
  }

  const moments = only && vista === 'cortes' ? await clips.momentsFor(only) : [];
  const pedir = Object.prototype.hasOwnProperty.call(R.KINDS, req.query.pedir) ? req.query.pedir : (req.query.pedir === '1' ? 'trailer' : null);
  await require('../services/catalog').refresh();
  res.render('content/index', {
    filterUi, videoTypes: require('../services/catalog').videoOptions(), cardUi: vista === 'quadro' || vista === 'cortes' ? require('../services/cardFields').forList(vista === 'quadro' ? 'conteudo' : 'cortes') : null,
    uploadPost: up, autoDefaults: vista === 'cortes' ? await require('../services/commentAutomation').formDefaults({}) : null, situacao, ordem, readyCount, clipPager, clipTotals,
    tabCounts: { cortes: allClips.length, posts: postCountRow.rows[0].n },
    columns, hiddenOld, tipo, vista,
    requests: shownRequests, openRequests: shownRequests.filter((r) => R.OPEN.includes(r.status)), people: people.rows, episodeList: episodeList.rows, K: R.KINDS, S: R.STATUSES, F: R.FORMATS,
    pedir, today: new Date().toISOString().slice(0, 10), isLate: R.isLate, stageLabel: board.STAGE_LABEL,
    title: 'Conteúdo', clips: list, episodes: episodes.rows, postGroups, only, onlyEpisode: only ? byEpisode[only] || null : null,
    moments, running, storageReady: config.storageConfigured, aiReady: config.groqConfigured && config.geminiConfigured && config.storageConfigured,
    perm: { cut: canCut(req.user.role), publish: canPublish(req.user.role) || can(req.user, 'social.request'), direct: canPublish(req.user.role), request: R.canRequest(req.user.role), review: R.canReview(req.user.role), approve: can(req.user, 'production.review') || can(req.user, 'production.manage'), cover: canCover(req.user.role) }, C,
  });
}));

// ---------------------------------------------------------------- envio dos cortes (vários vídeos de uma vez)
router.post('/cortes/iniciar', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return uploadError(res, 403, 'Só o editor e a gestão enviam cortes.');
  if (!config.storageConfigured) return uploadError(res, 503, 'Armazenamento (Backblaze) não configurado.');
  const filename = String(req.body.nome || '');
  const size = Number(req.body.tamanho);
  if (!Number.isSafeInteger(size) || size <= 0) return uploadError(res, 400, 'Arquivo vazio.');
  if (size > clips.MAX_BYTES) return uploadError(res, 400, 'Arquivo grande demais para um corte.');
  if (!clips.VIDEO_EXT.includes(extOf(filename))) return uploadError(res, 400, `Envie vídeo (${clips.VIDEO_EXT.join(', ')}).`);
  // corte solto: nasce no projeto escolhido no menu (em "Todos os projetos", no padrão); ao ser atribuído a um episódio, vai para o dele
  const { clip, partSize, totalParts } = await clips.startUpload({ filename, size, contentType: req.body.tipo, userId: req.user.id, projectId: require('../services/scope').target(req, req.body) });
  res.json({ ok: true, id: clip.id, partSize, totalParts });
}));

async function uploadingClip(req) {
  const c = await findClip(req);
  return c && c.status === 'enviando' ? c : null;
}
router.put(['/cortes/:id/parte/:n', '/conteudo/pedidos/:pid/cortes/:id/parte/:n'], requirePerm('episodes.read'), express.raw({ type: () => true, limit: MAX_PART }), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return uploadError(res, 403, 'Sem permissão.');
  const clip = await uploadingClip(req);
  if (!clip) return uploadError(res, 404, 'Envio não encontrado ou já concluído.');
  const n = Number.parseInt(req.params.n, 10);
  const total = Math.max(1, Math.ceil(Number(clip.size_bytes) / clip.part_size));
  if (!Number.isInteger(n) || n < 1 || n > total) return uploadError(res, 400, 'Parte inválida.');
  const expected = n < total ? clip.part_size : Number(clip.size_bytes) - clip.part_size * (total - 1);
  if (!Buffer.isBuffer(req.body) || req.body.length !== expected) return uploadError(res, 400, `A parte ${n} deveria ter ${expected} bytes e chegou com ${Buffer.isBuffer(req.body) ? req.body.length : 0}.`);
  await clips.receivePart(clip, n, req.body);
  res.json({ ok: true });
}));
// Envio direto ao Backblaze (ver services/directUpload.js)
router.get(['/cortes/:id/urls', '/conteudo/pedidos/:pid/cortes/:id/urls'], requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return uploadError(res, 403, 'Sem permissão.');
  const clip = await uploadingClip(req);
  if (!clip) return uploadError(res, 404, 'Envio não encontrado ou já concluído.');
  res.set('Cache-Control', 'no-store').json(await require('../services/directUpload').urls({ key: clip.storage_key, uploadId: clip.upload_id, size: clip.size_bytes, partSize: clip.part_size, query: req.query.partes }));
}));
router.post(['/cortes/:id/parte/:n/ok', '/conteudo/pedidos/:pid/cortes/:id/parte/:n/ok'], requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return uploadError(res, 403, 'Sem permissão.');
  const clip = await uploadingClip(req);
  if (!clip) return uploadError(res, 404, 'Envio não encontrado ou já concluído.');
  const c = require('../services/directUpload').confirm({ size: clip.size_bytes, partSize: clip.part_size, number: req.params.n, body: req.body });
  if (c.error) return uploadError(res, c.status, c.error);
  await clips.registerPart(clip, Number(req.params.n), c.etag, c.size);
  res.json({ ok: true });
}));
router.post(['/cortes/:id/concluir', '/conteudo/pedidos/:pid/cortes/:id/concluir'], requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return uploadError(res, 403, 'Sem permissão.');
  const clip = await findClip(req);
  if (!clip) return uploadError(res, 404, 'Corte não encontrado.');
  if (clip.status !== 'enviando') return res.json({ ok: true, id: clip.id });
  const result = await clips.finishUpload(clip);
  if (result.error) return uploadError(res, 409, result.error);
  await audit(req, 'corte.enviado', 'clip', clip.id, { arquivo: clip.filename });
  res.json({ ok: true, id: clip.id });
}));
router.post(['/cortes/:id/cancelar', '/conteudo/pedidos/:pid/cortes/:id/cancelar'], requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return uploadError(res, 403, 'Sem permissão.');
  const clip = await uploadingClip(req);
  if (!clip) return uploadError(res, 404, 'Envio não encontrado.');
  await clips.cancelUpload(clip);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- trocar o vídeo (corte ainda não publicado)
// Mesmo caminho do envio de um corte novo (iniciar, partes, concluir), para a fila de envios do navegador funcionar igual.
async function replacingClip(req, res) {
  if (!canCut(req.user.role)) { uploadError(res, 403, 'Só o editor e a gestão trocam o vídeo do corte.'); return null; }
  const clip = await findClip(req);
  if (!clip) { uploadError(res, 404, 'Corte não encontrado.'); return null; }
  return clip;
}
async function pendingOf(req, res) {
  const clip = await replacingClip(req, res); if (!clip) return null;
  const rep = await clips.pendingReplacement(clip.id);
  if (!rep || !isIntId(req.params.rid) || String(rep.id) !== req.params.rid) { uploadError(res, 404, 'Envio não encontrado ou já concluído.'); return null; }
  return { clip, rep, upload: { id: clip.id, storage_key: rep.storage_key, upload_id: rep.upload_id } };
}
router.post('/cortes/:id/trocar/iniciar', requirePerm('episodes.read'), wrap(async (req, res) => {
  const clip = await replacingClip(req, res); if (!clip) return;
  if (!config.storageConfigured) return uploadError(res, 503, 'Armazenamento (Backblaze) não configurado.');
  const state = await clips.replaceState(clip);
  if (!state.allowed) return uploadError(res, 409, state.error);
  const filename = String(req.body.nome || '');
  const size = Number(req.body.tamanho);
  if (!Number.isSafeInteger(size) || size <= 0) return uploadError(res, 400, 'Arquivo vazio.');
  if (size > clips.MAX_BYTES) return uploadError(res, 400, 'Arquivo grande demais para um corte.');
  if (!clips.VIDEO_EXT.includes(extOf(filename))) return uploadError(res, 400, `Envie vídeo (${clips.VIDEO_EXT.join(', ')}).`);
  const { rep, partSize, totalParts } = await clips.startReplacement(clip, { filename, size, contentType: req.body.tipo, userId: req.user.id });
  res.json({ ok: true, id: rep.id, partSize, totalParts });
}));
router.put('/cortes/:id/trocar/:rid/parte/:n', requirePerm('episodes.read'), express.raw({ type: () => true, limit: MAX_PART }), wrap(async (req, res) => {
  const p = await pendingOf(req, res); if (!p) return;
  const n = Number.parseInt(req.params.n, 10);
  const total = Math.max(1, Math.ceil(Number(p.rep.size_bytes) / p.rep.part_size));
  if (!Number.isInteger(n) || n < 1 || n > total) return uploadError(res, 400, 'Parte inválida.');
  const expected = n < total ? p.rep.part_size : Number(p.rep.size_bytes) - p.rep.part_size * (total - 1);
  if (!Buffer.isBuffer(req.body) || req.body.length !== expected) return uploadError(res, 400, `A parte ${n} deveria ter ${expected} bytes e chegou com ${Buffer.isBuffer(req.body) ? req.body.length : 0}.`);
  await clips.receivePart(p.upload, n, req.body);
  res.json({ ok: true });
}));
router.get('/cortes/:id/trocar/:rid/urls', requirePerm('episodes.read'), wrap(async (req, res) => {
  const p = await pendingOf(req, res); if (!p) return;
  res.set('Cache-Control', 'no-store').json(await require('../services/directUpload').urls({ key: p.rep.storage_key, uploadId: p.rep.upload_id, size: p.rep.size_bytes, partSize: p.rep.part_size, query: req.query.partes }));
}));
router.post('/cortes/:id/trocar/:rid/parte/:n/ok', requirePerm('episodes.read'), wrap(async (req, res) => {
  const p = await pendingOf(req, res); if (!p) return;
  const c = require('../services/directUpload').confirm({ size: p.rep.size_bytes, partSize: p.rep.part_size, number: req.params.n, body: req.body });
  if (c.error) return uploadError(res, c.status, c.error);
  await clips.registerPart(p.upload, Number(req.params.n), c.etag, c.size);
  res.json({ ok: true });
}));
router.post('/cortes/:id/trocar/:rid/concluir', requirePerm('episodes.read'), wrap(async (req, res) => {
  const p = await pendingOf(req, res); if (!p) return;
  const state = await clips.replaceState(p.clip); // pode ter sido publicado enquanto o arquivo subia
  if (!state.allowed) { await clips.cancelReplacement(p.clip.id); return uploadError(res, 409, state.error); }
  const result = await clips.finishReplacement(p.clip, p.rep);
  if (result.error) return uploadError(res, 409, result.error);
  await audit(req, 'corte.video_trocado', 'clip', p.clip.id, { arquivo: p.rep.filename, versao: result.clip.version });
  res.json({ ok: true, id: p.clip.id });
}));
router.post('/cortes/:id/trocar/:rid/cancelar', requirePerm('episodes.read'), wrap(async (req, res) => {
  const p = await pendingOf(req, res); if (!p) return;
  await clips.cancelReplacement(p.clip.id);
  res.json({ ok: true });
}));
// Versão anterior: só para baixar.
router.get('/cortes/:id/versoes/:vid/baixar', requirePerm('episodes.read'), wrap(async (req, res) => {
  const c = await findClip(req);
  if (!c || !isIntId(req.params.vid)) return notFound(res);
  const { rows: [v] } = await db.query('SELECT * FROM clip_versions WHERE id = $1 AND clip_id = $2', [req.params.vid, c.id]);
  if (!v) return notFound(res);
  const ext = (String(v.filename || '').match(/\.[A-Za-z0-9]{1,6}$/) || ['.mp4'])[0].toLowerCase();
  res.set('Cache-Control', 'no-store').redirect(302, await b2.presignGet(v.storage_key, { expires: 3600, download: `${fmt.slugify(c.title) || `corte-${c.id}`}-v${v.version}${ext}` }));
}));

// andamento (a tela consulta enquanto algum corte está enviando/processando)
router.get('/cortes/status', requirePerm('episodes.read'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.status, c.error, j.message, j.progress FROM episode_clips c
       LEFT JOIN LATERAL (SELECT message, progress FROM jobs WHERE kind = 'corte' AND ref_id = c.id ORDER BY id DESC LIMIT 1) j ON true
      WHERE c.status IN ('enviando', 'processando') OR c.updated_at > now() - interval '2 minutes'`);
  const { rows: pubs } = await db.query("SELECT id, status FROM episode_publications WHERE status = 'enviando' OR updated_at > now() - interval '2 minutes'");
  res.json({ ok: true, clips: rows, publications: pubs });
}));

// ---------------------------------------------------------------- um corte
router.get('/cortes/:id', requirePerm('episodes.read'), wrap(async (req, res) => {
  const c = await findClip(req);
  if (!c) return notFound(res);
  require('../services/scope').assert(req, c.project_id); // de outro projeto de que a pessoa não participa: 404
  const [covers, pubs, episodes, ep] = await Promise.all([
    db.query('SELECT id, kind, position, label, lint, approved, auto, updated_at, model FROM episode_covers WHERE clip_id = $1 ORDER BY position', [c.id]),
    db.query('SELECT * FROM episode_publications WHERE clip_id = $1 ORDER BY created_at DESC, id DESC', [c.id]),
    eligibleEpisodes(),
    c.episode_id ? db.query('SELECT e.id, e.number, e.title, g.name AS guest_name, g.instagram AS guest_instagram FROM episodes e LEFT JOIN guests g ON g.id = e.guest_id WHERE e.id = $1', [c.episode_id]) : { rows: [] },
  ]);
  // independentes entre si: saem juntas (antes, uma depois da outra)
  const [provider, ls, social, thread, request, versions, replace] = await Promise.all([
    socialApi.active(), socialApi.liveState(),
    canPublish(req.user.role) ? socialApi.connectedAll({ projectId: c.project_id }) : null, // cada rede com a conta do projeto, no provedor dela
    require('../services/comments').list('clip', c.id),
    c.request_id ? require('../services/contentRequests').get(c.request_id) : null,
    clips.versionsOf(c.id), clips.replaceState(c),
  ]);
  const light = Boolean(await require('../services/videoViews').viewKeyFor(c.storage_key));
  const automation = require('../services/commentAutomation');
  const [autoDefaults, autoOf, nums] = await Promise.all([
    automation.formDefaults({ guest: ep.rows[0]?.guest_name ? { name: ep.rows[0].guest_name } : null }),
    Promise.all(pubs.rows.map(async (p) => [p.id, await automation.ofPublication(p.id)])).then((l) => Object.fromEntries(l.filter(([, r]) => r))),
    pubs.rows.length ? require('../services/postMetrics').forClips([c.id]).then((m) => m[c.id] || null) : null,
  ]);
  await require('../services/catalog').refresh();
  res.render('content/clip', {
    videoTypes: require('../services/catalog').videoOptions(c.video_type), K: require('../services/contentRequests').KINDS,
    ctas: require('../services/socialCopy').forClip(c), autoDefaults, autoOf, nums,
    comments: thread, request, versions, replace, light, coverModels: require('../public/design/models').MODELS,
    title: c.title, clip: c, covers: covers.rows, publications: pubs.rows, episodes: episodes.rows, episode: ep.rows[0] || null, social,
    uploadPost: up, uploadLive: ls.live, testAt: ls.testAt, provider, L, C, videoTags: await socialApi.videoTags(),
    running: ['enviando', 'processando'].includes(c.status) || pubs.rows.some((p) => p.status === 'enviando'),
    perm: { cut: canCut(req.user.role), publish: canPublish(req.user.role) || can(req.user, 'social.request'), direct: canPublish(req.user.role), guest: can(req.user, 'guests.write'), cover: canCover(req.user.role) },
  });
}));

router.post('/cortes/:id', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return deny(req, res);
  const c = await findClip(req); if (!c) return notFound(res);
  const title = fmt.clean(req.body.title, 80) || c.title;
  const postTitle = fmt.clean(req.body.post_title, 100) || null;
  const caption = String(req.body.caption ?? c.caption ?? '').replace(/\r/g, '').slice(0, 2200);
  const before = await recordChanges.snapshot('clip', c.id);
  await db.query('UPDATE episode_clips SET title = $2, post_title = $3, caption = $4, updated_at = now() WHERE id = $1', [c.id, title, postTitle, caption]);
  await recordChanges.updated({ type: 'clip', before, actor: req.user });
  await req.flash('ok', 'Corte salvo.');
  res.redirect(`/cortes/${c.id}`);
}));

// Categoria do vídeo (tipos de Gestão > Categorias): um corte que era bastidor, um vídeo longo horizontal…
router.post('/cortes/:id/categoria', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return deny(req, res);
  const c = await findClip(req); if (!c) return notFound(res);
  const out = await clips.setCategory([c.id], req.body.video_type, req.user);
  if (out.error) await req.flash('error', out.error);
  else await req.flash('ok', `Categoria: ${out.label}.`);
  res.redirect(`/cortes/${c.id}`);
}));

router.post('/cortes/:id/atribuir', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return deny(req, res);
  const c = await findClip(req); if (!c) return notFound(res);
  const back = req.body.voltar === 'lista' ? '/conteudo' : `/cortes/${c.id}`;
  const result = await clips.assign(c.id, req.body.episode_id, req.user.id);
  if (result.error) await req.flash('error', result.error);
  else {
    await audit(req, 'corte.atribuido', 'clip', c.id, { episodio: result.episode.id });
    await req.flash('ok', `Atribuído ao ${result.episode.number ? `EP.${String(result.episode.number).padStart(3, '0')}` : 'episódio'} ${result.episode.title}.${result.coversQueued ? ' As capas estão sendo refeitas com o convidado e o número do episódio.' : ''}`);
  }
  res.redirect(back);
}));

// Corte postado por fora (emergência, ou sem passar pelo sistema): links do post em cada rede, collab e quando saiu.
router.post('/cortes/:id/por-fora', requirePerm('social.publish'), wrap(async (req, res) => {
  const c = await findClip(req); if (!c) return notFound(res);
  const back = `/cortes/${c.id}`;
  const parsed = publishing.parseLinks(req.body.links);
  const igPeople = require('../services/igPeople');
  const rawCollab = String(req.body.collab || '').split(/[\s,]+/).filter(Boolean);
  const collab = [...new Set(rawCollab.map(igPeople.clean).filter(Boolean))];
  let at = null;
  if (req.body.quando) { at = fmt.parseInputDateTime(String(req.body.quando)); if (!at || at > new Date(Date.now() + 5 * 60_000)) at = 'x'; }
  const error = parsed.error || (collab.length < rawCollab.length && 'Collab: use o @ de cada perfil do Instagram.')
    || (collab.length > igPeople.MAX_COLLAB && `Collab no Instagram: no máximo ${igPeople.MAX_COLLAB} perfis.`) || (at === 'x' && 'Data inválida (o post já tem que ter saído).');
  if (error) { await req.flash('error', error); return res.redirect(back); }
  const r = await publishing.createManual({ clipId: c.id, links: parsed.links, collaborators: collab, at, user: req.user });
  if (r.error) { await req.flash('error', r.error); return res.redirect(back); }
  await audit(req, 'corte.postado_por_fora', 'clip', c.id, { redes: parsed.links.map((l) => l.platform) });
  await req.flash('ok', `Registrado: postado por fora em ${parsed.links.map((l) => up.PLATFORMS[l.platform].label).join(', ')}.`);
  res.redirect(`/social/publicacoes/${r.pub.id}`);
}));

router.post('/cortes/:id/reprocessar', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return deny(req, res);
  const c = await findClip(req); if (!c) return notFound(res);
  if (!['pronto', 'erro'].includes(c.status) || !c.storage_key) { await req.flash('error', 'Este corte ainda não pode ser lido de novo.'); return res.redirect(`/cortes/${c.id}`); }
  await db.query("UPDATE episode_clips SET status = 'processando', error = NULL, updated_at = now() WHERE id = $1", [c.id]);
  await jobs.enqueue('corte', { refId: c.id });
  await req.flash('ok', 'Lendo o corte de novo. Isso leva alguns minutos.');
  res.redirect(`/cortes/${c.id}`);
}));

router.post('/cortes/:id/excluir', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCut(req.user.role)) return deny(req, res);
  const c = await findClip(req); if (!c) return notFound(res);
  const gone = await recordChanges.snapshot('clip', c.id);
  let t = null;
  await clips.cancelReplacement(c.id);
  if (c.status === 'enviando') await clips.removeClip(c.id); // envio pela metade: cancela de vez
  else t = await require('../services/trash').remove('clip', c.id, { user: req.user });
  await recordChanges.deleted({ type: 'clip', row: gone, actor: req.user });
  if (t) await req.flash('ok', `${c.title} foi para a lixeira.`, { undo: t.batch });
  await audit(req, 'corte.excluido', 'clip', c.id, { episodio: c.episode_id });
  res.redirect(c.request_id ? `/conteudo/pedidos/${c.request_id}` : '/conteudo');
}));

router.get('/cortes/:id/video', requirePerm('episodes.read'), wrap(async (req, res) => {
  const c = await findClip(req); if (!c || !c.storage_key || c.status === 'enviando') return notFound(res);
  // assistir: a versão leve (720p), se já existe; baixar e "?original=1" entregam o arquivo enviado
  const url = req.query.baixar === '1' ? await b2.presignGet(c.storage_key, { expires: 3600, download: `${fmt.slugify(c.title) || `corte-${c.id}`}.mp4` })
    : await require('../services/videoViews').playUrl(c.storage_key, { original: req.query.original === '1', expires: 3600 });
  res.set('Cache-Control', 'private, max-age=60').redirect(302, url);
}));

router.post('/cortes/:id/capa', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canCover(req.user.role)) return deny(req, res);
  const c = await findClip(req); if (!c) return notFound(res);
  if (!isIntId(req.body.cover_id)) return notFound(res);
  const { rows: [cv] } = await db.query("SELECT id FROM episode_covers WHERE id = $1 AND clip_id = $2 AND kind = 'reel_cover'", [req.body.cover_id, c.id]);
  if (!cv) return notFound(res);
  await db.query('UPDATE episode_clips SET cover_id = $2, updated_at = now() WHERE id = $1', [c.id, cv.id]);
  await db.query('UPDATE episode_covers SET approved = (id = $2) WHERE clip_id = $1', [c.id, cv.id]);
  res.redirect(`/cortes/${c.id}`);
}));

// ---------------------------------------------------------------- publicação
function readPublishForm(req) {
  const platforms = [].concat(req.body.platforms || []).map(String).filter((p) => up.PLATFORMS[p]);
  const title = fmt.clean(req.body.title);
  const description = String(req.body.description || '').replace(/\r/g, '').trim();
  let scheduledAt = null;
  if (req.body.agendar) { const d = fmt.parseInputDateTime(String(req.body.agendar)); scheduledAt = d ? d.toISOString() : 'invalid'; }
  return { platforms, title, description, scheduledAt };
}

async function publish(req, res, { episodeId, clipId }) {
  const home = clipId ? `/cortes/${clipId}` : `/episodios/${episodeId}#publicacao`;
  // corte: a produtora pode pedir (vai para a revisão da gestão); o episódio inteiro só a gestão publica
  const review = !canPublish(req.user.role) && Boolean(clipId) && can(req.user, 'social.request');
  if (!canPublish(req.user.role) && !review) return deny(req, res, 'Só a gestão publica nas redes.');
  const form = readPublishForm(req);
  const fail = async (msg) => { if (wantsJson(req)) return res.status(422).json({ ok: false, error: msg }); await req.flash('error', msg); return res.redirect(home); };
  if (form.scheduledAt === 'invalid') return fail('Data de agendamento inválida.');
  const ig = require('../services/igPeople').parse(req.body, { media: 'video', platforms: form.platforms });
  if (ig.error) return fail(ig.error);
  if (req.body.confirmar !== '1' && !review) return fail('Confirme o envio marcando "Entendi que isto publica nas redes escolhidas".');
  try {
    const automation = require('../services/commentAutomation');
    const auto = clipId ? automation.readForm(req.body) : null;
    const prep = await automation.prepare(auto, { platforms: form.platforms, ctas: clipId ? require('../services/socialCopy').readForm(req.body, form.platforms) : null, clipId });
    const pub = await publishing.create({ episodeId, clipId, ...form, userId: req.user.id, review, instagram: clipId ? ig.instagram : null, ctas: prep.ctas });
    if (auto) await automation.attach(pub, auto, { keyword: prep.keyword, userId: req.user.id });
    await audit(req, 'publicacao.criada', 'publication', pub.id, { redes: pub.platforms, simulado: pub.status === 'simulado' });
    if (wantsJson(req)) return res.json({ ok: true, publication: pub });
    await req.flash(pub.status === 'erro' ? 'error' : 'ok', socialApi.sentMessage(pub, { trail: ' O andamento aparece abaixo.' }));
  } catch (err) {
    return fail(err.message);
  }
  return res.redirect(home);
}
router.post('/episodios/:id/publicar', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return notFound(res);
  return publish(req, res, { episodeId: req.params.id, clipId: null });
}));
router.post('/cortes/:id/publicar', requirePerm('episodes.read'), wrap(async (req, res) => {
  const c = await findClip(req); if (!c) return notFound(res);
  return publish(req, res, { episodeId: c.episode_id, clipId: c.id });
}));

async function findPub(req) {
  if (!isIntId(req.params.id) || !isIntId(req.params.pid)) return null;
  const { rows: [p] } = await db.query('SELECT * FROM episode_publications WHERE id = $1 AND episode_id = $2', [req.params.pid, req.params.id]);
  return p || null;
}
const pubHome = (p) => (p.clip_id ? `/cortes/${p.clip_id}` : `/episodios/${p.episode_id}#publicacao`);
router.post('/episodios/:id/publicacoes/:pid/atualizar', requirePerm('episodes.read'), wrap(async (req, res) => {
  const p = await findPub(req); if (!p) return notFound(res);
  await publishing.refresh(p.id);
  res.redirect(pubHome(p));
}));
router.post('/episodios/:id/publicacoes/:pid/repetir', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canPublish(req.user.role)) return deny(req, res, 'Só a gestão publica nas redes.');
  const p = await findPub(req); if (!p) return notFound(res);
  await publishing.retry(p.id);
  res.redirect(pubHome(p));
}));
router.post('/episodios/:id/publicacoes/:pid/cancelar', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canPublish(req.user.role)) return deny(req, res, 'Só a gestão publica nas redes.');
  const p = await findPub(req); if (!p) return notFound(res);
  await publishing.cancel(p.id);
  res.redirect(pubHome(p));
}));

module.exports = router;
