// Números de cada post nas redes (views, curtidas, comentários, compartilhamentos), lidos do provedor por onde o post saiu:
// Outstand (GET /v1/posts/{ref}/analytics, uma consulta serve todas as redes do post) e Zernio (lista de posts da conta com os
// números, casada pelo link). A rotina 'metricas-posts' atualiza a cada 6 h o que saiu nos últimos 90 dias. Os números servem
// para mostrar o que funcionou (cartão do corte, publicação, Insights) e para a IA de copy usar os mais vistos como referência.
// Post feito por fora do sistema não tem como ser lido por aqui (os provedores só leem o que saiu por eles).
const db = require('../db/pool');
const config = require('../config');

const WINDOW_DAYS = 90;
const STALE_MS = 6 * 3600_000;
const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

async function upsert(pubId, platform, m) {
  await db.query(
    `INSERT INTO post_metrics (publication_id, platform, views, likes, comments, shares, reach, engagement_rate, url, published_at, fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (publication_id, platform) DO UPDATE SET views = EXCLUDED.views, likes = EXCLUDED.likes, comments = EXCLUDED.comments,
       shares = EXCLUDED.shares, reach = EXCLUDED.reach, engagement_rate = EXCLUDED.engagement_rate, url = coalesce(EXCLUDED.url, post_metrics.url),
       published_at = coalesce(EXCLUDED.published_at, post_metrics.published_at), fetched_at = now()`,
    [pubId, platform, m.views, m.likes, m.comments, m.shares, m.reach, m.engagement_rate, m.url || null, m.published_at || null]);
}

// Métricas da Outstand para um post: [{ platform, views, likes, comments, shares, reach, engagement_rate, url, published_at }].
function fromOutstand(json) {
  return (json?.metrics_by_account || []).filter((a) => a.metrics && a.social_account?.network).map((a) => {
    const m = a.metrics;
    return {
      platform: a.social_account.network, views: n(m.views ?? m.total_plays ?? m.impressions), likes: n(m.likes), comments: n(m.comments ?? m.replies),
      shares: n(m.shares ?? m.reposts), reach: n(m.reach), engagement_rate: Number.isFinite(Number(m.engagement_rate)) ? Number(m.engagement_rate) : null,
      url: a.platform_post_url || null, published_at: a.published_at || null,
    };
  });
}

// Publicações que saíram pela Outstand nos últimos 90 dias e estão sem número há mais de 6 h (as mais antigas primeiro).
async function staleOutstandRefs(limit) {
  const { rows } = await db.query(
    `SELECT x->>'ref' AS ref, array_agg(DISTINCT p.id) AS pubs, coalesce(max(m.fetched_at), 'epoch'::timestamptz) AS last
       FROM episode_publications p CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.results, '[]'::jsonb)) x
       LEFT JOIN post_metrics m ON m.publication_id = p.id AND m.platform = x->>'platform'
      WHERE p.status IN ('publicado', 'parcial') AND p.updated_at > now() - make_interval(days => $1)
        AND x->>'provider' = 'outstand' AND (x->>'ok')::boolean AND coalesce(x->>'ref', '') <> ''
      GROUP BY 1 HAVING coalesce(max(m.fetched_at), 'epoch'::timestamptz) < now() - make_interval(secs => $2) -- uma rede sem número não força nova leitura
      ORDER BY 3 LIMIT $3`, [WINDOW_DAYS, STALE_MS / 1000, limit]);
  return rows;
}

async function refreshOutstand(limit) {
  if (!config.outstandConfigured) return 0;
  const { outstandGet } = require('./socialInsights');
  const refs = await staleOutstandRefs(limit);
  let saved = 0; let i = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (i < refs.length) {
      const r = refs[i]; i += 1;
      let json;
      try { json = await outstandGet(`/v1/posts/${encodeURIComponent(r.ref)}/analytics`); } catch { continue; } // post apagado ou ainda sem números
      for (const m of fromOutstand(json)) for (const pubId of r.pubs) { await upsert(pubId, m.platform, m); saved += 1; }
    }
  }));
  return saved;
}

// Zernio: a lista de posts da conta traz os números; casa pelo link com o que saiu pelo sistema.
async function refreshZernio() {
  if (!config.zernioConfigured) return 0;
  const { zernioGet } = require('./socialInsights');
  const { rows: targets } = await db.query(
    `SELECT p.id, x->>'platform' AS platform, x->>'url' AS url FROM episode_publications p CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.results, '[]'::jsonb)) x
      WHERE p.status IN ('publicado', 'parcial') AND p.updated_at > now() - make_interval(days => $1)
        AND x->>'provider' = 'zernio' AND (x->>'ok')::boolean AND coalesce(x->>'url', '') <> ''`, [WINDOW_DAYS]);
  if (!targets.length) return 0;
  const accounts = await require('./socialInsights').accounts().catch(() => ({ list: {} }));
  const day = (d) => d.toISOString().slice(0, 10);
  let saved = 0;
  for (const platform of [...new Set(targets.map((t) => t.platform))]) {
    const acc = accounts.list?.[platform];
    if (!acc || acc.provider !== 'zernio') continue;
    let json;
    try {
      json = await zernioGet(`/v1/analytics?${new URLSearchParams({ accountId: acc.account.accountId, fromDate: day(new Date(Date.now() - WINDOW_DAYS * 86400_000)), toDate: day(new Date()), limit: '100' })}`);
    } catch { continue; }
    const byUrl = new Map((json.posts || []).filter((p) => p.platformPostUrl).map((p) => [String(p.platformPostUrl), p]));
    for (const t of targets.filter((x) => x.platform === platform)) {
      const p = byUrl.get(t.url);
      if (!p) continue;
      const a = p.analytics || {};
      await upsert(t.id, platform, { views: n(a.views), likes: n(a.likes), comments: n(a.comments), shares: n(a.shares), reach: n(a.reach), engagement_rate: null, url: t.url, published_at: p.publishedAt || null });
      saved += 1;
    }
  }
  return saved;
}

