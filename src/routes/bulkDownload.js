// Baixar vários de uma vez num ZIP só (baixar.js): material e galeria do episódio, posts e cortes do Conteúdo.
// /baixar.zip?itens=f12,f13,c5,k9&nome=ep012-bastidores — f = arquivo do episódio, c = corte, k = capa/post.
// O ZIP é montado enquanto baixa: cada arquivo sai do Backblaze aos pedaços e vai direto para a resposta (nada fica no disco nem
// inteiro na memória), sem compressão (vídeo e foto já vêm comprimidos). Antes de começar, um HEAD em cada arquivo dá o tamanho
// exato, e o ZIP sai com Content-Length: o navegador mostra o andamento e o tempo que falta.
const express = require('express');
const db = require('../db/pool');
const b2 = require('../services/b2');
const fmt = require('../utils/format');
const { zipStream, zipLength, uniqueNames } = require('../utils/zipStream');
const { requirePerm } = require('../middleware');
const { wrap } = require('../utils/wrap');

const router = express.Router();
const MAX_ITEMS = 500;

// Os mesmos nomes do botão Baixar de cada item (episodes.js, clips.js e covers.js).
const coverName = (c) => `${c.number ? `ep${String(c.number).padStart(3, '0')}` : (c.clip_id ? `corte${c.clip_id}` : 'episodio')}-${c.kind.replace(/_/g, '-')}-${c.position + 1}.jpg`;

function parseItems(raw) {
  const seen = new Set(); const out = [];
  for (const t of String(raw || '').split(',')) {
    const m = t.trim().match(/^([fck])([1-9]\d{0,9})$/);
    if (m && !seen.has(m[0])) { seen.add(m[0]); out.push({ type: m[1], id: Number(m[2]) }); }
  }
  return out.slice(0, MAX_ITEMS);
}

// Itens pedidos que existem e estão prontos, na ordem do pedido: { name, key, when }.
async function resolve(items) {
  const ids = (type) => items.filter((i) => i.type === type).map((i) => i.id);
  const [files, clips, covers] = await Promise.all([
    db.query("SELECT id, filename, storage_key, created_at FROM episode_files WHERE id = ANY($1::int[]) AND status = 'pronto'", [ids('f')]),
    db.query("SELECT id, title, storage_key, created_at FROM episode_clips WHERE id = ANY($1::int[]) AND storage_key IS NOT NULL AND status <> 'enviando'", [ids('c')]),
    db.query('SELECT c.id, c.kind, c.position, c.clip_id, c.storage_key, c.updated_at, e.number FROM episode_covers c LEFT JOIN episodes e ON e.id = c.episode_id WHERE c.id = ANY($1::int[]) AND c.storage_key IS NOT NULL', [ids('k')]),
  ]);
  const by = {
    f: new Map(files.rows.map((r) => [r.id, { name: r.filename, key: r.storage_key, when: r.created_at }])),
    c: new Map(clips.rows.map((r) => [r.id, { name: `${fmt.slugify(r.title) || `corte-${r.id}`}.mp4`, key: r.storage_key, when: r.created_at }])),
    k: new Map(covers.rows.map((r) => [r.id, { name: coverName(r), key: r.storage_key, when: r.updated_at }])),
  };
  return items.map((i) => by[i.type].get(i.id)).filter(Boolean);
}

// Tamanho de cada um direto do Backblaze (o do banco pode não bater, e um byte a mais ou a menos quebraria o ZIP); 6 por vez.
async function withSizes(list) {
  const out = new Array(list.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, list.length) }, async () => {
    while (next < list.length) {
      const i = next; next += 1;
      const head = await b2.headObject(list[i].key);
      out[i] = head ? { ...list[i], size: head.size } : null; // sumiu do armazenamento: fica de fora
    }
  }));
  return out.filter(Boolean);
}

router.get('/baixar.zip', requirePerm('episodes.read'), wrap(async (req, res) => {
  const items = parseItems(req.query.itens);
  const list = items.length ? await withSizes(await resolve(items)) : [];
  if (!list.length) return res.status(404).render('error', { title: 'Nada para baixar', message: 'Os arquivos marcados não estão mais disponíveis.' });
  const names = uniqueNames(list.map((f) => f.name));
  list.forEach((f, i) => { f.name = names[i]; });
  const zipName = `${fmt.slugify(String(req.query.nome || '')).slice(0, 80) || 'pulso-arquivos'}.zip`;
  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${zipName}"`,
    'Content-Length': String(zipLength(list)),
    'Cache-Control': 'no-store',
  });
  const stop = new AbortController();
  res.on('close', () => stop.abort()); // fechou a aba ou cancelou o download: para de ler do Backblaze
  const zip = zipStream(res);
  try {
    for (const f of list) {
      const obj = await b2.getObject(f.key, { signal: stop.signal });
      if (!obj) throw new Error(`${f.name} sumiu do armazenamento no meio do ZIP`);
      await zip.addStream(f.name, f.size, obj.body, new Date(f.when));
    }
    await zip.end();
  } catch (err) {
    if (err.message !== 'cancelado' && !stop.signal.aborted) console.error(`[baixar.zip] ${req.user.id}:`, err.message);
    res.destroy(); // ZIP incompleto: o navegador mostra o download como falho, em vez de entregar um arquivo quebrado
  }
}));

module.exports = router;
