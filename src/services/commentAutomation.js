// Automação de comentário → direct ligada à publicação. Ao publicar (um corte, um post ou vários de uma vez), a pessoa liga
// "quem comentar a palavra recebe o link no direct". Cada publicação ganha uma regra (social_rules, escopo 'publicacao').
// O comentário chega pela Outstand (webhook comment.received, assinado), entra em social_inbox (um por comentário: o aviso pode
// repetir) e o trabalho 'comentario_recebido' confere a palavra e responde no direct de quem comentou (Instagram "private reply":
// uma por comentário, até 7 dias depois dele). A mensagem é montada na hora do envio: o link do episódio entra assim que existir.
const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config');
const settings = require('./settings');
const jobs = require('./jobs');
const fmt = require('../utils/format');

const LINKS_KEY = 'social_links';
const SECRET_KEY = 'outstand_webhook_secret';
const STATUS_KEY = 'outstand_inbox';
const DAYS = [7, 30, 90];
const KEYWORD_MAX = 30;
const MESSAGE_MAX = 1000;
const PLACEHOLDERS = ['convidado', 'episodio', 'canal', 'comunidade', 'spotify'];
const DEFAULT_MESSAGE = 'Oi! Que bom que você quer ver a conversa completa com {convidado}. Aqui está o episódio: {episodio}\n\nE vem para a nossa comunidade no WhatsApp: {comunidade}';
const TITLES = /^(dra?\.?|prof\.?|profa\.?|sr\.?|sra\.?)$/i;

const parseJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

// ---------------------------------------------------------------- links que a automação manda
async function links() {
  const v = parseJson(await settings.get(LINKS_KEY), {});
  return { youtube_channel: v.youtube_channel || '', whatsapp_community: v.whatsapp_community || '', spotify_show: v.spotify_show || '' };
}
const httpsOrEmpty = (s) => { const t = String(s || '').trim().slice(0, 500); return /^https:\/\/\S+$/i.test(t) ? t : ''; };
async function setLinks(body) {
  const v = { youtube_channel: httpsOrEmpty(body.youtube_channel), whatsapp_community: httpsOrEmpty(body.whatsapp_community), spotify_show: httpsOrEmpty(body.spotify_show) };
  const bad = ['youtube_channel', 'whatsapp_community', 'spotify_show'].filter((k) => String(body[k] || '').trim() && !v[k]);
  if (bad.length) return { error: 'Use endereços completos, começando com https://.' };
  await settings.set(LINKS_KEY, JSON.stringify(v));
  return { links: v };
}

// ---------------------------------------------------------------- palavra, chamada e mensagem
// "Dra. Tamiris Mariano" -> "TAMIRIS"; "Guto Galamba e Fillipe Holzer" -> "GUTO".
const cleanKeyword = (s) => String(s || '').replace(/[^\p{L}\p{N}]/gu, '').toUpperCase().slice(0, KEYWORD_MAX);
function keywordFor(name) {
  const words = String(name || '').trim().split(/\s+/).filter((w) => w && !TITLES.test(w));
  return cleanKeyword(words[0] || '') || 'EPISODIO';
}
const ctaFor = (keyword) => `Comente ${keyword} e receba no direct o link do episódio completo.`;
const fold = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// A chamada do Instagram precisa pedir a palavra certa: se não pede, vira a chamada da automação.
const withKeyword = (cta, keyword) => (cta && fold(cta).includes(fold(keyword)) ? cta : ctaFor(keyword));

// Lê o bloco "Automação no Instagram" do formulário de publicar. keyword vazia = nome do convidado de cada corte (em massa).
function readForm(body) {
  if (!body || String(body.auto_on || '') !== '1') return null;
  const message = String(body.auto_mensagem || '').replace(/\r/g, '').trim().slice(0, MESSAGE_MAX) || DEFAULT_MESSAGE;
  return {
    keyword: cleanKeyword(body.auto_palavra), message, reply: fmt.clean(body.auto_resposta, 300) || null,
    days: DAYS.includes(Number(body.auto_dias)) ? Number(body.auto_dias) : 30,
  };
}

