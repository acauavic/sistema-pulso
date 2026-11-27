// Categorias de tarefa e tipos de vídeo (Gestão > Sistema > Categorias). Os que já existiam vêm cadastrados ("padrão"); a gestão
// cria novos, renomeia e desativa (não apaga: tarefas, pedidos e metas antigos continuam com o nome certo). Desativado some das listas
// de escolha, mas segue com o nome nas telas.
// O resto do sistema continua lendo C.TASK_KINDS (rótulo da categoria) e contentRequests.KINDS (tipo de conteúdo, com mídia e forma
// de publicar): este serviço atualiza os dois no próprio lugar, a cada 30 s por processo (são duas réplicas e um worker) e na hora
// depois de uma mudança neste processo.
const db = require('../db/pool');
const C = require('../constants');

const TTL = 30_000;
let loadedAt = 0; let loading = null;
const off = { task: new Set(), video: new Set() };
const order = { task: [], video: [] };

async function refresh(force = false) {
  if (!force && Date.now() - loadedAt < TTL) return undefined;
  if (loading) return loading;
  loading = (async () => {
    const [{ rows: cats }, { rows: types }] = await Promise.all([
      db.query('SELECT * FROM task_categories ORDER BY position, lower(label)'),
      db.query('SELECT * FROM video_types ORDER BY position, lower(label)'),
    ]);
    for (const k of Object.keys(C.TASK_KINDS)) if (!cats.some((c) => c.key === k)) delete C.TASK_KINDS[k];
    for (const c of cats) C.TASK_KINDS[c.key] = c.label;
    off.task = new Set(cats.filter((c) => !c.active).map((c) => c.key));
    C.TASK_KINDS_OFF = off.task; // as telas tiram as desativadas das listas de escolha
    order.task = cats.map((c) => c.key);
    const K = require('./contentRequests').KINDS;
    for (const t of types) K[t.key] = { ...(K[t.key] || { media: 'video', publish: 'video' }), label: t.label, active: t.active, custom: !t.builtin };
    off.video = new Set(types.filter((t) => !t.active).map((t) => t.key));
    order.video = types.map((t) => t.key);
    loadedAt = Date.now();
  })().finally(() => { loading = null; });
  return loading;
}

// Para as listas de escolha: só os ativos, na ordem; `keep` mantém o valor atual mesmo desativado (editar algo antigo).
const taskOptions = (keep = null) => order.task.filter((k) => !off.task.has(k) || k === keep);
const videoOptions = (keep = null) => order.video.filter((k) => !off.video.has(k) || k === keep);
const isTaskKind = (k, { active = true } = {}) => Object.prototype.hasOwnProperty.call(C.TASK_KINDS, k) && (!active || !off.task.has(k));
const isVideoType = (k, { active = true } = {}) => order.video.includes(k) && (!active || !off.video.has(k));

const TABLES = { task: 'task_categories', video: 'video_types' };
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
const cleanLabel = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);

async function list(type) {
  const { rows } = await db.query(`SELECT * FROM ${TABLES[type]} ORDER BY position, lower(label)`);
  return rows;
}

async function create(type, label) {
  const name = cleanLabel(label);
  if (!name) return { error: 'Dê um nome.' };
  const { rows: same } = await db.query(`SELECT 1 FROM ${TABLES[type]} WHERE lower(label) = lower($1)`, [name]);
  if (same.length) return { error: `Já existe "${name}".` };
  const base = `${type === 'task' ? 'c' : 't'}_${slug(name) || 'novo'}`;
  let key = base; let i = 2;
  while ((await db.query(`SELECT 1 FROM ${TABLES[type]} WHERE key = $1`, [key])).rows.length) { key = `${base}_${i}`; i += 1; }
  await db.query(`INSERT INTO ${TABLES[type]} (key, label, position) VALUES ($1, $2, (SELECT coalesce(max(position), 0) + 1 FROM ${TABLES[type]}))`, [key, name]);
  await refresh(true);
  return { ok: true, key, label: name };
}

async function update(type, key, { label, active }) {
  const name = label === undefined ? null : cleanLabel(label);
  if (label !== undefined && !name) return { error: 'Dê um nome.' };
  if (name) {
    const { rows: same } = await db.query(`SELECT 1 FROM ${TABLES[type]} WHERE lower(label) = lower($1) AND key <> $2`, [name, key]);
    if (same.length) return { error: `Já existe "${name}".` };
  }
  const { rowCount } = await db.query(`UPDATE ${TABLES[type]} SET label = coalesce($2, label), active = coalesce($3, active) WHERE key = $1`, [key, name, active === undefined ? null : Boolean(active)]);
  if (!rowCount) return { error: 'Não encontrado.' };
  await refresh(true);
  return { ok: true };
}

// Quanto cada um já foi usado (aparece na lista: ajuda a decidir antes de desativar).
async function usage(type) {
  const { rows } = type === 'task'
    ? await db.query('SELECT kind AS key, count(*)::int AS n FROM tasks GROUP BY kind')
    : await db.query('SELECT kind AS key, count(*)::int AS n FROM content_requests GROUP BY kind');
  return Object.fromEntries(rows.map((r) => [r.key, r.n]));
}

module.exports = { refresh, taskOptions, videoOptions, isTaskKind, isVideoType, list, create, update, usage, TABLES };
