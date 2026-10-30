// Portal do convidado (/convidado/:token): uma página por convidado que vai se enchendo durante a semana do episódio.
// Mostra o cronograma (cortes começam na segunda, o episódio sai na sexta), as duas formas de collab, os posts em collab com ele
// (o sistema reconhece pelo @ do convidado no collab do Instagram), os outros posts do episódio, os cortes exclusivos (corte do
// episódio que não foi publicado, a não ser que a equipe tire), os links do episódio e as fotos que a equipe escolheu.
// Cada post novo em collab gera um aviso: por e-mail sai sozinho; por WhatsApp fica pendente até a equipe mandar.
const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config');
const igPeople = require('./igPeople');
const up = require('./uploadPost');
const contacts = require('./contacts');
const { firstName, isEmail } = require('../utils/format');

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const PHOTO_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;
const NOTIFY = { auto: 'Automático', email: 'E-mail', whatsapp: 'WhatsApp', nenhum: 'Não avisar' };
const MEDIA_LABEL = { imagem: 'Post', carrossel: 'Carrossel', story: 'Story' };
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const url = (token) => `${config.appBaseUrl}/convidado/${token}`;
const newToken = () => crypto.randomBytes(18).toString('base64url');

// Datas do cronograma (texto AAAA-MM-DD): episódio no ar = a ajustada ou a do episódio; cortes = segunda daquela semana (ou a ajustada);
// exclusivos = no dia em que o episódio sai (ou a ajustada).
const DATES_SQL = `
  WITH b AS (SELECT g.*, e.id AS episode_id, e.number AS episode_number, e.title AS episode_title, e.status AS episode_status,
                    e.youtube_url AS ep_youtube, e.spotify_url AS ep_spotify,
                    coalesce(g.portal_release_on, e.aired_on, (e.published_at AT TIME ZONE 'America/Sao_Paulo')::date) AS rel
               FROM guests g LEFT JOIN episodes e ON e.guest_id = g.id)
  SELECT b.*, to_char(rel, 'YYYY-MM-DD') AS release_on,
         to_char(coalesce(portal_cuts_from, rel - (extract(isodow FROM rel)::int - 1)), 'YYYY-MM-DD') AS cuts_from,
         to_char(coalesce(portal_exclusive_from, rel), 'YYYY-MM-DD') AS exclusive_from,
         to_char(portal_cuts_from, 'YYYY-MM-DD') AS cuts_from_set, to_char(portal_release_on, 'YYYY-MM-DD') AS release_on_set,
         to_char(portal_exclusive_from, 'YYYY-MM-DD') AS exclusive_from_set
    FROM b`;

