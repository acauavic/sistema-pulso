// Capas e posts do episódio: lista, imagem (link assinado), editor visual, aprovação e geração.
const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const b2 = require('../services/b2');
const prod = require('../services/production');
const store = require('../services/coverStore');
const { sanitizeSpec } = require('../services/specSanitizer');
const { engine } = require('../services/covers');
const { audit } = require('../services/audit');
const { requirePerm } = require('../middleware');
const { can } = require('../permissions');
const { wrap, isIntId } = require('../utils/wrap');

const router = express.Router();
const MAX_IMAGE = 12 * 1024 * 1024;
const KINDS = { youtube_thumb: 'Thumbnail do YouTube', reel_cover: 'Capa de Reels/TikTok', post_quote: 'Post de frase', post_split: 'Tela dividida', carousel: 'Carrossel' };
const notFound = (res) => res.status(404).render('error', { title: 'Não encontrado', message: 'Capa não encontrada.' });
const canDesign = (role) => can(role, 'production.review') || can(role, 'production.edit'); // gestão e editor; a produtora só sobe material bruto
const deny = (res) => res.status(403).render('error', { title: 'Sem permissão', message: 'Seu perfil não edita capas e posts.' });

// As capas respondem em dois endereços: /episodios/:id/capas/:cid/… (do episódio) e /capas/:cid/… (genérico: cortes ainda sem episódio).
const both = (suffix = '') => [`/episodios/:id/capas/:cid${suffix}`, `/capas/:cid${suffix}`];

async function findCover(req) {
  if (!isIntId(req.params.cid) || (req.params.id !== undefined && !isIntId(req.params.id))) return null;
  const { rows: [c] } = await db.query('SELECT * FROM episode_covers WHERE id = $1', [req.params.cid]);
  if (!c) return null;
  if (req.params.id !== undefined && String(c.episode_id) !== String(req.params.id)) return null; // endereço do episódio errado
  return c;
}

const frameOut = (f) => ({ id: f.id, ref: `f${f.id}`, width: f.width, height: f.height, at_ms: f.at_ms, score: f.score, analysis: { rostos: f.analysis.rostos || [], caixas_de_texto: f.analysis.caixas_de_texto || [], custom: true, unchecked: Boolean(f.analysis.unchecked), from_file: f.analysis.from_file || null } });
const PHOTO_EXT = /\.(jpe?g|png|webp)$/i; // o que o servidor consegue abrir para virar fundo (HEIC/RAW não)
// De qual episódio são as fotografias que a capa pode usar (capa de corte: o episódio do corte).
async function episodeOfCover(c) {
  if (c.episode_id) return c.episode_id;
  if (!c.clip_id) return null;
  const { rows: [cl] } = await db.query('SELECT episode_id FROM episode_clips WHERE id = $1', [c.clip_id]);
  return cl?.episode_id || null;
}
async function episodePhotos(episodeId) {
  if (!episodeId) return [];
  const { rows } = await db.query(
    "SELECT id, kind, label, filename, size_bytes FROM episode_files WHERE episode_id = $1 AND kind IN ('foto', 'bastidor') AND status = 'pronto' ORDER BY kind DESC, created_at, id", [episodeId]);
  return rows.filter((f) => PHOTO_EXT.test(f.filename)).map((f) => ({ id: f.id, name: f.filename, kind: f.kind, thumb: `/episodios/${episodeId}/arquivos/${f.id}/previa` }));
}

const fileName = (ep, c) => `${ep?.number ? `ep${String(ep.number).padStart(3, '0')}` : (c.clip_id ? `corte${c.clip_id}` : 'episodio')}-${c.kind.replace(/_/g, '-')}-${c.position + 1}.jpg`;
// Para onde voltar depois de aprovar/excluir: cada tipo de capa mora num lugar.
const homeOf = (c) => (c.clip_id ? `/cortes/${c.clip_id}` : (c.kind === 'youtube_thumb' ? `/episodios/${c.episode_id}#capas` : `/conteudo?episodio=${c.episode_id}#posts`));

