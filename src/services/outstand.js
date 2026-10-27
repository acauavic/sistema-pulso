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
// - Docs relidas em 27/10/2026 (llms-full.txt): o envio às redes é assíncrono e cada conta falha sozinha (parcial é normal); falha
//   "terminal" não é repetida por eles, e para repetir cria-se um post NOVO só com as contas que falharam. YouTube por chaves gerenciadas
//   usa uma fila compartilhada (100 envios por dia para todos, liberados a cada 15 min, 5 por organização antes das 4 h finais do dia
//   do Pacífico; agendar não reserva vaga; o erro traz [youtube_upload_error:<motivo>; retryAt=<ISO>]). A Outstand só confere o
//   cabeçalho do vídeo (probe): um arquivo que o armazenamento entrega pela metade passa e as redes recebem só o começo, por isso
//   conferimos e hospedamos antes (publishing.prepareMedia). Apagar na rede (DELETE /v1/posts/:id/remote) não vale para Instagram
//   nem TikTok. A mídia hospedada vence em 60 dias.
const crypto = require('crypto');
const config = require('../config');
const db = require('../db/pool');
const settings = require('./settings');
const L = require('./platformLimits');
const { cause, mediaError, mb } = require('./mediaCheck');

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
// code (ver publishErrors): chave/assinatura (401/402/403) para e pede ação; 5xx é passageiro; 400/422 é o pedido recusado.
const CODE_OF = (s) => (s === 401 || s === 402 || s === 403 ? 'provedor_chave' : s >= 500 ? 'provedor_fora' : s === 400 || s === 422 ? 'recusado' : undefined);
const fail = (res, json) => Object.assign(new Error(`Outstand recusou (${res.status}): ${reason(json, res.status)}`), { status: res.status, code: CODE_OF(res.status) });

// ambiguous: o POST pode ter criado o post mesmo sem resposta (rede caiu, 5xx, tempo esgotado). Quem chama guarda a chave e
// repete com ELA (a Outstand devolve o mesmo post por 24 h), em vez de criar outro e publicar duas vezes.
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
      if (res.status >= 500 && attempt < retries) { last = Object.assign(fail(res, json), { ambiguous: Boolean(idempotency) }); continue; } // 5xx: repete com a MESMA chave (sem duplicar)
      if (!res.ok) throw Object.assign(fail(res, json), { ambiguous: Boolean(idempotency) && res.status >= 500 });
      return { status: res.status, json, replayed: res.headers.get('idempotency-replayed') === 'true' };
    } catch (err) {
      if (err.status) throw err; // erro da API (4xx) não se repete; falha de rede, sim
      last = Object.assign(new Error(`Outstand sem resposta: ${cause(err)}`), { code: 'provedor_fora', ambiguous: Boolean(idempotency) });
      if (attempt >= retries) throw last;
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
const accountMap = (platforms, accounts) => Object.fromEntries(platforms.filter((p) => accounts[p]?.accountId).map((p) => [p, accounts[p].accountId]));
const fileOf = (url, fallback) => { try { const n = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); return /\.[A-Za-z0-9]{2,4}$/.test(n) ? n : fallback; } catch { return fallback; } };

// Corpo do POST /v1/posts para um vídeo (episódio ou corte). idempotencyKey: a chave de um envio anterior sem resposta (repete sem duplicar).
function buildPost({ id, kind, platforms, title, description, videoUrl, coverUrl, thumbnailUrl, tags = [], accounts = {}, instagram = null, tiktokMode: mode = 'direto', scheduledAt = null, processMedia: process = false, idempotencyKey: key = null }) {
  const caption = description || title;
  const tiktokPostMode = mode === 'rascunho' ? 'MEDIA_UPLOAD' : 'DIRECT_POST';
  return {
    accounts: accountIds(platforms, accounts),
    containers: [{ content: caption, media: [{ url: videoUrl, filename: fileOf(videoUrl, kind === 'episode' ? 'episodio.mp4' : `corte-${id}.mp4`) }] }],
    ...(process ? { processMedia: true } : {}),
    ...(scheduledAt ? { scheduledAt } : {}), // só para testes: o agendamento do painel é nosso e o envio é imediato
    ...networkBlocks(platforms, { kind, media: 'video', title, description, coverUrl, thumbnailUrl, tags, instagram, tiktokPostMode }),
    _missing: missingOf(platforms, accounts), _networks: platforms, _accountOf: accountMap(platforms, accounts), _tiktok: accounts.tiktok?.accountId, idempotency: key || idempotencyKey(id),
  };
}

