// Fila de trabalhos em segundo plano (FFmpeg, transcrição, IA, e-mails), persistida no Postgres.
// Vários processos podem rodar a fila ao mesmo tempo: `FOR UPDATE SKIP LOCKED` garante que um trabalho tem um dono só.
// Falha passageira (rede, cota da IA, 5xx) volta para a fila com espera crescente; falha de verdade (arquivo inválido…) para na hora.
// Quem roda manda sinal de vida (heartbeat): trabalho "rodando" sem sinal há mais de 3 minutos volta para a fila (processo caiu).
// Enfileirar acorda os workers na hora (LISTEN/NOTIFY), sem esperar a próxima volta.
const os = require('os');
const db = require('../db/pool');

const handlers = new Map();
const errorHooks = new Map();
const WORKER_ID = `${os.hostname()}:${process.pid}`;
const CHANNEL = 'pulso_jobs';
// Duas pistas por processo: a pesada (FFmpeg + IA, minutos) não segura a leve (e-mails, ideias), que roda em paralelo.
const HEAVY = ['corte', 'finalizacao'];
// onError(job, err): avisar alguém quando o trabalho falha de vez (ex.: notificação de rotina do sistema).
const register = (kind, fn, { onError } = {}) => { handlers.set(kind, fn); if (onError) errorHooks.set(kind, onError); };

// Enfileira. Se já existe um igual esperando ou rodando para o mesmo episódio/ref, devolve esse (não duplica).
async function enqueue(kind, { episodeId = null, refId = null, payload = {}, maxAttempts = 3, delayMs = 0, createdBy = null } = {}) {
  const { rows: [existing] } = await db.query(
    `SELECT * FROM jobs WHERE kind = $1 AND episode_id IS NOT DISTINCT FROM $2 AND ref_id IS NOT DISTINCT FROM $3 AND status IN ('queued','running') ORDER BY id LIMIT 1`,
    [kind, episodeId, refId]);
  if (existing) return existing;
  const { rows: [job] } = await db.query(
    `INSERT INTO jobs (kind, episode_id, ref_id, payload, max_attempts, run_after, created_by)
     VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' milliseconds')::interval, $7) RETURNING *`,
    [kind, episodeId, refId, JSON.stringify(payload), maxAttempts, String(Math.max(0, delayMs)), createdBy]);
  await db.query('SELECT pg_notify($1, $2)', [CHANNEL, String(job.id)]).catch(() => {});
  return job;
}

const update = (id, { message, progress }) => db.query(
  'UPDATE jobs SET message = coalesce($2, message), progress = coalesce($3, progress), heartbeat_at = now() WHERE id = $1', [id, message ?? null, progress ?? null]);

// lane: 'pesada' (só HEAVY), 'leve' (o resto) ou null (qualquer um).
async function claim(lane = null) {
  const filter = lane === 'pesada' ? 'AND kind = ANY($2::text[])' : lane === 'leve' ? 'AND NOT (kind = ANY($2::text[]))' : '';
  const { rows } = await db.query(
    `UPDATE jobs SET status = 'running', started_at = now(), heartbeat_at = now(), attempts = attempts + 1, worker = $1,
            message = CASE WHEN attempts > 0 THEN 'Tentando de novo…' ELSE 'Começando…' END, progress = 0
      WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= now() ${filter} ORDER BY run_after, id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`, lane ? [WORKER_ID, HEAVY] : [WORKER_ID]);
  return rows[0] || null;
}

// Vale tentar de novo? Cota da IA, rede, tempo esgotado e erro do lado do serviço, sim. O resto (arquivo inválido, dado faltando), não.
const QUOTA = /\b429\b|quota|RESOURCE_EXHAUSTED|rate.?limit/i;
const TRANSIENT = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|socket hang up|timeout|timed out|aborted|\b5\d\d\b|indisponível|unavailable|overloaded/i;
function retryDelay(err, attempt) {
  if (err && err.retryable === false) return null;
  const msg = String(err?.message || err);
  if (QUOTA.test(msg)) return 15 * 60_000; // cota: espera a janela abrir de novo
  if (err?.retryable === true || TRANSIENT.test(msg)) return 30_000 * 4 ** (attempt - 1); // 30 s, 2 min, 8 min…
  return null;
}

