// Instagram: collab (convidar até 3 perfis como coautores do post) e marcação de pessoas.
// Vale para Reels, posts e carrosséis; o Instagram não aceita collab em stories, e aqui a marcação também fica fora dos stories.
// Marcação em foto precisa da posição (x, y de 0 a 1, a partir do canto superior esquerdo); em vídeo vai só o @.
// As alternativas da busca vêm do que o sistema já conhece: convidados com Instagram, perfis já usados antes e o convidado do episódio.
// Reel de teste (trial reel): o Instagram mostra primeiro só para quem não segue a conta. trial: 'auto' (o Instagram libera para os
// seguidores se for bem) ou 'manual' (a equipe libera no app). Só em Reel (vídeo); o Instagram não aceita collab em Reel de teste.
// Depois de publicado, liberar para os seguidores não passa pela API: é no app (ou sozinho, no 'auto').
const db = require('../db/pool');

const MAX_COLLAB = 3; // limite da Zernio e da Outstand (o Upload-Post não informa limite): o menor vale para todos
const MAX_TAGS = 20; // limite do Instagram por imagem
const HANDLE = /^[a-z0-9._]{1,30}$/;
const TRIAL = { auto: 'SS_PERFORMANCE', manual: 'MANUAL' }; // nosso valor -> graduation_strategy da Meta
const TRIAL_LABEL = { auto: 'libera sozinho se for bem', manual: 'a equipe libera no app' };

