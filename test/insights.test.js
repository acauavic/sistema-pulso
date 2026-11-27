// Insights: cada rede lida no provedor em que está conectada (Outstand e Zernio simulados com respostas no formato real).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const config = require('../src/config');
const settings = require('../src/services/settings');
const ost = require('../src/services/outstand');
const zn = require('../src/services/zernio');
const insights = require('../src/services/socialInsights');

describe('Insights das redes por provedor', () => {
  let app; let prod;
  const realFetch = global.fetch;
  const hits = [];
  const saved = {};
  const count = (re) => hits.filter((u) => re.test(u)).length;

  before(async () => {
    Object.assign(saved, { ok: config.outstand.key, okc: config.outstandConfigured, zk: config.zernio.key, zkc: config.zernioConfigured });
    config.outstand.key = 'teste-outstand'; config.outstandConfigured = true;
    config.zernio.key = 'teste-zernio'; config.zernioConfigured = true;
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.startsWith(config.outstand.base) || u.startsWith(config.zernio.base)) hits.push(u);
      if (u.startsWith(`${config.outstand.base}/v1/social-accounts?`)) {
        return Response.json({ data: [{ id: 'IG1', network: 'instagram', username: 'podcastpulso', isActive: true }, { id: 'TT1', network: 'tiktok', username: 'podcast.pulso', isActive: true }, { id: 'X1', network: 'x', username: 'pulsox', isActive: true }] });
      }
      if (u.includes('/v1/social-accounts/IG1/metrics')) {
        return Response.json({ success: true, data: { network: 'instagram', followers_count: 6386, following_count: 91, posts_count: 209,
          engagement: { views: 489171, likes: 11729, comments: 270, shares: 1833, saves: 1301, reach: 292262, accounts_engaged: 12505, total_interactions: 17737 },
          stories: { views: 46035, reach: 32473 },
          follower_growth: { followers_gained: 2804, followers_lost: 60, net_follower_change: 2744, daily_new_followers: [...Array.from({ length: 9 }, (_, i) => ({ end_time: `2026-11-0${i + 1}T08:00:00+0000`, value: i * 3 })), { end_time: 'quebrado', value: 1 }], unavailable_fields: [] },
          platform_specific: {}, period: {} } });
      }
      if (u.includes('/v1/social-accounts/TT1/metrics')) {
        return Response.json({ success: true, data: { network: 'tiktok', followers_count: 91, following_count: 0, posts_count: 32, engagement: { total_likes: 1154 }, platform_specific: { likes_count: 1154 }, period: { note: 'snapshot' } } });
      }
      if (u.includes('/v1/social-accounts/X1/metrics')) return Response.json({ success: true, data: { network: 'x', followers_count: 12, engagement: { views: 300 }, platform_specific: {}, period: {} } });
      if (u.includes('/v1/posts/OST-POST-1/analytics')) {
        return Response.json({ success: true, post: { id: 'OST-POST-1' }, metrics_by_account: [{ social_account: { id: 'IG1', network: 'instagram', username: 'podcastpulso' }, platform_post_url: 'https://www.instagram.com/reel/abc/', published_at: '2026-11-05T12:00:00Z', metrics: { views: 15420, likes: 342, comments: 28, shares: 45 } }], aggregated_metrics: {} });
      }
      if (u.startsWith(`${config.zernio.base}/v1/accounts?`)) return Response.json({ accounts: [{ _id: 'ZYT', platform: 'youtube', username: 'podcastpulsobr', displayName: 'Pulso Podcast' }] });
      if (u.includes('/v1/accounts/follower-stats')) {
        return Response.json({ accounts: [{ _id: 'ZYT', platform: 'youtube', currentFollowers: 181, accountStats: { totalViews: 59435, videoCount: 107 } }],
          stats: { ZYT: Array.from({ length: 12 }, (_, i) => ({ date: `2026-10-${String(20 + i).padStart(2, '0')}`, followers: 150 + i * 3 })) } });
      }
      if (u.includes('/v1/analytics?')) {
        return Response.json({ posts: [
          { content: 'Todo médico precisa fazer o Instagram\nresto', publishedAt: '2026-11-10T22:51:34Z', status: 'published', platformPostUrl: 'https://youtube.com/shorts/x1', analytics: { views: 139, likes: 1, comments: 0, shares: 0 } },
          { content: 'Outro corte', publishedAt: '2026-11-08T10:00:00Z', status: 'published', platformPostUrl: 'javascript:alert(1)', analytics: { views: 900, likes: 20, comments: 3, shares: 1 } },
        ], hasAnalyticsAccess: true });
      }
      return realFetch(url, opts);
    };
    await h.resetDb();
    app = await h.startServer();
    await h.createUser({ name: 'Prod Insights', email: 'prod@ins.com', role: 'produtora' });
    prod = h.client(app.base); await prod.login('prod@ins.com');
    await settings.set('social_provider', 'outstand');
    await settings.set('social_routes', JSON.stringify({ youtube: 'zernio' }));
    ost.resetCache(); zn.resetCache();
    // um post nosso que saiu pela Outstand: entra em "O que mais rendeu" do Instagram
    await h.db.query(`INSERT INTO episode_publications (platforms, title, status, provider, results, media) VALUES ('{instagram}', 'Corte do EP.012', 'publicado', 'outstand', $1, 'video')`,
      [JSON.stringify([{ platform: 'instagram', ok: true, provider: 'outstand', ref: 'OST-POST-1', url: 'https://www.instagram.com/reel/abc/' }])]);
  });
  after(async () => {
    global.fetch = realFetch;
    Object.assign(config.outstand, { key: saved.ok }); config.outstandConfigured = saved.okc;
    Object.assign(config.zernio, { key: saved.zk }); config.zernioConfigured = saved.zkc;
    await app.close(); await h.db.close();
  });

  it('Instagram vem da Outstand e o YouTube da Zernio, cada um com os seus números', async () => {
    const t = (await prod.get('/social/insights')).text;
    assert.match(t, /6\.386/); assert.match(t, /via Outstand/);
    assert.match(t, /181/); assert.match(t, /via Zernio/);
    assert.match(t, /489\.171/, 'visualizações do Instagram em 30 dias');
    assert.match(t, /entraram 2\.804 · saíram 60/);
    assert.match(t, /59\.435/, 'visualizações totais do canal');
    assert.match(t, /Novos seguidores por dia/); assert.match(t, /Inscritos por dia/);
    assert.match(t, /Corte do EP\.012/); assert.match(t, /15\.420/);
    assert.match(t, /Todo médico precisa fazer o Instagram/); assert.doesNotMatch(t, /javascript:alert/, 'link que não é https não vira link');
    assert.ok(count(/IG1\/metrics/) === 1 && count(/follower-stats/) === 1);
    const { rows } = await h.db.query("SELECT platform, data->>'provider' AS provider FROM social_snapshots ORDER BY platform");
    assert.deepEqual(Object.fromEntries(rows.map((r) => [r.platform, r.provider])), { instagram: 'outstand', tiktok: 'outstand', x: 'outstand', youtube: 'zernio' });
  });

  it('dentro da hora usa a foto guardada; "Atualizar agora" lê de novo, menos o X pela Outstand (cobrado por leitura: uma vez por dia)', async () => {
    await prod.get('/social/insights');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(count(/IG1\/metrics/), 1);
    await h.db.query("UPDATE social_snapshots SET updated_at = now() - interval '2 hours'");
    await insights.refresh();
    assert.equal(count(/IG1\/metrics/), 2, 'passou de uma hora: lê de novo');
    assert.equal(count(/X1\/metrics/), 1, 'o X pela Outstand espera o dia');
  });

  it('normaliza o formato de cada provedor', () => {
    const tt = insights.fromOutstand({ network: 'tiktok', followers_count: 91, posts_count: 32, engagement: { total_likes: 1154 }, platform_specific: {} });
    assert.equal(tt.period, null); assert.deepEqual(tt.lifetime, { likes: 1154 });
    const fb = insights.fromOutstand({ network: 'facebook', followers_count: 9, engagement: null, platform_specific: { insights_error: 'erro', insights_unavailable: ['page_media_view'] } });
    assert.equal(fb.followers, 9); assert.match(fb.note, /não devolveu/);
  });
});
