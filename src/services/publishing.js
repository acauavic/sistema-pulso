// Publicação nas redes (Upload-Post, Zernio ou Outstand, ver socialApi): o episódio inteiro só no YouTube; cortes em TikTok, Shorts e Reels (ou o que estiver conectado).
// Envio imediato ou agendado (o agendamento é nosso: o link do vídeo é gerado na hora de enviar, porque links assinados expiram).
// Entrega garantida:
//  - antes de falar com as redes, o material é conferido do começo ao fim (prepareMedia): o vídeo de corte e as imagens vão para o
//    armazenamento da Outstand (e o reaproveitam nas novas tentativas); o episódio é conferido parte a parte no Backblaze. Arquivo
//    ilegível não sai pela metade: a publicação espera e tenta de novo;
//  - cada tentativa fica em publication_attempts (o que foi, por onde, o que cada rede respondeu);
//  - a rede que falha por motivo passageiro volta sozinha na hora certa (retry_at; a fila do YouTube, no horário que a Outstand informa),
//    e a que precisa de ação (reconectar conta, arquivo novo) avisa quem pediu e a gestão uma vez. Ver publishErrors.
const crypto = require('crypto');
const db = require('../db/pool');
const b2 = require('./b2');
const up = require('./uploadPost'); // limites e validação (iguais para os dois provedores)
const social = require('./socialApi');
const health = require('./socialHealth');
const L = require('./platformLimits');
const mediaCheck = require('./mediaCheck');
const ost = require('./outstand');
const E = require('./publishErrors');

// Linha do tempo do episódio (conteúdo avulso, como o trailer do canal, não tem episódio: não registra).
const addEvent = (episodeId, userId, message) => (!episodeId ? Promise.resolve() : db.query("INSERT INTO episode_events (episode_id, user_id, type, message) VALUES ($1,$2,'publicacao',$3)", [episodeId, userId || null, message]));
const labelOf = (p) => up.PLATFORMS[p]?.label || p;
const names = (list) => list.map(labelOf).join(', ');

// Erros do material com código (ver publishErrors): removido/recusado param e pedem ação; em_preparo (o vídeo do corte está sendo
// enviado ou lido de novo, o conserto mais comum de um arquivo ruim) espera e tenta de novo.
const targetError = (code, message) => Object.assign(new Error(message), { code });

async function loadTarget({ episodeId, clipId, media = 'video', coverIds = [] }) {
  if (media !== 'video') { // imagens geradas no editor de capas (post, carrossel, story)
    const ids = [...new Set((coverIds || []).map(Number).filter(Number.isInteger))];
    if (!ids.length) throw new Error('Escolha a imagem.');
    const { rows } = await db.query(
      `SELECT c.*, coalesce(c.episode_id, cl.episode_id) AS ep_id, r.status AS request_status FROM episode_covers c LEFT JOIN episode_clips cl ON cl.id = c.clip_id
         LEFT JOIN content_requests r ON r.id = c.request_id
        WHERE c.id = ANY($1::int[]) ORDER BY array_position($1::int[], c.id)`, [ids]);
    if (rows.length !== ids.length) throw targetError('removido', 'Imagem não encontrada.');
    if (rows.some((c) => c.request_id && c.request_status !== 'aprovado')) throw targetError('recusado', 'A entrega deste pedido ainda não foi aprovada.');
    const epId = rows[0].ep_id;
    if (!epId && !rows[0].request_id) throw targetError('recusado', 'Atribua o corte a um episódio antes de publicar a imagem.');
    const { rows: [episode] } = epId ? await db.query('SELECT * FROM episodes WHERE id = $1', [epId]) : { rows: [null] };
    return { kind: 'photo', media, episode, clip: null, covers: rows };
  }
  if (clipId) {
    const { rows: [clip] } = await db.query('SELECT * FROM episode_clips WHERE id = $1', [clipId]);
    if (!clip) throw targetError('removido', 'Corte não encontrado.');
    if (clip.status !== 'pronto' || !clip.storage_key) throw targetError(clip.status === 'erro' ? 'recusado' : 'em_preparo', 'O corte ainda não está pronto.');
    if (clip.request_id) { // entrega de pedido (trailer, vídeo avulso): só depois de aprovada; pode não ter episódio
      const { rows: [r] } = await db.query('SELECT status FROM content_requests WHERE id = $1', [clip.request_id]);
      if (r?.status !== 'aprovado') throw targetError('recusado', 'A entrega deste pedido ainda não foi aprovada.');
    } else if (!clip.episode_id) throw targetError('recusado', 'Atribua o corte a um episódio antes de publicar.');
    const { rows: [episode] } = clip.episode_id ? await db.query('SELECT * FROM episodes WHERE id = $1', [clip.episode_id]) : { rows: [null] };
    return { kind: 'clip', episode, clip, videoKey: clip.storage_key, coverId: clip.cover_id, size: clip.size_bytes, durationMs: clip.duration_ms, mime: clip.content_type || 'video/mp4' };
  }
  const { rows: [episode] } = await db.query('SELECT * FROM episodes WHERE id = $1', [episodeId]);
  if (!episode) throw targetError('removido', 'Episódio não encontrado.');
  const { rows: [file] } = await db.query("SELECT * FROM episode_files WHERE episode_id = $1 AND kind = 'editado' AND status = 'pronto' ORDER BY version DESC LIMIT 1", [episodeId]);
  if (!file) throw targetError('em_preparo', 'Não há vídeo editado para publicar.');
  if (!['pronto_publicar', 'publicado'].includes(episode.status)) throw targetError('recusado', 'O episódio só pode ser enviado quando estiver em "Pronto para publicar".');
  const { rows: [meta] } = await db.query('SELECT thumb_cover_id FROM episode_metadata WHERE episode_id = $1', [episodeId]);
  return { kind: 'episode', episode, clip: null, videoKey: file.storage_key, coverId: meta?.thumb_cover_id || null, size: file.size_bytes, partSize: file.part_size, mime: file.content_type || 'video/mp4' };
}

