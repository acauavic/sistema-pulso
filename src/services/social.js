// Social: o que já saiu nas redes, o que ainda dá para postar, ideias por episódio (com memória do que já foi feito),
// automações de comentários e directs (estilo ManyChat) e os números das contas. Tudo pelo Upload-Post.
// SEGURANÇA: sem UPLOAD_POST_LIVE=true nenhuma resposta, direct ou edição sai daqui — fica registrada como "simulado".
const db = require('../db/pool');
const config = require('../config');
const up = require('./uploadPost');
const gemini = require('./gemini');
const fin = require('./finalization');
const L = require('./platformLimits');
const jobs = require('./jobs');

// Publicação que "gasta" o conteúdo. Simulado, erro e devolvido não contam (o corte continua disponível); em revisão já reserva.
const USED = "('publicado','parcial','agendado','enviando','revisao')";

// ---------------------------------------------------------------- conteúdo para postar
// Cada item traz `pub` (o que já aconteceu no Social: publicado ou na fila) e `sugerido` (os primeiros a postar). Por padrão só
// vem o que ainda não saiu; includeUsed traz também o já publicado/agendado, marcado. Ordem de sugestão: do episódio que já foi
// ao ar mais recentemente (os cortes ajudam o episódio), entregas de pedidos aprovadas, imagens aprovadas, e o mais novo.
const SUGGEST = 3;
function rank(list, includeUsed) {
  const out = includeUsed ? list : list.filter((x) => !x.pub);
  out.sort((a, b) => (Boolean(a.pub) - Boolean(b.pub)) || (b.score - a.score) || (new Date(b.created_at) - new Date(a.created_at)));
  out.filter((x) => !x.pub).slice(0, SUGGEST).forEach((x) => { x.sugerido = true; });
  return out;
}
const scoreOf = (r) => (r.episode_status === 'publicado' ? 2e13 + new Date(r.published_at || r.aired_on || 0).getTime() / 100 : 0) + (r.approved_at ? 1e13 + new Date(r.approved_at).getTime() / 100 : 0) + (r.approved ? 5e12 : 0);

async function availableClips({ includeUsed = false } = {}) {
  const board = require('./contentBoard');
  const [{ rows }, idx] = await Promise.all([db.query(
    `SELECT c.id, c.title, c.post_title, c.caption, c.duration_ms, c.cover_id, c.episode_id, c.request_id, c.created_at, c.width, c.height,
            e.number AS episode_number, e.title AS episode_title, e.status AS episode_status, e.published_at, e.aired_on, r.title AS request_title, r.kind AS request_kind, r.approved_at,
            EXISTS (SELECT 1 FROM episode_publications p WHERE p.clip_id = c.id AND p.status = 'simulado') AS tested
       FROM episode_clips c LEFT JOIN episodes e ON e.id = c.episode_id LEFT JOIN content_requests r ON r.id = c.request_id
      WHERE c.status = 'pronto' AND c.storage_key IS NOT NULL
        AND ((c.request_id IS NULL AND c.episode_id IS NOT NULL) OR r.status = 'aprovado')
      ORDER BY c.created_at DESC LIMIT 300`), board.publicationIndex()]);
  return rank(rows.map((r) => ({ ...r, pub: board.stateOf(idx.byClip.get(r.id)), score: scoreOf(r) })), includeUsed);
}

