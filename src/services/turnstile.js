// Cloudflare Turnstile: o "não sou robô" das telas públicas (login, recuperar senha, link do estúdio, plateia e formulários do
// site). Sem as duas chaves (TURNSTILE_SITE_KEY e TURNSTILE_SECRET_KEY), fica desligado e tudo funciona como antes.
// Se o Cloudflare não responder, deixa passar (registra no log): os limites de tentativa continuam valendo, e uma falha deles
// não tranca a equipe fora do login.
const crypto = require('crypto');
const config = require('../config');

const ORIGIN = 'https://challenges.cloudflare.com';
const MESSAGE = 'Não conseguimos confirmar que você não é um robô. Espere a confirmação aparecer e tente de novo.';
let fetcher = (...a) => fetch(...a);

const on = () => Boolean(config.turnstile.siteKey && config.turnstile.secret);
const siteKey = () => (on() ? config.turnstile.siteKey : null);
// o widget põe o token num campo "cf-turnstile-response"; quem envia por fetch manda em "turnstile"
const tokenOf = (body) => (body && typeof body === 'object' ? body['cf-turnstile-response'] || body.turnstile || '' : '');

async function verify(token, ip) {
  if (!on()) return { ok: true, skipped: true };
  const t = typeof token === 'string' ? token.trim() : '';
  if (t.length > 2048) return { ok: false, codes: ['invalid-input-response'] };
  // sem token também pergunta ao Cloudflare: se ele estiver fora (o widget nem carregou para ninguém), deixa passar; no ar, recusa
  try {
    const body = new URLSearchParams({ secret: config.turnstile.secret, response: t, ...(ip ? { remoteip: ip } : {}) });
    const res = await fetcher(`${ORIGIN}/turnstile/v0/siteverify`, { method: 'POST', body, signal: AbortSignal.timeout(6000) });
    const j = await res.json();
    if (j.success) return { ok: true };
    const codes = Array.isArray(j['error-codes']) ? j['error-codes'] : [];
    if (codes.includes('internal-error')) { console.warn('[turnstile] erro interno do Cloudflare; segue com os limites de tentativa'); return { ok: true, degraded: true }; }
    return { ok: false, codes };
  } catch (err) {
    console.warn('[turnstile] sem resposta do Cloudflare; segue com os limites de tentativa:', err.message);
    return { ok: true, degraded: true };
  }
}

// Acrescenta o Cloudflare ao script-src e ao frame-src de uma CSP (o widget é um script + um iframe de lá). Diretiva que
// não existe herda o default-src antes de ganhar a origem, para não apertar o que já valia.
function withCsp(csp) {
  const dirs = String(csp).split(';').map((d) => d.trim()).filter(Boolean).map((d) => d.split(/\s+/));
  const get = (name) => dirs.find((d) => d[0] === name);
  const def = (get('default-src') || ['default-src', "'none'"]).slice(1).filter((v) => v !== "'none'");
  for (const name of ['script-src', 'frame-src']) {
    const d = get(name);
    if (d) { const vals = d.slice(1).filter((v) => v !== "'none'"); d.length = 1; d.push(...vals); if (!d.includes(ORIGIN)) d.push(ORIGIN); } else dirs.push([name, ...def, ORIGIN]);
  }
  return dirs.map((d) => d.join(' ')).join('; ');
}

// Middleware das páginas com o widget: libera o Cloudflare na CSP desta resposta e entrega a chave pública para a view.
function page(req, res, next) {
  res.locals.turnstileKey = siteKey();
  if (on()) {
    const set = res.set.bind(res);
    const cur = res.get('Content-Security-Policy');
    if (cur) set('Content-Security-Policy', withCsp(cur));
    // CSP que a rota define depois (ex.: plateia, estúdio) também ganha o Cloudflare
    res.set = (field, val) => (typeof field === 'string' && /^content-security-policy$/i.test(field) ? set(field, withCsp(val))
      : (field && typeof field === 'object' && !Array.isArray(field) ? set(Object.fromEntries(Object.entries(field).map(([k, v]) => [k, /^content-security-policy$/i.test(k) ? withCsp(v) : v]))) : set(field, val)));
  }
  next();
}

// Passe do link do estúdio: confere uma vez e vale por 12 h para aquele link (envios de horas não pedem de novo).
const PASS_HOURS = 12;
const passSig = (linkId, exp) => crypto.createHmac('sha256', config.sessionSecret).update(`estudio:${linkId}:${exp}`).digest('base64url');
function passCookie(linkId, token) {
  const exp = Math.floor(Date.now() / 1000) + PASS_HOURS * 3600;
  return `pulso_est=${exp}.${passSig(linkId, exp)}; Path=/estudio/${encodeURIComponent(token)}; Max-Age=${PASS_HOURS * 3600}; HttpOnly; SameSite=Lax${config.isProd ? '; Secure' : ''}`;
}
function passOk(req, linkId) {
  if (!on()) return true;
  const raw = (String(req.headers.cookie || '').match(/(?:^|;\s*)pulso_est=([^;]+)/) || [])[1];
  if (!raw) return false;
  const [exp, sig] = decodeURIComponent(raw).split('.');
  if (!/^\d+$/.test(exp || '') || Number(exp) < Date.now() / 1000 || !sig) return false;
  const want = Buffer.from(passSig(linkId, exp)); const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

module.exports = { ORIGIN, MESSAGE, on, siteKey, tokenOf, verify, withCsp, page, passCookie, passOk, setFetcher: (f) => { fetcher = f || ((...a) => fetch(...a)); } };
