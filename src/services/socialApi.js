// Provedor de publicação nas redes: Upload-Post, Zernio ou Outstand, escolhido pela gestão em Integrações (app_settings.social_provider).
// As telas e a publicação usam só esta camada; cada publicação guarda por qual provedor saiu (episode_publications.provider),
// e o andamento é consultado sempre nele, mesmo que a escolha mude depois.
// Insights, comentários, directs e automações continuam pelo Upload-Post.
const config = require('../config');
const settings = require('./settings');
const up = require('./uploadPost');
const zn = require('./zernio');
const ost = require('./outstand');

const PROVIDERS = {
  uploadpost: {
    id: 'uploadpost', label: 'Upload-Post', by: 'pelo Upload-Post', to: 'ao Upload-Post', at: 'no Upload-Post', of: 'do Upload-Post', env: 'UPLOAD_POST_KEY', liveEnv: 'UPLOAD_POST_LIVE',
    configured: () => config.uploadPostConfigured, live: () => config.uploadPost.live,
    connected: (o) => up.connected(o), resetCache: () => up.resetCache(),
    sendVideo: (args) => up.send(up.buildFields(args)),
    sendPhotos: (args) => up.sendPhotos(up.buildPhotoFields(args)),
    status: ({ request_id, job_id }) => up.status({ request_id, job_id: request_id ? null : job_id }),
    canEdit: true,
  },
  outstand: {
    id: 'outstand', label: 'Outstand', by: 'pela Outstand', to: 'à Outstand', at: 'na Outstand', of: 'da Outstand', env: 'OUTSTAND_API_KEY', liveEnv: 'OUTSTAND_LIVE',
    configured: () => config.outstandConfigured, live: () => config.outstand.live,
    connected: (o) => ost.connected(o), resetCache: () => ost.resetCache(),
    sendVideo: async (args) => {
      // o TikTok não baixa do Backblaze (domínio não verificado no app dele): o vídeo vai antes para o armazenamento da Outstand
      if (config.outstand.live && args.platforms.includes('tiktok') && args.videoUrl) {
        try { args = { ...args, videoUrl: await ost.hostMedia(args.videoUrl, { filename: ost.fileOf(args.videoUrl, 'corte.mp4') }) }; } catch (err) { console.error('[outstand] não consegui hospedar o vídeo para o TikTok:', err.message); }
      }
      return ost.send(ost.buildPost({ ...args, tiktokMode: await ost.tiktokMode(), processMedia: await ost.processMedia() }));
    },
    sendPhotos: async (args) => ost.send(ost.buildPhotoPost({ ...args, tiktokMode: await ost.tiktokMode() })),
    status: ({ request_id, job_id }) => ost.status({ request_id, job_id }),
    canEdit: false, // a Outstand só edita post que ainda não saiu (e o agendamento é nosso): depois de publicado, edite pelo app da rede
  },
  zernio: {
    id: 'zernio', label: 'Zernio', by: 'pela Zernio', to: 'à Zernio', at: 'na Zernio', of: 'da Zernio', env: 'ZERNIO_API_KEY', liveEnv: 'ZERNIO_LIVE',
    configured: () => config.zernioConfigured, live: () => config.zernio.live,
    connected: (o) => zn.connected(o), resetCache: () => zn.resetCache(),
    sendVideo: (args) => zn.send(zn.buildPost(args)),
    sendPhotos: (args) => zn.send(zn.buildPhotoPost(args)),
    status: ({ request_id }) => zn.status({ request_id }),
    canEdit: false, // editar um post já publicado ainda não é feito pela Zernio: edite pelo app da rede
  },
};
const ORDER = ['uploadpost', 'zernio', 'outstand'];

const get = (id) => PROVIDERS[id] || PROVIDERS.uploadpost;

// O escolhido em Integrações, se tiver chave; senão o primeiro configurado (Upload-Post antes, como sempre foi).
async function activeId() {
  const chosen = await settings.get('social_provider');
  if (PROVIDERS[chosen]?.configured()) return chosen;
  return ORDER.find((id) => PROVIDERS[id].configured()) || 'uploadpost';
}
const active = async () => get(await activeId());

// Resumo para as telas: qual provedor, se tem chave, se publica de verdade.
async function state() {
  const p = await active();
  return { id: p.id, label: p.label, configured: p.configured(), live: p.live() };
}

async function choose(id) {
  if (!PROVIDERS[id]) throw new Error('Provedor desconhecido.');
  if (!PROVIDERS[id].configured()) throw new Error(`${PROVIDERS[id].label} não está configurado neste servidor (falta ${PROVIDERS[id].env}).`);
  await settings.set('social_provider', id);
  PROVIDERS[id].resetCache();
}

const list = () => ORDER.map((id) => PROVIDERS[id]);

