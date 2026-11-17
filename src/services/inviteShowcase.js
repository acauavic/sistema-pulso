// Vitrine do convite: números e cortes reais que o convite mostra (episódios publicados, cortes de quem já veio e destaques).
// Os vídeos saem do Backblaze por link assinado (12 h, versão leve quando existe); a vitrine fica em memória por 30 minutos,
// então o convite não consulta o banco a cada abertura e os links nunca chegam vencidos.
const db = require('../db/pool');
const config = require('../config');

const TTL_MS = 30 * 60_000;
const LINK_S = 12 * 3600;

// Cartões fixos de "Quem já sentou à mesa" no convite (data-guest no HTML) -> número do episódio.
const CARD_EPISODES = { guto: 11, holzer: 11, tamiris: 3, marcio: 10, rachel: 8, carlos: 9 };

let cache = null;

async function publishedEpisodes() {
  const { rows: [r] } = await db.query("SELECT count(*)::int AS n FROM episodes WHERE status = 'publicado'");
  return r.n;
}

// Corte -> { src, poster, title } (links assinados). Sem armazenamento configurado, nada (o convite esconde a parte).
async function clipView(c) {
  const views = require('./videoViews');
  const b2 = require('./b2');
  const src = await views.playUrl(c.storage_key, { expires: LINK_S });
  const poster = c.cover_key ? await b2.presignGet(c.cover_key, { expires: LINK_S }) : null;
  return { src, poster, title: c.title };
}

// Cortes prontos de um episódio: primeiro os que já saíram nas redes, depois os com capa. Até `limit`.
async function clipsOfEpisode(number, limit = 3) {
  const { rows } = await db.query(
    `SELECT c.id, c.storage_key, cv.storage_key AS cover_key,
            coalesce((SELECT p.title FROM episode_publications p WHERE p.clip_id = c.id AND p.status = 'publicado' ORDER BY p.created_at DESC LIMIT 1), c.post_title, c.title) AS title,
            EXISTS (SELECT 1 FROM episode_publications p WHERE p.clip_id = c.id AND p.status = 'publicado') AS posted
       FROM episode_clips c JOIN episodes e ON e.id = c.episode_id LEFT JOIN episode_covers cv ON cv.id = c.cover_id
      WHERE e.number = $1 AND c.status = 'pronto' AND c.storage_key IS NOT NULL
      ORDER BY posted DESC, (c.cover_id IS NOT NULL) DESC, c.id
      LIMIT $2`, [number, limit]);
  return rows;
}

// Destaques: o corte publicado mais recente de cada episódio, dos episódios mais recentes. Até `limit`, um por convidado.
async function highlightClips(limit = 4) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (c.episode_id) c.id, c.episode_id, c.storage_key, cv.storage_key AS cover_key, p.title, p.created_at
       FROM episode_publications p JOIN episode_clips c ON c.id = p.clip_id LEFT JOIN episode_covers cv ON cv.id = c.cover_id
      WHERE p.status = 'publicado' AND c.status = 'pronto' AND c.storage_key IS NOT NULL AND c.episode_id IS NOT NULL
      ORDER BY c.episode_id, p.created_at DESC`);
  return rows.sort((a, b) => b.created_at - a.created_at).slice(0, limit);
}

// Vídeo dos bastidores da plateia (o mesmo da página da plateia): WebM e MP4 com links assinados.
async function plateiaVideo() {
  const s = await require('./audience').settings();
  if (!s.reelsKey && !s.reelsWebmKey) return null;
  const b2 = require('./b2');
  const sources = [];
  if (s.reelsWebmKey) sources.push({ src: await b2.presignGet(s.reelsWebmKey, { expires: LINK_S, contentType: 'video/webm' }), type: 'video/webm' });
  if (s.reelsKey) sources.push({ src: await b2.presignGet(s.reelsKey, { expires: LINK_S, contentType: 'video/mp4' }), type: 'video/mp4' });
  return { sources, poster: s.reelsPosterKey ? await b2.presignGet(s.reelsPosterKey, { expires: LINK_S }) : null, title: 'Uma gravação do Pulso com plateia, do começo ao fim.' };
}

async function build() {
  const out = { episodes: await publishedEpisodes(), guests: {}, highlights: [], plateia: null };
  if (!config.storageConfigured) return out;
  const byEpisode = {};
  for (const [key, number] of Object.entries(CARD_EPISODES)) {
    byEpisode[number] ??= await clipsOfEpisode(number);
    const list = [];
    for (const c of byEpisode[number]) list.push(await clipView(c));
    if (list.length) out.guests[key] = list;
  }
  for (const c of await highlightClips()) out.highlights.push(await clipView(c));
  out.plateia = await plateiaVideo();
  return out;
}

async function get() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const data = await build();
  cache = { at: Date.now(), data };
  return data;
}
const reset = () => { cache = null; };

// Período da gravação pela hora proposta (Brasília): 'manha' | 'tarde' | 'noite' | null (sem data).
function periodOf(date) {
  if (!date) return null;
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(new Date(date)));
  if (!Number.isFinite(h)) return null;
  return h < 12 ? 'manha' : h < 18 ? 'tarde' : 'noite';
}

module.exports = { CARD_EPISODES, get, reset, periodOf, publishedEpisodes };
