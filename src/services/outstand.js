// Outstand (https://www.outstand.so/docs): terceira via para publicar nas redes. API REST com chave Bearer (api.outstand.so).
// SEGURANÇA: sem OUTSTAND_LIVE=true (ou o botão em Integrações) nada sai daqui: o pedido é montado e conferido igual, mas "simulado".
// O vídeo e as imagens vão por link assinado do Backblaze (a Outstand baixa de lá). O envio é imediato: nós já seguramos o agendamento
// (a Outstand só agenda até 30 dias e não reagenda), e consultamos o andamento depois (status).
// Fatos da documentação que moldam este arquivo:
// - `accounts` recebe o id da conta (GET /v1/social-accounts); nome de rede não resolve. Contas que não resolvem são descartadas em silêncio,
//   por isso conferimos as contas antes de enviar e depois comparamos com `socialAccounts` da resposta.
// - Cada rede tem seu bloco de opções com o nome da rede (instagram, youtube, tiktok, facebook) e o texto próprio (`content`).
// - Story: `instagram.publishAsStory`, uma mídia só e sem legenda. Reel: o vídeo; capa em `reelCoverUrl`. Collab (até 3) e marcação em
//   `instagram.collaborators` / `instagram.userTags` ({ username, x, y }, os dois obrigatórios).
// - TikTok: `postMode` MEDIA_UPLOAD (padrão deles: vira RASCUNHO na caixa do TikTok, a pessoa termina no app) ou DIRECT_POST (publica,
//   exige privacyLevel vindo do creator-info). Escolha em Integrações (app_settings.outstand_tiktok_mode: 'direto' | 'rascunho').
// - Editar: PATCH /v1/posts/:id só vale para post que AINDA NÃO saiu (409 depois de publicado). Como o agendamento é nosso, editar agendado
//   já é feito aqui; depois de publicado, edite no app da rede (o provedor informa canEdit: false).
// - POST /v1/posts aceita Idempotency-Key (24 h): a mesma chave repetida devolve o mesmo post, então é seguro repetir em falha de rede.
const crypto = require('crypto');
const config = require('../config');
const settings = require('./settings');
const L = require('./platformLimits');

const NETWORKS = ['youtube', 'tiktok', 'instagram', 'facebook', 'threads', 'linkedin', 'x']; // os mesmos nomes do painel
const api = (path) => `${config.outstand.base}${path}`;
const headers = (extra = {}) => ({ Authorization: `Bearer ${config.outstand.key}`, Accept: 'application/json', ...extra });

// A Outstand responde erro de formas diferentes: { error: 'texto' }, { error: [{ path, message }] } (validação) ou { message }.
function reason(json, status) {
  const e = json?.error;
  if (Array.isArray(e)) return e.slice(0, 3).map((i) => `${[].concat(i.path || []).join('.') || 'pedido'}: ${i.message}`).join('; ');
  if (typeof e === 'string') return e;
  if (e?.message) return e.message;
  return json?.message || (status === 402 ? 'assinatura da Outstand inativa' : status === 401 ? 'chave da Outstand inválida' : 'erro desconhecido');
}
const fail = (res, json) => Object.assign(new Error(`Outstand recusou (${res.status}): ${reason(json, res.status)}`), { status: res.status });

async function call(method, path, { body = null, idempotency = null, timeout = 30_000, retries = 0 } = {}) {
  if (!config.outstandConfigured) throw new Error('OUTSTAND_API_KEY não configurada.');
  let last;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(api(path), {
        method, headers: headers({ ...(body ? { 'Content-Type': 'application/json' } : {}), ...(idempotency ? { 'Idempotency-Key': idempotency } : {}) }),
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status >= 500 && attempt < retries) { last = fail(res, json); continue; } // 5xx: repete com a MESMA chave (sem duplicar)
      if (!res.ok) throw fail(res, json);
      return { status: res.status, json, replayed: res.headers.get('idempotency-replayed') === 'true' };
    } catch (err) {
      if (err.status || attempt >= retries) throw err; // erro da API (4xx) não se repete; falha de rede, sim
      last = err;
    }
  }
  throw last;
}

