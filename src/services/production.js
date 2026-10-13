// Linha de produção do episódio: etapas e travas, sincronia com o convidado, checklists padronizados, tarefas,
// arquivos pesados (Backblaze, envio em partes) e comentários de revisão na minutagem.
const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config');
const b2 = require('./b2');
const { can } = require('../permissions');
const C = require('../constants');

const MB = 1024 * 1024;

async function addEvent(episodeId, userId, type, message, client = db) {
  await client.query('INSERT INTO episode_events (episode_id, user_id, type, message) VALUES ($1,$2,$3,$4)',
    [episodeId, userId || null, type, String(message).slice(0, 1000)]);
}

// ---------------------------------------------------------------- checklists
// Copia os modelos ativos para o episódio (uma vez). Itens avulsos têm template_id nulo.
async function ensureChecklists(episodeId) {
  const { rowCount } = await db.query('SELECT 1 FROM episode_checklist_items WHERE episode_id = $1 LIMIT 1', [episodeId]);
  if (rowCount) return false;
  await db.query(
    `INSERT INTO episode_checklist_items (episode_id, template_id, group_name, gate, required, position, text)
     SELECT $1, t.id, t.name, t.gate, t.required, t.position * 1000 + i.position, i.text
       FROM checklist_templates t JOIN checklist_template_items i ON i.template_id = t.id
      WHERE t.active ORDER BY t.position, i.position`, [episodeId]);
  return true;
}

// Itens obrigatórios ainda abertos antes de passar pela porta `gate` ('revisao' | 'finalizado').
async function openRequired(episodeId, gate) {
  const { rows } = await db.query(
    'SELECT text FROM episode_checklist_items WHERE episode_id = $1 AND gate = $2 AND required AND NOT done ORDER BY position', [episodeId, gate]);
  return rows.map((r) => r.text);
}

// ---------------------------------------------------------------- etapas
const summarize = (items, max = 3) => (items.length > max ? `${items.slice(0, max).join('; ')} e mais ${items.length - max}` : items.join('; '));

const gates = {
  async rawVideo(ep) {
    const { rowCount } = await db.query("SELECT 1 FROM episode_files WHERE episode_id = $1 AND kind = 'bruto_video' AND status = 'pronto' LIMIT 1", [ep.id]);
    return rowCount ? [] : ['ao menos um vídeo bruto enviado (aba Material)'];
  },
  async editedAndChecklist(ep) {
    const missing = [];
    const { rowCount } = await db.query("SELECT 1 FROM episode_files WHERE episode_id = $1 AND kind = 'editado' AND status = 'pronto' LIMIT 1", [ep.id]);
    if (!rowCount) missing.push('o vídeo editado enviado');
    const open = await openRequired(ep.id, 'revisao');
    if (open.length) missing.push(`checklist antes da revisão: ${summarize(open)}`);
    return missing;
  },
  async hasOpenComment(ep) {
    const { rowCount } = await db.query('SELECT 1 FROM episode_comments WHERE episode_id = $1 AND NOT resolved LIMIT 1', [ep.id]);
    return rowCount ? [] : ['ao menos um comentário em aberto explicando o ajuste'];
  },
  async finishChecklist(ep) {
    const open = await openRequired(ep.id, 'finalizado');
    return open.length ? [`checklist antes de finalizar: ${summarize(open)}`] : [];
  },
  async metadata(ep) {
    const { rows: [m] } = await db.query('SELECT * FROM episode_metadata WHERE episode_id = $1', [ep.id]);
    const L = require('./platformLimits');
    const missing = [];
    const t = L.checkYoutubeTitle(m?.yt_title); if (!t.ok) missing.push('título do YouTube válido');
    const d = L.checkYoutubeDescription(m?.yt_description); if (!d.ok) missing.push('descrição do YouTube válida');
    const st = L.checkSpotifyTitle(m?.sp_title); if (!st.ok) missing.push('título do Spotify válido');
    const sd = L.checkSpotifyDescription(m?.sp_description); if (!sd.ok) missing.push('descrição do Spotify válida');
    if (!String(m?.thumb_text || '').trim()) missing.push('texto da thumbnail');
    const { rows: [th] } = await db.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE approved)::int AS ok FROM episode_covers WHERE episode_id = $1 AND kind = 'youtube_thumb'", [ep.id]);
    if (th.n > 0 && th.ok === 0) missing.push('thumbnail aprovada (aba Finalização)');
    return missing;
  },
  async finishAll(ep) { return [...await gates.finishChecklist(ep), ...await gates.metadata(ep)]; },
  async links(ep) {
    return [!ep.youtube_url && 'link do vídeo no YouTube', !ep.spotify_url && 'link do episódio no Spotify'].filter(Boolean);
  },
};

