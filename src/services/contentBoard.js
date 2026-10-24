// Linha de produção do conteúdo: cada peça (pedido, corte, post, carrossel, story) numa etapa só, cruzando com o Social para
// saber o que já saiu. Etapas: pedido -> em produção -> em revisão -> pronto para postar -> na fila (revisão do post/agendado/
// enviando) -> publicado. O quadro de Conteúdo, os cartões de corte e o "Novo post" do Social leem daqui.
const db = require('../db/pool');
const up = require('./uploadPost');
const requests = require('./contentRequests');

const STAGES = [
  { key: 'pedido', label: 'Pedido', hint: 'Pedidos para o editor que ainda não começaram.' },
  { key: 'producao', label: 'Em produção', hint: 'O editor está fazendo, ou o vídeo está subindo e sendo lido.' },
  { key: 'revisao', label: 'Em revisão', hint: 'Entregas esperando a gestão aprovar.' },
  { key: 'pronto', label: 'Pronto para postar', hint: 'Aprovado e ainda não publicado.' },
  { key: 'fila', label: 'Na fila', hint: 'Post montado: em revisão da gestão, agendado ou enviando.' },
  { key: 'publicado', label: 'Publicado', hint: 'Já saiu nas redes.' },
];
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));

// Publicação que conta para a etapa (simulado, erro e devolvido não gastam o conteúdo).
const COUNTS = ['publicado', 'parcial', 'agendado', 'enviando', 'revisao'];
const PLATFORM = (p) => up.PLATFORMS[p]?.label || p;

// Índice das publicações: por corte e por imagem. Cada entrada guarda a mais "avançada" (publicado vence fila).
async function publicationIndex() {
  const { rows } = await db.query(
    'SELECT id, clip_id, cover_ids, media, status, platforms, results, scheduled_at, updated_at FROM episode_publications WHERE status = ANY($1) ORDER BY updated_at', [COUNTS]);
  const byClip = new Map(); const byCover = new Map();
  const put = (map, key, p) => { const list = map.get(key) || []; list.push(p); map.set(key, list); };
  for (const p of rows) {
    if (p.clip_id) put(byClip, p.clip_id, p);
    for (const id of p.cover_ids || []) put(byCover, id, p);
  }
  return { byClip, byCover };
}

// Resumo de um conjunto de publicações: etapa, rótulo curto, redes e data.
function stateOf(pubs) {
  if (!pubs?.length) return null;
  const done = pubs.filter((p) => ['publicado', 'parcial'].includes(p.status));
  if (done.length) {
    const nets = [...new Set(done.flatMap((p) => ((p.results || []).filter((r) => r.ok).map((r) => r.platform).length ? (p.results || []).filter((r) => r.ok).map((r) => r.platform) : p.platforms)))];
    const last = done[done.length - 1];
    return { stage: 'publicado', label: 'publicado', platforms: nets.map(PLATFORM), at: last.updated_at, pubId: last.id, count: done.length };
  }
  const next = pubs[pubs.length - 1];
  const label = next.status === 'revisao' ? 'post em revisão' : next.status === 'agendado' ? 'agendado' : 'enviando';
  return { stage: 'fila', label, platforms: next.platforms.map(PLATFORM), at: next.scheduled_at || next.updated_at, pubId: next.id };
}
// Para um carrossel: todas as imagens precisam ter saído juntas; vale a publicação de qualquer slide.
const stateOfCovers = (idx, ids) => stateOf([...new Map(ids.flatMap((id) => idx.byCover.get(id) || []).map((p) => [p.id, p])).values()]);

const epLabel = (n, t) => (n ? `EP.${String(n).padStart(3, '0')}` : '') + (t ? `${n ? ' · ' : ''}${t}` : '');
const thumb = (id, at) => `/capas/${id}/imagem?v=${new Date(at).getTime()}`;