router.get(both('/imagem'), requirePerm('episodes.read'), wrap(async (req, res) => {
  const c = await findCover(req);
  if (!c) return notFound(res);
  const { rows: [ep] } = c.episode_id ? await db.query('SELECT number FROM episodes WHERE id = $1', [c.episode_id]) : { rows: [] };
  const url = await b2.presignGet(c.storage_key, { expires: 3600, download: req.query.baixar === '1' ? fileName(ep, c) : null });
  // A capa muda de arquivo quando é editada (o antigo é apagado do bucket). Só dá para guardar o redirecionamento no navegador
  // quando o endereço traz a versão atual (?v=updated_at); "Baixar" e links sem versão perguntam sempre, para nunca cair no
  // arquivo antigo ("NoSuchKey").
  const current = String(req.query.v || '') === String(new Date(c.updated_at).getTime()) && req.query.baixar !== '1';
  res.set('Cache-Control', current ? 'private, max-age=600' : 'no-store').redirect(302, url);
}));

router.post('/episodios/:id/capas/gerar', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canDesign(req.user.role)) return deny(res);
  if (!isIntId(req.params.id)) return notFound(res);
  const kinds = [].concat(req.body.kinds || ['youtube_thumb', 'post_quote', 'post_split', 'carousel']).filter((k) => KINDS[k]);
  try {
    const made = await store.generateForEpisode(req.params.id, { kinds, userId: req.user.id });
    await prod.addEvent(req.params.id, req.user.id, 'capas', `${made.length} capas e posts gerados`);
    await req.flash('ok', `${made.length} imagens geradas.`);
  } catch (err) {
    await req.flash('error', `Não foi possível gerar: ${err.message}`);
  }
  res.redirect(req.body.voltar === 'conteudo' ? `/conteudo?episodio=${req.params.id}#posts` : `/episodios/${req.params.id}#capas`);
}));

router.get(both('/editar'), requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canDesign(req.user.role)) return deny(res);
  const c = await findCover(req);
  if (!c) return notFound(res);
  const { rows: [ep] } = c.episode_id ? await db.query('SELECT id, number, title FROM episodes WHERE id = $1', [c.episode_id]) : { rows: [] };
  const frames = (await store.loadFrames(c.episode_id, { clipId: c.clip_id ?? null, custom: true })).map((f) => ({ id: f.id, ref: f.ref, width: f.width, height: f.height, at_ms: f.at_ms, score: f.score, analysis: { rostos: f.analysis.rostos || [], caixas_de_texto: f.analysis.caixas_de_texto || [], custom: Boolean(f.analysis.custom), unchecked: Boolean(f.analysis.unchecked) } }));
  const siblings = c.clip_id
    ? await db.query('SELECT id, label, position FROM episode_covers WHERE clip_id = $1 ORDER BY position', [c.clip_id])
    : await db.query('SELECT id, label, position FROM episode_covers WHERE episode_id = $1 AND kind = $2 AND group_key IS NOT DISTINCT FROM $3 ORDER BY position', [c.episode_id, c.kind, c.group_key]);
  res.render('episodes/editor', {
    title: `Editar — ${KINDS[c.kind]}`, ep, cover: c, kindLabel: KINDS[c.kind], siblings: siblings.rows, backUrl: homeOf(c),
    backLabel: c.clip_id ? 'Voltar ao corte' : (c.kind === 'youtube_thumb' ? 'Voltar ao episódio' : 'Voltar ao conteúdo'),
    editorData: {
      spec: c.spec, ctx: c.ctx, lint: c.lint, frames, format: engine.FORMATS[c.spec.format], saveUrl: `/capas/${c.id}`, uploadUrl: c.clip_id ? `/capas/imagem?corte=${c.clip_id}` : `/capas/imagem?episodio=${c.episode_id}`,
      imageBase: '/quadros/', brand: engine.BRAND, photos: await episodePhotos(await episodeOfCover(c)), photoUrl: `/capas/${c.id}/foto`,
    },
  });
}));

