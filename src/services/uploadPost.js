// Upload-Post (https://docs.upload-post.com): uma chamada publica o vídeo em várias redes.
// SEGURANÇA: sem UPLOAD_POST_LIVE=true nada sai daqui. O pedido é montado e conferido igual, mas marcado como "simulado".
// O vídeo vai por link assinado do Backblaze (não passa pelo nosso servidor); o agendamento é nosso (links assinados duram no máximo 7 dias).
const crypto = require('crypto');
const config = require('../config');
const L = require('./platformLimits');

// Redes que o painel oferece. `video` diz onde faz sentido: o episódio inteiro só vai para o YouTube.
const PLATFORMS = {
  youtube: { label: 'YouTube', clipLabel: 'YouTube Shorts', episode: true, clip: true },
  tiktok: { label: 'TikTok', episode: false, clip: true },
  instagram: { label: 'Instagram', clipLabel: 'Instagram Reels', episode: false, clip: true },
  facebook: { label: 'Facebook', clipLabel: 'Facebook Reels', episode: false, clip: true },
  threads: { label: 'Threads', episode: false, clip: true },
  linkedin: { label: 'LinkedIn', episode: false, clip: true },
  x: { label: 'X', episode: false, clip: true },
};
const DEFAULTS = { episode: ['youtube'], clip: ['tiktok', 'youtube', 'instagram'] };
const MAX_LINK_SECONDS = 6 * 3600;

const headers = () => ({ Authorization: `Apikey ${config.uploadPost.key}` });
const api = (path) => `${config.uploadPost.base}${path}`;
const fail = (res, json) => new Error(`Upload-Post recusou (${res.status}): ${json.message || json.error || 'erro desconhecido'}`);