// from -> opções. `perm` quem pode; `gate` o que precisa estar pronto; `tone` estilo do botão.
const TRANSITIONS = [
  { from: 'gravado', to: 'disponivel_edicao', perm: 'production.manage', label: 'Liberar para edição', gate: gates.rawVideo, tone: 'primary' },
  { from: 'disponivel_edicao', to: 'em_edicao', perm: 'production.edit', label: 'Assumir a edição', tone: 'primary' },
  { from: 'em_edicao', to: 'em_revisao', perm: 'production.edit', label: 'Enviar para revisão', gate: gates.editedAndChecklist, tone: 'primary' },
  { from: 'em_edicao', to: 'disponivel_edicao', perm: 'production.edit', label: 'Devolver à fila' },
  { from: 'em_revisao', to: 'em_finalizacao', perm: 'production.review', label: 'Aprovar o vídeo', tone: 'primary' },
  { from: 'em_revisao', to: 'em_edicao', perm: 'production.review', label: 'Pedir ajustes', gate: gates.hasOpenComment },
  { from: 'em_finalizacao', to: 'pronto_publicar', perm: 'production.review', label: 'Marcar como pronto para publicar', gate: gates.finishAll, tone: 'primary' },
  { from: 'em_finalizacao', to: 'em_revisao', perm: 'production.review', label: 'Voltar para revisão' },
  { from: 'pronto_publicar', to: 'publicado', perm: 'production.review', label: 'Marcar como publicado', gate: gates.links, tone: 'primary' },
  { from: 'pronto_publicar', to: 'em_finalizacao', perm: 'production.review', label: 'Voltar para finalização' },
];

// Botões da etapa atual para este perfil, já com as pendências de cada um.
async function availableMoves(ep, role) {
  const out = [];
  for (const t of TRANSITIONS.filter((x) => x.from === ep.status)) {
    const allowed = can(role, t.perm);
    out.push({ to: t.to, label: t.label, tone: t.tone || '', allowed, missing: allowed && t.gate ? await t.gate(ep) : [] });
  }
  return out;
}

