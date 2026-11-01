// Trabalho "transcricao": assim que o editor termina de subir o vídeo editado, o FFmpeg tira só o áudio direto do link do
// Backblaze (sem baixar o vídeo inteiro) e a Groq transcreve, em segundo plano. A transcrição fica guardada com o arquivo de
// origem; quando o episódio vai para a finalização, a análise por IA reaproveita esse texto em vez de transcrever de novo.
const db = require('../db/pool');
const config = require('../config');
const b2 = require('./b2');
const media = require('./media');
const fin = require('./finalization');
const jobs = require('./jobs');

const latestEdited = (episodeId) => db.query(
  "SELECT * FROM episode_files WHERE episode_id = $1 AND kind = 'editado' AND status = 'pronto' ORDER BY version DESC, id DESC LIMIT 1", [episodeId]).then((r) => r.rows[0] || null);

// A transcrição guardada vale para este arquivo?
async function readyFor(episodeId, fileId) {
  const { rows: [t] } = await db.query('SELECT * FROM episode_transcripts WHERE episode_id = $1 AND source_file_id = $2', [episodeId, fileId]);
  return t || null;
}

async function save(episodeId, fileId, transcript, durationMs) {
  await db.query(
    `INSERT INTO episode_transcripts (episode_id, text, segments, language, duration_ms, source_file_id) VALUES ($1,$2,$3,'pt',$4,$5)
     ON CONFLICT (episode_id) DO UPDATE SET text = EXCLUDED.text, segments = EXCLUDED.segments, duration_ms = EXCLUDED.duration_ms, source_file_id = EXCLUDED.source_file_id, created_at = now()`,
    [episodeId, transcript.text, JSON.stringify(transcript.segments), durationMs, fileId]);
}

// Chamado quando um vídeo editado termina de subir (sem chaves ou sem FFmpeg, não faz nada: a finalização transcreve depois).
async function enqueueFor(file, userId = null) {
  if (file.kind !== 'editado' || !config.groqConfigured || !config.storageConfigured) return null;
  return jobs.enqueue('transcricao', { episodeId: file.episode_id, refId: file.id, createdBy: userId });
}

async function run(job, { update }) {
  if (!config.groqConfigured || !config.storageConfigured) throw new Error('Faltam chaves: GROQ_APIKEY ou Backblaze.');
  if (!(await media.available())) throw new Error('FFmpeg não está instalado neste servidor.');
  const latest = await latestEdited(job.episode_id);
  if (!latest || latest.id !== job.ref_id) return { skipped: 'há uma versão mais nova do vídeo (ela tem a própria transcrição)' };
  if (await readyFor(job.episode_id, latest.id)) return { skipped: 'já transcrito' };
  const dir = await media.tempDir('pulso-tr-');
  const t0 = Date.now();
  try {
    await update('Tirando o áudio do vídeo…', 10);
    // o FFmpeg lê o link assinado e só puxa a faixa de áudio: o vídeo não precisa vir inteiro para o servidor
    const url = await b2.presignGet(latest.storage_key, { expires: 6 * 3600 });
    const transcript = await fin.transcribeVideo(url, dir, { onProgress: (m) => update(m, 50) });
    // o arquivo pode ter sido trocado enquanto transcrevia: só guarda se ainda é o mais novo
    const still = await latestEdited(job.episode_id);
    if (!still || still.id !== latest.id) return { skipped: 'o vídeo mudou durante a transcrição' };
    await save(job.episode_id, latest.id, transcript, transcript.duration_ms);
    await db.query("INSERT INTO episode_events (episode_id, user_id, type, message) VALUES ($1, NULL, 'ia', $2)",
      [job.episode_id, `Transcrição do vídeo editado (versão ${latest.version}) pronta: ${Math.round(transcript.duration_ms / 60000)} min, em ${Math.round((Date.now() - t0) / 1000)} s`]);
    return { segments: transcript.segments.length, duration_ms: transcript.duration_ms };
  } finally {
    await media.rmDir(dir).catch(() => {});
  }
}

jobs.register('transcricao', run);
module.exports = { run, enqueueFor, readyFor, save, latestEdited };
