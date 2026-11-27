// Filtros combináveis (no estilo do ClickUp) para listas: cada filtro é campo + operador + valor, e a lista mostra o que
// passa em todos (E) ou em qualquer um (OU). Os campos de cada lista ficam numa tabela fechada (quem chama define), então
// nada que vem do endereço vira SQL: o campo escolhe uma expressão do servidor e o valor vai sempre como parâmetro.
//
// No endereço: f=campo~operador~valor (repete), valores múltiplos separados por "|", e m=ou para "qualquer um".
// Ex.: /convidados?f=status~em~agendado|gravado&f=email~vazio&m=e

const MAX_FILTERS = 12;
const TZ = 'America/Sao_Paulo';

const OPS = {
  text: ['contem', 'nao_contem', 'e', 'vazio', 'preenchido'],
  enum: ['em', 'fora', 'vazio', 'preenchido'],
  user: ['em', 'fora', 'vazio', 'preenchido'],
  date: ['antes', 'depois', 'ultimos', 'proximos', 'vazio', 'preenchido'],
  number: ['maior', 'menor', 'igual', 'vazio', 'preenchido'],
  bool: ['sim', 'nao'],
};
const OP_LABEL = {
  contem: 'contém', nao_contem: 'não contém', e: 'é igual a', vazio: 'está vazio', preenchido: 'está preenchido',
  em: 'é', fora: 'não é', antes: 'antes de', depois: 'depois de', ultimos: 'nos últimos', proximos: 'nos próximos',
  maior: 'maior que', menor: 'menor que', igual: 'igual a', sim: 'sim', nao: 'não',
};
const NO_VALUE = new Set(['vazio', 'preenchido', 'sim', 'nao']);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Data no fuso de Brasília (AAAA-MM-DD) de um Date, de uma string ISO ou de um "AAAA-MM-DD".
function brDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && ISO.test(v)) return v;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('sv-SE', { timeZone: TZ });
}
const todayBr = () => brDate(new Date());
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ------------------------------------------------------------------------------------------- ler e conferir
// fields: [{ key, label, type, options?: [[valor, rótulo]], ... }]. ctx.userId troca "eu" pelo id de quem vê.
function parse(query, fields, ctx = {}) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const raw = [].concat(query?.f || []).filter((x) => typeof x === 'string').slice(0, MAX_FILTERS);
  const filters = [];
  for (const item of raw) {
    const [key, op, ...rest] = item.split('~');
    const field = byKey.get(key);
    if (!field || !OPS[field.type].includes(op)) continue;
    let value = rest.join('~');
    if (NO_VALUE.has(op)) value = null;
    else if (field.type === 'enum' || field.type === 'user') {
      let vals = value.split('|').map((v) => v.trim()).filter(Boolean);
      if (field.type === 'user' && ctx.userId) vals = vals.map((v) => (v === 'eu' ? String(ctx.userId) : v));
      const allowed = field.options ? new Set(field.options.map(([v]) => String(v))) : null;
      if (allowed) vals = vals.filter((v) => allowed.has(v) || (field.type === 'user' && v === String(ctx.userId)));
      vals = [...new Set(vals)].slice(0, 50);
      if (!vals.length) continue;
      value = vals;
    } else if (field.type === 'date') {
      if (op === 'ultimos' || op === 'proximos') { const n = Number(value); if (!Number.isInteger(n) || n < 1 || n > 3650) continue; value = n; } else if (!ISO.test(value)) continue;
    } else if (field.type === 'number') {
      const n = Number(String(value).replace(',', '.'));
      if (!Number.isFinite(n)) continue;
      value = n;
    } else {
      value = String(value).replace(/\s+/g, ' ').trim().slice(0, 100);
      if (!value) continue;
    }
    filters.push({ field: key, op, value });
  }
  return { filters, mode: query?.m === 'ou' ? 'ou' : 'e' };
}

// Volta para o endereço (para links, "Limpar este" e as visualizações salvas).
function toQuery({ filters, mode }, ctx = {}) {
  const p = new URLSearchParams();
  for (const f of filters) {
    let v = f.value;
    if (Array.isArray(v)) v = v.map((x) => (ctx.userId && String(x) === String(ctx.userId) ? 'eu' : x)).join('|');
    p.append('f', [f.field, f.op, v == null ? '' : v].join('~').replace(/~$/, ''));
  }
  if (filters.length > 1 && mode === 'ou') p.set('m', 'ou');
  return p.toString();
}

