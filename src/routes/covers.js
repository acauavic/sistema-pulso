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
const KINDS = { youtube_thumb: 'Thumbnail do YouTube', reel_cover: 'Capa de Reels/TikTok', post_quote: 'Post de frase', post_split: 'Tela dividida', carousel: 'Carrossel', entrega: 'Imagem entregue', spotify_cover: 'Capa do Spotify' };
const pieces = require('../services/coverPieces');
const sheets = require('../services/coverSheet');
const M = require('../public/design/models');
const EP_PIECES = ['youtube_thumb', 'spotify_cover']; // as peças do episódio que nascem da ficha
const notFound = (res) => res.status(404).render('error', { title: 'Não encontrado', message: 'Capa não encontrada.' });
const canDesign = (role) => can(role, 'covers.edit'); // gestão, editor e produtora (ela ajusta a capa ao agendar o post)
const canGenerate = (role) => can(role, 'production.review') || can(role, 'production.edit'); // gerar com a IA é passo da finalização
// Volta para o post de onde a pessoa veio (Novo post ou a publicação): só endereços nossos, nunca um link de fora.
const safeBack = (v) => (typeof v === 'string' && /^\/social\/(novo\?[\w=&,%-]*|publicacoes\/\d+)$/.test(v) ? v : null);
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

const THUMB_SIDE = require('../services/coverStore').THUMB_SIDE;
const fileName = (ep, c) => `${ep?.number ? `ep${String(ep.number).padStart(3, '0')}` : (c.clip_id ? `corte${c.clip_id}` : 'episodio')}-${c.kind.replace(/_/g, '-')}-${c.position + 1}.jpg`;
// Para onde voltar depois de aprovar/excluir: cada tipo de capa mora num lugar.
const homeOf = (c) => (c.clip_id ? `/cortes/${c.clip_id}` : (EP_PIECES.includes(c.kind) ? `/episodios/${c.episode_id}?capas=${c.kind === 'spotify_cover' ? 'spotify' : 'youtube'}#capas` : `/conteudo?episodio=${c.episode_id}#posts`));

router.get(both('/imagem'), requirePerm('episodes.read'), wrap(async (req, res) => {
  const c = await findCover(req);
  if (!c) return notFound(res);
  const current = String(req.query.v || '') === String(new Date(c.updated_at).getTime()) && req.query.baixar !== '1';
  if (req.query.baixar !== '1') { // para ver: WebP guardado no servidor (a versão entra na chave: capa refeita = WebP novo)
    const sent = await require('../services/webImage').send(req, res, {
      key: c.storage_key, version: String(new Date(c.updated_at).getTime()), maxSide: req.query.w === String(THUMB_SIDE) ? THUMB_SIDE : 2400, // ?w=640: miniatura das listas
      headers: { 'Cache-Control': current ? 'private, max-age=86400' : 'no-cache' }, fallback: () => false,
    });
    if (sent !== false) return sent;
  }
  const { rows: [ep] } = c.episode_id ? await db.query('SELECT number FROM episodes WHERE id = $1', [c.episode_id]) : { rows: [] };
  if (req.query.baixar === '1' && c.model && EP_PIECES.includes(c.kind) && !c.clip_id) { // peça do guia: nome e formato do guia (PNG quando cabe)
    const file = await pieces.download(c, ep);
    if (file) return res.set({ 'Content-Type': file.mime, 'Content-Disposition': `attachment; filename="${file.name}"`, 'Cache-Control': 'no-store' }).send(file.buffer);
  }
  const url = await b2.presignGet(c.storage_key, { expires: 3600, download: req.query.baixar === '1' ? fileName(ep, c) : null });
  // A capa muda de arquivo quando é editada (o antigo é apagado do bucket). Só dá para guardar o redirecionamento no navegador
  // quando o endereço traz a versão atual (?v=updated_at); "Baixar" e links sem versão perguntam sempre, para nunca cair no
  // arquivo antigo ("NoSuchKey").
  res.set('Cache-Control', current ? 'private, max-age=600' : 'no-store').redirect(302, url);
}));