// Rotina: até 60 posts da Outstand por vez + a lista da Zernio.
async function refresh({ limit = 60 } = {}) {
  const [a, b] = await Promise.all([refreshOutstand(limit).catch((err) => { console.error('[metricas] Outstand:', err.message); return 0; }), refreshZernio().catch((err) => { console.error('[metricas] Zernio:', err.message); return 0; })]);
  return { saved: a + b };
}

// Soma por corte (todas as publicações e redes): { [clipId]: { views, likes, comments, shares, nets } }.
async function forClips(ids) {
  if (!ids?.length) return {};
  const { rows } = await db.query(
    `SELECT p.clip_id, sum(m.views)::bigint AS views, sum(m.likes)::bigint AS likes, sum(m.comments)::bigint AS comments, sum(m.shares)::bigint AS shares,
            count(DISTINCT m.platform)::int AS nets, max(m.fetched_at) AS fetched_at
       FROM post_metrics m JOIN episode_publications p ON p.id = m.publication_id WHERE p.clip_id = ANY($1) GROUP BY p.clip_id`, [ids]);
  return Object.fromEntries(rows.map((r) => [r.clip_id, { views: Number(r.views || 0), likes: Number(r.likes || 0), comments: Number(r.comments || 0), shares: Number(r.shares || 0), nets: r.nets, fetched_at: r.fetched_at }]));
}

// Por rede de uma publicação: { instagram: { views, likes, ... } }.
async function forPublication(pubId) {
  const { rows } = await db.query('SELECT * FROM post_metrics WHERE publication_id = $1', [pubId]);
  return Object.fromEntries(rows.map((r) => [r.platform, r]));
}

// Os cortes que mais funcionaram (soma das views nos últimos `days`), com os textos que foram ao ar.
async function top({ days = WINDOW_DAYS, limit = 10 } = {}) {
  const { rows } = await db.query(
    `SELECT c.id, c.title, c.post_title, c.cover_texts, c.cover_id, e.number AS ep_number, g.name AS guest_name,
            sum(m.views)::bigint AS views, sum(m.likes)::bigint AS likes, sum(m.comments)::bigint AS comments, sum(m.shares)::bigint AS shares,
            (array_agg(p.title ORDER BY p.created_at DESC))[1] AS pub_title, (array_agg(p.description ORDER BY p.created_at DESC))[1] AS pub_caption
       FROM post_metrics m JOIN episode_publications p ON p.id = m.publication_id JOIN episode_clips c ON c.id = p.clip_id
       LEFT JOIN episodes e ON e.id = c.episode_id LEFT JOIN guests g ON g.id = e.guest_id
      WHERE coalesce(m.published_at, p.created_at) > now() - make_interval(days => $1)
      GROUP BY c.id, e.number, g.name HAVING sum(m.views) > 0 ORDER BY sum(m.views) DESC LIMIT $2`, [days, limit]);
  return rows.map((r) => ({ ...r, views: Number(r.views || 0), likes: Number(r.likes || 0), comments: Number(r.comments || 0), shares: Number(r.shares || 0) }));
}

// Referência para a IA: até 5 cortes mais vistos, com o título, o texto da capa e a primeira linha da legenda que foram ao ar.
// Só entra quando há pelo menos 3 com números (com menos, é ruído). Guarda por 1 h.
let examplesCache = { at: 0, text: '' };
async function examples() {
  if (Date.now() - examplesCache.at < 3600_000) return examplesCache.text;
  let text = '';
  try {
    const list = await top({ limit: 5 });
    if (list.length >= 3) {
      const fmtN = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1).replace('.', ',')} mil` : String(v));
      text = ['Referência: os cortes do Pulso que MAIS foram vistos nos últimos 90 dias (use como pista do que funciona com este público; não copie):',
        ...list.map((c, i) => `${i + 1}) ${fmtN(c.views)} views · título: "${c.pub_title || c.post_title || c.title}"${c.cover_texts?.[0] ? ` · capa: "${c.cover_texts[0]}"` : ''}${c.pub_caption ? ` · legenda começa: "${String(c.pub_caption).split('\n')[0].slice(0, 120)}"` : ''}`)].join('\n');
    }
  } catch (err) { console.error('[metricas] exemplos:', err.message); }
  examplesCache = { at: Date.now(), text };
  return text;
}
const resetExamples = () => { examplesCache = { at: 0, text: '' }; };

module.exports = { WINDOW_DAYS, fromOutstand, refresh, refreshOutstand, refreshZernio, forClips, forPublication, top, examples, resetExamples, upsert };
