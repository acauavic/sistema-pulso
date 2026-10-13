// Convite fixo do Pulso (src/templates/convite-pulso.html). O HTML é confiável (versionado no repositório),
// mas os VALORES das variáveis vêm de formulários e são sempre escapados.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { formatLong, firstName } = require('../utils/format');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TEMPLATE_FILE = path.join(__dirname, '..', 'templates', 'convite-pulso.html');
let templateCache = null;
const inviteHtml = () => (templateCache ??= fs.readFileSync(TEMPLATE_FILE, 'utf8'));
let kitCache = null;
const mediaKitHtml = () => (kitCache ??= fs.readFileSync(path.join(__dirname, '..', 'templates', 'media-kit.html'), 'utf8'));

const RAW = new Set(['bloco_resposta', 'guest_json', 'agenda_html', 'slide_ouro_html', 'slide_diamond_html', 'compare_html']); // únicas variáveis inseridas sem escape (geradas aqui, nunca digitadas)

// JSON que pode ir dentro de <script> sem fechar a tag nem quebrar a linha (</script>, <!--, U+2028).
function safeJson(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

// Só a recusa passa pelo formulário; aceitar é o botão do WhatsApp (link rastreado).
// state: 'aceito' | 'recusado' | null (resposta já registrada); closed: convite encerrado (sem formulário).
function responseBlock(action, { state = null, closed = false } = {}) {
  if (closed) {
    return '<p class="pulso-rsvp-closed" style="margin:24px 0;padding:14px 16px;border-radius:8px;background:#f1f5f9;color:#334155">Este convite não está mais aberto para respostas.</p>';
  }
  const banner = state
    ? `<p class="pulso-rsvp-state" style="margin:0 0 16px;padding:12px 16px;border-radius:8px;background:${state === 'aceito' ? '#dcfce7;color:#166534' : '#f1f5f9;color:#334155'}">${
      state === 'aceito'
        ? 'Sua presença está confirmada. Obrigado! Se algo mudar, avise abaixo.'
        : 'Sua resposta foi registrada: você não poderá participar. Mudou de ideia? É só usar o botão “Aceitar o convite”.'
    }</p>`
    : '';
  return `${banner}<form method="post" action="${esc(action)}" class="pulso-rsvp" style="margin:24px 0">
  <p style="margin:0 0 8px"><label for="pulso-msg" style="font-size:14px">Quer deixar um recado? (opcional)</label></p>
  <textarea id="pulso-msg" name="mensagem" rows="3" maxlength="600" style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #cbd5e1;font:inherit"></textarea>
  <div style="margin-top:14px">
    <button type="submit" name="resposta" value="recusado" style="background:#e5e7eb;color:#374151;border:0;border-radius:8px;padding:13px 22px;font-size:16px;cursor:pointer;margin:0">Não consigo participar</button>
  </div>
</form>`;
}

// `links`: { aceitar, producao, resposta } — caminhos relativos do convite (ou '#' na prévia do painel).
function buildVariables(guest, { owner, links = {} } = {}) {
  return {
    nome: guest.name,
    primeiro_nome: firstName(guest.name),
    tema: guest.topic || '',
    data_gravacao: guest.proposed_at ? formatLong(guest.proposed_at) : '',
    responsavel: owner || config.podcastName,
    podcast: config.podcastName,
    genero: guest.gender === 'f' ? 'f' : 'm',
    plural: guest.is_plural ? '1' : '',
    link_aceitar: links.aceitar || '#',
    link_producao: links.producao || '#',
    guest_json: safeJson({ nome: guest.name || '', plural: Boolean(guest.is_plural), sexo: guest.gender === 'f' ? 'f' : 'm' }),
    bloco_resposta: '', // o serviço de convidados preenche com o estado real
  };
}

// {{variavel}} -> valor. Desconhecidas viram vazio. `escape:false` para assunto de e-mail (texto puro).
function render(template, vars, { escape = true } = {}) {
  return String(template).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key) => {
    const value = vars[key];
    if (value == null) return '';
    return escape && !RAW.has(key) ? esc(value) : String(value);
  });
}

// Cabeçalhos da página pública. O modelo pode ter <script> (o convite do Pulso tem intro animada),
// então ele roda em SANDBOX sem allow-same-origin: origem opaca, sem acesso a cookies, sem fetch
// (connect-src bloqueado) e sem tocar no painel — mesmo que alguém coloque script malicioso num modelo.
function publicHeaders(frameAncestors = "'none'") {
  return {
    'Content-Security-Policy':
      'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox; ' +
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https:; " +
      "img-src 'self' https: data:; font-src https: data:; media-src https:; " +
      `form-action 'self'; base-uri 'none'; frame-ancestors ${frameAncestors}`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'no-store',
  };
}

module.exports = { RAW, esc, render, safeJson, buildVariables, responseBlock, publicHeaders, inviteHtml, mediaKitHtml };
