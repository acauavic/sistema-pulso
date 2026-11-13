// Ajustes gerais do sistema (Gestão): chave/valor em `app_settings`.
const db = require('../db/pool');
const { memo, forget } = require('../utils/requestCache');

const DEFAULTS = {
  block_insertion_in_exclusive: 'true',
  plateia_active: 'true', plateia_price_cents: '19700', plateia_duration: '1h30 a 2h', plateia_location: 'Estúdio do Pulso Podcast, Alphaville, SP',
  lembrete_endereco: '', lembrete_hora: '09:00',
  lembrete_msg_d3: 'Oi, {primeiro_nome}, tudo bem? Passando para lembrar da nossa conversa no Pulso Podcast: {dia}, {data}, às {hora}. Qualquer dúvida, é só chamar por aqui.',
  lembrete_msg_d1: 'Oi, {primeiro_nome}! Está tudo certo para amanhã: gravação do Pulso Podcast às {hora}. Do nosso lado, estúdio e equipe prontos para te receber. Até amanhã.',
  lembrete_msg_dia: 'Bom dia, {primeiro_nome}! Hoje é dia de Pulso. Te esperamos às {hora}.\n\nEndereço: {endereco}\n\nQualquer coisa no caminho, é só chamar por aqui.',
  lembrete_msg_h3: 'Oi, {primeiro_nome}! Daqui a pouco, às {hora}, começamos a gravação. Está tudo certo por aí? Precisa de alguma coisa?',
  plateia_whatsapp: '', plateia_meta_pixel: '', plateia_ga4: '', plateia_hero_key: '', plateia_studio_key: '',
};

// Na mesma requisição, a mesma chave vai ao banco uma vez (uma página chegava a ler 18 ajustes um por um).
const get = (key) => memo(`ajuste:${key}`, async () => {
  const { rows: [r] } = await db.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return r ? r.value : DEFAULTS[key];
});
async function set(key, value) {
  forget('ajuste:');
  const out = await db.query(
    'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [key, String(value)]);
  forget('ajuste:');
  return out;
}

// Episódio que é entrega de um patrocinador (exclusivo) não recebe inserção de outro — se a gestão deixar ligado.
const blockInsertion = async () => (await get('block_insertion_in_exclusive')) === 'true';

// Confere o conjunto final de patrocinadores de um episódio/gravação: [{ sponsor, role }]. Devolve a mensagem de erro ou null.
function conflict(list, names = {}) {
  const exclusive = list.find((x) => x.role === 'exclusivo');
  const other = list.find((x) => x.role === 'insercao' && (!exclusive || x.sponsor !== exclusive.sponsor));
  if (!exclusive || !other) return null;
  return `Este episódio é entrega de ${names[exclusive.sponsor] || 'um patrocinador'} (exclusivo) e não recebe inserção de ${names[other.sponsor] || 'outro patrocinador'}.`;
}

async function getMany(keys) {
  const { rows } = await db.query('SELECT key, value FROM app_settings WHERE key = ANY($1)', [keys]);
  const found = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(keys.map((k) => [k, found[k] ?? DEFAULTS[k] ?? '']));
}

module.exports = { get, getMany, set, blockInsertion, conflict };