let cache = { at: 0, value: null };
// Redes conectadas ao perfil. Só leitura. Guarda 60 s para não bater na API a cada abertura de tela.
async function connected({ force = false } = {}) {
  if (!config.uploadPostConfigured) return { ok: false, platforms: {}, error: 'UPLOAD_POST_KEY não configurada.' };
  if (!force && cache.value && Date.now() - cache.at < 60_000) return cache.value;
  let value;
  try {
    const res = await fetch(api(`/api/uploadposts/users/${encodeURIComponent(config.uploadPost.user)}`), { headers: headers(), signal: AbortSignal.timeout(8_000) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw fail(res, json);
    const profile = json.profile || (json.profiles || []).find((p) => p.username === config.uploadPost.user) || json;
    const platforms = {};
    for (const [name, acc] of Object.entries(profile.social_accounts || {})) {
      if (acc && typeof acc === 'object') platforms[name] = { handle: acc.handle || acc.display_name || '', name: acc.display_name || '', reauth: Boolean(acc.reauth_required), capabilities: acc.capabilities || [] };
    }
    value = { ok: true, platforms };
  } catch (err) {
    value = { ok: false, platforms: {}, error: err.message };
  }
  cache = { at: Date.now(), value };
  return value;
}
const resetCache = () => { cache = { at: 0, value: null }; };

// Confere o pedido contra os limites de cada rede ANTES de enviar. kind: 'episode' | 'clip'.
function validate({ kind, platforms, title, description, scheduledAt }) {
  const issues = []; const warnings = [];
  if (!platforms.length) issues.push('Escolha pelo menos uma rede.');
  for (const p of platforms) {
    const def = PLATFORMS[p];
    if (!def) { issues.push(`Rede desconhecida: ${p}.`); continue; }
    if (!def[kind]) issues.push(`${def.label}: ${kind === 'episode' ? 'o episódio inteiro só vai para o YouTube' : 'esta rede não recebe cortes por aqui'}.`);
  }
  const add = (r, prefix) => { issues.push(...r.issues.map((t) => `${prefix}: ${t}`)); warnings.push(...r.warnings.map((t) => `${prefix}: ${t}`)); };
  if (platforms.includes('youtube')) {
    add(L.checkYoutubeTitle(title), 'YouTube');
    if (kind === 'episode') add(L.checkYoutubeDescription(description), 'YouTube');
    else if (L.utf8(description) > L.LIMITS.youtube.descriptionBytes) issues.push('YouTube: a descrição passa do limite.');
  }
  if (platforms.includes('instagram')) add(L.checkInstagramCaption(description || title), 'Instagram');
  if (platforms.includes('tiktok')) add(L.checkTiktokCaption(description || title), 'TikTok');
  if (!String(title || '').trim()) issues.push('Falta o título.');
  if (scheduledAt) {
    const t = new Date(scheduledAt).getTime();
    if (!Number.isFinite(t)) issues.push('Data de agendamento inválida.');
    else if (t < Date.now() + 60_000) issues.push('O agendamento precisa ser no futuro.');
    else if (t > Date.now() + 365 * 86400_000) issues.push('O agendamento pode ser de no máximo 365 dias.');
  }
  return { ok: issues.length === 0, issues, warnings };
}

// Campos do formulário enviado ao Upload-Post (lista de pares, porque platform[] se repete).
function buildFields({ id, kind, platforms, title, description, videoUrl, coverUrl, thumbnailUrl, tags = [], accounts = {}, instagram = null }) {
  const f = [['user', config.uploadPost.user], ['title', title], ['async_upload', 'true'], ['request_id', `pulso-${id}-${crypto.randomBytes(4).toString('hex')}`], ['external_id', `pulso-pub-${id}`], ['video', videoUrl]];
  if (description) f.push(['description', description]);
  for (const p of platforms) f.push(['platform[]', p]);
  if (platforms.includes('youtube')) {
    f.push(['youtube_title', L.fitWords(title, L.LIMITS.youtube.title.max)]);
    if (description) f.push(['youtube_description', description]);
    f.push(['privacyStatus', 'public'], ['categoryId', '22'], ['selfDeclaredMadeForKids', 'false'], ['defaultLanguage', 'pt'], ['defaultAudioLanguage', 'pt-BR']);
    for (const t of tags.slice(0, 30)) f.push(['tags[]', t]);
    if (kind === 'episode' && thumbnailUrl) f.push(['thumbnail_url', thumbnailUrl]); // Shorts não aceitam thumbnail personalizada
  }
  if (platforms.includes('instagram')) {
    f.push(['instagram_title', description || title], ['media_type', 'REELS'], ['share_to_feed', 'true']);
    if (coverUrl) f.push(['cover_url', coverUrl]);
    f.push(...require('./igPeople').uploadPostFields(instagram)); // collab e marcação (só o @ em vídeo)
  }
  if (platforms.includes('tiktok')) {
    f.push(['tiktok_title', description || title]);
    if (coverUrl && (accounts.tiktok?.capabilities || []).includes('cover_image')) f.push(['tiktok_cover_image_url', coverUrl]);
  }
  if (platforms.includes('facebook')) f.push(['facebook_title', title], ['facebook_description', description || title], ['facebook_media_type', 'REELS']);
  return f;
}

// Lista de resultados por rede, no nosso formato, vindo da resposta síncrona (objeto) ou do status (lista).
function normalizeResults(raw) {
  if (!raw) return [];
  const rows = Array.isArray(raw) ? raw : Object.entries(raw).map(([platform, r]) => ({ platform, ...r }));
  return rows.map((r) => ({
    platform: r.platform, ok: r.success === true || r.status === 'completed', skipped: Boolean(r.skipped), status: r.status || (r.success ? 'completed' : r.success === false ? 'failed' : 'processing'),
    url: r.url || r.post_url || null, post_id: r.post_id || r.platform_post_id || r.video_id || r.media_id || r.id || null,
    error: r.success === false || r.status === 'failed' ? (r.error || r.message || 'falhou') : null,
  }));
}

// Envia. Devolve { simulated, request_id?, results?, status }. Em modo teste (sem UPLOAD_POST_LIVE) não faz nenhuma chamada de envio.
async function send(fields) {
  const names = fields.map(([k]) => k);
  if (!config.uploadPost.live) return { simulated: true, status: 'simulado', fieldNames: names, results: fields.filter(([k]) => k === 'platform[]').map(([, p]) => ({ platform: p, ok: true, simulated: true, status: 'simulado', url: null, error: null })) };
  if (!config.uploadPostConfigured) throw new Error('UPLOAD_POST_KEY não configurada.');
  const form = new FormData();
  for (const [k, v] of fields) form.append(k, String(v));
  const res = await fetch(api('/api/upload'), { method: 'POST', headers: { ...headers(), 'Idempotency-Key': fields.find(([k]) => k === 'request_id')[1] }, body: form, signal: AbortSignal.timeout(120_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw fail(res, json);
  return { simulated: false, request_id: json.request_id || fields.find(([k]) => k === 'request_id')[1], job_id: json.job_id || null, results: normalizeResults(json.results), done: Boolean(json.results), fieldNames: names };
}

// Consulta o andamento de um envio assíncrono.
async function status({ request_id, job_id }) {
  const qs = request_id ? `request_id=${encodeURIComponent(request_id)}` : `job_id=${encodeURIComponent(job_id)}`;
  const res = await fetch(api(`/api/uploadposts/status?${qs}`), { headers: headers(), signal: AbortSignal.timeout(20_000) });
  const json = await res.json().catch(() => ({}));
  if (res.status === 404) return { state: 'erro', results: [], error: 'O Upload-Post não encontrou este envio.' };
  if (!res.ok) throw fail(res, json);
  const results = normalizeResults(json.results);
  const real = results.filter((r) => !r.skipped);
  let state = 'enviando';
  if (json.status === 'failed') state = 'erro';
  else if (json.status === 'completed' || (results.length && results.length >= (json.total || results.length) && results.every((r) => ['completed', 'failed', 'skipped'].includes(r.status)))) {
    state = real.length && real.every((r) => r.ok) ? 'publicado' : real.some((r) => r.ok) ? 'parcial' : 'erro';
  }
  const error = state === 'erro' ? (real.find((r) => r.error)?.error || json.message || 'O envio falhou.') : null;
  return { state, results, error };
}

// ---------------------------------------------------------------- imagens (post, carrossel, story)
// Redes que recebem imagem por aqui. Story só no Instagram.
const PHOTO_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'threads', 'linkedin', 'x'];
function validatePhotos({ media, platforms, title, description, scheduledAt, count }) {
  const issues = []; const warnings = [];
  if (!platforms.length) issues.push('Escolha pelo menos uma rede.');
  for (const p of platforms) if (!PHOTO_PLATFORMS.includes(p)) issues.push(`${PLATFORMS[p]?.label || p}: não recebe imagem por aqui.`);
  if (media === 'story' && platforms.some((p) => p !== 'instagram')) issues.push('Story vai só para o Instagram.');
  if (!count) issues.push('Escolha a imagem.');
  if (media === 'carrossel' && count < 2) issues.push('Carrossel precisa de pelo menos 2 imagens.');
  if (count > 10) issues.push('No máximo 10 imagens por carrossel.');
  if (platforms.includes('x') && count > 4) warnings.push('X: mais de 4 imagens vira uma sequência de posts.');
  if (platforms.includes('instagram') && media !== 'story') { const c = L.checkInstagramCaption(description || title); issues.push(...c.issues.map((t) => `Instagram: ${t}`)); warnings.push(...c.warnings.map((t) => `Instagram: ${t}`)); }
  if (media !== 'story' && !String(title || '').trim() && !String(description || '').trim()) issues.push('Falta a legenda.');
  if (scheduledAt) {
    const t = new Date(scheduledAt).getTime();
    if (!Number.isFinite(t)) issues.push('Data de agendamento inválida.');
    else if (t < Date.now() + 60_000) issues.push('O agendamento precisa ser no futuro.');
  }
  return { ok: issues.length === 0, issues, warnings };
}

function buildPhotoFields({ id, media, platforms, title, description, photoUrls, instagram = null }) {
  const f = [['user', config.uploadPost.user], ['async_upload', 'true'], ['request_id', `pulso-${id}-${crypto.randomBytes(4).toString('hex')}`], ['external_id', `pulso-pub-${id}`]];
  if (title) f.push(['title', title]);
  if (description) f.push(['description', description]);
  for (const p of platforms) f.push(['platform[]', p]);
  for (const u of photoUrls) f.push(['photos[]', u]);
  if (platforms.includes('instagram')) {
    if (media === 'story') f.push(['media_type', 'STORIES']);
    else { f.push(['instagram_title', description || title]); f.push(...require('./igPeople').uploadPostFields(instagram, { photo: true })); }
  }
  return f;
}

// Mesmo comportamento de send(): sem UPLOAD_POST_LIVE nada sai daqui.
async function sendPhotos(fields) {
  const names = fields.map(([k]) => k);
  const platforms = fields.filter(([k]) => k === 'platform[]').map(([, p]) => p);
  if (!config.uploadPost.live) return { simulated: true, status: 'simulado', fieldNames: names, results: platforms.map((p) => ({ platform: p, ok: true, simulated: true, status: 'simulado', url: null, error: null })) };
  if (!config.uploadPostConfigured) throw new Error('UPLOAD_POST_KEY não configurada.');
  const form = new FormData();
  for (const [k, v] of fields) form.append(k, String(v));
  const res = await fetch(api('/api/upload_photos'), { method: 'POST', headers: { ...headers(), 'Idempotency-Key': fields.find(([k]) => k === 'request_id')[1] }, body: form, signal: AbortSignal.timeout(120_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw fail(res, json);
  return { simulated: false, request_id: json.request_id || fields.find(([k]) => k === 'request_id')[1], job_id: json.job_id || null, results: normalizeResults(json.results), done: Boolean(json.results), fieldNames: names };
}

// ---------------------------------------------------------------- leitura (insights, comentários, directs)
async function getJson(path, params = {}) {
  if (!config.uploadPostConfigured) throw new Error('UPLOAD_POST_KEY não configurada.');
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  const res = await fetch(api(`${path}${qs ? `?${qs}` : ''}`), { headers: headers(), signal: AbortSignal.timeout(20_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw fail(res, json);
  return json;
}

// Números da conta por rede: seguidores, visualizações, alcance, curtidas, comentários, compartilhamentos.
async function analytics(platforms) {
  if (!platforms.length) return {};
  const json = await getJson(`/api/analytics/${encodeURIComponent(config.uploadPost.user)}`, { platforms: platforms.join(',') });
  const out = {};
  for (const p of platforms) {
    const d = json[p];
    if (!d || typeof d !== 'object') continue;
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    out[p] = { followers: n(d.followers), views: n(d.views ?? d.impressions), reach: n(d.reach), likes: n(d.likes), comments: n(d.comments), shares: n(d.shares), saves: n(d.saves), profileViews: n(d.profileViews) };
  }
  return out;
}

async function listComments({ platform = 'instagram', postId = null, postUrl = null, limit = 50 }) {
  const json = await getJson('/api/uploadposts/comments', { platform, user: config.uploadPost.user, post_id: postId, post_url: postUrl, limit });
  return (json.comments || []).map((c) => ({ id: String(c.id), text: c.text || '', timestamp: c.timestamp || null, userId: c.user?.id || null, username: c.user?.username || '' }));
}

async function recentMedia({ platform = 'instagram', limit = 10 }) {
  const json = await getJson('/api/uploadposts/media', { platform, user: config.uploadPost.user, limit });
  return (json.media || []).map((m) => ({ id: String(m.id), caption: m.caption || '', permalink: m.permalink || null, timestamp: m.timestamp || null, type: m.media_type || null }));
}

async function dmConversations() {
  const json = await getJson('/api/uploadposts/dms/conversations', { platform: 'instagram', user: config.uploadPost.user });
  return (json.conversations || []).map((c) => ({
    id: c.id, participants: (c.participants?.data || []).map((p) => ({ id: p.id, username: p.username || '' })),
    messages: (c.messages?.data || []).map((m) => ({ id: m.id, at: m.created_time || null, fromId: m.from?.id || null, from: m.from?.username || '', text: m.message || '' })),
  }));
}

// ---------------------------------------------------------------- escrita (respostas, directs, edição) — sem UPLOAD_POST_LIVE, simulado
async function postJson(path, body) {
  if (!config.uploadPost.live) return { simulated: true };
  if (!config.uploadPostConfigured) throw new Error('UPLOAD_POST_KEY não configurada.');
  const res = await fetch(api(path), { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ user: config.uploadPost.user, ...body }), signal: AbortSignal.timeout(30_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw fail(res, json);
  return { simulated: false, ...json };
}
const cleanButtons = (buttons) => (buttons || []).filter((b) => b && b.title && /^https?:\/\//.test(b.url || '')).slice(0, 3).map((b) => ({ type: 'web_url', title: String(b.title).slice(0, 20), url: b.url }));
// Resposta pública a um comentário (Instagram só aceita resposta, não comentário solto).
const replyComment = ({ platform = 'instagram', commentId, message }) => postJson('/api/uploadposts/comments/create', { platform, comment_id: commentId, message });
// Direct para quem comentou (Instagram, comentário com menos de 7 dias).
const privateReply = ({ commentId, message, buttons }) => postJson('/api/uploadposts/comments/reply', { platform: 'instagram', comment_id: commentId, message, ...(cleanButtons(buttons).length ? { buttons: cleanButtons(buttons) } : {}) });
// Direct para quem escreveu antes (janela de 24 h da Meta).
const sendDm = ({ recipientId, message, buttons }) => postJson('/api/uploadposts/dms/send', { platform: 'instagram', recipient_id: recipientId, message, ...(cleanButtons(buttons).length ? { buttons: cleanButtons(buttons) } : {}) });

// Editar um post já publicado. Instagram, TikTok e Threads não deixam (limite das próprias redes).
const EDITABLE = { youtube: true, facebook: true, linkedin: true, x: true };
function editPost({ platform, postId, title, description }) {
  if (!EDITABLE[platform]) throw new Error(`${PLATFORMS[platform]?.label || platform} não permite editar um post publicado pela API. Edite pelo app da rede.`);
  const body = { platform, post_id: postId };
  if (platform === 'youtube') Object.assign(body, { title, description });
  else if (platform === 'facebook') body.message = description || title;
  else if (platform === 'linkedin') body.commentary = description || title;
  else if (platform === 'x') body.text = description || title;
  return postJson('/api/uploadposts/posts/edit', body);
}

module.exports = {
  PLATFORMS, DEFAULTS, MAX_LINK_SECONDS, PHOTO_PLATFORMS, EDITABLE, connected, resetCache, validate, buildFields, normalizeResults, send, status,
  validatePhotos, buildPhotoFields, sendPhotos, analytics, listComments, recentMedia, dmConversations, replyComment, privateReply, sendDm, editPost, cleanButtons,
};
