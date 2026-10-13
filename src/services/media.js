// FFmpeg/ffprobe: duração, áudio comprimido para transcrição, quadros e download de arquivos grandes sem encher a memória.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

function run(cmd, args, { timeoutMs = 30 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${cmd} passou de ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e.code === 'ENOENT' ? new Error(`${cmd} não está instalado neste servidor.`) : e); });
    child.on('close', (code) => { clearTimeout(timer); return code === 0 ? resolve(out) : reject(new Error(`${cmd} falhou (${code}): ${err.trim().split('\n').slice(-3).join(' | ')}`)); });
  });
}

let ffmpegOk = null;
async function available() {
  ffmpegOk ??= run('ffmpeg', ['-version'], { timeoutMs: 10_000 }).then(() => true, () => false);
  return ffmpegOk;
}

async function probe(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'json', file], { timeoutMs: 60_000 });
  const j = JSON.parse(out);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  return {
    duration_ms: Math.round(Number(j.format?.duration || 0) * 1000),
    width: v?.width || null, height: v?.height || null, hasAudio: (j.streams || []).some((s) => s.codec_type === 'audio'),
  };
}

// Áudio mono 16 kHz em Opus 24 kbps, em pedaços de `chunkSeconds` (cabe folgado no limite de envio da Groq). Devolve [{ file, offset_ms }].
async function extractAudioChunks(video, dir, chunkSeconds = 1200) {
  const pattern = path.join(dir, 'audio_%03d.ogg');
  await run('ffmpeg', ['-v', 'error', '-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '24k', '-f', 'segment', '-segment_time', String(chunkSeconds), '-reset_timestamps', '1', pattern]);
  return fs.readdirSync(dir).filter((f) => /^audio_\d+\.ogg$/.test(f)).sort().map((f, i) => ({ file: path.join(dir, f), offset_ms: i * chunkSeconds * 1000 }));
}

// Um quadro em `atMs`, em JPEG com no máximo `maxSide` no lado maior (não aumenta). Devolve o caminho.
async function extractFrame(video, atMs, outFile, { maxSide = 1920, quality = 3 } = {}) {
  const scale = `scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))'`;
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', (atMs / 1000).toFixed(3), '-i', video, '-frames:v', '1', '-vf', scale, '-q:v', String(quality), outFile], { timeoutMs: 120_000 });
  return outFile;
}

// Baixa uma URL (link assinado) direto para o disco.
async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Não foi possível baixar o arquivo (${res.status}).`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  return dest;
}

async function tempDir(prefix = 'pulso-') {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
}
const rmDir = (dir) => fs.promises.rm(dir, { recursive: true, force: true });

module.exports = { run, available, probe, extractAudioChunks, extractFrame, download, tempDir, rmDir };
