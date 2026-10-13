// Ajustes gerais do sistema (Gestão): chave/valor em `app_settings`.
const db = require('../db/pool');

const DEFAULTS = {
  block_insertion_in_exclusive: 'true',
  plateia_active: 'true', plateia_price_cents: '19700', plateia_duration: '1h30 a 2h', plateia_location: 'Estúdio do Pulso Podcast, Alphaville, SP',
  plateia_whatsapp: '', plateia_meta_pixel: '', plateia_ga4: '', plateia_hero_key: '', plateia_studio_key: '',
};

async function get(key) {
  const { rows: [r] } = await db.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return r ? r.value : DEFAULTS[key];
}
const set = (key, value) => db.query(
  'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [key, String(value)]);

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
