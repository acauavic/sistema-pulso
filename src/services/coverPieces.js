// Peças do episódio a partir da ficha (coverSheet) e dos modelos do guia (public/design/models.js): as 3 thumbnails do teste
// A/B (uma por ângulo) e a capa do Spotify. Também refaz uma peça quando alguém ajusta texto, modelo ou foto, e monta os arquivos
// para baixar no padrão do guia (pulso_ep018_yt_A.png).
const db = require('../db/pool');
const b2 = require('./b2');
const covers = require('./covers');
const store = require('./coverStore');
const sheets = require('./coverSheet');
const M = require('../public/design/models');

const YT_MAX = 1.9 * 1024 * 1024; // o YouTube aceita até 2 MB
const SP_MAX = 500 * 1024; // o Spotify pede abaixo de 512 KB
const LETTERS = { curiosidade: 'A', contraste: 'B', autoridade: 'C' };

// A foto no formato dos modelos: o rosto maior do quadro (centro e altura, de 0 a 1). face: marcação feita à mão, se houver.
function photoOf(frame, face = null) {
  if (!frame) return null;
  const f = (frame.analysis?.rostos || []).slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const auto = f ? { x: f.x + f.w / 2, y: f.y + f.h / 2, h: f.h } : null;
  return { ref: frame.ref, w: frame.width, h: frame.height, face: face || auto, noFace: !face && !auto };
}
const cleanFace = (f) => {
  if (!f || typeof f !== 'object') return null;
  const n = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : null; };
  const out = { x: n(f.x, 0, 1), y: n(f.y, 0, 1), h: n(f.h, 0.04, 0.95) };
  return out.x === null || out.y === null || out.h === null ? null : out;
};

// Monta e confere (sem gravar). Devolve { spec, ctxData, notes, warnings } ou { error: [...] }.
function build(modelId, data, frame, { flip = false, angle = null, face = null } = {}) {
  const photo = photoOf(frame, face);
  const built = M.build(covers.measureContext(), modelId, data, photo, { flip, angle });
  if (built.error) return built;
  if (photo) { built.spec.photo = { ref: photo.ref, ...(face ? { face } : {}) }; if (photo.noFace) built.warnings.push('Não achei o rosto nesta foto: marque o rosto ou troque a foto.'); }
  return built;
}

// Renderiza no tamanho final: thumbnail até 2 MB, Spotify 3000×3000 abaixo de 512 KB.
async function render(built, buffers) {
  const kind = M.MODELS[built.spec.model].kind;
  let quality = kind === 'spotify_cover' ? 0.9 : 0.92;
  const limit = kind === 'spotify_cover' ? SP_MAX : kind === 'youtube_thumb' ? YT_MAX : Infinity;
  let res = await covers.renderSpec(built.spec, buffers, built.ctxData, { type: 'image/jpeg', quality });
  while (res.buffer.length > limit && quality > 0.5) { quality -= 0.06; res = await covers.renderSpec(built.spec, buffers, built.ctxData, { type: 'image/jpeg', quality }); }
  const reads = M.reads(built.spec);
  res.lint = {
    ...res.lint, warnings: [...res.lint.warnings, ...(built.warnings || [])], reads,
    ...(reads === false ? { issues: [...res.lint.issues, 'Não lê a 168 px: o destaque está pequeno ou a capa tem palavras demais.'], ok: false } : {}),
    zoom: built.notes?.zoom ?? null,
  };
  return res;
}
const labelOf = (spec) => {
  const s = spec.sheet || {}; const m = M.MODELS[spec.model];
  const txt = m.fields.includes('pre') ? [s.pre, s.hl, s.post].filter(Boolean).join(' ') : m.fields.includes('setup') ? `${s.setup} ${s.punch}` : m.fields.includes('num') ? `${s.num} ${s.line}` : m.fields.includes('quote') ? s.quote : s.hook;
  return `${spec.angle ? `${M.ANGLES[spec.angle]}: ` : ''}${M.tidy(txt)}`.slice(0, 160);
};