// Imagens: post (1), carrossel (2 a 10, um contêiner com várias mídias) ou story (só Instagram/Facebook, sem legenda).
function buildPhotoPost({ id, media, platforms, title, description, photoUrls, accounts = {}, instagram = null, tiktokMode: mode = 'direto', scheduledAt = null, idempotencyKey: key = null }) {
  const story = media === 'story';
  const caption = description || title || '';
  const container = { ...(story ? {} : { content: caption }), media: photoUrls.map((url, i) => ({ url, filename: fileOf(url, `imagem-${i + 1}.jpg`) })) };
  return {
    accounts: accountIds(platforms, accounts), containers: [container], ...(scheduledAt ? { scheduledAt } : {}),
    ...networkBlocks(platforms, { kind: 'photo', media, title, description, instagram, tiktokPostMode: mode === 'rascunho' ? 'MEDIA_UPLOAD' : 'DIRECT_POST' }),
    _missing: missingOf(platforms, accounts), _networks: platforms, _accountOf: accountMap(platforms, accounts), _tiktok: accounts.tiktok?.accountId, idempotency: key || idempotencyKey(id),
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

// Opções do criador no TikTok (creator-info): a privacidade do envio direto (prefere "público") e a duração máxima de vídeo da conta.
async function tiktokCreator(accountId) {
  let data;
  try { ({ json: { data } } = await call('GET', `/v1/tiktok/accounts/${encodeURIComponent(accountId)}/creator-info`, { timeout: 20_000 })); } catch (err) {
    // 400/403/404: a conexão do TikTok precisa ser refeita (doc do creator-info); 401: a nossa chave; 429 e 5xx: passageiro
    const code = [400, 403, 404].includes(err.status) ? 'sem_conta' : err.status === 401 ? 'provedor_chave' : err.status === 429 ? undefined : 'provedor_fora';
    throw Object.assign(new Error(`TikTok: não consegui ler as opções de publicação da conta (${err.message}). Em Integrações, dá para enviar o TikTok como rascunho.`), { code });
  }
  const options = data?.privacy_level_options || [];
  if (!options.includes('PUBLIC_TO_EVERYONE')) {
    throw Object.assign(new Error(`TikTok: esta conta só aceita publicar como ${options.join(' ou ') || 'privado'} pela Outstand. Em Integrações, escolha enviar o TikTok como rascunho (você publica no app) ou conecte um app do TikTok auditado.`), { code: 'tiktok_privado' });
  }
  return { privacyLevel: 'PUBLIC_TO_EVERYONE', maxSeconds: Number(data?.max_video_post_duration_sec) || null };
}

// Envia. Devolve { simulated, request_id (id do post na Outstand), job_id, results, preFailed, done, fieldNames, warnings }. Sem OUTSTAND_LIVE não chama nada.
// A rede que não dá para mandar (sem conta, TikTok sem a privacidade ou com vídeo longo demais) falha SÓ ela: as outras seguem.
async function send(body) {
  const { idempotency, _missing: missing = [], _networks: networks = [], _tiktok: tiktokId = null, _accountOf: accountOf = {}, _durationSec: durationSec = null, ...payload } = body;
  const names = Object.keys(payload);
  const rascunho = payload.tiktok?.postMode === 'MEDIA_UPLOAD';
  if (!config.outstand.live) return { simulated: true, status: 'simulado', fieldNames: names, results: networks.map((p) => ({ platform: p, ok: true, simulated: true, status: 'simulado', url: null, error: null })) };
  const preFailed = missing.map((p) => ({ platform: p, code: 'sem_conta', error: `Sem conta conectada na Outstand para ${p}.` }));
  const drop = (p, code, error) => { preFailed.push({ platform: p, code, error }); payload.accounts = payload.accounts.filter((a) => a !== accountOf[p]); delete payload[p]; };
  if (payload.tiktok && tiktokId && payload.accounts.includes(tiktokId)) {
    try {
      const creator = rascunho ? null : await tiktokCreator(tiktokId);
      if (creator) payload.tiktok = { ...payload.tiktok, privacyLevel: creator.privacyLevel };
      if (creator?.maxSeconds && durationSec && durationSec > creator.maxSeconds) drop('tiktok', 'formato', `TikTok: o vídeo tem ${Math.round(durationSec)} s e esta conta aceita até ${creator.maxSeconds} s.`);
    } catch (err) { drop('tiktok', err.code, err.message); }
  }
  if (!payload.accounts.length) throw Object.assign(new Error(preFailed[0]?.error || 'Nenhuma rede para enviar.'), { code: preFailed[0]?.code || 'sem_conta', preFailed });
  const { json } = await call('POST', '/v1/posts', { body: payload, idempotency, timeout: 90_000, retries: 2 });
  let post = json.post || json;
  if (post.scheduled === false) { // criado mas não entrou na fila (falha passageira deles): reenfileira agendando para daqui a 1 minuto
    const patched = await call('PATCH', `/v1/posts/${encodeURIComponent(post.id)}`, { body: { scheduledAt: new Date(Date.now() + 60_000).toISOString() }, timeout: 30_000 });
    post = patched.json.post || post;
  }
  // a Outstand descarta em silêncio a conta que não resolve: o post SAIU para as outras, então só essa rede fica com erro
  const got = new Set((post.socialAccounts || []).map((a) => a.id));
  for (const [p, id] of Object.entries(accountOf)) {
    if (payload.accounts.includes(id) && !got.has(id)) preFailed.push({ platform: p, code: 'sem_conta', error: 'A Outstand não reconheceu a conta conectada desta rede. Teste a conexão em Integrações e reconecte a conta.' });
  }
  const failedRows = preFailed.map((f) => ({ platform: f.platform, ok: false, skipped: false, status: 'failed', url: null, post_id: null, error: f.error, code: f.code || null }));
  return { simulated: false, request_id: post.id, job_id: rascunho ? 'tiktok-rascunho' : null, results: [...normalizeResults(post, { draft: rascunho }), ...failedRows], preFailed, done: false, fieldNames: names, warnings: json.warnings || [] };
}

// O arquivo vai antes para o armazenamento da Outstand (POST /v1/media/upload -> PUT -> confirm, 60 dias): o TikTok só busca de domínio
// verificado, e as redes baixam de lá (CDN deles) em vez do Backblaze. O servidor repassa em fluxo, sem guardar em disco, CONTANDO os
// bytes: se o Backblaze parar no meio, falha aqui (erro arquivo_indisponivel) e nada vai às redes. size: o tamanho registrado no banco.
async function hostMedia(sourceUrl, { filename = 'video.mp4', contentType = 'video/mp4', size = null } = {}) {
  const { json: created } = await call('POST', '/v1/media/upload', { body: { filename, content_type: contentType }, timeout: 30_000, retries: 1 });
  const slot = created.data || created;
  if (!slot.id || !slot.upload_url) throw Object.assign(new Error('A Outstand não devolveu o endereço de envio do arquivo.'), { code: 'provedor_fora' });
  let src;
  try { src = await fetch(sourceUrl, { signal: AbortSignal.timeout(10 * 60_000) }); } catch (err) { throw mediaError('arquivo_indisponivel', `Não consegui ler o arquivo no armazenamento: ${cause(err)}.`); }
  if (!src.ok || !src.body) throw src.status === 404 ? mediaError('arquivo_sumiu', 'O arquivo não está no armazenamento.') : mediaError('arquivo_indisponivel', `O armazenamento respondeu ${src.status} ao ler o arquivo.`, { status: src.status });
  const declared = Number(src.headers.get('content-length')) || 0;
  if (size && declared && declared !== Number(size)) { await src.body.cancel().catch(() => {}); throw mediaError('arquivo_incompleto', `O arquivo no armazenamento tem ${mb(declared)}, mas o envio registrou ${mb(size)}.`); }
  const expected = Number(size) || declared || 0;
  let sent = 0; let sourceError = null;
  const reader = src.body.getReader();
  const body = new ReadableStream({
    async pull(ctl) {
      try { const { done, value } = await reader.read(); if (done) ctl.close(); else { sent += value.byteLength; ctl.enqueue(value); } } catch (err) { sourceError = err; ctl.error(err); }
    },
    cancel(why) { reader.cancel(why).catch(() => {}); },
  });
  const lost = (err) => mediaError('arquivo_indisponivel', `O armazenamento parou de entregar o arquivo em ${mb(sent)}${expected ? ` de ${mb(expected)}` : ''}: ${cause(err)}.`, { bytes: sent, total: expected });
  let put;
  try {
    put = await fetch(slot.upload_url, { method: 'PUT', headers: { 'Content-Type': contentType, ...(expected ? { 'Content-Length': String(expected) } : {}) }, body, duplex: 'half', signal: AbortSignal.timeout(15 * 60_000) });
  } catch (err) {
    if (sourceError || (expected && sent < expected)) throw lost(sourceError || err);
    throw Object.assign(new Error(`Não consegui enviar o arquivo à Outstand: ${cause(err)}.`), { code: 'provedor_fora' });
  }
  if (sourceError) throw lost(sourceError);
  if (!put.ok) throw Object.assign(new Error(`A Outstand recusou o arquivo (${put.status}).`), { code: 'provedor_fora' });
  if (expected && sent !== expected) throw lost(new Error(`chegaram ${sent} bytes`));
  const { json: done } = await call('POST', `/v1/media/${encodeURIComponent(slot.id)}/confirm`, { body: sent ? { size: sent } : {}, timeout: 60_000, retries: 1 });
  const data = done.data || done;
  if (!data.url) throw Object.assign(new Error('A Outstand não confirmou o arquivo enviado.'), { code: 'provedor_fora' });
  return { url: data.url, id: data.id || slot.id, size: sent || null, expiresAt: data.expires_at || null };
}

// O mesmo arquivo já hospedado (vale 60 dias; usamos até 3 dias antes de vencer): reaproveita nas novas tentativas e em outro post do
// mesmo corte, sem depender do Backblaze de novo. sourceUrl pode ser uma função (o link só é assinado se precisar subir).
async function hosted(key, { sourceUrl, filename, contentType, size = null }) {
  const { rows: [h] } = await db.query(
    `SELECT * FROM hosted_media WHERE storage_key = $1 AND provider = 'outstand' AND (expires_at IS NULL OR expires_at > now() + interval '3 days')
        AND ($2::bigint IS NULL OR size_bytes IS NULL OR size_bytes = $2)`, [key, size ? Number(size) : null]);
  if (h) return { url: h.url, reused: true, bytes: Number(h.size_bytes) || null, ms: 0 };
  const t0 = Date.now();
  const up = await hostMedia(typeof sourceUrl === 'function' ? await sourceUrl() : sourceUrl, { filename, contentType, size });
  const expires = up.expiresAt && Number.isFinite(Date.parse(up.expiresAt)) ? new Date(up.expiresAt) : new Date(Date.now() + 60 * 86_400_000);
  await db.query(
    `INSERT INTO hosted_media (storage_key, provider, url, media_id, size_bytes, expires_at) VALUES ($1, 'outstand', $2, $3, $4, $5)
     ON CONFLICT (storage_key, provider) DO UPDATE SET url = EXCLUDED.url, media_id = EXCLUDED.media_id, size_bytes = EXCLUDED.size_bytes, expires_at = EXCLUDED.expires_at, created_at = now()`,
    [key, up.url, up.id, up.size, expires]);
  return { url: up.url, reused: false, bytes: up.size, ms: Date.now() - t0 };
}
// A rede não conseguiu baixar a cópia hospedada: a próxima tentativa sobe de novo.
const forgetHosted = (keys) => db.query("DELETE FROM hosted_media WHERE provider = 'outstand' AND storage_key = ANY($1::text[])", [[].concat(keys).filter(Boolean)]);

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

module.exports = { NETWORKS, hostMedia, hosted, forgetHosted, fileOf, connected, resetCache, tiktokMode, setTiktokMode, processMedia, setProcessMedia, instagramData, buildPost, buildPhotoPost, normalizeResults, stateOf, send, status, reason, tiktokCreator };
