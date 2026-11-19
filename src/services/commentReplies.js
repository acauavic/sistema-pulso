// Respostas por IA nos comentários dos posts (Social > Comentários).
// Entrada: o aviso comment.received da Outstand (na hora) e uma varredura por hora dos posts recentes (pega o que o aviso perdeu e
// os Reels de teste). Cada comentário vira uma linha em social_comments; a IA (Gemini) propõe o que fazer: responder, reagir com
// um emoji, ignorar ou chamar a equipe. No modo "aprovar antes" a resposta espera alguém aprovar; no "automático" já entra na fila.
// Envio: uma por vez, com intervalo aleatório, até N por hora e só no horário escolhido (para a conta não parecer robô).
const db = require('../db/pool');
const config = require('../config');
const settings = require('./settings');
const jobs = require('./jobs');
const gemini = require('./gemini');

const KEY = 'respostas_ia';
const SEND_KEY = 'respostas_ia_envio';
const NETWORKS = ['instagram', 'facebook', 'threads'];
const NETWORK_LABEL = { instagram: 'Instagram', facebook: 'Facebook', threads: 'Threads' };
const MODES = { aprovar: 'Aprovar antes', automatico: 'Automático' };
const DEFAULTS = { on: false, mode: 'aprovar', per_hour: 25, from: 8, to: 23, team_handles: [] };
const REPLY_MAX = 300;
const MIN_CONFIDENCE = 0.6;
const MAX_AI_PER_PERSON = 2; // respostas da IA à mesma pessoa no mesmo post (a conversa continua, mas não vira bate-boca)
const EMOJIS = ['🙌', '🔥', '💚', '✨', '🫶', '💯', '👏'];
// Em que aba cada estado aparece na tela.
const VIEWS = {
  equipe: { label: 'Precisam de você', statuses: ['equipe', 'erro'] },
  aprovar: { label: 'Para aprovar', statuses: ['proposta'] },
  fila: { label: 'Na fila', statuses: ['aprovada'] },
  enviadas: { label: 'Enviadas', statuses: ['enviada', 'simulada', 'apagada'] },
  ignoradas: { label: 'Ignoradas', statuses: ['ignorada', 'respondida'] },
};

const parseJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
const handleOf = (s) => String(s || '').trim().replace(/^@/, '').toLowerCase();
const clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

// ---------------------------------------------------------------- configuração
async function getConfig() {
  const v = { ...DEFAULTS, ...parseJson(await settings.get(KEY), {}) };
  return { ...v, team_handles: Array.isArray(v.team_handles) ? v.team_handles : [] };
}
// Lê o formulário da janela de configuração (ou só o interruptor: { on }).
async function setConfig(body, { onlyToggle = false } = {}) {
  const cur = await getConfig();
  const next = onlyToggle ? { ...cur, on: String(body.on) === '1' } : {
    ...cur,
    mode: MODES[body.mode] ? body.mode : cur.mode,
    per_hour: clampInt(body.per_hour, 1, 60, cur.per_hour),
    from: clampInt(body.from, 0, 23, cur.from),
    to: clampInt(body.to, 1, 24, cur.to),
    team_handles: [...new Set(String(body.team_handles || '').split(/[\s,;]+/).map(handleOf).filter((h) => /^[a-z0-9._]{1,30}$/.test(h)))].slice(0, 40),
  };
  if (!onlyToggle && next.to <= next.from) return { error: 'O horário de fim precisa ser depois do de início.' };
  await settings.set(KEY, JSON.stringify(next));
  return { config: next };
}
const summary = (c) => `${MODES[c.mode].toLowerCase()} · até ${c.per_hour} por hora, das ${c.from}h às ${c.to}h`;

// ---------------------------------------------------------------- posts acompanhados
// Cada rede de cada publicação que saiu pela Outstand, com o contexto que a IA usa. days: só as publicadas nesse período.
async function watchedPosts({ days = 14, pubId = null } = {}) {
  const params = [NETWORKS];
  let where = '';
  if (pubId) { params.push(pubId); where = `AND p.id = $${params.length}`; } else { params.push(String(days)); where = `AND p.ai_replies AND coalesce(p.scheduled_at, p.created_at) >= now() - ($${params.length} || ' days')::interval`; }
  const { rows } = await db.query(
    `SELECT p.id AS publication_id, x->>'platform' AS network, x->>'ref' AS post_ref, x->>'post_id' AS platform_post_id, x->>'url' AS url
       FROM episode_publications p CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.results, '[]'::jsonb)) x
      WHERE x->>'provider' = 'outstand' AND coalesce(x->>'ref', '') <> '' AND (x->>'ok')::boolean IS NOT FALSE
        AND p.status IN ('publicado', 'parcial') AND x->>'platform' = ANY($1) ${where}
      ORDER BY p.id DESC`, params);
  return rows;
}