// "@Fulano", "fulano", "instagram.com/fulano/" -> "fulano" (ou '' se não for um @ válido).
function clean(raw) {
  let s = String(raw || '').trim().toLowerCase();
  const m = s.match(/instagram\.com\/([^/?#\s]+)/);
  if (m) [, s] = m;
  s = s.replace(/^@+/, '').replace(/\/+$/, '');
  return HANDLE.test(s) && !/^\.|\.$|\.\./.test(s) ? s : '';
}

const coord = (v) => { if (v == null || String(v).trim() === '') return null; const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, Math.round(n * 1000) / 1000)) : null; }; // vazio = sem posição

// Lê o formulário (ig_collab: "@a" repetido; ig_tag: "@a|x|y" repetido; ig_trial=1 + ig_trial_modo=auto|manual). media: video | imagem | carrossel | story.
// Devolve { instagram: { collaborators, tags, trial? } | null, error }.
function parse(body, { media = 'video', platforms = [] } = {}) {
  if (!platforms.includes('instagram') || media === 'story') return { instagram: null, error: null };
  const collab = [...new Set([].concat(body.ig_collab || []).map(clean).filter(Boolean))];
  if (collab.length > MAX_COLLAB) return { instagram: null, error: `Collab no Instagram: no máximo ${MAX_COLLAB} perfis.` };
  const bad = [].concat(body.ig_collab || [], body.ig_tag || []).map((v) => String(v).split('|')[0]).filter((v) => v.trim() && !clean(v));
  if (bad.length) return { instagram: null, error: `Instagram: "${String(bad[0]).slice(0, 40)}" não é um @ válido.` };
  const seen = new Set(); const tags = [];
  for (const raw of [].concat(body.ig_tag || [])) {
    const [h, x, y] = String(raw).split('|');
    const username = clean(h);
    if (!username || seen.has(username)) continue;
    seen.add(username);
    tags.push(media === 'video' ? { username } : { username, x: coord(x), y: coord(y) });
  }
  if (tags.length > MAX_TAGS) return { instagram: null, error: `Marcação no Instagram: no máximo ${MAX_TAGS} pessoas.` };
  // foto sem posição escolhida: distribui as marcas numa linha perto da base da imagem
  const loose = tags.filter((t) => media !== 'video' && (t.x == null || t.y == null));
  loose.forEach((t, i) => { t.x = Math.round(((i + 1) / (loose.length + 1)) * 1000) / 1000; t.y = 0.85; });
  const trial = media === 'video' && String(body.ig_trial || '') === '1' ? (body.ig_trial_modo === 'manual' ? 'manual' : 'auto') : null;
  if (trial && collab.length) return { instagram: null, error: 'Reel de teste não aceita collab no Instagram: tire os perfis do collab ou desmarque "Reel de teste".' };
  if (!collab.length && !tags.length && !trial) return { instagram: null, error: null };
  return { instagram: { collaborators: collab, tags, ...(trial ? { trial } : {}) }, error: null };
}

// @ do convidado do episódio (a sugestão que já vem marcada no collab).
async function guestOf(episodeId) {
  if (!episodeId) return null;
  const { rows: [g] } = await db.query(
    'SELECT g.name, g.instagram FROM episodes e JOIN guests g ON g.id = e.guest_id WHERE e.id = $1 AND g.instagram IS NOT NULL', [episodeId]);
  const handle = g ? clean(g.instagram) : '';
  return handle ? { handle, name: g.name, kind: 'convidado do episódio' } : null;
}

// Alternativas da busca: convidado do episódio primeiro, depois convidados e perfis já usados em collab/marcação.
async function suggest({ q = '', episodeId = null, limit = 12 } = {}) {
  const term = String(q || '').trim().toLowerCase().replace(/^@/, '').slice(0, 60);
  const out = new Map();
  const push = (s) => { if (s && s.handle && !out.has(s.handle)) out.set(s.handle, s); };
  const guest = await guestOf(episodeId);
  if (guest && (!term || guest.handle.includes(term) || guest.name.toLowerCase().includes(term))) push(guest);
  const like = `%${term}%`;
  const { rows: guests } = await db.query(
    `SELECT name, instagram FROM guests WHERE instagram IS NOT NULL AND instagram <> ''
       AND ($1 = '' OR lower(instagram) LIKE $2 OR lower(name) LIKE $2)
     ORDER BY (lower(instagram) LIKE $3) DESC, updated_at DESC NULLS LAST LIMIT 40`, [term, like, `${term}%`]);
  for (const g of guests) push({ handle: clean(g.instagram), name: g.name, kind: 'convidado' });
  const { rows: used } = await db.query(
    `SELECT DISTINCT h FROM (
       SELECT jsonb_array_elements_text(coalesce(options->'instagram'->'collaborators', '[]'::jsonb)) AS h FROM episode_publications
       UNION ALL SELECT t->>'username' FROM episode_publications, jsonb_array_elements(coalesce(options->'instagram'->'tags', '[]'::jsonb)) t
     ) x WHERE h IS NOT NULL AND ($1 = '' OR h LIKE $2) LIMIT 40`, [term, like]);
  for (const u of used) push({ handle: clean(u.h), name: '', kind: 'já usado' });
  return [...out.values()].filter((s) => s.handle).slice(0, limit);
}

// Reel de teste da publicação (null = Reel normal). Aceita as options da publicação ou o objeto do Instagram.
const trialOf = (ig) => (ig && TRIAL[ig.trial] ? ig.trial : null);
const strategy = (ig) => (trialOf(ig) ? TRIAL[ig.trial] : null);

// Para os provedores: campos do Upload-Post (collaborators e user_tags) — vídeo leva "@a, @b"; foto leva JSON com a posição.
// Reel de teste: share_mode (TRIAL_REELS_SHARE_TO_FOLLOWERS_IF_LIKED = libera sozinho; TRIAL_REELS_DONT_SHARE_TO_FOLLOWERS = no app).
function uploadPostFields(ig, { photo = false } = {}) {
  if (!ig) return [];
  const f = [];
  if (!photo && trialOf(ig)) f.push(['share_mode', ig.trial === 'manual' ? 'TRIAL_REELS_DONT_SHARE_TO_FOLLOWERS' : 'TRIAL_REELS_SHARE_TO_FOLLOWERS_IF_LIKED']);
  if (ig.collaborators?.length) f.push(['collaborators', ig.collaborators.join(',')]);
  if (ig.tags?.length) f.push(['user_tags', photo ? JSON.stringify(ig.tags.map((t) => ({ username: t.username, x: t.x ?? 0.5, y: t.y ?? 0.85 }))) : ig.tags.map((t) => `@${t.username}`).join(', ')]);
  return f;
}

// Para a Zernio: platformSpecificData.collaborators e .userTags (em carrossel a marca vai na primeira imagem); Reel de teste em trialParams.
function zernioData(ig, { photo = false } = {}) {
  if (!ig) return {};
  const d = {};
  if (!photo && trialOf(ig)) d.trialParams = { graduationStrategy: strategy(ig) };
  if (ig.collaborators?.length) d.collaborators = ig.collaborators;
  if (ig.tags?.length) d.userTags = ig.tags.map((t) => (photo ? { username: t.username, x: t.x ?? 0.5, y: t.y ?? 0.85, mediaIndex: 0 } : { username: t.username }));
  return d;
}

module.exports = { MAX_COLLAB, MAX_TAGS, TRIAL, TRIAL_LABEL, clean, parse, trialOf, strategy, guestOf, suggest, uploadPostFields, zernioData };
