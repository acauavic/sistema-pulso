// Números dos comentários e das automações (Social > Comentários > Números e a faixa "Comentários" do Resumo do dia).
// Tudo por dia de Brasília (hoje = até agora), comparado com a média dos 7 dias anteriores (só os dias em que as respostas por IA
// já existiam). Conta o que o sistema registra em social_comments (comentários lidos, respostas e directs que ele mandou),
// social_events (automação por palavra), jobs (leituras da IA), post_metrics (comentários na rede) e os cliques do link do direct.
const db = require('../db/pool');
const settings = require('./settings');
const cal = require('./calendar');
const { BOUNDS } = require('./daySummary');

const CLICKS_KEY = 'respostas_ia_direct_clicks'; // { "AAAA-MM-DD": total de cliques no fim (ou até agora) do dia }
const SENT = "('enviada','simulada','apagada')"; // a resposta saiu (apagada = saiu e foi tirada depois)
const DM_SENT = "('enviada','simulada')";
const CODE_REASON = 'A resposta da IA veio com código%';
const parseJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

// O que aconteceu num dia: recebidos, respondidos (texto e reação), com convite, directs.
async function counts(day) {
  const { rows: [r] } = await db.query(`WITH ${BOUNDS}
    SELECT count(*) FILTER (WHERE coalesce(c.commented_at, c.created_at) >= b.s AND coalesce(c.commented_at, c.created_at) < b.e)::int AS received,
           count(*) FILTER (WHERE c.status IN ${SENT} AND c.sent_at >= b.s AND c.sent_at < b.e)::int AS replied,
           count(*) FILTER (WHERE c.status IN ${SENT} AND c.sent_at >= b.s AND c.sent_at < b.e AND c.action = 'responder')::int AS text,
           count(*) FILTER (WHERE c.status IN ${SENT} AND c.sent_at >= b.s AND c.sent_at < b.e AND c.action = 'reagir')::int AS reactions,
           count(*) FILTER (WHERE c.status IN ${SENT} AND c.sent_at >= b.s AND c.sent_at < b.e AND c.invited)::int AS invited,
           count(*) FILTER (WHERE c.dm_status IN ${DM_SENT} AND c.dm_sent_at >= b.s AND c.dm_sent_at < b.e)::int AS dms
      FROM social_comments c, b`, [day]);
  return r;
}

// Média dos 7 dias anteriores, contando só os dias desde o primeiro comentário guardado (antes disso, não havia o que medir).
async function average(day) {
  const { rows: [first] } = await db.query("SELECT to_char(min(created_at) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS d FROM social_comments");
  if (!first?.d) return null;
  const days = [];
  for (let i = 1; i <= 7; i += 1) { const d = cal.addDays(day, -i); if (d >= first.d) days.push(d); }
  if (!days.length) return null;
  const all = await Promise.all(days.map(counts));
  const avg = (k) => Math.round(all.reduce((s, x) => s + x[k], 0) / days.length);
  return { days: days.length, received: avg('received'), replied: avg('replied'), dms: avg('dms') };
}

// Das respostas em texto que saíram no dia, quantas pessoas comentaram de novo depois (em qualquer momento).
async function cameBack(day) {
  const { rows: [r] } = await db.query(`WITH ${BOUNDS}
    SELECT count(*)::int AS replied,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM social_comments x WHERE x.network = c.network
               AND x.parent_comment_id = coalesce(c.parent_comment_id, c.comment_id) AND x.id <> c.id
               AND lower(x.author_username) = lower(c.author_username) AND coalesce(x.commented_at, x.created_at) > c.sent_at))::int AS back
      FROM social_comments c, b WHERE c.action = 'responder' AND c.status IN ${SENT} AND c.sent_at >= b.s AND c.sent_at < b.e`, [day]);
  return { ...r, rate: r.replied ? Math.round((r.back / r.replied) * 100) : null };
}

