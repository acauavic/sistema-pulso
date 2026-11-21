// Vídeos do convidado (Guia de peças, seção 07): o story de lançamento (11 s) e o teaser para público frio (15 s), feitos da
// ficha do episódio. Os quadros são desenhados pelo motor das capas (videoScenes.js) e o FFmpeg monta o MP4 (H.264, 1080×1920,
// 30 quadros por segundo). O teaser leva a voz do convidado dizendo a frase literal, com a legenda entrando palavra a palavra;
// o story sai sem som. A trilha entra na hora de postar.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const db = require('../db/pool');
const config = require('../config');
const b2 = require('./b2');
const media = require('./media');
const jobs = require('./jobs');
const covers = require('./covers');
const store = require('./coverStore');
const sheets = require('./coverSheet');
const pieces = require('./coverPieces');
const scenes = require('./videoScenes');
const M = require('../public/design/models');
const L = require('./platformLimits');

const KINDS = {
  story: { label: 'Story de lançamento', seconds: 11, hint: 'Para quem já segue o Pulso: a foto, o nome, o título e a chamada para o link.', file: 'story' },
  teaser: { label: 'Teaser', seconds: 15, hint: 'Para quem ainda não conhece: o gancho no primeiro quadro, quem é o convidado e a frase na voz dele.', file: 'teaser' },
};
const LEAD = 5; // no teaser, a frase começa a ser dita aos 5 s (a voz do convidado vem desde o início)
const VOICE = 11; // e a voz vai até os 11 s; o fim fica sem som, para a trilha de quem posta

const norm = (s) => String(s || '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const fileName = (episode, kind) => `pulso_${episode?.number ? `ep${String(episode.number).padStart(3, '0')}` : `episodio${episode?.id || ''}`}_${KINDS[kind].file}.mp4`;

// O vídeo editado mais recente (de onde sai a voz do teaser).
async function editedFile(episodeId) {
  const { rows: [f] } = await db.query("SELECT id, storage_key FROM episode_files WHERE episode_id = $1 AND kind = 'editado' AND status = 'pronto' ORDER BY version DESC, id DESC LIMIT 1", [episodeId]);
  return f || null;
}
// A foto: fotografia da gravação com rosto (a capa é vertical e cheia), senão a da thumbnail principal, senão o melhor quadro.
async function pickFrame(episodeId, meta) {
  const all = await store.loadFrames(episodeId, { clipId: null, custom: true });
  if (!all.length) return { all, frame: null, face: null };
  const photo = all.filter((f) => f.analysis?.from_file && (f.analysis.rostos || []).length).sort((a, b) => b.height - a.height)[0];
  if (photo) return { all, frame: photo, face: null };
  const { rows: [main] } = meta?.thumb_cover_id ? await db.query('SELECT spec FROM episode_covers WHERE id = $1', [meta.thumb_cover_id]) : { rows: [] };
  const ref = main?.spec?.photo?.ref;
  const fromMain = ref ? all.find((f) => f.ref === ref) : null;
  if (fromMain) return { all, frame: fromMain, face: main.spec.photo.face || null };
  const withFace = all.filter((f) => !f.analysis?.custom && (f.analysis?.rostos || []).length);
  return { all, frame: store.pickFrames(withFace.length ? withFace : all, 1, 60_000)[0], face: null };
}

// O que cada vídeo leva e o que falta para ele sair. { data, missing: [frases] }
async function inputs(episodeId, kind) {
  const ctx = await sheets.context(episodeId);
  const sheet = ctx.meta?.cover_sheet || null;
  const missing = [];
  if (!sheet) missing.push('Gere as capas primeiro: os textos do vídeo vêm da ficha.');
  const data = { guest: sheet?.guest || ctx.episode?.guest_name || '', ep: ctx.episode?.number || '', tag: sheet?.tag || '' };
  if (sheet && !data.guest) missing.push('Falta o nome do convidado na ficha.');
  if (kind === 'story') {
    data.title = L.tidy(ctx.meta?.yt_title || ctx.episode?.title || '');
    if (!data.title) missing.push('Falta o título do episódio.');
  } else {
    const a = sheet?.angles?.curiosidade || {};
    Object.assign(data, a.hl ? { pre: a.pre || '', hl: a.hl, post: a.post || '' } : { pre: a.setup || '', hl: a.punch || '', post: '' });
    data.quote = sheet?.quote?.text || ''; data.quote_at = sheet?.quote?.at_ms ?? null;
    if (sheet && !data.hl) missing.push('Falta o gancho de curiosidade na ficha (a capa de curiosidade).');
    if (sheet && !data.quote) missing.push('Falta a frase literal do convidado na ficha.');
    else if (sheet && (sheet.quote.found === false || data.quote_at === null)) missing.push('A frase da ficha não foi achada na transcrição: confira a frase (capa de frase) antes de gerar.');
    if (sheet && M.countWords(data.quote) > 14) missing.push('A frase tem mais de 14 palavras: não cabe no teaser.');
    if (!(await editedFile(episodeId))) missing.push('Falta o vídeo editado do episódio: a voz do convidado sai dele.');
  }
  return { ctx, data, missing };
}

// Acha, no áudio em volta da frase, o instante em que ela começa e o tempo de cada palavra. Sem transcrição por palavra (ou se a
// frase não aparecer), devolve o começo do trecho e nenhuma palavra: a legenda entra num ritmo fixo.
async function locateQuote(videoUrl, quote, atMs, dir) {
  const from = Math.max(0, atMs - 1500);
  const fallback = { startMs: atMs, words: [], synced: false };
  if (!config.groqConfigured) return fallback;
  try {
    const file = path.join(dir, 'trecho.ogg');
    const net = /^https?:\/\//.test(videoUrl) ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '30'] : [];
    await media.run('ffmpeg', ['-v', 'error', '-y', ...net, '-ss', (from / 1000).toFixed(3), '-t', '24', '-i', videoUrl, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '32k', file], { timeoutMs: 180_000 });
    const out = await require('./groq').transcribe(fs.readFileSync(file), { filename: 'trecho.ogg', contentType: 'audio/ogg', words: true });
    const want = M.wordsOf(quote).map(norm).filter(Boolean);
    const got = (out.words || []).map((w) => ({ ...w, n: norm(w.word) })).filter((w) => w.n);
    for (let i = 0; i + want.length <= got.length; i += 1) {
      if (!want.every((w, k) => got[i + k].n === w)) continue;
      const t0 = got[i].start;
      return { startMs: Math.round(from + t0 * 1000), words: want.map((_, k) => ({ at: LEAD + (got[i + k].start - t0) })), synced: true };
    }
  } catch (err) { console.error('Teaser: tempo das palavras indisponível:', err.message); }
  return fallback;
}

// Desenha os quadros e entrega ao FFmpeg pela entrada padrão (JPEG por quadro). audio: arquivo com a voz, ou null (sem som).
async function encode(scene, images, outFile, { audio = null, onProgress } = {}) {
  covers.ensureFonts();
  const canvas = createCanvas(scenes.W, scenes.H); const ctx = canvas.getContext('2d');
  const total = Math.round(scene.duration * scene.fps);
  const sound = audio ? ['-i', audio] : ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'];
  const args = ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(scene.fps), '-c:v', 'mjpeg', '-i', 'pipe:0', ...sound,
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(scene.fps),
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-af', 'apad', '-t', String(scene.duration), '-movflags', '+faststart', outFile];
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  ff.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  const done = new Promise((resolve, reject) => {
    ff.on('error', (e) => reject(e.code === 'ENOENT' ? new Error('FFmpeg não está instalado neste servidor.') : e));
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`FFmpeg falhou (${code}): ${err.trim().split('\n').slice(-2).join(' | ')}`))));
  });
  ff.stdin.on('error', () => {}); // se o FFmpeg cair, o erro vem pelo close
  let poster = null;
  for (let i = 0; i < total; i += 1) {
    const t = i / scene.fps;
    E_render(ctx, scene.frame(t), images);
    const jpg = canvas.toBuffer('image/jpeg', 88);
    if (poster === null && t >= scene.posterAt) poster = canvas.toBuffer('image/jpeg', 90);
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
    if (ff.exitCode !== null) break;
    if (onProgress && i % 30 === 0) await onProgress(Math.round((i / total) * 100));
  }
  ff.stdin.end();
  await done;
  return { poster };
}
const E_render = (ctx, spec, images) => covers.engine.render(ctx, spec, images, { makeCanvas: covers.makeCanvas });