let cache = { at: 0, value: null };
// Contas conectadas (só leitura), no formato do painel: { youtube: { handle, name, reauth, accountId } }. Guarda 60 s.
// force (botão "Testar"): confere também o token de cada conta (GET /v1/social-accounts/:id/health) e marca "reconectar".
async function connected({ force = false } = {}) {
  if (!config.outstandConfigured) return { ok: false, platforms: {}, error: 'OUTSTAND_API_KEY não configurada.' };
  if (!force && cache.value && Date.now() - cache.at < 60_000) return cache.value;
  let value;
  try {
    const rows = [];
    for (let offset = 0; offset < 500; offset += 100) {
      const { json } = await call('GET', `/v1/social-accounts?limit=100&offset=${offset}`, { timeout: 15_000 });
      const page = json.data || [];
      rows.push(...page);
      if (page.length < 100) break;
    }
    const platforms = {};
    for (const acc of rows) {
      const ours = NETWORKS.includes(acc.network) ? acc.network : null;
      if (!ours || !acc.isActive || platforms[ours]) continue; // uma conta por rede: a primeira ativa
      platforms[ours] = { handle: acc.username || acc.nickname || '', name: acc.nickname || '', reauth: false, accountId: acc.id, capabilities: [] };
    }
    if (force) {
      await Promise.all(Object.values(platforms).map(async (p) => {
        try { const { json } = await call('GET', `/v1/social-accounts/${encodeURIComponent(p.accountId)}/health`, { timeout: 15_000 }); p.reauth = json.data?.healthy === false; } catch { /* sem resposta: não marca */ }
      }));
    }
    value = { ok: true, platforms };
  } catch (err) {
    value = { ok: false, platforms: {}, error: err.message };
  }
  cache = { at: Date.now(), value };
  return value;
}
const resetCache = () => { cache = { at: 0, value: null }; };

// Como o TikTok sai: 'direto' (publica) ou 'rascunho' (vai para a caixa do TikTok e a pessoa termina no app). Padrão: direto.
const tiktokMode = async () => ((await settings.get('outstand_tiktok_mode')) === 'rascunho' ? 'rascunho' : 'direto');
const setTiktokMode = (mode) => settings.set('outstand_tiktok_mode', mode === 'rascunho' ? 'rascunho' : 'direto');

// Ajustar o vídeo para cada rede (a Outstand refaz o arquivo só se precisar; cobrado por minuto de saída). Padrão: desligado.
const processMedia = async () => (await settings.get('outstand_process_media')) === 'true';
const setProcessMedia = (on) => settings.set('outstand_process_media', on ? 'true' : 'false');

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)));

// Collab e marcação do Instagram no formato da Outstand: userTags exige x e y (vídeo não usa posição: centro).
function instagramData(ig, { photo = false } = {}) {
  if (!ig) return {};
  const d = {};
  if (ig.collaborators?.length) d.collaborators = ig.collaborators.slice(0, 3);
  if (ig.tags?.length) d.userTags = ig.tags.map((t) => ({ username: t.username, x: t.x ?? 0.5, y: t.y ?? (photo ? 0.85 : 0.5) }));
  return d;
}

