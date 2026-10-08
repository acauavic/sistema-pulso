// Motor dos modelos de convite. O HTML do modelo é confiável (escrito pela equipe),
// mas os VALORES das variáveis vêm de formulários e são sempre escapados.
const config = require('../config');
const { formatLong, firstName } = require('../utils/format');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Variáveis disponíveis no modelo (documentadas na tela de modelos).
const VARIABLES = [
  ['nome', 'Nome completo do convidado'],
  ['primeiro_nome', 'Primeiro nome'],
  ['empresa', 'Empresa / projeto'],
  ['cargo', 'Cargo / ocupação'],
  ['tema', 'Tema / pauta do episódio'],
  ['data_gravacao', 'Data e hora sugeridas (ex.: quinta-feira, 12 de março de 2026, 14:00)'],
  ['responsavel', 'Nome de quem cuida do convite'],
  ['podcast', 'Nome do podcast'],
  ['link_convite', 'Endereço do convite (link curto, se existir)'],
  ['genero', '"m" ou "f" (gênero do convidado)'],
  ['plural', '"1" quando o convite é para uma dupla, senão vazio'],
  ['guest_json', 'Dados do convidado em JSON seguro para scripts: {nome, plural, sexo} (use em <script>)'],
  ['bloco_resposta', 'Botões "Aceito / Não posso" prontos (HTML) — necessário para o convidado responder'],
];

const RAW = new Set(['bloco_resposta', 'guest_json']); // únicas variáveis inseridas sem escape (geradas aqui, nunca digitadas)

// JSON que pode ir dentro de <script> sem fechar a tag nem quebrar a linha (</script>, <!--, U+2028).
function safeJson(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

// state: 'aceito' | 'recusado' | null (resposta já registrada); closed: convite encerrado (sem formulário).
function responseBlock(action, { state = null, closed = false } = {}) {
  if (closed) {
    return '<p class="pulso-rsvp-closed" style="margin:24px 0;padding:14px 16px;border-radius:8px;background:#f1f5f9;color:#334155">Este convite não está mais aberto para respostas.</p>';
  }
  const banner = state
    ? `<p class="pulso-rsvp-state" style="margin:0 0 16px;padding:12px 16px;border-radius:8px;background:${state === 'aceito' ? '#dcfce7;color:#166534' : '#f1f5f9;color:#334155'}">${
      state === 'aceito' ? '✅ Sua presença está confirmada. Obrigado!' : 'Sua resposta foi registrada: você não poderá participar.'
    } Mudou de ideia? Responda novamente abaixo.</p>`
    : '';
  return `${banner}<form method="post" action="${esc(action)}" class="pulso-rsvp" style="margin:24px 0">
  <p style="margin:0 0 8px"><label for="pulso-msg" style="font-size:14px">Quer deixar um recado? (opcional)</label></p>
  <textarea id="pulso-msg" name="mensagem" rows="3" maxlength="600" style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #cbd5e1;font:inherit"></textarea>
  <div style="margin-top:14px">
    <button type="submit" name="resposta" value="aceito" style="background:#16a34a;color:#fff;border:0;border-radius:8px;padding:13px 26px;font-size:16px;font-weight:700;cursor:pointer;margin:0 8px 8px 0">Aceito o convite</button>
    <button type="submit" name="resposta" value="recusado" style="background:#e5e7eb;color:#374151;border:0;border-radius:8px;padding:13px 22px;font-size:16px;cursor:pointer;margin:0 0 8px 0">Não consigo participar</button>
  </div>
</form>`;
}

function buildVariables(guest, { owner, shortUrl, publicUrl, rsvpAction } = {}) {
  return {
    nome: guest.name,
    primeiro_nome: firstName(guest.name),
    empresa: guest.company || '',
    cargo: guest.job_title || '',
    tema: guest.topic || '',
    data_gravacao: guest.proposed_at ? formatLong(guest.proposed_at) : '',
    responsavel: owner || config.podcastName,
    podcast: config.podcastName,
    link_convite: shortUrl || publicUrl || '',
    genero: guest.gender === 'f' ? 'f' : 'm',
    plural: guest.is_plural ? '1' : '',
    guest_json: safeJson({ nome: guest.name || '', plural: Boolean(guest.is_plural), sexo: guest.gender === 'f' ? 'f' : 'm' }),
    bloco_resposta: rsvpAction ? responseBlock(rsvpAction) : '', // o serviço de convidados sobrescreve com o estado real
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

module.exports = { VARIABLES, RAW, esc, render, safeJson, buildVariables, responseBlock, publicHeaders };
