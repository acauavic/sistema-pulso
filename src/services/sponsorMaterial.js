// Material do patrocinador (aba Material da página do patrocinador): as pastas Logos, Moldura, QR Code e Material da marca, que abrem
// quando o patrocinador fecha (Ganho, Ativo e, depois de encerrado, Inativo). O envio é o mesmo dos episódios: em partes, direto ao
// Backblaze e retomando de onde parou (a fila src/public/uploads.js fala com as rotas /patrocinadores/:id/material/...).
// A logo principal é a do media kit e do portal (sem nenhuma marcada, vale a mais nova); moldura e QR Code que chegam viram o arquivo
// do entregável. Quem vê patrocinadores (o editor também) vê e baixa; quem edita patrocinadores envia, organiza e apaga.
const crypto = require('crypto');
const db = require('../db/pool');
const b2 = require('./b2');
const prod = require('./production');

const FOLDERS = [
  { kind: 'logo', title: 'Logos', ic: 'image', hint: 'As versões da marca (horizontal, vertical, negativo). A principal vai para o media kit e o portal.' },
  { kind: 'moldura', title: 'Moldura', ic: 'frame', hint: 'A moldura do episódio. A mais nova vai para o entregável e o portal.' },
  { kind: 'qrcode', title: 'QR Code', ic: 'qr-code', hint: 'O QR Code da tela. O mais novo vai para o entregável e o portal.' },
  { kind: 'material', title: 'Material da marca', ic: 'paperclip', hint: 'Manual da marca, apresentações, peças e vídeos de inserção.' },
];
const KINDS = FOLDERS.map((f) => f.kind);
const TITLE = Object.fromEntries(FOLDERS.map((f) => [f.kind, f.title]));
const OPEN_STAGES = ['ganho', 'ativo', 'inativo'];
const isOpen = (sponsor) => Boolean(sponsor) && OPEN_STAGES.includes(sponsor.stage);
const DELIVERABLE = { moldura: 'moldura', qrcode: 'qr_code' };
const MAX_FILE = 20 * 1024 * prod.MB; // 20 GB: um vídeo de inserção longo em alta cabe

// Os arquivos das pastas (os do formulário do patrocinador também: a logo dele cai em Logos). Áudios do briefing ficam de fora.
async function list(sponsorId) {
  const { rows } = await db.query(`SELECT f.*, u.name AS uploader_name FROM sponsor_files f LEFT JOIN users u ON u.id = f.uploaded_by
    WHERE f.sponsor_id = $1 AND f.kind = ANY($2::text[]) ORDER BY f.created_at DESC, f.id DESC`, [sponsorId, KINDS]);
  const ready = rows.filter((f) => f.status === 'pronto');
  const main = ready.find((f) => f.kind === 'logo' && f.is_main) || ready.find((f) => f.kind === 'logo') || null;
  return rows.map((f) => ({ ...f, stalled: prod.isStalled(f), main: Boolean(main && main.id === f.id) }));
}

// As pastas com os arquivos, na ordem fixa (pasta vazia também aparece: é onde a pessoa sabe o que falta).
function folders(files) {
  return FOLDERS.map((g) => {
    const items = files.filter((f) => f.kind === g.kind).sort((x, y) => Number(y.main) - Number(x.main)); // a logo principal primeiro
    return { ...g, items, ready: items.filter((f) => f.status === 'pronto'), size: items.reduce((n, f) => n + Number(f.size_bytes || 0), 0) };
  });
}

async function startUpload({ sponsor, kind, filename, contentType, size, userId, replacesId = null }) {
  const type = String(contentType || 'application/octet-stream').split(';')[0].trim().toLowerCase().slice(0, 100) || 'application/octet-stream';
  const name = prod.safeName(filename);
  const ext = (name.match(/\.([A-Za-z0-9]{1,6})$/)?.[1] || 'bin').toLowerCase();
  const key = await b2.keyFor('patrocinadores', sponsor.id, `${kind}-${crypto.randomBytes(8).toString('hex')}.${ext}`);
  const partSize = prod.partSizeFor(size);
  const uploadId = await b2.createMultipart(key, type);
  const { rows: [file] } = await db.query(
    `INSERT INTO sponsor_files (sponsor_id, kind, storage_key, filename, content_type, size_bytes, status, part_size, upload_id, uploaded_by, replaces_id)
     VALUES ($1,$2,$3,$4,$5,$6,'enviando',$7,$8,$9,$10) RETURNING *`,
    [sponsor.id, kind, key, name, type, size, partSize, uploadId, userId, replacesId]);
  return { file, partSize, totalParts: Math.max(1, Math.ceil(size / partSize)) };
}