// Efeitos de entrar em cada etapa (dentro da transação).
const EFFECTS = {
  async disponivel_edicao(ep, user, client) { await ensureChecklists(ep.id); await addEvent(ep.id, user.id, 'checklist', 'Checklists padronizados aplicados ao episódio', client); },
  async em_edicao(ep, user, client) {
    if (ep.status === 'disponivel_edicao') {
      await client.query('UPDATE episodes SET editor_id = $2 WHERE id = $1', [ep.id, user.id]);
      // tarefas de rotina "do editor" sem ninguém passam para quem assumiu a edição
      await client.query(`UPDATE tasks t SET assignee_id = $2, updated_at = now() FROM task_routines r
                           WHERE t.routine_id = r.id AND r.assignee_mode = 'editor' AND t.episode_id = $1 AND t.assignee_id IS NULL AND t.status <> 'feito'`, [ep.id, user.id]);
    }
    await ensureChecklists(ep.id);
  },
  async em_revisao(ep, user, client) { if (ep.status === 'em_edicao') await client.query('UPDATE episodes SET review_round = review_round + 1 WHERE id = $1', [ep.id]); },
  async em_finalizacao(ep, user) {
    if (config.groqConfigured && config.geminiConfigured && config.storageConfigured) {
      const { rows: [done] } = await db.query(
        `SELECT 1 FROM episode_transcripts t WHERE t.episode_id = $1
            AND t.source_file_id = (SELECT id FROM episode_files WHERE episode_id = $1 AND kind = 'editado' AND status = 'pronto' ORDER BY version DESC LIMIT 1)`, [ep.id]);
      if (done) return; // a versão aprovada já foi analisada (ex.: voltou da revisão sem mudar o vídeo)
      await require('./jobs').enqueue('finalizacao', { episodeId: ep.id });
      await addEvent(ep.id, user.id, 'ia', 'Análise por IA na fila: transcrição, quadros, títulos e descrições');
    }
  },
  async publicado(ep, user, client) { await client.query('UPDATE episodes SET published_at = coalesce(published_at, now()) WHERE id = $1', [ep.id]); },
};

