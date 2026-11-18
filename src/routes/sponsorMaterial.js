// Material do patrocinador (aba Material): o envio em partes pela fila de envios (o mesmo contrato das rotas dos episódios, que a
// src/public/uploads.js já conhece), a logo principal, os envios que pararam no meio e o "Baixar" por link curto do Backblaze.
// Ver services/sponsorMaterial.js.
const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const b2 = require('../services/b2');
const { can } = require('../permissions');
const { requirePerm } = require('../middleware');
const { wrap } = require('../utils/wrap');
const { audit } = require('../services/audit');
const material = require('../services/sponsorMaterial');
const prod = require('../services/production');
const sponsorsSvc = require('../services/sponsors');
const directUpload = require('../services/directUpload');

const router = express.Router();
const MAX_PART = 70 * prod.MB;
const isIntId = (v) => /^[1-9]\d{0,9}$/.test(String(v));
const uploadError = (res, status, error) => res.status(status).json({ ok: false, error });
const back = (id) => `/patrocinadores/${id}#material`;
// As rotas da fila respondem em JSON (a fila mostra a frase); o editor só vê e baixa.
const writer = (req, res, next) => (req.user && can(req.user.role, 'sponsors.write') ? next() : uploadError(res, 403, 'Seu perfil não envia material de patrocinador.'));

async function storageGuard(res, fn) {
  try { return await fn(); } catch (err) {
    if (err.code !== 'STORAGE_FULL') throw err;
    await prod.storageFull();
    return res.status(507).json({ ok: false, code: 'storage_full', error: prod.STORAGE_FULL_MSG });
  }
}
async function loadSponsor(req) {
  if (!isIntId(req.params.id)) return null;
  const { rows: [s] } = await db.query('SELECT id, company, stage FROM sponsors WHERE id = $1', [req.params.id]);
  return s || null;
}
async function loadFile(req) {
  if (!isIntId(req.params.id) || !isIntId(req.params.fid)) return null;
  const { rows: [f] } = await db.query('SELECT * FROM sponsor_files WHERE id = $1 AND sponsor_id = $2 AND kind = ANY($3::text[])', [req.params.fid, req.params.id, material.KINDS]);
  return f || null;
}

router.post('/patrocinadores/:id/material/iniciar', writer, wrap(async (req, res) => {
  if (!config.storageConfigured) return uploadError(res, 503, 'Armazenamento (Backblaze) não configurado.');
  const sponsor = await loadSponsor(req);
  if (!sponsor) return uploadError(res, 404, 'Patrocinador não encontrado.');
  if (!material.isOpen(sponsor)) return uploadError(res, 409, 'O material abre quando o patrocinador fecha (Ganho).');
  const kind = String(req.body.kind || '');
  if (!material.KINDS.includes(kind)) return uploadError(res, 400, 'Escolha a pasta do arquivo.');
  const size = Number(req.body.tamanho);
  if (!Number.isSafeInteger(size) || size <= 0) return uploadError(res, 400, 'Arquivo vazio.');
  if (size > material.MAX_FILE) return uploadError(res, 400, 'Arquivo grande demais (limite de 20 GB).');
  // "Substituir": envio que tinha parado sai já; arquivo completo só quando o novo terminar.
  let replacesId = null;
  if (isIntId(req.body.substituir)) {
    const { rows: [old] } = await db.query('SELECT * FROM sponsor_files WHERE id = $1 AND sponsor_id = $2 AND kind = ANY($3::text[])', [req.body.substituir, sponsor.id, material.KINDS]);
    if (old && old.status === 'enviando') await material.cancelUpload(old); else if (old) replacesId = old.id;
  }
  return storageGuard(res, async () => {
    const { file, partSize, totalParts } = await material.startUpload({ sponsor, kind, filename: req.body.nome, contentType: req.body.tipo, size, userId: req.user.id, replacesId });
    res.json({ ok: true, id: file.id, partSize, totalParts });
  });
}));

// O que já está nas pastas (para a janela de envio reconhecer repetidos e envios que pararam no meio).
router.get('/patrocinadores/:id/material/existentes', writer, wrap(async (req, res) => {
  const sponsor = await loadSponsor(req);
  if (!sponsor) return uploadError(res, 404, 'Patrocinador não encontrado.');
  const files = await material.list(sponsor.id);
  const { rows: got } = await db.query('SELECT p.file_id, count(*)::int AS n FROM sponsor_file_parts p JOIN sponsor_files f ON f.id = p.file_id WHERE f.sponsor_id = $1 GROUP BY p.file_id', [sponsor.id]);
  const parts = Object.fromEntries(got.map((p) => [p.file_id, p.n]));
  res.json({
    ok: true,
    files: files.map((f) => ({
      id: f.id, kind: f.kind, label: null, name: f.filename, size: Number(f.size_bytes), status: f.status, stalled: f.stalled,
      parts: parts[f.id] || 0, totalParts: f.status === 'enviando' && f.part_size ? Math.max(1, Math.ceil(Number(f.size_bytes) / f.part_size)) : null,
    })),
  });
}));

async function loadUpload(req, res) {
  const file = await loadFile(req);
  if (!file || file.status !== 'enviando') { uploadError(res, 404, 'Envio não encontrado ou já concluído.'); return null; }
  return file;
}

