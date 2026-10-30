// Cortes: o editor SOBE os vídeos (vários de uma vez, em partes, direto para o Backblaze); o sistema lê cada um (duração, formato, fala,
// quadros e rostos), dá um nome interno ("Corte 7"), sugere título, legenda e 3 capas, e só depois o corte é atribuído a um episódio já gravado.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db/pool');
const config = require('../config');
const b2 = require('./b2');
const media = require('./media');
const fin = require('./finalization');
const gemini = require('./gemini');
const groq = require('./groq');
const jobs = require('./jobs');
const L = require('./platformLimits');
const designs = require('./designs');
const store = require('./coverStore');
const prod = require('./production');

const MAX_BYTES = 8 * 1024 * 1024 * 1024; // um corte tem poucos minutos; 8 GB é folga de sobra
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv'];
// Só episódio que já foi gravado pode receber cortes (antes disso não existe o que cortar).
const ELIGIBLE_STATUSES = ['gravado', 'disponivel_edicao', 'em_edicao', 'em_revisao', 'em_finalizacao', 'pronto_publicar', 'publicado'];
const NOT_CUSTOM = "NOT (coalesce(analysis, '{}'::jsonb) ? 'custom')";

// ---------------------------------------------------------------- envio em partes (mesmo esquema dos arquivos do episódio)
// requestId/episodeId: entrega de um pedido de conteúdo (o vídeo já nasce ligado ao pedido e, se houver, ao episódio).
async function startUpload({ filename, size, contentType, userId, requestId = null, episodeId = null }) {
  const type = String(contentType || 'video/mp4').split(';')[0].trim().toLowerCase().slice(0, 100) || 'video/mp4';
  const name = prod.safeName(filename);
  const ext = (name.match(/\.([A-Za-z0-9]{1,6})$/)?.[1] || 'mp4').toLowerCase();
  const partSize = prod.partSizeFor(size);
  const { rows: [clip] } = await db.query(
    "INSERT INTO episode_clips (title, source, status, filename, content_type, part_size, size_bytes, created_by, request_id, episode_id) VALUES ('Corte', 'upload', 'enviando', $1, $2, $3, $4, $5, $6, $7) RETURNING id",
    [name, type, partSize, size, userId, requestId, episodeId]);
  const key = await b2.keyFor('cortes', clip.id, `video-${crypto.randomBytes(6).toString('hex')}.${ext}`);
  let uploadId;
  try { uploadId = await b2.createMultipart(key, type); } catch (err) { await db.query('DELETE FROM episode_clips WHERE id = $1', [clip.id]); throw err; }
  const { rows: [row] } = await db.query("UPDATE episode_clips SET title = 'Corte ' || id, storage_key = $2, upload_id = $3 WHERE id = $1 RETURNING *", [clip.id, key, uploadId]);
  return { clip: row, partSize, totalParts: Math.max(1, Math.ceil(size / partSize)) };
}

// Parte enviada direto pelo navegador ao bucket: só registra.
async function registerPart(clip, number, etag, size) {
  await db.query(
    `INSERT INTO clip_upload_parts (clip_id, part_number, etag, size_bytes) VALUES ($1,$2,$3,$4)
     ON CONFLICT (clip_id, part_number) DO UPDATE SET etag = EXCLUDED.etag, size_bytes = EXCLUDED.size_bytes`, [clip.id, number, etag, size]);
}

async function receivePart(clip, number, body) {
  const etag = await b2.uploadPart(clip.storage_key, clip.upload_id, number, body);
  await db.query(
    `INSERT INTO clip_upload_parts (clip_id, part_number, etag, size_bytes) VALUES ($1,$2,$3,$4)
     ON CONFLICT (clip_id, part_number) DO UPDATE SET etag = EXCLUDED.etag, size_bytes = EXCLUDED.size_bytes`, [clip.id, number, etag, body.length]);
}

// Confere as partes, fecha o objeto no bucket e põe o corte na fila para ser lido.
async function finishUpload(clip) {
  const { rows: parts } = await db.query('SELECT part_number, etag, size_bytes FROM clip_upload_parts WHERE clip_id = $1 ORDER BY part_number', [clip.id]);
  const total = Math.max(1, Math.ceil(Number(clip.size_bytes) / clip.part_size));
  if (parts.length !== total) return { error: `Faltam partes: recebi ${parts.length} de ${total}.` };
  for (let i = 0; i < parts.length; i += 1) if (parts[i].part_number !== i + 1) return { error: `A parte ${i + 1} não chegou.` };
  if (parts.reduce((n, p) => n + p.size_bytes, 0) !== Number(clip.size_bytes)) return { error: 'O tamanho recebido não bate com o do arquivo.' };
  await b2.completeMultipart(clip.storage_key, clip.upload_id, parts.map((p) => ({ number: p.part_number, etag: p.etag })));
  const { rows: [done] } = await db.query("UPDATE episode_clips SET status = 'processando', upload_id = NULL, error = NULL, updated_at = now() WHERE id = $1 RETURNING *", [clip.id]);
  await db.query('DELETE FROM clip_upload_parts WHERE clip_id = $1', [clip.id]);
  await jobs.enqueue('corte', { refId: clip.id });
  return { clip: done };
}

