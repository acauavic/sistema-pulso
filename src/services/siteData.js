// Dados públicos do site (podcastpulso.com): o que o site mostra sai daqui, em um JSON só (GET /api/site/v1/dados).
// Só entra o que já é público (nome, @, tema, links, logo). Telefone, e-mail, valor, responsável, notas, tokens e chaves
// do bucket nunca saem: cada consulta escolhe as colunas uma a uma, e as imagens vão por endereço assinado (siteImages).
const db = require('../db/pool');
const kitGallery = require('./kitGallery');
const audience = require('./audience');
const siteImages = require('./siteImages');

const TZ = 'America/Sao_Paulo';
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

// "@fulana", "instagram.com/fulana/" ou "fulana" → "fulana" (o mesmo do media kit).
function handleOf(ig) {
  let s = String(ig ?? '').trim();
  const url = s.match(/instagram\.com\/([^/?#\s]+)/i); // com ou sem https://, com ou sem www.
  if (url) [, s] = url;
  s = s.replace(/^@+/, '').replace(/\/.*$/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(s) ? s.toLowerCase() : null;
}

// Link para o site: só http(s), sem espaço nem aspas. "marca.com.br" vira "https://marca.com.br".
function publicUrl(value) {
  let s = String(value ?? '').trim();
  if (!s || /[\s"'<>]/.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return ['http:', 'https:'].includes(u.protocol) && u.hostname.includes('.') ? s : null;
  } catch { return null; }
}

const ID_RE = /^[A-Za-z0-9_-]{6,32}$/;
// YouTube: watch?v=, youtu.be/, /shorts/, /live/ (e /embed/).
function youtubeId(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/) || [])[1];
  }
  return id && ID_RE.test(id) ? id : null;
}

// Spotify: open.spotify.com/(intl-xx/)?(episode|show)/<id>
function spotifyRef(url) {
  const m = String(url || '').match(/^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2,4})?\/)?(episode|show)\/([A-Za-z0-9]{10,40})(?:[/?#]|$)/i);
  return m ? { kind: m[1].toLowerCase(), id: m[2] } : { kind: null, id: null };
}

const photoOf = (r) => (r.has_photo ? siteImages.signedUrl('foto', r.guest_id) : null);
const coverOf = (id) => (id ? siteImages.signedUrl('capa', id) : null);

async function mesa() {
  const rows = (await kitGallery.candidates()).filter((r) => r.kit_featured && r.guest_id);
  return rows.map((r) => ({
    name: r.guest_name,
    credential: kitGallery.credentialOf(r) || '',
    handle: handleOf(r.instagram),
    audience: r.kit_audience || r.guest_reach || '—', // o mesmo texto do media kit
    ep: r.number ?? null,
    photo: photoOf(r),
  }));
}

async function episodios() {
  const { rows } = await db.query(
    `SELECT e.number, e.title, g.name AS guest, e.youtube_url, e.spotify_url,
            to_char(coalesce(e.aired_on, (e.published_at AT TIME ZONE '${TZ}')::date), 'YYYY-MM-DD') AS aired_on,
            c.id AS cover_id
       FROM episodes e
       LEFT JOIN guests g ON g.id = e.guest_id
       LEFT JOIN episode_metadata m ON m.episode_id = e.id
       LEFT JOIN episode_covers c ON c.id = coalesce(m.thumb_cover_id,
            (SELECT t.id FROM episode_covers t WHERE t.episode_id = e.id AND t.kind = 'youtube_thumb' ORDER BY t.approved DESC, t.updated_at DESC, t.id DESC LIMIT 1))
      WHERE e.status = 'publicado' AND (coalesce(e.youtube_url, '') <> '' OR coalesce(e.spotify_url, '') <> '')
      ORDER BY coalesce(e.aired_on, (e.published_at AT TIME ZONE '${TZ}')::date) DESC NULLS LAST, e.number DESC NULLS LAST, e.id DESC`);
  // o filtro do link (só http/https) vem antes do corte em 24: um link quebrado não tira um episódio bom da lista
  return rows.map((r) => {
    const youtube = publicUrl(r.youtube_url);
    const spotify = publicUrl(r.spotify_url);
    const sp = spotify ? spotifyRef(spotify) : { kind: null, id: null };
    return {
      number: r.number ?? null, title: r.title, guest: r.guest || null, aired_on: r.aired_on || null,
      youtube_url: youtube, spotify_url: spotify,
      youtube_id: youtube ? youtubeId(youtube) : null, spotify_kind: sp.kind, spotify_id: sp.id,
      cover: coverOf(r.cover_id),
    };
  }).filter((e) => e.youtube_url || e.spotify_url).slice(0, 24);
}

// Posts do Instagram que estão no ar (o link que a rede devolveu), o mais recente primeiro. Reel de teste fica de fora: o sistema
// não sabe quando ele é liberado para os seguidores (isso acontece no app), então só entra o post normal.
// Capa: a da publicação, senão a escolhida no corte, senão a primeira da lista; só a que ainda existe.
async function posts() {
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (x->>'url') x->>'url' AS url, p.title, coalesce(p.scheduled_at, p.created_at) AS published_at, coalesce(c1.id, c2.id, c3.id) AS cover_id
         FROM episode_publications p
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.results) = 'array' THEN p.results ELSE '[]'::jsonb END) x
         LEFT JOIN episode_clips cl ON cl.id = p.clip_id
         LEFT JOIN episode_covers c1 ON c1.id = p.cover_id
         LEFT JOIN episode_covers c2 ON c2.id = cl.cover_id
         LEFT JOIN episode_covers c3 ON c3.id = p.cover_ids[1]
        WHERE p.status IN ('publicado', 'parcial') AND x->>'platform' = 'instagram' AND x->>'ok' = 'true'
          AND coalesce(p.options->'instagram'->>'trial', '') IN ('', 'false', '0')
          AND x->>'url' ~ '^https://(www\\.)?instagram\\.com/'
        ORDER BY x->>'url', coalesce(p.scheduled_at, p.created_at) DESC
     ) t ORDER BY published_at DESC LIMIT 12`);
  return rows.filter((r) => publicUrl(r.url)).map((r) => ({
    url: r.url, title: r.title, published_at: new Date(r.published_at).toISOString(), cover: coverOf(r.cover_id),
  }));
}

async function agenda(plateiaActive) {
  const today = todayISO();
  const [estreias, gravacoes] = await Promise.all([
    db.query(
      `SELECT * FROM (
         SELECT to_char(e.aired_on, 'YYYY-MM-DD') AS date, g.id AS guest_id, g.name, g.instagram, g.topic, (g.photo_key IS NOT NULL) AS has_photo, 0 AS ord
           FROM episodes e JOIN guests g ON g.id = e.guest_id
          WHERE e.status <> 'publicado' AND e.aired_on >= $1::date AND g.status NOT IN ('cancelado', 'perdido')
         UNION ALL
         SELECT to_char(g.premiere_on, 'YYYY-MM-DD'), g.id, g.name, g.instagram, g.topic, (g.photo_key IS NOT NULL), 1
           FROM guests g
          WHERE g.status = 'agendado' AND g.premiere_on >= $1::date AND NOT EXISTS (SELECT 1 FROM episodes e WHERE e.guest_id = g.id)
       ) x ORDER BY date, ord, lower(name) LIMIT 24`, [today]),
    db.query(
      `SELECT g.id AS guest_id, g.name, g.instagram, g.topic, (g.photo_key IS NOT NULL) AS has_photo, g.proposed_at,
              (g.audience_enabled AND g.audience_status = 'disponivel' AND g.proposed_at > now()) AS plateia
         FROM guests g
        WHERE g.status = 'agendado' AND (g.proposed_at IS NULL OR g.proposed_at >= now() - interval '1 day')
          AND NOT EXISTS (SELECT 1 FROM episodes e WHERE e.guest_id = g.id)
        ORDER BY g.proposed_at NULLS LAST, lower(g.name) LIMIT 24`),
  ]);
  return {
    vai_ao_ar: estreias.rows.map((r) => ({ date: r.date, name: r.name, handle: handleOf(r.instagram), topic: r.topic || null, photo: photoOf(r) })),
    gravacoes: gravacoes.rows.map((r) => ({
      at: r.proposed_at ? new Date(r.proposed_at).toISOString() : null, name: r.name, handle: handleOf(r.instagram), topic: r.topic || null, photo: photoOf(r),
      plateia: Boolean(plateiaActive && r.plateia), // só quando a plateia está aberta (Plateia > Ajustes)
    })),
  };
}

// Patrocinador oficial (no máximo um) e apoiadores, só de quem fechou (ganho, ativo ou inativo). "Esconder do site" vale para os dois:
// escondido não aparece em lugar nenhum.
async function patrocinio() {
  const { rows } = await db.query(
    `SELECT s.id, s.company, s.website, s.site_official,
            EXISTS (SELECT 1 FROM sponsor_files f WHERE f.sponsor_id = s.id AND f.kind = 'logo' AND f.status = 'pronto') AS has_logo
       FROM sponsors s
      WHERE NOT s.site_hidden AND s.stage IN ('ganho', 'ativo', 'inativo') -- vale também para o oficial
      ORDER BY s.starts_on NULLS LAST, lower(s.company), s.id`);
  const logo = (r) => (r.has_logo ? siteImages.signedUrl('logo', r.id) : null);
  const official = rows.find((r) => r.site_official);
  return {
    patrocinador_oficial: official ? { company: official.company, website: publicUrl(official.website), logo: logo(official) } : null,
    apoiadores: rows.filter((r) => !r.site_official && r.has_logo).map((r) => ({ company: r.company, website: publicUrl(r.website), logo: logo(r) })),
  };
}

async function build() {
  const s = await audience.settings();
  const [m, eps, ps, ag, pat, abertas] = await Promise.all([
    mesa(), episodios(), posts(), agenda(s.active), patrocinio(), s.active ? audience.agenda().then((a) => a.length) : 0,
  ]);
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    mesa: m,
    episodios: eps,
    posts: ps,
    agenda: ag,
    patrocinador_oficial: pat.patrocinador_oficial,
    apoiadores: pat.apoiadores,
    plateia: { abertas },
  };
}

module.exports = { build, youtubeId, spotifyRef, publicUrl, handleOf };