router.post('/episodios/:id/capas/gerar', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canGenerate(req.user.role)) return deny(res);
  if (!isIntId(req.params.id)) return notFound(res);
  const kinds = [].concat(req.body.kinds || ['youtube_thumb', 'post_quote', 'post_split', 'carousel']).filter((k) => KINDS[k]);
  if (req.body.pecas === '1') { // capas pelo guia: a ficha, 3 thumbnails (uma por ângulo) e a capa do Spotify
    try {
      const out = await pieces.generate(req.params.id, { userId: req.user.id, newSheet: req.body.ficha === 'nova' });
      await prod.addEvent(req.params.id, req.user.id, 'capas', `${out.created.length} capas geradas pela ficha`);
      await req.flash(out.created.length ? 'ok' : 'error', out.created.length
        ? `${out.created.length === 1 ? '1 capa pronta' : `${out.created.length} capas prontas`}.${out.fails.length ? ` ${out.fails.map((f) => f.what).join(' e ')} ${out.fails.length === 1 ? 'ficou' : 'ficaram'} de fora: veja o motivo no cartão.` : ''}`
        : (out.fails.length ? 'Nenhuma capa saiu: os textos passam do limite. Ajuste cada uma no cartão.' : 'Nada novo para gerar: as capas aprovadas ou ajustadas ficam como estão.'));
    } catch (err) {
      await req.flash('error', `Não foi possível gerar: ${err.message}`);
    }
    return res.redirect(`/episodios/${req.params.id}?capas=youtube#capas`);
  }
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
  if (c.kind === 'entrega') return res.redirect(`/conteudo/pedidos/${c.request_id}`); // imagem pronta do editor: não passa pelo editor de capa
  const { rows: [ep] } = c.episode_id ? await db.query('SELECT id, number, title, project_id FROM episodes WHERE id = $1', [c.episode_id]) : { rows: [] };
  const frames = (await store.loadFrames(c.episode_id, { clipId: c.clip_id ?? null, custom: true })).map((f) => ({ id: f.id, ref: f.ref, width: f.width, height: f.height, at_ms: f.at_ms, score: f.score, analysis: { rostos: f.analysis.rostos || [], caixas_de_texto: f.analysis.caixas_de_texto || [], custom: Boolean(f.analysis.custom), unchecked: Boolean(f.analysis.unchecked) } }));
  const siblings = c.clip_id
    ? await db.query('SELECT id, label, position FROM episode_covers WHERE clip_id = $1 ORDER BY position', [c.clip_id])
    : await db.query('SELECT id, label, position FROM episode_covers WHERE episode_id = $1 AND kind = $2 AND group_key IS NOT DISTINCT FROM $3 ORDER BY position', [c.episode_id, c.kind, c.group_key]);
  const voltar = safeBack(req.query.voltar);
  res.render('episodes/editor', {
    title: `Editar — ${KINDS[c.kind]}`, ep, cover: c, kindLabel: KINDS[c.kind], voltar,
    // Vindo do post: a capa do corte é a escolhida (as outras sugestões não entram); slides do carrossel continuam com os números.
    siblings: voltar && c.clip_id ? [] : siblings.rows, backUrl: voltar || homeOf(c),
    backLabel: voltar ? 'Voltar ao post' : (c.clip_id ? 'Voltar ao corte' : (c.kind === 'youtube_thumb' ? 'Voltar ao episódio' : 'Voltar ao conteúdo')),
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
  if (!can(req.user, 'production.review') && !can(req.user, 'production.manage')) return deny(res);
  const c = await findCover(req);
  if (!c) return notFound(res);
  const approve = req.body.aprovar !== '0';
  if (c.clip_id) { // a capa escolhida do corte é uma só
    await db.query('UPDATE episode_covers SET approved = (id = $2 AND $3) WHERE clip_id = $1', [c.clip_id, c.id, approve]);
    if (approve) await db.query('UPDATE episode_clips SET cover_id = $2, updated_at = now() WHERE id = $1', [c.clip_id, c.id]);
    return res.redirect(homeOf(c));
  }
  if (c.kind === 'youtube_thumb') {
    // Várias podem ser aprovadas (vão juntas para o teste A/B do YouTube). A principal é a que sai na publicação: a primeira
    // aprovada, até alguém escolher outra. Tirar a aprovação da principal passa a vez para outra aprovada.
    await db.query('UPDATE episode_covers SET approved = $2 WHERE id = $1', [c.id, approve]);
    const { rows: [meta] } = await db.query('SELECT thumb_cover_id FROM episode_metadata WHERE episode_id = $1', [c.episode_id]);
    const { rows: ok } = await db.query("SELECT id FROM episode_covers WHERE episode_id = $1 AND kind = 'youtube_thumb' AND clip_id IS NULL AND approved ORDER BY position, id", [c.episode_id]);
    const main = ok.some((r) => r.id === meta?.thumb_cover_id) ? meta.thumb_cover_id : (ok[0]?.id || null);
    await db.query(
      `INSERT INTO episode_metadata (episode_id, thumb_cover_id) VALUES ($1, $2) ON CONFLICT (episode_id) DO UPDATE SET thumb_cover_id = $2, updated_at = now()`,
      [c.episode_id, main]);
  } else if (c.kind === 'spotify_cover') { // a capa do Spotify é uma só
    await db.query("UPDATE episode_covers SET approved = (id = $2 AND $3) WHERE episode_id = $1 AND kind = 'spotify_cover' AND clip_id IS NULL", [c.episode_id, c.id, approve]);
  } else await db.query('UPDATE episode_covers SET approved = $2 WHERE id = $1', [c.id, approve]);
  await prod.addEvent(c.episode_id, req.user.id, 'capas', `${approve ? 'Aprovada' : 'Aprovação removida'}: ${c.label || KINDS[c.kind]}`);
  res.redirect(homeOf(c));
}));