// O trabalho: junta o que o vídeo leva, monta, sobe para o armazenamento e marca como pronto.
async function run(job, { update } = {}) {
  const say = async (msg, pct) => { if (update) await update(msg, pct); };
  const { rows: [row] } = await db.query('SELECT * FROM episode_teasers WHERE id = $1', [job.ref_id]);
  if (!row) return { skipped: 'vídeo não encontrado' };
  const fail = async (msg) => { await db.query("UPDATE episode_teasers SET status = 'erro', error = $2, updated_at = now() WHERE id = $1", [row.id, String(msg).slice(0, 400)]); return { error: msg }; };
  if (!(await media.available())) return fail('O FFmpeg não está instalado neste servidor.');
  const { ctx, data, missing } = await inputs(row.episode_id, row.kind);
  if (missing.length) return fail(missing[0]);
  await db.query("UPDATE episode_teasers SET status = 'gerando', error = NULL, updated_at = now() WHERE id = $1", [row.id]);
  const dir = await media.tempDir('pulso-video-');
  try {
    await say('Escolhendo a foto…', 3);
    const { all, frame, face } = await pickFrame(row.episode_id, ctx.meta);
    if (!frame) return await fail('Não há quadros nem fotos para o vídeo: rode a análise por IA ou envie uma fotografia.');
    const buf = (await store.imageBuffers(all, [frame.ref]))[frame.ref];
    const images = { [frame.ref]: await loadImage(buf) };
    const photo = pieces.photoOf(frame, face);
    const mctx = covers.measureContext();
    let scene; let audio = null; const used = { ...data, photo: frame.ref };
    if (row.kind === 'story') scene = scenes.story(mctx, data, photo);
    else {
      await say('Achando a frase no áudio…', 8);
      const edited = await editedFile(row.episode_id);
      const url = await b2.presignGet(edited.storage_key, { expires: 3600 });
      const q = await locateQuote(url, data.quote, data.quote_at, dir);
      const startMs = q.startMs - LEAD * 1000; // a voz vem desde o início; a frase cai aos 5 s
      audio = path.join(dir, 'voz.m4a');
      const net = ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '30'];
      const delay = startMs < 0 ? `adelay=${-startMs}|${-startMs},` : '';
      await media.run('ffmpeg', ['-v', 'error', '-y', ...net, '-ss', (Math.max(0, startMs) / 1000).toFixed(3), '-t', String(VOICE - Math.max(0, -startMs / 1000)), '-i', url, '-vn', '-ac', '2', '-ar', '44100',
        '-af', `${delay}afade=t=in:d=0.15,afade=t=out:st=${VOICE - 0.6}:d=0.6`, '-c:a', 'aac', '-b:a', '160k', audio], { timeoutMs: 180_000 });
      scene = scenes.teaser(mctx, data, photo, q.words);
      Object.assign(used, { quote_start_ms: q.startMs, synced: q.synced });
    }
    await say('Desenhando o vídeo…', 12);
    const out = path.join(dir, 'video.mp4');
    const { poster } = await encode(scene, images, out, { audio, onProgress: (p) => say('Desenhando o vídeo…', 12 + Math.round(p * 0.8)) });
    await say('Guardando…', 95);
    const stamp = Date.now().toString(36);
    const key = await b2.keyFor('episodios', row.episode_id, 'videos', `${row.kind}-${stamp}.mp4`);
    const posterKey = await b2.keyFor('episodios', row.episode_id, 'videos', `${row.kind}-${stamp}.jpg`);
    const body = fs.readFileSync(out);
    await b2.putObject(key, body, 'video/mp4');
    if (poster) await b2.putObject(posterKey, poster, 'image/jpeg');
    for (const old of [row.storage_key, row.poster_key].filter(Boolean)) await b2.deleteObject(old).catch(() => {});
    await db.query(
      "UPDATE episode_teasers SET status = 'pronto', error = NULL, storage_key = $2, poster_key = $3, size_bytes = $4, duration_ms = $5, inputs = $6, updated_at = now() WHERE id = $1",
      [row.id, key, poster ? posterKey : null, body.length, scene.duration * 1000, JSON.stringify({ ...used, zoom: scene.zoom, soft: scene.soft })]);
    return { ok: true, bytes: body.length };
  } catch (err) {
    return await fail(err.message);
  } finally { await media.rmDir(dir); }
}
jobs.register('video_convidado', run);