// Faz a mudança de etapa. Devolve { ok } ou { error, missing }.
async function move(ep, to, user) {
  const t = TRANSITIONS.find((x) => x.from === ep.status && x.to === to);
  if (!t) return { error: 'Essa mudança de etapa não é permitida a partir da etapa atual.' };
  if (!can(user.role, t.perm)) return { error: 'Seu perfil não pode fazer essa mudança de etapa.' };
  const missing = t.gate ? await t.gate(ep) : [];
  if (missing.length) return { error: `Para "${t.label.toLowerCase()}" falta: ${missing.join(' · ')}.`, missing };
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE episodes SET status = $2, updated_at = now() WHERE id = $1', [ep.id, to]);
    if (EFFECTS[to]) await EFFECTS[to](ep, user, client);
    await addEvent(ep.id, user.id, 'etapa', `Etapa: ${C.EPISODE_STATUSES[ep.status]} → ${C.EPISODE_STATUSES[to]}`, client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  try { await require('./tasks').applyRoutines(`etapa:${to}`, ep.id, user); } catch (err) { console.error('Rotinas de tarefas:', err.message); }
  try { await require('./finance').onEpisodeStage(ep.id, to); } catch (err) { console.error('Financeiro (etapa):', err.message); }
  return { ok: true };
}

// ---------------------------------------------------------------- convidado <-> episódio
// As tarefas que nascem com o episódio vêm das rotinas (Gestão > Rotinas), com vencimento padrão.
async function createTasks(episodeId, user = null) {
  return require('./tasks').applyRoutines('episodio_criado', episodeId, user);
}

// Chamado depois de qualquer mudança de etapa do convidado. Idempotente.
// O convidado é a pessoa; o episódio é o produto. Antes da gravação existe só a agenda (convidados em Agendado):
// convidado do patrocinador vira reserva dele; Agendado avisa a equipe; Gravado faz o episódio nascer (e as reservas viram vínculo).
async function syncFromGuest(guestId, userId = null) {
  const { rows: [guest] } = await db.query('SELECT * FROM guests WHERE id = $1', [guestId]);
  if (!guest) return null;
  let { rows: [ep] } = await db.query('SELECT * FROM episodes WHERE guest_id = $1', [guestId]);
  if (!ep && guest.sponsor_id && !['perdido', 'cancelado'].includes(guest.status)) {
    await db.query("INSERT INTO sponsor_bookings (sponsor_id, guest_id, role) VALUES ($1, $2, 'exclusivo') ON CONFLICT DO NOTHING", [guest.sponsor_id, guest.id]);
  }
  if (!ep) { try { await require('./finance').syncGuest(guestId); } catch (err) { console.error('Financeiro (convidado):', err.message); } }
  if (guest.status === 'agendado' && !ep) { // agendamento concluído: avisa quem cuida do convidado e a gestão
    const when = guest.proposed_at ? fmtWhen(guest.proposed_at) : 'data a confirmar';
    await require('./notify').notify({
      type: 'agendamento', users: [guest.owner_id], broadcast: true, title: `Gravação agendada: ${guest.name}`, body: `${when} · estúdio, hosts e convidado confirmados. Já aparece na agenda.`,
      url: `/convidados/${guest.id}`, actorId: userId, entity: { type: 'guest', id: guest.id }, dedupe: `agendado-guest-${guest.id}-${guest.proposed_at ? guest.proposed_at.getTime() : 0}`,
    });
  }
  if (guest.status !== 'gravado' || ep) return ep || null;
  const day = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
  const recordedOn = day(guest.proposed_at && guest.proposed_at <= new Date() ? guest.proposed_at : new Date());
  ep = await createEpisode({ title: `Conversa com ${guest.name}`, guestId: guest.id, recordedOn, userId, origin: `convidado ${guest.name}` });
  return ep;
}

const fmtWhen = (d) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(d);

// O episódio nasce gravado. Reservas de patrocinador feitas para o convidado viram vínculos do episódio; as rotinas criam as tarefas.
// Corridas (dois cliques, duas réplicas): convidado já com episódio devolve o existente; número repetido tenta o seguinte.
async function createEpisode({ title, guestId = null, recordedOn = null, userId = null, origin = '', sponsor = null }) {
  let ep = null;
  for (let attempt = 0; attempt < 3 && !ep; attempt += 1) {
    try {
      ({ rows: [ep] } = await db.query(
        `INSERT INTO episodes (number, title, status, guest_id, recorded_on)
         VALUES ((SELECT coalesce(max(number), 0) + 1 FROM episodes), $1, 'gravado', $2, $3) RETURNING *`, [title, guestId, recordedOn]));
    } catch (err) {
      if (err.code !== '23505') throw err;
      if (guestId && /guest/.test(err.constraint || '')) { const { rows: [existing] } = await db.query('SELECT * FROM episodes WHERE guest_id = $1', [guestId]); if (existing) return existing; }
    }
  }
  if (!ep) throw new Error('Não consegui numerar o episódio. Tente de novo.');
  if (guestId) {
    await db.query('INSERT INTO sponsor_episodes (sponsor_id, episode_id, role) SELECT sponsor_id, $2, role FROM sponsor_bookings WHERE guest_id = $1 ON CONFLICT DO NOTHING', [guestId, ep.id]);
    await db.query('DELETE FROM sponsor_bookings WHERE guest_id = $1', [guestId]);
  }
  if (sponsor) await db.query('INSERT INTO sponsor_episodes (sponsor_id, episode_id, role) VALUES ($1, $2, $3) ON CONFLICT (sponsor_id, episode_id) DO UPDATE SET role = EXCLUDED.role', [sponsor.id, ep.id, sponsor.role || 'exclusivo']);
  const { rows: [actor] } = userId ? await db.query('SELECT id, name FROM users WHERE id = $1', [userId]) : { rows: [] };
  await createTasks(ep.id, actor || null);
  try { await require('./finance').onEpisodeCreated(ep.id); } catch (err) { console.error('Financeiro (episódio):', err.message); }
  await addEvent(ep.id, userId, 'criado', `Episódio criado${origin ? ` a partir de ${origin}` : ''} (gravação feita)`);
  return ep;
}

// ---------------------------------------------------------------- arquivos (Backblaze, envio em partes)
const partSizeFor = (size) => Math.max(config.uploadPartBytes, Math.ceil(size / 9000)); // B2: mínimo 5 MB por parte e até 10.000 partes

const safeName = (name) => String(name || 'arquivo').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180);

