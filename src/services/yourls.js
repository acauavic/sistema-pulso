// Encurtador YOURLS (link.podcastpulso.com). Autenticação "passwordless" por assinatura (YOURLS_KEY).
// Chamada via POST (form) para a assinatura não ir parar em log de acesso/URL.
const crypto = require('crypto');
const config = require('../config');
const { slugify } = require('../utils/format');

async function call(params) {
  if (!config.yourlsConfigured) throw new Error('YOURLS não configurado (YOURLS_LINK, YOURLS_KEY).');
  const res = await fetch(`${config.yourls.base}/yourls-api.php`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, signature: config.yourls.key, format: 'json' }),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`YOURLS respondeu algo inesperado (HTTP ${res.status}).`);
  }
  return json;
}

const isKeywordTaken = (json) =>
  json && (json.code === 'error:keyword' || /already exists|reserved/i.test(json.message || ''));

// Mesma convenção dos links feitos à mão: nome curto do convidado (link.podcastpulso.com/passeto).
// Ordem: "maria" -> "mariasouza" -> "maria-x7k2" (se ocupadas) -> keyword automática do YOURLS.
function keywordCandidates(guestName, random = () => crypto.randomBytes(2).toString('hex')) {
  const words = String(guestName || '').trim().split(/\s+/).map((w) => slugify(w)).filter(Boolean);
  const first = words[0] || 'convite';
  const list = [first];
  if (words.length > 1) list.push(`${first}${words[words.length - 1]}`);
  list.push(`${first}-${random()}`);
  return [...new Set(list)];
}

// Gera um link curto para `longUrl`.
async function shorten(longUrl, { title, guestName } = {}) {
  for (const keyword of keywordCandidates(guestName)) {
    const json = await call({ action: 'shorturl', url: longUrl, keyword, title: title || '' });
    if (json.shorturl) return { shortUrl: json.shorturl, keyword: json.url?.keyword || keyword };
    if (!isKeywordTaken(json)) throw new Error(`YOURLS: ${json.message || json.code || 'falha ao encurtar'}`);
  }
  const json = await call({ action: 'shorturl', url: longUrl, title: title || '' });
  if (json.shorturl) return { shortUrl: json.shorturl, keyword: json.url?.keyword || null };
  throw new Error(`YOURLS: ${json.message || 'falha ao encurtar'}`);
}

// Teste de conexão/assinatura sem escrever nada.
async function ping() {
  const json = await call({ action: 'db-stats' });
  if (json.statusCode && Number(json.statusCode) >= 400) throw new Error(`YOURLS: ${json.message || 'assinatura inválida'}`);
  if (!json['db-stats'] && json.status === 'fail') throw new Error(`YOURLS: ${json.message || 'falha'}`);
  return json['db-stats'] || json;
}

module.exports = { shorten, ping, keywordCandidates };
