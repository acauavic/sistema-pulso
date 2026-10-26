// Backblaze B2 pela API S3 (assinatura AWS SigV4 própria, sem SDK). Bucket privado: os arquivos só saem por este servidor.
// O endereço S3 (ex.: https://s3.us-east-005.backblazeb2.com) é descoberto com b2_authorize_account usando a própria chave.
const crypto = require('crypto');
const config = require('../config');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const EMPTY_HASH = sha256('');

// RFC 3986, como a AWS exige (encodeURIComponent deixa passar ! ' ( ) *).
const uriEncode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// Assina uma requisição (função pura, testada com o exemplo oficial da documentação da AWS).
function signRequest({ method, host, path, query = {}, headers = {}, payloadHash, accessKey, secretKey, region, service = 's3', amzDate }) {
  const date = amzDate.slice(0, 8);
  const all = { ...headers, host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(all).map((n) => n.toLowerCase()).sort();
  const byName = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const canonicalHeaders = names.map((n) => `${n}:${byName[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalQuery = Object.keys(query).sort().map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`).join('&');
  const canonicalPath = path.split('/').map((seg) => uriEncode(decodeURIComponent(seg))).join('/');
  const canonicalRequest = [method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return {
    signature,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// { endpoint, prefix }: endereço S3 e o prefixo obrigatório dos nomes (chaves restritas só gravam "<prefixo>…").
let infoPromise = null;
function info() {
  infoPromise ??= (async () => {
    let endpoint = config.b2.endpoint;
    let namePrefix = config.b2.prefix || '';
    if (!endpoint || !namePrefix) {
      const res = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
        headers: { Authorization: `Basic ${Buffer.from(`${config.b2.keyId}:${config.b2.appKey}`).toString('base64')}` },
        signal: AbortSignal.timeout(15_000),
      });
      const json = await res.json().catch(() => ({}));
      const storage = json.apiInfo?.storageApi;
      if (!res.ok || !storage?.s3ApiUrl) throw new Error(`Backblaze recusou a chave (${json.code || res.status}).`);
      endpoint = endpoint || storage.s3ApiUrl;
      namePrefix = namePrefix || storage.namePrefix || '';
    }
    return { endpoint: endpoint.replace(/\/+$/, ''), prefix: (namePrefix || 'pulso').replace(/\/+$/, '') };
  })().catch((err) => { infoPromise = null; throw err; });
  return infoPromise;
}
const endpoint = () => info().then((i) => i.endpoint);

// Nome do objeto: "<prefixo>/<partes>". Ex.: keyFor('patrocinadores', 3, 'logo.png') -> "pp/patrocinadores/3/logo.png"
async function keyFor(...parts) {
  return [(await info()).prefix, ...parts].join('/');
}

const encodePath = (path) => path.split('/').map((seg) => uriEncode(decodeURIComponent(seg))).join('/');
const queryString = (query) => Object.keys(query).sort().map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`).join('&');

// Erro do Backblaze com motivo reconhecível. STORAGE_FULL: o limite de armazenamento da conta (Caps & Alerts) foi atingido;
// repetir não adianta até a conta ganhar espaço.
function b2Error(message, status, body = '') {
  const err = new Error(`${message} (${status}): ${String(body).slice(0, 200)}`);
  err.status = status;
  if (status === 403 && /cap exceeded|Cannot upload files|storage cap/i.test(body)) err.code = 'STORAGE_FULL';
  return err;
}

async function request(method, key, { body, contentType, query = {}, timeout = 60_000, bucketLevel = false, headers = {} } = {}) {
  if (!config.storageConfigured) throw new Error('Armazenamento não configurado (BB_KEY_ID, BB_APPLICATION_KEY, BUCKET_NAME).');
  const base = new URL(await endpoint());
  const region = base.hostname.match(/^s3\.([a-z0-9-]+)\./)?.[1] || 'us-east-005';
  const path = bucketLevel ? `/${config.b2.bucket}` : `/${config.b2.bucket}/${key}`;
  const payloadHash = body ? sha256(body) : EMPTY_HASH;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const extra = { ...(contentType ? { 'content-type': contentType } : {}), ...headers };
  const { authorization } = signRequest({
    method, host: base.host, path, query, headers: extra, payloadHash, accessKey: config.b2.keyId, secretKey: config.b2.appKey, region, amzDate,
  });
  const qs = Object.keys(query).length ? `?${queryString(query)}` : '';
  return fetch(`${base.origin}${encodePath(path)}${qs}`, {
    method,
    headers: { ...extra, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, Authorization: authorization },
    body,
    signal: AbortSignal.timeout(timeout),
  });
}

async function putObject(key, body, contentType) {
  const res = await request('PUT', key, { body, contentType });
  if (!res.ok) throw b2Error('Backblaze recusou o envio', res.status, await res.text());
}

// Devolve a Response do fetch (o chamador faz o stream); 404 vira null.
async function getObject(key) {
  const res = await request('GET', key);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Backblaze recusou a leitura (${res.status}).`);
  return res;
}

