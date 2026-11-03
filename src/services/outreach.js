// Cadência de abordagem: cada contato com um convidado (etapa "Convite enviado") ou patrocinador (etapa "Prospecção") é registrado
// por canal e endereço (Instagram, e-mail, WhatsApp, telefone), o sistema diz quando é o próximo follow-up e quando parece perdido
// (sem resposta depois da última tentativa). A gestão configura os intervalos e a meta diária de patrocinadores.
// O sistema só INDICA o possível perdido; quem decide é a pessoa.
const db = require('../db/pool');
const settingsSvc = require('./settings');
const cal = require('./calendar');
const { TZ } = require('../utils/format');

const CHANNELS = { instagram: 'Instagram', email: 'E-mail', whatsapp: 'WhatsApp', telefone: 'Telefone', outro: 'Outro' };
const RESULTS = { enviado: 'Enviei', respondeu: 'Respondeu' };
// Onde a cadência vale: tabela, coluna da etapa e a etapa em que a pessoa está sendo abordada.
const KINDS = {
  guest: { table: 'guests', col: 'status', stage: 'convite_enviado', base: '/convidados', name: 'convidado' },
  sponsor: { table: 'sponsors', col: 'stage', stage: 'prospect', base: '/patrocinadores', name: 'patrocinador' },
};
const DEFAULTS = { guest: [3, 4, 7, 7], sponsor: [3, 5, 7, 14], sponsorGoal: 5 };
const MAX_STEPS = 10;

const dayOf = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ts));
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
const isWeekday = (iso) => { const d = new Date(`${iso}T12:00:00Z`).getUTCDay(); return d >= 1 && d <= 5; };

// ---------------------------------------------------------------- configuração
const parseSteps = (text, fallback) => {
  const list = String(text ?? '').split(/[^0-9]+/).filter(Boolean).map(Number).filter((n) => n >= 1 && n <= 90).slice(0, MAX_STEPS);
  return list.length ? list : fallback;
};

async function config() {
  let saved = {};
  try { saved = JSON.parse(await settingsSvc.get('outreach_config') || '{}'); } catch { /* usa o padrão */ }
  const goal = Number(saved.sponsorGoal);
  return {
    guest: parseSteps((saved.guest || []).join(','), DEFAULTS.guest), sponsor: parseSteps((saved.sponsor || []).join(','), DEFAULTS.sponsor),
    sponsorGoal: Number.isInteger(goal) && goal >= 0 && goal <= 200 ? goal : DEFAULTS.sponsorGoal,
  };
}

// body: { guest: "3, 4, 7", sponsor: "...", goal_default: "5", goal_<userId>: "8" (vazio = padrão) }
async function saveConfig(body, users) {
  const cur = await config();
  const next = { guest: parseSteps(body.guest, cur.guest), sponsor: parseSteps(body.sponsor, cur.sponsor), sponsorGoal: cur.sponsorGoal };
  const g = Number(body.goal_default);
  if (String(body.goal_default ?? '').trim() !== '' && Number.isInteger(g) && g >= 0 && g <= 200) next.sponsorGoal = g;
  await settingsSvc.set('outreach_config', JSON.stringify(next));
  for (const u of users) {
    const raw = String(body[`goal_${u.id}`] ?? '').trim();
    if (raw === '') { await db.query('DELETE FROM outreach_goals WHERE user_id = $1', [u.id]); continue; }
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n <= 200) await db.query('INSERT INTO outreach_goals (user_id, daily_target) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET daily_target = EXCLUDED.daily_target, updated_at = now()', [u.id, n]);
  }
  return next;
}

// Meta diária de abordagens de patrocinadores: a de cada pessoa, ou o padrão para as produtoras.
async function goals(users) {
  const cfg = await config();
  const { rows } = await db.query('SELECT user_id, daily_target FROM outreach_goals');
  const own = new Map(rows.map((r) => [r.user_id, r.daily_target]));
  return new Map(users.map((u) => [u.id, own.has(u.id) ? own.get(u.id) : (u.role === 'produtora' ? cfg.sponsorGoal : 0)]));
}