// ------------------------------------------------------------------------------------------- SQL (listas do banco)
// Cada campo traz `sql` (expressão do servidor). Datas: `date: 'tz'` para timestamptz (vira o dia em Brasília).
// bool: `sql` é uma condição. Campos que só existem no JS (sem `sql`) são ignorados aqui.
function toSql({ filters, mode }, fields, params) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const parts = [];
  for (const { field: key, op, value } of filters) {
    const f = byKey.get(key);
    if (!f || !f.sql) continue;
    const x = f.sql;
    const txt = `coalesce((${x})::text, '')`;
    let c = null;
    if (f.type === 'bool') c = op === 'sim' ? `coalesce((${x}), false)` : `NOT coalesce((${x}), false)`;
    else if (op === 'vazio') c = `${txt} = ''`;
    else if (op === 'preenchido') c = `${txt} <> ''`;
    else if (f.type === 'text') {
      const like = `%${String(value).replace(/[\\%_]/g, '\\$&')}%`;
      if (op === 'contem') c = `${txt} ILIKE ${p(like)}`;
      else if (op === 'nao_contem') c = `${txt} NOT ILIKE ${p(like)}`;
      else c = `lower(${txt}) = lower(${p(value)})`;
    } else if (f.type === 'enum' || f.type === 'user') {
      const arr = p(value.map(String));
      c = op === 'em' ? `(${x})::text = ANY(${arr}::text[])` : `(${x} IS NULL OR NOT ((${x})::text = ANY(${arr}::text[])))`;
    } else if (f.type === 'number') {
      c = `(${x}) ${op === 'maior' ? '>' : op === 'menor' ? '<' : '='} ${p(value)}`;
    } else if (f.type === 'date') {
      const day = f.date === 'tz' ? `((${x}) AT TIME ZONE '${TZ}')::date` : `(${x})::date`;
      const today = `(now() AT TIME ZONE '${TZ}')::date`;
      if (op === 'antes') c = `${day} < ${p(value)}::date`;
      else if (op === 'depois') c = `${day} > ${p(value)}::date`;
      else if (op === 'ultimos') c = `${day} BETWEEN ${today} - ${p(value)}::int AND ${today}`;
      else c = `${day} BETWEEN ${today} AND ${today} + ${p(value)}::int`;
    }
    if (c) parts.push(`(${c})`);
  }
  if (!parts.length) return '';
  return parts.length === 1 ? parts[0] : `(${parts.join(mode === 'ou' ? ' OR ' : ' AND ')})`;
}

// ------------------------------------------------------------------------------------------- JS (listas já carregadas)
// Cada campo traz `get(linha)`. Mesmas regras do SQL.
function matcher({ filters, mode }, fields) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const tests = filters.map(({ field: key, op, value }) => {
    const f = byKey.get(key);
    if (!f || !f.get) return null;
    const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
    return (row) => {
      const v = f.get(row);
      if (f.type === 'bool') return op === 'sim' ? Boolean(v) : !v;
      if (op === 'vazio') return empty(v);
      if (op === 'preenchido') return !empty(v);
      if (f.type === 'text') {
        const s = String(v ?? '').toLowerCase(); const q = String(value).toLowerCase();
        return op === 'contem' ? s.includes(q) : op === 'nao_contem' ? !s.includes(q) : s === q;
      }
      if (f.type === 'enum' || f.type === 'user') { // valor em lista (ex.: as redes que falharam): vale se alguma estiver entre as escolhidas
        const has = Array.isArray(v) ? v.some((x) => value.includes(String(x))) : value.includes(String(v ?? ''));
        return op === 'em' ? has : !has;
      }
      if (f.type === 'number') { if (v == null) return false; const n = Number(v); return op === 'maior' ? n > value : op === 'menor' ? n < value : n === value; }
      if (f.type === 'date') {
        const d = brDate(v); if (!d) return false;
        const t = todayBr();
        if (op === 'antes') return d < value;
        if (op === 'depois') return d > value;
        if (op === 'ultimos') return d >= addDays(t, -value) && d <= t;
        return d >= t && d <= addDays(t, value);
      }
      return true;
    };
  }).filter(Boolean);
  if (!tests.length) return () => true;
  return mode === 'ou' ? (row) => tests.some((t) => t(row)) : (row) => tests.every((t) => t(row));
}

// ------------------------------------------------------------------------------------------- para a tela
// Resumo legível ("Etapa é Agendado ou Gravado · E-mail está vazio") e a definição que o filters.js do navegador usa.
function summary({ filters, mode }, fields, ctx = {}) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const label = (f, v) => {
    if (f.type === 'user' && ctx.userId && String(v) === String(ctx.userId)) return 'você';
    const o = (f.options || []).find(([k]) => String(k) === String(v));
    return o ? o[1] : String(v);
  };
  return filters.map(({ field, op, value }) => {
    const f = byKey.get(field); if (!f) return null;
    if (f.type === 'bool') return `${f.label}: ${op === 'sim' ? 'sim' : 'não'}`;
    if (value == null) return `${f.label} ${OP_LABEL[op]}`;
    if (Array.isArray(value)) return `${f.label} ${OP_LABEL[op]} ${value.map((v) => label(f, v)).join(' ou ')}`;
    if (f.type === 'date' && (op === 'ultimos' || op === 'proximos')) return `${f.label} ${OP_LABEL[op]} ${value} dias`;
    if (f.type === 'date') return `${f.label} ${OP_LABEL[op]} ${value.split('-').reverse().join('/')}`;
    return `${f.label} ${OP_LABEL[op]} "${value}"`;
  }).filter(Boolean).join(mode === 'ou' ? ' · ou ' : ' · ');
}

function clientDef(fields, state, ctx = {}) {
  return {
    ops: OPS, opLabel: OP_LABEL, noValue: [...NO_VALUE],
    fields: fields.map((f) => ({ key: f.key, label: f.label, type: f.type, group: f.group || 'Campos', options: f.options || null })),
    filters: state.filters.map((x) => ({ ...x, value: Array.isArray(x.value) ? x.value.map((v) => (ctx.userId && String(v) === String(ctx.userId) ? 'eu' : String(v))) : x.value })),
    mode: state.mode,
  };
}

module.exports = { OPS, OP_LABEL, MAX_FILTERS, parse, toQuery, toSql, matcher, summary, clientDef, brDate };
