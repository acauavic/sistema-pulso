// Encurtador YOURLS (link.podcastpulso.com). Autenticação "passwordless" por assinatura (YOURLS_KEY).
// Chamada via POST (form) para a assinatura não ir parar em log de acesso/URL.
const crypto = require('crypto');
const config = require('../config');
const { slugify } = require('../utils/format');

// Cada projeto tem o seu encurtador; o projeto padrão usa YOURLS_LINK/YOURLS_KEY. Projeto sem encurtador: o link
// inteiro continua valendo (quem chama trata o erro e segue).
function accountFor(projectId = null) {
  const projects = require('./projects');
  const p = projects.get(projectId == null ? projects.defaultId() : projectId);
  const own = p ? config.yourlsEnv(p.slug) : { base: '', key: '' };
  if (own.base && own.key) return own;
  if (p && p.id === projects.defaultId()) return config.yourls;
  return { base: '', key: '' };
}
const configuredFor = (projectId) => { const a = accountFor(projectId); return Boolean(a.base && a.key); };

async function call(params, { projectId = null } = {}) {
  const acc = accountFor(projectId);
  if (!acc.base || !acc.key) throw new Error('YOURLS não configurado (YOURLS_LINK, YOURLS_KEY).');
  const res = await fetch(`${acc.base}/yourls-api.php`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, signature: acc.key, format: 'json' }),
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
// keywords: nomes a tentar antes dos do convidado (ex.: o link do direct da comunidade).
async function shorten(longUrl, { title, guestName, keywords = [], projectId = null } = {}) {
  for (const keyword of [...new Set([...keywords, ...keywordCandidates(guestName)])]) {
    const json = await call({ action: 'shorturl', url: longUrl, keyword, title: title || '' }, { projectId });
    if (json.shorturl) return { shortUrl: json.shorturl, keyword: json.url?.keyword || keyword };
    if (!isKeywordTaken(json)) throw new Error(`YOURLS: ${json.message || json.code || 'falha ao encurtar'}`);
  }
  const json = await call({ action: 'shorturl', url: longUrl, title: title || '' }, { projectId });
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

// Total de cliques de um link curto (só leitura). null se o encurtador não souber dele.
async function clicks(shortUrl) {
  const json = await call({ action: 'url-stats', shorturl: String(shortUrl).replace(/\/+$/, '').split('/').pop() });
  const n = Number(json?.link?.clicks);
  return Number.isFinite(n) ? n : null;
}

// Para onde um link curto leva (só leitura). null se não for um link do encurtador.
async function expand(shortUrl) {
  const json = await call({ action: 'expand', shorturl: String(shortUrl).replace(/\/+$/, '').split('/').pop() });
  return json?.longurl || null;
}

const isOwnLink = (url) => {
  try { return new URL(url).host === new URL(config.yourls.base).host; } catch { return false; }
};

module.exports = { shorten, ping, keywordCandidates, clicks, expand, isOwnLink, accountFor, configuredFor };