// Opções de cada rede (o bloco com o nome da rede). Devolve { instagram?, youtube?, tiktok?, facebook? }.
function networkBlocks(platforms, { kind, media, title, description, coverUrl, thumbnailUrl, tags, instagram, tiktokPostMode }) {
  const out = {}; const caption = description || title;
  const photo = kind === 'photo';
  if (platforms.includes('youtube')) {
    out.youtube = clean({
      title: L.fitWords(title, L.LIMITS.youtube.title.max), content: caption, privacyStatus: 'public', madeForKids: false, categoryId: '22',
      isShort: kind === 'clip' || undefined, tags: (tags || []).slice(0, 30),
      thumbnailUrl: kind === 'episode' ? thumbnailUrl : undefined, // capa do vídeo longo; Shorts não pegam pela API
    });
  }
  if (platforms.includes('instagram')) {
    const ig = media === 'story' ? { publishAsStory: true } : clean({ ...instagramData(instagram, { photo }), reelCoverUrl: kind === 'clip' ? coverUrl : undefined });
    if (Object.keys(ig).length) out.instagram = ig;
  }
  if (platforms.includes('tiktok')) {
    out.tiktok = photo
      ? clean({ postMode: tiktokPostMode, title: L.fitWords(title || caption, 90), description: caption, disableComment: false })
      : clean({ postMode: tiktokPostMode, content: caption, disableComment: false });
  }
  if (platforms.includes('facebook') && kind === 'clip') out.facebook = { publishAsReel: true };
  if (platforms.includes('facebook') && media === 'story') out.facebook = { publishAsStory: true };
  return out;
}

const idempotencyKey = (id) => `pulso-${id}-${crypto.randomBytes(6).toString('hex')}`;
const accountIds = (platforms, accounts) => platforms.map((p) => accounts[p]?.accountId).filter(Boolean);
const missingOf = (platforms, accounts) => platforms.filter((p) => !accounts[p]?.accountId);
const fileOf = (url, fallback) => { try { const n = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); return /\.[A-Za-z0-9]{2,4}$/.test(n) ? n : fallback; } catch { return fallback; } };

// Corpo do POST /v1/posts para um vídeo (episódio ou corte).
function buildPost({ id, kind, platforms, title, description, videoUrl, coverUrl, thumbnailUrl, tags = [], accounts = {}, instagram = null, tiktokMode: mode = 'direto', scheduledAt = null, processMedia: process = false }) {
  const caption = description || title;
  const tiktokPostMode = mode === 'rascunho' ? 'MEDIA_UPLOAD' : 'DIRECT_POST';
  return {
    accounts: accountIds(platforms, accounts),
    containers: [{ content: caption, media: [{ url: videoUrl, filename: fileOf(videoUrl, kind === 'episode' ? 'episodio.mp4' : `corte-${id}.mp4`) }] }],
    ...(process ? { processMedia: true } : {}),
    ...(scheduledAt ? { scheduledAt } : {}), // só para testes: o agendamento do painel é nosso e o envio é imediato
    ...networkBlocks(platforms, { kind, media: 'video', title, description, coverUrl, thumbnailUrl, tags, instagram, tiktokPostMode }),
    _missing: missingOf(platforms, accounts), _networks: platforms, _tiktok: accounts.tiktok?.accountId, idempotency: idempotencyKey(id),
  };
}

// Imagens: post (1), carrossel (2 a 10, um contêiner com várias mídias) ou story (só Instagram/Facebook, sem legenda).
function buildPhotoPost({ id, media, platforms, title, description, photoUrls, accounts = {}, instagram = null, tiktokMode: mode = 'direto', scheduledAt = null }) {
  const story = media === 'story';
  const caption = description || title || '';
  const container = { ...(story ? {} : { content: caption }), media: photoUrls.map((url, i) => ({ url, filename: fileOf(url, `imagem-${i + 1}.jpg`) })) };
  return {
    accounts: accountIds(platforms, accounts), containers: [container], ...(scheduledAt ? { scheduledAt } : {}),
    ...networkBlocks(platforms, { kind: 'photo', media, title, description, instagram, tiktokPostMode: mode === 'rascunho' ? 'MEDIA_UPLOAD' : 'DIRECT_POST' }),
    _missing: missingOf(platforms, accounts), _networks: platforms, _tiktok: accounts.tiktok?.accountId, idempotency: idempotencyKey(id),
  };
}