// Todas as peças, já com etapa. episodeId: só de um episódio. recentDays: corta o "Publicado" antigo (null = tudo).
async function build({ episodeId = null, recentDays = 60, today = new Date().toISOString().slice(0, 10) } = {}) {
  const idx = await publicationIndex();
  const epFilter = (col) => (episodeId ? ` AND ${col} = ${Number(episodeId)}` : '');
  const [reqs, clipRows, coverRows] = await Promise.all([
    db.query(`SELECT r.*, a.name AS assignee_name, e.number AS episode_number, e.title AS episode_title FROM content_requests r
      LEFT JOIN users a ON a.id = r.assignee_id LEFT JOIN episodes e ON e.id = r.episode_id WHERE r.status = ANY($1)${epFilter('r.episode_id')}`, [requests.OPEN]),
    db.query(`SELECT c.id, c.title, c.post_title, c.status, c.error, c.duration_ms, c.width, c.height, c.cover_id, c.episode_id, c.request_id, c.created_at,
        cv.updated_at AS cover_at, e.number AS episode_number, e.title AS episode_title, r.status AS request_status, r.kind AS request_kind, r.title AS request_title
      FROM episode_clips c LEFT JOIN episodes e ON e.id = c.episode_id LEFT JOIN episode_covers cv ON cv.id = c.cover_id LEFT JOIN content_requests r ON r.id = c.request_id
      WHERE (c.request_id IS NULL OR r.status = 'aprovado')${epFilter('c.episode_id')}`),
    db.query(`SELECT c.id, c.kind, c.group_key, c.position, c.label, c.width, c.height, c.approved, c.updated_at, c.created_at, c.episode_id, c.request_id,
        e.number AS episode_number, e.title AS episode_title, r.kind AS request_kind, r.title AS request_title, r.status AS request_status
      FROM episode_covers c LEFT JOIN episodes e ON e.id = c.episode_id LEFT JOIN content_requests r ON r.id = c.request_id
      WHERE c.clip_id IS NULL AND ((c.kind IN ('post_quote', 'post_split', 'carousel') AND c.request_id IS NULL) OR (c.kind = 'entrega' AND r.status = 'aprovado'))${epFilter('c.episode_id')}
      ORDER BY c.group_key, c.position, c.id`),
  ]);
  const cards = [];
  for (const r of reqs.rows) {
    cards.push({
      key: `r${r.id}`, type: 'pedido', stage: r.status === 'pedido' ? 'pedido' : r.status === 'producao' ? 'producao' : 'revisao',
      title: r.title, href: requests.url(r.id), kind: requests.KINDS[r.kind].label, episode: epLabel(r.episode_number, r.episode_title), episodeId: r.episode_id,
      who: r.assignee_name || 'sem responsável', due: r.due_on, late: requests.isLate(r, today), rounds: r.rounds, media: requests.KINDS[r.kind].media, at: r.updated_at,
    });
  }
  for (const c of clipRows.rows) {
    const st = c.status === 'pronto' ? stateOf(idx.byClip.get(c.id)) : null;
    const stage = c.status !== 'pronto' ? 'producao' : st ? st.stage : 'pronto';
    cards.push({
      key: `c${c.id}`, type: 'corte', stage, title: c.post_title || c.title, href: `/cortes/${c.id}`, kind: c.request_id ? requests.KINDS[c.request_kind]?.label || 'Vídeo' : 'Corte',
      episode: epLabel(c.episode_number, c.episode_title), episodeId: c.episode_id, thumb: c.cover_id ? thumb(c.cover_id, c.cover_at) : null, vertical: !c.width || c.height >= c.width,
      chip: c.status === 'erro' ? 'erro' : c.status === 'processando' ? 'lendo' : c.status === 'enviando' ? 'enviando' : null, pub: st, media: 'video', at: st?.at || c.created_at,
      warn: c.status === 'pronto' && !c.episode_id && !c.request_id ? 'atribuir episódio' : null, publishable: c.status === 'pronto' && Boolean(c.episode_id || c.request_id),
    });
  }
  // imagens: carrossel = um cartão por grupo; post e story = um por imagem
  const groups = new Map();
  for (const c of coverRows.rows) {
    const isCarousel = c.kind === 'carousel' || (c.kind === 'entrega' && c.request_kind === 'carrossel');
    if (isCarousel) { const k = c.group_key || `g${c.id}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); continue; }
    const st = stateOf(idx.byCover.get(c.id));
    const story = c.kind === 'entrega' && c.request_kind === 'story';
    cards.push({
      key: `i${c.id}`, type: story ? 'story' : 'post', stage: st ? st.stage : 'pronto', title: c.request_title || c.label || (c.kind === 'post_split' ? 'Tela dividida' : 'Post de frase'),
      href: c.request_id ? requests.url(c.request_id) : `/capas/${c.id}/editar`, kind: story ? 'Story' : c.kind === 'post_split' ? 'Tela dividida' : c.kind === 'entrega' ? 'Post' : 'Post de frase',
      episode: epLabel(c.episode_number, c.episode_title), episodeId: c.episode_id, thumb: thumb(c.id, c.updated_at), pub: st, media: story ? 'story' : 'imagem', coverIds: [c.id], approved: c.approved, at: st?.at || c.created_at, publishable: true,
    });
  }
  for (const [k, slides] of groups) {
    if (slides.length < 2) continue;
    const ids = slides.map((s) => s.id); const st = stateOfCovers(idx, ids); const first = slides[0];
    cards.push({
      key: `g${k}`, type: 'carrossel', stage: st ? st.stage : 'pronto', title: first.request_title || first.label || 'Carrossel', href: first.request_id ? requests.url(first.request_id) : `/capas/${first.id}/editar`,
      kind: 'Carrossel', episode: epLabel(first.episode_number, first.episode_title), episodeId: first.episode_id, thumb: thumb(first.id, first.updated_at), slides: slides.length, pub: st, media: 'carrossel', coverIds: ids, at: st?.at || first.created_at, publishable: true,
    });
  }
  const cutoff = recentDays ? Date.now() - recentDays * 86400_000 : null;
  const hiddenOld = cutoff ? cards.filter((c) => c.stage === 'publicado' && new Date(c.at).getTime() < cutoff).length : 0;
  const visible = cutoff ? cards.filter((c) => !(c.stage === 'publicado' && new Date(c.at).getTime() < cutoff)) : cards;
  const order = { pedido: (a, b) => String(a.due || '9').localeCompare(String(b.due || '9')) };
  const columns = STAGES.map((s) => ({ ...s, cards: visible.filter((c) => c.stage === s.key).sort(order[s.key] || ((a, b) => new Date(b.at) - new Date(a.at))) }));
  return { columns, cards, hiddenOld };
}

module.exports = { STAGES, STAGE_LABEL, COUNTS, publicationIndex, stateOf, stateOfCovers, build };