async function cancelUpload(clip) {
  if (clip.upload_id) await b2.abortMultipart(clip.storage_key, clip.upload_id).catch((err) => console.error('Falha ao cancelar envio do corte:', err.message));
  await db.query('DELETE FROM episode_clips WHERE id = $1', [clip.id]);
}

// ---------------------------------------------------------------- textos (IA)
const TEXTS_SCHEMA = {
  type: 'OBJECT',
  properties: { titulo: { type: 'STRING' }, legenda: { type: 'STRING' }, textos_capa: { type: 'ARRAY', items: { type: 'STRING' } } },
  required: ['titulo', 'legenda', 'textos_capa'],
};

const cleanCoverText = (t) => {
  const s = L.tidy(fin.stripEmoji(String(t || ''))).replace(/^["“'\s]+|["”'\s]+$/g, '').replace(/[.!?,;:\-–—\s]+$/g, '');
  return L.fitWords(s, L.LIMITS.thumbnailText.maxChars);
};
const goodCover = (t) => t && t.split(/\s+/).length >= 2;
const hashtagLine = (tags, n = 4) => [...new Set((tags || []).map((h) => `#${String(h).replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '')}`).filter((h) => h.length > 2))].slice(0, n).join(' ');

// Título, legenda e 3 textos de capa a partir do que a pessoa fala no corte. Sem IA ou sem fala, devolve vazio (a equipe escreve).
async function writeTexts({ episode = null, guest = null, transcript, hashtags = [] }) {
  const empty = { post_title: null, caption: null, cover_texts: [] };
  if (!config.geminiConfigured || !transcript || transcript.length < 20) return empty;
  const context = episode ? fin.buildContext({ episode, guest, sponsors: [] }) : 'Podcast: Pulso (corte ainda sem episódio definido).';
  const parts = [{ text: [
    fin.MARCA, '', context, '',
    'Abaixo está a fala de UM corte vertical de até 2 minutos. Devolva:',
    '- titulo: de 4 a 9 palavras, até 60 caracteres; abre com o gancho; sem ponto final; sem clickbait e sem prometer o que o trecho não diz.',
    '- legenda: 1 a 3 frases curtas (até 280 caracteres) que contextualizam o trecho e convidam a ver, sem "link na bio" nem exclamações. NÃO inclua hashtags.',
    `- textos_capa: EXATAMENTE 3 textos para a capa do vídeo: de 2 a 4 palavras, no máximo ${L.LIMITS.thumbnailText.maxChars - 4} caracteres, de ângulos diferentes; PREFIRA um trecho curto que a pessoa realmente disse ou uma tensão; nunca um rótulo genérico ("Liderança"). Cada texto faz sentido sozinho.`,
    '', `Fala: ${L.fitWords(transcript, 3000)}`,
  ].join('\n') }];
  try {
    const { data } = await gemini.generateJson({ parts, schema: TEXTS_SCHEMA, temperature: 0.6 });
    const title = L.fitWords(L.balanceQuotes(fin.stripEmoji(data.titulo || '')).replace(/[.]+$/, ''), 60);
    const cover = [...new Set((data.textos_capa || []).map(cleanCoverText).filter(goodCover))].slice(0, 3);
    const body = L.fitWords(L.balanceQuotes(L.stripAngles(fin.stripEmoji(data.legenda || ''))), 320);
    return { post_title: title || null, caption: L.tidy([body, hashtagLine(hashtags)].filter(Boolean).join('\n\n')) || null, cover_texts: cover };
  } catch (err) {
    console.error('Falha ao escrever textos do corte:', err.message);
    return empty;
  }
}

// ---------------------------------------------------------------- capas e atribuição
async function episodeContext(episodeId) {
  if (!episodeId) return { episode: null, guest: null };
  const { rows: [episode] } = await db.query('SELECT * FROM episodes WHERE id = $1', [episodeId]);
  const { rows: [guest] } = episode?.guest_id ? await db.query('SELECT * FROM guests WHERE id = $1', [episode.guest_id]) : { rows: [] };
  return { episode: episode || null, guest: guest || null };
}

// Monta as 3 capas do corte a partir dos quadros já lidos (não chama a IA). Troca só o que o sistema gerou e ninguém aprovou.
async function buildCovers(clipId, userId = null) {
  const { rows: [clip] } = await db.query('SELECT * FROM episode_clips WHERE id = $1', [clipId]);
  const frames = await store.loadFrames(null, { clipId });
  if (!frames.length) return [];
  const { episode, guest } = await episodeContext(clip.episode_id);
  const duration = clip.duration_ms || Math.max(1, ...frames.map((f) => f.at_ms)) * 1.05;
  const picks = store.pickFrames(frames, 3, duration);
  const buffers = await store.imageBuffers(frames, picks.map((f) => f.ref));
  const texts = (clip.cover_texts || []).filter(Boolean);
  const epLabel = episode?.number ? `EP.${String(episode.number).padStart(3, '0')}` : '';
  const made = [];
  for (let i = 0; i < picks.length; i += 1) {
    const text = texts[i] || texts[0] || L.fitWords(clip.post_title || clip.title, L.LIMITS.thumbnailText.maxChars);
    const built = designs.buildReelCover({ frame: picks[i], text, label: guest?.name || '', epLabel });
    const res = await store.render(built.spec, { [picks[i].ref]: buffers[picks[i].ref] }, built.ctxData);
    made.push({ built, res, text, i });
  }
  const { rows: old } = await db.query('DELETE FROM episode_covers WHERE clip_id = $1 AND auto AND NOT approved RETURNING storage_key', [clipId]);
  for (const o of old) await b2.deleteObject(o.storage_key).catch(() => {});
  const rows = [];
  for (const m of made) {
    rows.push(await store.insertCover(clip.episode_id, { kind: 'reel_cover', spec: m.built.spec, ctx: m.built.ctxData, lint: m.res.lint, label: `Capa ${m.i + 1}: ${m.text}`, group: `clip-${clipId}`, position: m.i, clipId }, m.res, userId));
  }
  const { rows: [cur] } = await db.query('SELECT cover_id FROM episode_clips WHERE id = $1', [clipId]);
  const keep = cur.cover_id && (await db.query('SELECT 1 FROM episode_covers WHERE id = $1', [cur.cover_id])).rows.length;
  if (!keep && rows[0]) await db.query('UPDATE episode_clips SET cover_id = $2, updated_at = now() WHERE id = $1', [clipId, rows[0].id]);
  return rows;
}

// Atribui o corte a um episódio (só se ele já foi gravado). Refaz as capas para levar o nome do convidado e o número do episódio.
async function assign(clipId, episodeId, userId = null) {
  const { rows: [clip] } = await db.query('SELECT * FROM episode_clips WHERE id = $1', [clipId]);
  if (!clip) return { error: 'Corte não encontrado.' };
  if (!episodeId) return { error: 'Escolha um episódio.' };
  const { rows: [episode] } = await db.query('SELECT id, number, title, status FROM episodes WHERE id = $1', [episodeId]);
  if (!episode) return { error: 'Episódio não encontrado.' };
  if (!ELIGIBLE_STATUSES.includes(episode.status)) return { error: 'O episódio ainda não foi gravado: só dá para atribuir cortes a episódios gravados.' };
  if (clip.status === 'enviando') return { error: 'O corte ainda está sendo enviado.' };
  await db.query('UPDATE episode_clips SET episode_id = $2, updated_at = now() WHERE id = $1', [clipId, episodeId]);
  await db.query('UPDATE episode_frames SET episode_id = $2 WHERE clip_id = $1', [clipId, episodeId]);
  await db.query('UPDATE episode_covers SET episode_id = $2 WHERE clip_id = $1', [clipId, episodeId]);
  await prod.addEvent(episodeId, userId, 'corte', `Corte atribuído: ${clip.title}`);
  if (clip.status === 'pronto') {
    try { await buildCovers(clipId, userId); } catch (err) { console.error('Capas do corte não refeitas:', err.message); }
  }
  return { ok: true, episode };
}

// ---------------------------------------------------------------- leitura do corte (job "corte")
async function runProcess(job, { update }) {
  if (!config.storageConfigured) throw new Error('Backblaze não configurado.');
  if (!(await media.available())) throw new Error('FFmpeg não está instalado neste servidor.');
  const { rows: [clip] } = await db.query('SELECT * FROM episode_clips WHERE id = $1', [job.ref_id]);
  if (!clip || !clip.storage_key) throw new Error('Corte não encontrado.');
  await db.query("UPDATE episode_clips SET status = 'processando', error = NULL, updated_at = now() WHERE id = $1", [clip.id]);
  const dir = await media.tempDir('pulso-corte-');
  const notes = [];
  try {
    const src = await b2.presignGet(clip.storage_key, { expires: 3600 });
    await update('Lendo o vídeo…', 5);
    let info;
    try { info = await media.probe(src); } catch { throw new Error('Não consegui ler este vídeo. Confira se o arquivo abre normalmente e envie de novo.'); }
    if (!info.width || !info.height || !info.duration_ms) throw new Error('O arquivo não tem vídeo legível.');
    if (info.width > info.height) notes.push('Este corte é horizontal; para Reels, TikTok e Shorts o ideal é vertical (9:16).');
    if (info.duration_ms > 3 * 60_000) notes.push('Mais de 3 minutos: Reels e Shorts podem não aceitar.');
    await db.query('UPDATE episode_clips SET width = $2, height = $3, duration_ms = $4, updated_at = now() WHERE id = $1', [clip.id, info.width, info.height, info.duration_ms]);

    let transcript = clip.transcript || null;
    if (config.groqConfigured && info.hasAudio) {
      try {
        await update('Transcrevendo a fala…', 15);
        const chunks = await media.extractAudioChunks(src, dir, 1200);
        const texts = [];
        for (const c of chunks) texts.push(await groq.transcribe(fs.readFileSync(c.file), { filename: path.basename(c.file), contentType: 'audio/ogg' }));
        transcript = texts.join(' ').replace(/\s+/g, ' ').trim() || null;
      } catch (err) { notes.push(`Transcrição indisponível: ${String(err.message).slice(0, 120)}.`); }
    }

    let analyzed = false;
    try {
      await update('Escolhendo quadros…', 30);
      const frames = await fin.pickFrames(src, info.duration_ms, dir, { count: 6 });
      await update('Lendo os quadros (rostos, legendas)…', 45);
      const analyses = await fin.analyzeFrames(frames);
      const olds = (await db.query(`SELECT storage_key FROM episode_frames WHERE clip_id = $1 AND ${NOT_CUSTOM}`, [clip.id])).rows;
      await db.query(`DELETE FROM episode_frames WHERE clip_id = $1 AND ${NOT_CUSTOM}`, [clip.id]);
      for (const o of olds) await b2.deleteObject(o.storage_key).catch(() => {});
      const stamp = Date.now().toString(36);
      for (let i = 0; i < frames.length; i += 1) {
        const key = await b2.keyFor('cortes', clip.id, 'quadros', `${stamp}-${i}.jpg`);
        await b2.putObject(key, fs.readFileSync(frames[i].file), 'image/jpeg');
        await db.query(
          'INSERT INTO episode_frames (episode_id, clip_id, at_ms, storage_key, width, height, analysis, score) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [clip.episode_id, clip.id, frames[i].at_ms, key, frames[i].width, frames[i].height, analyses[i] ? JSON.stringify(analyses[i]) : null, fin.scoreFrame(analyses[i])]);
      }
      analyzed = true;
    } catch (err) {
      const why = /429|quota|exceeded/i.test(err.message) ? 'o limite de uso da IA (Gemini) foi atingido' : String(err.message).slice(0, 140);
      notes.push(`As capas ainda não foram geradas: ${why}. Use "Ler de novo" mais tarde.`);
    }

    await update('Escrevendo título e legenda…', 70);
    const { episode, guest } = await episodeContext(clip.episode_id);
    const { rows: [meta] } = clip.episode_id ? await db.query('SELECT suggestions FROM episode_metadata WHERE episode_id = $1', [clip.episode_id]) : { rows: [] };
    const texts = await writeTexts({ episode, guest, transcript, hashtags: meta?.suggestions?.hashtags || [] });
    await db.query(
      `UPDATE episode_clips SET transcript = $2, post_title = coalesce($3, post_title), caption = coalesce(nullif(caption, ''), $4),
         cover_texts = CASE WHEN $5::jsonb = '[]'::jsonb THEN cover_texts ELSE $5::jsonb END, updated_at = now() WHERE id = $1`,
      [clip.id, transcript, texts.post_title, texts.caption, JSON.stringify(texts.cover_texts)]);

    let covers = 0;
    if (analyzed) {
      await update('Montando as capas…', 85);
      try { covers = (await buildCovers(clip.id, clip.created_by)).length; } catch (err) { notes.push(`Capas não montadas: ${String(err.message).slice(0, 120)}.`); }
    }
    await db.query("UPDATE episode_clips SET status = 'pronto', note = $2, error = NULL, updated_at = now() WHERE id = $1", [clip.id, notes.join(' ') || null]);
    await require('./notify').notify({ type: 'rotina', users: [clip.created_by], title: `${clip.title} está pronto`, body: notes.length ? notes.join(' ') : `${covers} capas sugeridas. Falta atribuir ao episódio e publicar.`, url: `/cortes/${clip.id}`, entity: { type: 'clip', id: clip.id } }).catch(() => {});
    await announceToReview(clip, covers).catch((err) => console.error('[corte] aviso à gestão:', err.message));
    return { clip_id: clip.id, duration_ms: info.duration_ms, width: info.width, height: info.height, covers, transcript: Boolean(transcript) };
  } catch (err) {
    await db.query("UPDATE episode_clips SET status = 'erro', error = $2, updated_at = now() WHERE id = $1", [clip.id, String(err.message).slice(0, 500)]);
    await require('./notify').notify({ type: 'rotina', users: [clip.created_by], title: `Não foi possível ler ${clip.title}`, body: String(err.message).slice(0, 300), url: `/cortes/${clip.id}`, entity: { type: 'clip', id: clip.id } }).catch(() => {});
    throw err;
  } finally {
    await media.rmDir(dir);
  }
}

// Apaga o corte e tudo o que é dele no bucket (vídeo, capas, quadros).
async function removeClip(clipId) {
  const { rows: [clip] } = await db.query('SELECT * FROM episode_clips WHERE id = $1', [clipId]);
  if (!clip) return false;
  if (clip.upload_id) await b2.abortMultipart(clip.storage_key, clip.upload_id).catch(() => {});
  const keys = [clip.storage_key];
  for (const t of ['episode_covers', 'episode_frames']) keys.push(...(await db.query(`SELECT storage_key FROM ${t} WHERE clip_id = $1`, [clipId])).rows.map((r) => r.storage_key));
  await db.query('DELETE FROM episode_clips WHERE id = $1', [clipId]);
  for (const k of keys.filter(Boolean)) await b2.deleteObject(k).catch((err) => console.error('Falha ao apagar do bucket:', err.message));
  return true;
}

// Momentos que a IA achou no episódio: só uma dica para o editor decidir o que cortar (não corta nada sozinha).
async function momentsFor(episodeId) {
  const { rows: [m] } = await db.query('SELECT suggestions FROM episode_metadata WHERE episode_id = $1', [episodeId]);
  return (m?.suggestions?.moments || []).filter((x) => Number.isFinite(x.start_ms) && Number.isFinite(x.end_ms));
}

// Corte disponível: a gestão (quem aprova e publica) fica sabendo uma vez por corte, na primeira vez que ele fica pronto
// ("Ler de novo" não repete o aviso). Quem subiu já recebe o próprio "está pronto" e não entra aqui.
async function announceToReview(clip, covers) {
  const { can, ROLES } = require('../permissions');
  const roles = Object.keys(ROLES).filter((r) => can(r, 'production.review'));
  const { rows: users } = await db.query('SELECT id FROM users WHERE active AND role = ANY($1)', [roles]);
  const { rows: [info] } = await db.query(
    `SELECT u.name AS who, e.number, e.title AS ep_title FROM episode_clips c LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN episodes e ON e.id = c.episode_id WHERE c.id = $1`, [clip.id]);
  const ep = info?.ep_title ? ` · ${info.number ? `EP.${String(info.number).padStart(3, '0')} ` : ''}${info.ep_title}` : '';
  const next = clip.episode_id ? 'Falta escolher a capa e publicar.' : 'Falta atribuir ao episódio, escolher a capa e publicar.';
  await require('./notify').notify({
    type: 'episodio', users: users.map((u) => u.id), actorId: clip.created_by,
    title: `Corte disponível: ${clip.title}${ep}`,
    body: `${info?.who ? `${info.who} subiu o corte. ` : ''}${covers ? `${covers} capas sugeridas. ` : ''}${next}`,
    url: `/cortes/${clip.id}`, entity: { type: 'clip', id: clip.id }, dedupe: `corte-disponivel-${clip.id}`,
  });
}

jobs.register('corte', runProcess);
module.exports = { VIDEO_EXT, MAX_BYTES, ELIGIBLE_STATUSES, startUpload, receivePart, registerPart, finishUpload, cancelUpload, writeTexts, buildCovers, assign, runProcess, removeClip, momentsFor, cleanCoverText };
