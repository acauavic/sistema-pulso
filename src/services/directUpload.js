// Envio direto do navegador ao Backblaze: o servidor só assina o link de cada parte e registra a parte quando o navegador confirma.
// Quem usa: arquivos do episódio (/episodios/:id/arquivos/:fid), cortes (/cortes/:id) e entregas de pedido. Sem CORS no bucket o
// navegador não consegue e o painel volta sozinho ao envio pelo servidor (rota PUT .../parte/:n), então ligar isto nunca atrapalha.
const config = require('../config');
const b2 = require('./b2');

const MAX_BATCH = 32;
const ETAG = /^"?[\w.:+\/=-]{3,128}"?$/; // o ETag de uma parte (hoje, o MD5 dela): só caracteres seguros, porque vai para o XML que fecha o arquivo

// Quantas partes tem o arquivo e quantos bytes a parte n deve ter.
function geometry(size, partSize) {
  const total = Math.max(1, Math.ceil(Number(size) / partSize));
  return { total, expected: (n) => (n < total ? partSize : Number(size) - partSize * (total - 1)) };
}

// GET .../urls?partes=1,2,3 -> { ok, direct, urls: { n: url } } (direct:false = use o envio pelo servidor)
async function urls({ key, uploadId, size, partSize, query }) {
  if (!config.uploadDirect || !config.storageConfigured) return { ok: true, direct: false, urls: {} };
  const { total } = geometry(size, partSize);
  const wanted = [...new Set(String(query || '').split(',').map((x) => Number.parseInt(x, 10)).filter((n) => Number.isInteger(n) && n >= 1 && n <= total))].slice(0, MAX_BATCH);
  const out = {};
  for (const n of wanted) out[n] = await b2.presignPart(key, uploadId, n);
  return { ok: true, direct: true, urls: out };
}

// POST .../parte/:n/ok { etag, size } -> valida e devolve { etag, size } para registrar, ou { error, status }
function confirm({ size, partSize, number, body }) {
  const { total, expected } = geometry(size, partSize);
  const n = Number.parseInt(number, 10);
  if (!Number.isInteger(n) || n < 1 || n > total) return { error: 'Parte inválida.', status: 400 };
  const etag = String(body?.etag || '').trim();
  if (!ETAG.test(etag)) return { error: 'O Backblaze não devolveu o ETag da parte.', status: 400 };
  if (Number(body?.size) !== expected(n)) return { error: `A parte ${n} deveria ter ${expected(n)} bytes e o envio informa ${Number(body?.size) || 0}.`, status: 400 };
  return { etag: etag.startsWith('"') ? etag : `"${etag}"`, size: expected(n) };
}

module.exports = { urls, confirm, geometry };