// Tenta o desenho normal e o espelhado e fica com o que tem menos problema (texto sobre o rosto, por exemplo).
async function best(modelId, data, frame, buffers, opts = {}) {
  const tries = opts.flip === undefined ? [false, true] : [Boolean(opts.flip)];
  let pick = null;
  for (const flip of tries) {
    const built = build(modelId, data, frame, { ...opts, flip });
    if (built.error) return built;
    const res = await render(built, buffers);
    const score = res.lint.issues.length * 10 + res.lint.warnings.length;
    if (!pick || score < pick.score) pick = { built, res, score };
    if (!score || !M.MODELS[modelId].angles) break; // Spotify e Reels não espelham
  }
  return pick;
}

async function insert(episodeId, pick, { kind, position = 0, userId = null, clipId = null, auto = true }) {
  const row = await store.insertCover(episodeId, { kind, spec: pick.built.spec, ctx: pick.built.ctxData, lint: pick.res.lint, label: labelOf(pick.built.spec), position, clipId }, pick.res, userId);
  const { rows: [out] } = await db.query('UPDATE episode_covers SET model = $2, angle = $3, auto = $4 WHERE id = $1 RETURNING *', [row.id, pick.built.spec.model, pick.built.spec.angle || null, auto]);
  return out;
}

// Para a capa do Spotify, foto de câmera antes de quadro do vídeo (o arquivo sai em 3000 px: quadro de 1080p fica ampliado).
const spotifyFrame = (frames, fallback) => frames.filter((f) => f.analysis?.from_file && (f.analysis.rostos || []).length).sort((a, b) => b.width * b.height - a.width * a.height)[0] || fallback;

// Gera a ficha (se não houver) e as peças: 3 thumbnails, uma por ângulo, e a capa do Spotify. Não toca no que foi aprovado ou ajustado.
// Devolve { created, fails: [{ what, reasons }], sheet }.
async function generate(episodeId, { userId = null, onProgress, newSheet = false } = {}) {
  const ctx = await sheets.context(episodeId);
  if (!ctx.episode) throw new Error('Episódio não encontrado.');
  const all = await store.loadFrames(episodeId, { clipId: null, custom: true });
  const frames = all.filter((f) => !f.analysis?.custom);
  if (!all.length) throw new Error('Não há quadros analisados para montar as capas.');
  onProgress?.('Preenchendo a ficha…');
  const sheet = (!newSheet && ctx.meta?.cover_sheet) || await sheets.generate(episodeId);
  const kinds = ['youtube_thumb', 'spotify_cover'];
  const { rows: old } = await db.query('DELETE FROM episode_covers WHERE episode_id = $1 AND clip_id IS NULL AND auto AND NOT approved AND kind = ANY($2) RETURNING storage_key', [episodeId, kinds]);
  for (const o of old) await b2.deleteObject(o.storage_key).catch(() => {});
  const { rows: kept } = await db.query('SELECT kind, angle FROM episode_covers WHERE episode_id = $1 AND clip_id IS NULL AND kind = ANY($2) AND model IS NOT NULL', [episodeId, kinds]);
  const durationMs = ctx.transcript?.duration_ms || Math.max(...all.map((f) => f.at_ms)) * 1.05;
  const withFace = frames.filter((f) => (f.analysis?.rostos || []).length);
  const picks = store.pickFrames(withFace.length >= 3 ? withFace : (frames.length ? frames : all), 3, durationMs);
  const created = []; const fails = []; const buffers = {};
  const load = async (frame) => { if (!(frame.ref in buffers)) Object.assign(buffers, await store.imageBuffers(all, [frame.ref])); return { [frame.ref]: buffers[frame.ref] }; };

  onProgress?.('Montando as thumbnails…');
  for (const [i, angle] of sheets.ANGLE_KEYS.entries()) {
    if (kept.some((k) => k.kind === 'youtube_thumb' && k.angle === angle)) continue; // já tem uma aprovada ou ajustada
    const frame = picks[i % picks.length];
    const model = sheets.pickModel(sheet, angle, sheet.angles?.[angle]?.model);
    const pick = await best(model, sheets.dataFor(sheet, ctx.episode, angle), frame, await load(frame), { angle });
    if (pick.error) { fails.push({ what: M.ANGLES[angle], angle, model, reasons: pick.error }); continue; }
    created.push(await insert(episodeId, pick, { kind: 'youtube_thumb', position: i, userId }));
  }
  if (!kept.some((k) => k.kind === 'spotify_cover')) {
    onProgress?.('Montando a capa do Spotify…');
    const frame = spotifyFrame(all, picks[0]);
    const pick = await best('SP-A', sheets.dataFor(sheet, ctx.episode), frame, await load(frame), { flip: false });
    if (pick.error) fails.push({ what: 'Spotify', model: 'SP-A', reasons: pick.error });
    else created.push(await insert(episodeId, pick, { kind: 'spotify_cover', userId }));
  }
  return { created, fails, sheet };
}

