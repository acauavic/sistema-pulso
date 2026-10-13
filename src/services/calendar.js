// Calendário: reúne tudo que tem data e prazo (tarefas, gravações, lembretes, publicações, contas, parcerias) numa só visão.
// Cada tipo de evento só aparece para quem tem a permissão do assunto (contas só para o financeiro, e assim por diante).
// Datas em Brasília (-03:00): o dia de um evento é sempre o dia em São Paulo, nunca o do servidor.
const db = require('../db/pool');
const C = require('../constants');
const { can } = require('../permissions');
const fmt = require('../utils/format');
const { isUuid } = require('../utils/wrap');

const TZ = 'America/Sao_Paulo';
const MAX_PER_TYPE = 500;

// ordem = ordem de exibição dos filtros e desempate dentro do dia
const TYPES = [
  { key: 'gravacao', label: 'Gravações', icon: 'mic', perm: 'guests.read', hasOwner: true },
  { key: 'lembrete', label: 'Lembretes da gravação', icon: 'bell', perm: 'guests.read', hasOwner: true },
  { key: 'tarefa', label: 'Tarefas', icon: 'check-square', perm: 'tasks.read', hasOwner: true },
  { key: 'episodio', label: 'Publicação de episódios', icon: 'film', perm: 'episodes.read', hasOwner: true },
  { key: 'post', label: 'Posts nas redes', icon: 'share-2', perm: 'social.read', hasOwner: true },
  { key: 'receber', label: 'A receber', icon: 'wallet', perm: 'finance.read', hasOwner: false },
  { key: 'pagar', label: 'A pagar', icon: 'wallet', perm: 'finance.read', hasOwner: false },
  { key: 'patrocinio', label: 'Início e fim de parcerias', icon: 'shield-check', perm: 'sponsors.read', hasOwner: true },
];
const TYPE_BY_KEY = Object.fromEntries(TYPES.map((t) => [t.key, t]));
const MODES = { mes: 'Mês', semana: 'Semana', lista: 'Lista' };

const allowedTypes = (user) => TYPES.filter((t) => can(user.role, t.perm));

