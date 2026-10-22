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
  // Miniaturas da galeria do material: ficam no disco do servidor (volume no Docker), não no Backblaze.
  previewDir: env.PREVIEW_DIR || require('path').join(__dirname, '..', 'data', 'previews'),
  mailDryRun: env.MAIL_DRY_RUN === 'true', // dev/teste: registra o e-mail em vez de enviar
  podcastName: env.PODCAST_NAME || 'Podcast Pulso',
  // WhatsApp da produção (só dígitos, com DDI): destino dos botões do convite.
  // WhatsApp comercial (media kit): destino dos botões "Quero ser patrocinador" e "Falar com a equipe".
  whatsappPatrocinio: String(env.PATROCINIO_WHATSAPP || '5511971739061').replace(/\D/g, ''),
  whatsappProducao: String(env.PRODUCAO_WHATSAPP || '5512991053852').replace(/\D/g, ''),

  brevo: {
    host: env.BREVO_SERVER || 'smtp-relay.brevo.com',
    port: Number(env.BREVO_PORT) || 587,
    user: env.BREVO_USER,
    pass: env.BREVO_CHAVE_SMTP,
    from: env.BREVO_EMAIL,
    fromName: env.BREVO_FROM_NAME || env.PODCAST_NAME || 'Podcast Pulso',
  },

  // Backblaze B2 (API S3). O endereço S3 é descoberto com a própria chave; BB_ENDPOINT força um endereço.
  b2: {
    keyId: env.BB_KEY_ID,
    appKey: env.BB_APPLICATION_KEY,
    bucket: env.BUCKET_NAME,
    endpoint: (env.BB_ENDPOINT || '').replace(/\/+$/, ''),
    prefix: env.BB_PREFIX || '', // prefixo dos nomes; vazio = o da própria chave
  },
  // Tamanho das partes do envio de arquivos grandes (padrão 16 MB; o Backblaze exige no mínimo 5 MB). Mudar só em teste.
  uploadPartBytes: Number(env.UPLOAD_PART_BYTES) || 16 * 1024 * 1024,
  // Gemini: sugestões de títulos, descrições e leitura de quadros.
  gemini: { key: env.GEMINI_KEY || env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-3.8-flash' },
  // Groq: transcrição de voz (Whisper large-v3).
  groq: { key: env.GROQ_APIKEY, model: env.GROQ_WHISPER_MODEL || 'whisper-large-v3' },

  // Confere se o vídeo editado do episódio é horizontal (ffprobe). Desligar só em teste.
  checkVideoFormat: String(env.VIDEO_FORMAT_CHECK ?? 'true').toLowerCase() !== 'false',
  // Upload-Post: publica nas redes. SEM UPLOAD_POST_LIVE=true nada é enviado (o painel monta e valida o pedido e marca como "simulado").
  uploadPost: { key: env.UPLOAD_POST_KEY, user: env.UPLOAD_POST_USER || 'default', live: String(env.UPLOAD_POST_LIVE).toLowerCase() === 'true', base: 'https://api.upload-post.com' },

  // Web Push (alertas com o painel fechado). Gere o par com `npx web-push generate-vapid-keys`.
  push: {
    publicKey: env.VAPID_PUBLIC_KEY || '',
    privateKey: env.VAPID_PRIVATE_KEY || '',
    subject: env.VAPID_SUBJECT || 'mailto:contato@podcastpulso.com',
  },

  // Google Agenda: as gravações agendadas vão para o calendário do Pulso Podcast. Conta de serviço (JSON em uma linha ou em base64)
  // com acesso de edição ao calendário. Sem as duas variáveis, a integração fica desligada.
  google: {
    calendarId: env.GOOGLE_CALENDAR_ID || '',
    serviceAccount: env.GOOGLE_SERVICE_ACCOUNT_B64 || env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
    eventMinutes: Math.max(15, Number(env.GOOGLE_EVENT_MINUTES) || 120),
  },

  // InfinitePay (checkout): links de pagamento da plateia. Handle = InfiniteTag (sem o $). O endereço do webhook leva um segredo
  // derivado do SESSION_SECRET (ou INFINITEPAY_WEBHOOK_SECRET). Sem o handle, a integração fica desligada.
  infinitepay: { handle: String(env.INFINITEPAY_HANDLE || '').replace(/^\$/, '').trim(), webhookSecret: env.INFINITEPAY_WEBHOOK_SECRET || '' },

  yourls: {
    base: normalizeBase(env.YOURLS_LINK),
    key: env.YOURLS_KEY,
  },
};

config.mailConfigured = config.mailDryRun || Boolean(config.brevo.user && config.brevo.pass && config.brevo.from);
config.storageConfigured = Boolean(config.b2.keyId && config.b2.appKey && config.b2.bucket);
config.geminiConfigured = Boolean(config.gemini.key);
config.groqConfigured = Boolean(config.groq.key);
config.uploadPostConfigured = Boolean(config.uploadPost.key);
config.googleConfigured = Boolean(config.google.calendarId && config.google.serviceAccount);
config.infinitepayConfigured = Boolean(config.infinitepay.handle);
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
