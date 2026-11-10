// Versão leve dos vídeos, só para assistir no painel e no portal do convidado.
// Os originais chegam pesados (corte vertical em 4K a ~90 Mbps; episódio em 1080p a ~19 Mbps, 12 a 18 GB) e saem de um bucket
// nos EUA: o navegador não consegue puxar tão rápido e o vídeo trava. A versão leve tem o lado menor em 720 px, H.264 a ~3 Mbps,
// quadro-chave a cada 2 s (pular para um ponto é rápido) e o índice no começo (começa a tocar sem baixar tudo).
// O original continua sendo o que se baixa e o que vai para as redes. Enquanto a leve não fica pronta, toca o original.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const db = require('../db/pool');
const b2 = require('./b2');
const media = require('./media');
const jobs = require('./jobs');
const config = require('../config');

const SHORT_SIDE = 720;
const MAX_KBPS = 3000;
const LIGHT_MBPS = 6; // original já leve (até 1080p e até 6 Mbps, H.264): toca o próprio original, sem gerar cópia
const PART_BYTES = 64 * 1024 * 1024;

// Versão pronta para este arquivo (ou null: toca o original).
async function viewKeyFor(sourceKey) {
  if (!sourceKey) return null;
  const { rows: [v] } = await db.query("SELECT view_key FROM video_views WHERE source_key = $1 AND status = 'pronto'", [sourceKey]);
  return v?.view_key || null;
}

// Link para assistir: a versão leve se existir; `original` força o arquivo enviado.
async function playUrl(sourceKey, { original = false, expires = 6 * 3600 } = {}) {
  const view = original ? null : await viewKeyFor(sourceKey);
  return b2.presignGet(view || sourceKey, { expires, contentType: view ? 'video/mp4' : null });
}

// Pede a versão leve (não repete: um pedido por arquivo).
async function ensure(sourceKey) {
  if (!sourceKey || !config.storageConfigured) return null;
  const { rows: [made] } = await db.query('INSERT INTO video_views (source_key) VALUES ($1) ON CONFLICT (source_key) DO NOTHING RETURNING id', [sourceKey]);
  if (!made) return null;
  await jobs.enqueue('video_leve', { refId: made.id, maxAttempts: 3 });
  return made.id;
}

// Lê bitrate, codec e tamanho do original (o probe comum não traz bitrate nem codec).
async function inspect(url) {
  const out = await media.run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,bit_rate:stream=codec_type,codec_name,width,height', '-of', 'json', url], { timeoutMs: 120_000 });
  const j = JSON.parse(out);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  return { duration: Number(j.format?.duration || 0), mbps: Number(j.format?.bit_rate || 0) / 1e6, codec: v?.codec_name || null, width: v?.width || 0, height: v?.height || 0, hasAudio: (j.streams || []).some((s) => s.codec_type === 'audio') };
}

function ffmpegArgs(input, output, hasAudio) {
  const scale = `scale='if(gt(iw,ih),-2,min(${SHORT_SIDE},iw))':'if(gt(iw,ih),min(${SHORT_SIDE},ih),-2)'`;
  return ['-v', 'error', '-y', '-nostats', '-progress', 'pipe:1',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '30',
    '-i', input, '-map', '0:v:0', ...(hasAudio ? ['-map', '0:a:0'] : []),
    '-vf', scale, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-maxrate', `${MAX_KBPS}k`, '-bufsize', `${MAX_KBPS * 2}k`,
    '-profile:v', 'high', '-level:v', '4.0', '-pix_fmt', 'yuv420p', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-threads', '4',
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : ['-an']),
    '-movflags', '+faststart', output];
}