// Refaz uma peça com o que a pessoa escolheu na janela Ajustar: { model, fields, frame (ref), flip, face }.
// Guarda os textos na ficha (os campos são dela) e troca a imagem. Devolve { row } ou { error: [...] }.
async function adjust(cover, input, userId = null) {
  const model = M.MODELS[input.model] && M.MODELS[input.model].kind === cover.kind ? input.model : cover.model;
  if (!model) return { error: ['Esta capa não usa um modelo do guia.'] };
  const ctx = await sheets.context(cover.episode_id);
  const fields = input.fields || {};
  const patch = {};
  if (cover.kind === 'youtube_thumb') {
    Object.assign(patch, { angle: cover.angle, model }, Object.fromEntries(['pre', 'hl', 'post', 'setup', 'punch', 'num', 'line'].filter((k) => fields[k] !== undefined).map((k) => [k, fields[k]])));
    if (fields.quote !== undefined) patch.quote = fields.quote;
  } else if (cover.kind === 'spotify_cover') {
    if (fields.hook !== undefined) patch.spotify_hook = fields.hook;
    if (fields.guest !== undefined) patch.guest = fields.guest;
  }
  // confere antes de gravar a ficha: o que não cabe não entra
  const draft = { ...(ctx.meta?.cover_sheet || {}), angles: { ...(ctx.meta?.cover_sheet?.angles || {}) } };
  if (patch.angle) draft.angles[patch.angle] = { ...(draft.angles[patch.angle] || {}), ...Object.fromEntries(Object.entries(patch).filter(([k]) => !['angle', 'quote'].includes(k)).map(([k, v]) => [k, sheets.clean(v)])) };
  if (patch.quote !== undefined) draft.quote = { ...(draft.quote || {}), text: sheets.clean(patch.quote) };
  if (patch.spotify_hook !== undefined) draft.spotify_hook = sheets.clean(patch.spotify_hook);
  if (patch.guest !== undefined) draft.guest = sheets.clean(patch.guest);
  const data = sheets.dataFor(draft, ctx.episode, cover.angle);
  const errs = M.problems(model, data);
  if (errs.length) return { error: errs };

  const all = await store.loadFrames(cover.episode_id, { clipId: null, custom: true });
  const ref = input.frame && all.some((f) => f.ref === input.frame) ? input.frame : cover.spec?.photo?.ref;
  const frame = all.find((f) => f.ref === ref) || all[0];
  const face = cleanFace(input.face) || (ref === cover.spec?.photo?.ref ? cover.spec?.photo?.face : null) || null;
  const flip = input.flip !== undefined ? Boolean(input.flip) : Boolean(cover.spec?.flip);
  const pick = await best(model, data, frame, frame ? await store.imageBuffers(all, [frame.ref]) : {}, { angle: cover.angle, flip, face });
  if (pick.error) return { error: pick.error };
  await sheets.update(cover.episode_id, patch);
  if (!cover.id) return { row: await insert(cover.episode_id, pick, { kind: cover.kind, position: cover.position || 0, userId, auto: false }) }; // ângulo que ainda não tinha capa
  return { row: await replace(cover, pick, userId) };
}

