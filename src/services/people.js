// A pessoa (cadastro da casa) e as participações dela (uma por projeto, a linha de `guests` com o funil).
// ÚNICO lugar que escreve identidade: a pessoa e todas as participações dela ficam iguais na mesma transação, para a
// mesma pessoa não ser digitada duas vezes e um telefone corrigido num projeto valer no outro.
// As colunas de identidade continuam em `guests` (cópia espelhada) porque centenas de consultas leem `guests.name`.
const db = require('../db/pool');

// O que é da pessoa. O resto (etapa, tema, convite, portal, plateia, episódio) é da participação e nunca é copiado.
const COLUMNS = ['name', 'email', 'phone', 'instagram', 'company', 'job_title', 'bio', 'gender', 'is_plural', 'photo_key', 'reach'];
const SET = (cols, from = 2) => cols.map((c, i) => `${c} = $${i + from}`).join(', ');
// Texto vazio é vazio: identidade é cópia, não "preenche o que falta".
const value = (c, v) => (c === 'is_plural' ? Boolean(v) : (v === undefined || v === null || String(v).trim() === '' ? null : v));

// Roda `fn(q)` numa transação, onde `q(sql, params)` é a consulta dentro dela; se já existe uma (client), usa essa.
const asQuery = (c) => (typeof c === 'function' ? c : (text, params) => c.query(text, params));
async function tx(client, fn) {
  if (client) return fn(asQuery(client));
  const c = await db.getPool().connect();
  try {
    await c.query('BEGIN');
    const out = await fn(asQuery(c));
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

// Copia a identidade da pessoa para todas as participações dela.
async function spread(q, personId) {
  await q(`UPDATE guests SET ${COLUMNS.map((c) => `${c} = p.${c}`).join(', ')}, updated_at = now()
             FROM people p WHERE p.id = $1 AND guests.person_id = $1
               AND (${COLUMNS.map((c) => `guests.${c} IS DISTINCT FROM p.${c}`).join(' OR ')})`, [personId]);
}

// Depois de qualquer escrita de identidade numa participação: a pessoa passa a ter esses dados (e nasce, se faltava) e
// as irmãs acompanham. Chamado por toda rota que escreve em `guests`.
async function sync(guestId, { client = null } = {}) {
  return tx(client, async (q) => {
    const { rows: [g] } = await q(`SELECT id, person_id, ${COLUMNS.join(', ')} FROM guests WHERE id = $1 FOR UPDATE`, [guestId]);
    if (!g) return { personId: null };
    const vals = COLUMNS.map((c) => value(c, g[c]));
    if (!g.person_id) {
      const { rows: [p] } = await q(
        `INSERT INTO people (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, vals);
      await q('UPDATE guests SET person_id = $2 WHERE id = $1', [g.id, p.id]);
      return { personId: p.id };
    }
    // só escreve se algo mudou: assim `sync` chamado por engano não suja o updated_at da pessoa
    await q(`UPDATE people SET ${SET(COLUMNS)}, updated_at = now() WHERE id = $1
               AND (${COLUMNS.map((c, i) => `${c} IS DISTINCT FROM $${i + 2}`).join(' OR ')})`, [g.person_id, ...vals]);
    await spread(q, g.person_id);
    return { personId: g.person_id };
  });
}

// Para leitura (página de detalhe): o id da pessoa, criando-a só se faltava. Não escreve quando já está ligada.
async function idOf(guestId) {
  const { rows: [g] } = await db.query('SELECT person_id FROM guests WHERE id = $1', [guestId]);
  if (!g) return null;
  return g.person_id || (await sync(guestId)).personId;
}

// Grava a pessoa (só os campos mandados) e leva para todas as participações dela.
async function save(personId, fields, { client = null } = {}) {
  const cols = COLUMNS.filter((c) => Object.prototype.hasOwnProperty.call(fields, c));
  if (!cols.length) return { personId: Number(personId) };
  return tx(client, async (q) => {
    await q(`UPDATE people SET ${SET(cols)}, updated_at = now() WHERE id = $1`, [personId, ...cols.map((c) => value(c, fields[c]))]);
    await spread(q, personId);
    return { personId: Number(personId) };
  });
}

const get = async (personId) => (await db.query(`SELECT id, ${COLUMNS.join(', ')} FROM people WHERE id = $1`, [personId])).rows[0] || null;

// Onde mais esta pessoa está: uma linha por participação, só nos projetos de quem está olhando (`pids`).
async function participations(personId, { pids = [], exceptGuestId = null } = {}) {
  if (!personId || !pids.length) return [];
  const { STATUS_BY_KEY } = require('../constants');
  const { rows } = await db.query(
    `SELECT g.id AS guest_id, g.project_id, g.status, g.updated_at, pr.name AS project_name, pr.sigla
       FROM guests g JOIN projects pr ON pr.id = g.project_id
      WHERE g.person_id = $1 AND g.project_id = ANY($2::int[]) AND ($3::int IS NULL OR g.id <> $3)
      ORDER BY pr.position, pr.id`, [personId, pids, exceptGuestId]);
  return rows.map((r) => ({ ...r, stage_label: (STATUS_BY_KEY[r.status] || {}).label || r.status }));
}

// "É a mesma pessoa": as participações da pessoa que sai passam para a que fica (as duas continuam, cada uma no seu
// projeto) e todas ficam com a identidade de quem ficou. A pessoa que sai deixa de existir (ninguém mais aponta para ela).
async function link(keepPersonId, dropPersonId, { client = null } = {}) {
  const keep = Number(keepPersonId); const drop = Number(dropPersonId);
  if (!keep || !drop || keep === drop) return { personId: keep };
  return tx(client, async (q) => {
    await q('UPDATE guests SET person_id = $1 WHERE person_id = $2', [keep, drop]);
    await spread(q, keep);
    await q('DELETE FROM people WHERE id = $1', [drop]);
    return { personId: keep };
  });
}

// "É a mesma pessoa" entre projetos: as duas participações ficam, cada uma no seu projeto, e passam a ser da mesma
// pessoa. `choices` traz, por campo de identidade, o id da participação cujo valor fica. Devolve { keep, drop } ou { error }.
async function join(keepGuestId, dropGuestId, choices = {}, user = null) {
  const { rows } = await db.query('SELECT id, project_id, person_id, name FROM guests WHERE id = ANY($1::int[])', [[Number(keepGuestId), Number(dropGuestId)]]);
  const keep = rows.find((r) => Number(r.id) === Number(keepGuestId));
  const drop = rows.find((r) => Number(r.id) === Number(dropGuestId));
  if (!keep || !drop) return { error: 'Um dos cadastros não existe mais.' };
  if (Number(keep.project_id) === Number(drop.project_id)) return { error: 'Os dois são do mesmo projeto: junte os cadastros.' };
  const { personId: keepPerson } = await sync(keep.id);
  const { personId: dropPerson } = await sync(drop.id);
  if (keepPerson === dropPerson) return { keep, drop }; // já era a mesma pessoa
  const chosen = {};
  for (const c of COLUMNS) {
    if (String(choices[c] ?? '') !== String(drop.id)) continue;
    const { rows: [d] } = await db.query(`SELECT ${c} AS v FROM guests WHERE id = $1`, [drop.id]);
    chosen[c] = d.v;
  }
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const q = (text, params) => client.query(text, params);
    if (Object.keys(chosen).length) await save(keepPerson, chosen, { client: q });
    await link(keepPerson, dropPerson, { client: q });
    const nota = (id, msg) => q("INSERT INTO guest_events (guest_id, user_id, type, message) VALUES ($1, $2, 'nota', $3)", [id, user?.id || null, msg]);
    const who = user?.name ? ` por ${user.name}` : '';
    await nota(keep.id, `Reconhecido como a mesma pessoa de ${drop.name}${who}: as duas participações seguem, cada uma no seu projeto.`);
    await nota(drop.id, `Reconhecido como a mesma pessoa de ${keep.name}${who}: o cadastro da pessoa passou a ser um só.`);
    await q('DELETE FROM duplicate_dismissals WHERE kind = $1 AND (a_id = ANY($2::int[]) OR b_id = ANY($2::int[]))', ['guest', [keep.id, drop.id]]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
  return { keep, drop, personId: keepPerson };
}

module.exports = { COLUMNS, sync, idOf, save, get, participations, link, join };