// Imagens para postar. Story é só o que foi feito para story (entrega de pedido "Story"): capas de corte e thumbnails nunca
// entram (são capa, não post). Os posts 4:5 aparecem à parte como "post que também serve de story".
async function availableImages({ includeUsed = false } = {}) {
  const board = require('./contentBoard');
  const [{ rows }, idx] = await Promise.all([db.query(
    `SELECT c.id, c.kind, c.group_key, c.position, c.label, c.width, c.height, c.approved, c.created_at, c.updated_at, c.episode_id, c.request_id,
            e.number AS episode_number, e.title AS episode_title, e.status AS episode_status, e.published_at, e.aired_on, r.kind AS request_kind, r.title AS request_title, r.approved_at
       FROM episode_covers c LEFT JOIN episodes e ON e.id = c.episode_id LEFT JOIN content_requests r ON r.id = c.request_id
      WHERE c.clip_id IS NULL AND ((c.kind IN ('post_quote', 'post_split', 'carousel') AND c.request_id IS NULL AND c.episode_id IS NOT NULL) OR (c.kind = 'entrega' AND r.status = 'aprovado'))
      ORDER BY c.created_at DESC, c.group_key, c.position LIMIT 400`), board.publicationIndex()]);
  const item = (r) => ({ ...r, label: r.request_title || r.label, pub: board.stateOf(idx.byCover.get(r.id)), score: scoreOf(r) });
  const isPost = (r) => r.kind === 'post_quote' || r.kind === 'post_split' || (r.kind === 'entrega' && r.request_kind === 'post');
  const posts = rank(rows.filter(isPost).map(item), includeUsed);
  const stories = rank(rows.filter((r) => r.kind === 'entrega' && r.request_kind === 'story').map(item), includeUsed);
  const groups = new Map();
  for (const r of rows.filter((x) => x.kind === 'carousel' || (x.kind === 'entrega' && x.request_kind === 'carrossel'))) {
    const key = r.group_key || `c${r.id}`;
    if (!groups.has(key)) groups.set(key, { key, episode_id: r.episode_id, episode_number: r.episode_number, episode_title: r.episode_title, label: r.request_title || r.label, created_at: r.created_at, score: scoreOf(r), slides: [] });
    groups.get(key).slides.push(r);
  }
  const carousels = [...groups.values()].filter((g) => g.slides.length >= 2).map((g) => {
    g.slides.sort((a, b) => a.position - b.position);
    return { ...g, pub: board.stateOfCovers(idx, g.slides.map((x) => x.id)) };
  });
  return { posts, stories, storyPosts: posts.filter((p) => !p.pub), carousels: rank(carousels, includeUsed) };
}

// O que ainda não foi usado (resumo do assistente, contagens).
const unusedClips = () => availableClips();
const unusedImages = () => availableImages();

const STATUS_LABEL = { revisao: 'Em revisão', recusado: 'Devolvido', simulado: 'Simulado', enviando: 'Enviando', agendado: 'Agendado', publicado: 'Publicado', parcial: 'Parcial', erro: 'Erro' };
async function listPublications({ status = '', media = '', limit = 200 } = {}) {
  const where = []; const params = [];
  if (STATUS_LABEL[status]) { params.push(status); where.push(`p.status = $${params.length}`); }
  if (['video', 'imagem', 'carrossel', 'story'].includes(media)) { params.push(media); where.push(`p.media = $${params.length}`); }
  params.push(limit);
  const { rows } = await db.query(
    `SELECT p.*, e.number AS episode_number, e.title AS episode_title, c.title AS clip_title, u.name AS created_by_name
       FROM episode_publications p LEFT JOIN episodes e ON e.id = p.episode_id LEFT JOIN episode_clips c ON c.id = p.clip_id LEFT JOIN users u ON u.id = p.created_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY coalesce(p.scheduled_at, p.created_at) DESC LIMIT $${params.length}`, params);
  return rows;
}