// YouTube e outras redes: a Outstand só devolve o link pronto no Instagram; nas demais montamos pelo id do post.
function urlOf(acc) {
  if (acc.platformPostUrl) return acc.platformPostUrl;
  const id = acc.platformPostId; if (!id || acc.status !== 'published') return null;
  if (acc.network === 'youtube') return `https://www.youtube.com/watch?v=${id}`;
  if (acc.network === 'x' && acc.username) return `https://x.com/${acc.username}/status/${id}`;
  if (acc.network === 'tiktok' && acc.username && /^\d+$/.test(id)) return `https://www.tiktok.com/@${String(acc.username).replace(/^@/, '')}/video/${id}`;
  return null;
}

// Resultados por rede no formato do painel (o mesmo do Upload-Post). draft: o TikTok foi como rascunho (a pessoa publica no app).
const STATES = { published: 'completed', failed: 'failed', deleted: 'failed' };
function normalizeResults(post, { draft = false } = {}) {
  return (post?.socialAccounts || []).map((a) => {
    const isDraft = draft && a.network === 'tiktok' && a.status === 'published';
    return {
      platform: a.network, ok: a.status === 'published', skipped: false, status: STATES[a.status] || 'processing', url: urlOf(a), post_id: a.platformPostId || null,
      error: a.status === 'failed' ? (a.error || 'falhou') : (a.status === 'deleted' ? 'apagado na rede' : null),
      ...(isDraft ? { draft: true, note: 'Rascunho no TikTok: abra o app do TikTok para escolher a legenda e publicar.' } : {}),
    };
  });
}

// Estado do post inteiro a partir de cada conta: enviando | publicado | parcial | erro.
function stateOf(results) {
  if (!results.length) return 'enviando';
  if (results.some((r) => r.status === 'processing')) return 'enviando';
  const ok = results.filter((r) => r.ok).length;
  return ok === results.length ? 'publicado' : ok ? 'parcial' : 'erro';
}

// Privacidade do TikTok no envio direto: precisa vir das opções do criador (creator-info). Prefere "público".
async function tiktokPrivacy(accountId) {
  let data;
  try { ({ json: { data } } = await call('GET', `/v1/tiktok/accounts/${encodeURIComponent(accountId)}/creator-info`, { timeout: 20_000 })); } catch (err) {
    throw new Error(`TikTok: não consegui ler as opções de publicação da conta (${err.message}). Em Integrações, escolha enviar o TikTok como rascunho.`);
  }
  const options = data?.privacy_level_options || [];
  if (options.includes('PUBLIC_TO_EVERYONE')) return 'PUBLIC_TO_EVERYONE';
  throw new Error(`TikTok: esta conta só aceita publicar como ${options.join(' ou ') || 'privado'} pela Outstand. Em Integrações, escolha enviar o TikTok como rascunho (você publica no app) ou conecte um app do TikTok auditado.`);
}

