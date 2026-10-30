// Miniatura de link (título, resumo e imagem) para as tarefas e comentários. O servidor busca a página, então a busca é blindada:
// só http/https nas portas 80 e 443, e o endereço é conferido NA HORA da conexão (nada de rede interna, localhost nem nuvem) —
// valendo também a cada redirecionamento. Limites de tamanho e de tempo; o resultado fica em cache no banco.
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const db = require('../db/pool');

const TTL_OK = 7 * 24 * 3600;
const TTL_FAIL = 24 * 3600;
const MAX_BYTES = 400 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 5000;

// IP que não é da internet pública: privado, loopback, link-local (inclui 169.254.169.254 da nuvem), CGNAT, multicast, reservado.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff') || v.startsWith('2001:db8');
  }
  return true;
}

// lookup do Node, mas recusando qualquer endereço que não seja público (vale para IP direto e para DNS).
function safeLookup(hostname, options, cb) {
  const done = typeof options === 'function' ? options : cb;
  const opts = typeof options === 'function' ? {} : options;
  const check = (addrs) => {
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return done(Object.assign(new Error('Endereço não permitido.'), { code: 'EBLOCKED' }));
    return opts.all ? done(null, addrs) : done(null, addrs[0].address, addrs[0].family);
  };
  if (net.isIP(hostname)) return check([{ address: hostname, family: net.isIPv4(hostname) ? 4 : 6 }]);
  return dns.lookup(hostname, { all: true }, (err, addrs) => (err ? done(err) : check(addrs)));
}

// GET com limite de bytes e de redirecionamentos. Devolve { status, headers, body (Buffer), url } ou lança erro.
function safeGet(rawUrl, { accept = 'text/html,application/xhtml+xml', maxBytes = MAX_BYTES, redirects = MAX_REDIRECTS } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(rawUrl); } catch { return reject(new Error('Endereço inválido.')); }
    if (!['http:', 'https:'].includes(u.protocol)) return reject(new Error('Só links http e https.'));
    if (u.username || u.password) return reject(new Error('Link com usuário e senha não é permitido.'));
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    if (!['80', '443'].includes(port)) return reject(new Error('Porta não permitida.'));
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isPrivateIp(host)) return reject(Object.assign(new Error('Endereço não permitido.'), { code: 'EBLOCKED' })); // o Node não chama o lookup para IP direto: confere aqui
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(u, { lookup: safeLookup, timeout: TIMEOUT_MS, headers: { 'user-agent': 'PulsoGestaoBot/1.0 (+previa de link)', accept, 'accept-encoding': 'identity', 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.5' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('Redirecionamentos demais.'));
        let next; try { next = new URL(res.headers.location, u).href; } catch { return reject(new Error('Redirecionamento inválido.')); }
        return resolve(safeGet(next, { accept, maxBytes, redirects: redirects - 1 }));
      }
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > maxBytes) { res.destroy(); resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), url: u.href, truncated: true }); } else chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), url: u.href }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('A página demorou demais.'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
  });
}

let fetcher = safeGet; // trocável nos testes (o teste não sai para a internet)
const setFetcher = (fn) => { fetcher = fn || safeGet; };

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)));
const clip = (s, n) => { const t = decode(s).replace(/\s+/g, ' ').trim(); return t ? t.slice(0, n) : null; };

function meta(html, ...names) {
  for (const name of names) {
    const re = new RegExp(`<meta\\s[^>]*(?:property|name)=["']${name}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=(?:"([^"]*)"|'([^']*)')/i);
    if (content) return content[1] ?? content[2];
  }
  return null;
}

function parse(html, pageUrl) {
  const head = String(html).slice(0, 200_000);
  const title = clip(meta(head, 'og:title', 'twitter:title') || head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], 160);
  const description = clip(meta(head, 'og:description', 'twitter:description', 'description'), 280);
  let image = null;
  const rawImg = meta(head, 'og:image:secure_url', 'og:image', 'twitter:image');
  if (rawImg) { try { const i = new URL(decode(rawImg), pageUrl); if (i.protocol === 'https:' && i.href.length <= 1000) image = i.href; } catch { /* imagem inválida */ } }
  const site = clip(meta(head, 'og:site_name'), 60) || new URL(pageUrl).hostname.replace(/^www\./, '');
  return { title, description, image, site };
}

const cleanUrl = (raw) => { try { const u = new URL(String(raw || '').trim()); return ['http:', 'https:'].includes(u.protocol) && u.href.length <= 1500 ? u.href : null; } catch { return null; } };

// Devolve { ok, url, title, description, image, site } (ok:false = não deu para ler a página: a tela fica só com o link).
async function preview(rawUrl) {
  const url = cleanUrl(rawUrl);
  if (!url) return { ok: false, url: String(rawUrl || ''), error: 'Link inválido.' };
  const { rows: [cached] } = await db.query('SELECT * FROM link_previews WHERE url = $1', [url]);
  if (cached && (Date.now() - new Date(cached.fetched_at).getTime()) / 1000 < (cached.ok ? TTL_OK : TTL_FAIL)) return { ok: cached.ok, url, title: cached.title, description: cached.description, image: cached.image, site: cached.site };
  let result = { ok: false, title: null, description: null, image: null, site: null };
  try {
    const res = await fetcher(url);
    const type = String(res.headers['content-type'] || '');
    if (res.status >= 200 && res.status < 300 && /html/i.test(type)) {
      const p = parse(res.body.toString('utf8'), res.url || url);
      result = { ok: Boolean(p.title || p.description || p.image), ...p };
    }
  } catch (err) { if (err.code !== 'EBLOCKED') console.error('[previa-link]', err.message); }
  await db.query(
    `INSERT INTO link_previews (url, ok, title, description, image, site, fetched_at) VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (url) DO UPDATE SET ok = EXCLUDED.ok, title = EXCLUDED.title, description = EXCLUDED.description, image = EXCLUDED.image, site = EXCLUDED.site, fetched_at = now()`,
    [url, result.ok, result.title, result.description, result.image, result.site]);
  return { url, ...result };
}

const purge = () => db.query("DELETE FROM link_previews WHERE fetched_at < now() - interval '30 days'");

module.exports = { preview, parse, safeGet, safeLookup, isPrivateIp, cleanUrl, setFetcher, purge };