// Edita uma publicação. Agendada: muda aqui (o envio é nosso). Publicada: manda a edição para as redes que deixam.
async function editPublication(pub, { title, description, scheduledAt }, user) {
  const t = L.tidy(title || pub.title); const d = description != null ? L.tidy(description) : pub.description;
  if (['agendado', 'revisao', 'recusado'].includes(pub.status)) { // ainda não saiu: muda aqui
    const check = pub.media === 'video'
      ? up.validate({ kind: pub.clip_id ? 'clip' : 'episode', platforms: pub.platforms, title: t, description: d, scheduledAt })
      : up.validatePhotos({ media: pub.media, platforms: pub.platforms, title: t, description: d, scheduledAt, count: pub.cover_ids.length });
    if (!check.ok) return { error: check.issues[0] };
    await db.query('UPDATE episode_publications SET title = $2, description = $3, scheduled_at = $4, edited_at = now(), updated_at = now() WHERE id = $1', [pub.id, t, d, scheduledAt || pub.scheduled_at]);
    return { ok: true, message: pub.status === 'agendado' ? 'Agendamento atualizado.' : 'Pedido atualizado.' };
  }
  if (!['publicado', 'parcial', 'simulado'].includes(pub.status)) return { error: 'Só dá para editar o que ainda não saiu ou o que já foi publicado.' };
  const api = require('./socialApi');
  const providers = api.providersOf(pub);
  if (!providers.some((p) => p.canEdit)) return { error: `Esta publicação saiu ${api.joinNames(providers.map((p) => p.by))}, que não ${providers.length > 1 ? 'editam' : 'edita'} post depois de publicado. Edite pelo app da rede (o texto aqui no painel não muda o que já está no ar).` };
  const results = []; const skipped = [];
  for (const r of (pub.results || []).filter((x) => x.ok)) {
    if (!up.EDITABLE[r.platform] || !api.get(r.provider || pub.provider).canEdit) { skipped.push(up.PLATFORMS[r.platform]?.label || r.platform); continue; }
    if (pub.status === 'simulado' || !r.post_id) { results.push({ platform: r.platform, simulated: true }); continue; }
    try { results.push({ platform: r.platform, ...(await up.editPost({ platform: r.platform, postId: r.post_id, title: t, description: d })) }); } catch (err) { return { error: err.message }; }
  }
  await db.query('UPDATE episode_publications SET title = $2, description = $3, edited_at = now(), updated_at = now() WHERE id = $1', [pub.id, t, d]);
  if (pub.episode_id) await db.query("INSERT INTO episode_events (episode_id, user_id, type, message) VALUES ($1,$2,'publicacao',$3)", [pub.episode_id, user.id, `Publicação editada: ${t}`]);
  const simulated = results.some((r) => r.simulated) || !config.uploadPost.live;
  const parts = [];
  if (results.length) parts.push(simulated ? 'Edição registrada (modo de teste: nada foi alterado nas redes).' : `Editado em ${results.map((r) => up.PLATFORMS[r.platform].label).join(', ')}.`);
  if (skipped.length) parts.push(`${skipped.join(', ')} não deixa editar pela API: edite pelo app da rede.`);
  return { ok: true, message: parts.join(' ') || 'Salvo.' };
}

// ---------------------------------------------------------------- ideias por episódio (com memória)
const IDEA_KINDS = { corte: 'Cortes', story: 'Stories', carrossel: 'Carrosséis' };
const fingerprint = (t) => fin.stripEmoji(String(t || '')).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const tokens = (t) => new Set(fingerprint(t).split(' ').filter((w) => w.length > 3));
function similar(a, b) { // Jaccard das palavras com mais de 3 letras
  const A = tokens(a); const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const w of A) if (B.has(w)) inter += 1;
  return inter / (A.size + B.size - inter);
}

const IDEAS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ideias: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          tipo: { type: 'STRING', enum: ['corte', 'story', 'carrossel'] },
          titulo: { type: 'STRING' }, gancho: { type: 'STRING' }, legenda: { type: 'STRING' },
          inicio_seg: { type: 'NUMBER' }, fim_seg: { type: 'NUMBER' }, frase: { type: 'STRING' },
          slides: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['tipo', 'titulo', 'gancho'],
      },
    },
  },
  required: ['ideias'],
};

// O que já existe para o episódio: ideias (qualquer status), cortes e publicações. Vai no pedido e filtra a resposta.
async function doneFor(episodeId) {
  const [ideas, clips, pubs] = await Promise.all([
    db.query('SELECT kind, title, status FROM social_ideas WHERE episode_id = $1', [episodeId]),
    db.query("SELECT coalesce(post_title, title) AS title FROM episode_clips WHERE episode_id = $1", [episodeId]),
    db.query('SELECT media, title FROM episode_publications WHERE episode_id = $1', [episodeId]),
  ]);
  return [...ideas.rows.map((r) => ({ kind: r.kind, title: r.title })), ...clips.rows.map((r) => ({ kind: 'corte', title: r.title })),
    ...pubs.rows.map((r) => ({ kind: r.media === 'carrossel' ? 'carrossel' : r.media === 'story' ? 'story' : 'corte', title: r.title }))].filter((x) => x.title);
}