// ---------------------------------------------------------------- avaliação de um assunto
// attempts: abordagens do ciclo atual (desde que entrou na etapa), de qualquer ordem.
function evaluate(kind, enteredAt, attempts, cfg, today = cal.todayISO()) {
  const steps = cfg[kind]; const list = [...attempts].sort((a, b) => new Date(a.at) - new Date(b.at));
  const sends = list.filter((a) => a.result === 'enviado'); const replies = list.filter((a) => a.result === 'respondeu');
  const byChannel = {}; for (const a of sends) byChannel[a.channel] = (byChannel[a.channel] || 0) + 1;
  const lastSend = sends.at(-1) || null; const lastReply = replies.at(-1) || null;
  const out = { attempts: sends.length, byChannel, lastAt: lastSend ? lastSend.at : null, lastChannel: lastSend ? lastSend.channel : null, repliedAt: lastReply ? lastReply.at : null, replyChannel: lastReply ? lastReply.channel : null, steps: steps.length, due: null, daysTo: null, state: 'em_dia' };
  if (lastReply && (!lastSend || new Date(lastReply.at) >= new Date(lastSend.at))) return { ...out, state: 'respondeu' };
  if (kind === 'sponsor' && !sends.length) return { ...out, state: 'a_abordar' };
  const ref = lastSend ? dayOf(lastSend.at) : dayOf(enteredAt);
  const idx = kind === 'guest' ? sends.length : sends.length - 1;
  out.due = cal.addDays(ref, steps[Math.min(idx, steps.length - 1)]);
  out.daysTo = daysBetween(today, out.due);
  if (out.daysTo > 0) return { ...out, state: 'em_dia' };
  if (idx >= steps.length) return { ...out, state: 'possivel_perdido' };
  return { ...out, state: out.daysTo === 0 ? 'hoje' : 'atrasado' };
}

// Quem precisa de ação: hoje, atrasado ou possível perdido.
const NEEDS = new Set(['hoje', 'atrasado', 'possivel_perdido']);

// Avaliação de todos os assuntos de uma etapa (ou só de alguns ids): Map id -> { ...subject, ...evaluate() }.
async function evaluateAll(kind, { ids = null, ownerId = null } = {}) {
  const k = KINDS[kind]; const cfg = await config(); const p = [k.stage]; let w = `s.${k.col} = $1`;
  if (ids) { p.push(ids); w += ` AND s.id = ANY($${p.length})`; }
  if (ownerId) { p.push(ownerId); w += ` AND s.owner_id = $${p.length}`; }
  const nameCol = kind === 'guest' ? 's.name' : 's.company AS name';
  const { rows: subjects } = await db.query(`SELECT s.id, ${nameCol}, s.owner_id, s.stage_entered_at, u.name AS owner_name FROM ${k.table} s LEFT JOIN users u ON u.id = s.owner_id WHERE ${w}`, p);
  const { rows: attempts } = subjects.length ? await db.query(
    `SELECT a.subject_id, a.channel, a.result, a.at FROM outreach_attempts a JOIN ${k.table} s ON s.id = a.subject_id WHERE a.subject_type = $1 AND a.subject_id = ANY($2) AND a.created_at >= s.stage_entered_at`, [kind, subjects.map((s) => s.id)]) : { rows: [] };
  const by = new Map(); for (const a of attempts) { if (!by.has(a.subject_id)) by.set(a.subject_id, []); by.get(a.subject_id).push(a); }
  const out = new Map();
  for (const s of subjects) out.set(s.id, { ...s, kind, ...evaluate(kind, s.stage_entered_at, by.get(s.id) || [], cfg) });
  return out;
}

