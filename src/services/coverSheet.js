// Ficha de peças do episódio (Guia de peças, seção 08): a única fonte de texto das capas. A IA preenche a partir da transcrição;
// o servidor confere cada limite, procura a frase literal na transcrição (e guarda o tempo) e confere se o número foi dito.
// Formato guardado em episode_metadata.cover_sheet:
//   { guest, tag, axis, creds: [], angles: { curiosidade|contraste|autoridade: { model, pre, hl, post, setup, punch, num, line } },
//     quote: { text, at_ms, found }, spotify_hook, by: 'ia' | 'equipe', updated_at }
const db = require('../db/pool');
const config = require('../config');
const gemini = require('./gemini');
const L = require('./platformLimits');
const M = require('../public/design/models');

const ANGLE_KEYS = Object.keys(M.ANGLES);
const DEFAULT_MODEL = { curiosidade: 'YT-B', contraste: 'YT-E', autoridade: 'YT-A+' };
const ANGLE_FIELDS = ['pre', 'hl', 'post', 'setup', 'punch', 'num', 'line'];

// Sem emoji, sem "!" e sem espaços sobrando (as regras de copy do guia).
const clean = (s) => M.tidy(String(s ?? '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/!+/g, '').replace(/^["“”']+|["“”']+$/g, ''));
const norm = (s) => String(s || '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const NUMBER_WORDS = ['zero', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove', 'vinte'];

const SYSTEM = `Você prepara a ficha de peças do Pulso Podcast (capas e thumbnails de um episódio).
O público-alvo das capas é FRIO: não conhece o Pulso nem o convidado.
Leia a transcrição e devolva SOMENTE o JSON pedido.

Campos:
- guest: nome como o convidado se apresenta (com Dr./Dra. se houver).
- tag: credencial ou tema que explica o convidado a um desconhecido, até 6 palavras (ex.: "o único médico das Forças Especiais").
- creds: até 3 etiquetas de 1 ou 2 palavras com as credenciais dele (ex.: "Médico", "Comandos"). Vazio se não houver.
- axis: uma de Histórias, Negócios, Inovação, IA.
- angles: 3 objetos, um para cada ângulo (curiosidade, contraste, autoridade). Cada um traz DUAS redações do mesmo ângulo:
  - pre, hl, post: frase com uma palavra de destaque. pre até 4 palavras, hl exatamente 1 palavra, post até 3 palavras; pre + hl + post no máximo 6 palavras. Lidas em sequência formam uma frase só.
  - setup, punch: frase de até 4 palavras + 1 palavra final de até 9 letras (pode levar "?" ou "."). Lidas em sequência formam uma frase só.
  - só no ângulo autoridade, e só se um número marcante foi DITO no episódio: num (o número, até 3 caracteres) e line (até 6 palavras que completam o número). Senão, deixe os dois vazios.
  - curiosidade: pergunta direta ao espectador ou lacuna. contraste: o convidado quebra uma crença comum. autoridade: credencial rara, número marcante ou resultado.
- quote: frase LITERAL do convidado, até 8 palavras, copiada da transcrição sem mudar nenhuma palavra, com o tempo [mm:ss] em que foi dita.
- spotify_hook: até 7 palavras, benefício para o ouvinte, diferente do título e das capas.

Regras de copy:
- O nome do convidado nunca é o gancho. Use tema, credencial ou resultado.
- Fale com o espectador ("você", "sua clínica") sempre que possível.
- Concreto: objeto, consequência ou número do episódio. Nada genérico que sirva para qualquer convidado ("a história que poucos conhecem").
- Abra uma pergunta e não responda na capa.
- Nada que dependa de conhecer o convidado (apelidos, bordões, siglas).
- Nunca invente números ou frases. Use só o que está na transcrição.
- Se não couber no limite, reescreva; não abrevie.
- Português do Brasil, sem emoji, sem ponto de exclamação.`;

const str = { type: 'STRING' };
const SCHEMA = {
  type: 'OBJECT', required: ['guest', 'tag', 'axis', 'angles', 'quote', 'spotify_hook'],
  properties: {
    guest: str, tag: str, axis: { type: 'STRING', enum: M.AXES }, creds: { type: 'ARRAY', items: str },
    angles: {
      type: 'ARRAY',
      items: { type: 'OBJECT', required: ['angle', 'pre', 'hl', 'post', 'setup', 'punch'], properties: { angle: { type: 'STRING', enum: ANGLE_KEYS }, pre: str, hl: str, post: str, setup: str, punch: str, num: str, line: str } },
    },
    quote: { type: 'OBJECT', required: ['text'], properties: { text: str, at: str } },
    spotify_hook: str,
  },
};

// Acha a frase na transcrição (sem acento, caixa e pontuação) e devolve o começo do trecho em que ela está, ou null.
function findQuote(text, segments) {
  const q = norm(text);
  if (!q || !(segments || []).length) return null;
  let acc = ''; const starts = []; // posição no texto corrido -> segmento
  for (const s of segments) { starts.push({ at: acc.length, ms: s.start_ms }); acc += `${norm(s.text)} `; }
  const i = acc.indexOf(q);
  if (i < 0) return null;
  let ms = starts[0].ms;
  for (const s of starts) { if (s.at <= i) ms = s.ms; else break; }
  return ms;
}
// O número foi dito? Vale o algarismo ou a palavra (até vinte).
function numberSaid(num, text) {
  const d = String(num || '').replace(/\D/g, '');
  if (!d) return false;
  const t = ` ${norm(text)} `;
  if (t.includes(` ${d} `)) return true;
  const n = Number(d);
  return n <= 20 && t.includes(` ${NUMBER_WORDS[n]} `);
}

// Sem IA (ou enquanto ela não responde): parte um texto curto em pre / destaque / post, com a palavra mais longa no destaque.
function splitText(text) {
  const w = M.wordsOf(clean(text));
  if (!w.length) return { pre: '', hl: '', post: '' };
  let k = 0;
  w.forEach((x, i) => { if (i > 0 && x.replace(/[^\p{L}]/gu, '').length > w[k].replace(/[^\p{L}]/gu, '').length) k = i; });
  if (w.length > 1 && k === 0) k = w.length - 1;
  return { pre: w.slice(0, k).join(' '), hl: w[k], post: w.slice(k + 1).join(' ') };
}

// Limpa e confere o que veio (da IA ou da equipe). transcript: { text, segments } ou null.
function normalize(raw, { transcript = null, guestName = '' } = {}) {
  const sheet = {
    guest: clean(raw.guest) || clean(guestName), tag: clean(raw.tag), axis: M.AXES.includes(raw.axis) ? raw.axis : 'Histórias',
    creds: (Array.isArray(raw.creds) ? raw.creds : []).map(clean).filter((c) => c && M.countWords(c) <= 2).slice(0, 3),
    angles: {}, quote: { text: '', at_ms: null, found: false }, spotify_hook: clean(raw.spotify_hook),
  };
  const list = Array.isArray(raw.angles) ? raw.angles : ANGLE_KEYS.map((k) => ({ angle: k, ...(raw.angles?.[k] || {}) }));
  for (const key of ANGLE_KEYS) {
    const a = list.find((x) => x && x.angle === key) || {};
    const out = Object.fromEntries(ANGLE_FIELDS.map((f) => [f, clean(a[f])]));
    out.num = out.num.slice(0, 3);
    if (out.num && transcript && !numberSaid(out.num, transcript.text)) { out.num = ''; out.line = ''; } // número que ninguém disse não entra
    if (key !== 'autoridade') { out.num = ''; out.line = ''; }
    out.model = M.MODELS[a.model] && M.MODELS[a.model].kind === 'youtube_thumb' && M.MODELS[a.model].angles.includes(key) ? a.model : null;
    sheet.angles[key] = out;
  }
  const qt = clean(raw.quote?.text ?? raw.quote);
  if (qt) {
    const at = transcript ? findQuote(qt, transcript.segments) : null;
    sheet.quote = { text: qt, at_ms: at ?? (Number.isFinite(raw.quote?.at_ms) ? raw.quote.at_ms : null), found: transcript ? at !== null : Boolean(raw.quote?.found) };
  }
  for (const key of ANGLE_KEYS) sheet.angles[key].model = pickModel(sheet, key, sheet.angles[key].model);
  return sheet;
}

// Os campos que o modelo recebe: a base da ficha + os do ângulo.
function dataFor(sheet, episode, angle = null) {
  const a = angle ? (sheet.angles?.[angle] || {}) : {};
  return {
    guest: sheet.guest, tag: sheet.tag, axis: sheet.axis, creds: sheet.creds || [], ep: episode?.number || '',
    pre: a.pre || '', hl: a.hl || '', post: a.post || '', setup: a.setup || '', punch: a.punch || '', num: a.num || '', line: a.line || '',
    quote: sheet.quote?.text || '', hook: sheet.spotify_hook || '',
  };
}
// O modelo do ângulo: o escolhido se ele sai com a ficha; senão o primeiro do ângulo que sai (o Lime total nunca entra sozinho).
function pickModel(sheet, angle, wanted = null) {
  const data = dataFor(sheet, null, angle);
  const ok = (id) => M.problems(id, data).length === 0 && (id !== 'YT-F' || sheet.quote?.found !== false);
  if (wanted && ok(wanted)) return wanted;
  const order = [DEFAULT_MODEL[angle], ...M.modelsFor('youtube_thumb', angle)].filter((id, i, arr) => arr.indexOf(id) === i && !M.MODELS[id].special);
  if (angle === 'autoridade' && data.num) order.unshift('YT-D');
  return order.find(ok) || wanted || DEFAULT_MODEL[angle];
}

async function context(episodeId) {
  const { rows: [episode] } = await db.query('SELECT e.*, g.name AS guest_name, g.positioning, g.job_title FROM episodes e LEFT JOIN guests g ON g.id = e.guest_id WHERE e.id = $1', [episodeId]);
  const { rows: [meta] } = await db.query('SELECT * FROM episode_metadata WHERE episode_id = $1', [episodeId]);
  const { rows: [tr] } = await db.query('SELECT text, segments, duration_ms FROM episode_transcripts WHERE episode_id = $1', [episodeId]);
  return { episode, meta: meta || null, transcript: tr || null };
}
const get = async (episodeId) => (await db.query('SELECT cover_sheet FROM episode_metadata WHERE episode_id = $1', [episodeId])).rows[0]?.cover_sheet || null;
async function save(episodeId, sheet, by = 'equipe') {
  const value = { ...sheet, by, updated_at: new Date().toISOString() };
  await db.query('INSERT INTO episode_metadata (episode_id, cover_sheet) VALUES ($1, $2) ON CONFLICT (episode_id) DO UPDATE SET cover_sheet = $2, updated_at = now()', [episodeId, JSON.stringify(value)]);
  return value;
}

// Ficha feita com o que o sistema já tem (sem IA): o texto de thumbnail sugerido vira os três ângulos; a citação vira a frase.
function fromSuggestions({ episode, meta }) {
  const sug = meta?.suggestions || {};
  const texts = (sug.thumbnail_texts || []).map((t) => t.texto).filter(Boolean);
  const base = texts[0] || meta?.thumb_text || L.fitWords(episode.title || '', 40);
  const q = (sug.quotes || []).find((x) => x.frase && M.countWords(x.frase) <= 8);
  return {
    guest: episode.guest_name || '', tag: L.fitWords(episode.positioning || episode.job_title || '', 60), axis: 'Histórias', creds: [],
    angles: ANGLE_KEYS.map((k, i) => ({ angle: k, ...splitText(texts[i] || base) })),
    quote: q ? { text: q.frase, at_ms: q.at_ms ?? null, found: true } : { text: '' },
    spotify_hook: L.fitWords(meta?.sp_title || episode.title || '', 48),
  };
}

// Preenche a ficha com a IA (ou, sem IA ou sem transcrição, com as sugestões que já existem). Guarda e devolve.
async function generate(episodeId) {
  const ctx = await context(episodeId);
  if (!ctx.episode) throw new Error('Episódio não encontrado.');
  let raw = null;
  if (config.geminiConfigured && ctx.transcript?.segments?.length) {
    const brief = [
      `Episódio ${ctx.episode.number ? String(ctx.episode.number).padStart(3, '0') : ''}: ${ctx.episode.title || ''}`,
      ctx.episode.guest_name ? `Convidado no cadastro: ${ctx.episode.guest_name}${ctx.episode.job_title ? ` (${ctx.episode.job_title})` : ''}${ctx.episode.positioning ? `. ${ctx.episode.positioning}` : ''}` : '',
      ctx.meta?.yt_title ? `Título do YouTube (a capa não repete o título): ${ctx.meta.yt_title}` : '',
      '', 'Transcrição com os tempos reais:', ctx.transcript.segments.map((s) => `[${L.toClock(s.start_ms)}] ${s.text}`).join('\n'),
    ].filter((x) => x !== null).join('\n');
    const { data } = await gemini.generateJson({ feature: 'capas_ficha', system: SYSTEM, parts: [{ text: brief }], schema: SCHEMA, temperature: 0.6, timeoutMs: 150_000, attempts: 3 });
    raw = data;
  }
  const by = raw ? 'ia' : 'sugestoes';
  const sheet = normalize(raw || fromSuggestions(ctx), { transcript: ctx.transcript, guestName: ctx.episode.guest_name });
  return save(episodeId, sheet, by);
}

// A equipe mudou campos: a base (guest, tag, axis), um ângulo (campos e modelo) ou a frase e a chamada. Devolve a ficha nova.
async function update(episodeId, patch) {
  const ctx = await context(episodeId);
  const cur = ctx.meta?.cover_sheet || normalize(fromSuggestions(ctx), { transcript: ctx.transcript, guestName: ctx.episode?.guest_name });
  const next = { ...cur, angles: { ...cur.angles } };
  for (const k of ['guest', 'tag']) if (patch[k] !== undefined) next[k] = clean(patch[k]);
  if (patch.axis !== undefined && M.AXES.includes(patch.axis)) next.axis = patch.axis;
  if (patch.spotify_hook !== undefined) next.spotify_hook = clean(patch.spotify_hook);
  if (patch.quote !== undefined) {
    const qt = clean(patch.quote);
    const at = qt && ctx.transcript ? findQuote(qt, ctx.transcript.segments) : null;
    next.quote = { text: qt, at_ms: at, found: qt ? (ctx.transcript ? at !== null : true) : false };
  }
  if (patch.angle && ANGLE_KEYS.includes(patch.angle)) {
    const a = { ...(cur.angles?.[patch.angle] || {}) };
    for (const f of ANGLE_FIELDS) if (patch[f] !== undefined) a[f] = clean(patch[f]);
    if (patch.model && M.MODELS[patch.model]?.kind === 'youtube_thumb') a.model = patch.model;
    next.angles[patch.angle] = a;
  }
  return save(episodeId, next, 'equipe');
}

module.exports = { ANGLE_KEYS, DEFAULT_MODEL, SYSTEM, SCHEMA, clean, findQuote, numberSaid, splitText, normalize, dataFor, pickModel, context, get, save, generate, update, fromSuggestions };