async function episodeSource(episodeId) {
  const { rows: [episode] } = await db.query('SELECT * FROM episodes WHERE id = $1', [episodeId]);
  if (!episode) return null;
  const [{ rows: [guest] }, { rows: [tr] }, { rows: clipTr }] = await Promise.all([
    episode.guest_id ? db.query('SELECT * FROM guests WHERE id = $1', [episode.guest_id]) : { rows: [] },
    db.query('SELECT text, segments FROM episode_transcripts WHERE episode_id = $1', [episodeId]),
    db.query("SELECT transcript FROM episode_clips WHERE episode_id = $1 AND coalesce(transcript, '') <> ''", [episodeId]),
  ]);
  // transcrição com marcas de tempo (para o corte apontar início/fim); sem ela, as falas dos cortes já enviados
  let text = '';
  if (tr?.segments?.length) text = tr.segments.map((s) => `[${Math.round(s.start_ms / 1000)}s] ${s.text}`).join('\n');
  else if (tr?.text) text = tr.text;
  else text = clipTr.map((c) => c.transcript).join('\n\n');
  return { episode, guest: guest || null, text, timed: Boolean(tr?.segments?.length) };
}

// Gera ideias para UM episódio. Devolve { created, skipped, error }.
async function generateIdeas(episodeId, kinds, userId = null) {
  const want = kinds.filter((k) => IDEA_KINDS[k]);
  if (!want.length) return { created: 0, skipped: 0, error: 'Escolha o que sugerir.' };
  if (!config.geminiConfigured) return { created: 0, skipped: 0, error: 'IA (Gemini) não configurada neste servidor.' };
  const src = await episodeSource(episodeId);
  if (!src) return { created: 0, skipped: 0, error: 'Episódio não encontrado.' };
  if (!src.text || src.text.length < 200) return { created: 0, skipped: 0, error: 'Ainda não há transcrição deste episódio (ela sai na finalização ou com os cortes enviados).' };
  const done = await doneFor(episodeId);
  const per = { corte: 5, story: 3, carrossel: 2 };
  const parts = [{ text: [
    fin.MARCA, '', fin.buildContext({ episode: src.episode, guest: src.guest, sponsors: [] }), '',
    'Sugira conteúdo para as redes do Pulso a partir da conversa abaixo. Peça:',
    ...want.map((k) => `- ${per[k]} ideia(s) de ${k === 'corte' ? 'CORTE vertical (30 a 90 s): diga inicio_seg e fim_seg' + (src.timed ? ' usando as marcas [Ns] da transcrição' : ' (aproximado)') + ' e a frase mais forte dita no trecho' : k === 'story' ? 'STORY (1 a 3 telas): uma pergunta, enquete ou bastidor que puxe conversa' : 'CARROSSEL (5 a 8 slides): ensinamentos ou bastidores; slides = texto curto de cada slide'}.`),
    '- titulo: até 60 caracteres, sem clickbait; gancho: a primeira frase que prende; legenda: até 280 caracteres, sem hashtags e sem exclamações.',
    '- Use só o que foi dito na conversa. Não invente números, nomes ou promessas.',
    done.length ? `- NÃO repita nem reformule o que já foi feito ou sugerido para este episódio:\n${done.slice(0, 60).map((d) => `  · [${d.kind}] ${d.title}`).join('\n')}` : '',
    '', `Conversa:\n${L.fitWords(src.text, 24000)}`,
  ].filter(Boolean).join('\n') }];
  let data;
  try { ({ data } = await gemini.generateJson({ parts, schema: IDEAS_SCHEMA, temperature: 0.7, attempts: 2, timeoutMs: 90_000 })); } catch (err) {
    return { created: 0, skipped: 0, error: /429|quota|RESOURCE_EXHAUSTED/i.test(err.message) ? 'A cota gratuita da IA acabou por hoje. Tente amanhã ou ative o faturamento do Gemini.' : `A IA não respondeu: ${err.message}` };
  }
  let created = 0; let skipped = 0;
  const known = [...done];
  for (const i of data.ideias || []) {
    if (!want.includes(i.tipo)) { skipped += 1; continue; }
    const title = L.fitWords(fin.stripEmoji(i.titulo || '').replace(/[.!]+$/, ''), 60);
    if (!title || known.some((d) => d.kind === i.tipo && (fingerprint(d.title) === fingerprint(title) || similar(d.title, title) >= 0.6))) { skipped += 1; continue; }
    const body = {
      legenda: L.fitWords(L.stripAngles(fin.stripEmoji(i.legenda || '')), 320) || null,
      ...(i.tipo === 'corte' ? { inicio_seg: Number.isFinite(i.inicio_seg) ? Math.max(0, Math.round(i.inicio_seg)) : null, fim_seg: Number.isFinite(i.fim_seg) ? Math.round(i.fim_seg) : null, frase: fin.stripEmoji(i.frase || '') || null } : {}),
      ...(i.tipo === 'carrossel' ? { slides: (i.slides || []).map((t) => L.fitWords(fin.stripEmoji(t), 140)).filter(Boolean).slice(0, 10) } : {}),
    };
    const { rowCount } = await db.query(
      'INSERT INTO social_ideas (episode_id, kind, title, hook, body, fingerprint, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
      [episodeId, i.tipo, title, L.fitWords(fin.stripEmoji(i.gancho || ''), 200) || null, JSON.stringify(body), fingerprint(title), userId]);
    if (rowCount) { created += 1; known.push({ kind: i.tipo, title }); } else skipped += 1;
  }
  return { created, skipped, error: null };
}