// Posts com mais comentários no dia: o que foi respondido, os directs e quanto a rede conta (para ver o que a leitura não alcança).
async function topPosts(day, limit = 5) {
  const { rows } = await db.query(`WITH ${BOUNDS},
    d AS (SELECT c.* FROM social_comments c, b WHERE coalesce(c.commented_at, c.created_at) >= b.s AND coalesce(c.commented_at, c.created_at) < b.e)
    SELECT d.publication_id AS id, count(*)::int AS n,
           count(*) FILTER (WHERE d.status IN ${SENT} OR d.status = 'respondida')::int AS answered,
           count(*) FILTER (WHERE d.dm_status IN ${DM_SENT})::int AS dms,
           (SELECT count(*)::int FROM social_comments a WHERE a.publication_id = d.publication_id) AS read_total,
           (SELECT sum(m.comments)::int FROM post_metrics m WHERE m.publication_id = d.publication_id) AS network_total,
           coalesce(cl.post_title, cl.title, p.title) AS title, e.number AS ep_number, g.name AS guest,
           coalesce(p.cover_id, p.cover_ids[1]) AS thumb_cover, cv.updated_at AS thumb_at
      FROM d JOIN episode_publications p ON p.id = d.publication_id LEFT JOIN episode_clips cl ON cl.id = p.clip_id
      LEFT JOIN episodes e ON e.id = coalesce(p.episode_id, cl.episode_id) LEFT JOIN guests g ON g.id = e.guest_id
      LEFT JOIN episode_covers cv ON cv.id = coalesce(p.cover_id, p.cover_ids[1])
     GROUP BY d.publication_id, cl.post_title, cl.title, p.title, e.number, g.name, p.cover_id, p.cover_ids, cv.updated_at
     ORDER BY n DESC, d.publication_id DESC LIMIT $2`, [day, limit]);
  return rows;
}

// Comentários lidos x comentários que a rede conta, nos posts que tiveram comentário no dia.
async function coverage(day) {
  const { rows: [r] } = await db.query(`WITH ${BOUNDS},
    pubs AS (SELECT DISTINCT c.publication_id FROM social_comments c, b WHERE coalesce(c.commented_at, c.created_at) >= b.s AND coalesce(c.commented_at, c.created_at) < b.e)
    SELECT (SELECT count(*)::int FROM social_comments a WHERE a.publication_id IN (SELECT publication_id FROM pubs)) AS read,
           (SELECT sum(m.comments)::int FROM post_metrics m WHERE m.publication_id IN (SELECT publication_id FROM pubs)) AS network`, [day]);
  return { read: r.read, network: r.network };
}

