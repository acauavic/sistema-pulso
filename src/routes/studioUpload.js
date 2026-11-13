// Link do estúdio, lado público: /estudio/<token>. Sem login nem CSRF: o token secreto na URL é a chave (como no convite e no portal).
// Só deixa ENVIAR material da gravação para o episódio do link, com o mesmo motor do painel (partes direto para o Backblaze, retomada).
// Cada arquivo só é aceito pelo link que o criou; o link nunca lista, baixa ou apaga material pronto.
const express = require('express');
const config = require('../config');
const db = require('../db/pool');
const prod = require('../services/production');
const links = require('../services/studioLinks');
const { createLimiter } = require('../auth/rateLimit');
const { wrap, isIntId } = require('../utils/wrap');

const router = express.Router();
const MAX_PART = 70 * prod.MB;
const MAX_FILE = 200 * 1024 * prod.MB; // 200 GB
const missLimiter = createLimiter({ name: 'estudio_token_invalido', max: 30, windowMs: 10 * 60_000 }); // tentar adivinhar o link
const startLimiter = createLimiter({ name: 'estudio_iniciar', max: 1200, windowMs: 60 * 60_000 }); // arquivos iniciados por link

const HEADERS = { 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' };
const jsonError = (res, status, error, code) => res.status(status).set(HEADERS).json({ ok: false, error, ...(code ? { code } : {}) });

function closedPage(res, status = 404) {
  return res.status(status).set(HEADERS).render('studio/closed', { icon: require('../utils/icons').icon, title: 'Link do estúdio' });
}

// Link válido (aberto) ou responde: a página fechada para o navegador, JSON para o envio. Nunca diz se o link existiu.
async function load(req, res, { page = false } = {}) {
  const link = await links.byToken(req.params.token);
  if (link) return link;
  if (!await missLimiter.hit(req.ip)) { res.status(429).set(HEADERS).send('Muitas tentativas. Tente mais tarde.'); return null; }
  if (page) closedPage(res); else jsonError(res, 404, 'Este link não está mais aberto. Fale com a produção.', 'link_fechado');
  return null;
}
// Arquivo deste link (criado por ele); outro arquivo qualquer = não encontrado.
async function loadFile(req, link) {
  if (!isIntId(req.params.fid)) return null;
  const { rows: [f] } = await db.query('SELECT * FROM episode_files WHERE id = $1 AND upload_link_id = $2', [req.params.fid, link.id]);
  return f || null;
}
async function storageGuard(res, fn) {
  try { return await fn(); } catch (err) {
    if (err.code !== 'STORAGE_FULL') throw err;
    await prod.storageFull();
    return jsonError(res, 507, 'O armazenamento do Pulso está cheio agora e parou de receber arquivos. Avise a produção; quando liberarem, escolha os mesmos arquivos de novo: o envio continua de onde parou.', 'storage_full');
  }
}

router.get('/estudio/:token', wrap(async (req, res) => {
  const link = await load(req, res, { page: true });
  if (!link) return;
  const files = await links.files(link.id);
  res.set(HEADERS).render('studio/upload', {
    icon: require('../utils/icons').icon, fmt: require('../utils/format'), title: 'Material da gravação', link, tag: links.epTag(link.episode_number), base: `/estudio/${link.token}/arquivos/`,
    files: files.map((f) => ({ id: f.id, path: f.source_path || f.filename, size: Number(f.size_bytes), status: f.status })),
    storageReady: config.storageConfigured,
  });
}));

router.post('/estudio/:token/arquivos/iniciar', wrap(async (req, res) => {
  const link = await load(req, res); if (!link) return;
  if (!config.storageConfigured) return jsonError(res, 503, 'O armazenamento não está disponível agora. Fale com a produção.');
  if (!await startLimiter.hit(link.id)) return jsonError(res, 429, 'Muitos arquivos iniciados em pouco tempo. Espere alguns minutos.');
  const split = links.splitPath(req.body.caminho || req.body.nome);
  if (!split || links.isJunk(split.path)) return jsonError(res, 400, 'Arquivo de sistema: não precisa enviar.');
  const size = Number(req.body.tamanho);
  if (!Number.isSafeInteger(size) || size <= 0) return jsonError(res, 400, 'Arquivo vazio.');
  if (size > MAX_FILE) return jsonError(res, 400, 'Arquivo grande demais (limite de 200 GB por arquivo).');
  // mesmo caminho e tamanho já enviado por este link: não sobe de novo
  const { rows: [dup] } = await db.query("SELECT id, status FROM episode_files WHERE upload_link_id = $1 AND source_path = $2 AND size_bytes = $3 AND status = 'pronto' LIMIT 1", [link.id, split.path, size]);
  if (dup) return jsonError(res, 409, 'Este arquivo já foi enviado.', 'ja_enviado');
  if (!await links.fits(link, size)) return jsonError(res, 413, 'Este link chegou ao limite de material. Fale com a produção.');
  const { rows: [episode] } = await db.query('SELECT * FROM episodes WHERE id = $1', [link.episode_id]);
  return storageGuard(res, async () => {
    const { file, partSize, totalParts } = await prod.startUpload({
      episode, kind: links.kindFor(split.filename), label: split.label, filename: split.filename, contentType: req.body.tipo, size, userId: null,
    });
    await db.query('UPDATE episode_files SET upload_link_id = $2, source_path = $3 WHERE id = $1', [file.id, link.id, split.path]);
    const first = !link.first_upload_at;
    await links.touch(link, { first: true });
    if (first) {
      await prod.addEvent(link.episode_id, null, 'arquivo', 'O estúdio começou a enviar o material pelo link');
      await links.notifyTeam(link, 'inicio').catch((err) => console.error('Aviso do link do estúdio:', err.message));
    }
    res.set(HEADERS).json({ ok: true, id: file.id, partSize, totalParts });
  });
}));

router.put('/estudio/:token/arquivos/:fid/parte/:n', express.raw({ type: () => true, limit: MAX_PART }), wrap(async (req, res) => {
  const link = await load(req, res); if (!link) return;
  const file = await loadFile(req, link);
  if (!file || file.status !== 'enviando') return jsonError(res, 404, 'Envio não encontrado ou já concluído.');
  const n = Number.parseInt(req.params.n, 10);
  const total = Math.max(1, Math.ceil(Number(file.size_bytes) / file.part_size));
  if (!Number.isInteger(n) || n < 1 || n > total) return jsonError(res, 400, 'Parte inválida.');
  const expected = n < total ? file.part_size : Number(file.size_bytes) - file.part_size * (total - 1);
  if (!Buffer.isBuffer(req.body) || req.body.length !== expected) return jsonError(res, 400, `A parte ${n} deveria ter ${expected} bytes.`);
  return storageGuard(res, async () => { await prod.receivePart(file, n, req.body); await links.touch(link); res.set(HEADERS).json({ ok: true }); });
}));

router.get('/estudio/:token/arquivos/:fid/urls', wrap(async (req, res) => {
  const link = await load(req, res); if (!link) return;
  const file = await loadFile(req, link);
  if (!file || file.status !== 'enviando') return jsonError(res, 404, 'Envio não encontrado ou já concluído.');
  res.set(HEADERS).json(await require('../services/directUpload').urls({ key: file.storage_key, uploadId: file.upload_id, size: file.size_bytes, partSize: file.part_size, query: req.query.partes }));
}));

router.post('/estudio/:token/arquivos/:fid/parte/:n/ok', wrap(async (req, res) => {
  const link = await load(req, res); if (!link) return;
  const file = await loadFile(req, link);
  if (!file || file.status !== 'enviando') return jsonError(res, 404, 'Envio não encontrado ou já concluído.');
  const c = require('../services/directUpload').confirm({ size: file.size_bytes, partSize: file.part_size, number: req.params.n, body: req.body });
  if (c.error) return jsonError(res, c.status, c.error);
  await prod.registerPart(file, Number(req.params.n), c.etag, c.size);
  await links.touch(link);
  res.set(HEADERS).json({ ok: true });
}));

router.get('/estudio/:token/arquivos/:fid/partes', wrap(async (req, res) => {
  const link = await load(req, res); if (!link) return;
  const file = await loadFile(req, link);
  if (!file) return jsonError(res, 404, 'Arquivo não encontrado.');
  const { rows } = await db.query('SELECT part_number FROM episode_file_parts WHERE file_id = $1 ORDER BY part_number', [file.id]);
  res.set(HEADERS).json({ ok: true, status: file.status, parts: rows.map((r) => r.part_number), size: Number(file.size_bytes), partSize: file.part_size, totalParts: Math.max(1, Math.ceil(Number(file.size_bytes) / file.part_size)) });
}));

router.post('/estudio/:token/arquivos/:fid/concluir', wrap(async (req, res) => {
  const link = await load(req, res); if (!link) return;
  const file = await loadFile(req, link);
  if (!file) return jsonError(res, 404, 'Arquivo não encontrado.');
  if (file.status === 'pronto') return res.set(HEADERS).json({ ok: true });
  let result;
  const sent = await storageGuard(res, async () => { result = await prod.finishUpload(file); });
  if (!result) return sent;
  if (result.error) return jsonError(res, 409, result.error);
  await prod.addEvent(file.episode_id, null, 'arquivo', `Enviado pelo link do estúdio: ${file.source_path || file.filename}`);
  await db.query('UPDATE episodes SET updated_at = now() WHERE id = $1', [file.episode_id]);
  await links.touch(link);
  res.set(HEADERS).json({ ok: true, id: file.id });
}));

router.post('/estudio/:token/arquivos/:fid/cancelar', wrap(async (req, res) => {
  const link = await load(req, res); if (!link) return;
  const file = await loadFile(req, link);
  if (!file) return jsonError(res, 404, 'Arquivo não encontrado.');
  if (file.status !== 'enviando') return jsonError(res, 409, 'Este arquivo já chegou inteiro e não pode ser cancelado por aqui.');
  await prod.cancelUpload(file);
  res.set(HEADERS).json({ ok: true });
}));

// "Terminei o envio": fecha o link (o que ficou pela metade é cancelado) e avisa a equipe.
router.post('/estudio/:token/terminei', express.urlencoded({ extended: false }), wrap(async (req, res) => {
  const link = await load(req, res, { page: true }); if (!link) return;
  const s = await links.summary(link.id);
  if (s.sending && req.body.mesmo_assim !== '1') {
    const files = await links.files(link.id);
    return res.status(409).set(HEADERS).render('studio/upload', {
      icon: require('../utils/icons').icon, fmt: require('../utils/format'), title: 'Material da gravação', link, tag: links.epTag(link.episode_number), base: `/estudio/${link.token}/arquivos/`, storageReady: config.storageConfigured,
      files: files.map((f) => ({ id: f.id, path: f.source_path || f.filename, size: Number(f.size_bytes), status: f.status })),
      pending: s.sending,
    });
  }
  if (!s.ready) return res.redirect(303, `/estudio/${link.token}`);
  const done = await links.finish(link);
  if (done) {
    await prod.addEvent(link.episode_id, null, 'arquivo', `O estúdio terminou o envio pelo link: ${s.ready} arquivo${s.ready === 1 ? '' : 's'}`);
    await links.notifyTeam(link, 'fim').catch((err) => console.error('Aviso do link do estúdio:', err.message));
  }
  const files = (await links.files(link.id)).filter((f) => f.status === 'pronto');
  res.set(HEADERS).render('studio/done', { icon: require('../utils/icons').icon, fmt: require('../utils/format'), title: 'Material recebido', tag: links.epTag(link.episode_number), link, files, bytes: s.bytes });
}));

module.exports = router;
