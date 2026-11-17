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

const RAW = new Set(['bloco_resposta', 'guest_json', 'agenda_html', 'slide_ouro_html', 'slide_diamond_html', 'compare_html', 'guests_json', 'cortes_html', 'plateia_html', 'vitrine_json']); // únicas variáveis inseridas sem escape (geradas aqui, nunca digitadas)

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

// Período da gravação -> textos ("Uma manhã de conversa." / "Uma manhã."). Sem data: neutro.
const PERIOD_TEXT = {
  manha: ['Uma manhã de conversa.', 'Uma manhã.'],
  tarde: ['Uma tarde de conversa.', 'Uma tarde.'],
  noite: ['Uma noite de conversa.', 'Uma noite.'],
  null: ['Uma conversa sem pressa.', 'Poucas horas.'],
};

// Seção "Os cortes": o que a equipe entrega e alguns cortes reais que já saíram (vídeos com link assinado).
function clipsSection(highlights = []) {
  const grid = highlights.length ? `
  <div class="clips-grid">${highlights.map((c) => `
    <figure class="clip-card"><video controls playsinline preload="none"${c.poster ? ` poster="${esc(c.poster)}"` : ''} src="${esc(c.src)}"></video>${c.title ? `<figcaption>${esc(c.title)}</figcaption>` : ''}</figure>`).join('')}
  </div>` : '';
  return `<section>
  <div class="section-header">
    <div class="section-number">04 · OS CORTES</div>
    <div>
      <div class="section-eyebrow">O QUE A GENTE PRODUZ</div>
      <h2 class="section-title">Cortes que<br>trabalham<br>por você.</h2>
    </div>
  </div>
  <p class="clips-intro">Cada conversa vira de 15 a 30 cortes verticais, editados pela nossa equipe, com legenda e capa. Eles saem em collab no seu perfil e no do Pulso, ao longo das semanas da estreia, e ficam com você para usar como quiser.</p>
  <div class="clips-facts"><span>15 a 30 cortes por episódio</span><span>Postados em collab</span><span>Instagram · TikTok · YouTube</span></div>${grid}
</section>`;
}

// Bloco do convite "com plateia" (dentro de A EXPERIÊNCIA): como é, as fotos e o botão do vídeo.
function plateiaBlock() {
  const photos = [1, 2, 3, 4, 5].map((n) => `<img loading="lazy" decoding="async" src="/static/convite/plateia-${n}.jpg" alt="Gravação do Pulso com plateia">`).join('');
  return `<div class="plateia-block">
      <div>
        <div class="plateia-eyebrow">Com plateia</div>
        <h3>Uma conversa a poucos metros de quem quer ouvir.</h3>
        <p>A gravação acontece diante de uma plateia pequena e selecionada: profissionais da saúde que se inscreveram para ver a conversa de perto.</p>
        <p>Tem recepção, comes e bebes antes e depois, e o encontro com quem também foi escolhido. Você conversa com os hosts; a plateia acompanha e, no fim, pode fazer perguntas.</p>
        <button type="button" class="plateia-play" data-plateia-video>Veja como é</button>
      </div>
      <div class="plateia-gallery">${photos}</div>
    </div>`;
}

// `links`: { aceitar, producao, resposta } — caminhos relativos do convite (ou '#' na prévia do painel).
// `showcase`: vitrine real (services/inviteShowcase): { episodes, guests: {chave: [corte]}, highlights, plateia }.
function buildVariables(guest, { owner, links = {}, showcase = null } = {}) {
  const sc = showcase || { episodes: 0, guests: {}, highlights: [], plateia: null };
  const plateia = guest.invite_format === 'plateia';
  const why = String(guest.invite_why || '').replace(/\s+/g, ' ').trim();
  const period = require('./inviteShowcase').periodOf(guest.proposed_at);
  const [card, head] = PERIOD_TEXT[period] || PERIOD_TEXT.null;
  return {
    convite_desc: why || 'Selecionamos uma conversa por vez. Escolhemos você pela trajetória que construiu e pela perspectiva que acreditamos que o nosso público precisa ouvir.',
    formato_selo: plateia ? 'Convite · com plateia' : 'Convite exclusivo',
    formato_rodape: plateia ? 'Com plateia · 60–90min' : 'De mesa · 60–90min',
    periodo_card: card,
    periodo_titulo: head,
    episodios: String(sc.episodes || 0),
    gravacao_titulo: plateia ? 'Gravação com plateia' : 'Gravação em estúdio',
    gravacao_texto: plateia
      ? 'Uma sessão de 60 a 90 minutos no Estúdio GH, diante de uma plateia selecionada, com equipe técnica completa, múltiplas câmeras e áudio profissional. Você só precisa aparecer e conversar.'
      : 'Uma sessão de 60 a 90 minutos no Estúdio GH, só você e os hosts, com equipe técnica completa. Iluminação cinematográfica, múltiplas câmeras e áudio profissional: você só precisa aparecer e conversar.',
    plateia_html: plateia ? plateiaBlock() : '',
    cortes_html: clipsSection(sc.highlights || []),
    vitrine_json: safeJson({ cortes: sc.guests || {}, plateia: plateia ? sc.plateia || null : null }),
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
    guest_json: safeJson({ nome: guest.name || '', plural: Boolean(guest.is_plural), sexo: guest.gender === 'f' ? 'f' : 'm', motivo: Boolean(why) }),
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
// pixel: libera o Meta Pixel (o script vem do endereço do sistema, porque em sandbox 'self' não vale).
function publicHeaders(frameAncestors = "'none'", { pixel = false } = {}) {
  const px = pixel && require('./pixel').on() ? require('./pixel') : null;
  return {
    'Content-Security-Policy':
      'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox; ' +
      `default-src 'none'; script-src 'unsafe-inline'${px ? ` ${px.appOrigin()} ${px.csp.script.join(' ')}` : ''}; style-src 'unsafe-inline' https:; ` +
      `${px ? `connect-src ${px.csp.connect.join(' ')}; ` : ''}` +
      "img-src 'self' https: data:; font-src https: data:; media-src https:; " +
      `form-action 'self'; base-uri 'none'; frame-ancestors ${frameAncestors}`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'no-store',
  };
}

module.exports = { RAW, esc, render, safeJson, buildVariables, responseBlock, publicHeaders, inviteHtml, mediaKitHtml, clipsSection, plateiaBlock };
