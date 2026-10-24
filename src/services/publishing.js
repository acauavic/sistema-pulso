// Publicação nas redes (Upload-Post ou Zernio, ver socialApi): o episódio inteiro só no YouTube; cortes em TikTok, Shorts e Reels (ou o que estiver conectado).
// Envio imediato ou agendado (o agendamento é nosso: o link do vídeo é gerado na hora de enviar, porque links assinados expiram).
const db = require('../db/pool');
const b2 = require('./b2');
const up = require('./uploadPost'); // limites e validação (iguais para os dois provedores)
const social = require('./socialApi');
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
  const provider = await social.active();
  if (provider.live() && !review) {
    const conn = await provider.connected();
    if (!conn.ok) throw new Error(`Não foi possível consultar as redes conectadas: ${conn.error}`);
    const missing = list.filter((p) => !conn.platforms[p]);
    if (missing.length) throw new Error(`Sem conta conectada no ${provider.label}: ${missing.map((p) => up.PLATFORMS[p]?.label || p).join(', ')}.`);
  }
  const { rows: [pub] } = await db.query(
    `INSERT INTO episode_publications (episode_id, clip_id, platforms, title, description, options, cover_id, scheduled_at, status, created_by, media, cover_ids, provider)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [target.episode?.id || null, target.kind === 'photo' ? null : clipId, list, L.tidy(title || (target.kind === 'photo' ? MEDIA_LABEL[media] : '')), description ? L.tidy(description) : null, JSON.stringify({ tags, warnings: check.warnings, ...(instagram && list.includes('instagram') && media !== 'story' ? { instagram } : {}) }),
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
async function dispatch(pubId) {
  await social.syncLive();
  const { rows: [pub] } = await db.query("UPDATE episode_publications SET status = 'enviando', updated_at = now() WHERE id = $1 AND status IN ('enviando','agendado') RETURNING *", [pubId]);
  if (!pub) return null;
  try {
    const target = await loadTarget({ episodeId: pub.episode_id, clipId: pub.clip_id, media: pub.media, coverIds: pub.cover_ids });
    // agendado/revisão: sai pelo provedor escolhido na hora de enviar (a gestão pode ter trocado nesse meio-tempo)
    const provider = await social.active();
    if (provider.id !== pub.provider) { await db.query('UPDATE episode_publications SET provider = $2 WHERE id = $1', [pub.id, provider.id]); pub.provider = provider.id; }
    const conn = provider.live() ? await provider.connected() : { platforms: {} };
    if (target.kind === 'photo') return await dispatchPhotos(pub, target, provider, conn);
    const videoUrl = await b2.presignGet(target.videoKey, { expires: up.MAX_LINK_SECONDS });
    let coverUrl = null;
    if (pub.cover_id) {
      const { rows: [cv] } = await db.query('SELECT storage_key FROM episode_covers WHERE id = $1', [pub.cover_id]);
      if (cv) coverUrl = await b2.presignGet(cv.storage_key, { expires: up.MAX_LINK_SECONDS });
    }
    const sent = await provider.sendVideo({
      id: pub.id, kind: target.kind, platforms: pub.platforms, title: pub.title, description: pub.description, videoUrl,
      coverUrl: target.kind === 'clip' ? coverUrl : null, thumbnailUrl: target.kind === 'episode' ? coverUrl : null, tags: pub.options?.tags || [], accounts: conn.platforms,
      instagram: pub.options?.instagram || null,
    });
    const state = sent.simulated ? 'simulado' : (sent.done ? finalState(sent.results) : 'enviando');
    const { rows: [saved] } = await db.query(
      `UPDATE episode_publications SET status = $2, request_id = $3, job_id = $4, results = $5, options = options || $6, error = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
      [pub.id, state, sent.request_id || null, sent.job_id || null, JSON.stringify(sent.results || []), JSON.stringify({ fields: sent.fieldNames })]);
    if (state === 'publicado' || state === 'parcial') await afterPublished(saved);
    return saved;
  } catch (err) {
    const { rows: [failed] } = await db.query("UPDATE episode_publications SET status = 'erro', error = $2, updated_at = now() WHERE id = $1 RETURNING *", [pub.id, String(err.message).slice(0, 500)]);
    await addEvent(pub.episode_id, pub.created_by, `Falha ao publicar: ${err.message}`);
    await tellCreator(pub, `Falha ao publicar: ${pub.title}`, String(err.message).slice(0, 300));
    return failed;
  }
}

// Imagens: links assinados de cada imagem (na ordem do carrossel) -> provedor.
async function dispatchPhotos(pub, target, provider, conn) {
  const photoUrls = [];
  for (const c of target.covers) photoUrls.push(await b2.presignGet(c.storage_key, { expires: up.MAX_LINK_SECONDS }));
  const sent = await provider.sendPhotos({ id: pub.id, media: pub.media, platforms: pub.platforms, title: pub.title, description: pub.description, photoUrls, accounts: conn.platforms, instagram: pub.options?.instagram || null });
  const state = sent.simulated ? 'simulado' : (sent.done ? finalState(sent.results) : 'enviando');
  const { rows: [saved] } = await db.query(
    'UPDATE episode_publications SET status = $2, request_id = $3, job_id = $4, results = $5, options = options || $6, error = NULL, updated_at = now() WHERE id = $1 RETURNING *',
    [pub.id, state, sent.request_id || null, sent.job_id || null, JSON.stringify(sent.results || []), JSON.stringify({ fields: sent.fieldNames })]);
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

// Atualiza o andamento de um envio que está no provedor (o mesmo pelo qual saiu).
async function refresh(pubId) {
  const { rows: [pub] } = await db.query('SELECT * FROM episode_publications WHERE id = $1', [pubId]);
  if (!pub || pub.status !== 'enviando' || !(pub.request_id || pub.job_id)) return pub || null;
  try {
    const st = await social.get(pub.provider).status({ request_id: pub.request_id, job_id: pub.job_id });
    const { rows: [saved] } = await db.query('UPDATE episode_publications SET status = $2, results = $3, error = $4, updated_at = now() WHERE id = $1 RETURNING *',
      [pub.id, st.state, JSON.stringify(st.results.length ? st.results : pub.results), st.error || null]);
    if (st.state === 'publicado' || st.state === 'parcial') await afterPublished(saved);
    if (st.state === 'erro') { await addEvent(pub.episode_id, pub.created_by, `Falha ao publicar: ${st.error}`); await tellCreator(pub, `Falha ao publicar: ${pub.title}`, st.error); }
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
  const { rows: [pub] } = await db.query("UPDATE episode_publications SET status = 'enviando', error = NULL, request_id = NULL, job_id = NULL, updated_at = now() WHERE id = $1 AND status = 'erro' RETURNING *", [pubId]);
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