async function startUpload({ episode, kind, label, filename, contentType, size, userId }) {
  const type = String(contentType || 'application/octet-stream').split(';')[0].trim().toLowerCase().slice(0, 100) || 'application/octet-stream';
  const name = safeName(filename);
  const ext = (name.match(/\.([A-Za-z0-9]{1,6})$/)?.[1] || 'bin').toLowerCase();
  const key = await b2.keyFor('episodios', episode.id, `${kind}-${crypto.randomBytes(8).toString('hex')}.${ext}`);
  const partSize = partSizeFor(size);
  let version = 1;
  if (kind === 'editado') {
    const { rows: [v] } = await db.query("SELECT coalesce(max(version), 0) + 1 AS v FROM episode_files WHERE episode_id = $1 AND kind = 'editado'", [episode.id]);
    version = v.v;
  }
  const uploadId = await b2.createMultipart(key, type);
  const { rows: [file] } = await db.query(
    `INSERT INTO episode_files (episode_id, kind, label, filename, content_type, size_bytes, part_size, storage_key, upload_id, version, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [episode.id, kind, label || null, name, type, size, partSize, key, uploadId, version, userId]);
  return { file, partSize, totalParts: Math.max(1, Math.ceil(size / partSize)) };
}

async function receivePart(file, number, body) {
  const etag = await b2.uploadPart(file.storage_key, file.upload_id, number, body);
  await db.query(
    `INSERT INTO episode_file_parts (file_id, part_number, etag, size_bytes) VALUES ($1,$2,$3,$4)
     ON CONFLICT (file_id, part_number) DO UPDATE SET etag = EXCLUDED.etag, size_bytes = EXCLUDED.size_bytes`, [file.id, number, etag, body.length]);
  return etag;
}

// Confere as partes (quantidade, tamanhos, soma) e fecha o objeto no bucket.
async function finishUpload(file) {
  const { rows: parts } = await db.query('SELECT part_number, etag, size_bytes FROM episode_file_parts WHERE file_id = $1 ORDER BY part_number', [file.id]);
  const total = Math.max(1, Math.ceil(Number(file.size_bytes) / file.part_size));
  if (parts.length !== total) return { error: `Faltam partes: recebi ${parts.length} de ${total}.` };
  for (let i = 0; i < parts.length; i += 1) if (parts[i].part_number !== i + 1) return { error: `A parte ${i + 1} não chegou.` };
  const sum = parts.reduce((n, p) => n + p.size_bytes, 0);
  if (sum !== Number(file.size_bytes)) return { error: `O tamanho recebido (${sum} bytes) não bate com o do arquivo (${file.size_bytes}).` };
  await b2.completeMultipart(file.storage_key, file.upload_id, parts.map((p) => ({ number: p.part_number, etag: p.etag })));
  const { rows: [done] } = await db.query(
    "UPDATE episode_files SET status = 'pronto', upload_id = NULL, completed_at = now() WHERE id = $1 RETURNING *", [file.id]);
  await db.query('DELETE FROM episode_file_parts WHERE file_id = $1', [file.id]);
  return { file: done };
}

// O vídeo "pilar" do episódio é horizontal. Lê o arquivo já no bucket (ffprobe por link assinado, só os cabeçalhos).
async function checkEditedVideo(file) {
  if (!config.checkVideoFormat) return { ok: true, skipped: true };
  const media = require('./media');
  if (!(await media.available())) return { ok: true, skipped: true };
  let info;
  try { info = await media.probe(await b2.presignGet(file.storage_key, { expires: 900 })); } catch { return { error: 'Não consegui ler este vídeo. Confira se o arquivo abre normalmente e envie de novo.' }; }
  if (!info.width || !info.height) return { error: 'O arquivo não tem imagem de vídeo.' };
  if (info.width <= info.height) {
    return { error: `O vídeo do episódio precisa ser horizontal (16:9). Este é ${info.height > info.width ? 'vertical' : 'quadrado'} (${info.width}×${info.height}). Cortes verticais são enviados em Conteúdo.`, width: info.width, height: info.height };
  }
  return { ok: true, width: info.width, height: info.height };
}

async function cancelUpload(file) {
  if (file.upload_id) await b2.abortMultipart(file.storage_key, file.upload_id).catch((err) => console.error('Falha ao cancelar envio:', err.message));
  await db.query('DELETE FROM episode_files WHERE id = $1', [file.id]);
}

async function deleteFile(file) {
  if (file.status === 'enviando') return cancelUpload(file);
  await db.query('DELETE FROM episode_files WHERE id = $1', [file.id]);
  await b2.deleteObject(file.storage_key).catch((err) => console.error('Falha ao apagar arquivo:', err.message));
  return null;
}

// Apaga do bucket tudo o que pertence ao episódio (antes de excluí-lo do banco).
async function purgeEpisodeFiles(episodeId) {
  for (const table of ['episode_frames', 'episode_covers']) {
    const { rows } = await db.query(`SELECT storage_key FROM ${table} WHERE episode_id = $1`, [episodeId]);
    for (const f of rows) await b2.deleteObject(f.storage_key).catch((err) => console.error('Falha ao apagar imagem:', err.message));
  }
  const { rows: clips } = await db.query('SELECT storage_key FROM episode_clips WHERE episode_id = $1 AND storage_key IS NOT NULL', [episodeId]);
  for (const c of clips) await b2.deleteObject(c.storage_key).catch((err) => console.error('Falha ao apagar corte:', err.message));
  const { rows } = await db.query('SELECT * FROM episode_files WHERE episode_id = $1', [episodeId]);
  for (const f of rows) {
    if (f.upload_id) await b2.abortMultipart(f.storage_key, f.upload_id).catch(() => {});
    await b2.deleteObject(f.storage_key).catch((err) => console.error('Falha ao apagar arquivo:', err.message));
  }
}

// ---------------------------------------------------------------- dados da tela do episódio
async function sponsorAssets(episodeId) {
  const { rows: sponsors } = await db.query(
    `SELECT s.id, s.company, s.tier, s.website, se.role, b.restrictions, b.slogan, b.offer, b.landing_url
       FROM sponsor_episodes se JOIN sponsors s ON s.id = se.sponsor_id LEFT JOIN sponsor_briefs b ON b.sponsor_id = s.id
      WHERE se.episode_id = $1 ORDER BY se.role = 'exclusivo' DESC, s.company`, [episodeId]);
  if (!sponsors.length) return [];
  const { rows: files } = await db.query(
    "SELECT id, sponsor_id, kind, filename FROM sponsor_files WHERE sponsor_id = ANY($1) AND kind IN ('logo','moldura','qrcode') ORDER BY id DESC", [sponsors.map((s) => s.id)]);
  const { rows: qr } = await db.query("SELECT sponsor_id, link_url FROM sponsor_deliverables WHERE sponsor_id = ANY($1) AND kind = 'qr_code'", [sponsors.map((s) => s.id)]);
  return sponsors.map((s) => ({
    ...s,
    logo: files.find((f) => f.sponsor_id === s.id && f.kind === 'logo') || null,
    moldura: files.find((f) => f.sponsor_id === s.id && f.kind === 'moldura') || null,
    qrcode: files.find((f) => f.sponsor_id === s.id && f.kind === 'qrcode') || null,
    qr_link: qr.find((q) => q.sponsor_id === s.id)?.link_url || null,
  }));
}

module.exports = {
  MB, addEvent, ensureChecklists, openRequired, TRANSITIONS, availableMoves, move,
  createTasks, syncFromGuest, createEpisode,
  partSizeFor, safeName, startUpload, receivePart, finishUpload, checkEditedVideo, cancelUpload, deleteFile, purgeEpisodeFiles,
  sponsorAssets,
};