// Vários episódios: vai para a fila (a IA demora). O resultado chega como notificação.
jobs.register('social_ideias', async (job, ctx) => {
  const { episodeIds = [], kinds = [], userId = null } = job.payload || {};
  let created = 0; const errors = [];
  for (const [n, id] of episodeIds.entries()) {
    await ctx.update(`Episódio ${n + 1} de ${episodeIds.length}`, Math.round((n / episodeIds.length) * 100));
    const r = await generateIdeas(id, kinds, userId);
    created += r.created;
    if (r.error) errors.push(r.error);
  }
  await require('./notify').notify({
    type: 'rotina', users: [userId], title: created ? `${created} ideia(s) nova(s) para as redes` : 'Nenhuma ideia nova para as redes',
    body: errors.length ? [...new Set(errors)].join(' ') : 'Veja em Social > Ideias.', url: '/social/ideias', dedupe: `ideias-${job.id}`,
  }).catch(() => {});
  return { created, errors };
});

// ---------------------------------------------------------------- automações (comentários e directs)
const has = (text, keywords) => {
  if (!keywords.length) return true;
  const t = fingerprint(text);
  return keywords.some((k) => { const n = fingerprint(k); return n && t.includes(n); });
};

async function record(rule, item, status, reply, error = null) {
  await db.query(
    `INSERT INTO social_events (rule_id, external_id, platform, author, text, reply, status, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (rule_id, external_id) DO UPDATE SET status = EXCLUDED.status, reply = EXCLUDED.reply, error = EXCLUDED.error
       WHERE social_events.status = 'pendente'`,
    [rule.id, item.id, rule.platform, item.author || null, L.fitWords(item.text || '', 500), reply, status, error ? String(error).slice(0, 300) : null]);
}

// Reserva o item ANTES de responder: se outro processo já pegou, não responde de novo.
async function claimItem(rule, item) {
  const { rowCount } = await db.query(
    `INSERT INTO social_events (rule_id, external_id, platform, author, text, status) VALUES ($1,$2,$3,$4,$5,'pendente') ON CONFLICT (rule_id, external_id) DO NOTHING`,
    [rule.id, item.id, rule.platform, item.author || null, L.fitWords(item.text || '', 500)]);
  return rowCount === 1;
}

