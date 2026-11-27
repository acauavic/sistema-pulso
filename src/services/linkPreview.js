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

// IPv6 em 8 blocos de 16 bits (aceita "::", zona "%eth0" e IPv4 no fim); null se não for IPv6 válido.
function expandIpv6(ip) {
  let v = String(ip).toLowerCase().replace(/%.*$/, '');
  const dotted = v.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const p = dotted[1].split('.').map(Number);
    if (p.some((n) => n > 255)) return null;
    v = v.slice(0, -dotted[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = v.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const all = [...left, ...Array(fill).fill('0'), ...right];
  if (all.length !== 8 || all.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  return all.map((x) => parseInt(x, 16));
}

// IP que não é da internet pública: privado, loopback, link-local (inclui 169.254.169.254 da nuvem), CGNAT, multicast, reservado.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const h = expandIpv6(ip);
    if (!h) return true;
    const v4 = (hi, lo) => `${h[hi] >> 8}.${h[hi] & 255}.${h[lo] >> 8}.${h[lo] & 255}`;
    const zeros = (n) => h.slice(0, n).every((x) => x === 0);
    if (zeros(8)) return true; // ::
    if (zeros(7) && h[7] === 1) return true; // ::1
    if (zeros(5) && h[5] === 0xffff) return isPrivateIp(v4(6, 7)); // ::ffff:a.b.c.d (em qualquer escrita, inclusive hexadecimal)
    if (zeros(6)) return isPrivateIp(v4(6, 7)); // ::a.b.c.d (compatível, antigo)
    if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return isPrivateIp(v4(6, 7)); // NAT64
    if (h[0] === 0x2002) return isPrivateIp(v4(1, 2)); // 6to4 leva um IPv4 dentro
    if (h[0] === 0x2001 && h[1] === 0) return true; // Teredo
    if (h[0] === 0x2001 && h[1] === 0xdb8) return true; // documentação
    if (h[0] === 0x100 && zeros(0) && h.slice(1, 4).every((x) => x === 0)) return true; // descarte (100::/64)
    return (h[0] & 0xfe00) === 0xfc00 || (h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xff00) === 0xff00; // fc00::/7, fe80::/10, ff00::/8
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
const inflight = new Map(); // o mesmo link pedido junto (várias abas, vários comentários) busca a página uma vez
function preview(rawUrl) {
  const key = String(rawUrl || '');
  if (!inflight.has(key)) inflight.set(key, previewNow(rawUrl).finally(() => inflight.delete(key)));
  return inflight.get(key);
}
async function previewNow(rawUrl) {
  const url = cleanUrl(rawUrl);
  if (!url) return { ok: false, url: String(rawUrl || ''), error: 'Link inválido.' };
  const { rows: [cached] } = await db.query('SELECT * FROM link_previews WHERE url = $1', [url]);
  if (cached && (Date.now() - new Date(cached.fetched_at).getTime()) / 1000 < (cached.ok ? TTL_OK : TTL_FAIL)) return { ok: cached.ok, url, title: cached.title, description: cached.description, image: cached.image, site: cached.site };
  let result = { ok: false, title: null, description: null, image: null, site: null };
  try {
    // limite total (DNS, redirecionamentos e página que manda os bytes aos poucos): 8 s; o limite de cada conexão é só de silêncio
    let t; const res = await Promise.race([fetcher(url), new Promise((_, reject) => { t = setTimeout(() => reject(Object.assign(new Error('A página demorou demais.'), { code: 'ETIMEDOUT' })), 8000); })]).finally(() => clearTimeout(t));
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