// Roda o próximo da fila (se houver). Devolve o trabalho final ou null.
async function runNext({ lane = null } = {}) {
  const job = await claim(lane);
  if (!job) return null;
  const handler = handlers.get(job.kind);
  const beat = setInterval(() => db.query('UPDATE jobs SET heartbeat_at = now() WHERE id = $1', [job.id]).catch(() => {}), 15_000);
  beat.unref();
  try {
    if (!handler) throw Object.assign(new Error(`Sem executor para "${job.kind}".`), { retryable: false });
    const result = await handler(job, { update: (m, p) => update(job.id, { message: m, progress: p }) });
    const { rows: [done] } = await db.query(
      "UPDATE jobs SET status = 'done', progress = 100, message = 'Pronto', error = NULL, result = $2, finished_at = now() WHERE id = $1 RETURNING *", [job.id, JSON.stringify(result || {})]);
    return done;
  } catch (err) {
    const wait = job.attempts < job.max_attempts ? retryDelay(err, job.attempts) : null;
    if (wait != null) {
      console.warn(`[job ${job.id} ${job.kind}] falhou (tentativa ${job.attempts}/${job.max_attempts}), nova tentativa em ${Math.round(wait / 1000)} s:`, err.message);
      const { rows: [again] } = await db.query(
        `UPDATE jobs SET status = 'queued', error = $2, run_after = now() + ($3 || ' milliseconds')::interval, worker = NULL,
                message = $4 WHERE id = $1 RETURNING *`,
        [job.id, String(err.message).slice(0, 1000), String(wait), QUOTA.test(err.message) ? 'Cota da IA esgotada: tenta de novo em 15 min' : `Falhou; nova tentativa em ${Math.max(1, Math.round(wait / 60_000))} min`]);
      return again;
    }
    console.error(`[job ${job.id} ${job.kind}] falhou de vez:`, err.message);
    const { rows: [failed] } = await db.query(
      "UPDATE jobs SET status = 'error', error = $2, message = 'Falhou', finished_at = now() WHERE id = $1 RETURNING *", [job.id, String(err.message).slice(0, 1000)]);
    const hook = errorHooks.get(job.kind);
    if (hook) await Promise.resolve(hook(failed, err)).catch((e) => console.error(`[job ${job.id}] aviso de falha:`, e.message));
    return failed;
  } finally {
    clearInterval(beat);
  }
}

// Trabalho "rodando" sem sinal de vida (o processo caiu ou foi reiniciado): volta para a fila, ou falha se esgotou as tentativas.
async function recoverStuck({ olderThanMs = 3 * 60_000 } = {}) {
  const { rows } = await db.query(
    `UPDATE jobs SET status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'error' END,
            error = coalesce(error, 'O processo que rodava este trabalho parou.'), worker = NULL,
            message = CASE WHEN attempts < max_attempts THEN 'Retomando: o processo anterior parou' ELSE 'Falhou' END,
            finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE now() END
      WHERE status = 'running' AND coalesce(heartbeat_at, started_at) < now() - ($1 || ' milliseconds')::interval RETURNING id, status`, [String(olderThanMs)]);
  return rows;
}

// Gestão > Sistema: mandar de novo um trabalho que falhou.
const retryJob = (id) => db.query(
  "UPDATE jobs SET status = 'queued', attempts = 0, run_after = now(), error = NULL, message = 'Na fila de novo', finished_at = NULL WHERE id = $1 AND status = 'error' RETURNING *", [id])
  .then(async (r) => { if (r.rows[0]) await db.query('SELECT pg_notify($1, $2)', [CHANNEL, String(id)]).catch(() => {}); return r.rows[0] || null; });

let timer = null; let stopping = false; let listener = null;
const lanes = { pesada: { busy: false, running: null }, leve: { busy: false, running: null } };
async function drainLane(name) {
  const l = lanes[name];
  if (l.busy || stopping) return;
  l.busy = true;
  try {
    while (!stopping) {
      l.running = runNext({ lane: name });
      const job = await l.running;
      l.running = null;
      if (!job) break;
    }
  } catch (err) { console.error(`worker (${name}):`, err.message); } finally { l.busy = false; l.running = null; }
}
const drain = () => { drainLane('pesada'); drainLane('leve'); };

// Liga o processador neste processo: acorda com NOTIFY e, por garantia, confere a fila a cada `intervalMs`.
async function startWorker({ intervalMs = 5000 } = {}) {
  stopping = false;
  await recoverStuck().catch(() => {});
  try {
    listener = await db.getPool().connect();
    listener.on('notification', () => drain());
    listener.on('error', (err) => console.error('fila (LISTEN):', err.message));
    await listener.query(`LISTEN ${CHANNEL}`);
  } catch (err) { console.error('fila: sem LISTEN, só conferência periódica:', err.message); listener = null; }
  timer = setInterval(drain, intervalMs);
  timer.unref();
  drain();
}

// Para de pegar trabalho novo e espera o atual terminar (até `waitMs`).
async function stopWorker({ waitMs = 8000 } = {}) {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
  if (listener) { listener.release(); listener = null; }
  const current = Object.values(lanes).map((l) => l.running).filter(Boolean);
  if (current.length) await Promise.race([Promise.allSettled(current), new Promise((r) => setTimeout(r, waitMs))]);
}

const latest = (episodeId, kind, refId = null) => db.query(
  'SELECT * FROM jobs WHERE episode_id = $1 AND kind = $2 AND ref_id IS NOT DISTINCT FROM $3 ORDER BY id DESC LIMIT 1', [episodeId, kind, refId]).then((r) => r.rows[0] || null);

module.exports = { WORKER_ID, HEAVY, register, enqueue, update, runNext, recoverStuck, retryJob, retryDelay, startWorker, stopWorker, latest };
