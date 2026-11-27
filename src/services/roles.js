// Funções (Gestão > Equipe > Funções): o que cada função acessa, por área. As quatro de fábrica (Superadmin, Gestão,
// Produtora, Editor de Vídeo) usam a matriz do código até alguém editar; Superadmin é travada (tudo, sempre).
// `base` ("trabalha como") decide o Início, os avisos padrão e as tarefas do calendário: é o que vai em users.role.
// A lista fica em memória (30 s, e na hora em que alguém salva), porque é lida em toda página.
const db = require('../db/pool');
const P = require('../permissions');

const ALL = Object.keys(P.PERMISSIONS);
let cache = { at: 0, list: [] };

async function refresh(force = false) {
  if (!force && Date.now() - cache.at < 30_000 && cache.list.length) return cache.list;
  const { rows } = await db.query('SELECT * FROM roles ORDER BY position, lower(name)');
  cache = { at: Date.now(), list: rows };
  return rows;
}
const all = () => cache.list;
const get = (id) => cache.list.find((r) => r.id === Number(id)) || null;
const byKey = (key) => cache.list.find((r) => r.key === key) || null;

// O que a função dá. Superadmin: tudo. De fábrica sem edição: a matriz do "trabalha como".
function permsOf(role) {
  if (!role) return [];
  if (role.locked || role.base === 'superadmin' && role.builtin) return ALL;
  if (role.perms == null) return P.permsOfBase(role.key || role.base);
  return role.perms.filter((p) => ALL.includes(p));
}

// A pessoa: a função padrão e a de cada projeto. Devolve { perms: Set (soma), projectPerms: { [projectId]: Set } }.
function forUser(user, memberships) {
  const fallback = get(user.role_id) || byKey(user.role) || { key: user.role, base: user.role, perms: null, builtin: true };
  const projectPerms = {};
  const union = new Set();
  for (const m of memberships) {
    const role = (m.role_id && get(m.role_id)) || fallback;
    const set = new Set(permsOf(role));
    projectPerms[m.id] = set;
    for (const p of set) union.add(p);
  }
  if (!memberships.length) for (const p of permsOf(fallback)) union.add(p);
  return { perms: union, projectPerms };
}

// Funções que quem está editando pode dar (só o superadmin dá a função de superadmin).
const assignable = (actor) => cache.list.filter((r) => r.base !== 'superadmin' || (actor && actor.role === 'superadmin'));

// O nível de uma área para mostrar (o maior atalho cujas permissões a função tem inteiras).
function levelOf(perms, area) {
  const has = (list) => list.every((p) => perms.includes(p));
  const any = [...area.read, ...area.edit, ...area.manage].some((p) => perms.includes(p));
  if (!any) return 'nenhum';
  if (area.manage.length && has([...area.read, ...area.edit, ...area.manage])) return 'gerencia';
  if (area.edit.length && has([...area.read, ...area.edit])) return 'edita';
  if (has(area.read)) return 've';
  return 'parcial';
}
const LEVELS = { nenhum: 'Não vê', ve: 'Vê', edita: 'Edita', gerencia: 'Gerencia', parcial: 'Sob medida' };

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const isBase = (b) => ['gestao', 'produtora', 'editor_video'].includes(b);

// O que a tela mandou: perm[] (as caixas marcadas). Ver sem fazer: quem marca "editar" ganha o "ver" da área junto.
function permsFrom(body) {
  const chosen = new Set([].concat(body.perm || []).filter((p) => ALL.includes(p)));
  for (const a of P.AREAS) if ([...a.edit, ...a.manage].some((p) => chosen.has(p))) a.read.forEach((p) => chosen.add(p));
  return ALL.filter((p) => chosen.has(p));
}

async function save(id, body, user) {
  const name = clean(body.name, 60);
  const base = isBase(body.base) ? body.base : null;
  if (name.length < 2) return { error: 'Dê um nome à função.' };
  const current = id ? get(id) : null;
  if (id && !current) return { error: 'Função não encontrada.' };
  if (current && current.locked) return { error: 'A função de Superadmin não muda: ela acessa tudo.' };
  const perms = permsFrom(body);
  if (!perms.length) return { error: 'Marque ao menos uma coisa que a função acessa.' };
  try {
    if (current) {
      await db.query('UPDATE roles SET name = $2, base = $3, perms = $4, updated_at = now() WHERE id = $1',
        [current.id, current.builtin ? current.name : name, current.builtin ? current.base : (base || current.base), perms]);
    } else {
      if (!base) return { error: 'Diga como essa função trabalha no dia a dia.' };
      const { rows: [r] } = await db.query('INSERT INTO roles (name, base, perms, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [name, base, perms, user.id]);
      id = r.id;
    }
  } catch (err) {
    if (err.code === '23505') return { error: 'Já existe uma função com esse nome.' };
    throw err;
  }
  await refresh(true);
  if (current) await db.query('UPDATE users SET role = $2 WHERE role_id = $1', [current.id, get(current.id).base]);
  return { ok: true, id };
}

// De fábrica editada volta para a matriz do código.
async function restore(id) {
  const r = get(id);
  if (!r || !r.builtin || r.locked) return { error: 'Só as funções de fábrica voltam ao padrão.' };
  await db.query('UPDATE roles SET perms = NULL, updated_at = now() WHERE id = $1', [r.id]);
  await refresh(true);
  return { ok: true };
}

async function duplicate(id, user) {
  const r = get(id);
  if (!r) return { error: 'Função não encontrada.' };
  let name = `${r.name} (cópia)`;
  for (let n = 2; cache.list.some((x) => x.name.toLowerCase() === name.toLowerCase()); n += 1) name = `${r.name} (cópia ${n})`;
  const { rows: [copy] } = await db.query('INSERT INTO roles (name, base, perms, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
    [name, r.base === 'superadmin' ? 'gestao' : r.base, permsOf(r), user.id]);
  await refresh(true);
  return { ok: true, id: copy.id };
}

// Quantas pessoas usam (como padrão ou num projeto).
async function usage() {
  const { rows } = await db.query(
    `SELECT r.id, (SELECT count(*)::int FROM users u WHERE u.role_id = r.id AND u.active) AS people,
            (SELECT count(*)::int FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.role_id = r.id AND u.active) AS in_projects
       FROM roles r`);
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

async function remove(id) {
  const r = get(id);
  if (!r) return { error: 'Função não encontrada.' };
  if (r.builtin) return { error: 'As funções de fábrica não saem.' };
  const u = (await usage())[r.id];
  if (u && (u.people || u.in_projects)) return { error: 'Tem gente com esta função. Troque a função dessas pessoas antes.' };
  await db.query('UPDATE project_members SET role_id = NULL WHERE role_id = $1', [r.id]);
  await db.query('UPDATE users SET role_id = (SELECT id FROM roles WHERE key = users.role) WHERE role_id = $1', [r.id]);
  await db.query('DELETE FROM roles WHERE id = $1', [r.id]);
  await refresh(true);
  return { ok: true };
}

module.exports = { ALL, LEVELS, refresh, all, get, byKey, permsOf, forUser, assignable, levelOf, permsFrom, save, restore, duplicate, usage, remove };
