require('dotenv').config();

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const port = Number(env.PORT) || 3100;

// YOURLS_LINK pode vir só com o host ("link.exemplo.com") ou com esquema.
function normalizeBase(value) {
  if (!value) return '';
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, '').replace(/\/yourls-api\.php$/i, '');
}

const config = {
  isProd,
  port,
  databaseUrl: env.PODCAST_DATABASE_URL || env.DATABASE_URL,
  appBaseUrl: (env.APP_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  // Onde ficam os convites públicos (/convite/:token). Padrão = mesmo host do painel;
  // pode ser outro domínio (ex.: https://kit.podcastpulso.com) apontando pro mesmo serviço.
  publicBaseUrl: (env.PUBLIC_BASE_URL || env.APP_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  sessionSecret: env.SESSION_SECRET,
  sessionDays: 7,
  autoMigrate: env.AUTO_MIGRATE !== 'false',
  mailDryRun: env.MAIL_DRY_RUN === 'true', // dev/teste: registra o e-mail em vez de enviar
  podcastName: env.PODCAST_NAME || 'Podcast Pulso',

  brevo: {
    host: env.BREVO_SERVER || 'smtp-relay.brevo.com',
    port: Number(env.BREVO_PORT) || 587,
    user: env.BREVO_USER,
    pass: env.BREVO_CHAVE_SMTP,
    from: env.BREVO_EMAIL,
    fromName: env.BREVO_FROM_NAME || env.PODCAST_NAME || 'Podcast Pulso',
  },

  yourls: {
    base: normalizeBase(env.YOURLS_LINK),
    key: env.YOURLS_KEY,
  },
};

config.mailConfigured = config.mailDryRun || Boolean(config.brevo.user && config.brevo.pass && config.brevo.from);
config.yourlsConfigured = Boolean(config.yourls.base && config.yourls.key);

function assertConfig() {
  const missing = [];
  if (!config.databaseUrl) missing.push('PODCAST_DATABASE_URL (ou DATABASE_URL)');
  if (isProd && !config.sessionSecret) missing.push('SESSION_SECRET');
  if (isProd && !env.APP_BASE_URL) missing.push('APP_BASE_URL');
  if (missing.length) {
    throw new Error(`Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}`);
  }
  if (!config.sessionSecret) {
    // dev: segredo efêmero (sessões continuam válidas, só o CSRF muda ao reiniciar)
    config.sessionSecret = require('crypto').randomBytes(32).toString('hex');
  }
}

module.exports = config;
module.exports.assertConfig = assertConfig;
