// Trabalho "finalizacao": baixa o vídeo editado, transcreve, escolhe e lê quadros, gera títulos/descrições e grava tudo.
const fs = require('fs');
const path = require('path');
const db = require('../db/pool');
const config = require('../config');
const b2 = require('./b2');
const media = require('./media');
const fin = require('./finalization');
const jobs = require('./jobs');
const L = require('./platformLimits');

async function loadContext(episodeId) {
  const { rows: [episode] } = await db.query('SELECT * FROM episodes WHERE id = $1', [episodeId]);
  if (!episode) throw new Error('Episódio não encontrado.');
  const { rows: [file] } = await db.query("SELECT * FROM episode_files WHERE episode_id = $1 AND kind = 'editado' AND status = 'pronto' ORDER BY version DESC LIMIT 1", [episodeId]);
  if (!file) throw new Error('Não há vídeo editado para analisar.');
  const { rows: [guest] } = episode.guest_id ? await db.query('SELECT * FROM guests WHERE id = $1', [episode.guest_id]) : { rows: [] };
  const { rows: sponsors } = await db.query(
    `SELECT s.company, s.website, b.landing_url, b.restrictions FROM sponsor_episodes se JOIN sponsors s ON s.id = se.sponsor_id
       LEFT JOIN sponsor_briefs b ON b.sponsor_id = s.id WHERE se.episode_id = $1 ORDER BY s.company`, [episodeId]);
  return { episode, file, guest: guest || null, sponsors };
}