// ---------------------------------------------------------------- datas (texto AAAA-MM-DD, sem fuso no meio)
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(new Date(`${s}T12:00:00Z`).getTime()) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dowOf = (iso) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7; // segunda = 0
const startOfWeek = (iso) => addDays(iso, -dowOf(iso));
const firstOfMonth = (iso) => `${iso.slice(0, 7)}-01`;
const addMonths = (iso, n) => { const d = new Date(`${firstOfMonth(iso)}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const lastOfMonth = (iso) => addDays(addMonths(iso, 1), -1);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const longFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const dayLongFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const dayShortFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' });
const monthDayFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: 'numeric', month: 'long' });
const noon = (iso) => new Date(`${iso}T12:00:00Z`);
const dayLabel = (iso) => cap(dayLongFmt.format(noon(iso)));
const dayShort = (iso) => dayShortFmt.format(noon(iso)).replace('.', '');

// Janela de cada modo. Devolve { from, to, label, prev, next, days? , weeks? } (prev/next são datas-âncora).
function range(mode, anchor, listDays = 30) {
  if (mode === 'semana') {
    const from = startOfWeek(anchor); const to = addDays(from, 6);
    const same = from.slice(0, 7) === to.slice(0, 7);
    const label = same ? `${Number(from.slice(8))} a ${monthDayFmt.format(noon(to))} de ${to.slice(0, 4)}` : `${monthDayFmt.format(noon(from))} a ${monthDayFmt.format(noon(to))} de ${to.slice(0, 4)}`;
    return { from, to, label, prev: addDays(from, -7), next: addDays(from, 7), days: Array.from({ length: 7 }, (_, i) => addDays(from, i)) };
  }
  if (mode === 'lista') {
    const from = anchor; const to = addDays(anchor, listDays - 1);
    return { from, to, label: `${monthDayFmt.format(noon(from))} a ${monthDayFmt.format(noon(to))}`, prev: addDays(from, -listDays), next: addDays(from, listDays) };
  }
  const first = firstOfMonth(anchor); const gridFrom = startOfWeek(first); const gridTo = addDays(startOfWeek(lastOfMonth(anchor)), 6);
  const weeks = [];
  for (let d = gridFrom; d <= gridTo; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => { const iso = addDays(d, i); return { iso, day: Number(iso.slice(8)), inMonth: iso.slice(0, 7) === first.slice(0, 7) }; }));
  }
  return { from: gridFrom, to: gridTo, label: cap(longFmt.format(noon(first))), prev: addMonths(first, -1), next: addMonths(first, 1), weeks };
}

// ---------------------------------------------------------------- eventos
const dayOf = (col) => `to_char((${col} AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD')`;
const timeOf = (col) => `to_char(${col} AT TIME ZONE '${TZ}', 'HH24:MI')`;
const inRange = (col) => `(${col} AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date`;
const epNo = (n) => (n ? `EP.${String(n).padStart(3, '0')}` : 'Episódio');
const POST_STATUS = { revisao: 'em revisão', recusado: 'devolvido', simulado: 'simulado', enviando: 'enviando', agendado: 'agendado', publicado: 'publicado', parcial: 'parcial', erro: 'com erro' };

// Cada fonte devolve eventos { type, id, title, sub, day, time, url, done, late, tentative, who, whoId, amount }.
const SOURCES = {
  async tarefa({ from, to, owner }, today) {
    const p = [from, to]; let w = 't.due_on BETWEEN $1::date AND $2::date';
    if (owner) { p.push(owner); w += ` AND t.assignee_id = $${p.length}`; }
    const { rows } = await db.query(
      `SELECT t.id, t.title, t.status, to_char(t.due_on, 'YYYY-MM-DD') AS day, t.assignee_id, u.name AS who FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
        WHERE ${w} ORDER BY t.due_on, t.id LIMIT ${MAX_PER_TYPE}`, p);
    return rows.map((t) => ({
      type: 'tarefa', id: `tarefa-${t.id}`, title: t.title, sub: C.TASK_STATUSES[t.status], day: t.day, time: null,
      url: `/tarefas/${t.id}`, done: t.status === 'feito', late: t.status !== 'feito' && t.day < today, blocked: t.status === 'bloqueada', who: t.who, whoId: t.assignee_id,
    }));
  },

  async gravacao({ from, to, owner }, today) {
    const p = [from, to]; let w = `g.proposed_at IS NOT NULL AND g.status IN ('em_agendamento', 'agendado', 'gravado') AND ${inRange('g.proposed_at')}`;
    if (owner) { p.push(owner); w += ` AND g.owner_id = $${p.length}`; }
    const { rows } = await db.query(
      `SELECT g.id, g.name, g.status, g.owner_id, u.name AS who, ${dayOf('g.proposed_at')} AS day, ${timeOf('g.proposed_at')} AS time
         FROM guests g LEFT JOIN users u ON u.id = g.owner_id WHERE ${w} ORDER BY g.proposed_at LIMIT ${MAX_PER_TYPE}`, p);
    const out = rows.map((g) => ({
      type: 'gravacao', id: `gravacao-${g.id}`, title: `Gravação: ${g.name}`, sub: { em_agendamento: 'a confirmar com o convidado', agendado: 'agendada', gravado: 'gravada' }[g.status],
      day: g.day, time: g.status === 'gravado' ? null : g.time, url: `/convidados/${g.id}`, done: g.status === 'gravado', late: false, tentative: g.status === 'em_agendamento', who: g.who, whoId: g.owner_id,
    }));
    if (!owner) { // gravação só com os hosts (episódio sem convidado)
      const { rows: eps } = await db.query(
        `SELECT e.id, e.number, e.title, to_char(e.recorded_on, 'YYYY-MM-DD') AS day FROM episodes e WHERE e.guest_id IS NULL AND e.recorded_on BETWEEN $1::date AND $2::date ORDER BY e.recorded_on LIMIT ${MAX_PER_TYPE}`, [from, to]);
      for (const e of eps) out.push({ type: 'gravacao', id: `gravacao-ep-${e.id}`, title: `Gravação: ${epNo(e.number)} ${e.title}`, sub: 'gravada', day: e.day, time: null, url: `/episodios/${e.id}`, done: true, late: false });
    }
    return out;
  },

  async lembrete({ from, to, owner }, today) {
    const reminders = require('./reminders');
    const p = [from, to]; let w = `g.status = 'agendado' AND date_trunc('milliseconds', g.proposed_at) = r.recording_at AND ${inRange('r.due_at')}`;
    if (owner) { p.push(owner); w += ` AND g.owner_id = $${p.length}`; }
    const { rows } = await db.query(
      `SELECT r.id, r.kind, r.sent_at, ${dayOf('r.due_at')} AS day, ${timeOf('r.due_at')} AS time, g.id AS guest_id, g.name, g.owner_id, u.name AS who
         FROM guest_reminders r JOIN guests g ON g.id = r.guest_id LEFT JOIN users u ON u.id = g.owner_id WHERE ${w} ORDER BY r.due_at LIMIT ${MAX_PER_TYPE}`, p);
    return rows.map((r) => ({
      type: 'lembrete', id: `lembrete-${r.id}`, title: `Lembrete ${reminders.KINDS[r.kind].label.toLowerCase()}: ${r.name}`, sub: r.sent_at ? 'enviado' : reminders.KINDS[r.kind].hint.toLowerCase(),
      day: r.day, time: r.time, url: `/convidados/${r.guest_id}#lembretes`, done: Boolean(r.sent_at), late: !r.sent_at && r.day < today, who: r.who, whoId: r.owner_id,
    }));
  },

  async episodio({ from, to, owner }, today) {
    const p = [from, to]; let w = 'e.aired_on BETWEEN $1::date AND $2::date';
    if (owner) { p.push(owner); w += ` AND e.editor_id = $${p.length}`; }
    const { rows } = await db.query(
      `SELECT e.id, e.number, e.title, e.status, to_char(e.aired_on, 'YYYY-MM-DD') AS day, e.editor_id, u.name AS who FROM episodes e LEFT JOIN users u ON u.id = e.editor_id
        WHERE ${w} ORDER BY e.aired_on, e.number LIMIT ${MAX_PER_TYPE}`, p);
    return rows.map((e) => ({
      type: 'episodio', id: `episodio-${e.id}`, title: `${epNo(e.number)} ${e.title}`, sub: e.status === 'publicado' ? 'publicado' : `publicação prevista · ${C.EPISODE_STATUSES[e.status].toLowerCase()}`,
      day: e.day, time: null, url: `/episodios/${e.id}`, done: e.status === 'publicado', late: e.status !== 'publicado' && e.day < today, who: e.who, whoId: e.editor_id,
    }));
  },

  async post({ from, to, owner }, today) {
    const p = [from, to]; let w = `p.scheduled_at IS NOT NULL AND ${inRange('p.scheduled_at')}`;
    if (owner) { p.push(owner); w += ` AND p.created_by = $${p.length}`; }
    const { rows } = await db.query(
      `SELECT p.id, p.title, p.status, p.platforms, p.created_by, u.name AS who, ${dayOf('p.scheduled_at')} AS day, ${timeOf('p.scheduled_at')} AS time
         FROM episode_publications p LEFT JOIN users u ON u.id = p.created_by WHERE ${w} ORDER BY p.scheduled_at LIMIT ${MAX_PER_TYPE}`, p);
    return rows.map((x) => ({
      type: 'post', id: `post-${x.id}`, title: x.title || 'Post nas redes', sub: [(x.platforms || []).join(', '), POST_STATUS[x.status]].filter(Boolean).join(' · '), day: x.day, time: x.time,
      url: `/social/publicacoes/${x.id}`, done: ['publicado', 'parcial', 'simulado'].includes(x.status), late: x.status === 'erro', tentative: x.status === 'revisao', who: x.who, whoId: x.created_by,
    }));
  },

  async financeiro({ from, to }, today, kinds) {
    const dirs = [kinds.has('receber') && 'entrada', kinds.has('pagar') && 'saida'].filter(Boolean);
    if (!dirs.length) return [];
    const { rows } = await db.query(
      `SELECT id, direction, description, amount_cents, status, to_char(due_on, 'YYYY-MM-DD') AS day FROM fin_entries
        WHERE status <> 'cancelado' AND direction = ANY($3) AND due_on BETWEEN $1::date AND $2::date ORDER BY due_on, id LIMIT ${MAX_PER_TYPE}`, [from, to, dirs]);
    return rows.map((e) => {
      const incoming = e.direction === 'entrada';
      return {
        type: incoming ? 'receber' : 'pagar', id: `fin-${e.id}`, title: e.description, sub: `${incoming ? 'a receber' : 'a pagar'}${e.status === 'pago' ? ' · pago' : ''}`,
        amount: `${incoming ? '+' : '−'}${fmt.formatBRL(e.amount_cents)}`, day: e.day, time: null,
        url: `/financeiro/lancamentos?escopo=${incoming ? 'receber' : 'pagar'}&q=${encodeURIComponent(e.description.slice(0, 60))}`, done: e.status === 'pago', late: e.status === 'previsto' && e.day < today,
      };
    });
  },

  async patrocinio({ from, to, owner }, today) {
    const p = [from, to]; let w = "s.stage IN ('ganho', 'ativo') AND (s.starts_on BETWEEN $1::date AND $2::date OR s.ends_on BETWEEN $1::date AND $2::date)";
    if (owner) { p.push(owner); w += ` AND s.owner_id = $${p.length}`; }
    const { rows } = await db.query(
      `SELECT s.id, s.company, s.owner_id, u.name AS who, to_char(s.starts_on, 'YYYY-MM-DD') AS starts, to_char(s.ends_on, 'YYYY-MM-DD') AS ends
         FROM sponsors s LEFT JOIN users u ON u.id = s.owner_id WHERE ${w} ORDER BY s.company LIMIT ${MAX_PER_TYPE}`, p);
    const out = [];
    for (const s of rows) {
      if (s.starts && s.starts >= from && s.starts <= to) out.push({ type: 'patrocinio', id: `patrocinio-i-${s.id}`, title: `Início da parceria: ${s.company}`, sub: 'patrocínio', day: s.starts, time: null, url: `/patrocinadores/${s.id}`, done: s.starts < today, late: false, who: s.who, whoId: s.owner_id });
      if (s.ends && s.ends >= from && s.ends <= to) out.push({ type: 'patrocinio', id: `patrocinio-f-${s.id}`, title: `Fim da parceria: ${s.company}`, sub: 'renovar ou encerrar', day: s.ends, time: null, url: `/patrocinadores/${s.id}`, done: false, late: false, who: s.who, whoId: s.owner_id });
    }
    return out;
  },
};

// owner: id de quem responde (só os tipos que têm responsável entram; contas não têm). hideDone: tira o que já foi feito.
async function events({ user, from, to, types, owner = null, hideDone = false }) {
  const allowed = new Set(allowedTypes(user).map((t) => t.key));
  let wanted = new Set(types.filter((k) => allowed.has(k)));
  if (owner) wanted = new Set([...wanted].filter((k) => TYPE_BY_KEY[k].hasOwner));
  const today = todayISO();
  const args = { from, to, owner };
  const jobs = [];
  for (const k of ['tarefa', 'gravacao', 'lembrete', 'episodio', 'post', 'patrocinio']) if (wanted.has(k)) jobs.push(SOURCES[k](args, today));
  if (wanted.has('receber') || wanted.has('pagar')) jobs.push(SOURCES.financeiro(args, today, wanted));
  let list = (await Promise.all(jobs)).flat();
  if (hideDone) list = list.filter((e) => !e.done);
  const order = Object.fromEntries(TYPES.map((t, i) => [t.key, i]));
  list.sort((a, b) => a.day.localeCompare(b.day) || (a.time || '~').localeCompare(b.time || '~') || order[a.type] - order[b.type] || a.title.localeCompare(b.title, 'pt-BR'));
  return list;
}

// ---------------------------------------------------------------- configuração e visualizações
// Config: { visao: 'mes'|'semana'|'lista', tipos: [chaves], resp: 'todos'|'eu'|<uuid>, ocultar: bool }
const BUILTIN = [
  { key: 'tudo', name: 'Tudo', hint: 'Todos os tipos, de todo mundo', config: { visao: 'mes', tipos: TYPES.map((t) => t.key), resp: 'todos', ocultar: false } },
  { key: 'meu', name: 'Meu trabalho', hint: 'O que é meu: tarefas, gravações e lembretes da semana', config: { visao: 'semana', tipos: ['tarefa', 'gravacao', 'lembrete'], resp: 'eu', ocultar: true } },
  { key: 'producao', name: 'Produção', hint: 'Gravações, publicações e posts', config: { visao: 'mes', tipos: ['gravacao', 'episodio', 'post', 'tarefa'], resp: 'todos', ocultar: false } },
  { key: 'dinheiro', name: 'Dinheiro', hint: 'Contas a pagar e a receber e as parcerias', perm: 'finance.read', config: { visao: 'lista', tipos: ['receber', 'pagar', 'patrocinio'], resp: 'todos', ocultar: false } },
];

const sortedTypes = (list) => TYPES.map((t) => t.key).filter((k) => list.includes(k));

// Limpa uma config qualquer (de formulário ou do banco) para o que este usuário pode usar.
function cleanConfig(raw, user) {
  const allowed = allowedTypes(user).map((t) => t.key);
  const r = raw || {};
  const tipos = sortedTypes([].concat(r.tipos || []).map(String)).filter((k) => allowed.includes(k));
  const resp = r.resp === 'eu' || isUuid(String(r.resp || '')) ? String(r.resp) : 'todos';
  return { visao: MODES[r.visao] ? r.visao : 'mes', tipos, resp, ocultar: r.ocultar === true || r.ocultar === '1' || r.ocultar === 'on' };
}

const sameConfig = (a, b) => a.visao === b.visao && a.resp === b.resp && a.ocultar === b.ocultar && a.tipos.join(',') === b.tipos.join(',');

// Visualizações que o usuário pode abrir: as da casa (só as que têm algum tipo liberado), as dele e as da equipe.
async function views(user) {
  const out = [];
  for (const b of BUILTIN) {
    if (b.perm && !can(user.role, b.perm)) continue; // "Dinheiro" não aparece para quem não enxerga o financeiro
    const config = cleanConfig(b.config, user);
    if (config.tipos.length) out.push({ key: b.key, name: b.name, hint: b.hint, config, kind: 'casa' });
  }
  const { rows } = await db.query(
    `SELECT v.id, v.user_id, v.name, v.config, v.shared, u.name AS owner_name FROM calendar_views v JOIN users u ON u.id = v.user_id
      WHERE v.user_id = $1 OR v.shared ORDER BY (v.user_id = $1) DESC, lower(v.name)`, [user.id]);
  for (const v of rows) {
    const config = cleanConfig(v.config, user);
    if (!config.tipos.length) continue; // visualização da equipe só de assuntos que este perfil não vê
    out.push({ key: `u${v.id}`, id: v.id, name: v.name, hint: v.shared ? `Da equipe, por ${v.owner_name}` : 'Sua', config, kind: v.user_id === user.id ? 'minha' : 'equipe', shared: v.shared, ownerId: v.user_id });
  }
  return out;
}

// Config final de uma abertura da página: a visualização escolhida (?v=) como base; o formulário de filtros (f=1) manda por cima.
function resolve(query, base, user) {
  const fromForm = query.f === '1';
  const start = cleanConfig(base || BUILTIN[0].config, user);
  const cfg = fromForm
    ? cleanConfig({ visao: query.visao || start.visao, tipos: query.tipos, resp: query.resp || 'todos', ocultar: query.ocultar }, user)
    : { ...start, visao: MODES[query.visao] ? query.visao : start.visao };
  const data = isISO(query.data) ? query.data : todayISO();
  return { ...cfg, data, owner: cfg.resp === 'eu' ? user.id : cfg.resp === 'todos' ? null : cfg.resp };
}

async function saveView({ user, name, config, shared }) {
  const clean = cleanConfig(config, user);
  const title = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!title) return { error: 'Dê um nome para a visualização.' };
  if (!clean.tipos.length) return { error: 'Escolha pelo menos um tipo para salvar.' };
  const share = Boolean(shared) && can(user.role, 'calendar.share');
  const { rows: [v] } = await db.query(
    `INSERT INTO calendar_views (user_id, name, config, shared) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, name) DO UPDATE SET config = EXCLUDED.config, shared = EXCLUDED.shared RETURNING id, (xmax <> 0) AS updated`,
    [user.id, title, JSON.stringify({ visao: clean.visao, tipos: clean.tipos, resp: clean.resp, ocultar: clean.ocultar }), share]);
  return { id: v.id, updated: v.updated, name: title };
}

async function deleteView({ user, id }) {
  const { rows: [v] } = await db.query('SELECT user_id FROM calendar_views WHERE id = $1', [id]);
  if (!v) return { error: 'Visualização não encontrada.', status: 404 };
  if (v.user_id !== user.id && !can(user.role, 'calendar.share')) return { error: 'Só quem criou a visualização (ou a gestão) apaga.', status: 403 };
  await db.query('DELETE FROM calendar_views WHERE id = $1', [id]);
  return { ok: true };
}

module.exports = { TYPES, TYPE_BY_KEY, MODES, BUILTIN, allowedTypes, todayISO, isISO, addDays, range, dayLabel, dayShort, events, cleanConfig, sameConfig, views, resolve, saveView, deleteView };
