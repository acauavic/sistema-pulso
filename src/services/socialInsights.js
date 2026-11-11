// Insights das redes: cada rede é lida no provedor que a atende (o mesmo da publicação, Integrações > "Cada rede por um provedor").
// Hoje: Instagram, Facebook, TikTok, Threads e LinkedIn pela Outstand; YouTube e X pela Zernio; o Upload-Post segue valendo para quem
// for roteado para ele. Rede sem conta no provedor da rota é lida em outro provedor configurado que tenha a conta.
// Tudo vira um formato só (abaixo) e é guardado como a foto do dia em social_snapshots: a tela lê do banco, e o provedor é consultado
// no máximo uma vez por hora (o X pela Outstand, uma vez por dia: cada leitura dele é cobrada por post lido).
//
// Formato de cada rede: { provider, handle, fetchedAt, followers, following, posts, period: { days, views, reach, likes, comments, shares,
// saves, interactions, engaged }, lifetime: { views, likes }, growth: { net, gained, lost }, series: { kind: 'novos'|'total', points: [{ d, v }] },
// stories: { views, reach }, top: [{ title, url, at, views, likes, comments, shares }], note }
const config = require('../config');
const db = require('../db/pool');
const social = require('./socialApi');
const up = require('./uploadPost');

const NETWORKS = ['instagram', 'youtube', 'tiktok', 'facebook', 'threads', 'linkedin', 'x'];
const DAYS = 30;
const TZ = 'America/Sao_Paulo';
const dayOf = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d));
const today = () => dayOf(Date.now());
const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const clean = (o) => { const out = Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== null && v !== undefined)); return Object.keys(out).length ? out : null; };
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s"<>]+$/i.test(u) ? u : null); // link vindo do provedor: só https
const firstLine = (s) => String(s || '').split('\n').map((x) => x.trim()).find(Boolean)?.slice(0, 100) || '';
const sumOf = (rows, key) => { const vals = rows.map((r) => n(r[key])).filter((v) => v !== null); return vals.length ? vals.reduce((a, b) => a + b, 0) : null; };
const maxAgeMs = (net, provider) => (net === 'x' && provider === 'outstand' ? 24 * 3600_000 : 3600_000);