// Comentários que chegaram e respostas que saíram, de 30 em 30 minutos (48 faixas no dia).
async function slots(day) {
  const { rows } = await db.query(`WITH ${BOUNDS}
    SELECT k, i, count(*)::int AS n FROM (
      SELECT 'in' AS k, floor(extract(epoch FROM coalesce(c.commented_at, c.created_at) - b.s) / 1800)::int AS i FROM social_comments c, b
       WHERE coalesce(c.commented_at, c.created_at) >= b.s AND coalesce(c.commented_at, c.created_at) < b.e
      UNION ALL
      SELECT 'out', floor(extract(epoch FROM c.sent_at - b.s) / 1800)::int FROM social_comments c, b WHERE c.status IN ${SENT} AND c.sent_at >= b.s AND c.sent_at < b.e
    ) x GROUP BY k, i`, [day]);
  const out = Array.from({ length: 48 }, (_, i) => ({ i, label: `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, in: 0, out: 0 }));
  for (const r of rows) if (r.i >= 0 && r.i < 48) out[r.i][r.k] = r.n;
  return out;
}

// Cliques no link do direct: o total guardado no fim do dia menos o do dia anterior guardado (o link nasce com zero).
async function clicksOn(day) {
  const map = parseJson(await settings.get(CLICKS_KEY), {});
  if (!(day in map)) return { day: null, total: null };
  const before = Object.keys(map).filter((d) => d < day).sort().pop();
  return { day: Math.max(0, map[day] - (before ? map[before] : 0)), total: map[day] };
}

// Guarda o total de cliques de hoje (rotina a cada 30 min). Sem link encurtado do direct, não há o que contar.
async function snapshotClicks({ today = cal.todayISO() } = {}) {
  const link = parseJson(await settings.get('respostas_ia_direct_link'), {});
  if (!link.short) return { skipped: 'sem link encurtado' };
  const total = await require('./yourls').clicks(link.short);
  if (total === null) return { skipped: 'sem leitura' };
  const map = parseJson(await settings.get(CLICKS_KEY), {});
  map[today] = total;
  const keep = Object.keys(map).sort().slice(-180);
  await settings.set(CLICKS_KEY, JSON.stringify(Object.fromEntries(keep.map((d) => [d, map[d]]))));
  return { total };
}

// O motivo de um post não ter sido lido, em português.
function readReason(err) {
  const m = String(err || '');
  if (/\(500\)/.test(m)) return 'a Outstand não consegue ler os comentários deste post (costuma ser post apagado ou arquivado no Instagram)';
  if (/\(404\)/.test(m)) return 'a Outstand não acha este post';
  if (/\(40[13]\)/.test(m)) return 'a Outstand recusou o acesso (confira a conexão em Integrações)';
  if (/\(429\)/.test(m)) return 'a Outstand pediu para ir mais devagar';
  return m.slice(0, 140);
}

// Erros e o que está parado. now: para dizer se o direct está pausado e se a Outstand está muda.
async function health(day, { isToday, now = new Date() } = {}) {
  const replies = require('./commentReplies');
  const [{ rows: replyErr }, { rows: dmErr }, { rows: [w] }, { rows: [ai] }, cfg, sweepS, inboxS, dmS] = await Promise.all([
    db.query(`WITH ${BOUNDS} SELECT coalesce(error, 'sem motivo') AS reason, count(*)::int AS n FROM social_comments c, b
               WHERE c.status = 'erro' AND c.updated_at >= b.s AND c.updated_at < b.e GROUP BY 1 ORDER BY 2 DESC`, [day]),
    db.query(`WITH ${BOUNDS} SELECT c.dm_status AS kind, coalesce(c.dm_error, 'sem motivo') AS reason, count(*)::int AS n FROM social_comments c, b
               WHERE c.dm_status IN ('erro','pulada') AND c.updated_at >= b.s AND c.updated_at < b.e GROUP BY 1, 2 ORDER BY 1, 3 DESC`, [day]),
    db.query(`WITH ${BOUNDS} SELECT
               count(*) FILTER (WHERE c.status = 'equipe')::int AS team,
               count(*) FILTER (WHERE c.status = 'aprovada')::int AS queue,
               count(*) FILTER (WHERE c.dm_status = 'aprovada')::int AS dm_queue,
               count(*) FILTER (WHERE c.status = 'proposta')::int AS to_approve,
               count(*) FILTER (WHERE c.dm_status = 'proposta')::int AS dm_to_approve,
               count(*) FILTER (WHERE c.reason LIKE $2 AND c.updated_at >= b.s AND c.updated_at < b.e)::int AS blocked
             FROM social_comments c, b`, [day, CODE_REASON]),
    db.query(`WITH ${BOUNDS} SELECT count(*)::int AS runs, count(*) FILTER (WHERE j.attempts > 1)::int AS retried,
               count(*) FILTER (WHERE j.status = 'error')::int AS failed FROM jobs j, b
              WHERE j.kind IN ('comentarios_ia', 'comentarios_varredura') AND j.created_at >= b.s AND j.created_at < b.e`, [day]),
    replies.getConfig(), settings.get(`${replies.KEY}_varredura`), settings.get('outstand_inbox'), settings.get(replies.DM_KEY),
  ]);
  const sweep = parseJson(sweepS, {}); const inbox = parseJson(inboxS, {}); const dm = parseJson(dmS, {});
  // posts que a última leitura não conseguiu ler, com o título (para saber qual é e por quê)
  const failedIds = (sweep.failed || []).map((f) => f.publication_id).filter(Boolean);
  const titles = failedIds.length ? Object.fromEntries((await db.query(
    `SELECT p.id, coalesce(cl.post_title, cl.title, p.title) AS title FROM episode_publications p LEFT JOIN episode_clips cl ON cl.id = p.clip_id WHERE p.id = ANY($1::int[])`,
    [failedIds])).rows.map((r) => [r.id, r.title])) : {};
  sweep.failed = (sweep.failed || []).map((f) => ({ ...f, title: titles[f.publication_id] || 'Publicação', reason: readReason(f.error) }));
  const communityOk = Boolean((await require('./commentAutomation').links()).whatsapp_community);
  const dmPausedUntil = dm.next_at && new Date(dm.next_at) - now > 2 * 3600_000 ? dm.next_at : null; // intervalo normal é de minutos
  const alerts = [];
  if (isToday && cfg.on) {
    if (cfg.dm_on && !communityOk) alerts.push({ bad: false, icon: 'link', text: 'Os directs esperam o link da comunidade (Social > Automações).' });
    if (cfg.dm_on && dmPausedUntil) alerts.push({ bad: true, icon: 'pause', text: `Directs pausados até ${require('../utils/format').formatSoon(dmPausedUntil)}. Os prontos esperam na fila.` });
    const quiet = inbox.last_event_at ? (now - new Date(inbox.last_event_at)) / 3600_000 : null;
    if (quiet !== null && quiet >= 6 && replies.inWindow(cfg, now)) alerts.push({ bad: true, icon: 'unlink', text: `A Outstand não avisa um comentário há ${Math.floor(quiet)} h. A leitura de 30 em 30 minutos continua, mas confira o aviso em Integrações.` });
    if (ai.failed) alerts.push({ bad: true, icon: 'triangle-alert', text: `${ai.failed} leitura${ai.failed === 1 ? '' : 's'} da IA ${ai.failed === 1 ? 'falhou' : 'falharam'} hoje. Os comentários ficam na espera e entram na próxima leitura.` });
    if (dmErr.some((e) => e.kind === 'erro')) alerts.push({ bad: true, icon: 'send', text: 'Algum direct não saiu hoje. O motivo está em "Saúde da automação".' });
  }
  return {
    on: cfg.on, mode: cfg.mode, dmOn: cfg.dm_on, communityOk, dmPausedUntil, alerts,
    lastSweep: sweep.at ? sweep : null, lastEvent: inbox.last_event_at || null,
    replyErrors: replyErr, dmErrors: dmErr.filter((e) => e.kind === 'erro'), dmSkipped: dmErr.filter((e) => e.kind === 'pulada'),
    team: w.team, queue: w.queue, dmQueue: w.dm_queue, toApprove: w.to_approve, dmToApprove: w.dm_to_approve, blocked: w.blocked, ai,
  };
}

// Automação por palavra (quem comenta a palavra recebe o link no direct) no dia.
async function keyword(day) {
  const { rows: [r] } = await db.query(`WITH ${BOUNDS}
    SELECT count(*) FILTER (WHERE e.status IN ('enviado','simulado'))::int AS sent, count(*) FILTER (WHERE e.status = 'erro')::int AS errors,
           count(*) FILTER (WHERE e.status = 'ignorado')::int AS ignored, (SELECT count(*)::int FROM social_rules WHERE active) AS rules
      FROM social_events e, b WHERE e.created_at >= b.s AND e.created_at < b.e`, [day]);
  return r;
}

// Tudo da página Números.
async function forDay(day, { isToday = day === cal.todayISO(), now = new Date() } = {}) {
  const [c, avg, back, top, cov, sl, clicks, h, kw, fol] = await Promise.all([counts(day), average(day), cameBack(day), topPosts(day), coverage(day), slots(day),
    clicksOn(day), health(day, { isToday, now }), keyword(day), require('./daySummary').followers(day).catch(() => null)]);
  return { ...c, avg, back, top, coverage: cov, slots: sl, clicks, health: h, keyword: kw, instagram: fol?.instagram || null };
}

// A faixa curta do Resumo do dia: só quando as respostas por IA já leram algum comentário.
async function brief(day, { isToday = day === cal.todayISO(), now = new Date() } = {}) {
  const { rows: [any] } = await db.query('SELECT 1 AS ok FROM social_comments LIMIT 1');
  if (!any) return null;
  const [c, back, clicks, h] = await Promise.all([counts(day), cameBack(day), clicksOn(day), health(day, { isToday, now })]);
  const problems = h.replyErrors.reduce((s, e) => s + e.n, 0) + h.dmErrors.reduce((s, e) => s + e.n, 0) + h.ai.failed + h.blocked;
  return { ...c, back, clicks, team: h.team, dmQueue: h.dmQueue, problems, alerts: h.alerts.length };
}

module.exports = { CLICKS_KEY, counts, average, cameBack, topPosts, coverage, slots, clicksOn, snapshotClicks, health, keyword, forDay, brief };
