// Importação de convidados: analisa o CSV (erros e duplicados) e grava só as linhas prontas, numa transação.
// Usado pela tela (Convidados > Importar CSV) e pelo script `src/scripts/importGuests.js`.
const db = require('../db/pool');
const csv = require('./csvImport');
const production = require('./production');
const { formatDateTime } = require('../utils/format');
const { STATUS_BY_KEY, LOSS_REASONS } = require('../constants');

async function analyse(text) {
  const parsed = csv.parseGuests(text);
  if (!parsed.headerError) await csv.markDuplicates(parsed.rows);
  return parsed;
}

const day = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);

// Episódio do histórico (convidado importado como Gravado/Publicado): entra direto na etapa certa, sem as rotinas de
// tarefas, os custos automáticos e os avisos de um episódio novo (já aconteceu).
async function createHistoryEpisode(client, guestId, data, user) {
  const ep = data.episode;
  const published = ep.status === 'publicado';
  const { rows: [row] } = await client.query(
    `INSERT INTO episodes (number, title, status, guest_id, recorded_on, aired_on, published_at, youtube_url, spotify_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [ep.number, ep.title || `Conversa com ${data.name}`, ep.status, guestId, day(data.proposed_at),
      published && ep.aired_at ? day(ep.aired_at) : null, published ? ep.aired_at || data.proposed_at : null, ep.youtube_url, ep.spotify_url]);
  await production.addEvent(row.id, user.id, 'criado', `Episódio do histórico importado por CSV por ${user.name} (${published ? 'publicado' : 'gravado'})`, client);
}

// Grava as linhas prontas. Devolve { rows, headerError, created: [ids], episodes, skipped }.
async function importGuests(text, user) {
  const { rows, headerError } = await analyse(text); // reavalia: nada do que veio da prévia é confiável
  if (headerError) return { rows, headerError, created: [], episodes: 0, skipped: 0 };
  const toImport = rows.filter((r) => !r.errors.length && !r.duplicate);
  if (!toImport.length) return { rows, headerError: 'Nenhuma linha válida para importar.', created: [], episodes: 0, skipped: rows.length };

  const client = await db.getPool().connect();
  const created = [];
  let episodes = 0;
  try {
    await client.query('BEGIN');
    // Episódios do histórico sem número: continuam a numeração, na ordem da data de gravação.
    const history = toImport.filter((r) => r.data.episode);
    if (history.length) {
      await client.query('LOCK TABLE episodes IN SHARE ROW EXCLUSIVE MODE'); // ninguém numera ao mesmo tempo
      const { rows: [{ max }] } = await client.query('SELECT coalesce(max(number), 0) AS max FROM episodes');
      let next = Math.max(Number(max), ...history.map((r) => r.data.episode.number || 0)) + 1;
      for (const r of history.filter((x) => !x.data.episode.number).sort((a, b) => a.data.proposed_at - b.data.proposed_at)) r.data.episode.number = next++;
    }
    for (const { data } of toImport) {
      const { rows: [g] } = await client.query(
        `INSERT INTO guests (name, instagram, phone, profile, email, invite_reason, gender, owner_id, created_by, status,
                            proposed_at, scheduled_studio, scheduled_hosts, scheduled_guest, loss_reason, loss_note, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$11,$11,$12,$13,$14) RETURNING id`,
        [data.name, data.instagram, data.phone || null, data.profile, data.email || null, data.invite_reason || null, data.gender, user.id,
          data.status, data.proposed_at, data.status === 'agendado', data.loss_reason, data.loss_note, data.notes || null]);
      const details = [data.status !== 'prospect' && `etapa: ${STATUS_BY_KEY[data.status].label}`, data.loss_reason && `motivo: ${LOSS_REASONS[data.loss_reason]}`,
        data.proposed_at && `gravação ${formatDateTime(data.proposed_at)}`].filter(Boolean);
      await client.query('INSERT INTO guest_events (guest_id, user_id, type, message) VALUES ($1,$2,$3,$4)',
        [g.id, user.id, 'criado', `Importado por CSV por ${user.name}${details.length ? ` (${details.join(', ')})` : ''}`]);
      created.push(g.id);
      if (data.episode) { await createHistoryEpisode(client, g.id, data, user); episodes += 1; }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  for (const id of created) await production.syncFromGuest(id, user.id); // igual ao cadastro manual (quem já tem episódio só confere)
  return { rows, headerError: null, created, episodes, skipped: rows.length - created.length };
}

module.exports = { analyse, importGuests };
