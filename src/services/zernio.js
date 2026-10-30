// Zernio (https://docs.zernio.com): alternativa ao Upload-Post para publicar nas redes. API REST com chave Bearer.
// SEGURANÇA: sem ZERNIO_LIVE=true nada sai daqui. O pedido é montado e conferido igual, mas marcado como "simulado".
// O vídeo e as imagens vão por link assinado do Backblaze (a Zernio baixa de lá). O envio é agendado para daqui a 1 minuto, e não
// publicado na mesma chamada: um episódio de 1 h levaria a requisição ao limite; o andamento é consultado depois (status).
const crypto = require('crypto');
const config = require('../config');
const L = require('./platformLimits');

// Nomes das redes no painel -> na Zernio (o X lá se chama "twitter").
const TO_ZERNIO = { youtube: 'youtube', tiktok: 'tiktok', instagram: 'instagram', facebook: 'facebook', threads: 'threads', linkedin: 'linkedin', x: 'twitter' };
const FROM_ZERNIO = Object.fromEntries(Object.entries(TO_ZERNIO).map(([k, v]) => [v, k]));

const api = (path) => `${config.zernio.base}${path}`;
const headers = (extra = {}) => ({ Authorization: `Bearer ${config.zernio.key}`, Accept: 'application/json', ...extra });
// code (ver publishErrors): chave (401/403) pede ação; 5xx é passageiro; 400/422 é o pedido recusado.
const CODE_OF = (s) => (s === 401 || s === 403 ? 'provedor_chave' : s >= 500 ? 'provedor_fora' : s === 400 || s === 422 ? 'recusado' : undefined);
const fail = (res, json) => Object.assign(new Error(`Zernio recusou (${res.status}): ${json.error || json.message || json.code || 'erro desconhecido'}`), { status: res.status, code: CODE_OF(res.status) });

// Com Idempotency-Key, a Zernio devolve o mesmo post por 24 h: 5xx e queda de rede repetem com a MESMA chave (nunca duplica), e o
// 409 "idempotency_conflict" (o primeiro pedido ainda está sendo salvo) espera o Retry-After. Sem resposta = ambíguo (ver outstand.call).
async function call(method, path, { body = null, idempotency = null, timeout = 30_000, retries = 0 } = {}) {
  if (!config.zernioConfigured) throw new Error('ZERNIO_API_KEY não configurada.');
  let last;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(api(path), {
        method, headers: headers({ ...(body ? { 'Content-Type': 'application/json' } : {}), ...(idempotency ? { 'Idempotency-Key': idempotency } : {}) }),
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout),
      });
      const json = await res.json().catch(() => ({}));
      const conflict = res.status === 409 && json.code === 'idempotency_conflict';
      if ((res.status >= 500 || conflict) && attempt < retries) {
        last = Object.assign(fail(res, json), { ambiguous: Boolean(idempotency) });
        if (conflict) await new Promise((r) => setTimeout(r, Math.min(10, Number(res.headers.get('retry-after')) || 2) * 1000));
        continue;
      }
      if (!res.ok && res.status !== 207) throw Object.assign(fail(res, json), { ambiguous: Boolean(idempotency) && (res.status >= 500 || conflict) });
      return { status: res.status, json };
    } catch (err) {
      if (err.status) throw err;
      last = Object.assign(new Error(`Zernio sem resposta: ${require('./mediaCheck').cause(err)}`), { code: 'provedor_fora', ambiguous: Boolean(idempotency) });
      if (attempt >= retries) throw last;
    }
  }
  throw last;
}

let cache = { at: 0, value: null };
// Contas conectadas (só leitura), no formato do painel: { youtube: { handle, name, reauth, accountId } }. Guarda 60 s.
async function connected({ force = false } = {}) {
  if (!config.zernioConfigured) return { ok: false, platforms: {}, error: 'ZERNIO_API_KEY não configurada.' };
  if (!force && cache.value && Date.now() - cache.at < 60_000) return cache.value;
  let value;
  try {
    const qs = new URLSearchParams({ limit: '100', ...(config.zernio.profileId ? { profileId: config.zernio.profileId } : {}) });
    const { json } = await call('GET', `/v1/accounts?${qs}`, { timeout: 10_000 });
    const platforms = {};
    for (const acc of json.accounts || []) {
      const ours = FROM_ZERNIO[acc.platform];
      if (!ours || acc.isActive === false || platforms[ours]) continue; // uma conta por rede: a primeira ativa
      platforms[ours] = { handle: acc.username || acc.displayName || '', name: acc.displayName || '', reauth: Boolean(acc.needsReconnection), accountId: acc._id, capabilities: [] };
    }
    value = { ok: true, platforms };
  } catch (err) {
    value = { ok: false, platforms: {}, error: err.message };
  }
  cache = { at: Date.now(), value };
  return value;
}
const resetCache = () => { cache = { at: 0, value: null }; };

