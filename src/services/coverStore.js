// Gera, renderiza e guarda capas/posts de um episódio (usa os quadros analisados e as citações da IA).
const db = require('../db/pool');
const b2 = require('./b2');
const covers = require('./covers');
const designs = require('./designs');
const L = require('./platformLimits');
const { normalizeBoxes } = require('./finalization');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const media = require('./media');

const MAX_THUMB_BYTES = 1.9 * 1024 * 1024; // YouTube aceita até 2 MB

// Quadros do episódio no formato dos construtores: ref "f<id>" + caixas já normalizadas (0–1).
// clipId: undefined = todos os quadros do episódio (editor), null = só os do episódio inteiro, número = só os de um corte.
async function loadFrames(episodeId, { clipId, custom = false } = {}) {
  // custom: inclui as imagens que a equipe enviou no editor (não entram na geração automática)
  const notCustom = custom ? '' : " AND NOT (coalesce(analysis, '{}'::jsonb) ? 'custom')";
  // corte (pode ainda não ter episódio): só pelo id do corte
  const [cond, args] = typeof clipId === 'number' ? ['clip_id = $1', [clipId]]
    : clipId === null ? ['episode_id = $1 AND clip_id IS NULL', [episodeId]] : ['episode_id = $1', [episodeId]];
  const { rows } = await db.query(`SELECT id, clip_id, at_ms, storage_key, width, height, analysis, score FROM episode_frames WHERE ${cond}${notCustom} ORDER BY at_ms`, args);
  // Defensivo: análises antigas guardaram caixas em 0–1000 (ou pixels). normalizeBoxes é idempotente para o que já está em 0–1.
  return rows.map((r) => {
    const a = r.analysis || {};
    return { ...r, ref: `f${r.id}`, analysis: { ...a, rostos: normalizeBoxes(a.rostos, r), caixas_de_texto: normalizeBoxes(a.caixas_de_texto, r) } };
  });
}

async function imageBuffers(frames, refs) {
  const out = {};
  for (const ref of refs) {
    const f = frames.find((x) => x.ref === ref);
    if (!f) continue;
    const obj = await b2.getObject(f.storage_key);
    if (obj) out[ref] = Buffer.from(await obj.arrayBuffer());
  }
  return out;
}

// refs usadas por um spec (fundo ou painéis).
function refsOf(spec) {
  const refs = new Set();
  if (spec.bg?.ref) refs.add(spec.bg.ref);
  for (const p of spec.bg?.panels || []) refs.add(p.ref);
  for (const l of spec.layers || []) if (l.ref) refs.add(l.ref);
  return [...refs];
}

// JPEG sempre abaixo do limite (reduz a qualidade se precisar); posts do Instagram ficam em JPEG alto, capas pequenas também.
// Se o texto principal ficou com pouco contraste sobre a imagem (medido na imagem de verdade), reforça o fundo atrás dele: primeiro
// escurece as faixas, depois põe uma mancha escura atrás do texto. Altera o spec (que é o que fica salvo).
function boostContrast(spec, step) {
  const mctx = covers.measureContext();
  if (step === 1) {
    for (const s of spec.scrims || []) if (['bottom', 'top', 'left', 'right'].includes(s.side)) s.strength = Math.min(0.92, (s.strength ?? 0.5) + 0.2);
    spec.dim = Math.min(0.4, (spec.dim || 0) + 0.08);
    return;
  }
  for (const l of spec.layers || []) {
    if (l.hidden || l.type !== 'text' || (l.role || 'main') !== 'main') continue;
    const b = covers.engine.layerBox(mctx, l);
    spec.scrims = [...(spec.scrims || []).filter((s) => !(s.side === 'spot' && s.auto === l.id)), { side: 'spot', auto: l.id, rect: { x: b.x - 40, y: b.y - 20, w: b.w + 80, h: b.h + 40 }, strength: step === 2 ? 0.75 : 0.9 }];
  }
  if (step >= 3) spec.dim = Math.min(0.4, (spec.dim || 0) + 0.1);
}