async function byId(guestId) {
  const { rows: [g] } = await db.query(`${DATES_SQL} WHERE id = $1`, [guestId]);
  return g || null;
}
async function byToken(token) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const { rows: [g] } = await db.query(`${DATES_SQL} WHERE portal_token = $1 AND portal_enabled`, [token]);
  return g || null;
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); // AAAA-MM-DD
function dayLabel(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

// Por qual canal avisar: "automático" usa o e-mail; sem e-mail, o WhatsApp; sem nenhum, não avisa.
function channelOf(g) {
  if (g.portal_notify !== 'auto') return g.portal_notify;
  if (isEmail(g.email || '')) return 'email';
  return contacts.normalizeNumber(g.phone) ? 'whatsapp' : 'nenhum';
}

// ---------------------------------------------------------------- conteúdo
// Redes no ar de uma publicação (com link). Rascunho e simulação não contam.
const liveOf = (p) => (p.results || []).filter((r) => r.ok && !r.simulated && !r.draft && /^https?:\/\//.test(r.url || ''))
  .map((r) => ({ platform: r.platform, label: up.PLATFORMS[r.platform]?.label || r.platform, url: r.url }));

async function content(g) {
  const handle = igPeople.clean(g.instagram);
  const { rows: pubs } = await db.query(
    `SELECT p.id, p.clip_id, p.media, p.title, p.results, p.options, p.cover_id, p.cover_ids, p.updated_at, p.episode_id, c.cover_id AS clip_cover
       FROM episode_publications p LEFT JOIN episode_clips c ON c.id = p.clip_id
      WHERE (p.episode_id = $1 OR ($2 <> '' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(p.options->'instagram'->'collaborators', '[]'::jsonb)) x WHERE lower(ltrim(x, '@')) = $2)))
        AND p.status IN ('publicado', 'parcial')
      ORDER BY p.updated_at DESC, p.id DESC`, [g.episode_id || 0, handle]);
  const posts = [];
  for (const p of pubs) {
    const links = liveOf(p);
    if (!links.length) continue;
    const collabs = (p.options?.instagram?.collaborators || []).map(igPeople.clean);
    const igCollab = Boolean(handle) && collabs.includes(handle) && links.some((l) => l.platform === 'instagram');
    const ytCollab = Boolean(g.portal_yt_done_at) && !p.clip_id && p.media === 'video' && p.episode_id === g.episode_id && links.some((l) => l.platform === 'youtube');
    posts.push({
      id: p.id, title: p.title, at: p.updated_at, links, collab: igCollab || ytCollab, collabOn: [igCollab && 'Instagram', ytCollab && 'YouTube'].filter(Boolean),
      kind: p.clip_id ? 'Corte' : p.media === 'video' ? 'Episódio' : MEDIA_LABEL[p.media] || 'Post', episodeVideo: !p.clip_id && p.media === 'video',
      cover: p.clip_cover || p.cover_id || (p.cover_ids || [])[0] || null,
    });
  }
  const { rows: clips } = !g.episode_id ? { rows: [] } : await db.query(
    `SELECT c.id, c.title, c.post_title, c.caption, c.cover_id, c.duration_ms, c.size_bytes, c.for_guest
       FROM episode_clips c
      WHERE c.episode_id = $1 AND c.status = 'pronto' AND c.storage_key IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM episode_publications p WHERE p.clip_id = c.id)
      ORDER BY c.created_at, c.id`, [g.episode_id]);
  const { rows: files } = !g.episode_id ? { rows: [] } : await db.query(
    `SELECT id, kind, filename, size_bytes, for_guest FROM episode_files
      WHERE episode_id = $1 AND kind IN ('foto', 'bastidor') AND status = 'pronto' ORDER BY kind DESC, created_at, id`, [g.episode_id]);
  const photos = files.filter((f) => PHOTO_EXT.test(f.filename));
  const exclusiveOpen = Boolean(g.exclusive_from) && g.exclusive_from <= today();
  const episodeIg = posts.find((p) => p.episodeVideo && p.links.some((l) => l.platform === 'instagram'));
  return {
    handle, posts,
    collab: posts.filter((p) => p.collab),
    others: posts.filter((p) => !p.collab),
    exclusive: clips.filter((c) => c.for_guest), clipsOut: clips.filter((c) => !c.for_guest), exclusiveOpen,
    photos: photos.filter((f) => f.for_guest), photoChoices: photos,
    episode: {
      youtube: g.ep_youtube || null, spotify: g.ep_spotify || null,
      instagram: episodeIg ? episodeIg.links.find((l) => l.platform === 'instagram').url : null,
    },
  };
}

// Linha do tempo da semana, com o estado de cada passo (passou, hoje, vem).
function schedule(g) {
  const now = today();
  const steps = [];
  if (g.cuts_from) steps.push({ on: g.cuts_from, title: 'Começam os cortes em collab', text: 'Publicamos os cortes do episódio no nosso perfil e convidamos você como collab. A cada post novo, avisamos você.' });
  if (g.release_on) {
    const together = g.exclusive_from === g.release_on;
    steps.push({ on: g.release_on, title: together ? 'O episódio vai ao ar, com os seus cortes exclusivos' : 'O episódio vai ao ar',
      text: `O episódio completo sai no YouTube e no Spotify. Os links aparecem aqui assim que estiverem no ar.${together ? ' No mesmo dia, chegam os cortes que produzimos só para você postar no seu perfil.' : ''}` });
    if (g.exclusive_from && !together) steps.push({ on: g.exclusive_from, title: 'Cortes exclusivos para você', text: 'Cortes que produzimos só para você postar no seu perfil, com ou sem collab com o Pulso.' });
  }
  return steps.sort((a, b) => a.on.localeCompare(b.on))
    .map((s) => ({ ...s, label: dayLabel(s.on), state: s.on < now ? 'feito' : s.on === now ? 'hoje' : 'vem' }));
}

// ---------------------------------------------------------------- gestão
async function setEnabled(guestId, on) {
  await db.query('UPDATE guests SET portal_enabled = $2, portal_token = coalesce(portal_token, $3) WHERE id = $1', [guestId, on, newToken()]);
}
async function regenerate(guestId) {
  await db.query('UPDATE guests SET portal_token = $2 WHERE id = $1', [guestId, newToken()]);
}

// "2026-10-26" ou vazio (= automático). Devolve { values } ou { error }.
function parseDates(body) {
  const values = {};
  for (const [field, key] of [['cuts_from', 'cutsFrom'], ['release_on', 'releaseOn'], ['exclusive_from', 'exclusiveFrom']]) {
    const raw = String(body[field] || '').trim();
    if (!raw) { values[key] = null; continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T12:00:00Z`))) return { error: 'Data inválida. Use o seletor de data.' };
    values[key] = raw;
  }
  return { values };
}
async function saveDates(guestId, v) {
  await db.query('UPDATE guests SET portal_cuts_from = $2, portal_release_on = $3, portal_exclusive_from = $4 WHERE id = $1', [guestId, v.cutsFrom, v.releaseOn, v.exclusiveFrom]);
}
async function setNotify(guestId, channel) {
  if (!NOTIFY[channel]) return false;
  await db.query('UPDATE guests SET portal_notify = $2 WHERE id = $1', [guestId, channel]);
  return true;
}

// Fotos escolhidas para o portal: só as do episódio do convidado.
async function setPhotos(g, ids) {
  if (!g.episode_id) return;
  const list = [].concat(ids || []).map(Number).filter(Number.isInteger);
  await db.query("UPDATE episode_files SET for_guest = (id = ANY($2::int[])) WHERE episode_id = $1 AND kind IN ('foto', 'bastidor')", [g.episode_id, list]);
}

async function setYoutube(guestId, done) {
  await db.query('UPDATE guests SET portal_yt_done_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1', [guestId, done]);
}

// Pedido do convidado, pela página: o episódio no YouTube em collab com o canal dele.
function parseChannel(raw) {
  let s = String(raw || '').trim();
  const m = s.match(/youtube\.com\/(@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+)/i);
  if (m) [, s] = m;
  s = s.replace(/^\/+|\/+$/g, '');
  if (/^[\w.-]{3,40}$/.test(s)) s = `@${s}`;
  return /^(@[\w.-]{3,40}|channel\/[\w-]{10,40}|c\/[\w.-]{2,60})$/i.test(s) ? s : '';
}
async function requestYoutube(g, channel) {
  await db.query('UPDATE guests SET portal_yt_channel = $2, portal_yt_requested_at = now() WHERE id = $1', [g.id, channel]);
  const users = await teamIds();
  await require('./notify').notify({
    type: 'rotina', users, title: `${g.name} quer o episódio em collab no YouTube`, body: `Canal: ${channel}. Peça a collab no YouTube Studio e marque como feito no portal do convidado.`,
    url: `/convidados/${g.id}#portal`, entity: { type: 'guest', id: g.id }, dedupe: `portal-yt-${g.id}-${channel}`,
  }).catch((err) => console.error('Aviso do portal:', err.message));
}
const youtubeUrl = (channel) => (channel ? `https://www.youtube.com/${channel}` : null);

// Quem cuida dos convidados recebe os lembretes do portal (pedido de collab no YouTube, aviso pendente no WhatsApp).
async function teamIds() {
  const { rows } = await db.query("SELECT id FROM users WHERE active AND role IN ('superadmin', 'gestao', 'produtora')");
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------- avisos
// Mensagens do WhatsApp (a equipe abre o wa.me e envia do próprio aparelho).
const waTo = (g, text) => { const n = contacts.normalizeNumber(g.phone); return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null; };
const linkMessage = (g) => `Olá, ${firstName(g.name)}! Preparamos o seu portal no ${config.podcastName}. Lá ficam o cronograma da semana do episódio, os posts em collab com você, cortes exclusivos para você postar e as fotos da gravação. Ele vai se atualizando durante a semana: ${url(g.portal_token)}`;
const newsMessage = (g, posts) => `Olá, ${firstName(g.name)}! ${posts.length > 1 ? `Saíram ${posts.length} posts novos` : 'Saiu um post novo'} em collab com você:\n${posts.map((p) => `${p.title}: ${(p.links.find((l) => l.platform === 'instagram') || p.links[0]).url}`).join('\n')}\n\nCompartilhar nos stories e comentar ajuda o post a chegar mais longe. Está tudo no seu portal: ${url(g.portal_token)}`;

// Primeiro envio do link: o que já estava em collab não vira aviso (o convidado vê tudo ao abrir o portal).
async function markSent(g) {
  await db.query('UPDATE guests SET portal_sent_at = coalesce(portal_sent_at, now()) WHERE id = $1', [g.id]);
  const { collab } = await content(g);
  for (const p of collab) {
    await db.query("INSERT INTO guest_portal_notices (guest_id, publication_id, channel, sent_at) VALUES ($1, $2, 'nenhum', now()) ON CONFLICT DO NOTHING", [g.id, p.id]);
  }
}

async function sendLinkEmail(g) {
  if (!isEmail(g.email || '')) return { error: 'O convidado não tem e-mail no cadastro.' };
  await require('./mailer').sendGuestPortal({ to: g.email, guestName: g.name, url: url(g.portal_token), kind: 'link' });
  await markSent(g);
  return { ok: true };
}

async function pending(g) {
  const { rows } = await db.query('SELECT publication_id FROM guest_portal_notices WHERE guest_id = $1 AND sent_at IS NULL ORDER BY id', [g.id]);
  if (!rows.length) return [];
  const { collab } = await content(g);
  const ids = new Set(rows.map((r) => r.publication_id));
  return collab.filter((p) => ids.has(p.id));
}
async function markWhatsappSent(g) {
  await db.query('UPDATE guest_portal_notices SET sent_at = now() WHERE guest_id = $1 AND sent_at IS NULL', [g.id]);
}

// Rotina: posts novos em collab de quem já recebeu o link. E-mail sai na hora (um por rodada, com todos os novos); WhatsApp fica
// pendente na aba do convidado e a equipe recebe um lembrete.
async function tick() {
  const { rows } = await db.query(`${DATES_SQL} WHERE portal_enabled AND portal_sent_at IS NOT NULL AND portal_notify <> 'nenhum' AND instagram IS NOT NULL`);
  let sent = 0;
  for (const g of rows) {
    const channel = channelOf(g);
    const { collab } = await content(g);
    const fresh = [];
    for (const p of collab) {
      const { rowCount } = await db.query(
        'INSERT INTO guest_portal_notices (guest_id, publication_id, channel, sent_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [g.id, p.id, channel, channel === 'whatsapp' ? null : new Date()]);
      if (rowCount) fresh.push(p);
    }
    if (!fresh.length) continue;
    if (channel === 'email') {
      await require('./mailer').sendGuestPortal({ to: g.email, guestName: g.name, url: url(g.portal_token), kind: 'novos', posts: fresh })
        .catch((err) => console.error(`[portal do convidado ${g.id}] e-mail:`, err.message));
      sent += 1;
    } else if (channel === 'whatsapp') {
      await require('./notify').notify({
        type: 'rotina', users: await teamIds(), title: `Avisar ${g.name} no WhatsApp`, body: `${fresh.length > 1 ? `${fresh.length} posts novos` : 'Post novo'} em collab: ${fresh.map((p) => p.title).join(', ')}.`,
        url: `/convidados/${g.id}#portal`, entity: { type: 'guest', id: g.id }, dedupe: `portal-wa-${g.id}-${fresh.map((p) => p.id).join('-')}`,
      }).catch((err) => console.error('Aviso do portal:', err.message));
      sent += 1;
    }
  }
  return sent;
}

module.exports = {
  TOKEN_RE, NOTIFY, url, byId, byToken, content, schedule, dayLabel, today, channelOf, setEnabled, regenerate, parseDates, saveDates, setNotify,
  setPhotos, setYoutube, parseChannel, requestYoutube, youtubeUrl, waTo, linkMessage, newsMessage, markSent, sendLinkEmail, pending, markWhatsappSent, tick,
};