// Imagem própria como fundo (no lugar de um quadro do vídeo). Vira um "quadro" do episódio (ou do corte), marcado como enviado.
router.post(['/episodios/:id/capas/imagem', '/capas/imagem'], requirePerm('episodes.read'), express.raw({ type: () => true, limit: MAX_IMAGE }), wrap(async (req, res) => {
  if (!canDesign(req.user.role)) return res.status(403).json({ ok: false, error: 'Seu perfil não edita capas.' });
  const clipId = isIntId(req.query.corte) ? Number(req.query.corte) : null;
  const episodeId = req.params.id ?? (isIntId(req.query.episodio) ? req.query.episodio : null);
  if (clipId) {
    const { rows: [c] } = await db.query('SELECT episode_id FROM episode_clips WHERE id = $1', [clipId]);
    if (!c || (req.params.id !== undefined && String(c.episode_id) !== String(req.params.id))) return res.status(404).json({ ok: false, error: 'Corte não encontrado.' });
    const frame = await store.addCustomImage(c.episode_id, { buffer: req.body, clipId });
    if (frame.error) return res.status(400).json({ ok: false, error: frame.error });
    return res.json({ ok: true, frame: { id: frame.id, ref: `f${frame.id}`, width: frame.width, height: frame.height, at_ms: frame.at_ms, score: frame.score, analysis: frame.analysis } });
  }
  if (!isIntId(episodeId)) return res.status(404).json({ ok: false });
  const { rows: [ep] } = await db.query('SELECT 1 FROM episodes WHERE id = $1', [episodeId]);
  if (!ep) return res.status(404).json({ ok: false });
  const frame = await store.addCustomImage(episodeId, { buffer: req.body, clipId: null });
  if (frame.error) return res.status(400).json({ ok: false, error: frame.error });
  await prod.addEvent(episodeId, req.user.id, 'capas', 'Imagem enviada para usar como fundo de capa');
  res.json({ ok: true, frame: { id: frame.id, ref: `f${frame.id}`, width: frame.width, height: frame.height, at_ms: frame.at_ms, score: frame.score, analysis: frame.analysis } });
}));

// Fotografia do episódio (material bruto) como fundo: vira um "quadro" da capa (em pé, rostos conferidos pela IA).
// A mesma foto usada de novo é reaproveitada, sem baixar e analisar outra vez.
router.post(both('/foto'), requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canDesign(req.user.role)) return res.status(403).json({ ok: false, error: 'Seu perfil não edita capas.' });
  const c = await findCover(req);
  if (!c) return res.status(404).json({ ok: false, error: 'Capa não encontrada.' });
  const episodeId = await episodeOfCover(c);
  const fileId = String(req.body.arquivo || '');
  if (!episodeId || !isIntId(fileId)) return res.status(400).json({ ok: false, error: 'Escolha uma fotografia do episódio.' });
  const { rows: [file] } = await db.query("SELECT * FROM episode_files WHERE id = $1 AND episode_id = $2 AND kind IN ('foto', 'bastidor') AND status = 'pronto'", [fileId, episodeId]);
  if (!file || !PHOTO_EXT.test(file.filename)) return res.status(404).json({ ok: false, error: 'Fotografia não encontrada (ou em formato que não abre aqui, como HEIC).' });
  const { rows: [same] } = await db.query(
    "SELECT * FROM episode_frames WHERE (analysis->>'from_file')::int = $1 AND clip_id IS NOT DISTINCT FROM $2 AND (clip_id IS NOT NULL OR episode_id = $3) ORDER BY id DESC LIMIT 1", [file.id, c.clip_id || null, episodeId]);
  if (same) {
    const [f] = (await store.loadFrames(c.episode_id, { clipId: c.clip_id ?? null, custom: true })).filter((x) => x.id === same.id);
    if (f) return res.json({ ok: true, reused: true, frame: frameOut(f) });
  }
  if (Number(file.size_bytes) > 60 * 1024 * 1024) return res.status(413).json({ ok: false, error: 'Fotografia grande demais para virar fundo (limite de 60 MB).' });
  const obj = await b2.getObject(file.storage_key);
  if (!obj) return res.status(404).json({ ok: false, error: 'A fotografia não está no armazenamento.' });
  const frame = await store.addCustomImage(episodeId, { buffer: Buffer.from(await obj.arrayBuffer()), clipId: c.clip_id || null, fromFile: file.id });
  if (frame.error) return res.status(400).json({ ok: false, error: frame.error });
  await prod.addEvent(episodeId, req.user.id, 'capas', `Fotografia usada como fundo de capa: ${file.filename}`);
  res.json({ ok: true, reused: false, frame: frameOut(frame) });
}));