// Texto para a tela: { tone: ok|warn|bad|muted, text (frase inteira), short (chip) }.
const ddmm = (iso) => iso.split('-').reverse().slice(0, 2).join('/');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function describe(sm) {
  switch (sm.state) {
    case 'respondeu': return { tone: 'ok', text: `Respondeu em ${ddmm(dayOf(sm.repliedAt))}${sm.replyChannel ? ` pelo ${CHANNELS[sm.replyChannel]}` : ''}. A cadência parou.`, short: 'respondeu' };
    case 'a_abordar': return { tone: 'warn', text: 'Ainda não abordado. Registre a primeira abordagem.', short: 'a abordar' };
    case 'hoje': return { tone: 'warn', text: 'Follow-up para hoje.', short: 'follow-up hoje' };
    case 'atrasado': return { tone: 'bad', text: `Follow-up atrasado há ${plural(-sm.daysTo, 'dia', 'dias')} (era ${ddmm(sm.due)}).`, short: `atrasado ${-sm.daysTo}d` };
    case 'possivel_perdido': return { tone: 'bad', text: `Sem resposta depois de ${plural(sm.attempts, 'abordagem', 'abordagens')}: pode ser dado como perdido.`, short: 'possível perdido' };
    default: return { tone: 'muted', text: `Próximo follow-up ${sm.daysTo === 1 ? 'amanhã' : `em ${sm.daysTo} dias`} (${ddmm(sm.due)}).`, short: sm.daysTo === 1 ? 'follow-up amanhã' : `follow-up em ${sm.daysTo}d` };
  }
}

// ---------------------------------------------------------------- registrar, listar, apagar
// Endereços já conhecidos por canal: o do cadastro e os já usados antes.
async function knownAddresses(kind, id, subject) {
  const out = { instagram: [], email: [], whatsapp: [], telefone: [], outro: [] };
  const add = (ch, v) => { const t = String(v || '').trim(); if (t && !out[ch].includes(t)) out[ch].push(t); };
  if (kind === 'guest') { if (subject.instagram) add('instagram', `@${String(subject.instagram).replace(/^@/, '')}`); add('email', subject.email); add('whatsapp', subject.phone); add('telefone', subject.phone); }
  else { add('email', subject.contact_email); add('whatsapp', subject.contact_phone); add('telefone', subject.contact_phone); }
  const { rows } = await db.query('SELECT DISTINCT channel, address FROM outreach_attempts WHERE subject_type = $1 AND subject_id = $2 AND address IS NOT NULL', [kind, id]);
  for (const r of rows) add(r.channel, r.address);
  return out;
}

async function history(kind, id) {
  const { rows } = await db.query(
    `SELECT a.*, u.name AS user_name FROM outreach_attempts a LEFT JOIN users u ON u.id = a.user_id WHERE a.subject_type = $1 AND a.subject_id = $2 ORDER BY a.at DESC, a.id DESC LIMIT 100`, [kind, id]);
  return rows;
}