async function seen(rule, ids) {
  if (!ids.length) return new Set();
  const { rows } = await db.query('SELECT external_id FROM social_events WHERE rule_id = $1 AND external_id = ANY($2::text[])', [rule.id, ids]);
  return new Set(rows.map((r) => r.external_id));
}

// Posts a vigiar: o post da regra ou os mais recentes da conta (até 10).
async function postsFor(rule) {
  if (rule.scope === 'post') return rule.post_url ? [{ postUrl: rule.post_url }] : [];
  const media = await up.recentMedia({ platform: rule.platform, limit: 10 });
  return media.map((m) => ({ postId: m.id }));
}

async function runCommentRule(rule) {
  let handled = 0;
  for (const post of await postsFor(rule)) {
    const comments = await up.listComments({ platform: rule.platform, ...post });
    const fresh = comments.filter((c) => !rule.active_since || !c.timestamp || new Date(c.timestamp) >= rule.active_since);
    const done = await seen(rule, fresh.map((c) => c.id));
    for (const c of fresh) {
      if (done.has(c.id)) continue;
      const item = { id: c.id, author: c.username, text: c.text };
      if (!has(c.text, rule.keywords)) { await record(rule, item, 'ignorado', null); continue; }
      if (!(await claimItem(rule, item))) continue;
      const replies = [];
      try {
        let simulated = !config.uploadPost.live;
        if (rule.action === 'dm' || rule.action === 'ambos') { const r = await up.privateReply({ commentId: c.id, message: rule.message, buttons: rule.buttons }); simulated = simulated || r.simulated; replies.push(`DM: ${rule.message}`); }
        if (rule.action === 'resposta' || rule.action === 'ambos') { const txt = rule.reply_text || rule.message; const r = await up.replyComment({ platform: rule.platform, commentId: c.id, message: txt }); simulated = simulated || r.simulated; replies.push(`Resposta: ${txt}`); }
        await record(rule, item, simulated ? 'simulado' : 'enviado', replies.join(' · '));
        handled += 1;
      } catch (err) { await record(rule, item, 'erro', replies.join(' · ') || null, err.message); }
    }
  }
  return handled;
}

async function runDirectRule(rule) {
  const conn = await up.connected();
  const me = (conn.platforms?.instagram?.handle || '').replace(/^@/, '').toLowerCase();
  let handled = 0;
  for (const conv of await up.dmConversations()) {
    const inbound = conv.messages.filter((m) => m.from && m.from.toLowerCase() !== me && (!rule.active_since || !m.at || new Date(m.at) >= rule.active_since));
    const done = await seen(rule, inbound.map((m) => m.id));
    for (const m of inbound) {
      if (done.has(m.id)) continue;
      const item = { id: m.id, author: m.from, text: m.text };
      if (!has(m.text, rule.keywords)) { await record(rule, item, 'ignorado', null); continue; }
      if (!(await claimItem(rule, item))) continue;
      try {
        const r = await up.sendDm({ recipientId: m.fromId, message: rule.message, buttons: rule.buttons });
        await record(rule, item, r.simulated ? 'simulado' : 'enviado', `DM: ${rule.message}`);
        handled += 1;
      } catch (err) { await record(rule, item, 'erro', null, err.message); }
    }
  }
  return handled;
}

let running = false;
// Roda de tempos em tempos (index.js). Erros ficam na própria regra, à vista na tela.
async function runRules() {
  if (running || !config.uploadPostConfigured) return 0;
  await require('./socialApi').syncLive(); // responder de verdade ou só simular: chave de Integrações
  running = true;
  let total = 0;
  try {
    const { rows: rules } = await db.query('SELECT * FROM social_rules WHERE active ORDER BY id');
    for (const rule of rules) {
      try {
        total += rule.trigger === 'direct' ? await runDirectRule(rule) : await runCommentRule(rule);
        await db.query('UPDATE social_rules SET last_run_at = now(), last_error = NULL WHERE id = $1', [rule.id]);
      } catch (err) {
        await db.query('UPDATE social_rules SET last_run_at = now(), last_error = $2 WHERE id = $1', [rule.id, String(err.message).slice(0, 300)]);
      }
    }
  } finally { running = false; }
  return total;
}

