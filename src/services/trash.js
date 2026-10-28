// Lixeira: o que se apaga no sistema fica 15 dias guardado e pode voltar do jeito que estava.
// Ao apagar, guardamos o item e tudo o que o banco apagaria junto (as chaves estrangeiras em cascata, lidas do próprio Postgres),
// os comentários e anexos dele (que não têm chave estrangeira) e as ligações que o banco desfaria (ON DELETE SET NULL).
// Restaurar devolve as linhas com os mesmos ids e refaz as ligações. Os arquivos no armazenamento (Backblaze) não são tocados ao
// apagar: só saem na limpeza, quando o prazo vence ou alguém da gestão apaga de vez.
const crypto = require('crypto');
const db = require('../db/pool');
const b2 = require('./b2');

const DAYS = 15;
// Tabelas que não voltam: filas e sessões (restaurar um job reabriria trabalho já feito; uma sessão, um acesso).
const SKIP = new Set(['jobs', 'sponsor_sessions', 'sessions', 'trash_items']);
// Comentários e anexos apontam por (entity_type, entity_id), sem chave estrangeira.
const COMMENT_TYPE = { guests: 'guest', sponsors: 'sponsor', episodes: 'episode', tasks: 'task', episode_clips: 'clip', content_requests: 'content_request' };
const ATTACH_TYPE = { tasks: 'task', content_requests: 'content_request', comments: 'comment', episode_comments: 'review' };
// Colunas que guardam o caminho de um arquivo no Backblaze.
const FILE_COLUMNS = { episode_files: 'storage_key', episode_clips: 'storage_key', episode_covers: 'storage_key', episode_frames: 'storage_key', sponsor_files: 'storage_key', attachments: 'storage_key', guests: 'photo_key' };

const epTag = (n) => (n ? `EP.${String(n).padStart(3, '0')}` : '');
const COVER_KINDS = { youtube_thumb: 'Thumbnail do YouTube', reel_cover: 'Capa de Reels/TikTok', post_quote: 'Post de frase', post_split: 'Tela dividida', carousel: 'Carrossel', entrega: 'Imagem entregue' };
const KINDS = {
  episode: { table: 'episodes', label: 'Episódio', title: (r) => [epTag(r.number), r.title].filter(Boolean).join(' · '), url: (r) => `/episodios/${r.id}` },
  guest: { table: 'guests', label: 'Convidado', title: (r) => r.name, url: (r) => `/convidados/${r.id}` },
  sponsor: { table: 'sponsors', label: 'Patrocinador', title: (r) => r.company, url: (r) => `/patrocinadores/${r.id}` },
  task: { table: 'tasks', label: 'Tarefa', title: (r) => r.title, url: (r) => `/tarefas/${r.id}` },
  clip: { table: 'episode_clips', label: 'Corte', title: (r) => r.title, url: (r) => `/cortes/${r.id}` },
  cover: { table: 'episode_covers', label: 'Imagem', title: (r) => r.label || COVER_KINDS[r.kind] || 'Imagem', url: (r) => (r.request_id ? `/conteudo/pedidos/${r.request_id}` : r.clip_id ? `/cortes/${r.clip_id}` : '/conteudo?vista=posts') },
  request: { table: 'content_requests', label: 'Pedido de conteúdo', title: (r) => r.title, url: (r) => `/conteudo/pedidos/${r.id}` },
  episode_file: { table: 'episode_files', label: 'Arquivo do episódio', title: (r) => r.filename, url: (r) => `/episodios/${r.episode_id}#material` },
  sponsor_file: { table: 'sponsor_files', label: 'Arquivo do patrocinador', title: (r) => r.filename || r.kind, url: (r) => `/patrocinadores/${r.sponsor_id}#arquivos` },
  fin_entry: { table: 'fin_entries', label: 'Lançamento', title: (r) => r.description, url: () => '/financeiro/lancamentos' },
};
// Para a mensagem de quando algo de que o item depende não existe mais.
const PARENT_LABEL = { episodes: 'o episódio', guests: 'o convidado', sponsors: 'o patrocinador', content_requests: 'o pedido', episode_clips: 'o corte', episode_covers: 'a imagem', tasks: 'a tarefa', users: 'a pessoa', episode_files: 'o arquivo', comments: 'o comentário' };

