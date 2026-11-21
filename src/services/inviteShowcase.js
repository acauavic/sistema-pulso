// Vitrine do convite: números e cortes reais que o convite mostra.
// - "Quem já sentou à mesa": a MESMA galeria do media kit (Gestão > Galeria do media kit), com 2 ou 3 cortes de cada convidado.
// - "Os cortes": até 4 cortes escolhidos pela equipe (com capa); sem escolha, o mais recente publicado de cada episódio, com capa.
// Os vídeos saem do Backblaze por link assinado (12 h, versão leve quando existe); a vitrine fica em memória por 30 minutos,
// então o convite não consulta o banco a cada abertura e os links nunca chegam vencidos.
const db = require('../db/pool');
const config = require('../config');

const TTL_MS = 30 * 60_000;
const LINK_S = 12 * 3600;
const MAX_PICKS = 4;

// Galeria de lançamento (antes de a equipe escolher alguém no media kit): fotos do próprio convite.
const FALLBACK_MESA = [
  { name: 'Guto Galamba', photo: '/static/convite/img-3.jpg', audience: '+3,6M', credential: 'Empresário, comunicador e influenciador ligado ao universo da saúde, comportamento e negócios.', handle: null, ep: 11 },
  { name: 'Dra. Tamiris Mariano', photo: '/static/convite/img-4.jpg', audience: '+2,2M', credential: 'Médica e criadora de conteúdo com forte presença digital na área da saúde.', handle: null, ep: 3 },
  { name: 'Dr. Márcio Martins', photo: '/static/convite/img-5.jpg', audience: '+987K', credential: 'Médico, empresário e referência digital no universo de saúde, performance e empreendedorismo médico.', handle: null, ep: 10 },
  { name: 'Dra. Rachel Furtado', photo: '/static/convite/img-6.jpg', audience: '+166K', credential: 'Profissional da saúde e criadora de conteúdo com presença relevante no ambiente digital.', handle: null, ep: 8 },
  { name: 'Fillipe Holzer', photo: '/static/convite/img-7.jpg', audience: '+109K', credential: 'Empresário e profissional com trajetória ligada a negócios, inovação e empreendedorismo.', handle: null, ep: 11 },
  { name: 'Dr. Carlos Torres', photo: '/static/convite/img-8.jpg', audience: '+28K', credential: 'Médico que direcionou sua trajetória profissional para o universo da inteligência artificial e transformação tecnológica.', handle: null, ep: 9 },
];

let cache = null;

async function publishedEpisodes() {
  const { rows: [r] } = await db.query("SELECT count(*)::int AS n FROM episodes WHERE status = 'publicado'");
  return r.n;
}

// Corte -> { src, poster, title } (links assinados).
async function clipView(c) {
  const views = require('./videoViews');
  const b2 = require('./b2');
  const src = await views.playUrl(c.storage_key, { expires: LINK_S });
  const poster = c.cover_key ? await b2.presignGet(c.cover_key, { expires: LINK_S }) : null;
  return { src, poster, title: c.title };
}

const TITLE = `coalesce((SELECT p.title FROM episode_publications p WHERE p.clip_id = c.id AND p.status = 'publicado' ORDER BY p.created_at DESC LIMIT 1), c.post_title, c.title)`;
const POSTED = `EXISTS (SELECT 1 FROM episode_publications p WHERE p.clip_id = c.id AND p.status = 'publicado')`;

// Cortes prontos de um episódio: primeiro os que já saíram nas redes, depois os com capa. Até `limit`.
async function clipsOfEpisode(number, limit = 3) {
  const { rows } = await db.query(
    `SELECT c.id, c.storage_key, cv.storage_key AS cover_key, ${TITLE} AS title, ${POSTED} AS posted
       FROM episode_clips c JOIN episodes e ON e.id = c.episode_id LEFT JOIN episode_covers cv ON cv.id = c.cover_id
      WHERE e.number = $1 AND c.status = 'pronto' AND c.storage_key IS NOT NULL
      ORDER BY posted DESC, (c.cover_id IS NOT NULL) DESC, c.id
      LIMIT $2`, [number, limit]);
  return rows;
}

