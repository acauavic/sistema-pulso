const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('./helpers');
const M = require('../src/services/postMetrics');
const bulk = require('../src/services/bulkPublish');
const A = require('../src/services/commentAutomation');

describe('Números dos posts, piloto da semana e palavra no direct', () => {
  const as = {}; let app; const eps = {}; const clips = {};
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const realFetch = global.fetch; const calls = [];
  const analytics = {
    op1: { success: true, post: { id: 'op1' }, metrics_by_account: [{ social_account: { network: 'instagram' }, platform_post_url: 'https://www.instagram.com/reel/a/', published_at: '2026-11-10T12:00:00Z', metrics: { views: 12000, likes: 800, comments: 40, shares: 30, reach: 9000, engagement_rate: 7.2 } }, { social_account: { network: 'tiktok' }, metrics: { views: 3000, likes: 100, comments: 5, shares: 2 } }] },
    op2: { success: true, post: { id: 'op2' }, metrics_by_account: [{ social_account: { network: 'instagram' }, metrics: { views: 900, likes: 30, comments: 2, shares: 1 } }] },
    op3: { success: true, post: { id: 'op3' }, metrics_by_account: [{ social_account: { network: 'instagram' }, metrics: { views: 4000, likes: 200, comments: 9, shares: 4 } }] },
  };

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    await h.createUser({ name: 'Gestão', email: 'gestao@t.com', role: 'gestao' }); as.gestao = h.client(app.base); await as.gestao.login('gestao@t.com');
    Object.assign(h.config.outstand, { key: 'ost_teste', base: 'https://outstand.test', live: true }); h.config.outstandConfigured = true;
    global.fetch = async (url, opts = {}) => {
      const s = String(url);
      if (!s.startsWith('https://outstand.test')) return realFetch(url, opts);
      const method = opts.method || 'GET'; const path = s.replace('https://outstand.test', ''); const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ method, path, body });
      let m;
      if (method === 'GET' && (m = path.match(/^\/v1\/posts\/([^/]+)\/analytics$/))) return analytics[m[1]] ? Response.json(analytics[m[1]]) : Response.json({ error: 'Post not found' }, { status: 404 });
      if (method === 'POST' && (m = path.match(/^\/v1\/conversations\/([^/]+)\/messages$/))) return Response.json({ success: true, message: { id: 'out1', status: 'pending' } }, { status: 202 });
      if (method === 'GET' && path.startsWith('/v1/social-accounts?')) return Response.json({ success: true, data: [{ id: 'IG1', network: 'instagram', username: 'podcastpulso', isActive: 1 }] });
      return Response.json({ error: 'sem rota' }, { status: 404 });
    };
    // três episódios com cortes prontos (o 5 é o mais recente)
    for (const [num, aired] of [[3, '2026-07-10'], [4, '2026-07-17'], [5, '2026-07-24']]) {
      [eps[num]] = await q("INSERT INTO episodes (number, title, status, aired_on) VALUES ($1, $2, 'publicado', $3) RETURNING *", [num, `Episódio ${num}`, aired]);
      clips[num] = [];
      for (let i = 1; i <= 3; i += 1) {
        const [c] = await q("INSERT INTO episode_clips (title, post_title, cover_texts, source, status, episode_id, storage_key, duration_ms) VALUES ($1, $2, $3, 'upload', 'pronto', $4, 'pp/x.mp4', 30000) RETURNING *",
          [`Corte ${i}`, `Título ${num}.${i}`, JSON.stringify([`Capa ${num}.${i}`]), eps[num].id]);
        clips[num].push(c);
      }
    }
    // três publicados pela Outstand (com números) e um feito por fora (sem como ler)
    const pub = async (clip, ref, title) => (await q("INSERT INTO episode_publications (episode_id, clip_id, platforms, title, description, status, results) VALUES ($1, $2, '{instagram,tiktok}', $3, 'Primeira linha da legenda.\n\nSiga o Pulso.', 'publicado', $4) RETURNING id",
      [clip.episode_id, clip.id, title, JSON.stringify(ref ? [{ platform: 'instagram', ok: true, provider: 'outstand', ref }, { platform: 'tiktok', ok: true, provider: 'outstand', ref }] : [{ platform: 'instagram', ok: true, manual: true, url: 'https://www.instagram.com/reel/m/' }])]))[0].id;
    await pub(clips[3][0], 'op1', 'Telas roubam a infância'); await pub(clips[4][0], 'op2', 'Mounjaro para sempre?'); await pub(clips[5][0], 'op3', 'Menopausa não é o fim'); await pub(clips[5][1], null, 'Postado por fora');
  });
  after(async () => { global.fetch = realFetch; h.config.outstand.live = false; await app.close(); await h.db.close(); });

  it('lê os números da Outstand (uma consulta por post serve todas as redes) e soma por corte', async () => {
    assert.deepEqual(M.fromOutstand(analytics.op1).map((x) => [x.platform, x.views]), [['instagram', 12000], ['tiktok', 3000]]);
    const r = await M.refresh();
    assert.equal(r.saved, 4);
    assert.equal(calls.filter((c) => c.path.endsWith('/analytics')).length, 3, 'o post feito por fora não é consultado');
    const sum = await M.forClips([clips[3][0].id, clips[5][1].id]);
    assert.equal(sum[clips[3][0].id].views, 15000); assert.equal(sum[clips[3][0].id].nets, 2); assert.equal(sum[clips[5][1].id], undefined);
    await M.refresh();
    assert.equal(calls.filter((c) => c.path.endsWith('/analytics')).length, 3, 'atualizado há menos de 6 h: não consulta de novo');
    const top = await M.top();
    assert.deepEqual(top.map((t) => t.pub_title), ['Telas roubam a infância', 'Menopausa não é o fim', 'Mounjaro para sempre?']);
  });

  it('a IA de copy recebe os mais vistos como referência (só com 3 ou mais com números)', async () => {
    M.resetExamples();
    const ex = await M.examples();
    assert.match(ex, /MAIS foram vistos/); assert.match(ex, /15 mil views · título: "Telas roubam a infância" · capa: "Capa 3\.1"/);
    assert.match(ex, /legenda começa: "Primeira linha da legenda\."/);
    const prompt = require('../src/services/clips').textsPrompt({ transcript: 'fala de teste '.repeat(4), examples: ex });
    assert.match(prompt, /Telas roubam a infância/);
    await q('DELETE FROM post_metrics WHERE publication_id IN (SELECT id FROM episode_publications WHERE title <> $1)', ['Telas roubam a infância']);
    M.resetExamples();
    assert.equal(await M.examples(), '', 'com menos de 3, não entra');
  });

  it('piloto da semana: mistura os episódios (o mais recente primeiro) e só pega o que ainda não saiu', async () => {
    const picks = await bulk.weekPicks(14);
    assert.deepEqual(picks, [clips[5][2].id, clips[4][1].id, clips[3][1].id, clips[4][2].id, clips[3][2].id], 'um de cada episódio por vez, do mais recente; 5 ainda não saíram');
    assert.ok(!picks.includes(clips[3][0].id) && !picks.includes(clips[5][1].id), 'publicados ficam de fora');
    assert.equal(bulk.nextMonday('2026-11-17'), '2026-11-23'); assert.equal(bulk.nextMonday('2026-11-23'), '2026-11-23');
    const saved = await bulk.savePilot({ platforms: ['instagram', 'tiktok'], por_dia: '2', de: '09:00', ate: '21:00', teste_por_dia: '1', teste_modo: 'manual' });
    assert.deepEqual(saved.settings.platforms, ['instagram', 'tiktok']); assert.equal((await bulk.pilotSettings()).perDay, 2);
    const page = (await as.gestao.get('/conteudo/semana')).text;
    assert.match(page, /Agenda da semana|Agenda de/);
    assert.equal((page.match(/name="ids" value="\d+"/g) || []).length, 5, 'os 5 que ainda não saíram, 2 por dia');
    assert.equal(await bulk.weeklyNotice(new Date('2026-11-18T12:00:00Z')), null, 'quarta: não avisa');
    const n = await bulk.weeklyNotice(new Date('2026-11-23T12:00:00Z'));
    assert.equal(n.picks, 5);
    assert.equal((await q("SELECT count(*)::int n FROM notifications WHERE url = '/conteudo/semana'"))[0].n, 1);
    await bulk.weeklyNotice(new Date('2026-11-23T13:00:00Z'));
    assert.equal((await q("SELECT count(*)::int n FROM notifications WHERE url = '/conteudo/semana'"))[0].n, 1, 'uma vez por semana');
  });

  it('palavra no direct: a mensagem chega pela Outstand e a resposta sai na própria conversa', async () => {
    await as.gestao.act('/integracoes/outstand/segredo', {}, { from: '/integracoes' });
    const secret = (await A.state()).secret;
    await as.gestao.act('/social/automacoes', { name: 'Direct EPISODIO', trigger: 'direct', keywords: 'episodio', message: 'Aqui está: {canal}' }, { from: '/social/automacoes' });
    const [rule] = await q("SELECT * FROM social_rules WHERE name = 'Direct EPISODIO'");
    assert.equal(rule.provider, 'outstand');
    await q("UPDATE social_rules SET active = true, active_since = now() WHERE id = $1", [rule.id]);
    await A.setLinks({ youtube_channel: 'https://youtube.com/@pulso' });
    const raw = JSON.stringify({ event: 'message.received', timestamp: new Date().toISOString(), data: { conversationId: 'cv9', messageId: 'mm1', orgId: 'o', network: 'instagram', content: 'Quero o EPISÓDIO', senderId: 's1', sentAt: new Date().toISOString(), attachments: [], sender: { username: 'fa' } } });
    const sig = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
    const send = () => realFetch(`${app.base}/webhooks/outstand`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-outstand-signature': sig }, body: raw });
    assert.equal((await send()).status, 200); assert.equal((await send()).status, 200);
    assert.equal((await q("SELECT count(*)::int n FROM social_inbox WHERE message_id = 'mm1'"))[0].n, 1);
    const [job] = await q("SELECT ref_id FROM jobs WHERE kind = 'direct_recebido'");
    await A.handleDirect({ ref_id: job.ref_id });
    const sent = calls.filter((c) => c.path === '/v1/conversations/cv9/messages');
    assert.equal(sent.length, 1); assert.equal(sent[0].body.content, 'Aqui está: https://youtube.com/@pulso');
    assert.equal((await q("SELECT status FROM social_events WHERE external_id = 'mm1'"))[0].status, 'enviado');
  });
});