// Troca a imagem e o desenho de uma capa que já existe (mantém a aprovação).
async function replace(cover, pick, userId = null, { stale = false } = {}) {
  const key = await b2.keyFor(...store.ownerKey(cover.episode_id, cover.clip_id), 'capas', `${cover.kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`);
  await b2.putObject(key, pick.res.buffer, 'image/jpeg');
  const { rows: [row] } = await db.query(
    `UPDATE episode_covers SET spec = $2, ctx = $3, lint = $4, storage_key = $5, width = $6, height = $7, size_bytes = $8, model = $9, label = $10, auto = false, stale = $11, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [cover.id, JSON.stringify(pick.built.spec), JSON.stringify(pick.built.ctxData), JSON.stringify(pick.res.lint), key, pick.res.width, pick.res.height, pick.res.buffer.length, pick.built.spec.model, labelOf(pick.built.spec), stale]);
  await b2.deleteObject(cover.storage_key).catch((err) => console.error('Falha ao apagar imagem antiga:', err.message));
  store.prewarm(row, pick.res.buffer);
  void userId;
  return row;
}

// A base da ficha mudou (nome, credencial, eixo): refaz as peças do episódio com a mesma foto e o mesmo modelo. A aprovada não é
// trocada sozinha: fica marcada como desatualizada, com o botão Atualizar. only: refaz só esta capa (o Atualizar).
async function refresh(episodeId, { only = null, userId = null } = {}) {
  const ctx = await sheets.context(episodeId);
  const sheet = ctx.meta?.cover_sheet;
  if (!sheet) return { redone: 0, stale: 0 };
  const { rows } = await db.query("SELECT * FROM episode_covers WHERE episode_id = $1 AND clip_id IS NULL AND model IS NOT NULL AND kind IN ('youtube_thumb', 'spotify_cover') ORDER BY id", [episodeId]);
  const all = await store.loadFrames(episodeId, { clipId: null, custom: true });
  let redone = 0; let stale = 0;
  for (const c of rows) {
    if (only && c.id !== only) continue;
    if (c.approved && !only) { await db.query('UPDATE episode_covers SET stale = true WHERE id = $1', [c.id]); stale += 1; continue; }
    const frame = all.find((f) => f.ref === c.spec?.photo?.ref) || all[0];
    const pick = await best(c.model, sheets.dataFor(sheet, ctx.episode, c.angle), frame, frame ? await store.imageBuffers(all, [frame.ref]) : {}, { angle: c.angle, flip: Boolean(c.spec?.flip), face: c.spec?.photo?.face || null });
    if (pick.error) { await db.query('UPDATE episode_covers SET stale = true WHERE id = $1', [c.id]); stale += 1; continue; }
    const auto = c.auto;
    await replace(c, pick, userId);
    if (auto) await db.query('UPDATE episode_covers SET auto = true WHERE id = $1', [c.id]); // continua sendo "do sistema": a ficha é que mudou
    redone += 1;
  }
  return { redone, stale };
}

// O que falta para cada ângulo sair (para o cartão tracejado da tela). [{ what, angle, model, reasons }]
function missing(sheet, episode, coversList) {
  if (!sheet) return [];
  const out = [];
  for (const angle of sheets.ANGLE_KEYS) {
    if (coversList.some((c) => c.kind === 'youtube_thumb' && c.angle === angle)) continue;
    const model = sheets.pickModel(sheet, angle, sheet.angles?.[angle]?.model);
    const reasons = M.problems(model, sheets.dataFor(sheet, episode, angle));
    if (reasons.length) out.push({ what: M.ANGLES[angle], angle, model, reasons });
  }
  return out;
}

// Arquivo para baixar no padrão do guia: PNG quando cabe no limite da peça, senão o JPG guardado.
const pieceName = (episode, cover, ext) => {
  const ep = episode?.number ? `ep${String(episode.number).padStart(3, '0')}` : `episodio${cover.episode_id}`;
  const part = cover.kind === 'spotify_cover' ? 'spotify' : `yt_${LETTERS[cover.angle] || cover.position + 1}`;
  return `pulso_${ep}_${part}.${ext}`;
};
async function download(cover, episode) {
  if (cover.kind === 'youtube_thumb' && cover.model && cover.spec) {
    try {
      const all = await store.loadFrames(cover.episode_id, { clipId: null, custom: true });
      const buffers = await store.imageBuffers(all, store.refsOf(cover.spec));
      const png = await covers.renderSpec(cover.spec, buffers, cover.ctx || {}, { type: 'image/png' });
      if (png.buffer.length <= YT_MAX) return { buffer: png.buffer, mime: 'image/png', name: pieceName(episode, cover, 'png') };
    } catch (err) { console.error('PNG da thumbnail:', err.message); }
  }
  const obj = await b2.getObject(cover.storage_key);
  if (!obj) return null;
  return { buffer: Buffer.from(await obj.arrayBuffer()), mime: 'image/jpeg', name: pieceName(episode, cover, 'jpg') };
}

module.exports = { YT_MAX, SP_MAX, LETTERS, photoOf, build, render, best, generate, adjust, replace, refresh, missing, download, pieceName, labelOf };
