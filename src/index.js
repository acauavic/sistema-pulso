const http = require('http');
const config = require('./config');
config.assertConfig();

const db = require('./db/pool');
const { migrate } = require('./db/migrate');
const { purgeExpired } = require('./auth/sessions');
const { createApp } = require('./app');

// Papel do processo (ROLE): "web" atende o painel; "worker" roda a fila (FFmpeg, IA, e-mails) e as rotinas do sistema;
// "all" (padrão, bom para desenvolvimento e para uma máquina só) faz os dois. Em produção: um serviço web (pode ter réplicas)
// e um worker. WORKER=false (antigo) equivale a ROLE=web.
const ROLE = ['web', 'worker', 'all'].includes(process.env.ROLE) ? process.env.ROLE : (process.env.WORKER === 'false' ? 'web' : 'all');
const runsWeb = ROLE !== 'worker';
const runsWorker = ROLE !== 'web';

// Rotinas do sistema: cada uma roda em uma réplica por vez (trava no Postgres).
function registerRoutines() {
  const scheduler = require('./services/scheduler');
  scheduler.every('publicacoes', 30_000, () => require('./services/publishing').tick());
  scheduler.every('fila-travada', 60_000, () => require('./services/jobs').recoverStuck());
  scheduler.every('tarefas-vencendo', 15 * 60_000, () => require('./services/tasks').dueTick(), { delayMs: 20_000 });
  scheduler.every('lembretes', 5 * 60_000, () => require('./services/reminders').tick(), { delayMs: 30_000 });
  scheduler.every('automacoes', 5 * 60_000, () => require('./services/social').runRules(), { delayMs: 60_000 });
  scheduler.every('financeiro', 3600_000, () => require('./services/finance').tick(), { delayMs: 45_000 });
  scheduler.every('limpeza', 6 * 3600_000, async () => {
    await purgeExpired();
    await require('./services/sponsorSessions').purgeExpired();
    await require('./auth/rateLimit').purge();
    await db.query("DELETE FROM jobs WHERE status = 'done' AND finished_at < now() - interval '30 days'");
    await db.query("DELETE FROM worker_heartbeats WHERE seen_at < now() - interval '1 day'");
  }, { delayMs: 120_000 });
  return scheduler;
}

async function main() {
  if (config.autoMigrate) {
    const applied = await migrate();
    if (applied.length) console.log(`Migrations aplicadas: ${applied.join(', ')}`);
  }

  // executores da fila (registrar em todo processo: o web também enfileira, e no "all" ele mesmo roda)
  require('./services/finalizationJob');
  require('./services/clips');
  require('./services/social');
  require('./services/notify');
  require('./services/push'); // registra o trabalho 'push_notificacao'

  let server = null;
  let scheduler = null;
  if (runsWorker) {
    await require('./services/jobs').startWorker();
    scheduler = registerRoutines();
    scheduler.start({ role: ROLE });
  }
  if (runsWeb) {
    await require('./services/realtime').listen();
    const app = createApp();
    server = app.listen(config.port, () => {
      console.log(`Pulso Gestão (${ROLE}) no ar em ${config.appBaseUrl} (porta ${config.port})`);
      if (!config.mailConfigured) console.warn('AVISO: SMTP da Brevo não configurado — e-mails não serão enviados.');
      if (!config.yourlsConfigured) console.warn('AVISO: YOURLS não configurado — links curtos desativados.');
    });
  } else {
    // worker sozinho: só o /healthz (para o HEALTHCHECK do Docker), sem o painel
    server = http.createServer(async (req, res) => {
      if (req.url !== '/healthz') { res.writeHead(404); return res.end(); }
      try { await db.query('SELECT 1'); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true,"role":"worker"}'); } catch { res.writeHead(503); res.end('{"ok":false}'); }
    }).listen(config.port, () => console.log(`Pulso Gestão (worker) rodando a fila e as rotinas; saúde em :${config.port}/healthz`));
  }

  // Encerramento: para de pegar trabalho novo, espera o atual (até 8 s) e fecha as conexões.
  const shutdown = async (signal) => {
    console.log(`${signal} recebido, encerrando...`);
    setTimeout(() => process.exit(1), 15_000).unref();
    if (scheduler) await scheduler.stop();
    if (runsWorker) await require('./services/jobs').stopWorker();
    if (runsWeb) require('./services/realtime').stop();
    server.close(() => db.close().finally(() => process.exit(0)));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Falha ao iniciar:', err.message);
  process.exit(1);
});
