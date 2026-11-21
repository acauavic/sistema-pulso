// A empresa (cadastro da casa) e os contratos dela (um por projeto, a linha de `sponsors` com a negociação).
// ÚNICO lugar que escreve identidade de empresa: a empresa e todos os contratos dela ficam iguais na mesma transação.
// Mesmo desenho de `services/people.js`; a diferença é que o nome da empresa se chama `name` aqui e `company` no contrato.
const db = require('../db/pool');

// [coluna em companies, coluna em sponsors]. O resto (etapa, plano, valor, vigência, portal, material) é do contrato.
const PAIRS = [['name', 'company'], ['website', 'website'], ['kind', 'kind'],
  ['contact_name', 'contact_name'], ['contact_email', 'contact_email'], ['contact_phone', 'contact_phone']];
const COLUMNS = PAIRS.map(([, s]) => s);          // como os campos chegam dos formulários (iguais a sponsors)
const sponsorToCompany = (c) => (PAIRS.find(([, s]) => s === c) || [])[0];
const value = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : v);

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

// Copia a identidade da empresa para todos os contratos dela.
async function spread(q, companyId) {
  await q(`UPDATE sponsors SET ${PAIRS.map(([c, s]) => `${s} = e.${c}`).join(', ')}, updated_at = now()
             FROM companies e WHERE e.id = $1 AND sponsors.company_id = $1
               AND (${PAIRS.map(([c, s]) => `sponsors.${s} IS DISTINCT FROM e.${c}`).join(' OR ')})`, [companyId]);
}