async function render(spec, buffers, ctxData, { thumb = false } = {}) {
  let quality = thumb ? 0.92 : 0.93;
  let res = await covers.renderSpec(spec, buffers, ctxData, { type: 'image/jpeg', quality });
  for (let step = 1; step <= 3 && res.lint.issues.some((i) => /contraste/.test(i)); step += 1) {
    boostContrast(spec, step);
    res = await covers.renderSpec(spec, buffers, ctxData, { type: 'image/jpeg', quality });
  }
  while (thumb && res.buffer.length > MAX_THUMB_BYTES && quality > 0.5) {
    quality -= 0.08;
    res = await covers.renderSpec(spec, buffers, ctxData, { type: 'image/jpeg', quality });
  }
  return res;
}

// Prefixo das imagens no bucket: cortes têm pasta própria (podem ainda não ter episódio).
const ownerKey = (episodeId, clipId) => (clipId ? ['cortes', clipId] : ['episodios', episodeId]);

async function insertCover(episodeId, { kind, spec, ctx, lint, label, group, position = 0, clipId = null }, res, userId = null) {
  const key = await b2.keyFor(...ownerKey(episodeId, clipId), 'capas', `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`);
  await b2.putObject(key, res.buffer, 'image/jpeg');
  const { rows: [row] } = await db.query(
    `INSERT INTO episode_covers (episode_id, kind, group_key, position, label, spec, ctx, lint, storage_key, mime, width, height, size_bytes, created_by, clip_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'image/jpeg',$10,$11,$12,$13,$14) RETURNING *`,
    [episodeId, kind, group || null, position, label || null, JSON.stringify(spec), JSON.stringify(ctx || {}), JSON.stringify(lint || {}), key, res.width, res.height, res.buffer.length, userId, clipId]);
  return row;
}