// A principal das aprovadas: é a que vai para o YouTube quando o episódio é publicado.
router.post(both('/principal'), requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!can(req.user, 'production.review') && !can(req.user, 'production.manage')) return deny(res);
  const c = await findCover(req);
  if (!c || c.kind !== 'youtube_thumb' || c.clip_id) return notFound(res);
  await db.query('UPDATE episode_covers SET approved = true WHERE id = $1', [c.id]);
  await db.query('INSERT INTO episode_metadata (episode_id, thumb_cover_id) VALUES ($1, $2) ON CONFLICT (episode_id) DO UPDATE SET thumb_cover_id = $2, updated_at = now()', [c.episode_id, c.id]);
  await prod.addEvent(c.episode_id, req.user.id, 'capas', `Thumbnail principal: ${c.label || KINDS[c.kind]}`);
  res.redirect(homeOf(c));
}));

// ---------------------------------------------------------------- peças do guia: ficha e a janela "Ajustar capa"
// Nome, credencial e eixo (a base da ficha). As peças que usam esses campos são refeitas; a aprovada fica "desatualizada".
router.post('/episodios/:id/ficha-das-capas', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canGenerate(req.user.role) && !canDesign(req.user.role)) return deny(res);
  if (!isIntId(req.params.id)) return notFound(res);
  const tag = sheets.clean(req.body.tag);
  const bad = M.fieldError('tag', tag) || M.fieldError('guest', sheets.clean(req.body.guest));
  if (bad) { await req.flash('error', bad); return res.redirect(`/episodios/${req.params.id}?capas=youtube&abrir=modal-ficha#capas`); }
  await sheets.update(req.params.id, { guest: req.body.guest, tag, axis: req.body.axis });
  const r = await pieces.refresh(Number(req.params.id), { userId: req.user.id });
  await prod.addEvent(req.params.id, req.user.id, 'capas', 'Ficha das capas atualizada');
  await req.flash('ok', `Ficha salva.${r.redone ? ` ${r.redone === 1 ? '1 capa refeita' : `${r.redone} capas refeitas`}.` : ''}${r.stale ? ` ${r.stale === 1 ? 'A aprovada ficou' : 'As aprovadas ficaram'} como estava${r.stale === 1 ? '' : 'm'}: use Atualizar no cartão.` : ''}`);
  res.redirect(`/episodios/${req.params.id}?capas=youtube#capas`);
}));

// Um ângulo que ainda não tem capa (o texto passou do limite na geração): a mesma janela, e salvar cria a capa.
async function angleCover(req) {
  if (!isIntId(req.params.id) || !sheets.ANGLE_KEYS.includes(req.params.angle)) return null;
  const { rows: [meta] } = await db.query('SELECT m.cover_sheet FROM episodes e LEFT JOIN episode_metadata m ON m.episode_id = e.id WHERE e.id = $1', [req.params.id]);
  if (!meta?.cover_sheet) return null;
  const angle = req.params.angle;
  return { id: null, episode_id: Number(req.params.id), clip_id: null, kind: 'youtube_thumb', angle, model: sheets.pickModel(meta.cover_sheet, angle, meta.cover_sheet.angles?.[angle]?.model), spec: null, position: sheets.ANGLE_KEYS.indexOf(angle) };
}
const ADJUST = [...both('/ajustar'), '/episodios/:id/capas/angulo/:angle/ajustar'];
const adjustTarget = (req) => (req.params.angle ? angleCover(req) : findCover(req));