// body: { canal, addr, novo, resultado, nota, quando (AAAA-MM-DD) }
async function register(kind, id, body, userId) {
  if (!CHANNELS[body.canal]) return { error: 'Escolha o canal.' };
  const result = RESULTS[body.resultado] ? body.resultado : 'enviado';
  let address = String(body.addr === '__novo' ? body.novo : (body.addr || '')).replace(/\s+/g, ' ').trim().slice(0, 160);
  if (body.addr === '__novo' && !address) return { error: 'Informe o endereço usado (o @, o e-mail ou o número).' };
  if (body.canal === 'instagram' && address && !address.startsWith('@') && !/\s/.test(address) && !address.includes('/')) address = `@${address}`;
  const today = cal.todayISO(); let at = new Date();
  const when = String(body.quando || '').trim();
  if (when && when !== today) {
    if (!cal.isISO(when) || when > today) return { error: 'A data da abordagem não pode ser no futuro.' };
    if (daysBetween(when, today) > 60) return { error: 'Só dá para registrar abordagens dos últimos 60 dias.' };
    at = new Date(`${when}T12:00:00-03:00`);
  }
  const { rows: [row] } = await db.query(
    'INSERT INTO outreach_attempts (subject_type, subject_id, channel, address, result, note, at, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [kind, id, body.canal, address || null, result, String(body.nota || '').trim().slice(0, 500) || null, at, userId]);
  return { ok: true, attempt: row };
}

async function remove(attemptId) {
  const { rows: [row] } = await db.query('DELETE FROM outreach_attempts WHERE id = $1 RETURNING *', [attemptId]);
  return row || null;
}

// ---------------------------------------------------------------- meta diária e painel de hoje
const sponsorSendsToday = async (userId) => Number((await db.query(
  `SELECT count(*)::int AS n FROM outreach_attempts WHERE subject_type = 'sponsor' AND result = 'enviado' AND user_id = $1 AND (at AT TIME ZONE '${TZ}')::date = $2::date`, [userId, cal.todayISO()])).rows[0].n);

// O que a pessoa tem para fazer hoje: follow-ups dela (e o que está sem dono, que é de todos) + meta de patrocinadores.
async function todayFor(user) {
  const [g, s] = await Promise.all([evaluateAll('guest'), evaluateAll('sponsor')]);
  const mine = (x) => !x.owner_id || x.owner_id === user.id;
  const items = [...g.values(), ...s.values()].filter((x) => NEEDS.has(x.state) && mine(x))
    .sort((a, b) => ({ possivel_perdido: 2, atrasado: 0, hoje: 1 }[a.state] - { possivel_perdido: 2, atrasado: 0, hoje: 1 }[b.state]) || a.name.localeCompare(b.name, 'pt-BR'));
  const toApproach = [...s.values()].filter((x) => x.state === 'a_abordar' && x.owner_id === user.id).length;
  const target = (await goals([{ id: user.id, role: user.role }])).get(user.id);
  return { items, toApproach, goal: { target, done: await sponsorSendsToday(user.id) } };
}

// ---------------------------------------------------------------- painel da gestão
// days: janela (7, 30, 90). Devolve tudo que a página mostra.
async function report(days) {
  const to = cal.todayISO(); const from = cal.addDays(to, -(days - 1));
  const win = `(a.at AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date`;
  const [{ rows: perChannel }, { rows: perUser }, { rows: perDay }, { rows: users }, g, s, cfg] = await Promise.all([
    db.query(`SELECT a.subject_type, a.channel, count(*) FILTER (WHERE a.result = 'enviado')::int AS sent, count(*) FILTER (WHERE a.result = 'respondeu')::int AS replies FROM outreach_attempts a WHERE ${win} GROUP BY 1, 2`, [from, to]),
    db.query(`SELECT a.user_id, a.subject_type, count(*) FILTER (WHERE a.result = 'enviado')::int AS sent, count(*) FILTER (WHERE a.result = 'respondeu')::int AS replies FROM outreach_attempts a WHERE ${win} GROUP BY 1, 2`, [from, to]),
    db.query(`SELECT a.user_id, to_char((a.at AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS day, count(*)::int AS sent FROM outreach_attempts a WHERE a.subject_type = 'sponsor' AND a.result = 'enviado' AND ${win} GROUP BY 1, 2`, [from, to]),
    db.query("SELECT id, name, role FROM users WHERE active AND role IN ('superadmin','gestao','produtora') ORDER BY lower(name)"),
    evaluateAll('guest'), evaluateAll('sponsor'), config(),
  ]);
  const goalOf = await goals(users);
  const channels = Object.keys(CHANNELS).map((ch) => {
    const row = (t) => perChannel.find((r) => r.subject_type === t && r.channel === ch) || { sent: 0, replies: 0 };
    return { key: ch, label: CHANNELS[ch], guest: row('guest'), sponsor: row('sponsor'), sent: row('guest').sent + row('sponsor').sent, replies: row('guest').replies + row('sponsor').replies };
  });
  const goalDays = []; for (let d = from; d <= to; d = cal.addDays(d, 1)) if (isWeekday(d)) goalDays.push(d);
  const people = users.map((u) => {
    const mine = (t) => perUser.find((r) => r.user_id === u.id && r.subject_type === t) || { sent: 0, replies: 0 };
    const target = goalOf.get(u.id) || 0;
    const sentByDay = new Map(perDay.filter((r) => r.user_id === u.id).map((r) => [r.day, r.sent]));
    const hit = target ? goalDays.filter((d) => (sentByDay.get(d) || 0) >= target).length : 0;
    const sponsorSent = mine('sponsor').sent;
    const overdue = [...g.values(), ...s.values()].filter((x) => x.owner_id === u.id && ['atrasado', 'possivel_perdido'].includes(x.state)).length;
    return { id: u.id, name: u.name, role: u.role, guest: mine('guest'), sponsor: mine('sponsor'), target, hitDays: hit, goalDays: goalDays.length, avgPerDay: goalDays.length ? Math.round((sponsorSent / goalDays.length) * 10) / 10 : 0, overdue };
  }).filter((p) => p.guest.sent || p.sponsor.sent || p.target || p.overdue || p.guest.replies || p.sponsor.replies);
  const all = [...g.values(), ...s.values()];
  const queue = all.filter((x) => ['atrasado', 'possivel_perdido'].includes(x.state)).sort((a, b) => (a.state === b.state ? a.daysTo - b.daysTo : a.state === 'possivel_perdido' ? 1 : -1)).slice(0, 12);
  const sent = channels.reduce((n, c) => n + c.sent, 0); const replies = channels.reduce((n, c) => n + c.replies, 0);
  const guestsIn = [...g.values()]; const noAttempt = guestsIn.filter((x) => x.attempts === 0 && x.state !== 'respondeu').length;
  const { rows: [fill] } = await db.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE a.address IS NULL)::int AS no_address FROM outreach_attempts a WHERE a.result = 'enviado' AND ${win}`, [from, to]);
  const goalPeople = people.filter((p) => p.target && p.goalDays);
  const goalRate = goalPeople.length ? Math.round((goalPeople.reduce((n, p) => n + p.hitDays, 0) / goalPeople.reduce((n, p) => n + p.goalDays, 0)) * 100) : null;
  return {
    days, from, to, cfg, channels, people, queue, sent, replies, replyRate: sent ? Math.round((replies / sent) * 100) : null,
    states: { atrasado: all.filter((x) => x.state === 'atrasado').length, hoje: all.filter((x) => x.state === 'hoje').length, possivel_perdido: all.filter((x) => x.state === 'possivel_perdido').length, a_abordar: [...s.values()].filter((x) => x.state === 'a_abordar').length },
    fill: { guestsInStage: guestsIn.length, noAttempt, noAddress: fill.no_address, sentTotal: fill.total, unowned: all.filter((x) => !x.owner_id).length },
    goalRate, users,
  };
}

// ---------------------------------------------------------------- aviso diário (rotina)
// Um aviso por pessoa por dia, depois das 8h: quantos follow-ups hoje/atrasados e quantos parecem perdidos.
async function dailyNotice(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(now));
  if (hour < 8) return 0;
  const today = cal.todayISO(); if (!isWeekday(today)) return 0;
  const [g, s] = await Promise.all([evaluateAll('guest'), evaluateAll('sponsor')]);
  const byOwner = new Map();
  for (const x of [...g.values(), ...s.values()]) {
    if (!x.owner_id || !NEEDS.has(x.state)) continue;
    const o = byOwner.get(x.owner_id) || { due: 0, lost: 0 }; if (x.state === 'possivel_perdido') o.lost += 1; else o.due += 1; byOwner.set(x.owner_id, o);
  }
  const notify = require('./notify'); let n = 0;
  for (const [userId, o] of byOwner) {
    const parts = [o.due && `${o.due} follow-up${o.due > 1 ? 's' : ''} para hoje ou atrasado${o.due > 1 ? 's' : ''}`, o.lost && `${o.lost} sem resposta que pode${o.lost > 1 ? 'm' : ''} ser dado${o.lost > 1 ? 's' : ''} como perdido${o.lost > 1 ? 's' : ''}`].filter(Boolean);
    const made = await notify.notify({ type: 'cadencia', users: [userId], title: `Follow-ups de hoje: ${parts.join(' e ')}`, url: '/', dedupe: `cadencia-${today}` });
    n += made.length;
  }
  return n;
}

module.exports = { describe, dayOf, CHANNELS, RESULTS, KINDS, NEEDS, DEFAULTS, config, saveConfig, goals, evaluate, evaluateAll, knownAddresses, history, register, remove, todayFor, report, dailyNotice, sponsorSendsToday, parseSteps };
