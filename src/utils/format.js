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

const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const partsFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'numeric', year: 'numeric', hour: '2-digit', hourCycle: 'h23' });
function zoned(v) {
  const d = toDate(v);
  if (!valid(d)) return null;
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: p.day, month: MONTHS[Number(p.month) - 1], year: p.year, hour: Number(p.hour) };
}

// "23 OUT" — datas curtas em caixa alta (camada mono da marca).
function shortDate(v) {
  const z = zoned(v);
  return z ? `${z.day} ${z.month}` : '—';
}
function monthShort(v) { const z = zoned(v); return z ? z.month : ''; }
function dayNum(v) { const z = zoned(v); return z ? z.day : ''; }
function todayLabel() { const z = zoned(new Date()); return `${z.day} ${z.month} ${z.year}`; }

// Saudação pelo horário de Brasília.
function greeting() {
  const h = zoned(new Date()).hour;
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

const EMAIL_RE = /^[^\s@<>"',;:]+@[^\s@<>"',;:]+\.[^\s@<>"',;:]{2,}$/;
const isEmail = (value) => typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value);

const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatBRL = (cents) => (cents == null || cents === '' ? '—' : brlFmt.format(Number(cents) / 100));

// "15.000,00" / "15000" / "R$ 6.000,5" -> centavos; vazio -> null; inválido -> NaN
function parseBRL(input) {
  const raw = String(input ?? '').replace(/[R$\s]/g, '');
  if (!raw) return null;
  const n = /,/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/\.(?=\d{3}(\D|$))/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(n)) return NaN;
  return Math.round(Number(n) * 100);
}

// <input type="date"> (AAAA-MM-DD) <-> Date/string do banco
function parseInputDate(str) {
  if (!str) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return NaN;
  const d = new Date(`${str}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== str ? NaN : str;
}
const toInputDate = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : ''));
// DATE do pg chega como Date à meia-noite local; mostramos dd/mm/aaaa sem deslocar o dia
function formatDay(v) {
  if (!v) return '—';
  const s = v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : String(v).slice(0, 10);
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}
const LONG_MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// "23 de outubro de 2026"
function formatDayLong(v) {
  const [d, m, y] = formatDay(v).split('/');
  return y ? `${Number(d)} de ${LONG_MONTHS[Number(m) - 1]} de ${y}` : '';
}
// 12582912 -> "12 MB"; 13_194_139_533 -> "12,3 GB"
function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let x = v;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i += 1; }
  return `${x >= 100 || i === 0 ? Math.round(x) : x.toFixed(1).replace('.', ',')} ${units[i]}`;
}
// 754000 ms -> "12:34"; 3_725_000 -> "1:02:05"
function formatClock(ms) {
  const t = Math.max(0, Math.floor(Number(ms) / 1000));
  const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
const formatDayShort = (v) => formatDay(v).slice(0, 5);
// Hora do prazo das tarefas: 'HH:MM' ou 'HH:MM:SS' (coluna TIME) -> "14h" / "14h30".
const timeParts = (v) => { const m = String(v || '').match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/); return m ? { h: m[1], m: m[2] } : null; };
const formatTime = (v) => { const t = timeParts(v); return t ? (t.m === '00' ? `${Number(t.h)}h` : `${Number(t.h)}h${t.m}`) : ''; };
const toInputTime = (v) => { const t = timeParts(v); return t ? `${t.h}:${t.m}` : ''; };
const formatDue = (d, t) => (d ? `${formatDay(d)}${formatTime(t) ? ` às ${formatTime(t)}` : ''}` : '');
const formatDueShort = (d, t) => (d ? `${formatDayShort(d)}${formatTime(t) ? ` · ${formatTime(t)}` : ''}` : '');

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Texto de comentário: escapa o HTML e destaca as menções (@Nome) de pessoas da equipe.
function commentHtml(text, names = []) {
  const html = escHtml(text);
  const list = [...new Set(names.flatMap((n) => [n, n.split(/\s+/)[0]]))].filter(Boolean).sort((x, y) => y.length - x.length)
    .map((n) => escHtml(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const marked = list.length ? html.replace(new RegExp(`@(?:${list.join('|')})(?![\\p{L}\\p{N}])`, 'giu'), (m) => `<span class="mention">${m}</span>`) : html;
  return marked.replace(/\n/g, '<br>');
}
// "hoje", "amanhã", "em 5 dias", "ontem", "há 3 dias" (dias no calendário de Brasília)
function relativeDays(v, now = new Date()) {
  const d = toDate(v);
  if (!valid(d)) return '';
  const day = (x) => Date.UTC(...dateFmt.format(x).split('/').reverse().map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  const diff = Math.round((day(d) - day(now)) / 86400000);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  if (diff === -1) return 'ontem';
  return diff > 0 ? `em ${diff} dias` : `há ${-diff} dias`;
}
const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';

module.exports = { escHtml, commentHtml, initials, relativeDays,
  formatBRL, parseBRL, parseInputDate, toInputDate, formatDay, formatDayShort, formatDayLong, timeParts, formatTime, toInputTime, formatDue, formatDueShort, formatBytes, formatClock,
  TZ, formatDateTime, formatDate, formatLong, toInputValue, parseInputDateTime,
  shortDate, monthShort, dayNum, todayLabel, greeting,
  slugify, firstName, clean, isEmail,
};