// O que a janela precisa: os campos da ficha desta peça, os quadros e as fotografias que podem virar foto.
router.get(ADJUST, requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canDesign(req.user.role) && !canGenerate(req.user.role)) return res.status(403).json({ ok: false, error: 'Seu perfil não ajusta capas.' });
  const c = await adjustTarget(req);
  if (!c || !c.model) return res.status(404).json({ ok: false, error: 'Capa não encontrada.' });
  if (c.clip_id) { // capa de corte: os campos vêm da própria capa; os quadros são os do corte
    const frames = (await store.loadFrames(null, { clipId: c.clip_id, custom: true })).map((f) => ({
      ref: f.ref, url: `/quadros/${f.id}`, w: f.width, h: f.height, face: pieces.photoOf(f).face, photo: Boolean(f.analysis?.from_file), custom: Boolean(f.analysis?.custom), fileId: f.analysis?.from_file || null,
    }));
    return res.json({
      ok: true, cover: { id: c.id, kind: c.kind, model: c.model, angle: null, flip: false, photo: c.spec?.photo || null },
      data: { ...(c.spec?.sheet || {}) }, quoteFound: true,
      frames, photos: await episodePhotos(await episodeOfCover(c)), photoUrl: `/capas/${c.id}/foto`, saveUrl: `/capas/${c.id}/ajustar`, special: null,
    });
  }
  const ctx = await sheets.context(c.episode_id);
  const sheet = ctx.meta?.cover_sheet || {};
  const frames = (await store.loadFrames(c.episode_id, { clipId: null, custom: true })).map((f) => ({
    ref: f.ref, url: `/quadros/${f.id}`, w: f.width, h: f.height, face: pieces.photoOf(f).face, photo: Boolean(f.analysis?.from_file), custom: Boolean(f.analysis?.custom), fileId: f.analysis?.from_file || null,
  }));
  const { rows: [g] } = await db.query(
    `SELECT e.number FROM episode_covers c JOIN episodes e ON e.id = c.episode_id WHERE c.model = 'YT-G' AND c.approved AND c.episode_id <> $1 ORDER BY e.number DESC NULLS LAST LIMIT 1`, [c.episode_id]);
  const recent = g?.number && ctx.episode?.number && ctx.episode.number - g.number < 5 && ctx.episode.number > g.number;
  res.json({
    ok: true,
    cover: { id: c.id, kind: c.kind, model: c.model, angle: c.angle, flip: Boolean(c.spec?.flip), photo: c.spec?.photo || null },
    data: sheets.dataFor(sheet, ctx.episode, c.angle), quoteFound: sheet.quote?.found !== false,
    frames, photos: c.id ? await episodePhotos(c.episode_id) : [], photoUrl: c.id ? `/capas/${c.id}/foto` : null, saveUrl: c.id ? `/capas/${c.id}/ajustar` : `/episodios/${c.episode_id}/capas/angulo/${c.angle}/ajustar`,
    special: g?.number ? { last: `EP.${String(g.number).padStart(3, '0')}`, recent: Boolean(recent) } : null,
  });
}));

router.post(ADJUST, requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canDesign(req.user.role) && !canGenerate(req.user.role)) return res.status(403).json({ ok: false, error: 'Seu perfil não ajusta capas.' });
  const c = await adjustTarget(req);
  if (!c || !c.model) return res.status(404).json({ ok: false, error: 'Capa não encontrada.' });
  const b = req.body || {};
  const fields = {};
  for (const k of ['pre', 'hl', 'post', 'setup', 'punch', 'num', 'line', 'quote', 'hook', 'guest', 'sub']) if (typeof b.fields?.[k] === 'string') fields[k] = b.fields[k].slice(0, 300);
  if (c.clip_id) {
    const done = await pieces.adjustClip(c, { model: String(b.model || ''), fields, frame: typeof b.frame === 'string' ? b.frame : null, face: b.face }, req.user.id);
    if (done.error) return res.status(422).json({ ok: false, error: done.error.join(' ') });
    if (c.episode_id) await prod.addEvent(c.episode_id, req.user.id, 'capas', `Capa de corte ajustada: ${done.row.label || ''}`);
    await req.flash('ok', 'Capa ajustada.');
    return res.json({ ok: true, back: homeOf(c) });
  }
  const out = await pieces.adjust(c, { model: String(b.model || ''), fields, frame: typeof b.frame === 'string' ? b.frame : null, flip: b.flip === undefined ? undefined : b.flip === true, face: b.face }, req.user.id);
  if (out.error) return res.status(422).json({ ok: false, error: out.error.join(' ') });
  await prod.addEvent(c.episode_id, req.user.id, 'capas', `Capa ajustada: ${out.row.label || KINDS[c.kind]}`);
  await req.flash('ok', 'Capa ajustada.');
  res.json({ ok: true, back: homeOf(c) });
}));

