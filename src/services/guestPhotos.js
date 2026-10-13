// Foto do convidado: uma moldura única (4:3, 1200×900) para a plateia, o media kit, o portal do patrocinador e o painel.
// O recorte é feito no navegador na hora do envio (public/cropper.js), então toda foto nova já chega nessa moldura.
//
// Media kit e portal não conversam por cookie (o kit roda isolado), então a foto vai por endereço assinado e com validade:
// o servidor só assina o endereço dos convidados que ele mesmo decidiu mostrar naquela página.
const crypto = require('crypto');
const config = require('../config');
const b2 = require('./b2');
const db = require('../db/pool');

const FRAME = { ratio: '4:3', width: 1200, height: 900 };
const TTL_SECONDS = 24 * 3600;

const mac = (id, exp) => crypto.createHmac('sha256', config.sessionSecret).update(`foto-convidado:${id}:${exp}`).digest('base64url').slice(0, 32);

// Endereço assinado da foto (vale 24 h; o media kit e o portal geram de novo a cada abertura).
function signedUrl(id, now = Date.now()) {
  const exp = Math.floor(now / 1000) + TTL_SECONDS;
  return `/agenda/foto/${Number(id)}?e=${exp}&s=${mac(Number(id), exp)}`;
}

function verify(id, exp, sig, now = Date.now()) {
  if (!/^\d{1,9}$/.test(String(id)) || !/^\d{9,12}$/.test(String(exp)) || typeof sig !== 'string' || sig.length !== 32) return false;
  if (Number(exp) * 1000 < now) return false;
  const want = Buffer.from(mac(Number(id), Number(exp)));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// Responde com a foto (o bucket é privado: tudo passa por aqui). Devolve false se não houver foto.
async function send(res, guestId) {
  const { rows: [g] } = await db.query('SELECT photo_key FROM guests WHERE id = $1 AND photo_key IS NOT NULL', [guestId]);
  const obj = g ? await b2.getObject(g.photo_key).catch(() => null) : null;
  if (!obj) return false;
  res.set({
    'Content-Type': obj.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.send(Buffer.from(await obj.arrayBuffer()));
  return true;
}

module.exports = { FRAME, signedUrl, verify, send };
