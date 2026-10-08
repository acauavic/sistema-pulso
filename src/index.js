const config = require('./config');
config.assertConfig();

const db = require('./db/pool');
const { migrate } = require('./db/migrate');
const { seedDefaultTemplate } = require('./db/seed');
const { purgeExpired } = require('./auth/sessions');
const { createApp } = require('./app');

async function main() {
  if (config.autoMigrate) {
    const applied = await migrate();
    if (applied.length) console.log(`Migrations aplicadas: ${applied.join(', ')}`);
  }
  await seedDefaultTemplate();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Pulso Gestão no ar em ${config.appBaseUrl} (porta ${config.port})`);
    if (!config.mailConfigured) console.warn('AVISO: SMTP da Brevo não configurado — e-mails não serão enviados.');
    if (!config.yourlsConfigured) console.warn('AVISO: YOURLS não configurado — links curtos desativados.');
  });

  const timer = setInterval(() => purgeExpired().catch((e) => console.error('purge falhou:', e.message)), 6 * 3600_000);
  timer.unref();

  const shutdown = (signal) => {
    console.log(`${signal} recebido, encerrando...`);
    server.close(() => db.close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Falha ao iniciar:', err.message);
  process.exit(1);
});