// Roda o FFmpeg com prioridade baixa (o painel continua rápido) e conta o andamento.
function transcode({ input, output, hasAudio, duration, onProgress }) {
  return new Promise((resolve, reject) => {
    const args = ffmpegArgs(input, output, hasAudio);
    const child = spawn('nice', ['-n', '10', 'ffmpeg', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = ''; let last = -1;
    child.stdout.on('data', (d) => {
      const m = String(d).match(/out_time_us=(\d+)/g);
      if (!m || !duration) return;
      const pct = Math.min(99, Math.floor((Number(m[m.length - 1].split('=')[1]) / 1e6 / duration) * 100));
      if (pct >= last + 5) { last = pct; onProgress?.(pct); }
    });
    child.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
    const timer = setTimeout(() => child.kill('SIGKILL'), Math.max(30 * 60_000, duration * 3000)); // até 3x a duração do vídeo
    child.on('error', (e) => { clearTimeout(timer); reject(e.code === 'ENOENT' ? new Error('FFmpeg não está instalado neste servidor.') : e); });
    child.on('close', (code) => { clearTimeout(timer); return code === 0 ? resolve() : reject(new Error(`FFmpeg falhou (${code}): ${err.trim().split('\n').slice(-2).join(' | ')}`)); });
  });
}
// Trocáveis nos testes (a suíte não roda FFmpeg nem fala com o Backblaze de verdade).
const deps = { inspect, transcode };

// Envia um arquivo grande do disco em partes (sem carregar tudo na memória).
async function uploadFile(file, key) {
  const size = (await fs.promises.stat(file)).size;
  const uploadId = await b2.createMultipart(key, 'video/mp4');
  try {
    const parts = []; const fd = await fs.promises.open(file, 'r');
    try {
      for (let n = 1, pos = 0; pos < size; n += 1, pos += PART_BYTES) {
        const len = Math.min(PART_BYTES, size - pos);
        const buf = Buffer.alloc(len);
        await fd.read(buf, 0, len, pos);
        parts.push({ number: n, etag: await b2.uploadPart(key, uploadId, n, buf) });
      }
    } finally { await fd.close(); }
    await b2.completeMultipart(key, uploadId, parts);
  } catch (err) {
    await b2.abortMultipart(key, uploadId).catch(() => {});
    throw err;
  }
  return size;
}

async function run(job, { update }) {
  const { rows: [v] } = await db.query('SELECT * FROM video_views WHERE id = $1', [job.ref_id]);
  if (!v || v.status === 'pronto' || v.status === 'original') return { skipped: true };
  if (!(await media.available())) throw new Error('FFmpeg não está instalado neste servidor.');
  const src = await b2.presignGet(v.source_key, { expires: 12 * 3600 });
  let info;
  try { info = await deps.inspect(src); } catch (err) {
    await db.query("UPDATE video_views SET status = 'erro', error = $2, finished_at = now() WHERE id = $1", [v.id, 'Não consegui ler o vídeo.']);
    return { error: err.message };
  }
  const shortSide = Math.min(info.width, info.height);
  if (info.codec === 'h264' && shortSide <= 1080 && info.mbps > 0 && info.mbps <= LIGHT_MBPS) {
    await db.query("UPDATE video_views SET status = 'original', width = $2, height = $3, source_mbps = $4, finished_at = now() WHERE id = $1", [v.id, info.width, info.height, info.mbps.toFixed(2)]);
    return { original: true, mbps: info.mbps };
  }
  const dir = await media.tempDir('pulso-leve-');
  try {
    const out = path.join(dir, 'leve.mp4');
    await update('Preparando a versão leve para assistir…', 5);
    await deps.transcode({ input: src, output: out, hasAudio: info.hasAudio, duration: info.duration, onProgress: (p) => update(`Versão leve: ${p}%`, p) });
    const key = `${v.source_key.replace(/\.[A-Za-z0-9]{2,5}$/, '')}-leve-${crypto.randomBytes(4).toString('hex')}.mp4`;
    await update('Enviando a versão leve…', 95);
    const size = await uploadFile(out, key);
    const { rowCount } = await db.query(
      "UPDATE video_views SET status = 'pronto', view_key = $2, size_bytes = $3, width = $4, height = $5, source_mbps = $6, error = NULL, finished_at = now() WHERE id = $1 AND status <> 'pronto'",
      [v.id, key, size, info.width, info.height, info.mbps.toFixed(2)]);
    if (!rowCount) await b2.deleteObject(key).catch(() => {}); // outra tentativa terminou antes
    return { size, mbps: info.mbps };
  } finally {
    await media.rmDir(dir).catch(() => {});
  }
}
jobs.register('video_leve', run, {
  onError: async (job, err) => { await db.query("UPDATE video_views SET status = 'erro', error = $2, finished_at = now() WHERE id = $1 AND status = 'pendente'", [job.ref_id, String(err.message).slice(0, 300)]); },
});

// Arquivos que tocam no navegador: a versão mais nova do vídeo editado de cada episódio (a revisão) e o vídeo atual de cada corte.
// Versões antigas só se baixam: não ganham cópia, e a cópia de quem deixou de ser o atual é apagada pela limpeza.
const SOURCES = `
  SELECT DISTINCT ON (episode_id) storage_key, created_at FROM episode_files WHERE kind = 'editado' AND status = 'pronto' ORDER BY episode_id, version DESC, id DESC`;
const ALL_SOURCES = `(${SOURCES}) UNION ALL SELECT storage_key, created_at FROM episode_clips WHERE storage_key IS NOT NULL AND status <> 'enviando'`;

// Rotina: pede a versão leve do que ainda não tem (mais novos primeiro, poucos por vez) e apaga as de arquivos que saíram do sistema.
async function tick({ limit = 5 } = {}) {
  const { rows: missing } = await db.query(
    `SELECT s.storage_key FROM (${ALL_SOURCES}) s WHERE NOT EXISTS (SELECT 1 FROM video_views v WHERE v.source_key = s.storage_key) ORDER BY s.created_at DESC LIMIT $1`, [limit]);
  for (const m of missing) await ensure(m.storage_key);
  const { rows: orphans } = await db.query(
    `SELECT * FROM video_views v WHERE v.created_at < now() - interval '1 day' AND NOT EXISTS (SELECT 1 FROM (${ALL_SOURCES}) s WHERE s.storage_key = v.source_key) LIMIT 50`);
  for (const o of orphans) {
    if (o.view_key) await b2.deleteObject(o.view_key).catch((err) => console.error('[versão leve] apagar:', err.message));
    await db.query('DELETE FROM video_views WHERE id = $1', [o.id]);
  }
  return { asked: missing.length, removed: orphans.length };
}

module.exports = { SHORT_SIDE, MAX_KBPS, LIGHT_MBPS, deps, viewKeyFor, playUrl, ensure, inspect, ffmpegArgs, run, tick };
