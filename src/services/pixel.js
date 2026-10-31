// Meta Pixel nas páginas públicas de patrocinador e convidado (a plateia usa o dela, em plateia.js).
// - tag(): o <script> de /static/pixel.js com o ID e o nome da página (PageView + ViewContent).
// - csp: o que as regras de segurança dessas páginas precisam liberar para o Pixel carregar e enviar.
// - cleanUrl(): páginas cujo endereço tem o código secreto (convite, portal do convidado) trocam, no navegador, para um endereço
//   limpo antes de o Pixel carregar: o código vai num cookie, e não para a Meta junto com o endereço da página.
const config = require('../config');
const { parseCookies } = require('../auth/sessions');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const on = () => Boolean(config.metaPixelId);

const csp = {
  script: ['https://connect.facebook.net'],
  connect: ['https://www.facebook.com', 'https://connect.facebook.net'],
  img: ['https://www.facebook.com'],
};

// absolute: para páginas em sandbox (convite, media kit), onde 'self' não vale e o script vem do endereço do sistema.
function tag({ content, category, v = '', absolute = false }) {
  if (!on()) return '';
  const src = `${absolute ? config.appBaseUrl : ''}/static/pixel.js${v ? `?v=${esc(v)}` : ''}`;
  return `<script src="${src}" data-pixel="${esc(config.metaPixelId)}" data-content="${esc(content)}" data-category="${esc(category)}" defer></script>`;
}
const inject = (html, opts) => (on() ? (html.includes('</body>') ? html.replace('</body>', `${tag(opts)}</body>`) : html + tag(opts)) : html);
const appOrigin = () => new URL(config.appBaseUrl).origin;

// Abertura pelo navegador (não robô, não pré-visualização): guarda o código no cookie e manda para o endereço limpo.
// Devolve true quando redirecionou.
function cleanUrl(req, res, { cookie, path, to, token, days = 90 }) {
  if (req.get('sec-fetch-mode') !== 'navigate' || req.get('sec-fetch-dest') === 'iframe') return false;
  const secure = config.isProd ? '; Secure' : '';
  res.append('Set-Cookie', `${cookie}=${token}; Path=${path}; Max-Age=${days * 86400}; HttpOnly; SameSite=Lax${secure}`);
  const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.set('Cache-Control', 'no-store').redirect(302, `${to}${qs}`);
  return true;
}
const tokenFrom = (req, cookie) => parseCookies(req.headers.cookie)[cookie] || null;

module.exports = { on, csp, tag, inject, appOrigin, cleanUrl, tokenFrom };
