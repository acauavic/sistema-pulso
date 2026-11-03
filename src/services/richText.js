// Texto rico das tarefas e dos comentários. O navegador manda HTML (editor), o servidor limpa por lista branca e guarda os dois:
// o HTML limpo (para mostrar) e o texto puro (para busca, menções e avisos). Nada que não esteja na lista branca é guardado.
const sanitizeHtml = require('sanitize-html');

const MAX_HTML = 60_000;
const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'blockquote', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr'];
const ATTACHMENT_SRC = /^\/anexos\/(\d+)$/;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

function sanitize(input) {
  const html = sanitizeHtml(String(input ?? '').slice(0, MAX_HTML * 2), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href', 'rel', 'target', 'data-card'], img: ['src', 'alt'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'title'],
    transformTags: {
      b: 'strong', i: 'em', strike: 's', del: 's', div: 'p', h1: 'h2', h4: 'h3', h5: 'h3', h6: 'h3',
      a: (tag, attribs) => ({ tagName: 'a', attribs: { href: attribs.href || '', rel: 'noopener noreferrer nofollow', target: '_blank', ...(attribs['data-card'] === '1' ? { 'data-card': '1' } : {}) } }),
      img: (tag, attribs) => ({ tagName: 'img', attribs: { src: attribs.src || '', alt: String(attribs.alt || '').slice(0, 120) } }),
    },
    exclusiveFilter: (frame) => (frame.tag === 'img' && !ATTACHMENT_SRC.test(frame.attribs.src || '')) || (frame.tag === 'a' && !frame.attribs.href),
  }).trim();
  const clipped = html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html;
  return { html: isEmpty(clipped) ? '' : clipped, text: toText(clipped), attachmentIds: attachmentIds(clipped) };
}

// Vazio de verdade: sem texto e sem imagem nem tabela.
const isEmpty = (html) => !String(html).replace(/<\/?(p|br)\s*\/?>/g, '').replace(/&nbsp;/g, '').trim();

// Texto puro: blocos viram linhas, células viram " | ".
function toText(html) {
  const marked = String(html || '').replace(/<\/(p|li|h2|h3|blockquote|pre|tr)>|<br\s*\/?>|<hr\s*\/?>/gi, '\n').replace(/<\/(td|th)>/gi, ' | ');
  const text = unesc(sanitizeHtml(marked, { allowedTags: [], allowedAttributes: {} }));
  return text.replace(/[ \t]+\n/g, '\n').replace(/ \| \n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
}

// Texto puro antigo (ou de rotinas, voz, avisos) -> HTML do editor: parágrafos, linhas e listas com "- ".
function fromPlain(text) {
  const blocks = String(text ?? '').replace(/\r/g, '').trim().split(/\n{2,}/).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${esc(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(esc).join('<br>')}</p>`;
  }).join('');
}

const attachmentIds = (html) => [...new Set([...String(html || '').matchAll(/src="\/anexos\/(\d+)"/g)].map((m) => Number(m[1])))];

// O que a tela mostra: o HTML guardado ou, para registros antigos, o texto puro formatado.
const display = (html, plain) => (html && String(html).trim() ? html : fromPlain(plain));

module.exports = { sanitize, toText, fromPlain, attachmentIds, display, isEmpty, esc, MAX_HTML };