// Escolhidos pela equipe (na ordem em que foram escolhidos).
async function pickedClips() {
  const { rows } = await db.query(
    `SELECT c.id, c.storage_key, cv.storage_key AS cover_key, ${TITLE} AS title
       FROM episode_clips c JOIN episode_covers cv ON cv.id = c.cover_id
      WHERE c.invite_pick_at IS NOT NULL AND c.status = 'pronto' AND c.storage_key IS NOT NULL
      ORDER BY c.invite_pick_at, c.id LIMIT ${MAX_PICKS}`);
  return rows;
}

// Sem escolha: o corte publicado mais recente de cada episódio, só os que têm capa, dos episódios mais recentes.
async function autoHighlights(limit = MAX_PICKS) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (c.episode_id) c.id, c.episode_id, c.storage_key, cv.storage_key AS cover_key, p.title, p.created_at
       FROM episode_publications p JOIN episode_clips c ON c.id = p.clip_id JOIN episode_covers cv ON cv.id = c.cover_id
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
  const kit = require('./kitGallery');
  const chosen = await kit.items();
  const out = { episodes: await publishedEpisodes(), foot: await kit.footText(), mesa: chosen.length ? chosen : FALLBACK_MESA, guests: {}, highlights: [], plateia: null };
  if (!config.storageConfigured) return out;
  for (const ep of [...new Set(out.mesa.map((g) => g.ep).filter(Boolean))]) {
    const list = [];
    for (const c of await clipsOfEpisode(ep)) list.push(await clipView(c));
    if (list.length) out.guests[String(ep)] = list;
  }
  const picks = await pickedClips();
  for (const c of picks.length ? picks : await autoHighlights()) out.highlights.push(await clipView(c));
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

// ---------------------------------------------------------------- escolha dos cortes de exemplo (Gestão > Galeria do media kit)
// Candidatos: cortes prontos com capa, ligados a episódio. Os publicados primeiro, depois os mais novos.
async function pickCandidates() {
  const { rows } = await db.query(
    `SELECT c.id, c.title, ${TITLE} AS shown_title, c.cover_id, c.duration_ms, c.invite_pick_at, e.number AS ep_number, g.name AS guest_name, ${POSTED} AS posted
       FROM episode_clips c JOIN episodes e ON e.id = c.episode_id LEFT JOIN guests g ON g.id = e.guest_id
      WHERE c.status = 'pronto' AND c.cover_id IS NOT NULL AND c.storage_key IS NOT NULL
      ORDER BY (c.invite_pick_at IS NULL), c.invite_pick_at, e.number DESC, posted DESC, c.id DESC`);
  return rows;
}

// Grava a escolha (até 4, na ordem recebida). Só aceita cortes com capa. Devolve quantos ficaram.
async function setPicks(ids) {
  const want = [...new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_PICKS);
  const { rows: ok } = want.length ? await db.query("SELECT id FROM episode_clips WHERE id = ANY($1) AND status = 'pronto' AND cover_id IS NOT NULL", [want]) : { rows: [] };
  const valid = want.filter((id) => ok.some((r) => r.id === id));
  await db.query('UPDATE episode_clips SET invite_pick_at = NULL WHERE invite_pick_at IS NOT NULL AND NOT (id = ANY($1))', [valid]);
  for (let i = 0; i < valid.length; i += 1) {
    await db.query("UPDATE episode_clips SET invite_pick_at = now() + make_interval(secs => $2) WHERE id = $1", [valid[i], i]);
  }
  reset();
  return valid.length;
}

// Período da gravação pela hora proposta (Brasília): 'manha' | 'tarde' | 'noite' | null (sem data).
function periodOf(date) {
  if (!date) return null;
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(new Date(date)));
  if (!Number.isFinite(h)) return null;
  return h < 12 ? 'manha' : h < 18 ? 'tarde' : 'noite';
}

module.exports = { MAX_PICKS, FALLBACK_MESA, get, reset, periodOf, publishedEpisodes, pickCandidates, setPicks };
