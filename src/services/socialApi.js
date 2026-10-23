// Provedor de publicação nas redes: Upload-Post ou Zernio, escolhido pela gestão em Integrações (app_settings.social_provider).
// As telas e a publicação usam só esta camada; cada publicação guarda por qual provedor saiu (episode_publications.provider),
// e o andamento é consultado sempre nele, mesmo que a escolha mude depois.
// Insights, comentários, directs e automações continuam pelo Upload-Post.
const config = require('../config');
const settings = require('./settings');
const up = require('./uploadPost');
const zn = require('./zernio');

const PROVIDERS = {
  uploadpost: {
    id: 'uploadpost', label: 'Upload-Post', env: 'UPLOAD_POST_KEY', liveEnv: 'UPLOAD_POST_LIVE',
    configured: () => config.uploadPostConfigured, live: () => config.uploadPost.live,
    connected: (o) => up.connected(o), resetCache: () => up.resetCache(),
    sendVideo: (args) => up.send(up.buildFields(args)),
    sendPhotos: (args) => up.sendPhotos(up.buildPhotoFields(args)),
    status: ({ request_id, job_id }) => up.status({ request_id, job_id: request_id ? null : job_id }),
    canEdit: true,
  },
  zernio: {
    id: 'zernio', label: 'Zernio', env: 'ZERNIO_API_KEY', liveEnv: 'ZERNIO_LIVE',
    configured: () => config.zernioConfigured, live: () => config.zernio.live,
    connected: (o) => zn.connected(o), resetCache: () => zn.resetCache(),
    sendVideo: (args) => zn.send(zn.buildPost(args)),
    sendPhotos: (args) => zn.send(zn.buildPhotoPost(args)),
    status: ({ request_id }) => zn.status({ request_id }),
    canEdit: false, // editar um post já publicado ainda não é feito pela Zernio: edite pelo app da rede
  },
};
const ORDER = ['uploadpost', 'zernio'];

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

// ---- publicar de verdade ou só simular: controlado pela gestão em Integrações (app_settings.social_live_<provedor>).
// A variável de ambiente (UPLOAD_POST_LIVE / ZERNIO_LIVE) é só o padrão enquanto ninguém mexeu no painel.
// O valor efetivo fica em config.*.live; cada processo (painel e worker) relê o banco a cada 15 s, e na hora em quem mudou.
const LIVE_TARGET = { uploadpost: config.uploadPost, zernio: config.zernio };
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
  const p = get(pub.provider);
  if (pub.status === 'revisao') return 'Enviado para a revisão da gestão. Você recebe um aviso quando for aprovado ou devolvido.';
  if (pub.status === 'simulado') return `Modo de teste: o pedido foi montado e conferido, mas NADA foi enviado pelo ${p.label}. A publicação de verdade é ligada em Integrações > Redes sociais.`;
  if (pub.status === 'agendado') return 'Publicação agendada.';
  if (pub.status === 'erro') return `Não foi possível enviar: ${pub.error}`;
  return `Enviado ao ${p.label}.${trail}`;
}

module.exports = { syncLive, setLive, liveSource, sentMessage, PROVIDERS, PLATFORMS: up.PLATFORMS, DEFAULTS: up.DEFAULTS, MAX_LINK_SECONDS: up.MAX_LINK_SECONDS, get, active, activeId, state, choose, list };