// Opções de cada rede (platformSpecificData) e o texto de cada uma.
function platformEntry(p, { kind, media, title, description, coverUrl, accounts, instagram = null }) {
  const entry = { platform: TO_ZERNIO[p], accountId: accounts[p]?.accountId || null };
  const caption = description || title;
  const psd = {};
  if (p === 'youtube') {
    Object.assign(psd, { title: L.fitWords(title, L.LIMITS.youtube.title.max), visibility: 'public', madeForKids: false, categoryId: '22' });
    if (description) entry.customContent = description;
  } else if (p === 'instagram') {
    if (media === 'story') psd.contentType = 'story';
    else if (kind !== 'photo') { psd.shareToFeed = true; if (coverUrl) psd.instagramThumbnail = coverUrl; }
    if (media !== 'story') Object.assign(psd, require('./igPeople').zernioData(instagram, { photo: kind === 'photo' })); // collab e marcação
    entry.customContent = caption;
  } else if (p === 'tiktok') {
    Object.assign(psd, { privacyLevel: 'PUBLIC_TO_EVERYONE', allowComment: true, contentPreviewConfirmed: true, expressConsentGiven: true });
    if (kind !== 'photo' && coverUrl) psd.videoCoverImageUrl = coverUrl;
    entry.customContent = caption;
  } else if (p === 'facebook') {
    if (kind !== 'photo') psd.contentType = 'reel';
    entry.customContent = caption;
  } else entry.customContent = L.fitText(caption, p); // X (280) e Threads (500): a versão que cabe, sem cortar palavra
  if (Object.keys(psd).length) entry.platformSpecificData = psd;
  return entry;
}

// Corpo do POST /v1/posts para um vídeo (episódio ou corte). idempotencyKey: a de um envio anterior sem resposta (repete sem duplicar).
function buildPost({ id, kind, platforms, title, description, videoUrl, coverUrl, thumbnailUrl, tags = [], accounts = {}, instagram = null, idempotencyKey = null }) {
  const video = { type: 'video', url: videoUrl };
  if (kind === 'episode' && thumbnailUrl) video.thumbnail = thumbnailUrl; // capa do YouTube (vídeo longo); Shorts não aceitam
  return {
    title, content: description || title, mediaItems: [video],
    platforms: platforms.map((p) => platformEntry(p, { kind, title, description, coverUrl: kind === 'clip' ? coverUrl : null, accounts, instagram })),
    scheduledFor: new Date(Date.now() + 60_000).toISOString(), timezone: 'America/Sao_Paulo',
    tags: tags.slice(0, 30), metadata: { pulso_publicacao: String(id) },
    idempotency: idempotencyKey || `pulso-${id}-${crypto.randomBytes(4).toString('hex')}`,
  };
}

// Imagens: post (1), carrossel (2 a 10) ou story (só Instagram).
function buildPhotoPost({ id, media, platforms, title, description, photoUrls, accounts = {}, instagram = null, idempotencyKey = null }) {
  return {
    title: title || '', content: media === 'story' ? '' : (description || title || ''), mediaItems: photoUrls.map((url) => ({ type: 'image', url })),
    platforms: platforms.map((p) => platformEntry(p, { kind: 'photo', media, title, description, accounts, instagram })),
    scheduledFor: new Date(Date.now() + 60_000).toISOString(), timezone: 'America/Sao_Paulo', metadata: { pulso_publicacao: String(id) },
    idempotency: idempotencyKey || `pulso-${id}-${crypto.randomBytes(4).toString('hex')}`,
  };
}

// Resultados por rede no formato do painel (o mesmo do Upload-Post).
const STATES = { published: 'completed', failed: 'failed', cancelled: 'failed' };
function normalizeResults(post) {
  return (post?.platforms || []).map((p) => ({
    platform: FROM_ZERNIO[p.platform] || p.platform, ok: p.status === 'published', skipped: false,
    status: STATES[p.status] || 'processing', url: p.platformPostUrl || null, post_id: p.platformPostId || null,
    error: ['failed', 'cancelled'].includes(p.status) ? (p.errorMessage || 'falhou') : null,
  }));
}

// Envia. Devolve { simulated, request_id (id do post na Zernio), results, done, fieldNames }. Sem ZERNIO_LIVE não chama nada.
async function send(body) {
  const { idempotency, ...payload } = body;
  const names = Object.keys(payload);
  const plats = payload.platforms.map((e) => FROM_ZERNIO[e.platform] || e.platform);
  if (!config.zernio.live) return { simulated: true, status: 'simulado', fieldNames: names, results: plats.map((p) => ({ platform: p, ok: true, simulated: true, status: 'simulado', url: null, error: null })) };
  const missing = payload.platforms.filter((e) => !e.accountId).map((e) => FROM_ZERNIO[e.platform] || e.platform);
  if (missing.length) throw Object.assign(new Error(`Sem conta conectada na Zernio: ${missing.join(', ')}.`), { code: 'sem_conta' });
  const { json } = await call('POST', '/v1/posts', { body: payload, idempotency, timeout: 60_000, retries: 2 });
  const post = json.post || json;
  return { simulated: false, request_id: post._id, job_id: null, results: normalizeResults(post), done: ['published', 'partial', 'failed'].includes(post.status), fieldNames: names };
}

// Andamento: GET /v1/posts/{id}. state: enviando | publicado | parcial | erro.
async function status({ request_id }) {
  let json;
  try { ({ json } = await call('GET', `/v1/posts/${encodeURIComponent(request_id)}`, { timeout: 20_000 })); } catch (err) {
    if (/\(404\)/.test(err.message)) return { state: 'erro', results: [], error: 'A Zernio não encontrou esta publicação.' };
    throw err;
  }
  const post = json.post || json;
  const results = normalizeResults(post);
  const state = { published: 'publicado', partial: 'parcial', failed: 'erro', cancelled: 'erro' }[post.status] || 'enviando';
  const error = state === 'erro' ? (results.find((r) => r.error)?.error || 'O envio falhou.') : null;
  return { state, results, error };
}

module.exports = { TO_ZERNIO, FROM_ZERNIO, connected, resetCache, buildPost, buildPhotoPost, normalizeResults, send, status };