const ident = (name) => String(name).split('.').map((p) => `"${p.replace(/^"|"$/g, '').replace(/"/g, '""')}"`).join('.');

// Chaves estrangeiras (de uma coluna) e chaves primárias, lidas do catálogo uma vez por processo.
let meta = null;
async function schema(q) {
  if (meta) return meta;
  const { rows: fk } = await q(
    `SELECT c.conname AS name, c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent, c.confdeltype AS del,
            a.attname AS col, af.attname AS pcol, NOT a.attnotnull AS nullable
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
      WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1`);
  const { rows: pk } = await q(
    `SELECT i.indrelid::regclass::text AS t, array_agg(a.attname::text ORDER BY array_position(i.indkey::int2[], a.attnum)) AS cols
       FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indisprimary GROUP BY 1`);
  const byParent = {}; const byName = {};
  for (const f of fk) { (byParent[f.parent] ||= []).push(f); byName[f.name] = f; }
  meta = { byParent, byName, pk: Object.fromEntries(pk.map((p) => [p.t, p.cols])) };
  return meta;
}

const pkCols = (m, table, row) => m.pk[table] || Object.keys(row);
const pkOf = (m, table, row) => Object.fromEntries(pkCols(m, table, row).map((c) => [c, row[c]]));
const keyOf = (m, table, row) => `${table}:${JSON.stringify(pkCols(m, table, row).map((c) => row[c]))}`;
const rowsOf = async (q, table, where, params) => (await q(`SELECT to_jsonb(t) AS j FROM ${ident(table)} t WHERE ${where}`, params)).rows.map((r) => r.j);

// Tudo o que sai junto com o item. extra: [{ table, where, params }] linhas a mais que a exclusão leva (ex.: lançamentos do patrocínio);
// states: [{ table, where, params }] linhas que a exclusão altera (ex.: lançamentos cancelados) e que voltam ao que eram.
async function capture(q, table, id, { extra = [], states = [] } = {}) {
  const m = await schema(q);
  const out = { rows: [], relinks: [], states: [] };
  const seen = new Set();
  const queue = [];
  const add = (t, rows) => {
    const fresh = rows.filter((r) => { const k = keyOf(m, t, r); if (seen.has(k)) return false; seen.add(k); return true; });
    for (const row of fresh) out.rows.push({ table: t, row });
    if (fresh.length) queue.push({ table: t, rows: fresh });
  };
  add(table, await rowsOf(q, table, 'id::text = $1', [String(id)]));
  if (!out.rows.length) return null;
  for (const e of extra) add(e.table, await rowsOf(q, e.table, e.where, e.params));
  while (queue.length) {
    const { table: t, rows } = queue.shift();
    for (const f of m.byParent[t] || []) {
      if (SKIP.has(f.child)) continue;
      const vals = [...new Set(rows.map((r) => r[f.pcol]).filter((v) => v != null).map(String))];
      if (!vals.length) continue;
      const kids = await rowsOf(q, f.child, `${ident(f.col)}::text = ANY($1::text[])`, [vals]);
      if (f.del === 'c') add(f.child, kids);
      else if (f.del === 'n') for (const k of kids) out.relinks.push({ table: f.child, key: keyOf(m, f.child, k), pk: pkOf(m, f.child, k), col: f.col, value: k[f.col] });
    }
    const ids = rows.map((r) => String(r.id)).filter((v) => v !== 'undefined');
    if (COMMENT_TYPE[t] && ids.length) add('comments', await rowsOf(q, 'comments', 'entity_type = $1 AND entity_id::text = ANY($2::text[])', [COMMENT_TYPE[t], ids]));
    if (ATTACH_TYPE[t] && ids.length) add('attachments', await rowsOf(q, 'attachments', 'entity_type = $1 AND entity_id::text = ANY($2::text[])', [ATTACH_TYPE[t], ids]));
  }
  out.relinks = out.relinks.filter((l) => !seen.has(l.key)).map(({ key, ...l }) => l); // a linha também volta: já vem com a ligação
  for (const s of states) for (const row of await rowsOf(q, s.table, s.where, s.params)) if (!seen.has(keyOf(m, s.table, row))) out.states.push({ table: s.table, row });
  return out;
}