async function savePart(file, number, etag, size) {
  await db.query(
    `INSERT INTO sponsor_file_parts (file_id, part_number, etag, size_bytes) VALUES ($1,$2,$3,$4)
     ON CONFLICT (file_id, part_number) DO UPDATE SET etag = EXCLUDED.etag, size_bytes = EXCLUDED.size_bytes`, [file.id, number, etag, size]);
  await db.query('UPDATE sponsor_files SET last_part_at = now() WHERE id = $1', [file.id]);
}
// Parte que passou pelo servidor (quando o navegador não consegue mandar direto ao bucket).
async function receivePart(file, number, body) {
  const etag = await b2.uploadPart(file.storage_key, file.upload_id, number, body);
  await savePart(file, number, etag, body.length);
}
// Parte enviada direto pelo navegador ao bucket: só registra o que ele informou (o bucket confere o ETag ao fechar o arquivo).
const registerPart = savePart;

async function parts(file) {
  return (await db.query('SELECT part_number FROM sponsor_file_parts WHERE file_id = $1 ORDER BY part_number', [file.id])).rows.map((r) => r.part_number);
}

// Confere as partes, fecha o objeto no bucket e põe o arquivo na pasta: moldura e QR Code viram o arquivo do entregável; a primeira
// logo vira a principal; "substituir" tira o antigo só agora que o novo chegou inteiro.
async function finishUpload(file) {
  const { rows: got } = await db.query('SELECT part_number, etag, size_bytes FROM sponsor_file_parts WHERE file_id = $1 ORDER BY part_number', [file.id]);
  const total = Math.max(1, Math.ceil(Number(file.size_bytes) / file.part_size));
  if (got.length !== total) return { error: `Faltam partes: recebi ${got.length} de ${total}.` };
  for (let i = 0; i < got.length; i += 1) if (got[i].part_number !== i + 1) return { error: `A parte ${i + 1} não chegou.` };
  const sum = got.reduce((n, p) => n + Number(p.size_bytes), 0);
  if (sum !== Number(file.size_bytes)) return { error: `O tamanho recebido (${sum} bytes) não bate com o do arquivo (${file.size_bytes}).` };
  await b2.completeMultipart(file.storage_key, file.upload_id, got.map((p) => ({ number: p.part_number, etag: p.etag })));
  const { rows: [done] } = await db.query(
    "UPDATE sponsor_files SET status = 'pronto', upload_id = NULL, completed_at = now(), replaces_id = NULL WHERE id = $1 RETURNING *", [file.id]);
  await db.query('DELETE FROM sponsor_file_parts WHERE file_id = $1', [file.id]);
  let replaced = null;
  if (file.replaces_id) {
    const { rows: [old] } = await db.query("SELECT * FROM sponsor_files WHERE id = $1 AND sponsor_id = $2 AND id <> $3 AND status = 'pronto'", [file.replaces_id, file.sponsor_id, file.id]);
    if (old) {
      if (old.is_main) await db.query('UPDATE sponsor_files SET is_main = true WHERE id = $1', [done.id]);
      await deleteFile(old); replaced = old;
    }
  }
  if (DELIVERABLE[done.kind]) await db.query('UPDATE sponsor_deliverables SET file_id = $2 WHERE sponsor_id = $1 AND kind = $3', [done.sponsor_id, done.id, DELIVERABLE[done.kind]]);
  if (done.kind === 'logo') {
    await db.query(`UPDATE sponsor_files SET is_main = true WHERE id = $1
      AND NOT EXISTS (SELECT 1 FROM sponsor_files x WHERE x.sponsor_id = $2 AND x.kind = 'logo' AND x.is_main AND x.status = 'pronto' AND x.id <> $1)`, [done.id, done.sponsor_id]);
  }
  await db.query('UPDATE sponsors SET updated_at = now() WHERE id = $1', [done.sponsor_id]);
  return { file: done, replaced };
}

async function deleteFile(file) {
  await db.query('DELETE FROM sponsor_files WHERE id = $1', [file.id]);
  if (file.upload_id) await b2.abortMultipart(file.storage_key, file.upload_id).catch(() => {});
  await b2.deleteObject(file.storage_key).catch((err) => console.error('Falha ao apagar arquivo do patrocinador:', err.message));
}

async function cancelUpload(file) {
  if (file.upload_id) await b2.abortMultipart(file.storage_key, file.upload_id).catch((err) => console.error('Falha ao cancelar envio:', err.message));
  await db.query('DELETE FROM sponsor_files WHERE id = $1', [file.id]);
}

// A logo principal (a do media kit e do portal): só uma por patrocinador.
async function setMain(sponsorId, fileId) {
  const { rows: [f] } = await db.query("SELECT id FROM sponsor_files WHERE id = $1 AND sponsor_id = $2 AND kind = 'logo' AND status = 'pronto'", [fileId, sponsorId]);
  if (!f) return false;
  await db.query("UPDATE sponsor_files SET is_main = (id = $2) WHERE sponsor_id = $1 AND kind = 'logo'", [sponsorId, fileId]);
  return true;
}

module.exports = { FOLDERS, KINDS, TITLE, OPEN_STAGES, isOpen, MAX_FILE, list, folders, startUpload, receivePart, registerPart, parts, finishUpload, cancelUpload, deleteFile, setMain };