// A ficha mudou depois da aprovação: refaz esta capa com os textos de agora.
router.post(both('/atualizar'), requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canDesign(req.user.role) && !canGenerate(req.user.role)) return deny(res);
  const c = await findCover(req);
  if (!c || !c.model || c.clip_id) return notFound(res);
  const r = await pieces.refresh(c.episode_id, { only: c.id, userId: req.user.id });
  await req.flash(r.redone ? 'ok' : 'error', r.redone ? 'Capa atualizada com a ficha.' : 'Não deu para atualizar: algum texto passa do limite. Use Ajustar.');
  res.redirect(homeOf(c));
}));

// ---------------------------------------------------------------- vídeos do convidado (story de lançamento e teaser)
const videos = require('../services/guestVideos');
router.post('/episodios/:id/videos/:kind/gerar', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canGenerate(req.user.role) && !canDesign(req.user.role)) return deny(res);
  if (!isIntId(req.params.id) || !videos.KINDS[req.params.kind]) return notFound(res);
  const out = await videos.request(req.params.id, req.params.kind, req.user.id);
  if (out.error) await req.flash('error', out.error);
  else { await prod.addEvent(req.params.id, req.user.id, 'capas', `${videos.KINDS[req.params.kind].label}: vídeo pedido`); await req.flash('ok', `${videos.KINDS[req.params.kind].label} na fila. Leva de 1 a 2 minutos; pode sair desta tela.`); }
  res.redirect(`/episodios/${req.params.id}?capas=videos#capas`);
}));
// O estado dos dois vídeos (a tela pergunta enquanto um deles está sendo gerado).
router.get('/episodios/:id/videos/status', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return res.status(404).json({ ok: false });
  const { rows } = await db.query('SELECT kind, status FROM episode_teasers WHERE episode_id = $1', [req.params.id]);
  res.json({ ok: true, waiting: rows.some((r) => ['fila', 'gerando'].includes(r.status)), videos: rows });
}));
router.get('/episodios/:id/videos/:kind/:what(arquivo|capa)', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!isIntId(req.params.id) || !videos.KINDS[req.params.kind]) return notFound(res);
  const { rows: [v] } = await db.query("SELECT t.*, e.number FROM episode_teasers t JOIN episodes e ON e.id = t.episode_id WHERE t.episode_id = $1 AND t.kind = $2 AND t.status = 'pronto'", [req.params.id, req.params.kind]);
  const key = req.params.what === 'capa' ? v?.poster_key : v?.storage_key;
  if (!key) return notFound(res);
  const download = req.params.what === 'arquivo' && req.query.baixar === '1' ? videos.fileName({ id: v.episode_id, number: v.number }, v.kind) : null;
  res.set('Cache-Control', 'private, max-age=300').redirect(302, await b2.presignGet(key, { expires: 3600, download }));
}));

// As thumbnails aprovadas num ZIP, com os nomes do guia, para subir no teste de miniatura do YouTube Studio.
router.get('/episodios/:id/capas/teste.zip', requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return notFound(res);
  const { rows: [ep] } = await db.query('SELECT id, number FROM episodes WHERE id = $1', [req.params.id]);
  const { rows } = ep ? await db.query("SELECT * FROM episode_covers WHERE episode_id = $1 AND clip_id IS NULL AND kind = 'youtube_thumb' AND approved ORDER BY position, id", [ep.id]) : { rows: [] };
  if (!rows.length) return notFound(res);
  const files = (await Promise.all(rows.map((c) => pieces.download(c, ep)))).filter(Boolean);
  const { zipStream, uniqueNames } = require('../utils/zipStream');
  const names = uniqueNames(files.map((f) => f.name));
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="pulso_${ep.number ? `ep${String(ep.number).padStart(3, '0')}` : `episodio${ep.id}`}_youtube_teste.zip"`, 'Cache-Control': 'no-store' });
  const zip = zipStream(res);
  for (const [i, f] of files.entries()) await zip.add(names[i], f.buffer);
  await zip.end();
}));

router.post(both('/excluir'), requirePerm('episodes.read'), wrap(async (req, res) => {
  if (!canDesign(req.user.role)) return deny(res);
  const c = await findCover(req);
  if (!c) return notFound(res);
  const t = await require('../services/trash').remove('cover', c.id, { user: req.user });
  if (t) await req.flash('ok', 'Imagem na lixeira.', { undo: t.batch });
  res.redirect(homeOf(c));
}));

module.exports = router;