// Substitui a imagem de uma capa existente (depois de editar no editor) e atualiza o spec e a conferência.
async function updateCover(cover, spec, ctx, userId) {
  const frames = await loadFrames(cover.episode_id, { clipId: cover.clip_id ?? null, custom: true });
  const buffers = await imageBuffers(frames, refsOf(spec));
  const res = await render(spec, buffers, ctx, { thumb: cover.kind === 'youtube_thumb' });
  const key = await b2.keyFor(...ownerKey(cover.episode_id, cover.clip_id), 'capas', `${cover.kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`);
  await b2.putObject(key, res.buffer, 'image/jpeg');
  const { rows: [row] } = await db.query(
    `UPDATE episode_covers SET spec = $2, ctx = $3, lint = $4, storage_key = $5, width = $6, height = $7, size_bytes = $8, auto = false, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [cover.id, JSON.stringify(spec), JSON.stringify(ctx || {}), JSON.stringify(res.lint), key, res.width, res.height, res.buffer.length]);
  await b2.deleteObject(cover.storage_key).catch((err) => console.error('Falha ao apagar imagem antiga:', err.message));
  return { row, lint: res.lint };
}

// Imagem enviada pela equipe para ser o fundo de uma capa. Reduz para no máximo 2400 px, guarda como JPEG e tenta ler os rostos
// com a IA; se a IA não estiver disponível, a imagem é aceita mas marcada como "não conferida" (o editor avisa).
async function addCustomImage(episodeId, { buffer, clipId = null }) {
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  let img;
  try { img = await loadImage(Buffer.from(buffer)); } catch { return { error: 'Não consegui abrir esta imagem. Use JPG, PNG ou WebP.' }; }
  if (img.width < 400 || img.height < 400) return { error: 'A imagem é muito pequena (mínimo 400 px de cada lado).' };
  const draw = (maxSide) => {
    const s = Math.min(1, maxSide / Math.max(img.width, img.height));
    const c = createCanvas(Math.round(img.width * s), Math.round(img.height * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  };
  const big = draw(2400);
  const jpeg = big.toBuffer('image/jpeg', 92);
  let analysis = { rostos: [], caixas_de_texto: [], custom: true, unchecked: true };
  if (config.geminiConfigured) {
    const dir = await media.tempDir('pulso-img-');
    try {
      const small = path.join(dir, 'small.jpg');
      fs.writeFileSync(small, draw(768).toBuffer('image/jpeg', 80));
      const [a] = await require('./finalization').analyzeFrames([{ small, at_ms: 0, width: big.width, height: big.height }], { attempts: 2, timeoutMs: 25_000 }); // resposta rápida: se a IA estiver ocupada, segue sem conferir
      if (a) analysis = { ...a, custom: true };
    } catch (err) {
      console.error('Imagem enviada sem leitura da IA:', err.message);
    } finally { await media.rmDir(dir); }
  }
  const key = await b2.keyFor(...ownerKey(episodeId, clipId), 'quadros', `enviada-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.jpg`);
  await b2.putObject(key, jpeg, 'image/jpeg');
  const { rows: [r] } = await db.query(
    'INSERT INTO episode_frames (episode_id, clip_id, at_ms, storage_key, width, height, analysis, score) VALUES ($1,$2,0,$3,$4,$5,$6,NULL) RETURNING *',
    [episodeId, clipId, key, big.width, big.height, JSON.stringify(analysis)]);
  return { ...r, analysis: { ...analysis, rostos: normalizeBoxes(analysis.rostos, r), caixas_de_texto: normalizeBoxes(analysis.caixas_de_texto, r) } };
}

// Escolhe até n quadros bons e espaçados no tempo.
function pickFrames(frames, n, durationMs) {
  const sorted = frames.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  const gap = Math.max(1000, durationMs * 0.08);
  const picked = [];
  for (const f of sorted) if (picked.every((p) => Math.abs(p.at_ms - f.at_ms) >= gap)) { picked.push(f); if (picked.length === n) break; }
  for (const f of sorted) { if (picked.length >= n) break; if (!picked.includes(f)) picked.push(f); }
  return picked;
}

const nearest = (frames, at, durationMs) => {
  const window = Math.max(8000, durationMs * 0.1);
  const near = frames.filter((f) => Math.abs(f.at_ms - at) <= window);
  const pool = near.length ? near : frames;
  return pool.slice().sort((a, b) => (b.score || 0) - (a.score || 0))[0];
};

const shortRole = (g) => {
  const r = String(g?.positioning || g?.job_title || '').trim();
  return r.length <= 44 ? r : L.fitWords(r, 44);
};

// Gera tudo o que dá para gerar sozinho. kinds: ['youtube_thumb','reel_cover','post_quote','post_split','carousel'].
async function generateForEpisode(episodeId, { kinds = ['youtube_thumb', 'post_quote', 'post_split', 'carousel'], userId = null, onProgress } = {}) {
  const { rows: [episode] } = await db.query('SELECT e.*, g.name AS guest_name, g.positioning, g.job_title FROM episodes e LEFT JOIN guests g ON g.id = e.guest_id WHERE e.id = $1', [episodeId]);
  const { rows: [meta] } = await db.query('SELECT * FROM episode_metadata WHERE episode_id = $1', [episodeId]);
  const { rows: [tr] } = await db.query('SELECT duration_ms FROM episode_transcripts WHERE episode_id = $1', [episodeId]);
  const frames = await loadFrames(episodeId, { clipId: null });
  if (!frames.length) throw new Error('Não há quadros analisados para montar as capas.');
  const sug = meta?.suggestions || {};
  const durationMs = tr?.duration_ms || Math.max(...frames.map((f) => f.at_ms)) * 1.05;
  const epLabel = episode.number ? `EP.${String(episode.number).padStart(3, '0')}` : '';
  const who = episode.guest_name || '';
  const role = shortRole(episode);
  const buffers = await imageBuffers(frames, frames.map((f) => f.ref));
  const created = [];
  const group = `g${Date.now().toString(36)}`;

  // limpa o que o sistema gerou antes e ninguém aprovou nem editou
  const { rows: old } = await db.query('DELETE FROM episode_covers WHERE episode_id = $1 AND clip_id IS NULL AND auto AND NOT approved AND kind = ANY($2) RETURNING storage_key', [episodeId, kinds]);
  for (const o of old) await b2.deleteObject(o.storage_key).catch(() => {});

  const save = async (kind, built, extra = {}) => {
    const used = refsOf(built.spec);
    const res = await render(built.spec, Object.fromEntries(used.map((r) => [r, buffers[r]])), built.ctxData, { thumb: kind === 'youtube_thumb' });
    created.push(await insertCover(episodeId, { kind, spec: built.spec, ctx: built.ctxData, lint: res.lint, ...extra }, res, userId));
  };

  const texts = (sug.thumbnail_texts || []).map((t) => t.texto).filter(Boolean);
  const quotes = (sug.quotes || []).filter((q) => q.frase);
  if (kinds.includes('youtube_thumb')) {
    onProgress?.('Montando as thumbnails…');
    const picks = pickFrames(frames, 3, durationMs);
    const fallbackText = meta?.thumb_text || episode.title;
    for (let i = 0; i < Math.min(3, picks.length); i += 1) {
      const text = texts[i] || texts[0] || fallbackText;
      await save('youtube_thumb', designs.buildThumbnail({ frame: picks[i], text, label: who, epLabel }), { label: `Opção ${i + 1}: ${text}`, position: i });
    }
  }
  if (kinds.includes('reel_cover')) {
    const f = pickFrames(frames, 1, durationMs)[0];
    await save('reel_cover', designs.buildReelCover({ frame: f, text: texts[0] || episode.title, label: who, epLabel }), { label: `Capa: ${texts[0] || episode.title}` });
  }
  if (kinds.includes('post_quote') && quotes.length) {
    onProgress?.('Montando os posts de frase…');
    for (let i = 0; i < Math.min(2, quotes.length); i += 1) {
      const q = quotes[i];
      const frame = nearest(frames, q.at_ms ?? durationMs / 2, durationMs);
      await save('post_quote', designs.buildQuotePost({ frame, quote: q.frase, who: q.quem || who, role, epLabel }), { label: `Frase: ${L.fitWords(q.frase, 50)}`, position: i });
    }
  }
  if (kinds.includes('post_split') && quotes.length >= 2) {
    const [a, b] = quotes;
    const fa = nearest(frames, a.at_ms ?? 0, durationMs);
    let fb = nearest(frames, b.at_ms ?? durationMs / 2, durationMs);
    if (fb.id === fa.id) fb = pickFrames(frames.filter((f) => f.id !== fa.id), 1, durationMs)[0] || fb;
    await save('post_split', designs.buildSplitPost({ top: { frame: fa, quote: a.frase }, bottom: { frame: fb, quote: b.frase }, epLabel }), { label: 'Tela dividida: duas frases' });
  }
  if (kinds.includes('carousel') && quotes.length >= 2) {
    onProgress?.('Montando o carrossel…');
    const coverFrame = pickFrames(frames, 1, durationMs)[0];
    const title = texts[0] ? `${texts[0]}.` : L.fitWords(episode.title, 60);
    const slides = designs.buildCarousel({ coverFrame, title, quotes: quotes.slice(0, 4).map((q) => q.frase), who, role, epLabel });
    for (let i = 0; i < slides.length; i += 1) await save('carousel', slides[i], { group, position: i, label: `Carrossel ${i + 1}/${slides.length}` });
  }
  return created;
}

module.exports = { ownerKey, addCustomImage, loadFrames, imageBuffers, refsOf, render, insertCover, updateCover, generateForEpisode, pickFrames, nearest };