// Envia. Devolve { simulated, request_id (id do post na Outstand), job_id, results, done, fieldNames, warnings }. Sem OUTSTAND_LIVE não chama nada.
async function send(body) {
  const { idempotency, _missing: missing = [], _networks: networks = [], _tiktok: tiktokId = null, ...payload } = body;
  const names = Object.keys(payload);
  const rascunho = payload.tiktok?.postMode === 'MEDIA_UPLOAD';
  if (!config.outstand.live) return { simulated: true, status: 'simulado', fieldNames: names, results: networks.map((p) => ({ platform: p, ok: true, simulated: true, status: 'simulado', url: null, error: null })) };
  if (missing.length) throw new Error(`Sem conta conectada na Outstand: ${missing.join(', ')}.`);
  if (payload.tiktok?.postMode === 'DIRECT_POST' && tiktokId) payload.tiktok = { ...payload.tiktok, privacyLevel: await tiktokPrivacy(tiktokId) };
  const { json } = await call('POST', '/v1/posts', { body: payload, idempotency, timeout: 90_000, retries: 2 });
  let post = json.post || json;
  if (post.scheduled === false) { // criado mas não entrou na fila (falha passageira deles): reenfileira agendando para daqui a 1 minuto
    const patched = await call('PATCH', `/v1/posts/${encodeURIComponent(post.id)}`, { body: { scheduledAt: new Date(Date.now() + 60_000).toISOString() }, timeout: 30_000 });
    post = patched.json.post || post;
  }
  const got = new Set((post.socialAccounts || []).map((a) => a.id));
  const asked = new Set(payload.accounts);
  const dropped = [...asked].filter((a) => !got.has(a)); // a Outstand descarta em silêncio o que não resolve
  if (dropped.length) throw new Error('A Outstand não reconheceu uma das contas conectadas. Teste a conexão em Integrações e reconecte a conta.');
  return { simulated: false, request_id: post.id, job_id: rascunho ? 'tiktok-rascunho' : null, results: normalizeResults(post, { draft: rascunho }), done: false, fieldNames: names, warnings: json.warnings || [] };
}

// O TikTok só busca vídeo de domínio verificado no app dele (erro `url_ownership_unverified` com o link do Backblaze). A Outstand
// guarda o arquivo no armazenamento dela (POST /v1/media/upload -> PUT -> confirm, 60 dias) e devolve um link que o TikTok aceita.
// O servidor baixa do Backblaze e repassa em fluxo (sem guardar em disco). Devolve o link da Outstand.
async function hostMedia(sourceUrl, { filename = 'video.mp4', contentType = 'video/mp4' } = {}) {
  const { json: created } = await call('POST', '/v1/media/upload', { body: { filename, content_type: contentType }, timeout: 30_000, retries: 1 });
  const slot = created.data || created;
  if (!slot.id || !slot.upload_url) throw new Error('A Outstand não devolveu o endereço de envio do arquivo.');
  const src = await fetch(sourceUrl, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!src.ok || !src.body) throw new Error(`Não consegui ler o vídeo no armazenamento (${src.status}).`);
  const size = Number(src.headers.get('content-length')) || 0;
  const put = await fetch(slot.upload_url, {
    method: 'PUT', headers: { 'Content-Type': contentType, ...(size ? { 'Content-Length': String(size) } : {}) },
    body: src.body, duplex: 'half', signal: AbortSignal.timeout(15 * 60_000),
  });
  if (!put.ok) throw new Error(`A Outstand recusou o arquivo (${put.status}).`);
  const { json: done } = await call('POST', `/v1/media/${encodeURIComponent(slot.id)}/confirm`, { body: size ? { size } : {}, timeout: 60_000, retries: 1 });
  const url = (done.data || done).url;
  if (!url) throw new Error('A Outstand não confirmou o arquivo enviado.');
  return url;
}

// Andamento: GET /v1/posts/{id}. state: enviando | publicado | parcial | erro.
async function status({ request_id, job_id = null }) {
  let json;
  try { ({ json } = await call('GET', `/v1/posts/${encodeURIComponent(request_id)}`, { timeout: 20_000 })); } catch (err) {
    if (err.status === 404) return { state: 'erro', results: [], error: 'A Outstand não encontrou esta publicação.' };
    throw err;
  }
  const results = normalizeResults(json.post || json, { draft: job_id === 'tiktok-rascunho' });
  const state = stateOf(results);
  const error = state === 'erro' ? (results.find((r) => r.error)?.error || 'O envio falhou.') : null;
  return { state, results, error };
}

module.exports = { NETWORKS, hostMedia, fileOf, connected, resetCache, tiktokMode, setTiktokMode, processMedia, setProcessMedia, instagramData, buildPost, buildPhotoPost, normalizeResults, stateOf, send, status, reason };