// ---------------------------------------------------------------- Outstand
async function outstandGet(path) {
  const res = await fetch(`${config.outstand.base}${path}`, { headers: { Authorization: `Bearer ${config.outstand.key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(25_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Outstand respondeu ${res.status}${json.error ? `: ${typeof json.error === 'string' ? json.error : JSON.stringify(json.error).slice(0, 160)}` : ''}`), { status: res.status });
  return json;
}

function fromOutstand(d) {
  const e = d.engagement || {};
  const ps = d.platform_specific || {};
  const lifetimeOnly = d.network === 'youtube' || d.network === 'tiktok'; // essas duas só devolvem o total da conta, sem período
  const g = d.follower_growth;
  const series = (g?.daily_new_followers || []).filter((p) => Number.isFinite(Date.parse(p.end_time))).map((p) => ({ d: dayOf(Date.parse(p.end_time) - 86_400_000), v: n(p.value) ?? 0 })); // end_time é o fim do dia medido
  let note = null;
  if (ps.insights_error || ps.insights_unavailable?.length) note = 'A rede não devolveu agora os números de alcance e engajamento; seguidores estão em dia.';
  if (g?.unavailable_fields?.length && !g.followers_gained) note = 'O Instagram só informa ganho e perda de seguidores para contas com mais de 100 seguidores.';
  return {
    followers: n(d.followers_count), following: n(d.following_count), posts: n(d.posts_count),
    period: lifetimeOnly ? null : clean({ days: DAYS, views: n(e.views), reach: n(e.reach), likes: n(e.likes), comments: n(e.comments ?? e.replies), shares: n(e.shares ?? e.reposts), saves: n(e.saves), interactions: n(e.total_interactions), engaged: n(e.accounts_engaged) }),
    lifetime: lifetimeOnly ? clean({ views: n(e.views ?? ps.viewCount), likes: n(e.total_likes ?? ps.likes_count) }) : null,
    growth: g ? clean({ net: n(g.net_follower_change), gained: n(g.followers_gained), lost: n(g.followers_lost) }) : null,
    series: series.length ? { kind: 'novos', points: series } : null,
    stories: d.stories ? clean({ views: n(d.stories.views), reach: n(d.stories.reach) }) : null,
    note,
  };
}

// Os nossos posts que saíram pela Outstand nos últimos 30 dias, com os números de cada rede (uma consulta por post serve todas as redes).
async function outstandTop() {
  const { rows } = await db.query(
    `SELECT p.id, p.title, r->>'ref' AS ref, r->>'platform' AS platform, r->>'url' AS url
       FROM episode_publications p, jsonb_array_elements(coalesce(p.results, '[]'::jsonb)) r
      WHERE p.status IN ('publicado', 'parcial') AND p.created_at > now() - interval '${DAYS} days'
        AND r->>'provider' = 'outstand' AND (r->>'ok')::boolean AND r->>'ref' IS NOT NULL
      ORDER BY p.id DESC LIMIT 120`);
  const refs = [...new Set(rows.map((r) => r.ref))].slice(0, 25);
  const byRef = {};
  await Promise.all(refs.map(async (ref) => {
    try { byRef[ref] = await outstandGet(`/v1/posts/${encodeURIComponent(ref)}/analytics`); } catch { /* post sem números ainda (acabou de sair) ou apagado: fica de fora */ }
  }));
  const out = {};
  for (const r of rows) {
    const acc = (byRef[r.ref]?.metrics_by_account || []).find((a) => a.social_account?.network === r.platform);
    const m = acc?.metrics;
    if (!m) continue;
    (out[r.platform] ||= []).push({ title: r.title || 'Sem título', url: safeUrl(acc.platform_post_url || r.url), at: acc.published_at || null, views: n(m.views ?? m.impressions), likes: n(m.likes), comments: n(m.comments), shares: n(m.shares) });
  }
  for (const k of Object.keys(out)) out[k] = out[k].sort((a, b) => (b.views ?? -1) - (a.views ?? -1)).slice(0, 5);
  return out;
}

// ---------------------------------------------------------------- Zernio
async function zernioGet(path) {
  const res = await fetch(`${config.zernio.base}${path}`, { headers: { Authorization: `Bearer ${config.zernio.key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(25_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Zernio respondeu ${res.status}${json.error ? `: ${json.error}` : ''}`), { status: res.status });
  return json;
}

async function fromZernio(accountId) {
  const from = dayOf(Date.now() - DAYS * 86_400_000); const to = today();
  const [stats, posts] = await Promise.all([
    zernioGet(`/v1/accounts/follower-stats?${new URLSearchParams({ accountIds: accountId, fromDate: from, toDate: to })}`),
    zernioGet(`/v1/analytics?${new URLSearchParams({ accountId, fromDate: from, toDate: to, sortBy: 'views', order: 'desc', sortOrder: 'desc', limit: '100' })}`).catch(() => null),
  ]);
  const acc = (stats.accounts || []).find((a) => a._id === accountId) || stats.accounts?.[0] || {};
  const pts = (stats.stats?.[accountId] || []).filter((p) => /^\d{4}-\d{2}-\d{2}/.test(String(p.date))).map((p) => ({ d: String(p.date).slice(0, 10), v: n(p.followers) ?? 0 }));
  const list = (posts?.posts || []).filter((p) => p.status === 'published' || p.publishedAt);
  const a = list.map((p) => p.analytics || {});
  const st = acc.accountStats || {};
  const net = pts.length > 1 ? pts.at(-1).v - pts[0].v : null;
  return {
    followers: n(acc.currentFollowers), following: n(st.followingCount), posts: n(st.videoCount ?? st.tweetCount),
    period: list.length ? clean({ days: DAYS, views: sumOf(a, 'views'), reach: sumOf(a, 'reach'), likes: sumOf(a, 'likes'), comments: sumOf(a, 'comments'), shares: sumOf(a, 'shares'), saves: sumOf(a, 'saves') }) : null,
    lifetime: clean({ views: n(st.totalViews) }),
    growth: net !== null ? { net } : null,
    series: pts.length > 1 ? { kind: 'total', points: pts } : null,
    stories: null,
    top: list.map((p) => ({ title: firstLine(p.title || p.content) || 'Sem título', url: safeUrl(p.platformPostUrl), at: p.publishedAt || null, views: n(p.analytics?.views), likes: n(p.analytics?.likes), comments: n(p.analytics?.comments), shares: n(p.analytics?.shares) }))
      .sort((x, y) => (y.views ?? -1) - (x.views ?? -1)).slice(0, 5),
    note: posts?.hasAnalyticsAccess === false ? 'A conta da Zernio está sem o complemento de análise: só os seguidores aparecem.' : null,
  };
}

// ---------------------------------------------------------------- leitura de todas as redes
// Contas por provedor configurado (cada um uma vez) e a rota de cada rede.
async function accounts() {
  const map = await social.routeMap();
  const ids = social.list().filter((p) => p.configured()).map((p) => p.id);
  const conns = {};
  await Promise.all(ids.map(async (id) => { try { conns[id] = await social.get(id).connected(); } catch (err) { conns[id] = { ok: false, platforms: {}, error: err.message }; } }));
  const out = {};
  for (const net of NETWORKS) {
    const order = [map[net], ...ids.filter((id) => id !== map[net])].filter((id) => conns[id]?.platforms?.[net]);
    if (order.length) out[net] = { provider: order[0], account: conns[order[0]].platforms[net], routed: order[0] === map[net] };
  }
  return { list: out, errors: ids.filter((id) => conns[id] && !conns[id].ok).map((id) => `${social.get(id).label}: ${conns[id].error}`) };
}

async function fetchNetwork(net, { provider, account }, ctx) {
  const base = { provider, handle: account.handle || '', fetchedAt: new Date().toISOString() };
  if (provider === 'outstand') {
    const { data } = await outstandGet(`/v1/social-accounts/${encodeURIComponent(account.accountId)}/metrics`);
    ctx.outTop ||= outstandTop().catch(() => ({}));
    return { ...base, ...fromOutstand(data || {}), top: (await ctx.outTop)[net] || [] };
  }
  if (provider === 'zernio') return { ...base, ...(await fromZernio(account.accountId)) };
  // Upload-Post: uma consulta para as redes dele (a Upload-Post devolve os números da conta, sem período definido)
  ctx.upAll ||= up.analytics(ctx.upNets);
  const d = (await ctx.upAll)[net] || {};
  return { ...base, followers: n(d.followers), period: clean({ views: n(d.views), reach: n(d.reach), likes: n(d.likes), comments: n(d.comments), shares: n(d.shares), saves: n(d.saves) && d.saves >= 0 ? d.saves : null }), top: [], note: null };
}

let running = null;
// Atualiza as redes que estão velhas (ou todas, com force). Grava a foto do dia de cada uma. Devolve os erros por rede.
async function refresh({ force = false } = {}) {
  if (running) return running;
  running = (async () => {
    const { list, errors } = await accounts();
    const { rows } = await db.query('SELECT platform, data, updated_at FROM social_snapshots WHERE taken_on = $1', [today()]);
    const fresh = Object.fromEntries(rows.map((r) => [r.platform, r]));
    const ctx = { upNets: Object.entries(list).filter(([, v]) => v.provider === 'uploadpost').map(([k]) => k) };
    const failed = {};
    await Promise.all(Object.entries(list).map(async ([net, src]) => {
      const cur = fresh[net];
      const sameSource = cur?.data?.provider === src.provider;
      if (!force && sameSource && Date.now() - new Date(cur.updated_at) < maxAgeMs(net, src.provider)) return;
      try {
        const data = await fetchNetwork(net, src, ctx);
        await db.query(`INSERT INTO social_snapshots (taken_on, platform, data) VALUES ($1,$2,$3)
                        ON CONFLICT (taken_on, platform) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [today(), net, JSON.stringify(data)]);
      } catch (err) { failed[net] = err.message; }
    }));
    return { failed, errors, networks: Object.keys(list) };
  })().finally(() => { running = null; });
  return running;
}

// O que a tela de Insights mostra. Sem nada guardado de hoje, espera a leitura; com dados velhos, mostra o que tem e atualiza por trás.
async function overview({ force = false } = {}) {
  const out = { ok: true, error: null, networks: [], updatedAt: null, refreshing: false };
  if (!social.list().some((p) => p.configured())) { out.ok = false; out.error = 'Nenhum provedor de redes configurado neste servidor.'; return out; }
  const { rows: stored } = await db.query('SELECT platform FROM social_snapshots WHERE taken_on = $1', [today()]);
  let result = null;
  if (force || !stored.length) {
    try { result = await refresh({ force }); } catch (err) { out.error = `Não foi possível ler os números agora: ${err.message}`; }
  } else {
    out.refreshing = true;
    refresh().catch((err) => console.error('[insights]', err.message)); // atualiza por trás; a próxima visita já vê
  }
  const { rows: latest } = await db.query('SELECT DISTINCT ON (platform) platform, taken_on, data, updated_at FROM social_snapshots ORDER BY platform, taken_on DESC');
  const { rows: week } = await db.query("SELECT DISTINCT ON (platform) platform, data FROM social_snapshots WHERE taken_on <= ($1::date - 7) ORDER BY platform, taken_on DESC", [today()]);
  const { rows: history } = await db.query("SELECT platform, taken_on, (data->>'followers')::numeric AS followers FROM social_snapshots WHERE taken_on > ($1::date - $2::int) ORDER BY taken_on", [today(), DAYS]);
  const before = Object.fromEntries(week.map((r) => [r.platform, r.data]));
  const live = result ? new Set(result.networks) : null;
  for (const net of NETWORKS) {
    const row = latest.find((r) => r.platform === net);
    if (!row || (live && !live.has(net) && !row.data.provider)) continue;
    const d = row.data;
    const prev = before[net]?.followers;
    // série de seguidores: a do provedor; sem ela, as nossas fotos diárias
    let series = d.series || null;
    const ours = history.filter((h) => h.platform === net && h.followers !== null).map((h) => ({ d: dayOf(h.taken_on), v: Number(h.followers) }));
    if (!series && ours.length > 2) series = { kind: 'total', points: ours };
    let week7 = d.followers != null && prev != null ? d.followers - prev : null;
    if (series?.kind === 'total' && series.points.length > 7) week7 = series.points.at(-1).v - series.points.at(-8).v;
    if (series?.kind === 'novos' && series.points.length >= 7) week7 = series.points.slice(-7).reduce((s, p) => s + p.v, 0);
    out.networks.push({ net, ...d, providerLabel: d.provider ? social.get(d.provider).label : 'Upload-Post', stale: row.taken_on && dayOf(row.taken_on) !== today(), week7, series, failed: result?.failed?.[net] || null, updatedAt: row.updated_at });
  }
  out.updatedAt = out.networks.reduce((m, x) => (!m || new Date(x.updatedAt) > new Date(m) ? x.updatedAt : m), null);
  if (result?.errors?.length && !out.networks.length) out.error = result.errors.join(' · ');
  return out;
}

module.exports = { NETWORKS, DAYS, overview, refresh, fromOutstand, fromZernio, accounts };