async function replaceFrames(episodeId, frames, analyses, ctxLabel) {
  const { rows: old } = await db.query("SELECT storage_key FROM episode_frames WHERE episode_id = $1 AND clip_id IS NULL AND NOT (coalesce(analysis, '{}'::jsonb) ? 'custom')", [episodeId]);
  const stamp = Date.now().toString(36);
  const saved = [];
  for (let i = 0; i < frames.length; i += 1) {
    const key = await b2.keyFor('episodios', episodeId, 'quadros', `${stamp}-${String(i).padStart(2, '0')}.jpg`);
    await b2.putObject(key, fs.readFileSync(frames[i].file), 'image/jpeg');
    saved.push({ key, frame: frames[i], analysis: analyses[i], score: fin.scoreFrame(analyses[i]) });
  }
  await db.query("DELETE FROM episode_frames WHERE episode_id = $1 AND clip_id IS NULL AND NOT (coalesce(analysis, '{}'::jsonb) ? 'custom')", [episodeId]);
  const ids = [];
  for (const s of saved) {
    const { rows: [r] } = await db.query(
      'INSERT INTO episode_frames (episode_id, at_ms, storage_key, width, height, analysis, score) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [episodeId, s.frame.at_ms, s.key, s.frame.width, s.frame.height, s.analysis ? JSON.stringify(s.analysis) : null, s.score]);
    ids.push(r.id);
  }
  for (const o of old) await b2.deleteObject(o.storage_key).catch((err) => console.error(`Falha ao apagar quadro antigo (${ctxLabel}):`, err.message));
  return ids;
}

async function run(job, { update }) {
  if (!config.groqConfigured || !config.geminiConfigured || !config.storageConfigured) throw new Error('Faltam chaves: GROQ_APIKEY, GEMINI_KEY ou Backblaze.');
  if (!(await media.available())) throw new Error('FFmpeg não está instalado neste servidor.');
  const { episode, file, guest, sponsors } = await loadContext(job.episode_id);
  const dir = await media.tempDir('pulso-fin-');
  const t0 = Date.now();
  try {
    await update(`Baixando o vídeo (${Math.round(Number(file.size_bytes) / 1048576)} MB)…`, 5);
    const video = await media.download(await b2.presignGet(file.storage_key, { expires: 3600 }), path.join(dir, 'video.mp4'));
    const probe = await media.probe(video);

    await update('Transcrevendo o áudio…', 15);
    const transcript = await fin.transcribeVideo(video, dir, { onProgress: (m) => update(m, 25) });
    const durationMs = transcript.duration_ms || probe.duration_ms;
    await db.query(
      `INSERT INTO episode_transcripts (episode_id, text, segments, language, duration_ms, source_file_id) VALUES ($1,$2,$3,'pt',$4,$5)
       ON CONFLICT (episode_id) DO UPDATE SET text = EXCLUDED.text, segments = EXCLUDED.segments, duration_ms = EXCLUDED.duration_ms, source_file_id = EXCLUDED.source_file_id, created_at = now()`,
      [episode.id, transcript.text, JSON.stringify(transcript.segments), durationMs, file.id]);

    await update('Escolhendo quadros do vídeo…', 40);
    const frames = await fin.pickFrames(video, durationMs, dir);
    await update('Analisando os quadros (rostos, legendas, nitidez)…', 50);
    const analyses = await fin.analyzeFrames(frames, { onProgress: (m) => update(m, 60) });
    await update('Guardando os quadros…', 70);
    const frameIds = await replaceFrames(episode.id, frames, analyses, `episódio ${episode.id}`);

    await update('Escrevendo títulos, descrições e capítulos…', 78);
    const result = await fin.suggestMetadata({ episode, guest, sponsors, transcript: { ...transcript, duration_ms: durationMs }, durationMs, onProgress: (m) => update(m, 88) });
    const s = result.suggestions;
    const best = frames.map((f, i) => ({ id: frameIds[i], score: fin.scoreFrame(analyses[i]) })).sort((a, b) => b.score - a.score)[0];

    // Só preenche o que está vazio: o que a equipe já escreveu à mão não é sobrescrito.
    await db.query(
      `INSERT INTO episode_metadata (episode_id, suggestions, yt_title, yt_description, yt_tags, sp_title, sp_description, thumb_text, thumb_frame_id, chapters, ai_model, ai_generated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
       ON CONFLICT (episode_id) DO UPDATE SET suggestions = EXCLUDED.suggestions, ai_model = EXCLUDED.ai_model, ai_generated_at = now(), updated_at = now(),
         yt_title = coalesce(nullif(episode_metadata.yt_title, ''), EXCLUDED.yt_title),
         yt_description = coalesce(nullif(episode_metadata.yt_description, ''), EXCLUDED.yt_description),
         yt_tags = coalesce(nullif(episode_metadata.yt_tags, ''), EXCLUDED.yt_tags),
         sp_title = coalesce(nullif(episode_metadata.sp_title, ''), EXCLUDED.sp_title),
         sp_description = coalesce(nullif(episode_metadata.sp_description, ''), EXCLUDED.sp_description),
         thumb_text = coalesce(nullif(episode_metadata.thumb_text, ''), EXCLUDED.thumb_text),
         thumb_frame_id = coalesce(episode_metadata.thumb_frame_id, EXCLUDED.thumb_frame_id),
         chapters = coalesce(nullif(episode_metadata.chapters, ''), EXCLUDED.chapters)`,
      [episode.id, JSON.stringify({ ...s, issues: result.issues }), s.youtube_titles[0]?.texto || null, s.youtube_description, s.tags.join(', '), s.spotify_title,
        s.spotify_description, s.thumbnail_texts[0]?.texto || null, best?.id || null, L.formatChapters(s.chapters), result.model]);
    await update('Montando thumbnails, posts e carrossel…', 93);
    let coversMade = 0;
    try {
      coversMade = (await require('./coverStore').generateForEpisode(episode.id, { onProgress: (m) => update(m, 95) })).length;
    } catch (err) {
      console.error('Falha ao montar as capas:', err.message); // as capas são um bônus: não derrubam a análise
    }
    await db.query(
      "INSERT INTO episode_events (episode_id, user_id, type, message) VALUES ($1, NULL, 'ia', $2)",
      [episode.id, `IA: transcrição, ${frames.length} quadros, sugestões de títulos e descrições e ${coversMade} capas/posts prontos (${Math.round((Date.now() - t0) / 1000)} s)`]);
    return { covers: coversMade, frames: frames.length, segments: transcript.segments.length, duration_ms: durationMs, model: result.model, attempts: result.attempts, issues: result.issues };
  } finally {
    await media.rmDir(dir);
  }
}

// Rotina do sistema: avisa o editor e a gestão quando a análise termina ou falha.
async function tellTeam(episodeId, title, body) {
  const { rows: [ep] } = await db.query('SELECT id, number, title, editor_id FROM episodes WHERE id = $1', [episodeId]);
  if (!ep) return;
  const label = `${ep.number ? `EP.${String(ep.number).padStart(3, '0')} · ` : ''}${ep.title}`;
  await require('./notify').notify({ type: 'rotina', users: [ep.editor_id], broadcast: true, title: `${title}: ${label}`, body, url: `/episodios/${ep.id}#finalizacao`, entity: { type: 'episode', id: ep.id } });
}

jobs.register('finalizacao', async (job, ctx) => {
  const result = await run(job, ctx);
  await tellTeam(job.episode_id, 'Análise por IA pronta', `${result.frames} quadros, títulos, descrições e ${result.covers} capas para revisar.`).catch((err) => console.error('Aviso da análise:', err.message));
  return result;
}, { onError: (job, err) => tellTeam(job.episode_id, 'A análise por IA falhou', String(err.message).slice(0, 300)) });
module.exports = { run, loadContext };
