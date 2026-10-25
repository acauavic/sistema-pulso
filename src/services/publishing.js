// Publicação nas redes (Upload-Post ou Zernio, ver socialApi): o episódio inteiro só no YouTube; cortes em TikTok, Shorts e Reels (ou o que estiver conectado).
// Envio imediato ou agendado (o agendamento é nosso: o link do vídeo é gerado na hora de enviar, porque links assinados expiram).
const db = require('../db/pool');
const b2 = require('./b2');
const up = require('./uploadPost'); // limites e validação (iguais para os dois provedores)
const social = require('./socialApi');
const health = require('./socialHealth');
const L = require('./platformLimits');

// Linha do tempo do episódio (conteúdo avulso, como o trailer do canal, não tem episódio: não registra).
const addEvent = (episodeId, userId, message) => (!episodeId ? Promise.resolve() : db.query("INSERT INTO episode_events (episode_id, user_id, type, message) VALUES ($1,$2,'publicacao',$3)", [episodeId, userId || null, message]));

async function loadTarget({ episodeId, clipId, media = 'video', coverIds = [] }) {
  if (media !== 'video') { // imagens geradas no editor de capas (post, carrossel, story)
    const ids = [...new Set((coverIds || []).map(Number).filter(Number.isInteger))];
    if (!ids.length) throw new Error('Escolha a imagem.');
    const { rows } = await db.query(
      `SELECT c.*, coalesce(c.episode_id, cl.episode_id) AS ep_id, r.status AS request_status FROM episode_covers c LEFT JOIN episode_clips cl ON cl.id = c.clip_id
         LEFT JOIN content_requests r ON r.id = c.request_id
        WHERE c.id = ANY($1::int[]) ORDER BY array_position($1::int[], c.id)`, [ids]);
    if (rows.length !== ids.length) throw new Error('Imagem não encontrada.');
    if (rows.some((c) => c.request_id && c.request_status !== 'aprovado')) throw new Error('A entrega deste pedido ainda não foi aprovada.');
    const epId = rows[0].ep_id;
    if (!epId && !rows[0].request_id) throw new Error('Atribua o corte a um episódio antes de publicar a imagem.');
    const { rows: [episode] } = epId ? await db.query('SELECT * FROM episodes WHERE id = $1', [epId]) : { rows: [null] };
    return { kind: 'photo', media, episode, clip: null, covers: rows };
  }
  if (clipId) {
    const { rows: [clip] } = await db.query('SELECT * FROM episode_clips WHERE id = $1', [clipId]);
    if (!clip) throw new Error('Corte não encontrado.');
    if (clip.status !== 'pronto' || !clip.storage_key) throw new Error('O corte ainda não está pronto.');
    if (clip.request_id) { // entrega de pedido (trailer, vídeo avulso): só depois de aprovada; pode não ter episódio
      const { rows: [r] } = await db.query('SELECT status FROM content_requests WHERE id = $1', [clip.request_id]);
      if (r?.status !== 'aprovado') throw new Error('A entrega deste pedido ainda não foi aprovada.');
    } else if (!clip.episode_id) throw new Error('Atribua o corte a um episódio antes de publicar.');
    const { rows: [episode] } = clip.episode_id ? await db.query('SELECT * FROM episodes WHERE id = $1', [clip.episode_id]) : { rows: [null] };
    return { kind: 'clip', episode, clip, videoKey: clip.storage_key, coverId: clip.cover_id };
  }
  const { rows: [episode] } = await db.query('SELECT * FROM episodes WHERE id = $1', [episodeId]);
  if (!episode) throw new Error('Episódio não encontrado.');
  const { rows: [file] } = await db.query("SELECT * FROM episode_files WHERE episode_id = $1 AND kind = 'editado' AND status = 'pronto' ORDER BY version DESC LIMIT 1", [episodeId]);
  if (!file) throw new Error('Não há vídeo editado para publicar.');
  if (!['pronto_publicar', 'publicado'].includes(episode.status)) throw new Error('O episódio só pode ser enviado quando estiver em "Pronto para publicar".');
  const { rows: [meta] } = await db.query('SELECT thumb_cover_id FROM episode_metadata WHERE episode_id = $1', [episodeId]);
  return { kind: 'episode', episode, clip: null, videoKey: file.storage_key, coverId: meta?.thumb_cover_id || null };
}

