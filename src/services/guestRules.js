// Regras do funil de convidados: o que precisa estar preenchido para entrar em cada etapa
// e normalização/validação dos campos que o cadastro e a importação CSV compartilham.
const { PROFILES } = require('../constants');

// Etapa -> pendências. Cada regra devolve a lista (vazia = pode entrar).
const REQUIREMENTS = {
  em_agendamento: (g) => (g.email || g.phone ? [] : ['e-mail e/ou WhatsApp do convidado']),
  agendado: (g) => [
    !g.proposed_at && 'data e hora da gravação',
    !g.scheduled_studio && 'confirmação de agenda no Estúdio',
    !g.scheduled_hosts && 'confirmação de agenda com os hosts',
    !g.scheduled_guest && 'confirmação de agenda com o convidado',
  ].filter(Boolean),
};

// Texto curto exibido no formulário conforme a etapa escolhida.
const STAGE_HINTS = {
  em_agendamento: 'Para entrar em Em agendamento: e-mail e/ou WhatsApp do convidado.',
  agendado: 'Para entrar em Agendado: data e hora da gravação e a confirmação no Estúdio, com os hosts e com o convidado.',
};

const missingFor = (status, guest) => (REQUIREMENTS[status] ? REQUIREMENTS[status](guest) : []);

const joinList = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}` : items[0] || '');

function missingMessage(statusLabel, missing) {
  return `Para mover para ${statusLabel} falta: ${joinList(missing)}.`;
}

// ---- normalização / validação de campos ----
const normText = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// "@maria.souza", "instagram.com/maria.souza/" ou "https://www.instagram.com/maria.souza?igsh=x" -> "maria.souza"
function normalizeInstagram(value) {
  let s = String(value || '').trim();
  const url = s.match(/instagram\.com\/([^/?#\s]+)/i);
  if (url) s = url[1];
  s = s.replace(/^@+/, '').replace(/\/+$/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(s) ? s.toLowerCase() : null;
}

const PROFILE_ALIASES = {
  medico: ['medico', 'medica', 'medico(a)', 'dr', 'dra', 'doutor', 'doutora'],
  influencer: ['influencer', 'influenciador', 'influenciadora', 'influenciador(a)', 'creator', 'criador de conteudo'],
  empresario: ['empresario', 'empresaria', 'empresario(a)', 'empreendedor', 'empreendedora', 'ceo'],
  profissional_saude: ['profissional da saude', 'profissional de saude', 'profissional saude', 'profissional_saude', 'saude', 'profissional da saude (nao medico)'],
};

function normalizeProfile(value) {
  const n = normText(value);
  if (!n) return null;
  for (const p of PROFILES) if (normText(p.label) === n || p.key === n) return p.key;
  for (const [key, list] of Object.entries(PROFILE_ALIASES)) if (list.includes(n)) return key;
  return null;
}

function normalizeGender(value) {
  const n = normText(value);
  if (['f', 'feminino', 'mulher', 'ela', 'convidada'].includes(n)) return 'f';
  if (['m', 'masculino', 'homem', 'ele', 'convidado', ''].includes(n)) return 'm';
  return null;
}

// Aceita só http(s); `hosts` restringe o domínio (youtube.com/youtu.be, spotify.com/spotify.link).
function normalizeUrl(value, hosts) {
  const raw = String(value || '').trim();
  if (!raw) return { value: null };
  // "ftp://x" e "javascript:…" têm esquema próprio: não são "site sem https://" (já "localhost:3000" é porta, não esquema)
  if (/^(?!https?:)[a-z][a-z0-9+.-]*:(?!\d)/i.test(raw)) return { error: true };
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return { error: true }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { error: true };
  const host = url.hostname.toLowerCase();
  if (hosts && !hosts.some((h) => host === h || host.endsWith(`.${h}`))) return { error: true };
  return { value: url.toString().slice(0, 500) };
}

const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be'];
const SPOTIFY_HOSTS = ['spotify.com', 'spotify.link'];

module.exports = {
  missingFor, missingMessage, STAGE_HINTS, normalizeInstagram, normalizeProfile, normalizeGender, normalizeUrl,
  YOUTUBE_HOSTS, SPOTIFY_HOSTS, normText,
};