// Troca {convidado}, {episodio}, {canal}, {comunidade} e {spotify}. Linha com link que não existe some (ex.: sem comunidade
// cadastrada). Antes da estreia, {episodio} vai como o link do canal.
function render(template, { episode = null, guest = null, linkSet = {} } = {}) {
  const values = {
    convidado: guest?.name || 'o convidado', episodio: episode?.youtube_url || linkSet.youtube_channel || '',
    canal: linkSet.youtube_channel || '', comunidade: linkSet.whatsapp_community || '', spotify: episode?.spotify_url || linkSet.spotify_show || '',
  };
  const lines = String(template || '').split('\n').filter((line) => !PLACEHOLDERS.some((k) => line.includes(`{${k}}`) && !values[k]));
  return lines.join('\n').replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m)).replace(/\n{3,}/g, '\n\n').trim().slice(0, MESSAGE_MAX);
}

// Valores iniciais do bloco no formulário de um corte (palavra = nome do convidado) e o que falta configurar.
async function formDefaults({ guest = null } = {}) {
  const [linkSet, status] = await Promise.all([links(), state()]);
  return { keyword: guest ? keywordFor(guest.name) : '', message: DEFAULT_MESSAGE, days: 30, linkSet, ready: Boolean(status.secret), heard: Boolean(status.last_event_at) };
}

// Palavra padrão do que vai ser publicado: o primeiro nome do convidado do episódio do corte (ou das imagens).
async function keywordForTarget({ clipId = null, coverIds = [] } = {}) {
  const { rows: [g] } = clipId
    ? await db.query('SELECT g.name FROM episode_clips c JOIN episodes e ON e.id = c.episode_id JOIN guests g ON g.id = e.guest_id WHERE c.id = $1', [clipId])
    : coverIds.length ? await db.query('SELECT g.name FROM episode_covers cv JOIN episodes e ON e.id = cv.episode_id JOIN guests g ON g.id = e.guest_id WHERE cv.id = ANY($1) LIMIT 1', [coverIds]) : { rows: [] };
  return keywordFor(g?.name);
}

// Prepara a publicação com automação: a palavra (a escolhida ou a do convidado) e a chamada do Instagram pedindo essa palavra.
async function prepare(auto, { platforms, ctas = null, clipId = null, coverIds = [], guestName = null } = {}) {
  if (!auto || !platforms.includes('instagram')) return { keyword: null, ctas };
  const keyword = auto.keyword || (guestName ? keywordFor(guestName) : await keywordForTarget({ clipId, coverIds }));
  return { keyword, ctas: { ...(ctas || {}), instagram: withKeyword(ctas?.instagram, keyword) } };
}

// Cria a regra da publicação (só quando o Instagram está entre as redes). Publicação repetida (clique duplo) não ganha outra.
async function attach(pub, auto, { keyword, userId = null } = {}) {
  if (!auto || !pub || !(pub.platforms || []).includes('instagram')) return null;
  const { rows: [exists] } = await db.query('SELECT id FROM social_rules WHERE publication_id = $1', [pub.id]);
  if (exists) return exists;
  const kw = cleanKeyword(keyword || auto.keyword) || 'EPISODIO';
  const start = pub.scheduled_at ? new Date(pub.scheduled_at) : new Date();
  const until = new Date(Math.max(start.getTime(), Date.now()) + auto.days * 86400_000);
  const { rows: [rule] } = await db.query(
    `INSERT INTO social_rules (name, trigger, platform, scope, publication_id, keywords, action, message, reply_text, active, active_since, provider, expires_at, created_by)
     VALUES ($1, 'comentario', 'instagram', 'publicacao', $2, $3, $4, $5, $6, true, now(), 'outstand', $7, $8) RETURNING *`,
    [`Comentou ${kw} · ${fmt.clean(pub.title, 80) || 'publicação'}`, pub.id, [kw], auto.reply ? 'ambos' : 'dm', auto.message, auto.reply, until, userId]);
  return rule;
}

// ---------------------------------------------------------------- webhook da Outstand
async function state() {
  const [secret, raw] = await Promise.all([settings.get(SECRET_KEY), settings.get(STATUS_KEY)]);
  return { secret: secret || '', ...parseJson(raw, {}) };
}
async function note(fields) {
  const cur = parseJson(await settings.get(STATUS_KEY), {});
  await settings.set(STATUS_KEY, JSON.stringify({ ...cur, ...fields }));
}
async function newSecret() {
  const s = `whsec_${crypto.randomBytes(24).toString('hex')}`;
  await settings.set(SECRET_KEY, s);
  return s;
}