// Pede o vídeo: entra na fila (leva 1 a 2 minutos). Devolve { row } ou { error }.
async function request(episodeId, kind, userId = null) {
  if (!KINDS[kind]) return { error: 'Vídeo desconhecido.' };
  // story e teaser são do convidado: vídeo sem convidado não tem o que mostrar
  const { rows: [ep] } = await db.query('SELECT format, guest_id FROM episodes WHERE id = $1', [episodeId]);
  if (!ep) return { error: 'Episódio não encontrado.' };
  if (ep.format === 'video' || !ep.guest_id) return { error: 'Os vídeos de lançamento são do convidado: este vídeo não tem convidado.' };
  const { missing } = await inputs(episodeId, kind);
  if (missing.length) return { error: missing[0] };
  const { rows: [row] } = await db.query(
    `INSERT INTO episode_teasers (episode_id, kind, status, created_by) VALUES ($1, $2, 'fila', $3)
     ON CONFLICT (episode_id, kind) DO UPDATE SET status = 'fila', error = NULL, created_by = $3, updated_at = now() RETURNING *`, [episodeId, kind, userId]);
  await jobs.enqueue('video_convidado', { episodeId: Number(episodeId), refId: row.id, maxAttempts: 1, createdBy: userId });
  return { row };
}

// Para a tela: os dois vídeos, com o estado de cada um e o que falta para gerar.
async function overview(episodeId) {
  const { rows } = await db.query('SELECT * FROM episode_teasers WHERE episode_id = $1', [episodeId]);
  const out = [];
  for (const kind of Object.keys(KINDS)) {
    const row = rows.find((r) => r.kind === kind) || null;
    const { data, missing } = await inputs(episodeId, kind);
    // fila parada há muito tempo (o servidor reiniciou no meio): deixa pedir de novo
    const stuck = row && ['fila', 'gerando'].includes(row.status) && Date.now() - new Date(row.updated_at).getTime() > 15 * 60_000;
    out.push({ kind, ...KINDS[kind], row: stuck ? { ...row, status: 'erro', error: 'A geração parou no meio. Gere de novo.' } : row, missing, data });
  }
  return out;
}

module.exports = { KINDS, LEAD, VOICE, fileName, inputs, locateQuote, encode, run, request, overview, editedFile, pickFrame };