const filesOf = (snap) => [...new Set(snap.rows.map((r) => FILE_COLUMNS[r.table] && r.row[FILE_COLUMNS[r.table]]).filter(Boolean))];

// De onde o item era, para a lista da lixeira (episódio do corte, patrocinador do arquivo…).
async function contextOf(q, kind, row) {
  if (kind === 'episode') return row.guest_id ? (await q('SELECT name FROM guests WHERE id = $1', [row.guest_id])).rows[0]?.name || null : null;
  if (row.episode_id && kind !== 'episode') {
    const { rows: [e] } = await q('SELECT number, title FROM episodes WHERE id = $1', [row.episode_id]);
    if (e) return [epTag(e.number), e.title].filter(Boolean).join(' · ');
  }
  if (row.sponsor_id) return (await q('SELECT company FROM sponsors WHERE id = $1', [row.sponsor_id])).rows[0]?.company || null;
  if (row.guest_id) return (await q('SELECT name FROM guests WHERE id = $1', [row.guest_id])).rows[0]?.name || null;
  return null;
}

// Manda o item para a lixeira. before(): efeitos da exclusão que rodam antes de apagar (ex.: o financeiro cancela o que era do
// episódio), depois de guardada a foto de como estava. Devolve { id, batch, title } ou null se o item não existe.
async function remove(kind, id, { user = null, batch = null, extra = [], states = [], before = null } = {}) {
  const def = KINDS[kind];
  if (!def) throw new Error(`Lixeira: tipo desconhecido (${kind})`);
  const client = await db.getPool().connect();
  const q = (text, params) => client.query(text, params);
  try {
    await q('BEGIN');
    const snap = await capture(q, def.table, id, { extra, states });
    if (!snap) { await q('ROLLBACK'); return null; }
    const root = snap.rows[0].row;
    const context = await contextOf(q, kind, root);
    if (before) await before(q);
    // apaga o item (o banco leva a cascata) e o que não tem chave estrangeira (comentários, anexos, extras), da última para a primeira
    const m = await schema(q);
    const tables = [...new Set(snap.rows.map((r) => r.table))].reverse();
    for (const t of tables) {
      const cols = m.pk[t];
      if (!cols || cols.length !== 1) continue; // chave composta: só existe por cascata
      const ids = snap.rows.filter((r) => r.table === t).map((r) => String(r.row[cols[0]]));
      await q(`DELETE FROM ${ident(t)} WHERE ${ident(cols[0])}::text = ANY($1::text[])`, [ids]);
    }
    const b = batch || crypto.randomUUID();
    const title = String(def.title(root) || def.label).slice(0, 200);
    const { rows: [t] } = await q(
      `INSERT INTO trash_items (kind, ref_id, title, context, batch, payload, storage_keys, deleted_by, purge_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(days => $9)) RETURNING id`,
      [kind, String(root.id), title, context, b, snap, filesOf(snap), user?.id || null, DAYS]);
    await q('COMMIT');
    return { id: t.id, batch: b, title, kind };
  } catch (err) {
    await q('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}

async function exists(q, m, table, row) {
  const cols = pkCols(m, table, row);
  const { rows } = await q(`SELECT 1 FROM ${ident(table)} WHERE ${cols.map((c, i) => `${ident(c)}::text = $${i + 1}`).join(' AND ')}`, cols.map((c) => String(row[c])));
  return rows.length > 0;
}

// Devolve o item ao lugar. { ok, kind, url, title } ou { error } (nada muda se der erro).
async function restore(trashId) {
  const client = await db.getPool().connect();
  const q = (text, params) => client.query(text, params);
  try {
    await q('BEGIN');
    const { rows: [t] } = await q('SELECT * FROM trash_items WHERE id = $1 FOR UPDATE', [trashId]);
    if (!t) { await q('ROLLBACK'); return { error: 'Este item não está mais na lixeira.' }; }
    const m = await schema(q);
    let pending = t.payload.rows.map((r) => ({ ...r, row: { ...r.row } }));
    const relinks = [...(t.payload.relinks || [])];
    // ordem de inserção: pais antes dos filhos; o que depende de algo ainda não inserido tenta de novo na volta seguinte
    for (let round = 0; pending.length && round < 30; round += 1) {
      const next = [];
      for (const it of pending) {
        await q('SAVEPOINT item');
        try {
          await q(`INSERT INTO ${ident(it.table)} SELECT * FROM jsonb_populate_record(NULL::${ident(it.table)}, $1)`, [it.row]);
          await q('RELEASE SAVEPOINT item');
        } catch (err) {
          await q('ROLLBACK TO SAVEPOINT item');
          if (err.code === '23505' && await exists(q, m, it.table, it.row)) continue; // já está lá
          if (err.code === '23505') { await q('ROLLBACK'); return { error: `Não deu para restaurar: já existe outro item com os mesmos dados${err.detail ? ` (${err.detail.replace(/^Key /, '').replace(/ already exists\.?$/, '')})` : ''}. Mude o outro antes e tente de novo.` }; }
          if (err.code !== '23503') throw err;
          next.push({ ...it, fk: m.byName[err.constraint] || null });
        }
      }
      if (next.length === pending.length) {
        // ninguém andou: quem aponta (SET NULL) para algo ainda não inserido entra sem a ligação, refeita no fim se o outro lado
        // existir (ex.: o corte e a capa escolhida apontam um para o outro); o resto não tem como voltar
        let fixed = false;
        for (const it of next) {
          if (!(it.fk && it.fk.del === 'n' && it.fk.nullable && it.row[it.fk.col] != null)) continue;
          relinks.push({ table: it.table, pk: pkOf(m, it.table, it.row), col: it.fk.col, value: it.row[it.fk.col] });
          it.row[it.fk.col] = null; fixed = true;
        }
        if (!fixed) {
          const fk = next.find((it) => it.fk)?.fk;
          await q('ROLLBACK');
          if (!fk) return { error: 'Não deu para restaurar: falta algo de que este item depende.' };
          const { rows: [parentInTrash] } = await db.query('SELECT title FROM trash_items WHERE kind = ANY($1) AND id <> $2 ORDER BY deleted_at DESC LIMIT 1',
            [Object.keys(KINDS).filter((k) => KINDS[k].table === fk.parent), t.id]);
          return { error: `Não deu para restaurar: ${PARENT_LABEL[fk.parent] || 'o item'} de que ele depende não existe mais.${parentInTrash ? ` Se for “${parentInTrash.title}”, que está na lixeira, restaure-o antes.` : ''}` };
        }
      }
      pending = next.map(({ fk, ...it }) => it);
    }
    for (const l of relinks) {
      const cols = Object.keys(l.pk);
      await q('SAVEPOINT link');
      try {
        await q(`UPDATE ${ident(l.table)} SET ${ident(l.col)} = $1 WHERE ${ident(l.col)} IS NULL AND ${cols.map((c, i) => `${ident(c)}::text = $${i + 2}`).join(' AND ')}`, [l.value, ...cols.map((c) => String(l.pk[c]))]);
        await q('RELEASE SAVEPOINT link');
      } catch { await q('ROLLBACK TO SAVEPOINT link'); } // o outro lado mudou desde então: fica como está
    }
    for (const s of t.payload.states || []) {
      const cols = Object.keys(s.row).filter((c) => c !== 'id');
      if (!cols.length) continue;
      await q(`UPDATE ${ident(s.table)} x SET ${cols.map((c) => `${ident(c)} = r.${ident(c)}`).join(', ')} FROM jsonb_populate_record(NULL::${ident(s.table)}, $1) r WHERE x.id = r.id`, [s.row]);
    }
    await q('DELETE FROM trash_items WHERE id = $1', [t.id]);
    await q('COMMIT');
    const root = t.payload.rows[0].row;
    return { ok: true, kind: t.kind, title: t.title, url: KINDS[t.kind]?.url(root) || '/' };
  } catch (err) {
    await q('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}

// Restaura o lote inteiro (o "Desfazer" de uma exclusão em massa). Quem depende de outro do mesmo lote espera a vez.
async function restoreBatch(batch, canRestore = () => true) {
  const { rows } = await db.query('SELECT id, kind, deleted_by FROM trash_items WHERE batch = $1 ORDER BY id', [batch]);
  let pending = rows.filter(canRestore);
  const done = []; let lastError = null;
  for (let round = 0; pending.length && round < 5; round += 1) {
    const next = [];
    for (const r of pending) {
      const out = await restore(r.id);
      if (out.ok) done.push(out); else { lastError = out.error; next.push(r); }
    }
    if (next.length === pending.length) break;
    pending = next;
  }
  return { done, failed: pending.length, error: pending.length ? lastError : null, denied: rows.length - rows.filter(canRestore).length };
}

// Lista da lixeira (sem o conteúdo guardado). mine: só o que a pessoa apagou.
async function list({ userId = null, kind = null } = {}) {
  const { rows } = await db.query(
    `SELECT t.id, t.kind, t.ref_id, t.title, t.context, t.batch, t.deleted_by, t.deleted_at, t.purge_after, u.name AS deleted_by_name,
            cardinality(t.storage_keys) AS files
       FROM trash_items t LEFT JOIN users u ON u.id = t.deleted_by
      WHERE ($1::uuid IS NULL OR t.deleted_by = $1) AND ($2::text IS NULL OR t.kind = $2)
      ORDER BY t.deleted_at DESC, t.id DESC LIMIT 300`, [userId, kind]);
  return rows;
}

// Apaga de vez (o prazo venceu, ou a gestão pediu): arquivos no Backblaze e miniaturas no disco, se ninguém mais usa.
async function purge({ id = null } = {}) {
  const { rows } = await db.query(
    `SELECT id, storage_keys, payload FROM trash_items WHERE ${id ? 'id = $1' : 'purge_after < now()'} ORDER BY id LIMIT 40`, id ? [id] : []);
  const previews = require('./previews');
  for (const t of rows) {
    const keys = t.storage_keys || [];
    const inUse = new Set();
    if (keys.length) {
      for (const [table, col] of Object.entries(FILE_COLUMNS)) {
        const { rows: live } = await db.query(`SELECT ${ident(col)} AS k FROM ${ident(table)} WHERE ${ident(col)} = ANY($1)`, [keys]);
        live.forEach((r) => inUse.add(r.k));
      }
    }
    for (const k of keys.filter((x) => !inUse.has(x))) await b2.deleteObject(k).catch((err) => console.error('[lixeira] apagar arquivo:', err.message));
    for (const r of t.payload.rows || []) {
      if (r.table === 'episode_files' && !inUse.has(r.row.storage_key)) await previews.removeFor(r.row).catch(() => {});
      if (r.table === 'episodes') await previews.removeEpisode(r.row.id).catch(() => {});
    }
    await db.query('DELETE FROM trash_items WHERE id = $1', [t.id]);
  }
  return rows.length;
}

const get = (id) => db.query('SELECT id, kind, ref_id, title, context, batch, deleted_by, deleted_at, purge_after FROM trash_items WHERE id = $1', [id]).then((r) => r.rows[0] || null);
const daysLeft = (t, now = Date.now()) => Math.max(0, Math.ceil((new Date(t.purge_after).getTime() - now) / 86400_000));

module.exports = { DAYS, KINDS, remove, restore, restoreBatch, list, purge, get, daysLeft, capture };