async function deleteObject(key) {
  const res = await request('DELETE', key);
  if (!res.ok && res.status !== 404) throw new Error(`Backblaze recusou a exclusão (${res.status}).`);
}

// ---- URL pré-assinada (SigV4 na query): o navegador baixa/reproduz direto do bucket privado, sem passar pelo servidor ----
function presignUrl({ method = 'GET', host, path, query = {}, expires = 900, accessKey, secretKey, region, amzDate, service = 's3' }) {
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${region}/${service}/aws4_request`;
  const q = { ...query, 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${accessKey}/${scope}`, 'X-Amz-Date': amzDate, 'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': 'host' };
  const canonicalQuery = queryString(q);
  const canonicalRequest = [method, encodePath(path), canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return { query: `${canonicalQuery}&X-Amz-Signature=${signature}`, signature };
}

// Link temporário de leitura (padrão 15 min). `download`: força o download com esse nome; senão abre/reproduz inline.
async function presignGet(key, { expires = 900, download = null, contentType = null } = {}) {
  const base = new URL(await endpoint());
  const region = base.hostname.match(/^s3\.([a-z0-9-]+)\./)?.[1] || 'us-east-005';
  const path = `/${config.b2.bucket}/${key}`;
  const query = {};
  if (download) query['response-content-disposition'] = `attachment; filename*=UTF-8''${uriEncode(download)}`;
  if (contentType) query['response-content-type'] = contentType;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const { query: signed } = presignUrl({ host: base.host, path, query, expires, accessKey: config.b2.keyId, secretKey: config.b2.appKey, region, amzDate });
  return `${base.origin}${encodePath(path)}?${signed}`;
}