// ---- Uma rede por provedor: o provedor em uso é o padrão, e a gestão pode mandar redes específicas por outro (ex.: o X pela Zernio e o
// resto pela Outstand). app_settings.social_routes = JSON { rede: provedor }. Rota para provedor sem chave é ignorada (volta ao padrão).
const ROUTES_KEY = 'social_routes';
async function routes() {
  let raw = {};
  try { raw = JSON.parse((await settings.get(ROUTES_KEY)) || '{}') || {}; } catch { raw = {}; }
  return Object.fromEntries(Object.entries(raw).filter(([net, id]) => up.PLATFORMS[net] && PROVIDERS[id]));
}
async function setRoutes(map) {
  const clean = {};
  for (const [net, id] of Object.entries(map || {})) {
    if (!up.PLATFORMS[net] || !id) continue;
    if (!PROVIDERS[id]) throw new Error('Provedor desconhecido.');
    if (!PROVIDERS[id].configured()) throw new Error(`${PROVIDERS[id].label} não está configurado neste servidor (falta ${PROVIDERS[id].env}).`);
    clean[net] = id;
  }
  await settings.set(ROUTES_KEY, JSON.stringify(clean));
  PROVIDERS.uploadpost.resetCache(); PROVIDERS.zernio.resetCache(); PROVIDERS.outstand.resetCache();
  return clean;
}
// Mapa rede -> id do provedor que atende a rede agora.
async function routeMap() {
  const r = await routes(); const def = await activeId(); const out = {};
  for (const net of Object.keys(up.PLATFORMS)) out[net] = r[net] && PROVIDERS[r[net]].configured() ? r[net] : def;
  return out;
}
// Agrupa as redes escolhidas por provedor: [{ provider, platforms }], na ordem em que cada provedor aparece.
async function plan(platforms) {
  const map = await routeMap(); const groups = new Map();
  for (const net of platforms) { const id = map[net] || (await activeId()); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(net); }
  return [...groups].map(([id, nets]) => ({ provider: PROVIDERS[id], platforms: nets }));
}
// Contas conectadas por rede, cada uma vinda do provedor que atende a rede: { ok, platforms: { rede: { handle, reauth, provider… } }, errors }.
async function connectedAll({ force = false } = {}) {
  const map = await routeMap(); const ids = [...new Set(Object.values(map))];
  const conns = {};
  await Promise.all(ids.map(async (id) => { conns[id] = PROVIDERS[id].configured() ? await PROVIDERS[id].connected({ force }) : { ok: false, platforms: {}, error: `${PROVIDERS[id].env} não configurada.` }; }));
  const platforms = {};
  for (const [net, id] of Object.entries(map)) if (conns[id].platforms?.[net]) platforms[net] = { ...conns[id].platforms[net], provider: id };
  const errors = ids.filter((id) => !conns[id].ok).map((id) => ({ provider: id, label: PROVIDERS[id].label, error: conns[id].error }));
  return { ok: !errors.length, platforms, errors, error: errors.map((e) => `${e.label}: ${e.error}`).join(' · ') || undefined, routes: map };
}
// Algum provedor em uso (padrão ou rota) está em modo de teste? Para o aviso das telas de Social.
async function liveState() {
  const ids = [...new Set(Object.values(await routeMap()))];
  const test = ids.filter((id) => !PROVIDERS[id].live());
  return { live: !test.length, testAt: joinNames(test.map((id) => PROVIDERS[id].at)), testNames: joinNames(test.map((id) => PROVIDERS[id].label)), all: test.length === ids.length };
}
// Provedores por onde uma publicação saiu (ou vai sair): um, ou vários quando as redes foram divididas.
function providersOf(pub) {
  const ids = [...new Set(Object.values(pub.options?.routes || {}))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)); // o jsonb não guarda a ordem das chaves
  return (ids.length ? ids : [pub.provider]).map(get);
}
const joinNames = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} e ${items.at(-1)}` : items[0] || '');

// ---- publicar de verdade ou só simular: controlado pela gestão em Integrações (app_settings.social_live_<provedor>).
// A variável de ambiente (UPLOAD_POST_LIVE / ZERNIO_LIVE / OUTSTAND_LIVE) é só o padrão enquanto ninguém mexeu no painel.
// O valor efetivo fica em config.*.live; cada processo (painel e worker) relê o banco a cada 15 s, e na hora em quem mudou.
const LIVE_TARGET = { uploadpost: config.uploadPost, zernio: config.zernio, outstand: config.outstand };
const liveKey = (id) => `social_live_${id}`;
let syncedAt = 0;
async function syncLive({ force = false } = {}) {
  if (!force && Date.now() - syncedAt < 15_000) return;
  syncedAt = Date.now();
  for (const id of ORDER) {
    const v = await settings.get(liveKey(id));
    if (v === 'true' || v === 'false') LIVE_TARGET[id].live = v === 'true'; // sem escolha no painel: fica o da variável de ambiente
  }
}
// Onde a escolha atual veio: 'painel' ou 'ambiente'.
async function liveSource(id) {
  const v = await settings.get(liveKey(id));
  return v === 'true' || v === 'false' ? 'painel' : 'ambiente';
}
async function setLive(id, on) {
  if (!PROVIDERS[id]) throw new Error('Provedor desconhecido.');
  if (on && !PROVIDERS[id].configured()) throw new Error(`${PROVIDERS[id].label} não está configurado neste servidor (falta ${PROVIDERS[id].env}).`);
  await settings.set(liveKey(id), on ? 'true' : 'false');
  await syncLive({ force: true });
}

// Mensagem depois de criar uma publicação (o nome do provedor e a variável certa no modo de teste).
function sentMessage(pub, { trail = '' } = {}) {
  const ps = providersOf(pub);
  if (pub.status === 'revisao') return 'Enviado para a revisão da gestão. Você recebe um aviso quando for aprovado ou devolvido.';
  if (pub.status === 'simulado') return `Modo de teste: o pedido foi montado e conferido, mas NADA foi enviado ${joinNames(ps.map((x) => x.by))}. A publicação de verdade é ligada em Integrações > Redes sociais.`;
  if (pub.status === 'agendado') return 'Publicação agendada.';
  if (pub.status === 'erro') return `Não foi possível enviar: ${pub.error}`;
  return `Enviado ${joinNames(ps.map((x) => x.to))}.${trail}`;
}

module.exports = { syncLive, setLive, liveSource, sentMessage, PROVIDERS, PLATFORMS: up.PLATFORMS, DEFAULTS: up.DEFAULTS, MAX_LINK_SECONDS: up.MAX_LINK_SECONDS, get, active, activeId, state, choose, list, routes, setRoutes, routeMap, plan, connectedAll, providersOf, joinNames, liveState };