// Cria a publicação (já conferida) e envia na hora, ou deixa agendada.
// review = true: quem pediu não publica direto (produtora); fica "em revisão" até a gestão aprovar ou recusar.
async function create({ episodeId, clipId = null, media = 'video', coverIds = [], platforms, title, description = '', scheduledAt = null, tags = [], userId = null, review = false, instagram = null }) {
  const target = await loadTarget({ episodeId, clipId, media, coverIds });
  const list = [...new Set(platforms || [])];
  const check = target.kind === 'photo'
    ? up.validatePhotos({ media, platforms: list, title, description, scheduledAt, count: target.covers.length })
    : up.validate({ kind: target.kind, platforms: list, title, description, scheduledAt });
  if (target.kind === 'clip') { // fora da duração de uma rede, a Outstand recusa o post inteiro: melhor dizer agora
    const d = L.checkClipDuration(list, target.durationMs, (p) => up.PLATFORMS[p]?.clipLabel || labelOf(p));
    check.issues.push(...d.issues); check.warnings.push(...d.warnings);
    if (d.issues.length) check.ok = false;
  }
  if (!check.ok) { const err = new Error(check.issues[0]); err.issues = check.issues; throw err; }
  const groups = await social.plan(list); // cada rede sai pelo provedor dela (padrão ou rota); pode haver mais de um provedor
  if (!review) {
    for (const g of groups) {
      if (!g.provider.live()) continue;
      const conn = await g.provider.connected();
      if (!conn.ok) throw new Error(`Não foi possível consultar as redes conectadas ${g.provider.at}: ${conn.error}`);
      const missing = g.platforms.filter((p) => !conn.platforms[p]);
      if (missing.length) throw new Error(`Sem conta conectada ${g.provider.at}: ${names(missing)}.`);
      const stale = [...new Set([...g.platforms.filter((p) => conn.platforms[p]?.reauth), ...await health.reauthOf(g.provider.id, g.platforms)])];
      if (stale.length) throw new Error(`Reconecte ${names(stale)} ${g.provider.at}: o acesso da conta venceu e a publicação falharia.`);
    }
  }
  const provider = groups[0].provider;
  const routesMap = groups.length > 1 ? Object.fromEntries(groups.flatMap((g) => g.platforms.map((p) => [p, g.provider.id]))) : null;
  const row = {
    episodeId: target.episode?.id || null, clipId: target.kind === 'photo' ? null : clipId, title: L.tidy(title || (target.kind === 'photo' ? MEDIA_LABEL[media] : '')),
    coverIds: target.kind === 'photo' ? target.covers.map((c) => c.id) : [],
  };
  // Clique repetido em "Publicar" (o envio leva alguns segundos enquanto o vídeo sobe): o mesmo pedido da mesma pessoa nos últimos
  // 2 minutos devolve a publicação que já existe, em vez de publicar duas vezes. A trava da transação enfileira os pedidos simultâneos.
  const client = await db.getPool().connect();
  let pub; let repeated = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`publicar:${userId || ''}:${row.clipId || ''}:${row.episodeId || ''}:${row.coverIds.join(',')}`]);
    const { rows: [same] } = await client.query(
      `SELECT * FROM episode_publications WHERE created_by IS NOT DISTINCT FROM $1 AND clip_id IS NOT DISTINCT FROM $2 AND episode_id IS NOT DISTINCT FROM $3
          AND media = $4 AND cover_ids = $5::int[] AND platforms = $6::text[] AND title = $7 AND created_at > now() - interval '2 minutes' ORDER BY id DESC LIMIT 1`,
      [userId, row.clipId, row.episodeId, media, row.coverIds, list, row.title]);
    if (same) { pub = same; repeated = true; } else {
      ({ rows: [pub] } = await client.query(
        `INSERT INTO episode_publications (episode_id, clip_id, platforms, title, description, options, cover_id, scheduled_at, status, created_by, media, cover_ids, provider)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [row.episodeId, row.clipId, list, row.title, description ? L.tidy(description) : null, JSON.stringify({ tags, warnings: check.warnings, ...(routesMap ? { routes: routesMap } : {}), ...(instagram && list.includes('instagram') && media !== 'story' ? { instagram } : {}) }),
          target.kind === 'photo' ? target.covers[0].id : target.coverId, scheduledAt || null, review ? 'revisao' : (scheduledAt ? 'agendado' : 'enviando'), userId, media, row.coverIds, provider.id]));
    }
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
  if (repeated) { console.warn(`[publicação ${pub.id}] pedido repetido em menos de 2 min: devolvi a que já existe`); return pub; }
  if (review) {
    await addEvent(target.episode?.id, userId, `Publicação enviada para revisão da gestão (${names(list)}): ${pub.title}`);
    await askReview(pub, userId);
    return pub;
  }
  await addEvent(target.episode?.id, userId, scheduledAt ? `Publicação agendada (${names(list)}): ${pub.title}` : `Publicação enviada (${names(list)}): ${pub.title}`);
  return scheduledAt ? pub : dispatch(pub.id, { trigger: 'agora' });
}

// ---------------------------------------------------------------- tentativas (observabilidade)
const startAttempt = (pubId, trigger, platforms) => db.query(
  'INSERT INTO publication_attempts (publication_id, trigger, platforms) VALUES ($1,$2,$3) RETURNING *', [pubId, trigger, platforms]).then((r) => r.rows[0]);
const noteAttempt = (attempt, fields) => db.query('UPDATE publication_attempts SET media = coalesce($2, media), refs = coalesce($3, refs) WHERE id = $1',
  [attempt.id, fields.media ? JSON.stringify(fields.media) : null, fields.refs ? JSON.stringify(fields.refs) : null]);
const openAttempt = (pubId) => db.query('SELECT * FROM publication_attempts WHERE publication_id = $1 AND finished_at IS NULL ORDER BY id DESC LIMIT 1', [pubId]).then((r) => r.rows[0] || null);

// Chave de idempotência de um envio que ficou sem resposta (as mesmas redes, no mesmo provedor, nas últimas 23 h): repetir com ela
// devolve o post que talvez já tenha sido criado, em vez de publicar duas vezes.
function keyFor(pub, g) {
  const p = pub.options?.pending_keys?.[g.provider.id];
  const same = p && p.platforms.join() === [...g.platforms].sort().join() && Date.now() - Date.parse(p.at) < 23 * 3600_000;
  return same ? p.key : `pulso-${pub.id}-${crypto.randomBytes(6).toString('hex')}`;
}
function pendingKeys(pub, outcomes) {
  const keys = { ...(pub.options?.pending_keys || {}) };
  for (const o of outcomes) {
    if (o.error?.ambiguous) keys[o.g.provider.id] = { key: o.key, platforms: [...o.g.platforms].sort(), at: new Date().toISOString() };
    else delete keys[o.g.provider.id];
  }
  return keys;
}

// Envia uma publicação pendente (agora). Falhas nunca ficam silenciosas: cada rede termina publicada, com nova tentativa marcada ou
// com o motivo e o que fazer. Cada rede sai pelo provedor dela: se forem vários, cada um recebe só as suas redes (um envio por provedor)
// e o andamento é acompanhado em cada um (options.parts). Se um provedor falhar ao enviar e outro não, a publicação segue.
// `only`: reenvia só estas redes (as que falharam); `keep`: resultados das demais, que ficam como estão.
// trigger: agora | agendado | aprovado | manual | automatico | retomado (vai para o histórico de tentativas).
async function dispatch(pubId, { only = null, keep = [], trigger = 'agora' } = {}) {
  await social.syncLive();
  const { rows: [pub] } = await db.query(
    "UPDATE episode_publications SET status = 'enviando', retry_at = NULL, request_id = NULL, job_id = NULL, attempts = attempts + 1, updated_at = now() WHERE id = $1 AND status IN ('enviando','agendado') RETURNING *", [pubId]);
  if (!pub) return null;
  const platforms = only || pub.platforms;
  const attempt = await startAttempt(pub.id, trigger, platforms);
  let outcomes = [];
  try {
    const target = await loadTarget({ episodeId: pub.episode_id, clipId: pub.clip_id, media: pub.media, coverIds: pub.cover_ids });
    // agendado/revisão: sai pelos provedores atuais na hora de enviar (a gestão pode ter trocado nesse meio-tempo)
    const groups = await social.plan(platforms);
    const planned = Object.fromEntries(groups.flatMap((g) => g.platforms.map((p) => [p, g.provider.id])));
    const routesMap = only ? { ...(pub.options?.routes || {}), ...planned } : (groups.length > 1 ? planned : null);
    const first = groups[0].provider.id;
    if (!only && first !== pub.provider) { await db.query('UPDATE episode_publications SET provider = $2 WHERE id = $1', [pub.id, first]); pub.provider = first; }
    const media = await prepareMedia(pub, target, groups); // arquivo ilegível para tudo aqui: nada vai às redes pela metade
    await noteAttempt(attempt, { media: media.info });
    for (const g of groups) {
      const key = keyFor(pub, g);
      try {
        const conn = g.provider.live() ? await g.provider.connected() : { platforms: {} };
        const sent = target.kind === 'photo'
          ? await g.provider.sendPhotos({ id: pub.id, media: pub.media, platforms: g.platforms, title: pub.title, description: pub.description, photoUrls: media.photosFor(g), accounts: conn.platforms, instagram: pub.options?.instagram || null, idempotencyKey: key })
          : await g.provider.sendVideo({
            id: pub.id, kind: target.kind, platforms: g.platforms, title: pub.title, description: pub.description, videoUrl: media.videoFor(g),
            coverUrl: target.kind === 'clip' ? media.coverFor(g) : null, thumbnailUrl: target.kind === 'episode' ? media.coverFor(g) : null, tags: pub.options?.tags || [], accounts: conn.platforms,
            instagram: pub.options?.instagram || null, durationSec: target.durationMs ? target.durationMs / 1000 : null, idempotencyKey: key,
          });
        outcomes.push({ g, sent, key });
      } catch (err) { outcomes.push({ g, error: err, key }); }
    }
    if (outcomes.every((o) => o.error)) throw outcomes[0].error; // nenhum provedor aceitou
    return await saveSent(pub, outcomes, routesMap, keep, attempt);
  } catch (err) {
    return failAttempt(pub, platforms, keep, err, attempt, outcomes);
  }
}

// ---------------------------------------------------------------- material (conferido antes de ir às redes)
const fileName = (key, fallback) => (String(key || '').split('/').pop() || fallback);

// Para cada arquivo: o link assinado do Backblaze e, para a Outstand, a cópia hospedada nela (conferida byte a byte ao subir ou
// reaproveitada). Quem não vai pela Outstand recebe o link do Backblaze depois de conferir que o arquivo inteiro está lá.
async function prepareMedia(pub, target, groups) {
  const liveGroups = groups.filter((g) => g.provider.live());
  const viaOutstand = liveGroups.some((g) => g.provider.id === 'outstand');
  const others = liveGroups.some((g) => g.provider.id !== 'outstand');
  const info = { files: [] };
  const sign = (key) => b2.presignGet(key, { expires: up.MAX_LINK_SECONDS });
  // host: sobe para a Outstand (arquivo pequeno); needB2: algum provedor vai buscar no Backblaze e o arquivo não foi lido agora
  async function one(key, { size = null, partSize = null, mime, label, host }) {
    const b2Url = await sign(key);
    const row = { arquivo: label, bytes: size ? Number(size) : null };
    let hostedUrl = null; let proven = false;
    if (host && viaOutstand) {
      const h = await ost.hosted(key, { sourceUrl: b2Url, filename: fileName(key, label), contentType: mime, size });
      hostedUrl = h.url; proven = !h.reused;
      Object.assign(row, { onde: 'outstand', reaproveitado: h.reused, ms: h.ms, bytes: h.bytes || row.bytes });
    }
    if (liveGroups.length && (others || !hostedUrl) && !proven) {
      const c = await mediaCheck.verify(key, { size: mime.startsWith('video/') ? size : null, partSize });
      Object.assign(row, { conferido: c.mode, ms_conferencia: c.ms, bytes: c.bytes || row.bytes });
    }
    if (liveGroups.length) info.files.push(row);
    return { b2Url, hostedUrl };
  }
  const pick = (f) => (g) => (g.provider.id === 'outstand' && f?.hostedUrl ? f.hostedUrl : f?.b2Url || null);
  if (target.kind === 'photo') {
    const files = [];
    for (const [i, c] of target.covers.entries()) files.push(await one(c.storage_key, { mime: c.mime || 'image/jpeg', label: `imagem ${i + 1}`, host: true }));
    return { info, photosFor: (g) => files.map((f) => pick(f)(g)) };
  }
  const video = await one(target.videoKey, { size: target.size, partSize: target.partSize, mime: target.mime || 'video/mp4', label: target.kind === 'episode' ? 'episódio' : 'vídeo', host: target.kind === 'clip' });
  let cover = null;
  if (pub.cover_id) { // capa ilegível não segura o vídeo: sai sem ela (a rede usa um quadro do vídeo) e fica registrado
    const { rows: [cv] } = await db.query('SELECT storage_key, mime FROM episode_covers WHERE id = $1', [pub.cover_id]);
    if (cv) {
      try { cover = await one(cv.storage_key, { mime: cv.mime || 'image/jpeg', label: 'capa', host: true }); } catch (err) {
        if (err.code !== 'arquivo_indisponivel' && err.code !== 'arquivo_sumiu' && err.code !== 'arquivo_incompleto') throw err;
        info.files.push({ arquivo: 'capa', erro: String(err.message).slice(0, 200) });
        console.warn(`[publicação ${pub.id}] capa ilegível, sai sem ela: ${err.message}`);
      }
    }
  }
  return { info, videoFor: pick(video), coverFor: pick(cover) };
}

// ---------------------------------------------------------------- resultado de cada tentativa
// Junta o que cada provedor respondeu: resultados (com o provedor de cada rede), onde acompanhar cada envio e o que falhou ao enviar.
async function saveSent(pub, outcomes, routesMap, keep, attempt) {
  const results = [...keep]; const parts = []; const sendErrors = []; const warnings = []; const fields = new Set();
  const failRow = (p, pid, msg, code) => ({ platform: p, ok: false, skipped: false, status: 'failed', url: null, error: msg, code: code || null, provider: pid });
  for (const o of outcomes) {
    const pid = o.g.provider.id;
    if (o.error) {
      const msg = String(o.error.message).slice(0, 300);
      for (const p of o.g.platforms) { sendErrors.push({ platform: p, provider: pid, error: msg, code: o.error.code || null }); results.push(failRow(p, pid, msg, o.error.code)); }
      continue;
    }
    const s = o.sent;
    results.push(...(s.results || []).map((r) => ({ ...r, provider: pid })));
    for (const f of s.preFailed || []) sendErrors.push({ platform: f.platform, provider: pid, error: String(f.error).slice(0, 300), code: f.code || null });
    (s.fieldNames || []).forEach((f) => fields.add(f));
    warnings.push(...(s.warnings || []));
    if (!s.simulated) parts.push({ provider: pid, request_id: s.request_id || null, job_id: s.job_id || null, platforms: o.g.platforms, done: Boolean(s.done) });
  }
  const real = results.filter((r) => !r.simulated);
  let state;
  if (!parts.length) state = sendErrors.length ? (keep.some((r) => r.ok) ? 'parcial' : 'erro') : 'simulado'; // nada foi realmente enviado
  else if (outcomes.every((o) => o.error || o.sent.simulated || o.sent.done)) state = finalState(real);
  else state = 'enviando';
  const first = parts[0] || {};
  const options = {
    fields: [...fields], pending_keys: pendingKeys(pub, outcomes), ...(routesMap ? { routes: routesMap } : {}), ...(parts.length || keep.length ? { parts } : {}),
    ...(keep.length ? { kept_results: keep } : {}), ...(sendErrors.length ? { send_errors: sendErrors } : {}), ...(warnings.length ? { provider_warnings: warnings } : {}),
  };
  const { rows: [saved] } = await db.query(
    `UPDATE episode_publications SET status = $2, request_id = $3, job_id = $4, results = $5, options = (options - 'kept_results' - 'send_errors' - 'parts' - 'provider_warnings') || $6, error = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
    [pub.id, state, first.request_id || null, first.job_id || null, JSON.stringify(results), JSON.stringify(options)]);
  await noteAttempt(attempt, { refs: parts.map((p) => ({ provider: p.provider, request_id: p.request_id })) });
  if (state === 'simulado') { await finishAttempt(attempt, results); return saved; }
  if (state !== 'enviando') return finalize(saved, results, attempt);
  return saved;
}

// A tentativa falhou antes de chegar às redes (arquivo ilegível, provedor fora) ou todos os provedores recusaram: cada rede desta
// tentativa fica com o erro do provedor dela (ou o erro geral), classificado; as demais ficam como estavam.
async function failAttempt(pub, platforms, keep, err, attempt, outcomes = []) {
  const byPlatform = {};
  for (const o of outcomes) for (const p of o.g.platforms) byPlatform[p] = { e: o.error || err, provider: o.g.provider.id };
  const routes = pub.options?.routes || {};
  const rows = platforms.map((p) => {
    const { e = err, provider = routes[p] || pub.provider } = byPlatform[p] || {};
    const pre = (e.preFailed || []).find((f) => f.platform === p);
    return { platform: p, ok: false, skipped: false, status: 'failed', url: null, error: String(pre?.error || e.message).slice(0, 300), code: pre?.code || e.code || null, provider };
  });
  const results = [...keep.filter((r) => !platforms.includes(r.platform)), ...rows];
  await db.query("UPDATE episode_publications SET options = (options - 'parts' - 'send_errors' - 'kept_results') || $2, updated_at = now() WHERE id = $1",
    [pub.id, JSON.stringify({ pending_keys: pendingKeys(pub, outcomes), ...(keep.length ? { kept_results: keep } : {}) })]);
  await db.query('UPDATE publication_attempts SET error = $2 WHERE id = $1', [attempt.id, String(err.message).slice(0, 500)]);
  console.warn(`[publicação ${pub.id}] tentativa ${attempt.id} (${attempt.trigger}) não chegou às redes: ${mediaCheck.cause(err)}`);
  const { rows: [fresh] } = await db.query('SELECT * FROM episode_publications WHERE id = $1', [pub.id]);
  return finalize(fresh, results, attempt);
}

const finishAttempt = (attempt, results) => (!attempt ? Promise.resolve() : db.query(
  'UPDATE publication_attempts SET finished_at = now(), outcome = $2 WHERE id = $1 AND finished_at IS NULL',
  [attempt.id, JSON.stringify(results.filter((r) => attempt.platforms.includes(r.platform)).map((r) => ({ platform: r.platform, ok: Boolean(r.ok), code: r.code || null, error: r.ok ? null : r.error || null, retry_at: r.retry_at || null, provider: r.provider || null })))]));

// O resultado desta tentativa é final: classifica o erro de cada rede que falhou (código, frase, nova tentativa ou ação), grava o
// estado, fecha a tentativa e avisa quem precisa saber (uma vez).
async function finalize(pub, results, attempt) {
  const inAttempt = attempt ? attempt.platforms : pub.platforms;
  const tries = { ...(pub.options?.tries || {}) };
  const out = results.map((r) => {
    if (!inAttempt.includes(r.platform) || r.simulated || r.skipped) return r;
    const n = (tries[r.platform] || 0) + 1; tries[r.platform] = n;
    if (r.ok) return { ...r, code: null, hint: null, retry_at: null, tries: n };
    const c = E.classify(r.error, { code: r.code, tries: n });
    return { ...r, code: c.code, hint: E.sentence(c, n), retry_at: c.retryAt ? c.retryAt.toISOString() : null, action: !c.retryAt, tries: n };
  });
  const real = out.filter((r) => !r.simulated);
  const state = finalState(real);
  const retryAt = E.nextRetry(out);
  const firstFail = out.find((r) => !r.ok && !r.skipped);
  const error = state === 'erro' ? ([firstFail?.hint, firstFail?.error && `(${firstFail.error})`].filter(Boolean).join(' ') || 'O envio falhou.').slice(0, 600) : null;
  const { rows: [saved] } = await db.query(
    "UPDATE episode_publications SET status = $2, results = $3, retry_at = $4, error = $5, options = options || $6, updated_at = now() WHERE id = $1 RETURNING *",
    [pub.id, state, JSON.stringify(out), retryAt, error, JSON.stringify({ tries })]);
  await finishAttempt(attempt, out);
  const failed = out.filter((r) => inAttempt.includes(r.platform) && !r.ok && !r.skipped);
  if (failed.length) console.warn(`[publicação ${pub.id}] ${failed.map((r) => `${r.platform}: ${r.code}${r.retry_at ? ` → nova tentativa ${r.retry_at}` : ' → precisa de ação'} (${String(r.error).slice(0, 160)})`).join(' | ')}`);
  await tell(saved, out, failed, { inAttempt, auto: attempt?.trigger === 'automatico' });
  return saved;
}

const MEDIA_LABEL = { video: 'Vídeo', imagem: 'Post', carrossel: 'Carrossel', story: 'Story' };

function finalState(results) {
  const real = results.filter((r) => !r.skipped);
  if (!real.length) return 'erro';
  if (real.every((r) => r.ok)) return 'publicado';
  return real.some((r) => r.ok) ? 'parcial' : 'erro';
}

// ---------------------------------------------------------------- avisos
// Quem pediu a publicação sabe quando saiu (e por onde) e quando vai tentar de novo; quem pediu e a gestão sabem quando precisa de ação.
// Cada aviso sai uma vez por publicação (dedupe), não a cada tentativa; a linha do tempo do episódio ganha só o que mudou.
async function tell(pub, results, failed, { inAttempt = pub.platforms, auto = false } = {}) {
  const ok = results.filter((r) => r.ok && !r.simulated);
  const newlyOk = ok.filter((r) => inAttempt.includes(r.platform));
  const waiting = results.filter((r) => !r.ok && r.retry_at);
  const action = failed.filter((r) => r.action);
  if (ok.length && !waiting.length) { if (newlyOk.length) await afterPublished(pub, results); } else if (newlyOk.length) await addEvent(pub.episode_id, pub.created_by, `Publicado em ${names(newlyOk.map((r) => r.platform))}: ${pub.title}`);
  if (waiting.length && failed.some((r) => r.retry_at)) {
    if (!auto) await addEvent(pub.episode_id, pub.created_by, `Falha passageira em ${names(waiting.map((r) => r.platform))}: nova tentativa automática às ${E.hhmm(new Date(pub.retry_at))}.`);
    await tellCreator(pub, `Tentando de novo: ${pub.title}`, `${ok.length ? `Já saiu em ${names(ok.map((r) => r.platform))}. ` : ''}${waiting.map((r) => `${labelOf(r.platform)}: ${r.hint}`).join(' ')}`, `pub-${pub.id}-tentando`);
  }
  for (const r of action) {
    await addEvent(pub.episode_id, pub.created_by, `Falha ao publicar em ${labelOf(r.platform)}: ${r.hint}`);
    await alertTeam(pub, `Precisa de ação: ${pub.title}`, `${labelOf(r.platform)}: ${r.hint}`, `pub-${pub.id}-acao-${r.platform}-${r.code}`);
  }
}

// Saiu em todas as redes que restavam: guarda o link do YouTube no episódio (só se estiver vazio) e avisa quem pediu.
async function afterPublished(pub, results = pub.results || []) {
  const okList = results.filter((r) => r.ok).map((r) => r.platform);
  if (!pub.clip_id && pub.media === 'video') {
    const yt = results.find((r) => r.platform === 'youtube' && r.ok && /^https?:\/\//.test(r.url || ''));
    if (yt) await db.query("UPDATE episodes SET youtube_url = $2, updated_at = now() WHERE id = $1 AND coalesce(youtube_url, '') = ''", [pub.episode_id, yt.url]);
  }
  await addEvent(pub.episode_id, pub.created_by, `Publicado: ${pub.title}`);
  await tellCreator(pub, `Publicado: ${pub.title}`, `${okList.join(', ')}${pub.attempts > 1 ? ` (depois de ${pub.attempts} tentativas)` : ''}`);
}

// Rotina do sistema: avisa quem pediu a publicação.
async function tellCreator(pub, title, body, dedupe = null) {
  await require('./notify').notify({ type: 'rotina', users: [pub.created_by], title, body, url: `/social/publicacoes/${pub.id}`, entity: { type: pub.clip_id ? 'clip' : 'episode', id: pub.clip_id || pub.episode_id }, dedupe: dedupe || `pub-${pub.id}-${title.slice(0, 20)}` }).catch((err) => console.error('Aviso de publicação:', err.message));
}
// Precisa de ação: quem pediu e a gestão (que cuida das contas e do provedor).
async function alertTeam(pub, title, body, dedupe) {
  const { rows } = await db.query("SELECT id FROM users WHERE active AND role IN ('superadmin','gestao')");
  await require('./notify').notify({ type: 'rotina', users: [pub.created_by, ...rows.map((r) => r.id)], title, body, url: `/social/publicacoes/${pub.id}`, entity: { type: 'publication', id: pub.id }, dedupe }).catch((err) => console.error('Aviso de publicação:', err.message));
}

// ---------------------------------------------------------------- andamento
// Atualiza o andamento de um envio que está no provedor (o mesmo pelo qual saiu; cada provedor, se foram vários).
async function refresh(pubId) {
  const { rows: [pub] } = await db.query('SELECT * FROM episode_publications WHERE id = $1', [pubId]);
  if (!pub || pub.status !== 'enviando' || !(pub.request_id || pub.job_id)) return pub || null;
  const parts = pub.options?.parts?.length ? pub.options.parts : [{ provider: pub.provider, request_id: pub.request_id, job_id: pub.job_id, platforms: pub.platforms }];
  try {
    const sts = [];
    for (const part of parts) sts.push({ part, st: await social.get(part.provider).status({ request_id: part.request_id, job_id: part.job_id }) });
    const sendErrors = pub.options?.send_errors || [];
    const kept = pub.options?.kept_results || []; // o que já tinha saído antes de um reenvio parcial
    const errNets = new Set(sendErrors.map((e) => e.platform));
    let results = [
      ...kept,
      ...sts.flatMap(({ part, st }) => (st.results || []).filter((r) => !errNets.has(r.platform)).map((r) => ({ ...r, provider: part.provider }))),
      ...sendErrors.map((e) => ({ platform: e.platform, ok: false, skipped: false, status: 'failed', url: null, error: e.error, code: e.code || null, provider: e.provider })),
      ...(pub.results || []).filter((r) => r.simulated),
    ];
    if (!results.length) results = pub.results || [];
    let state;
    const states = sts.map(({ st }) => st.state);
    if (states.includes('enviando')) state = 'enviando';
    else state = finalState(results.filter((r) => !r.simulated));
    if (state === 'enviando') {
      const { rows: [saved] } = await db.query('UPDATE episode_publications SET results = $2, updated_at = now() WHERE id = $1 RETURNING *', [pub.id, JSON.stringify(results)]);
      return saved;
    }
    // provedor que não achou o post (404) e não trouxe resultado por rede: as redes dele ficam com o motivo
    for (const { part, st } of sts) {
      if (st.state !== 'erro' || (st.results || []).length) continue;
      for (const p of part.platforms) {
        const row = results.find((r) => r.platform === p);
        if (!row) results.push({ platform: p, ok: false, skipped: false, status: 'failed', url: null, error: st.error || 'O envio falhou.', provider: part.provider });
        else if (!row.ok && !row.error) Object.assign(row, { status: 'failed', error: st.error || 'O envio falhou.' });
      }
    }
    const attempt = await openAttempt(pub.id);
    const final = await finalize(pub, results, attempt);
    if (results.some((r) => !r.ok && /download|fetch|media|video/i.test(String(r.error || '')))) await forgetHostedOf(pub);
    return final;
  } catch (err) {
    console.error(`[publicação ${pub.id}] não consegui consultar o status:`, err.message);
    return pub;
  }
}

// Se a rede não conseguiu baixar a cópia hospedada na Outstand, a próxima tentativa sobe o arquivo de novo.
async function forgetHostedOf(pub) {
  const keys = [];
  if (pub.clip_id) { const { rows: [c] } = await db.query('SELECT storage_key FROM episode_clips WHERE id = $1', [pub.clip_id]); if (c) keys.push(c.storage_key); }
  if (keys.length) await ost.forgetHosted(keys).catch(() => {});
}

// ---------------------------------------------------------------- rotina (a cada 30 s, uma réplica por vez)
// Envia o que está agendado e vencido; faz as novas tentativas marcadas; atualiza o que está em andamento; retoma envio interrompido;
// encerra o que ficou sem resposta; e confere antes o material dos agendados das próximas horas (avisa cedo se o arquivo estiver ruim).
// A reserva é atômica (com SKIP LOCKED): o mesmo agendamento ou nova tentativa nunca sai duas vezes.
async function tick() {
  await social.syncLive(); // o worker também respeita a chave de Integrações
  const { rows: due } = await db.query(
    `UPDATE episode_publications SET status = 'enviando', updated_at = now()
      WHERE id IN (SELECT id FROM episode_publications WHERE status = 'agendado' AND scheduled_at <= now() ORDER BY scheduled_at LIMIT 10 FOR UPDATE SKIP LOCKED)
      RETURNING id`);
  for (const p of due) await dispatch(p.id, { trigger: 'agendado' });
  await retryDue();
  const { rows: running } = await db.query("SELECT id FROM episode_publications WHERE status = 'enviando' AND (request_id IS NOT NULL OR job_id IS NOT NULL) AND updated_at < now() - interval '10 seconds' ORDER BY id LIMIT 20");
  for (const p of running) await refresh(p.id);
  await recoverInterrupted();
  await giveUpSilent();
  await precheckScheduled();
}

// Novas tentativas marcadas que venceram: reenvia só as redes cuja hora chegou (as outras seguem esperando a delas).
async function retryDue({ limit = 3 } = {}) {
  const { rows } = await db.query(
    `WITH picked AS (SELECT id, status FROM episode_publications WHERE status IN ('erro','parcial') AND retry_at <= now() ORDER BY retry_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     UPDATE episode_publications p SET status = 'enviando', retry_at = NULL, updated_at = now() FROM picked WHERE p.id = picked.id RETURNING p.*, picked.status AS prev_status`, [limit]);
  const out = [];
  for (const pub of rows) {
    const results = pub.results || [];
    const now = Date.now();
    const dueNets = results.filter((r) => !r.ok && r.retry_at && Date.parse(r.retry_at) <= now).map((r) => r.platform);
    if (!dueNets.length) { // nada venceu de fato (horário mudou): devolve como estava
      await db.query('UPDATE episode_publications SET status = $2, retry_at = $3 WHERE id = $1', [pub.id, pub.prev_status, E.nextRetry(results)]);
      continue;
    }
    const keep = results.filter((r) => !dueNets.includes(r.platform));
    out.push(await dispatch(pub.id, { only: dueNets, keep, trigger: 'automatico' }));
  }
  return out;
}

// Envio interrompido (o processo reiniciou no meio da preparação): a tentativa aberta há mais de 20 min sem post no provedor vira
// falha passageira e volta em 1 minuto.
async function recoverInterrupted() {
  const { rows } = await db.query(
    `SELECT p.*, a.id AS a_id FROM episode_publications p
       LEFT JOIN LATERAL (SELECT * FROM publication_attempts WHERE publication_id = p.id ORDER BY id DESC LIMIT 1) a ON true
      WHERE p.status = 'enviando' AND p.request_id IS NULL AND p.job_id IS NULL
        AND (a.id IS NULL OR a.finished_at IS NULL) AND coalesce(a.started_at, p.updated_at) < now() - interval '20 minutes'
      ORDER BY p.id LIMIT 5`);
  for (const pub of rows) {
    const attempt = pub.a_id ? (await db.query('SELECT * FROM publication_attempts WHERE id = $1', [pub.a_id])).rows[0] : null;
    const nets = attempt ? attempt.platforms : pub.platforms;
    const kept = (pub.options?.kept_results || []).filter((r) => !nets.includes(r.platform));
    const results = [...kept, ...nets.map((p) => ({ platform: p, ok: false, skipped: false, status: 'failed', url: null, error: 'O envio foi interrompido antes de chegar às redes.', code: 'interrompido', provider: pub.options?.routes?.[p] || pub.provider }))];
    console.warn(`[publicação ${pub.id}] envio interrompido: volta para nova tentativa`);
    await finalize(pub, results, attempt);
  }
}

// Sem resposta do provedor por 2 dias: as redes que seguem "enviando" ficam com o motivo e pedem ação (não reenvia às cegas).
async function giveUpSilent() {
  const { rows } = await db.query(
    `SELECT p.* FROM episode_publications p
      WHERE p.status = 'enviando' AND (p.request_id IS NOT NULL OR p.job_id IS NOT NULL)
        AND (SELECT max(started_at) FROM publication_attempts a WHERE a.publication_id = p.id) < now() - interval '48 hours'
      LIMIT 5`);
  for (const pub of rows) {
    const results = (pub.results || []).map((r) => (r.ok || r.status === 'failed' ? r : { ...r, ok: false, status: 'failed', error: 'O provedor não respondeu sobre este envio por mais de 2 dias.', code: 'sem_resposta' }));
    await finalize(pub, results, await openAttempt(pub.id));
  }
}

// Agendados das próximas 3 h: confere (e hospeda, na Outstand) o material uma vez por hora, um por volta. Se o arquivo estiver ruim,
// avisa já, e não só na hora de publicar.
async function precheckScheduled() {
  const { rows: [pub] } = await db.query(
    `SELECT * FROM episode_publications WHERE status = 'agendado' AND scheduled_at <= now() + interval '3 hours'
        AND coalesce((options->'precheck'->>'at')::timestamptz, 'epoch') < now() - interval '1 hour'
      ORDER BY scheduled_at LIMIT 1`);
  if (!pub) return null;
  const precheck = { at: new Date().toISOString(), ok: true };
  try {
    const target = await loadTarget({ episodeId: pub.episode_id, clipId: pub.clip_id, media: pub.media, coverIds: pub.cover_ids });
    const groups = await social.plan(pub.platforms);
    if (groups.some((g) => g.provider.live())) await prepareMedia(pub, target, groups);
  } catch (err) {
    Object.assign(precheck, { ok: false, error: String(err.message).slice(0, 300), code: err.code || null });
    const c = E.classify(err.message, { code: err.code });
    console.warn(`[publicação ${pub.id}] conferência antes do horário: ${err.message}`);
    await alertTeam(pub, `Atenção antes de publicar: ${pub.title}`, `Agendado para ${E.hhmm(new Date(pub.scheduled_at))}. ${c.hint}. Conferimos de novo a cada hora${c.terminal ? '' : '; se continuar, envie o arquivo de novo'}.`, `pub-${pub.id}-confere-${new Date().toISOString().slice(0, 10)}`);
  }
  await db.query("UPDATE episode_publications SET options = options || $2 WHERE id = $1", [pub.id, JSON.stringify({ precheck })]);
  return precheck;
}

// "Mandar de novo" (pedido por alguém): reenvia as redes que falharam (numa publicação parcial, as que saíram ficam como estão), já,
// e zera a contagem de tentativas delas.
async function retry(pubId) {
  const { rows: [cur] } = await db.query("SELECT * FROM episode_publications WHERE id = $1 AND status IN ('parcial','erro')", [pubId]);
  if (!cur) return null;
  const results = cur.results || [];
  const failed = results.filter((r) => !r.ok && !r.skipped).map((r) => r.platform);
  const targets = [...new Set([...failed, ...cur.platforms.filter((p) => !results.some((r) => r.platform === p))])];
  if (!targets.length) return null;
  const tries = { ...(cur.options?.tries || {}) }; for (const p of targets) tries[p] = 0;
  const { rows: [claimed] } = await db.query(
    "UPDATE episode_publications SET status = 'enviando', error = NULL, retry_at = NULL, options = (options - 'parts' - 'send_errors' - 'provider_warnings' - 'kept_results') || $2, updated_at = now() WHERE id = $1 AND status IN ('parcial','erro') RETURNING *",
    [pubId, JSON.stringify({ tries })]);
  if (!claimed) return null;
  const keep = results.filter((r) => !targets.includes(r.platform));
  return dispatch(claimed.id, { only: keep.length ? targets : null, keep, trigger: 'manual' });
}

// Parar as novas tentativas automáticas (a equipe resolve por fora ou desiste): a publicação fica como está, com o motivo.
async function stopRetries(pubId) {
  const { rows: [pub] } = await db.query('SELECT * FROM episode_publications WHERE id = $1 AND retry_at IS NOT NULL', [pubId]);
  if (!pub) return null;
  const results = (pub.results || []).map((r) => (r.retry_at ? { ...r, retry_at: null, action: true, hint: `${E.classify(r.error, { code: r.code }).hint}. Novas tentativas automáticas paradas: reenvie quando quiser.` } : r));
  const { rows: [saved] } = await db.query('UPDATE episode_publications SET retry_at = NULL, results = $2, updated_at = now() WHERE id = $1 RETURNING *', [pub.id, JSON.stringify(results)]);
  return saved;
}

async function cancel(pubId) {
  const { rows: [pub] } = await db.query("DELETE FROM episode_publications WHERE id = $1 AND status IN ('agendado','revisao','recusado') RETURNING *", [pubId]);
  if (pub) await addEvent(pub.episode_id, null, pub.status === 'agendado' ? `Agendamento cancelado: ${pub.title}` : `Pedido de publicação retirado: ${pub.title}`);
  return pub || null;
}

// Histórico de tentativas de uma publicação (mais recente primeiro).
const attemptsOf = (pubId, limit = 20) => db.query('SELECT * FROM publication_attempts WHERE publication_id = $1 ORDER BY id DESC LIMIT $2', [pubId, limit]).then((r) => r.rows);

// ---------------------------------------------------------------- revisão da gestão (post pedido pela produtora)
const notify = (args) => require('./notify').notify(args).catch((err) => console.error('Aviso de publicação:', err.message));
async function askReview(pub, userId) {
  const { rows: who } = await db.query("SELECT id FROM users WHERE active AND role IN ('superadmin','gestao')");
  const { rows: [u] } = userId ? await db.query('SELECT name FROM users WHERE id = $1', [userId]) : { rows: [] };
  await notify({
    type: 'tarefa', users: who.map((r) => r.id), actorId: userId, title: `Post para aprovar: ${pub.title}`,
    body: `${u ? u.name : 'Alguém da equipe'} pediu para publicar (${names(pub.platforms)})${pub.scheduled_at ? ' em ' + new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(pub.scheduled_at) : ''}.`,
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
  const final = pub.status === 'enviando' ? await dispatch(pub.id, { trigger: 'aprovado' }) : pub;
  await notify({
    type: 'tarefa', users: [pub.created_by], actorId: reviewer.id, title: `Post aprovado: ${pub.title}`,
    body: final.status === 'agendado' ? 'Aprovado e agendado.' : final.status === 'simulado' ? 'Aprovado (modo de teste: nada foi enviado às redes).' : final.status === 'erro' ? `Aprovado, mas ainda não saiu: ${final.error}` : 'Aprovado e enviado às redes.',
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

module.exports = { loadTarget, create, dispatch, refresh, tick, retry, retryDue, stopRetries, recoverInterrupted, precheckScheduled, attemptsOf, cancel, approve, reject, resubmit, finalState, MEDIA_LABEL };