// Cria a publicação (já conferida) e envia na hora, ou deixa agendada.
// review = true: quem pediu não publica direto (produtora); fica "em revisão" até a gestão aprovar ou recusar.
async function create({ episodeId, clipId = null, media = 'video', coverIds = [], platforms, title, description = '', scheduledAt = null, tags = [], userId = null, review = false, instagram = null }) {
  const target = await loadTarget({ episodeId, clipId, media, coverIds });
  const list = [...new Set(platforms || [])];
  const check = target.kind === 'photo'
    ? up.validatePhotos({ media, platforms: list, title, description, scheduledAt, count: target.covers.length })
    : up.validate({ kind: target.kind, platforms: list, title, description, scheduledAt });
  if (!check.ok) { const err = new Error(check.issues[0]); err.issues = check.issues; throw err; }
  const groups = await social.plan(list); // cada rede sai pelo provedor dela (padrão ou rota); pode haver mais de um provedor
  if (!review) {
    for (const g of groups) {
      if (!g.provider.live()) continue;
      const conn = await g.provider.connected();
      if (!conn.ok) throw new Error(`Não foi possível consultar as redes conectadas ${g.provider.at}: ${conn.error}`);
      const missing = g.platforms.filter((p) => !conn.platforms[p]);
      if (missing.length) throw new Error(`Sem conta conectada ${g.provider.at}: ${missing.map((p) => up.PLATFORMS[p]?.label || p).join(', ')}.`);
      const stale = [...new Set([...g.platforms.filter((p) => conn.platforms[p]?.reauth), ...await health.reauthOf(g.provider.id, g.platforms)])];
      if (stale.length) throw new Error(`Reconecte ${stale.map((p) => up.PLATFORMS[p]?.label || p).join(', ')} ${g.provider.at}: o acesso da conta venceu e a publicação falharia.`);
    }
  }
  const provider = groups[0].provider;
  const routesMap = groups.length > 1 ? Object.fromEntries(groups.flatMap((g) => g.platforms.map((p) => [p, g.provider.id]))) : null;
  const { rows: [pub] } = await db.query(
    `INSERT INTO episode_publications (episode_id, clip_id, platforms, title, description, options, cover_id, scheduled_at, status, created_by, media, cover_ids, provider)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [target.episode?.id || null, target.kind === 'photo' ? null : clipId, list, L.tidy(title || (target.kind === 'photo' ? MEDIA_LABEL[media] : '')), description ? L.tidy(description) : null, JSON.stringify({ tags, warnings: check.warnings, ...(routesMap ? { routes: routesMap } : {}), ...(instagram && list.includes('instagram') && media !== 'story' ? { instagram } : {}) }),
      target.kind === 'photo' ? target.covers[0].id : target.coverId, scheduledAt || null, review ? 'revisao' : (scheduledAt ? 'agendado' : 'enviando'), userId, media, target.kind === 'photo' ? target.covers.map((c) => c.id) : [], provider.id]);
  const names = list.map((p) => up.PLATFORMS[p].label).join(', ');
  if (review) {
    await addEvent(target.episode?.id, userId, `Publicação enviada para revisão da gestão (${names}): ${pub.title}`);
    await askReview(pub, userId);
    return pub;
  }
  await addEvent(target.episode?.id, userId, scheduledAt ? `Publicação agendada (${names}): ${pub.title}` : `Publicação enviada (${names}): ${pub.title}`);
  return scheduledAt ? pub : dispatch(pub.id);
}

// Envia uma publicação pendente (agora). Falhas viram status "erro" com o motivo, nunca ficam silenciosas.
// Cada rede sai pelo provedor dela: se forem vários, cada um recebe só as suas redes (um envio por provedor) e o andamento é
// acompanhado em cada um (options.parts). Se um provedor falhar ao enviar e outro não, a publicação segue e mostra qual rede falhou.
async function dispatch(pubId) {
  await social.syncLive();
  const { rows: [pub] } = await db.query("UPDATE episode_publications SET status = 'enviando', updated_at = now() WHERE id = $1 AND status IN ('enviando','agendado') RETURNING *", [pubId]);
  if (!pub) return null;
  try {
    const target = await loadTarget({ episodeId: pub.episode_id, clipId: pub.clip_id, media: pub.media, coverIds: pub.cover_ids });
    // agendado/revisão: sai pelos provedores atuais na hora de enviar (a gestão pode ter trocado nesse meio-tempo)
    const groups = await social.plan(pub.platforms);
    const routesMap = groups.length > 1 ? Object.fromEntries(groups.flatMap((g) => g.platforms.map((p) => [p, g.provider.id]))) : null;
    const first = groups[0].provider.id;
    if (first !== pub.provider) { await db.query('UPDATE episode_publications SET provider = $2 WHERE id = $1', [pub.id, first]); pub.provider = first; }
    const media = await mediaLinks(pub, target);
    const outcomes = [];
    for (const g of groups) {
      try {
        const conn = g.provider.live() ? await g.provider.connected() : { platforms: {} };
        const sent = target.kind === 'photo'
          ? await g.provider.sendPhotos({ id: pub.id, media: pub.media, platforms: g.platforms, title: pub.title, description: pub.description, photoUrls: media.photoUrls, accounts: conn.platforms, instagram: pub.options?.instagram || null })
          : await g.provider.sendVideo({
            id: pub.id, kind: target.kind, platforms: g.platforms, title: pub.title, description: pub.description, videoUrl: media.videoUrl,
            coverUrl: target.kind === 'clip' ? media.coverUrl : null, thumbnailUrl: target.kind === 'episode' ? media.coverUrl : null, tags: pub.options?.tags || [], accounts: conn.platforms,
            instagram: pub.options?.instagram || null,
          });
        outcomes.push({ g, sent });
      } catch (err) { outcomes.push({ g, error: err }); }
    }
    if (outcomes.every((o) => o.error)) throw outcomes[0].error; // nenhum provedor aceitou: erro, como sempre
    return await saveSent(pub, outcomes, routesMap);
  } catch (err) {
    const { rows: [failed] } = await db.query("UPDATE episode_publications SET status = 'erro', error = $2, updated_at = now() WHERE id = $1 RETURNING *", [pub.id, String(err.message).slice(0, 500)]);
    await addEvent(pub.episode_id, pub.created_by, `Falha ao publicar: ${err.message}`);
    await tellCreator(pub, `Falha ao publicar: ${pub.title}`, String(err.message).slice(0, 300));
    return failed;
  }
}

// Links assinados do material (o provedor baixa de lá): vídeo e capa, ou as imagens na ordem do carrossel.
async function mediaLinks(pub, target) {
  if (target.kind === 'photo') {
    const photoUrls = [];
    for (const c of target.covers) photoUrls.push(await b2.presignGet(c.storage_key, { expires: up.MAX_LINK_SECONDS }));
    return { photoUrls };
  }
  const videoUrl = await b2.presignGet(target.videoKey, { expires: up.MAX_LINK_SECONDS });
  let coverUrl = null;
  if (pub.cover_id) {
    const { rows: [cv] } = await db.query('SELECT storage_key FROM episode_covers WHERE id = $1', [pub.cover_id]);
    if (cv) coverUrl = await b2.presignGet(cv.storage_key, { expires: up.MAX_LINK_SECONDS });
  }
  return { videoUrl, coverUrl };
}

// Junta o que cada provedor respondeu: resultados (com o provedor de cada rede), onde acompanhar cada envio e o que falhou ao enviar.
async function saveSent(pub, outcomes, routesMap) {
  const results = []; const parts = []; const sendErrors = []; const warnings = []; const fields = new Set();
  for (const o of outcomes) {
    const pid = o.g.provider.id;
    if (o.error) {
      const msg = String(o.error.message).slice(0, 300);
      for (const p of o.g.platforms) { sendErrors.push({ platform: p, provider: pid, error: msg }); results.push({ platform: p, ok: false, skipped: false, status: 'failed', url: null, error: msg, provider: pid }); }
      await addEvent(pub.episode_id, pub.created_by, `Falha ao enviar ${o.g.platforms.map((p) => up.PLATFORMS[p]?.label || p).join(', ')} ${o.g.provider.by}: ${msg}`);
      continue;
    }
    const s = o.sent;
    results.push(...(s.results || []).map((r) => ({ ...r, provider: pid })));
    (s.fieldNames || []).forEach((f) => fields.add(f));
    warnings.push(...(s.warnings || []));
    if (!s.simulated) parts.push({ provider: pid, request_id: s.request_id || null, job_id: s.job_id || null, platforms: o.g.platforms, done: Boolean(s.done) });
  }
  const real = results.filter((r) => !r.simulated);
  let state;
  if (!parts.length) state = sendErrors.length ? 'erro' : 'simulado'; // nada foi realmente enviado
  else if (outcomes.every((o) => o.error || o.sent.simulated || o.sent.done)) state = finalState(real);
  else state = 'enviando';
  const first = parts[0] || {};
  const options = { fields: [...fields], ...(routesMap ? { routes: routesMap } : {}), ...(parts.length ? { parts } : {}), ...(sendErrors.length ? { send_errors: sendErrors } : {}), ...(warnings.length ? { provider_warnings: warnings } : {}) };
  const { rows: [saved] } = await db.query(
    `UPDATE episode_publications SET status = $2, request_id = $3, job_id = $4, results = $5, options = options || $6, error = $7, updated_at = now() WHERE id = $1 RETURNING *`,
    [pub.id, state, first.request_id || null, first.job_id || null, JSON.stringify(results), JSON.stringify(options), state === 'erro' ? (sendErrors[0]?.error || 'O envio falhou.') : null]);
  if (state === 'publicado' || state === 'parcial') await afterPublished(saved);
  return saved;
}

const MEDIA_LABEL = { video: 'Vídeo', imagem: 'Post', carrossel: 'Carrossel', story: 'Story' };

function finalState(results) {
  const real = results.filter((r) => !r.skipped);
  if (!real.length) return 'erro';
  if (real.every((r) => r.ok)) return 'publicado';
  return real.some((r) => r.ok) ? 'parcial' : 'erro';
}

// Guarda o link do YouTube no episódio quando a rede devolve (só se estiver vazio).
async function afterPublished(pub) {
  if (pub.clip_id || pub.media !== 'video') { await addEvent(pub.episode_id, pub.created_by, `Publicado: ${pub.title}`); await tellCreator(pub, `Publicado: ${pub.title}`, (pub.results || []).filter((r) => r.ok).map((r) => r.platform).join(', ')); return; }
  const yt = (pub.results || []).find((r) => r.platform === 'youtube' && r.ok && /^https?:\/\//.test(r.url || ''));
  if (yt) await db.query("UPDATE episodes SET youtube_url = $2, updated_at = now() WHERE id = $1 AND coalesce(youtube_url, '') = ''", [pub.episode_id, yt.url]);
  await addEvent(pub.episode_id, pub.created_by, `Publicado: ${pub.title}`);
  await tellCreator(pub, `Publicado: ${pub.title}`, (pub.results || []).filter((r) => r.ok).map((r) => r.platform).join(', '));
}

// Rotina do sistema: avisa quem pediu a publicação (sucesso ou falha).
async function tellCreator(pub, title, body) {
  await require('./notify').notify({ type: 'rotina', users: [pub.created_by], title, body, url: `/social/publicacoes/${pub.id}`, entity: { type: pub.clip_id ? 'clip' : 'episode', id: pub.clip_id || pub.episode_id }, dedupe: `pub-${pub.id}-${title.slice(0, 20)}` }).catch((err) => console.error('Aviso de publicação:', err.message));
}

// Atualiza o andamento de um envio que está no provedor (o mesmo pelo qual saiu; cada provedor, se foram vários).
async function refresh(pubId) {
  const { rows: [pub] } = await db.query('SELECT * FROM episode_publications WHERE id = $1', [pubId]);
  if (!pub || pub.status !== 'enviando' || !(pub.request_id || pub.job_id)) return pub || null;
  const parts = pub.options?.parts?.length ? pub.options.parts : [{ provider: pub.provider, request_id: pub.request_id, job_id: pub.job_id, platforms: pub.platforms }];
  try {
    const sts = [];
    for (const part of parts) sts.push({ part, st: await social.get(part.provider).status({ request_id: part.request_id, job_id: part.job_id }) });
    const sendErrors = pub.options?.send_errors || [];
    let results = [
      ...sts.flatMap(({ part, st }) => (st.results || []).map((r) => ({ ...r, provider: part.provider }))),
      ...sendErrors.map((e) => ({ platform: e.platform, ok: false, skipped: false, status: 'failed', url: null, error: e.error, provider: e.provider })),
      ...(pub.results || []).filter((r) => r.simulated),
    ];
    if (!results.length) results = pub.results;
    let state; let error = null;
    if (parts.length === 1 && !sendErrors.length) { state = sts[0].st.state; error = sts[0].st.error || null; } else {
      const states = sts.map(({ st }) => st.state);
      if (states.includes('enviando')) state = 'enviando';
      else if (states.every((x) => x === 'publicado') && !sendErrors.length) state = 'publicado';
      else if (states.some((x) => x === 'publicado' || x === 'parcial')) state = 'parcial';
      else state = 'erro';
      if (state === 'erro') error = sts.map(({ st }) => st.error).find(Boolean) || sendErrors[0]?.error || 'O envio falhou.';
    }
    const { rows: [saved] } = await db.query('UPDATE episode_publications SET status = $2, results = $3, error = $4, updated_at = now() WHERE id = $1 RETURNING *',
      [pub.id, state, JSON.stringify(results), error]);
    if (state === 'publicado' || state === 'parcial') await afterPublished(saved);
    if (state === 'erro') { await addEvent(pub.episode_id, pub.created_by, `Falha ao publicar: ${error}`); await tellCreator(pub, `Falha ao publicar: ${pub.title}`, error); }
    return saved;
  } catch (err) {
    console.error(`[publicação ${pub.id}] não consegui consultar o status:`, err.message);
    return pub;
  }
}

// Roda de tempos em tempos (rotina do sistema, uma réplica por vez): envia o que está agendado e vencido; atualiza o que está em andamento.
// A reserva é atômica (agendado -> enviando com SKIP LOCKED): o mesmo agendamento nunca sai duas vezes.
async function tick() {
  await social.syncLive(); // o worker também respeita a chave de Integrações
  const { rows: due } = await db.query(
    `UPDATE episode_publications SET status = 'enviando', updated_at = now()
      WHERE id IN (SELECT id FROM episode_publications WHERE status = 'agendado' AND scheduled_at <= now() ORDER BY scheduled_at LIMIT 10 FOR UPDATE SKIP LOCKED)
      RETURNING id`);
  for (const p of due) await dispatch(p.id);
  const { rows: running } = await db.query("SELECT id FROM episode_publications WHERE status = 'enviando' AND (request_id IS NOT NULL OR job_id IS NOT NULL) AND updated_at < now() - interval '10 seconds' ORDER BY id LIMIT 20");
  for (const p of running) await refresh(p.id);
}

// "Mandar de novo" depois de um erro: volta para a fila e envia.
async function retry(pubId) {
  const { rows: [pub] } = await db.query("UPDATE episode_publications SET status = 'enviando', error = NULL, request_id = NULL, job_id = NULL, options = options - 'parts' - 'send_errors' - 'provider_warnings', updated_at = now() WHERE id = $1 AND status = 'erro' RETURNING *", [pubId]);
  return pub ? dispatch(pub.id) : null;
}

async function cancel(pubId) {
  const { rows: [pub] } = await db.query("DELETE FROM episode_publications WHERE id = $1 AND status IN ('agendado','revisao','recusado') RETURNING *", [pubId]);
  if (pub) await addEvent(pub.episode_id, null, pub.status === 'agendado' ? `Agendamento cancelado: ${pub.title}` : `Pedido de publicação retirado: ${pub.title}`);
  return pub || null;
}

// ---------------------------------------------------------------- revisão da gestão (post pedido pela produtora)
const notify = (args) => require('./notify').notify(args).catch((err) => console.error('Aviso de publicação:', err.message));
async function askReview(pub, userId) {
  const { rows: who } = await db.query("SELECT id FROM users WHERE active AND role IN ('superadmin','gestao')");
  const { rows: [u] } = userId ? await db.query('SELECT name FROM users WHERE id = $1', [userId]) : { rows: [] };
  await notify({
    type: 'tarefa', users: who.map((r) => r.id), actorId: userId, title: `Post para aprovar: ${pub.title}`,
    body: `${u ? u.name : 'Alguém da equipe'} pediu para publicar (${pub.platforms.map((p) => up.PLATFORMS[p]?.label || p).join(', ')})${pub.scheduled_at ? ' em ' + new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(pub.scheduled_at) : ''}.`,
    url: `/social/publicacoes/${pub.id}`, entity: { type: 'publication', id: pub.id }, dedupe: `revisao-${pub.id}-${Date.now()}`,
  });
}

// Aprovar: se o horário pedido ainda está no futuro, vira agendado; senão sai agora. A reserva é atômica (dois cliques não publicam duas vezes).
async function approve(pubId, reviewer) {
  const { rows: [pub] } = await db.query(
    `UPDATE episode_publications SET status = CASE WHEN scheduled_at > now() + interval '1 minute' THEN 'agendado' ELSE 'enviando' END,
            reviewed_by = $2, reviewed_at = now(), review_note = NULL, updated_at = now()
      WHERE id = $1 AND status = 'revisao' RETURNING *`, [pubId, reviewer.id]);
  if (!pub) return null;
  await addEvent(pub.episode_id, reviewer.id, `Publicação aprovada por ${reviewer.name}: ${pub.title}`);
  const final = pub.status === 'enviando' ? await dispatch(pub.id) : pub;
  await notify({
    type: 'tarefa', users: [pub.created_by], actorId: reviewer.id, title: `Post aprovado: ${pub.title}`,
    body: final.status === 'agendado' ? 'Aprovado e agendado.' : final.status === 'simulado' ? 'Aprovado (modo de teste: nada foi enviado às redes).' : final.status === 'erro' ? `Aprovado, mas o envio falhou: ${final.error}` : 'Aprovado e enviado às redes.',
    url: `/social/publicacoes/${pub.id}`, entity: { type: 'publication', id: pub.id }, dedupe: `aprovado-${pub.id}`,
  });
  return final;
}

async function reject(pubId, reviewer, note) {
  const { rows: [pub] } = await db.query(
    "UPDATE episode_publications SET status = 'recusado', reviewed_by = $2, reviewed_at = now(), review_note = $3, updated_at = now() WHERE id = $1 AND status = 'revisao' RETURNING *",
    [pubId, reviewer.id, note]);
  if (!pub) return null;
  await addEvent(pub.episode_id, reviewer.id, `Publicação devolvida por ${reviewer.name}: ${note}`);
  await notify({
    type: 'tarefa', users: [pub.created_by], actorId: reviewer.id, title: `Post devolvido: ${pub.title}`, body: note,
    url: `/social/publicacoes/${pub.id}`, entity: { type: 'publication', id: pub.id }, dedupe: `recusado-${pub.id}-${Date.now()}`,
  });
  return pub;
}

// Quem pediu ajusta o post devolvido e manda de novo para a revisão.
async function resubmit(pubId, user) {
  const { rows: [pub] } = await db.query("UPDATE episode_publications SET status = 'revisao', updated_at = now() WHERE id = $1 AND status = 'recusado' RETURNING *", [pubId]);
  if (pub) { await addEvent(pub.episode_id, user.id, `Publicação reenviada para revisão: ${pub.title}`); await askReview(pub, user.id); }
  return pub || null;
}

module.exports = { loadTarget, create, dispatch, refresh, tick, retry, cancel, approve, reject, resubmit, finalState, MEDIA_LABEL };
