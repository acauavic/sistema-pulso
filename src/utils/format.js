const TZ = 'America/Sao_Paulo';

const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const longFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

const valid = (d) => d instanceof Date && !Number.isNaN(d.getTime());
const toDate = (v) => (v instanceof Date ? v : v ? new Date(v) : null);

function formatDateTime(v) {
  const d = toDate(v);
  return valid(d) ? dateTimeFmt.format(d).replace(',', '') : '—';
}

function formatDate(v) {
  const d = toDate(v);
  return valid(d) ? dateFmt.format(d) : '—';
}

function formatLong(v) {
  const d = toDate(v);
  return valid(d) ? longFmt.format(d) : '';
}

// <input type="datetime-local"> trabalha sem fuso; o Brasil não tem horário de verão desde 2019 (-03:00 fixo).
function toInputValue(v) {
  const d = toDate(v);
  if (!valid(d)) return '';
  const shifted = new Date(d.getTime() - 3 * 3600 * 1000);
  return shifted.toISOString().slice(0, 16);
}

function parseInputDateTime(str) {
  if (!str || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str)) return null;
  const d = new Date(`${str}:00-03:00`);
  return valid(d) ? d : null;
}

function slugify(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function clean(value, max = 500) {
  const s = value == null ? '' : String(value).trim();
  return s.slice(0, max);
}

const EMAIL_RE = /^[^\s@<>"',;:]+@[^\s@<>"',;:]+\.[^\s@<>"',;:]{2,}$/;
const isEmail = (value) => typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value);

module.exports = {
  TZ, formatDateTime, formatDate, formatLong, toInputValue, parseInputDateTime,
  slugify, firstName, clean, isEmail,
};