router.put('/patrocinadores/:id/material/:fid/parte/:n', writer, express.raw({ type: () => true, limit: MAX_PART }), wrap(async (req, res) => {
  const file = await loadUpload(req, res);
  if (!file) return undefined;
  const n = Number.parseInt(req.params.n, 10);
  const total = Math.max(1, Math.ceil(Number(file.size_bytes) / file.part_size));
  if (!Number.isInteger(n) || n < 1 || n > total) return uploadError(res, 400, 'Parte inválida.');
  const expected = n < total ? file.part_size : Number(file.size_bytes) - file.part_size * (total - 1);
  if (!Buffer.isBuffer(req.body) || req.body.length !== expected) return uploadError(res, 400, `A parte ${n} deveria ter ${expected} bytes e chegou com ${Buffer.isBuffer(req.body) ? req.body.length : 0}.`);
  return storageGuard(res, async () => { await material.receivePart(file, n, req.body); res.json({ ok: true }); });
}));

// Envio direto ao Backblaze: o navegador pede o link assinado de cada parte e confirma a parte depois de enviá-la.
router.get('/patrocinadores/:id/material/:fid/urls', writer, wrap(async (req, res) => {
  const file = await loadUpload(req, res);
  if (!file) return undefined;
  return res.set('Cache-Control', 'no-store').json(await directUpload.urls({ key: file.storage_key, uploadId: file.upload_id, size: file.size_bytes, partSize: file.part_size, query: req.query.partes }));
}));
router.post('/patrocinadores/:id/material/:fid/parte/:n/ok', writer, wrap(async (req, res) => {
  const file = await loadUpload(req, res);
  if (!file) return undefined;
  const c = directUpload.confirm({ size: file.size_bytes, partSize: file.part_size, number: req.params.n, body: req.body });
  if (c.error) return uploadError(res, c.status, c.error);
  await material.registerPart(file, Number(req.params.n), c.etag, c.size);
  return res.json({ ok: true });
}));

router.get('/patrocinadores/:id/material/:fid/partes', writer, wrap(async (req, res) => {
  const file = await loadFile(req);
  if (!file) return uploadError(res, 404, 'Arquivo não encontrado.');
  const total = file.part_size ? Math.max(1, Math.ceil(Number(file.size_bytes) / file.part_size)) : 1;
  return res.json({ ok: true, status: file.status, parts: file.status === 'enviando' ? await material.parts(file) : [], size: Number(file.size_bytes), partSize: file.part_size, totalParts: total });
}));

router.post('/patrocinadores/:id/material/:fid/concluir', writer, wrap(async (req, res) => {
  const file = await loadFile(req);
  if (!file) return uploadError(res, 404, 'Arquivo não encontrado.');
  if (file.status === 'pronto') return res.json({ ok: true });
  let result;
  const sent = await storageGuard(res, async () => { result = await material.finishUpload(file); });
  if (!result) return sent;
  if (result.error) return uploadError(res, 409, result.error);
  const f = result.file;
  const what = `${material.TITLE[f.kind]}: ${f.filename}`;
  await sponsorsSvc.addEvent(f.sponsor_id, req.user.id, 'arquivo', result.replaced ? `Material substituído (${what})` : `Material enviado (${what})`);
  await audit(req, 'patrocinador.material_enviado', 'sponsor', f.sponsor_id, { file: f.id, kind: f.kind });
  return res.json({ ok: true, id: f.id });
}));

router.post('/patrocinadores/:id/material/:fid/cancelar', writer, wrap(async (req, res) => {
  const file = await loadFile(req);
  if (file && file.status === 'enviando') await material.cancelUpload(file);
  return res.json({ ok: true });
}));

// Descartar os envios que pararam no meio (libera o espaço que as partes ocupam no Backblaze).
router.post('/patrocinadores/:id/material/descartar-parados', requirePerm('sponsors.write'), wrap(async (req, res) => {
  const sponsor = await loadSponsor(req);
  if (!sponsor) return res.status(404).render('error', { title: 'Não encontrado', message: 'Patrocinador não encontrado.' });
  const stalled = (await material.list(sponsor.id)).filter((f) => f.stalled);
  for (const f of stalled) await material.cancelUpload(f);
  await req.flash('ok', stalled.length ? `${stalled.length} envio${stalled.length > 1 ? 's descartados' : ' descartado'}.` : 'Nenhum envio parado para descartar.');
  return res.redirect(back(sponsor.id));
}));

// A logo principal: a que vai para o media kit e o portal do patrocinador.
router.post('/patrocinadores/:id/arquivos/:fid/principal', requirePerm('sponsors.write'), wrap(async (req, res) => {
  const sponsor = await loadSponsor(req);
  if (!sponsor || !isIntId(req.params.fid)) return res.status(404).render('error', { title: 'Não encontrado', message: 'Arquivo não encontrado.' });
  if (await material.setMain(sponsor.id, Number(req.params.fid))) {
    await sponsorsSvc.addEvent(sponsor.id, req.user.id, 'arquivo', 'Logo principal trocada (media kit e portal)');
    await req.flash('ok', 'Logo principal trocada. É ela que aparece no media kit e no portal.');
  }
  return res.redirect(back(sponsor.id));
}));

// Baixar: um link curto e assinado do Backblaze (arquivo grande não passa inteiro pela memória do servidor).
router.get('/patrocinadores/:id/arquivos/:fid/baixar', requirePerm('sponsors.read'), wrap(async (req, res) => {
  const file = await loadFile(req);
  if (!file || file.status !== 'pronto') return res.status(404).render('error', { title: 'Não encontrado', message: 'Arquivo não encontrado.' });
  return res.set('Cache-Control', 'no-store').redirect(302, await b2.presignGet(file.storage_key, { expires: 900, download: file.filename || `arquivo-${file.id}` }));
}));

module.exports = router;
