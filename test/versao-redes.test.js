const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const h = require('./helpers');
const sr = require('../src/services/socialRendition');
const views = require('../src/services/videoViews');
const media = require('../src/services/media');

describe('Versão para as redes (1080p) do corte pesado', () => {
  let app; let ep;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const real = { inspect: views.deps.inspect, transcode: views.deps.transcode, available: media.available };
  let probe = null; const made = [];
  const clip = async (title, w, hgt, size, ms = 51_000) => (await q(
    "INSERT INTO episode_clips (title, source, status, episode_id, storage_key, size_bytes, content_type, width, height, duration_ms) VALUES ($1, 'upload', 'pronto', $2, $3, $4, 'video/mp4', $5, $6, $7) RETURNING *",
    [title, ep.id, `pp/cortes/${title}.mp4`, size, w, hgt, ms]))[0];

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    [ep] = await q("INSERT INTO episodes (number, title, status) VALUES (12, 'Conversa', 'publicado') RETURNING *");
    media.available = async () => true;
    views.deps.inspect = async () => probe;
    views.deps.transcode = async ({ output, opts }) => { made.push(opts); fs.writeFileSync(output, Buffer.alloc(2048, 1)); };
  });
  after(async () => { Object.assign(views.deps, { inspect: real.inspect, transcode: real.transcode }); media.available = real.available; await app.close(); await h.db.close(); });

  it('quem é pesado: 4K, ou 1080p com taxa alta; 1080p leve vai como está', async () => {
    assert.equal(sr.heavy({ storage_key: 'k', width: 2160, height: 3840, size_bytes: 544988938, duration_ms: 51585 }), true, '4K de 545 MB');
    assert.equal(sr.heavy({ storage_key: 'k', width: 1080, height: 1920, size_bytes: 60e6, duration_ms: 50_000 }), false, '1080p a ~10 Mbps');
    assert.equal(sr.heavy({ storage_key: 'k', width: 1080, height: 1920, size_bytes: 120e6, duration_ms: 50_000 }), true, '1080p a ~19 Mbps');
    assert.equal(sr.heavy({ storage_key: null, width: 2160, height: 3840 }), false);
  });

  it('pedido, cópia em 1080p até 10 Mbps e depois a cópia pronta; arquivo que já servia fica como original', async () => {
    const big = await clip('c4k', 2160, 3840, 544988938);
    assert.deepEqual(await sr.pick(big), { waiting: true });
    const [row] = await q('SELECT * FROM social_renditions WHERE source_key = $1', [big.storage_key]);
    assert.equal(row.status, 'pendente');
    const [job] = await q("SELECT * FROM jobs WHERE kind = 'video_redes' AND ref_id = $1", [row.id]);
    assert.ok(job, 'pedido na fila');
    probe = { width: 2160, height: 3840, codec: 'hevc', mbps: 84.5, duration: 51.6, hasAudio: true };
    const out = await sr.run({ ref_id: row.id }, { update: async () => {} });
    assert.equal(out.size, 2048);
    assert.deepEqual(made.at(-1), { shortSide: 1080, crf: 20, maxKbps: 10000, audioKbps: 192, level: '4.2' });
    const picked = await sr.pick(big);
    assert.match(picked.key, /^pp\/cortes\/c4k-redes-[0-9a-f]{8}\.mp4$/); assert.equal(picked.size, 2048);
    assert.ok(h.b2Store.has(picked.key), 'a cópia está no armazenamento');

    const ok = await clip('c1080', 1440, 2560, 50e6); // pesado pelo registro, mas o arquivo é H.264 leve
    await sr.pick(ok);
    const [r2] = await q('SELECT id FROM social_renditions WHERE source_key = $1', [ok.storage_key]);
    probe = { width: 1080, height: 1920, codec: 'h264', mbps: 8, duration: 51, hasAudio: true };
    assert.deepEqual(await sr.run({ ref_id: r2.id }, { update: async () => {} }), { original: true });
    assert.equal(await sr.pick(ok), null, 'vai o original');
  });

  it('a conferência antes do horário pede a cópia e não alarma a equipe; a limpeza apaga cópia de corte apagado', async () => {
    const publishing = require('../src/services/publishing');
    const big = await clip('agendado4k', 2160, 3840, 500e6);
    const [pub] = await q("INSERT INTO episode_publications (episode_id, clip_id, media, platforms, title, status, scheduled_at, provider) VALUES ($1, $2, 'video', '{instagram}', 'Corte pesado', 'agendado', now() + interval '1 hour', 'outstand') RETURNING *", [ep.id, big.id]);
    const pc = await publishing.precheckScheduled();
    assert.equal(pc.ok, true);
    const [now] = await q('SELECT options FROM episode_publications WHERE id = $1', [pub.id]);
    assert.equal(now.options.precheck.waiting, true);
    assert.equal((await q('SELECT status FROM social_renditions WHERE source_key = $1', [big.storage_key]))[0].status, 'pendente');
    assert.equal((await q("SELECT count(*)::int n FROM notifications WHERE title LIKE 'Atenção antes de publicar%'"))[0].n, 0);

    const [c] = await q("SELECT id, storage_key FROM episode_clips WHERE title = 'c4k'");
    const [r] = await q('SELECT rendition_key FROM social_renditions WHERE source_key = $1', [c.storage_key]);
    await q('DELETE FROM episode_clips WHERE id = $1', [c.id]);
    await q("UPDATE social_renditions SET created_at = now() - interval '2 days'");
    const t = await sr.tick();
    assert.ok(t.removed >= 1); assert.ok(!h.b2Store.has(r.rendition_key), 'a cópia saiu do armazenamento');
  });
});
