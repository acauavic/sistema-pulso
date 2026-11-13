// Vigia do próprio sistema. O worker é quem publica os agendados, faz as novas tentativas e roda a fila: se ele para, nada sai e
// ninguém fica sabendo (é ele quem avisaria). Duas pontas:
//  - no painel (check, a cada minuto): sem sinal do worker há 3 min, rotina de publicações parada há 15 min ou publicação agendada
//    atrasada há 10 min viram aviso para a gestão (uma vez por hora para cada problema);
//  - no worker (selfCheck): se o banco não responde em 30 s duas vezes seguidas (pool de conexões esgotado, como em 26/10), o processo
//    sai e o Docker o reinicia (restart: unless-stopped).
const db = require('../db/pool');

const minutes = (s) => Math.max(1, Math.round(Number(s) / 60));
const hourKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 13);

async function check({ now = Date.now() } = {}) {
  const problems = [];
  const { rows: [w] } = await db.query("SELECT extract(epoch FROM now() - max(seen_at))::int AS idle, count(*)::int AS n FROM worker_heartbeats WHERE role <> 'web'");
  if (w.n && w.idle > 180) {
    problems.push({ key: 'worker', title: 'O worker parou', body: `Sem sinal do processo que publica nas redes e roda a fila há ${minutes(w.idle)} min: agendados, novas tentativas, cortes e e-mails não andam. Confira o serviço worker na VPS.` });
  }
  const { rows: [r] } = await db.query("SELECT extract(epoch FROM now() - greatest(started_at, coalesce(finished_at, started_at)))::int AS idle FROM scheduler_runs WHERE name = 'publicacoes'");
  if (r && r.idle > 900 && !problems.length) {
    problems.push({ key: 'rotina', title: 'A rotina de publicações parou', body: `A rotina que publica os agendados e faz as novas tentativas não roda há ${minutes(r.idle)} min. Veja Gestão > Sistema.` });
  }
  const { rows: late } = await db.query("SELECT id, title, scheduled_at FROM episode_publications WHERE status = 'agendado' AND scheduled_at < now() - interval '10 minutes' ORDER BY scheduled_at LIMIT 3");
  if (late.length) {
    const when = (d) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(d);
    problems.push({ key: 'atrasada', title: late.length > 1 ? 'Publicações agendadas atrasadas' : 'Publicação agendada atrasada', body: `${late.map((p) => `${p.title} (${when(p.scheduled_at)})`).join('; ')} ainda não saiu. O worker está rodando? Veja Gestão > Sistema.` });
  }
  const notify = require('./notify').notify;
  for (const p of problems) {
    console.warn(`[vigia] ${p.title}: ${p.body}`);
    await notify({ type: 'integracao', broadcast: true, title: p.title, body: p.body, url: '/gestao/sistema', dedupe: `vigia-${p.key}-${hourKey(now)}` }).catch((err) => console.error('vigia:', err.message));
  }
  return problems;
}

let misses = 0;
async function selfCheck({ timeoutMs = 30_000, exit = (code) => process.exit(code) } = {}) {
  let timer;
  const ok = await Promise.race([
    db.query('SELECT 1').then(() => true).catch(() => false),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
  ]);
  clearTimeout(timer);
  misses = ok ? 0 : misses + 1;
  if (misses >= 2) { console.error('[vigia] o banco não responde há 2 conferências seguidas: reiniciando o worker'); exit(1); }
  return ok;
}

// Liga a vigia no processo: o painel confere a cada minuto (começa 3 min depois de subir, para não avisar no meio de um deploy).
function start({ web = false, worker = false } = {}) {
  const timers = [];
  if (web) timers.push(setTimeout(() => { check().catch((e) => console.error('vigia:', e.message)); timers.push(setInterval(() => check().catch((e) => console.error('vigia:', e.message)), 60_000).unref()); }, 3 * 60_000).unref());
  if (worker) timers.push(setInterval(() => selfCheck().catch(() => {}), 60_000).unref());
  return () => timers.forEach((t) => clearInterval(t));
}

module.exports = { check, selfCheck, start };