// O que a IA precisa saber do post: título, legenda, convidado (e o @), se é Reel de teste.
async function postContext(pubId) {
  const { rows: [r] } = await db.query(
    `SELECT p.id, coalesce(cl.post_title, cl.title, p.title) AS title, left(coalesce(p.description, ''), 600) AS caption,
            g.name AS guest, g.instagram AS guest_ig, e.number AS ep_number, e.title AS ep_title,
            coalesce(p.options->'instagram'->>'trial', 'false') NOT IN ('false', '') AS trial
       FROM episode_publications p LEFT JOIN episode_clips cl ON cl.id = p.clip_id
       LEFT JOIN episodes e ON e.id = coalesce(p.episode_id, cl.episode_id) LEFT JOIN guests g ON g.id = e.guest_id
      WHERE p.id = $1`, [pubId]);
  return r || null;
}

async function ourHandles() {
  const conn = await require('./outstand').connected().catch(() => ({ platforms: {} }));
  const out = {};
  for (const n of NETWORKS) out[n] = handleOf(conn.platforms?.[n]?.handle);
  return out;
}

// ---------------------------------------------------------------- entrada
// Grava os comentários de um post. Comentário que já tem resposta do Pulso fica "respondida"; resposta de terceiros a outra
// pessoa fica de fora; resposta à resposta do Pulso entra (a conversa continua). Devolve quantos entraram como novos.
async function ingest(post, comments, mine) {
  let fresh = 0;
  const me = handleOf(mine);
  // No Instagram, a resposta do Pulso vem aninhada sem o @ e repetida no primeiro nível com o @: é nossa se o id está lá.
  const ourIds = new Set(comments.filter((k) => me && handleOf(k.username) === me).map((k) => String(k.id)));
  const isOurs = (x) => Boolean((me && handleOf(x.username) === me) || ourIds.has(String(x.id)));
  for (const k of comments) {
    if (ourIds.has(String(k.id))) continue; // comentário (ou resposta) da própria conta
    const replies = k.replies || [];
    const oursAt = replies.findIndex(isOurs);
    const thread = replies.slice(0, 20).map((x) => ({ id: x.id, usuario: isOurs(x) ? me : (x.username || null), texto: String(x.text || '').slice(0, 400), pulso: isOurs(x) }));
    const base = [post.network, post.post_ref, post.platform_post_id, post.publication_id];
    if (oursAt >= 0) {
      // já respondido (pelo sistema ou à mão no app): não responde de novo
      await db.query(
        `INSERT INTO social_comments (network, post_ref, platform_post_id, publication_id, comment_id, author_username, text, commented_at, likes, thread, status, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'respondida','O Pulso já respondeu este comentário.')
         ON CONFLICT (provider, network, comment_id) DO UPDATE SET thread = EXCLUDED.thread, likes = EXCLUDED.likes, updated_at = now(),
           status = CASE WHEN social_comments.status IN ('nova','proposta','equipe','aprovada','erro') THEN 'respondida' ELSE social_comments.status END,
           reason = CASE WHEN social_comments.status IN ('nova','proposta','equipe','aprovada','erro') THEN EXCLUDED.reason ELSE social_comments.reason END`,
        [...base, k.id, k.username, String(k.text || '').slice(0, 2000), k.timestamp, k.likes || 0, JSON.stringify(thread)]);
      // quem comentou voltou a responder depois do Pulso: a conversa continua (até MAX_AI_PER_PERSON respostas da IA)
      const oursCount = replies.filter(isOurs).length;
      const lastOurs = replies.map(isOurs).lastIndexOf(true);
      const back = replies.slice(lastOurs + 1).filter((x) => handleOf(x.username) === handleOf(k.username) && String(x.text || '').trim());
      if (back.length && oursCount < MAX_AI_PER_PERSON) {
        const x = back[back.length - 1];
        const { rowCount } = await db.query(
          `INSERT INTO social_comments (network, post_ref, platform_post_id, publication_id, comment_id, parent_comment_id, author_username, text, commented_at, thread)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (provider, network, comment_id) DO NOTHING`,
          [...base, x.id, k.id, x.username, String(x.text || '').slice(0, 2000), x.timestamp || null,
            JSON.stringify([{ id: k.id, usuario: k.username, texto: String(k.text || '').slice(0, 400), pulso: false }, ...thread])]);
        fresh += rowCount;
      }
      continue;
    }
    const { rows: [ins] } = await db.query(
      `INSERT INTO social_comments (network, post_ref, platform_post_id, publication_id, comment_id, author_username, text, commented_at, likes, thread)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (provider, network, comment_id) DO UPDATE SET thread = EXCLUDED.thread, likes = EXCLUDED.likes, updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [...base, k.id, k.username, String(k.text || '').slice(0, 2000), k.timestamp, k.likes || 0, JSON.stringify(thread)]);
    if (ins?.inserted) fresh += 1;
  }
  return fresh;
}

// Lê os comentários de um post na Outstand e grava. -> { read, error }
async function fetchPost(post, mine) {
  try {
    const list = await require('./outstand').listComments({ postRef: post.post_ref, network: post.network });
    await ingest(post, list, mine[post.network]);
    return { read: list.length };
  } catch (err) { return { read: 0, error: err.message }; }
}

// Varredura: lê os posts dos últimos `days` dias (ou só um) e põe a triagem na fila de cada post com comentário novo.
async function sweep({ days = 14, pubId = null, force = false } = {}) {
  const c = await getConfig();
  if (!force && !c.on) return { posts: 0, skipped: 'desligada' };
  if (!config.outstandConfigured) return { posts: 0, skipped: 'sem Outstand' };
  const posts = await watchedPosts({ days, pubId });
  const mine = await ourHandles();
  let errors = 0;
  for (const post of posts) {
    const r = await fetchPost(post, mine);
    if (r.error) errors += 1;
    await new Promise((res) => setTimeout(res, process.env.NODE_ENV === 'test' ? 0 : 300));
  }
  const pubs = [...new Set(posts.map((p) => p.publication_id))];
  const { rows: pending } = pubs.length ? await db.query("SELECT DISTINCT publication_id FROM social_comments WHERE status = 'nova' AND publication_id = ANY($1)", [pubs]) : { rows: [] };
  for (const r of pending) await jobs.enqueue('comentarios_ia', { refId: r.publication_id, maxAttempts: 4 });
  await settings.set(`${KEY}_varredura`, JSON.stringify({ at: new Date().toISOString(), posts: posts.length, errors }));
  return { posts: posts.length, errors, queued: pending.length };
}

// Aviso comment.received: lê o post inteiro daqui a 1 minuto (junta comentários que chegam em sequência) e faz a triagem.
async function fromWebhook({ network, post_ref: postRef, platform_post_id: platformPostId, comment_id: commentId = null, parent_comment_id: parentId = null, author_username: author = null, text = '' }) {
  const c = await getConfig();
  if (!c.on || !NETWORKS.includes(network)) return null;
  const { rows: [pub] } = await db.query(
    `SELECT p.id, x->>'ref' AS post_ref, x->>'post_id' AS platform_post_id FROM episode_publications p, jsonb_array_elements(coalesce(p.results, '[]'::jsonb)) x
      WHERE p.ai_replies AND x->>'platform' = $1 AND ((x->>'ref' = $2 AND $2 IS NOT NULL) OR (x->>'post_id' = $3 AND $3 IS NOT NULL)) ORDER BY p.id DESC LIMIT 1`,
    [network, postRef || null, platformPostId || null]);
  if (!pub) return null;
  // comentário de primeiro nível entra já (resposta a alguém depende da conversa: vem pela leitura do post)
  const mine = commentId && !parentId ? (await ourHandles())[network] : null;
  if (commentId && !parentId && !(mine && handleOf(author) === mine)) {
    await db.query(
      `INSERT INTO social_comments (network, post_ref, platform_post_id, publication_id, comment_id, author_username, text, commented_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now()) ON CONFLICT (provider, network, comment_id) DO NOTHING`,
      [network, pub.post_ref || postRef, pub.platform_post_id || platformPostId, pub.id, String(commentId), author, String(text || '').slice(0, 2000)]);
  }
  return jobs.enqueue('comentarios_ia', { refId: pub.id, payload: { fetch: true }, delayMs: 60_000, maxAttempts: 4 });
}

// ---------------------------------------------------------------- triagem pela IA
const SYSTEM = `Você cuida dos comentários dos posts do Pulso Podcast (podcast de saúde, inovação, empreendedorismo e negócios) no Instagram, Facebook e Threads.
Para cada comentário, decida uma ação:
- "reagir": comentário curto de apoio, só emoji, "verdade", elogio curto. A resposta é UM emoji (varie entre ${EMOJIS.join(' ')}), nada mais.
- "responder": opinião, relato, pergunta ou elogio com conteúdo. Resposta curta (até 220 caracteres), concreta sobre o assunto do post, em português do Brasil, falando com a pessoa.
- "ignorar": conversa com o convidado do post ou marcação dele, marcação de amigos (@alguém sozinho), comentário vazio ou sem sentido, robô/spam, texto genérico repetido ("Obrigado pelo Feedback"), comentário da própria equipe ou do convidado, ou continuação de outro comentário da mesma pessoa.
- "equipe": SÓ o que é pesado de verdade: ameaça, ódio explícito, assédio, crise ou risco à vida, pedido de orientação de saúde individual (diagnóstico, remédio, dose, tratamento), assunto jurídico, reclamação séria contra o Pulso ou o convidado. Também quando você não tiver segurança do que a pessoa quis dizer.
Regras de tom (são da marca e valem sempre):
- Opinião polêmica, generalização ou preconceito (ex.: "toda mulher…", "50% das mulheres mentem"): RESPONDA, com um toque leve de acidez e discordando com elegância. Nunca ofenda a pessoa, nunca xingue, nunca concorde com preconceito. Isso não é caso de equipe.
- Sempre que der, termine com uma pergunta que faça a pessoa comentar de novo (o objetivo é engajamento). Uma pergunta só.
- Direto, sem "!!!", sem "imperdível", sem superlativo vazio, sem hashtags, sem emoji no meio do texto de "responder" (no máximo um no fim, raramente).
- Não dê conselho médico, jurídico ou financeiro individual. Não invente fatos sobre o convidado nem sobre o episódio.
- "Link da bio" só se a pessoa perguntar onde assistir.
- Varie as respostas: duas respostas no mesmo post não podem começar igual nem repetir a mesma ideia.
Devolva um item por comentário recebido, com o mesmo id, o motivo em poucas palavras e a confiança (0 a 1).`;

const SCHEMA = {
  type: 'OBJECT', required: ['itens'],
  properties: {
    itens: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT', required: ['id', 'acao', 'motivo', 'confianca'],
        properties: {
          id: { type: 'STRING' }, acao: { type: 'STRING', enum: ['responder', 'reagir', 'ignorar', 'equipe'] },
          motivo: { type: 'STRING' }, resposta: { type: 'STRING' }, confianca: { type: 'NUMBER' },
        },
      },
    },
  },
};

// Regras que não precisam de IA: vazio, perfis da equipe, o convidado do post, quem pediu o link pela palavra da automação.
async function quickVerdict(row, { team, guestIg, keywords }) {
  const text = String(row.text || '').trim();
  if (!text) return 'Comentário vazio.';
  const who = handleOf(row.author_username);
  if (who && team.includes(who)) return 'Perfil da equipe.';
  if (who && guestIg && who === guestIg) return 'Comentário do próprio convidado.';
  if (/^(@[\w.]+\s*)+$/.test(text)) return 'Só marca outra pessoa.';
  if (keywords.length && require('./social').has(text, keywords)) return 'Pediu o link pela palavra da automação (vai no direct).';
  return null;
}

function cleanReply(action, s) {
  let t = String(s || '').replace(/\s+/g, ' ').replace(/!{2,}/g, '!').replace(/^["“\s]+|["”\s]+$/g, '').trim();
  if (action === 'reagir') return [...t].length && [...t].length <= 4 && !/[\p{L}\p{N}]/u.test(t) ? t : EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
  if ([...t].length > REPLY_MAX) t = `${[...t].slice(0, REPLY_MAX - 1).join('').replace(/\s+\S*$/, '')}…`;
  return t;
}

// Triagem dos comentários novos de uma publicação (em lotes de 25).
async function classifyPublication(pubId) {
  const c = await getConfig();
  const post = await postContext(pubId);
  if (!post) return { classified: 0 };
  const { rows: rules } = await db.query("SELECT keywords FROM social_rules WHERE publication_id = $1 AND active", [pubId]);
  const keywords = rules.flatMap((r) => r.keywords || []);
  const ctx = { team: c.team_handles.map(handleOf), guestIg: handleOf(post.guest_ig), keywords };
  let classified = 0; const needTeam = []; let proposed = 0; const tried = [];
  for (let round = 0; round < 20; round += 1) {
    const { rows } = await db.query("SELECT * FROM social_comments WHERE publication_id = $1 AND status = 'nova' AND NOT (id = ANY($2::bigint[])) ORDER BY commented_at NULLS LAST, id LIMIT 25", [pubId, tried]);
    if (!rows.length) break;
    const forAi = [];
    for (const row of rows) {
      const quick = await quickVerdict(row, ctx);
      if (quick) { await db.query("UPDATE social_comments SET status = 'ignorada', action = 'ignorar', reason = $2, updated_at = now() WHERE id = $1", [row.id, quick]); classified += 1; } else forAi.push(row);
    }
    if (!forAi.length) continue;
    if (!config.geminiConfigured) break; // fica "nova" até a IA voltar
    tried.push(...forAi.map((r) => r.id)); // o que a IA pular fica "nova" para a próxima leitura (não repete nesta)
    const { rows: done } = await db.query(
      "SELECT reply_text FROM social_comments WHERE publication_id = $1 AND status IN ('proposta','aprovada','enviada','simulada') AND action = 'responder' ORDER BY id DESC LIMIT 12", [pubId]);
    const brief = [
      `Post: ${post.title || 'sem título'}${post.trial ? ' (Reel de teste: aparece primeiro para quem não segue o Pulso)' : ''}`,
      post.ep_number ? `Episódio ${post.ep_number}${post.ep_title ? `: ${post.ep_title}` : ''}` : '',
      post.guest ? `Convidado: ${post.guest}${post.guest_ig ? ` (@${handleOf(post.guest_ig)})` : ''}` : '',
      post.caption ? `Legenda: ${post.caption}` : '',
      done.length ? `Respostas que o Pulso já deu neste post (não repita): ${done.map((d) => d.reply_text).join(' | ')}` : '',
      '', 'Comentários (JSON):',
      JSON.stringify(forAi.map((r) => ({ id: String(r.id), usuario: r.author_username, texto: r.text, curtidas: r.likes, conversa: r.thread, e_resposta_ao_pulso: Boolean(r.parent_comment_id) }))),
    ].filter(Boolean).join('\n');
    const { data } = await gemini.generateJson({ system: SYSTEM, parts: [{ text: brief }], schema: SCHEMA, temperature: 0.7, timeoutMs: 90_000, attempts: 3 });
    const byId = new Map((data?.itens || []).map((i) => [String(i.id), i]));
    for (const row of forAi) {
      const it = byId.get(String(row.id));
      if (!it) continue; // a IA pulou: fica "nova" e entra na próxima volta
      const conf = Math.max(0, Math.min(1, Number(it.confianca) || 0));
      let action = ['responder', 'reagir', 'ignorar', 'equipe'].includes(it.acao) ? it.acao : 'equipe';
      const text = action === 'responder' || action === 'reagir' ? cleanReply(action, it.resposta) : null;
      if ((action === 'responder' && !text) || (conf < MIN_CONFIDENCE && action !== 'ignorar')) action = 'equipe';
      const status = action === 'ignorar' ? 'ignorada' : action === 'equipe' ? 'equipe' : c.mode === 'automatico' ? 'aprovada' : 'proposta';
      await db.query(
        `UPDATE social_comments SET status = $2, action = $3, reason = $4, ai_text = $5, reply_text = $5, confidence = $6,
            decided_at = CASE WHEN $2 = 'aprovada' THEN now() ELSE decided_at END, updated_at = now() WHERE id = $1 AND status = 'nova'`,
        [row.id, status, action, String(it.motivo || '').slice(0, 200) || null, text, conf]);
      classified += 1;
      if (status === 'equipe') needTeam.push(row);
      if (status === 'proposta') proposed += 1;
    }
  }
  await warnTeam(post, needTeam, proposed);
  return { classified, team: needTeam.length, proposed };
}
jobs.register('comentarios_varredura', async (job) => sweep({ days: Number(job.payload?.days) || 60, force: true }));
jobs.register('comentarios_ia', async (job) => {
  if (job.payload?.fetch) {
    const posts = await watchedPosts({ pubId: job.ref_id });
    const mine = await ourHandles();
    for (const post of posts) await fetchPost(post, mine);
  }
  return classifyPublication(job.ref_id);
});

// Avisos para gestão e produtora: comentário que precisa de alguém (um aviso por lote) e respostas esperando aprovação (um por dia).
async function warnTeam(post, needTeam, proposed) {
  const { notify } = require('./notify');
  if (needTeam.length) {
    const first = needTeam[0];
    await notify({
      type: 'redes', broadcast: true,
      title: needTeam.length === 1 ? `Comentário precisa de você · ${post.title || 'post'}` : `${needTeam.length} comentários precisam de você · ${post.title || 'post'}`,
      body: `@${first.author_username || 'alguém'}: ${String(first.text).slice(0, 180)}`, url: '/social/comentarios?vista=equipe',
      dedupe: `redes-equipe:${first.id}`, entity: { type: 'publication', id: post.id }, topic: 'comentarios-equipe',
    });
  }
  if (proposed) {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    await notify({ type: 'redes', broadcast: true, title: 'Respostas da IA esperando aprovação', body: 'Os comentários novos dos posts têm resposta pronta para você conferir.', url: '/social/comentarios?vista=aprovar', dedupe: `redes-aprovar:${day}` });
  }
}

// ---------------------------------------------------------------- envio aos poucos
const hourBR = (d = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(d));
const inWindow = (c, d = new Date()) => { const h = hourBR(d); return h >= c.from && h < c.to; };
const baseGap = (c) => 3600_000 / Math.max(1, c.per_hour);
const randomGap = (c) => Math.max(45_000, baseGap(c) * (0.6 + Math.random() * 0.8));

function friendly(err) {
  const m = String(err?.message || err);
  if (/\(429\)/.test(m)) return 'O Instagram pediu para ir mais devagar. A resposta volta para a fila e sai mais tarde.';
  if (/\(40[13]\)/.test(m)) return 'A conta não deu permissão para responder comentários: reconecte a rede em Integrações.';
  if (/\(404\)/.test(m)) return 'O comentário não existe mais (a pessoa apagou ou o post saiu do ar).';
  if (/\(400\)/.test(m)) return `A rede recusou a resposta: ${m.replace(/^Outstand recusou \(400\):\s*/, '').slice(0, 200)}`;
  return m.slice(0, 300);
}

// Uma volta da rotina (a cada minuto): manda no máximo uma resposta, se o horário, o limite e o intervalo deixam.
async function sendTick({ now = new Date() } = {}) {
  const c = await getConfig();
  if (!c.on || !inWindow(c, now)) return { sent: 0, reason: !c.on ? 'desligada' : 'fora do horário' };
  const state = parseJson(await settings.get(SEND_KEY), {});
  if (state.next_at && new Date(state.next_at) > now) return { sent: 0, reason: 'intervalo' };
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM social_comments WHERE status IN ('enviada','simulada') AND sent_at > $1::timestamptz - interval '1 hour'", [now]);
  if (n >= c.per_hour) return { sent: 0, reason: 'limite por hora' };
  const client = await db.getPool().connect();
  let row;
  try {
    await client.query('BEGIN');
    ({ rows: [row] } = await client.query(
      `SELECT * FROM social_comments WHERE status = 'aprovada' AND coalesce(reply_text, '') <> ''
        ORDER BY (publication_id IS NOT DISTINCT FROM $1) ASC, decided_at NULLS LAST, id LIMIT 1 FOR UPDATE SKIP LOCKED`, [state.last_pub ?? null]));
    if (!row) { await client.query('COMMIT'); return { sent: 0, reason: 'fila vazia' }; }
    const live = config.outstand.live;
    try {
      const r = live ? await require('./outstand').replyToComment({ postRef: row.post_ref, commentId: row.parent_comment_id || row.comment_id, content: row.reply_text, platformPostId: row.platform_post_id }) : { replyId: null };
      await client.query("UPDATE social_comments SET status = $2, reply_id = $3, sent_at = $4, error = NULL, attempts = attempts + 1, updated_at = now() WHERE id = $1",
        [row.id, live ? 'enviada' : 'simulada', r.replyId, now]);
    } catch (err) {
      const slow = /\(429\)/.test(String(err.message));
      await client.query("UPDATE social_comments SET status = $2, error = $3, attempts = attempts + 1, updated_at = now() WHERE id = $1",
        [row.id, slow || row.attempts + 1 < 2 ? 'aprovada' : 'erro', friendly(err)]);
      await client.query('COMMIT');
      await settings.set(SEND_KEY, JSON.stringify({ ...state, next_at: new Date(now.getTime() + (slow ? 15 * 60_000 : randomGap(c))).toISOString() }));
      return { sent: 0, reason: 'erro', error: friendly(err) };
    }
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
  await settings.set(SEND_KEY, JSON.stringify({ last_pub: row.publication_id, next_at: new Date(now.getTime() + randomGap(c)).toISOString() }));
  return { sent: 1, id: row.id };
}

// Previsão de saída de cada resposta da fila (na ordem em que vão sair), para a aba "Na fila".
function estimate(rows, c, { now = new Date(), nextAt = null } = {}) {
  const gap = baseGap(c);
  let t = new Date(Math.max(now.getTime(), nextAt ? new Date(nextAt).getTime() : 0));
  const out = new Map();
  for (const r of rows) {
    for (let guard = 0; guard < 48 && !inWindow(c, t); guard += 1) { t = new Date(t.getTime() + 3600_000); t.setMinutes(0, 0, 0); }
    out.set(String(r.id), t);
    t = new Date(t.getTime() + gap);
  }
  return out;
}

// ---------------------------------------------------------------- ações da equipe
const ACTIONABLE = ['proposta', 'equipe', 'erro'];
async function approve(ids, userId) {
  const { rowCount } = await db.query(
    `UPDATE social_comments SET status = 'aprovada', decided_by = $2, decided_at = now(), error = NULL, attempts = 0, updated_at = now()
      WHERE id = ANY($1::bigint[]) AND status = ANY($3) AND coalesce(reply_text, '') <> ''`, [ids, userId, ACTIONABLE]);
  return rowCount;
}
async function approveAll({ userId, pubId = null }) {
  const { rows } = await db.query(`SELECT id FROM social_comments WHERE status = 'proposta' ${pubId ? 'AND publication_id = $1' : ''}`, pubId ? [pubId] : []);
  return approve(rows.map((r) => r.id), userId);
}
// Texto escrito (ou editado) por alguém: vai para a fila. Só emoji = reação.
async function setReply(id, text, userId) {
  const t = String(text || '').replace(/\r/g, '').trim().slice(0, REPLY_MAX);
  if (!t) return { error: 'Escreva a resposta.' };
  const action = /[\p{L}\p{N}]/u.test(t) ? 'responder' : 'reagir';
  const { rowCount } = await db.query(
    `UPDATE social_comments SET reply_text = $2, action = $3, status = 'aprovada', decided_by = $4, decided_at = now(), error = NULL, attempts = 0, updated_at = now()
      WHERE id = $1 AND status IN ('proposta','equipe','erro','aprovada','ignorada')`, [id, t, action, userId]);
  return rowCount ? { ok: true } : { error: 'Este comentário já foi respondido.' };
}
async function skip(id, userId) {
  const { rowCount } = await db.query(
    `UPDATE social_comments SET status = 'ignorada', reason = coalesce(nullif(reason, ''), 'Sem resposta'), decided_by = $2, decided_at = now(), updated_at = now()
      WHERE id = $1 AND status IN ('proposta','equipe','erro','aprovada')`, [id, userId]);
  return rowCount;
}
const unqueue = (id) => db.query("UPDATE social_comments SET status = 'proposta', updated_at = now() WHERE id = $1 AND status = 'aprovada'", [id]).then((r) => r.rowCount);
async function undo(id) {
  const { rows: [row] } = await db.query("SELECT * FROM social_comments WHERE id = $1 AND status IN ('enviada','simulada')", [id]);
  if (!row) return { error: 'Esta resposta não está mais publicada.' };
  if (row.status === 'enviada' && row.reply_id) {
    try { await require('./outstand').deleteReply({ postRef: row.post_ref, replyId: row.reply_id, platformPostId: row.platform_post_id }); } catch (err) {
      if (!/\(404\)/.test(String(err.message))) return { error: `Não deu para apagar agora: ${friendly(err)}` };
    }
  } else if (row.status === 'enviada') return { error: 'A rede não devolveu o código da resposta: apague pelo app.' };
  await db.query("UPDATE social_comments SET status = 'apagada', updated_at = now() WHERE id = $1", [id]);
  return { ok: true };
}

// ---------------------------------------------------------------- leitura para as telas
async function counts({ pubId = null } = {}) {
  const { rows } = await db.query(`SELECT status, count(*)::int AS n FROM social_comments ${pubId ? 'WHERE publication_id = $1' : ''} GROUP BY status`, pubId ? [pubId] : []);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  return Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [k, v.statuses.reduce((s, st) => s + (by[st] || 0), 0)]));
}
// Contagem do que precisa de alguém (para o rótulo da aba): para aprovar + precisam de você.
async function pendingCount() {
  const { rows: [r] } = await db.query("SELECT count(*)::int AS n FROM social_comments WHERE status IN ('proposta','equipe','erro')");
  return r.n;
}
async function list(view, { pubId = null, limit = 60, offset = 0 } = {}) {
  const v = VIEWS[view] || VIEWS.aprovar;
  const order = view === 'fila' ? 'c.decided_at NULLS LAST, c.id' : view === 'enviadas' ? 'c.sent_at DESC NULLS LAST, c.id DESC' : 'c.commented_at DESC NULLS LAST, c.id DESC';
  const params = [v.statuses];
  if (pubId) params.push(pubId);
  const { rows } = await db.query(
    `SELECT c.*, coalesce(cl.post_title, cl.title, p.title) AS post_title, g.name AS guest, e.number AS ep_number, p.clip_id, coalesce(p.cover_id, p.cover_ids[1]) AS thumb_cover, cv.updated_at AS thumb_at, u.name AS decided_by_name
       FROM social_comments c LEFT JOIN episode_publications p ON p.id = c.publication_id LEFT JOIN episode_clips cl ON cl.id = p.clip_id
       LEFT JOIN episodes e ON e.id = coalesce(p.episode_id, cl.episode_id) LEFT JOIN guests g ON g.id = e.guest_id LEFT JOIN users u ON u.id = c.decided_by
       LEFT JOIN episode_covers cv ON cv.id = coalesce(p.cover_id, p.cover_ids[1])
      WHERE c.status = ANY($1) ${pubId ? 'AND c.publication_id = $2' : ''} ORDER BY ${order} LIMIT ${Math.min(200, limit) + 1} OFFSET ${Math.max(0, offset)}`, params);
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}
// Posts com comentários acompanhados (filtro da tela).
async function postsWithComments() {
  const { rows } = await db.query(
    `SELECT p.id, coalesce(cl.post_title, cl.title, p.title) AS title, count(c.*)::int AS n
       FROM social_comments c JOIN episode_publications p ON p.id = c.publication_id LEFT JOIN episode_clips cl ON cl.id = p.clip_id
      GROUP BY p.id, cl.post_title, cl.title, p.title ORDER BY max(c.commented_at) DESC NULLS LAST LIMIT 200`);
  return rows;
}
async function ofPublication(pubId) {
  const n = await counts({ pubId });
  const { rows: [p] } = await db.query('SELECT ai_replies FROM episode_publications WHERE id = $1', [pubId]);
  return { on: Boolean(p?.ai_replies), counts: n, total: Object.values(n).reduce((a, b) => a + b, 0) };
}

module.exports = {
  KEY, SEND_KEY, NETWORKS, NETWORK_LABEL, MODES, DEFAULTS, VIEWS, EMOJIS, REPLY_MAX, SYSTEM,
  getConfig, setConfig, summary, watchedPosts, postContext, ingest, sweep, fromWebhook, classifyPublication, cleanReply,
  hourBR, inWindow, sendTick, estimate, friendly, approve, approveAll, setReply, skip, unqueue, undo, counts, pendingCount, list, postsWithComments, ofPublication,
};