// Depois de qualquer escrita de identidade num contrato: a empresa passa a ter esses dados (e nasce, se faltava) e os
// outros contratos dela acompanham.
async function sync(sponsorId, { client = null } = {}) {
  return tx(client, async (q) => {
    const { rows: [s] } = await q(`SELECT id, company_id, ${COLUMNS.join(', ')} FROM sponsors WHERE id = $1 FOR UPDATE`, [sponsorId]);
    if (!s) return { companyId: null };
    const vals = PAIRS.map(([, col]) => value(s[col]));
    if (!s.company_id) {
      const { rows: [e] } = await q(
        `INSERT INTO companies (${PAIRS.map(([c]) => c).join(', ')}) VALUES (${PAIRS.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, vals);
      await q('UPDATE sponsors SET company_id = $2 WHERE id = $1', [s.id, e.id]);
      return { companyId: e.id };
    }
    // só escreve se algo mudou: assim `sync` chamado por engano não suja o updated_at da empresa
    await q(`UPDATE companies SET ${PAIRS.map(([c], i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1
               AND (${PAIRS.map(([c], i) => `${c} IS DISTINCT FROM $${i + 2}`).join(' OR ')})`, [s.company_id, ...vals]);
    await spread(q, s.company_id);
    return { companyId: s.company_id };
  });
}

// Para leitura (página de detalhe): o id da empresa, criando-a só se faltava.
async function idOf(sponsorId) {
  const { rows: [s] } = await db.query('SELECT company_id FROM sponsors WHERE id = $1', [sponsorId]);
  if (!s) return null;
  return s.company_id || (await sync(sponsorId)).companyId;
}

// Grava a empresa (só os campos mandados, nos nomes do contrato) e leva para todos os contratos dela.
async function save(companyId, fields, { client = null } = {}) {
  const cols = COLUMNS.filter((c) => Object.prototype.hasOwnProperty.call(fields, c)).map((c) => [sponsorToCompany(c), fields[c]]);
  if (!cols.length) return { companyId: Number(companyId) };
  return tx(client, async (q) => {
    await q(`UPDATE companies SET ${cols.map(([c], i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
      [companyId, ...cols.map(([, v]) => value(v))]);
    await spread(q, companyId);
    return { companyId: Number(companyId) };
  });
}

const get = async (companyId) => (await db.query(`SELECT id, ${PAIRS.map(([c]) => c).join(', ')} FROM companies WHERE id = $1`, [companyId])).rows[0] || null;

// Onde mais esta empresa está: um contrato por projeto, só nos projetos de quem está olhando (`pids`).
async function participations(companyId, { pids = [], exceptSponsorId = null } = {}) {
  if (!companyId || !pids.length) return [];
  const { SPONSOR_STAGE_BY_KEY } = require('../constants');
  const { rows } = await db.query(
    `SELECT s.id AS sponsor_id, s.project_id, s.stage AS status, s.updated_at, pr.name AS project_name, pr.sigla
       FROM sponsors s JOIN projects pr ON pr.id = s.project_id
      WHERE s.company_id = $1 AND s.project_id = ANY($2::int[]) AND ($3::int IS NULL OR s.id <> $3)
      ORDER BY pr.position, pr.id`, [companyId, pids, exceptSponsorId]);
  return rows.map((r) => ({ ...r, stage_label: (SPONSOR_STAGE_BY_KEY[r.status] || {}).label || r.status }));
}

// Os contratos da empresa que sai passam para a que fica, e todos ficam com a identidade de quem ficou.
async function link(keepId, dropId, { client = null } = {}) {
  const keep = Number(keepId); const drop = Number(dropId);
  if (!keep || !drop || keep === drop) return { companyId: keep };
  return tx(client, async (q) => {
    await q('UPDATE sponsors SET company_id = $1 WHERE company_id = $2', [keep, drop]);
    await spread(q, keep);
    await q('DELETE FROM companies WHERE id = $1', [drop]);
    return { companyId: keep };
  });
}

// "É a mesma empresa" entre projetos: os dois contratos ficam, cada um no seu projeto, e passam a ser da mesma empresa.
async function join(keepSponsorId, dropSponsorId, choices = {}, user = null) {
  const { rows } = await db.query('SELECT id, project_id, company_id, company FROM sponsors WHERE id = ANY($1::int[])', [[Number(keepSponsorId), Number(dropSponsorId)]]);
  const keep = rows.find((r) => Number(r.id) === Number(keepSponsorId));
  const drop = rows.find((r) => Number(r.id) === Number(dropSponsorId));
  if (!keep || !drop) return { error: 'Um dos cadastros não existe mais.' };
  if (Number(keep.project_id) === Number(drop.project_id)) return { error: 'Os dois são do mesmo projeto: junte os cadastros.' };
  const { companyId: keepCompany } = await sync(keep.id);
  const { companyId: dropCompany } = await sync(drop.id);
  if (keepCompany === dropCompany) return { keep, drop };
  const chosen = {};
  for (const c of COLUMNS) {
    if (String(choices[c] ?? '') !== String(drop.id)) continue;
    const { rows: [d] } = await db.query(`SELECT ${c} AS v FROM sponsors WHERE id = $1`, [drop.id]);
    chosen[c] = d.v;
  }
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const q = (text, params) => client.query(text, params);
    if (Object.keys(chosen).length) await save(keepCompany, chosen, { client: q });
    await link(keepCompany, dropCompany, { client: q });
    const nota = (id, msg) => q("INSERT INTO sponsor_events (sponsor_id, user_id, type, message) VALUES ($1, $2, 'nota', $3)", [id, user?.id || null, msg]);
    const who = user?.name ? ` por ${user.name}` : '';
    await nota(keep.id, `Reconhecida como a mesma empresa de ${drop.company}${who}: os dois contratos seguem, cada um no seu projeto.`);
    await nota(drop.id, `Reconhecida como a mesma empresa de ${keep.company}${who}: o cadastro da empresa passou a ser um só.`);
    await q('DELETE FROM duplicate_dismissals WHERE kind = $1 AND (a_id = ANY($2::int[]) OR b_id = ANY($2::int[]))', ['sponsor', [keep.id, drop.id]]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
  return { keep, drop, companyId: keepCompany };
}

module.exports = { COLUMNS, PAIRS, sync, idOf, save, get, participations, link, join };