// ---- CORS do bucket: é o que deixa o NAVEGADOR enviar as partes direto ao Backblaze (ver presignPart e services/directUpload.js) ----
// Regra única: a origem do painel pode fazer PUT e ler o ETag. Estado: 'ligado' | 'desligado' | 'outra' (há regras, mas não a nossa) | 'erro'.
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function corsRulesXml(origin) {
  return `<CORSConfiguration><CORSRule><AllowedOrigin>${xmlEsc(origin)}</AllowedOrigin><AllowedMethod>PUT</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>`;
}
async function corsStatus(origin) {
  try {
    const res = await request('GET', '', { bucketLevel: true, query: { cors: '' }, timeout: 15_000 });
    const text = await res.text();
    if (res.status === 404 || /NoSuchCorsConfiguration/.test(text)) return { state: 'desligado' };
    if (!res.ok) return { state: 'erro', error: `${res.status}: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}` };
    const rules = [...text.matchAll(/<CORSRule>([\s\S]*?)<\/CORSRule>/g)].map((m) => m[1]);
    const ours = rules.some((r) => (r.includes(`<AllowedOrigin>${origin}</AllowedOrigin>`) || r.includes('<AllowedOrigin>*</AllowedOrigin>')) && /<AllowedMethod>PUT<\/AllowedMethod>/.test(r) && /<ExposeHeader>ETag<\/ExposeHeader>/i.test(r));
    return { state: ours ? 'ligado' : (rules.length ? 'outra' : 'desligado') };
  } catch (err) { return { state: 'erro', error: err.message }; }
}
async function putCors(origin) {
  const body = Buffer.from(corsRulesXml(origin));
  const res = await request('PUT', '', { bucketLevel: true, query: { cors: '' }, body, contentType: 'application/xml', headers: { 'content-md5': crypto.createHash('md5').update(body).digest('base64') }, timeout: 20_000 });
  if (!res.ok) throw b2Error('O Backblaze não deixou ligar o CORS do bucket', res.status, (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}
async function deleteCors() {
  const res = await request('DELETE', '', { bucketLevel: true, query: { cors: '' }, timeout: 20_000 });
  if (!res.ok && res.status !== 404) throw b2Error('O Backblaze não deixou desligar o CORS do bucket', res.status, (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}

// Link temporário para o NAVEGADOR enviar uma parte direto ao bucket (sem passar pelo servidor): PUT assinado, válido por `expires` s.
// Exige CORS no bucket (PUT, expondo o cabeçalho ETag) para a origem do painel; sem ele o navegador recusa e o painel volta ao envio pelo servidor.
async function presignPart(key, uploadId, partNumber, { expires = 6 * 3600 } = {}) {
  const base = new URL(await endpoint());
  const region = base.hostname.match(/^s3\.([a-z0-9-]+)\./)?.[1] || 'us-east-005';
  const path = `/${config.b2.bucket}/${key}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const { query: signed } = presignUrl({ method: 'PUT', host: base.host, path, query: { partNumber: String(partNumber), uploadId }, expires, accessKey: config.b2.keyId, secretKey: config.b2.appKey, region, amzDate });
  return `${base.origin}${encodePath(path)}?${signed}`;
}

// ---- upload em partes (arquivos grandes: 5 MB a 5 GB por parte, no máximo 10.000 partes) ----
const xmlValue = (xml, tag) => xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1];

async function createMultipart(key, contentType) {
  const res = await request('POST', key, { contentType, query: { uploads: '' } });
  const xml = await res.text();
  const uploadId = xmlValue(xml, 'UploadId');
  if (!res.ok || !uploadId) throw b2Error('Backblaze recusou iniciar o envio', res.status, xml);
  return uploadId;
}

async function uploadPart(key, uploadId, partNumber, body) {
  const res = await request('PUT', key, { body, query: { partNumber: String(partNumber), uploadId }, timeout: 300_000 });
  if (!res.ok) throw b2Error(`Backblaze recusou a parte ${partNumber}`, res.status, await res.text());
  const etag = res.headers.get('etag');
  if (!etag) throw new Error(`Backblaze não devolveu o ETag da parte ${partNumber}.`);
  return etag;
}

async function completeMultipart(key, uploadId, parts) {
  const xml = `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.number}</PartNumber><ETag>${p.etag}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
  const res = await request('POST', key, { body: Buffer.from(xml), contentType: 'application/xml', query: { uploadId }, timeout: 120_000 });
  const text = await res.text();
  if (!res.ok || /<Error>/.test(text)) throw b2Error('Backblaze recusou concluir o envio', res.ok ? 403 : res.status, text);
}

async function abortMultipart(key, uploadId) {
  const res = await request('DELETE', key, { query: { uploadId } });
  if (!res.ok && res.status !== 404) throw new Error(`Backblaze recusou cancelar o envio (${res.status}).`);
}

// Tamanho e tipo de um objeto (HEAD).
async function headObject(key) {
  const res = await request('HEAD', key);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Backblaze recusou a consulta (${res.status}).`);
  return { size: Number(res.headers.get('content-length')), contentType: res.headers.get('content-type') };
}

module.exports = { b2Error, presignUrl, presignGet, presignPart, corsRulesXml, corsStatus, putCors, deleteCors, createMultipart, uploadPart, completeMultipart, abortMultipart, headObject, signRequest, uriEncode, putObject, getObject, deleteObject, endpoint, keyFor };
