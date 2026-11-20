// Projetos (Pulso, Projeto 100…): a lista fica em memória e é relida a cada 30 s por processo (são duas réplicas e um worker) e na
// hora depois de uma mudança neste processo, como as categorias. Regra da casa: cadastro é da casa, trabalho e dinheiro são sempre
// de um projeto. Quem decide o recorte de cada pessoa é `services/scope.js`; aqui ficam a lista, os membros e os ajustes.
const db = require('../db/pool');

const TTL = 30_000;
let loadedAt = 0; let loading = null;
let rows = [];

async function refresh(force = false) {
  if (!force && Date.now() - loadedAt < TTL) return undefined;
  if (loading) return loading;
  loading = (async () => {
    ({ rows } = await db.query('SELECT * FROM projects ORDER BY position, id'));
    loadedAt = Date.now();
  })().finally(() => { loading = null; });
  return loading;
}

const all = () => rows.filter((p) => p.active);
const get = (id) => rows.find((p) => p.id === Number(id)) || null;
// O ativo de menor posição (hoje o Pulso): para onde vai o que entra sem pessoa logada, como os formulários do site.
const defaultId = () => (all()[0] || rows[0] || { id: 1 }).id;
const has = (project, module) => Boolean(project && project.modules && project.modules[module]);
const label = (project, plural = true) => (project ? (plural ? project.video_label_plural : project.video_label) : (plural ? 'Episódios' : 'Episódio'));

async function membershipsOf(userId) {
  const { rows: m } = await db.query('SELECT project_id, finance FROM project_members WHERE user_id = $1 ORDER BY project_id', [userId]);
  return m;
}

async function members(projectId) {
  const { rows: m } = await db.query(
    `SELECT u.id AS user_id, u.name, u.role, pm.finance FROM project_members pm JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = $1 AND u.active ORDER BY lower(u.name)`, [projectId]);
  return m;
}

async function addMember(userId, projectId, { finance = false } = {}) {
  await db.query('INSERT INTO project_members (project_id, user_id, finance) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [projectId, userId, finance]);
}

// Troca a lista de quem participa. Quem fica continua como está (inclusive o "vê o financeiro"); quem entra nasce sem o financeiro.
// Ninguém fica sem projeto: devolve { error } e não muda nada se alguém sairia do único projeto dele.
async function setMembers(projectId, userIds) {
  const ids = [...new Set(userIds)];
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows: orphans } = await client.query(
      `SELECT u.name FROM project_members pm JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = $1 AND u.active AND NOT (pm.user_id = ANY($2::uuid[]))
          AND NOT EXISTS (SELECT 1 FROM project_members o WHERE o.user_id = pm.user_id AND o.project_id <> $1)
        ORDER BY lower(u.name)`, [projectId, ids]);
    if (orphans.length) {
      await client.query('ROLLBACK');
      return { error: `Toda pessoa participa de pelo menos um projeto. ${orphans.map((o) => o.name).join(', ')} só ${orphans.length > 1 ? 'participam' : 'participa'} deste.` };
    }
    await client.query('DELETE FROM project_members pm USING users u WHERE u.id = pm.user_id AND u.active AND pm.project_id = $1 AND NOT (pm.user_id = ANY($2::uuid[]))', [projectId, ids]);
    await client.query(
      `INSERT INTO project_members (project_id, user_id) SELECT $1, u.id FROM users u WHERE u.id = ANY($2::uuid[]) AND u.active ON CONFLICT DO NOTHING`, [projectId, ids]);
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function setLast(userId, projectId) {
  await db.query('UPDATE users SET last_project_id = $2 WHERE id = $1', [userId, projectId || null]);
}

const text = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

// Ajustes que a gestão faz na tela: nome, sigla e como o projeto chama os seus vídeos. Devolve { project } ou { error }.
async function update(id, body) {
  const v = {
    name: text(body.name, 60), sigla: text(body.sigla, 12).toUpperCase(), video_label: text(body.video_label, 30),
    video_label_plural: text(body.video_label_plural, 30), number_prefix: text(body.number_prefix, 8),
  };
  const error = v.name.length < 2 ? 'Informe o nome do projeto.'
    : !/^[A-Z0-9]{2,6}$/.test(v.sigla) ? 'A sigla tem de 2 a 6 letras ou números, sem espaço.'
      : !v.video_label || !v.video_label_plural ? 'Informe como o projeto chama os vídeos, no singular e no plural.'
        : !v.number_prefix ? 'Informe o prefixo do número (ex.: EP.).'
          : null;
  if (error) return { error };
  try {
    const { rows: [project] } = await db.query(
      `UPDATE projects SET name = $2, sigla = $3, video_label = $4, video_label_plural = $5, number_prefix = $6, updated_at = now()
        WHERE id = $1 RETURNING *`, [id, v.name, v.sigla, v.video_label, v.video_label_plural, v.number_prefix]);
    if (!project) return { error: 'Projeto não encontrado.' };
    await refresh(true);
    return { project };
  } catch (err) {
    if (err.code === '23505') return { error: 'Já existe um projeto com esta sigla.' };
    throw err;
  }
}

module.exports = { refresh, all, get, defaultId, has, label, membershipsOf, members, addMember, setMembers, setLast, update };
