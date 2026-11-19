// Imagens para o site público (podcastpulso.com): o build do site baixa foto de convidado, logo de patrocinador e capa de post
// por endereço ABSOLUTO assinado e com validade (24 h). A assinatura prende o tipo e o id: a de uma foto não abre uma logo.
const crypto = require('crypto');
const config = require('../config');

const KINDS = ['foto', 'logo', 'capa'];
const TTL_SECONDS = 24 * 3600;

const mac = (kind, id, exp) => crypto.createHmac('sha256', config.sessionSecret).update(`site-imagem:${kind}:${id}:${exp}`).digest('base64url').slice(0, 32);

function signedUrl(kind, id, now = Date.now()) {
  if (!KINDS.includes(kind)) throw new Error(`Tipo de imagem desconhecido: ${kind}`);
  const exp = Math.floor(now / 1000) + TTL_SECONDS;
  return `${config.appBaseUrl}/api/site/v1/imagem/${kind}/${Number(id)}?e=${exp}&s=${mac(kind, Number(id), exp)}`;
}

function verify(kind, id, exp, sig, now = Date.now()) {
  if (!KINDS.includes(kind) || !/^\d{1,9}$/.test(String(id)) || !/^\d{9,12}$/.test(String(exp)) || typeof sig !== 'string' || sig.length !== 32) return false;
  if (Number(exp) * 1000 < now) return false;
  const want = Buffer.from(mac(kind, Number(id), Number(exp)));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

module.exports = { KINDS, signedUrl, verify };