// Assinatura: "sha256=" + HMAC-SHA256 (hex) do corpo exato que chegou, com o segredo cadastrado no aviso da Outstand.
function signatureOk(raw, header, secret) {
  if (!secret || !header) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  const a = Buffer.from(String(header)); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Recebe o aviso. Responde rápido (a Outstand espera até 30 s e repete): guarda o comentário e enfileira a resposta.
async function receive(raw, signature) {
  const secret = await settings.get(SECRET_KEY);
  if (!signatureOk(raw, signature, secret)) return { status: 401, body: { ok: false } };
  const body = parseJson(raw.toString('utf8'), null);
  if (!body || typeof body !== 'object') return { status: 400, body: { ok: false } };
  const d = body.data || {};
  const now = new Date().toISOString();
  await note({ last_event_at: now, last_event: String(body.event || ''), ...(body.event === 'test' ? { last_test_at: now } : {}) });
  if (body.event !== 'comment.received' || !d.commentId) return { status: 200, body: { ok: true } };
  const { rows: [row] } = await db.query(
    `INSERT INTO social_inbox (provider, event, network, account_id, post_ref, platform_post_id, comment_id, parent_comment_id, author_id, author_username, text, payload)
     VALUES ('outstand', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (provider, account_id, comment_id) WHERE comment_id IS NOT NULL DO NOTHING RETURNING id`,
    [body.event, d.network || null, d.accountId != null ? String(d.accountId) : null, d.postId || null, d.platformPostId || null, String(d.commentId),
      d.parentCommentId || null, d.authorId != null ? String(d.authorId) : null, d.authorUsername || null, String(d.text || '').slice(0, 2000), JSON.stringify(body)]);
  if (row) await jobs.enqueue('comentario_recebido', { refId: Number(row.id), maxAttempts: 3 });
  return { status: 200, body: { ok: true } };
}

// Erro da Outstand/Instagram -> frase para a tela.
function friendly(err) {
  const m = String(err?.message || err);
  if (/\(409\)/.test(m)) return 'Esse comentário já tinha recebido uma resposta no direct.';
  if (/\(422\)/.test(m)) return 'Passou do prazo: o Instagram só deixa responder no direct até 7 dias depois do comentário.';
  if (/\(40[13]\)/.test(m)) return 'O Instagram não deu acesso às mensagens: reconecte o Instagram em Integrações (com acesso às mensagens).';
  if (/\(404\)/.test(m)) return 'A Outstand não achou o comentário nesta conta.';
  return m.slice(0, 300);
}

// Contexto da mensagem: a publicação do post comentado (pela Outstand ou pelo id do post na rede) -> episódio -> convidado.
async function contextOf(rule, m) {
  const { rows: [pub] } = rule.publication_id
    ? await db.query('SELECT id, episode_id, clip_id FROM episode_publications WHERE id = $1', [rule.publication_id])
    : await db.query(
      `SELECT p.id, p.episode_id, p.clip_id FROM episode_publications p, jsonb_array_elements(coalesce(p.results, '[]'::jsonb)) x
        WHERE x->>'platform' = $1 AND ((x->>'ref' = $2 AND $2 IS NOT NULL) OR (x->>'post_id' = $3 AND $3 IS NOT NULL)) ORDER BY p.id DESC LIMIT 1`,
      [m.network, m.post_ref, m.platform_post_id]);
  const { rows: [episode] } = pub?.episode_id ? await db.query('SELECT id, title, youtube_url, spotify_url, guest_id FROM episodes WHERE id = $1', [pub.episode_id]) : { rows: [] };
  const { rows: [guest] } = episode?.guest_id ? await db.query('SELECT id, name FROM guests WHERE id = $1', [episode.guest_id]) : { rows: [] };
  return { episode: episode || null, guest: guest || null, linkSet: await links() };
}

// Trabalho: um comentário recebido. Responde no máximo uma vez (o Instagram só aceita uma resposta no direct por comentário).
async function handle(job) {
  const social = require('./social');
  const ost = require('./outstand');
  await require('./socialApi').syncLive();
  const { rows: [m] } = await db.query('SELECT * FROM social_inbox WHERE id = $1', [job.ref_id]);
  if (!m || m.processed_at) return { skipped: true };
  const done = async (result) => { await db.query('UPDATE social_inbox SET processed_at = now(), result = $2 WHERE id = $1', [m.id, result]); return { result }; };
  if (m.parent_comment_id) return done('Resposta a um comentário: fica de fora.');
  const conn = await ost.connected().catch(() => ({ platforms: {} }));
  const me = String(conn.platforms?.[m.network]?.handle || '').replace(/^@/, '').toLowerCase();
  if (me && String(m.author_username || '').toLowerCase() === me) return done('Comentário da própria conta: fica de fora.');
  const { rows: rules } = await db.query(
    `SELECT r.* FROM social_rules r
      WHERE r.active AND r.provider = 'outstand' AND r.trigger = 'comentario' AND r.platform = $1 AND (r.expires_at IS NULL OR r.expires_at > now())
        AND (r.scope = 'recentes'
          OR (r.scope = 'publicacao' AND EXISTS (
            SELECT 1 FROM episode_publications p, jsonb_array_elements(coalesce(p.results, '[]'::jsonb)) x
             WHERE p.id = r.publication_id AND x->>'platform' = $1 AND ((x->>'ref' = $2 AND $2 IS NOT NULL) OR (x->>'post_id' = $3 AND $3 IS NOT NULL))))
          OR (r.scope = 'post' AND EXISTS ( -- "um post específico" (pelo link): casa com a publicação que saiu naquele link
            SELECT 1 FROM episode_publications p, jsonb_array_elements(coalesce(p.results, '[]'::jsonb)) x
             WHERE x->>'platform' = $1 AND x->>'url' = r.post_url AND ((x->>'ref' = $2 AND $2 IS NOT NULL) OR (x->>'post_id' = $3 AND $3 IS NOT NULL)))))
      ORDER BY (r.scope = 'publicacao') DESC, r.id`, [m.network, m.post_ref, m.platform_post_id]);
  if (!rules.length) return done('Nenhuma automação para este post.');
  const item = { id: m.comment_id, author: m.author_username, text: m.text };
  for (const rule of rules) {
    if (!social.has(m.text, rule.keywords || [])) { await social.record(rule, item, 'ignorado', null); continue; }
    if (!(await social.claimItem(rule, item))) return done('Já tratado.');
    const replies = [];
    try {
      const simulated = !config.outstand.live;
      if (rule.action === 'dm' || rule.action === 'ambos') {
        const message = render(rule.message, await contextOf(rule, m));
        if (!simulated) await ost.privateReply({ accountId: m.account_id, commentId: m.comment_id, authorId: m.author_id, content: message });
        replies.push(`DM: ${message}`);
      }
      if ((rule.action === 'resposta' || rule.action === 'ambos') && rule.reply_text && m.post_ref) {
        if (!simulated) await ost.replyToComment({ postRef: m.post_ref, commentId: m.comment_id, content: rule.reply_text });
        replies.push(`Resposta: ${rule.reply_text}`);
      }
      await social.record(rule, item, simulated ? 'simulado' : 'enviado', replies.join(' · '));
      if (!simulated) await note({ messaging_ok_at: new Date().toISOString() });
      return done(simulated ? 'Simulado (modo de teste).' : 'Respondido no direct.');
    } catch (err) {
      await social.record(rule, item, 'erro', replies.join(' · ') || null, friendly(err));
      return done(`Erro: ${friendly(err)}`);
    }
  }
  return done('A palavra não bateu.');
}
jobs.register('comentario_recebido', handle);

// Resumo da automação de uma publicação (página da publicação e do corte).
async function ofPublication(pubId) {
  const { rows: [r] } = await db.query(
    `SELECT r.*, (SELECT count(*)::int FROM social_events e WHERE e.rule_id = r.id AND e.status IN ('enviado','simulado')) AS answered,
            (SELECT count(*)::int FROM social_events e WHERE e.rule_id = r.id AND e.status = 'erro') AS errors
       FROM social_rules r WHERE r.publication_id = $1 LIMIT 1`, [pubId]);
  return r || null;
}

module.exports = {
  LINKS_KEY, SECRET_KEY, STATUS_KEY, DAYS, DEFAULT_MESSAGE, PLACEHOLDERS, links, setLinks, cleanKeyword, keywordFor, ctaFor, withKeyword,
  readForm, render, formDefaults, keywordForTarget, prepare, attach, state, note, newSecret, signatureOk, receive, handle, friendly, ofPublication,
};
