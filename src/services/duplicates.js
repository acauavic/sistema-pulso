// Duplicatas de convidados e patrocinadores. Compara na hora (não guarda resultado): mesmo @, e-mail ou telefone (convidado) e
// mesma empresa ou site (patrocinador) = duplicata CERTA; nome parecido (e, no patrocinador, mesmo e-mail ou telefone, porque grupos
// dividem e-mail) = POSSÍVEL. O único estado guardado são os pares marcados como "não é duplicata" (duplicate_dismissals).
// Juntar (merge) move tudo do cadastro que sai para o que fica e manda o que sai para a lixeira.
const db = require('../db/pool');

const TABLE = { guest: 'guests', sponsor: 'sponsors' };
const EVENTS = { guest: ['guest_events', 'guest_id'], sponsor: ['sponsor_events', 'sponsor_id'] };
const URL = { guest: (id) => `/convidados/${id}`, sponsor: (id) => `/patrocinadores/${id}` };
const SLUG = { guest: 'convidados', sponsor: 'patrocinadores' };
const KIND_OF_SLUG = { convidados: 'guest', patrocinadores: 'sponsor' };

// ---------------------------------------------------------------- normalização
const deaccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = (s) => deaccent(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const TITLE = /^(dr|dra|drª|doutor|doutora|prof|profa|professor|professora)\s+/;
function personName(s) {
  let n = words(String(s || '').replace(/dr\.?ª/gi, 'dra ')).replace(/[0-9]/g, '').replace(/\s+/g, ' ').trim();
  while (TITLE.test(n)) n = n.replace(TITLE, '');
  return n;
}
const SUFFIX = /\s+(ltda|eireli|epp|me|sa|s a|inc|limitada)$/;
function companyName(s) {
  let n = words(s);
  while (SUFFIX.test(n)) n = n.replace(SUFFIX, '');
  return n;
}
function instagram(s) {
  let v = String(s || '').trim();
  const url = v.match(/instagram\.com\/([^/?#\s]+)/i);
  if (url) v = url[1];
  v = v.replace(/^@+/, '').replace(/[/?#].*$/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(v) ? v : '';
}
const email = (s) => { const v = String(s || '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : ''; };
function phone(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.startsWith('0') && d.length >= 11) d = d.replace(/^0+/, '');
  return d.length >= 10 ? d : '';
}
// Domínios de redes e agregadores: dois patrocinadores com "site" no linktr.ee não são a mesma empresa.
const SHARED_HOSTS = new Set(['instagram.com', 'facebook.com', 'fb.com', 'linktr.ee', 'linktree.com', 'wa.me', 'api.whatsapp.com', 'whatsapp.com', 'bit.ly', 'tiktok.com', 'youtube.com', 'linkedin.com', 'beacons.ai', 'linkin.bio', 'google.com', 'sites.google.com', 'canva.site']);
function site(s) {
  const host = String(s || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[/?#:].*$/, '');
  if (!host.includes('.') || SHARED_HOSTS.has(host)) return '';
  return host;
}

// Distância de edição (Levenshtein) com corte: devolve max+1 assim que passa do limite.
function distance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
const typo = (a, b) => { const len = Math.min(a.length, b.length); if (len < 4) return false; return distance(a, b, 2) <= (len >= 8 ? 2 : 1); };
function similarPerson(a, b) {
  if (!a || !b) return false;
  if (a === b || typo(a, b)) return true;
  const ta = a.split(' '); const tb = b.split(' ');
  return ta.length >= 2 && tb.length >= 2 && ta[0] === tb[0] && ta.at(-1) === tb.at(-1);
}
function similarCompany(a, b) {
  if (!a || !b) return false;
  if (typo(a, b)) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 5 && (l.startsWith(`${s} `) || l.endsWith(` ${s}`));
}

// Registro "plano" (o que a comparação usa), de uma linha do banco ou de um formulário.
function flat(kind, r) {
  if (kind === 'guest') return { id: r.id, name: r.name, instagram: r.instagram, email: r.email, phone: r.phone };
  return { id: r.id, name: r.company ?? r.name, website: r.website, email: r.contact_email ?? r.email, phone: r.contact_phone ?? r.phone };
}
function keys(kind, r) {
  const f = flat(kind, r);
  return kind === 'guest'
    ? { name: personName(f.name), ig: instagram(f.instagram), email: email(f.email), phone: phone(f.phone) }
    : { name: companyName(f.name), site: site(f.website), email: email(f.email), phone: phone(f.phone) };
}

// { level: 'certa' | 'possivel', reasons: [...] } ou null. Recebe as chaves já normalizadas (keys()).
function compare(kind, a, b) {
  const sure = []; const maybe = [];
  if (kind === 'guest') {
    if (a.ig && a.ig === b.ig) sure.push('mesmo Instagram');
    if (a.email && a.email === b.email) sure.push('mesmo e-mail');
    if (a.phone && a.phone === b.phone) sure.push('mesmo telefone');
    if (a.name && a.name === b.name) maybe.push('mesmo nome');
    else if (similarPerson(a.name, b.name)) maybe.push('nome parecido');
  } else {
    if (a.name && a.name === b.name) sure.push('mesma empresa');
    else if (similarCompany(a.name, b.name)) maybe.push('nome parecido');
    if (a.site && a.site === b.site) sure.push('mesmo site');
    if (a.email && a.email === b.email) maybe.push('mesmo e-mail');
    if (a.phone && a.phone === b.phone) maybe.push('mesmo telefone');
  }
  if (sure.length) return { level: 'certa', reasons: [...sure, ...maybe] };
  if (maybe.length) return { level: 'possivel', reasons: maybe };
  return null;
}

// ---------------------------------------------------------------- consultas
const LIST_SQL = {
  guest: `SELECT g.id, g.name, g.instagram, g.email, g.phone, g.status AS stage, g.created_at, u.name AS owner_name
            FROM guests g LEFT JOIN users u ON u.id = g.owner_id`,
  sponsor: `SELECT s.id, s.company AS name, s.website, s.contact_email AS email, s.contact_phone AS phone, s.stage, s.created_at, u.name AS owner_name
              FROM sponsors s LEFT JOIN users u ON u.id = s.owner_id`,
};
const stageLabel = (kind, key) => { const C = require('../constants'); return (kind === 'guest' ? C.STATUS_BY_KEY : C.SPONSOR_STAGE_BY_KEY)[key]?.label || key; };
const all = async (kind) => (await db.query(LIST_SQL[kind])).rows.map((r) => ({ ...r, stage_label: stageLabel(kind, r.stage) }));
const pairKey = (a, b) => (Number(a) < Number(b) ? `${a}-${b}` : `${b}-${a}`);
async function dismissedSet(kind) {
  const { rows } = await db.query('SELECT a_id, b_id FROM duplicate_dismissals WHERE kind = $1', [kind]);
  return new Set(rows.map((r) => `${r.a_id}-${r.b_id}`));
}
const LEVEL_ORDER = { certa: 0, possivel: 1 };
const byLevel = (x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level] || String(x.name || x.a?.name).localeCompare(String(y.name || y.b?.name), 'pt-BR');

// Quem parece ser o mesmo que `rec` (formulário ou cadastro). excludeId: o próprio cadastro (e então os pares dispensados não voltam).
async function findFor(kind, rec, { excludeId = null } = {}) {
  const k = keys(kind, rec);
  const [rows, dismissed] = await Promise.all([all(kind), excludeId ? dismissedSet(kind) : new Set()]);
  const out = [];
  for (const r of rows) {
    if (excludeId && Number(r.id) === Number(excludeId)) continue;
    if (excludeId && dismissed.has(pairKey(excludeId, r.id))) continue;
    const c = compare(kind, k, keys(kind, r));
    if (c) out.push({ ...r, ...c });
  }
  return out.sort(byLevel);
}

// Todos os pares de um tipo: { pairs: [{ a, b, level, reasons }], dismissed: [...] }.
async function pairs(kind) {
  const [rows, dismissed] = await Promise.all([all(kind), dismissedSet(kind)]);
  const ks = rows.map((r) => keys(kind, r));
  const out = []; const off = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const c = compare(kind, ks[i], ks[j]);
      if (!c) continue;
      const [a, b] = Number(rows[i].id) < Number(rows[j].id) ? [rows[i], rows[j]] : [rows[j], rows[i]];
      (dismissed.has(pairKey(a.id, b.id)) ? off : out).push({ a, b, ...c });
    }
  }
  const sort = (x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level] || String(x.a.name).localeCompare(String(y.a.name), 'pt-BR');
  return { pairs: out.sort(sort), dismissed: off.sort(sort) };
}

async function dismiss(kind, a, b, userId) {
  const [x, y] = Number(a) < Number(b) ? [a, b] : [b, a];
  await db.query('INSERT INTO duplicate_dismissals (kind, a_id, b_id, dismissed_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [kind, x, y, userId || null]);
}
async function undismiss(kind, a, b) {
  const [x, y] = Number(a) < Number(b) ? [a, b] : [b, a];
  await db.query('DELETE FROM duplicate_dismissals WHERE kind = $1 AND a_id = $2 AND b_id = $3', [kind, x, y]);
}

// ---------------------------------------------------------------- juntar
// Campos que a pessoa escolhe quando os dois têm valores diferentes; vazio de um lado é preenchido com o do outro sem perguntar.
const FIELDS = {
  guest: { name: 'Nome', instagram: 'Instagram', email: 'E-mail', phone: 'Telefone', company: 'Empresa', job_title: 'Cargo', profile: 'Perfil',
    topic: 'Tema', invite_reason: 'Motivo do convite', positioning: 'Posicionamento', bio: 'Bio', youtube_url: 'YouTube', spotify_url: 'Spotify' },
  sponsor: { company: 'Empresa', website: 'Site', kind: 'Tipo', contact_name: 'Contato na empresa', contact_email: 'E-mail do contato', contact_phone: 'Telefone do contato' },
};
// Preenchidos só quando o que fica não tem (sem escolha): responsável, ligações e datas.
const FILL = {
  guest: ['owner_id', 'sponsor_id', 'sponsor_relation', 'proposed_at', 'photo_key'],
  sponsor: ['owner_id', 'tier', 'value_cents', 'paid_at', 'starts_on', 'ends_on'],
};
// Link público que acompanha o cadastro quando o que fica não tem um (o convite já mandado continua funcionando).
const LINKS = {
  guest: { has: 'invite_token', cols: ['invite_token', 'short_url', 'short_keyword', 'invite_generated_at', 'invite_sent_at', 'invite_viewed_at', 'responded_at', 'rsvp_message'] },
  sponsor: { has: 'public_token', cols: ['public_token', 'token_generated_at', 'kit_viewed_at', 'brief_completed_at'] },
};
const empty = (v) => v === null || v === undefined || String(v).trim() === '';
const same = (field, a, b) => {
  if (field === 'instagram') return instagram(a) === instagram(b);
  if (/email/.test(field)) return email(a) === email(b) || String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  if (/phone/.test(field)) return phone(a) && phone(a) === phone(b);
  if (field === 'website') return site(a) && site(a) === site(b);
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
};

// Campos preenchidos nos dois com valores diferentes: [{ field, label, a, b }].
function conflicts(kind, a, b) {
  return Object.entries(FIELDS[kind]).filter(([f]) => !empty(a[f]) && !empty(b[f]) && !same(f, a[f], b[f]))
    .map(([field, label]) => ({ field, label, a: a[field], b: b[field] }));
}

const RANK = {
  guest: { gravado: 5, agendado: 4, em_agendamento: 3, convite_enviado: 2, prospect: 1, perdido: 0, cancelado: 0 },
  sponsor: { ativo: 5, ganho: 4, inativo: 3, negociacao: 2, prospect: 1, perdido: 0 },
};
const COUNTS = {
  guest: [
    ['Histórico', 'SELECT count(*) FROM guest_events WHERE guest_id = $1'],
    ['Abordagens', "SELECT count(*) FROM outreach_attempts WHERE subject_type = 'guest' AND subject_id = $1"],
    ['Comentários', "SELECT count(*) FROM comments WHERE entity_type = 'guest' AND entity_id = $1"],
    ['Tarefas', 'SELECT count(*) FROM tasks WHERE guest_id = $1'],
    ['Episódios', 'SELECT count(*) FROM episodes WHERE guest_id = $1'],
    ['Lançamentos', 'SELECT count(*) FROM fin_entries WHERE guest_id = $1'],
  ],
  sponsor: [
    ['Histórico', 'SELECT count(*) FROM sponsor_events WHERE sponsor_id = $1'],
    ['Abordagens', "SELECT count(*) FROM outreach_attempts WHERE subject_type = 'sponsor' AND subject_id = $1"],
    ['Comentários', "SELECT count(*) FROM comments WHERE entity_type = 'sponsor' AND entity_id = $1"],
    ['Tarefas', 'SELECT count(*) FROM tasks WHERE sponsor_id = $1'],
    ['Episódios', 'SELECT count(*) FROM sponsor_episodes WHERE sponsor_id = $1'],
    ['Lançamentos', 'SELECT count(*) FROM fin_entries WHERE sponsor_id = $1'],
    ['Reuniões', 'SELECT count(*) FROM sponsor_meetings WHERE sponsor_id = $1'],
    ['Arquivos', 'SELECT count(*) FROM sponsor_files WHERE sponsor_id = $1'],
  ],
};
// O que cada cadastro tem: [{ label, n }] e o total.
async function summary(kind, id) {
  const items = [];
  for (const [label, sql] of COUNTS[kind]) items.push({ label, n: Number((await db.query(sql, [id])).rows[0].count) });
  return { items, total: items.reduce((s, x) => s + x.n, 0) };
}
// Qual fica por padrão: etapa mais avançada, depois mais histórico, depois o mais antigo.
function pickKeep(kind, a, b, sa, sb) {
  const stage = kind === 'guest' ? 'status' : 'stage';
  const ra = RANK[kind][a[stage]] ?? 0; const rb = RANK[kind][b[stage]] ?? 0;
  if (ra !== rb) return ra > rb ? a.id : b.id;
  if (sa.total !== sb.total) return sa.total > sb.total ? a.id : b.id;
  return Number(a.id) < Number(b.id) ? a.id : b.id;
}
// Links públicos do cadastro que deixam de funcionar se ele sair (o convite/media kit acompanha quando o outro não tem).
function lostLinks(kind, rec, other) {
  const out = [];
  if (kind === 'guest') {
    if (rec.invite_token && other.invite_token) out.push('o link do convite');
    if (rec.portal_enabled && rec.portal_token) out.push('o portal do convidado');
    if (rec.audience_page_enabled && rec.audience_slug) out.push('a página da plateia');
  } else if (rec.public_token && other.public_token) out.push('os links do media kit, formulário e portal');
  return out;
}

const ident = (name) => String(name).split('.').map((p) => `"${p.replace(/^"|"$/g, '').replace(/"/g, '""')}"`).join('.');

// Passa para `keepId` tudo que aponta para `dropId` por chave estrangeira (lidas do catálogo: tabela nova entra sozinha). Linha que
// bateria num índice único com uma do que fica (o mesmo episódio ligado duas vezes, dois briefings) não se move: vai com o que sai
// para a lixeira.
async function moveRefs(q, table, keepId, dropId) {
  const { rows: fks } = await q(
    `SELECT c.conrelid::regclass::text AS child, a.attname AS col
       FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = $1::regclass AND array_length(c.conkey, 1) = 1`, [table]);
  for (const { child, col } of fks) {
    const { rows: idx } = await q(
      `SELECT array_agg(a.attname::text ORDER BY k.ord) AS cols, bool_or(k.attnum = 0) AS expr
         FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
         LEFT JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
        WHERE i.indrelid = $1::regclass AND i.indisunique GROUP BY i.indexrelid`, [child]);
    const guards = idx.filter((x) => !x.expr && x.cols.includes(col)).map((x) => {
      const others = x.cols.filter((c) => c !== col);
      return `NOT EXISTS (SELECT 1 FROM ${ident(child)} k WHERE k.${ident(col)} = $1${others.map((c) => ` AND k.${ident(c)} IS NOT DISTINCT FROM d.${ident(c)}`).join('')})`;
    });
    await q(`UPDATE ${ident(child)} d SET ${ident(col)} = $1 WHERE d.${ident(col)} = $2${guards.map((g) => ` AND ${g}`).join('')}`, [keepId, dropId]);
  }
}

// Junta `dropId` em `keepId`. choices: { campo: id do cadastro cujo valor fica }. Devolve { keep, drop, trash } ou { error }.
async function merge(kind, keepId, dropId, choices, user) {
  const table = TABLE[kind];
  if (!table) return { error: 'Tipo desconhecido.' };
  if (!Number.isInteger(Number(keepId)) || !Number.isInteger(Number(dropId)) || Number(keepId) === Number(dropId)) return { error: 'Escolha dois cadastros diferentes.' };
  const nameCol = kind === 'guest' ? 'name' : 'company';
  const client = await db.getPool().connect();
  const q = (text, params) => client.query(text, params);
  let keep; let drop;
  try {
    await q('BEGIN');
    const { rows } = await q(`SELECT * FROM ${table} WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`, [[Number(keepId), Number(dropId)]]);
    keep = rows.find((r) => Number(r.id) === Number(keepId)); drop = rows.find((r) => Number(r.id) === Number(dropId));
    if (!keep || !drop) { await q('ROLLBACK'); return { error: 'Um dos cadastros não existe mais.' }; }

    const set = {}; const lost = []; const clearDrop = {};
    for (const [f, label] of Object.entries(FIELDS[kind])) {
      if (empty(keep[f]) && !empty(drop[f])) set[f] = drop[f];
      else if (!empty(keep[f]) && !empty(drop[f]) && !same(f, keep[f], drop[f])) {
        const useDrop = String(choices?.[f] ?? '') === String(drop.id);
        if (useDrop) set[f] = drop[f];
        lost.push(`${label.toLowerCase()}: ${useDrop ? keep[f] : drop[f]}`);
      }
    }
    for (const f of FILL[kind]) if (empty(keep[f]) && !empty(drop[f])) { set[f] = drop[f]; if (f === 'photo_key') clearDrop.photo_key = null; }
    if (kind === 'guest' && set.sponsor_id && empty(keep.sponsor_relation)) set.sponsor_relation = drop.sponsor_relation;
    const L = LINKS[kind];
    if (empty(keep[L.has]) && !empty(drop[L.has])) for (const c of L.cols) { set[c] = drop[c]; clearDrop[c] = null; }
    const who = `${drop[nameCol]}, #${drop.id}`;
    const notes = [keep.notes, !empty(drop.notes) && `Do cadastro juntado (${who}): ${drop.notes}`, lost.length && `Valores que não ficaram ao juntar com ${who}: ${lost.join('; ')}.`].filter((x) => !empty(x));
    if (notes.length) set.notes = notes.join('\n\n');

    const upd = async (id, obj) => {
      const cols = Object.keys(obj); if (!cols.length) return;
      await q(`UPDATE ${table} SET ${cols.map((c, i) => `${ident(c)} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [id, ...cols.map((c) => obj[c])]);
    };
    await upd(drop.id, clearDrop); // tira do que sai o que é único (link) ou que a lixeira apagaria (foto) antes de passar para o que fica
    await upd(keep.id, set);
    await moveRefs(q, table, keep.id, drop.id);
    await q('UPDATE comments SET entity_id = $1 WHERE entity_type = $3 AND entity_id = $2', [keep.id, drop.id, kind]);
    await q('UPDATE outreach_attempts SET subject_id = $1 WHERE subject_type = $3 AND subject_id = $2', [keep.id, drop.id, kind]);
    const [evTable, evCol] = EVENTS[kind];
    const created = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(drop.created_at));
    await q(`INSERT INTO ${evTable} (${evCol}, user_id, type, message) VALUES ($1, $2, 'nota', $3)`,
      [keep.id, user?.id || null, `Juntado com o cadastro de ${drop[nameCol]} (criado em ${created})${user?.name ? ` por ${user.name}` : ''}. O histórico dele está aqui; o cadastro foi para a lixeira.`]);
    await q('DELETE FROM duplicate_dismissals WHERE kind = $1 AND (a_id = $2 OR b_id = $2)', [kind, drop.id]);
    await q('COMMIT');
  } catch (err) {
    await q('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
  const trash = await require('./trash').remove(kind, drop.id, { user });
  return { keep: { id: keep.id, name: keep[nameCol] }, drop: { id: drop.id, name: drop[nameCol] }, trash };
}

module.exports = {
  norm: { personName, companyName, instagram, email, phone, site }, distance, keys, compare, findFor, pairs, dismiss, undismiss,
  conflicts, summary, pickKeep, lostLinks, merge, stageLabel, FIELDS, TABLE, URL, SLUG, KIND_OF_SLUG,
};