// ---------------------------------------------------------------- insights
const METRICS = [['followers', 'Seguidores'], ['views', 'Visualizações'], ['reach', 'Alcance'], ['likes', 'Curtidas'], ['comments', 'Comentários'], ['shares', 'Compartilhamentos']];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

// Números atuais (no máximo uma consulta por hora, guardados como a foto do dia) + a foto de 7 dias atrás para comparar.
async function insights({ force = false } = {}) {
  const out = { ok: config.uploadPostConfigured, error: null, platforms: {}, updatedAt: null };
  if (!config.uploadPostConfigured) { out.error = 'Upload-Post não configurado neste servidor.'; return out; }
  const conn = await up.connected();
  if (!conn.ok) { out.error = conn.error; return out; }
  const names = Object.keys(conn.platforms).filter((p) => ['instagram', 'tiktok', 'youtube', 'facebook', 'linkedin', 'x', 'threads'].includes(p));
  const { rows: fresh } = await db.query("SELECT platform, data, updated_at FROM social_snapshots WHERE taken_on = $1 AND updated_at > now() - interval '1 hour'", [today()]);
  let current = Object.fromEntries(fresh.map((r) => [r.platform, r.data]));
  if (force || !fresh.length) { // rede que não devolve números não força nova consulta
    try {
      current = await up.analytics(names);
      for (const [p, data] of Object.entries(current)) {
        await db.query(`INSERT INTO social_snapshots (taken_on, platform, data) VALUES ($1,$2,$3)
                        ON CONFLICT (taken_on, platform) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [today(), p, JSON.stringify(data)]);
      }
    } catch (err) { out.error = `Não foi possível ler os números agora: ${err.message}`; }
  }
  const { rows: week } = await db.query("SELECT DISTINCT ON (platform) platform, data FROM social_snapshots WHERE taken_on <= ($1::date - 7) ORDER BY platform, taken_on DESC", [today()]);
  const before = Object.fromEntries(week.map((r) => [r.platform, r.data]));
  for (const p of names) {
    const cur = current[p] || null;
    out.platforms[p] = { handle: conn.platforms[p].handle, current: cur, metrics: METRICS.map(([k, label]) => ({ key: k, label, value: cur?.[k] ?? null, delta: cur?.[k] != null && before[p]?.[k] != null ? cur[k] - before[p][k] : null })) };
  }
  const { rows: [u] } = await db.query('SELECT max(updated_at) AS at FROM social_snapshots WHERE taken_on = $1', [today()]);
  out.updatedAt = u?.at || null;
  return out;
}

// O que a equipe publicou nos últimos 30 dias (dos nossos registros).
async function ourActivity() {
  const { rows } = await db.query(
    `SELECT media, status, count(*)::int AS n FROM episode_publications WHERE created_at > now() - interval '30 days' GROUP BY media, status`);
  const { rows: byPlatform } = await db.query(
    `SELECT unnest(platforms) AS platform, count(*)::int AS n FROM episode_publications WHERE created_at > now() - interval '30 days' AND status IN ('publicado','parcial') GROUP BY 1 ORDER BY 2 DESC`);
  const total = (filter) => rows.filter(filter).reduce((s, r) => s + r.n, 0);
  return {
    published: total((r) => ['publicado', 'parcial'].includes(r.status)), scheduled: total((r) => r.status === 'agendado'), failed: total((r) => r.status === 'erro'), tested: total((r) => r.status === 'simulado'),
    byMedia: ['video', 'imagem', 'carrossel', 'story'].map((m) => ({ media: m, n: total((r) => r.media === m && ['publicado', 'parcial'].includes(r.status)) })),
    byPlatform,
  };
}

module.exports = {
  USED, STATUS_LABEL, IDEA_KINDS, METRICS, unusedClips, unusedImages, availableClips, availableImages, listPublications, editPublication,
  fingerprint, similar, doneFor, generateIdeas, has, runRules, runCommentRule, runDirectRule, insights, ourActivity,
};
