// Versão para as redes. O corte chega muitas vezes em 4K a ~90 Mbps (meio giga para 50 segundos): o YouTube, o TikTok e o Facebook
// aceitam, mas o Instagram não termina de processar a tempo, o Threads recusa e o X passa do limite (512 MB) e trava o provedor
// ("sem espaço em disco"). Corte pesado (lado menor acima de 1080 px ou acima de 12 Mbps) ganha uma cópia em 1080p, H.264 até
// 10 Mbps, feita no servidor (o mesmo FFmpeg da versão leve, services/videoViews), e é ela que vai para as redes. O original continua
// sendo o que se baixa. Enquanto a cópia não fica pronta, a publicação espera ("em preparo") e tenta de novo em alguns minutos.
const path = require('path');
const crypto = require('crypto');
const db = require('../db/pool');
const b2 = require('./b2');
const media = require('./media');
const jobs = require('./jobs');
const config = require('../config');
const views = require('./videoViews');

const SHORT_SIDE = 1080;
const MAX_KBPS = 10_000;
const OK_MBPS = 12; // até aqui (e até 1080p, H.264) o original já serve para as redes
const OPTS = { shortSide: SHORT_SIDE, crf: 20, maxKbps: MAX_KBPS, audioKbps: 192, level: '4.2' };

// O corte pede a versão? Pelo que o envio registrou (tamanho, duração, largura e altura).
function heavy(clip) {
  if (!clip || !clip.storage_key) return false;
  const short = Math.min(Number(clip.width) || 0, Number(clip.height) || 0);
  const secs = (Number(clip.duration_ms) || 0) / 1000;
  const mbps = secs > 0 ? (Number(clip.size_bytes) || 0) * 8 / secs / 1e6 : 0;
  return short > SHORT_SIDE || mbps > OK_MBPS;
}

// Pede a cópia (um pedido por arquivo).
async function ensure(sourceKey) {
  if (!sourceKey || !config.storageConfigured) return null;
  const { rows: [made] } = await db.query('INSERT INTO social_renditions (source_key) VALUES ($1) ON CONFLICT (source_key) DO NOTHING RETURNING id', [sourceKey]);
  if (!made) return null;
  await jobs.enqueue('video_redes', { refId: made.id, maxAttempts: 3 });
  return made.id;
}

// O que mandar para as redes: null = o original; { key, size } = a cópia pronta; { waiting: true } = ainda preparando.
async function pick(clip) {
  if (!heavy(clip)) return null;
  const { rows: [r] } = await db.query('SELECT * FROM social_renditions WHERE source_key = $1', [clip.storage_key]);
  if (!r) { await ensure(clip.storage_key); return { waiting: true }; }
  if (r.status === 'pronto' && r.rendition_key) return { key: r.rendition_key, size: Number(r.size_bytes) || null };
  if (r.status === 'pendente') return { waiting: true };
  return null; // 'original' (já servia) ou 'erro' (a cópia não saiu): vai o original, como antes
}

async function run(job, { update }) {
  const { rows: [r] } = await db.query('SELECT * FROM social_renditions WHERE id = $1', [job.ref_id]);
  if (!r || r.status !== 'pendente') return { skipped: true };
  if (!(await media.available())) throw new Error('FFmpeg não está instalado neste servidor.');
  const src = await b2.presignGet(r.source_key, { expires: 12 * 3600 });
  let info;
  try { info = await views.deps.inspect(src); } catch (err) {
    await db.query("UPDATE social_renditions SET status = 'erro', error = $2, finished_at = now() WHERE id = $1", [r.id, 'Não consegui ler o vídeo.']);
    return { error: err.message };
  }
  const short = Math.min(info.width, info.height);
  if (info.codec === 'h264' && short <= SHORT_SIDE && info.mbps > 0 && info.mbps <= OK_MBPS) {
    await db.query("UPDATE social_renditions SET status = 'original', width = $2, height = $3, source_mbps = $4, finished_at = now() WHERE id = $1", [r.id, info.width, info.height, info.mbps.toFixed(2)]);
    return { original: true };
  }
  const dir = await media.tempDir('pulso-redes-');
  try {
    const out = path.join(dir, 'redes.mp4');
    await update('Preparando a versão do vídeo para as redes (1080p)…', 5);
    await views.deps.transcode({ input: src, output: out, hasAudio: info.hasAudio, duration: info.duration, opts: OPTS, onProgress: (p) => update(`Versão para as redes: ${p}%`, p) });
    const key = `${r.source_key.replace(/\.[A-Za-z0-9]{2,5}$/, '')}-redes-${crypto.randomBytes(4).toString('hex')}.mp4`;
    await update('Guardando a versão para as redes…', 95);
    const size = await views.uploadFile(out, key);
    const { rowCount } = await db.query(
      "UPDATE social_renditions SET status = 'pronto', rendition_key = $2, size_bytes = $3, width = $4, height = $5, source_mbps = $6, error = NULL, finished_at = now() WHERE id = $1 AND status = 'pendente'",
      [r.id, key, size, info.width, info.height, info.mbps.toFixed(2)]);
    if (!rowCount) await b2.deleteObject(key).catch(() => {});
    return { size, mbps: info.mbps };
  } finally {
    await media.rmDir(dir).catch(() => {});
  }
}
jobs.register('video_redes', run, {
  onError: async (job, err) => { await db.query("UPDATE social_renditions SET status = 'erro', error = $2, finished_at = now() WHERE id = $1 AND status = 'pendente'", [job.ref_id, String(err.message).slice(0, 300)]); },
});

// Rotina: cortes pesados com post na fila (agendado, ou com nova tentativa) ganham a cópia antes da hora; as cópias de arquivos que
// saíram do sistema (corte apagado, vídeo trocado) são apagadas.
async function tick({ limit = 3 } = {}) {
  const { rows } = await db.query(
    `SELECT DISTINCT c.id, c.storage_key, c.width, c.height, c.size_bytes, c.duration_ms FROM episode_clips c JOIN episode_publications p ON p.clip_id = c.id
      WHERE c.status = 'pronto' AND c.storage_key IS NOT NULL AND (p.status IN ('agendado','revisao') OR (p.status IN ('erro','parcial') AND p.retry_at IS NOT NULL))
        AND NOT EXISTS (SELECT 1 FROM social_renditions r WHERE r.source_key = c.storage_key)`);
  let asked = 0;
  for (const c of rows) { if (asked >= limit) break; if (heavy(c) && await ensure(c.storage_key)) asked += 1; }
  const { rows: orphans } = await db.query(
    "SELECT * FROM social_renditions r WHERE r.created_at < now() - interval '1 day' AND NOT EXISTS (SELECT 1 FROM episode_clips c WHERE c.storage_key = r.source_key) LIMIT 50");
  for (const o of orphans) {
    if (o.rendition_key) await b2.deleteObject(o.rendition_key).catch((err) => console.error('[versão para as redes] apagar:', err.message));
    await db.query('DELETE FROM social_renditions WHERE id = $1', [o.id]);
  }
  return { asked, removed: orphans.length };
}

module.exports = { SHORT_SIDE, MAX_KBPS, OK_MBPS, OPTS, heavy, ensure, pick, run, tick };