router.post(both(), requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canDesign(req.user.role)) return res.status(403).json({ ok: false, error: 'Seu perfil não edita capas.' });
  const c = await findCover(req);
  if (!c) return res.status(404).json({ ok: false });
  const frames = await store.loadFrames(c.episode_id, { clipId: c.clip_id ?? null, custom: true });
  let spec;
  try {
    spec = sanitizeSpec(req.body.spec, { allowedRefs: new Set(frames.map((f) => f.ref)) });
    if (spec.format !== c.spec.format) throw new Error('O formato da capa não pode mudar.');
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
  const ctx = { faces: [], blocks: [], insets: [] };
  const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
  for (const key of ['faces', 'blocks', 'insets']) ctx[key] = (Array.isArray(req.body.ctx?.[key]) ? req.body.ctx[key] : []).slice(0, 12).map((b) => ({ x: num(b.x), y: num(b.y), w: num(b.w), h: num(b.h) }));
  const { row, lint } = await store.updateCover(c, spec, ctx, req.user.id);
  if (c.episode_id) await prod.addEvent(c.episode_id, req.user.id, 'capas', `Capa editada: ${KINDS[c.kind]}`);
  res.json({ ok: true, lint, updated_at: row.updated_at, size_bytes: row.size_bytes });
}));

router.post(both('/aprovar'), requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!can(req.user.role, 'production.review') && !can(req.user.role, 'production.manage')) return deny(res);
  const c = await findCover(req);
  if (!c) return notFound(res);
  const approve = req.body.aprovar !== '0';
  if (c.clip_id) { // a capa escolhida do corte é uma só
    await db.query('UPDATE episode_covers SET approved = (id = $2 AND $3) WHERE clip_id = $1', [c.clip_id, c.id, approve]);
    if (approve) await db.query('UPDATE episode_clips SET cover_id = $2, updated_at = now() WHERE id = $1', [c.clip_id, c.id]);
    return res.redirect(homeOf(c));
  }
  if (c.kind === 'youtube_thumb') {
    await db.query('UPDATE episode_covers SET approved = false WHERE episode_id = $1 AND kind = $2', [c.episode_id, c.kind]);
    await db.query('UPDATE episode_covers SET approved = $2 WHERE id = $1', [c.id, approve]);
    await db.query(
      `INSERT INTO episode_metadata (episode_id, thumb_cover_id) VALUES ($1, $2) ON CONFLICT (episode_id) DO UPDATE SET thumb_cover_id = $2, updated_at = now()`,
      [c.episode_id, approve ? c.id : null]);
  } else await db.query('UPDATE episode_covers SET approved = $2 WHERE id = $1', [c.id, approve]);
  await prod.addEvent(c.episode_id, req.user.id, 'capas', `${approve ? 'Aprovada' : 'Aprovação removida'}: ${c.label || KINDS[c.kind]}`);
  res.redirect(homeOf(c));
}));

router.post(both('/excluir'), requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canDesign(req.user.role)) return deny(res);
  const c = await findCover(req);
  if (!c) return notFound(res);
  await db.query('DELETE FROM episode_covers WHERE id = $1', [c.id]);
  await b2.deleteObject(c.storage_key).catch(() => {});
  res.redirect(homeOf(c));
}));

module.exports = router;
