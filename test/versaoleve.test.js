const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const h = require('./helpers');
const vv = require('../src/services/videoViews');

describe('Versão leve dos vídeos: assistir sem travar, original para baixar e publicar', () => {
  let app; let gestao; let ep; let clip; let file;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const noop = { update: async () => {} };
  const where = async (who, path) => { const r = await who.get(path); return decodeURIComponent(r.location || ''); };
  const real = { ...vv.deps };
  let probes = {};
  before(async () => {
    await h.resetDb(); app = await h.startServer();
    const u = await h.createUser({ name: 'Gil Gestão', email: 'g@leve.com', role: 'gestao' }); gestao = h.client(app.base); await gestao.login('g@leve.com');
    [{ id: ep }] = await q("INSERT INTO episodes (number, title, status) VALUES (20, 'Conversa', 'em_revisao') RETURNING id");
    [file] = await q("INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, status, version, uploaded_by, content_type) VALUES ($1,'editado','ep20.mp4',12000000000,'pp/episodios/20/editado-abc.mp4','pronto',1,$2,'video/mp4') RETURNING *", [ep, u.id]);
    [clip] = await q("INSERT INTO episode_clips (episode_id, title, status, source, storage_key, duration_ms, created_by) VALUES ($1,'Corte 4K','pronto','upload','pp/cortes/1/video-4k.mp4',58000,$2) RETURNING *", [ep, u.id]);
    vv.deps.inspect = async (url) => probes[new URL(url).pathname.replace(/^\/test-bucket\//, '')] || { duration: 58, mbps: 90, codec: 'h264', width: 2160, height: 3840, hasAudio: true };
    vv.deps.transcode = async ({ output, onProgress }) => { onProgress?.(50); fs.writeFileSync(output, Buffer.alloc(300 * 1024, 1)); };
  });
  after(async () => { Object.assign(vv.deps, real); await app.close(); await h.db.close(); });

  it('o player toca o original enquanto a versão leve não existe', async () => {
    assert.match(await where(gestao, `/cortes/${clip.id}/video`), /\/pp\/cortes\/1\/video-4k\.mp4\?/);
    assert.doesNotMatch((await gestao.get(`/cortes/${clip.id}`)).text, /Ver no original/);
  });

  it('pede uma vez só, mesmo chamado de novo', async () => {
    const id = await vv.ensure(clip.storage_key);
    assert.ok(id);
    assert.equal(await vv.ensure(clip.storage_key), null);
    assert.equal((await q("SELECT count(*)::int AS n FROM jobs WHERE kind = 'video_leve'"))[0].n, 1);
  });

  it('original pesado (4K a 90 Mbps): gera a versão leve e envia em partes para o Backblaze', async () => {
    const [v] = await q('SELECT * FROM video_views WHERE source_key = $1', [clip.storage_key]);
    const r = await vv.run({ ref_id: v.id }, noop);
    assert.equal(r.size, 300 * 1024);
    const [done] = await q('SELECT * FROM video_views WHERE id = $1', [v.id]);
    assert.equal(done.status, 'pronto'); assert.match(done.view_key, /^pp\/cortes\/1\/video-4k-leve-[0-9a-f]{8}\.mp4$/);
    assert.equal(Number(done.source_mbps), 90);
    assert.ok(h.b2Store.has(done.view_key), 'a versão leve está no bucket');
    assert.equal((await vv.run({ ref_id: v.id }, noop)).skipped, true, 'rodar de novo não refaz');
  });

  it('assistir toca a leve; "original" e baixar entregam o arquivo enviado', async () => {
    assert.match(await where(gestao, `/cortes/${clip.id}/video`), /video-4k-leve-[0-9a-f]{8}\.mp4\?.*response-content-type=video\/mp4/);
    assert.match(await where(gestao, `/cortes/${clip.id}/video?original=1`), /\/video-4k\.mp4\?/);
    const down = await where(gestao, `/cortes/${clip.id}/video?baixar=1`);
    assert.match(down, /\/video-4k\.mp4\?/); assert.match(down, /attachment/);
    const page = (await gestao.get(`/cortes/${clip.id}`)).text;
    assert.match(page, /Versão leve · 720p/); assert.match(page, /data-video-swap="clip-video">Ver no original/);
  });

  it('episódio: a revisão toca a leve quando fica pronta, com "ver no original"; baixar continua o original', async () => {
    probes['pp/episodios/20/editado-abc.mp4'] = { duration: 5086, mbps: 19.3, codec: 'h264', width: 1920, height: 1080, hasAudio: true };
    const id = await vv.ensure(file.storage_key);
    assert.match(await where(gestao, `/episodios/${ep}/arquivos/${file.id}/ver`), /editado-abc\.mp4\?/);
    await vv.run({ ref_id: id }, noop);
    assert.match(await where(gestao, `/episodios/${ep}/arquivos/${file.id}/ver`), /editado-abc-leve-[0-9a-f]{8}\.mp4\?/);
    assert.match(await where(gestao, `/episodios/${ep}/arquivos/${file.id}/ver?original=1`), /editado-abc\.mp4\?/);
    assert.match(await where(gestao, `/episodios/${ep}/arquivos/${file.id}/baixar`), /editado-abc\.mp4\?.*attachment/);
    assert.match((await gestao.get(`/episodios/${ep}`)).text, /data-video-swap="review-video">Ver no original/);
  });

  it('original que já é leve (1080p, H.264, até 6 Mbps) não ganha cópia: toca ele mesmo', async () => {
    const [c2] = await q("INSERT INTO episode_clips (title, status, source, storage_key) VALUES ('Leve','pronto','upload','pp/cortes/2/leve.mp4') RETURNING *");
    probes['pp/cortes/2/leve.mp4'] = { duration: 43, mbps: 4.2, codec: 'h264', width: 1080, height: 1920, hasAudio: true };
    const id = await vv.ensure(c2.storage_key);
    const r = await vv.run({ ref_id: id }, noop);
    assert.equal(r.original, true);
    assert.equal((await q('SELECT status, view_key FROM video_views WHERE id = $1', [id]))[0].status, 'original');
    assert.match(await where(gestao, `/cortes/${c2.id}/video`), /\/cortes\/2\/leve\.mp4\?/);
  });

  it('vídeo que não abre fica com erro, sem quebrar o player', async () => {
    const [c3] = await q("INSERT INTO episode_clips (title, status, source, storage_key) VALUES ('Quebrado','pronto','upload','pp/cortes/3/x.mp4') RETURNING *");
    const before0 = vv.deps.inspect; vv.deps.inspect = async () => { throw new Error('moov atom not found'); };
    const id = await vv.ensure(c3.storage_key);
    await vv.run({ ref_id: id }, noop);
    vv.deps.inspect = before0;
    assert.equal((await q('SELECT status FROM video_views WHERE id = $1', [id]))[0].status, 'erro');
    assert.match(await where(gestao, `/cortes/${c3.id}/video`), /\/cortes\/3\/x\.mp4\?/);
  });

  it('a rotina pede a dos vídeos sem versão (mais novos primeiro) e apaga a de arquivos que saíram', async () => {
    await q("INSERT INTO episode_clips (title, status, source, storage_key, created_at) VALUES ('Antigo','pronto','upload','pp/cortes/4/a.mp4', now() - interval '3 days'), ('Novo','pronto','upload','pp/cortes/5/b.mp4', now())");
    const r = await vv.tick({ limit: 1 });
    assert.equal(r.asked, 1);
    assert.equal((await q("SELECT count(*)::int AS n FROM video_views WHERE source_key = 'pp/cortes/5/b.mp4'"))[0].n, 1, 'o mais novo primeiro');
    // o corte saiu do sistema: a versão leve dele vai embora
    const [{ view_key: key }] = await q('SELECT view_key FROM video_views WHERE source_key = $1', [clip.storage_key]);
    await q('DELETE FROM episode_clips WHERE id = $1', [clip.id]);
    await q("UPDATE video_views SET created_at = now() - interval '2 days' WHERE source_key = $1", [clip.storage_key]);
    const r2 = await vv.tick({ limit: 0 });
    assert.ok(r2.removed >= 1);
    assert.equal(h.b2Store.has(key), false);
    assert.equal((await q('SELECT count(*)::int AS n FROM video_views WHERE source_key = $1', [clip.storage_key]))[0].n, 0);
  });

  it('a conversão tem pista própria: não segura cortes, finalização nem transcrição', async () => {
    assert.ok((await q("SELECT count(*)::int AS n FROM jobs WHERE kind = 'video_leve' AND status = 'queued'"))[0].n > 0);
    assert.equal(await require('../src/services/jobs').runNext({ lane: 'pesada' }), null, 'a pista pesada não pega a versão leve');
  });

  it('o comando do FFmpeg: 720p no lado menor, H.264 com teto de 3 Mbps, quadro-chave a cada 2 s e índice no começo', () => {
    const a = vv.ffmpegArgs('https://x/y.mp4', '/tmp/o.mp4', true).join(' ');
    assert.match(a, /min\(720,iw\)/); assert.match(a, /-c:v libx264/); assert.match(a, /-maxrate 3000k/); assert.match(a, /-g 60/); assert.match(a, /\+faststart/); assert.match(a, /-reconnect 1/);
  });
});
