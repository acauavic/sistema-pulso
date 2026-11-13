// IA para os textos de publicação e de capa: gera 3 opções novas para um campo (texto da capa, título, legenda, título e
// descrição do YouTube) a partir de um atalho ("mais curto", "em pergunta"…) ou de um pedido livre, com o contexto do
// episódio/corte (convidado, transcrição) e o tom de voz da marca. Não grava nada: quem escolhe a opção é a pessoa.
const db = require('../db/pool');
const config = require('../config');
const gemini = require('./gemini');
const fin = require('./finalization');
const L = require('./platformLimits');

// Cada campo: o que é, as regras e o tamanho máximo (a IA é instruída e o resultado é cortado se passar).
const FIELDS = {
  capa: { label: 'texto da capa', max: L.LIMITS.thumbnailText.maxChars, rule: `texto curto para pôr em cima da imagem: de 2 a 5 palavras, até ${L.LIMITS.thumbnailText.maxChars} caracteres, sem ponto final; o gancho que faz parar de rolar` },
  capa_frase: { label: 'frase do post', max: 200, rule: 'frase de impacto dita pelo convidado, de 8 a 30 palavras, até 200 caracteres; prefira um trecho literal da fala; sem aspas' },
  capa_slide: { label: 'texto do slide do carrossel', max: 140, rule: 'texto de um slide de carrossel: 1 ou 2 frases curtas, até 140 caracteres' },
  titulo: { label: 'título do post', max: 60, rule: 'título do post do corte: de 4 a 9 palavras, até 60 caracteres, abre com o gancho, sem ponto final, sem clickbait' },
  descricao: { label: 'legenda do post', max: 600, rule: 'legenda para Instagram/TikTok: 1 a 3 frases curtas (até 300 caracteres) que contextualizam e convidam a ver; sem "link na bio"; sem hashtags (a não ser que o pedido peça)' },
  titulo_youtube: { label: 'título do YouTube', max: 100, rule: 'título do episódio no YouTube: até 70 caracteres de preferência (no máximo 100), com o nome do convidado ou o tema central, sem caixa alta gritada, sem clickbait' },
  descricao_youtube: { label: 'descrição do YouTube', max: 3000, rule: 'descrição do episódio no YouTube: um parágrafo de abertura (2 a 3 frases) sobre a conversa, depois quem é o convidado em uma frase; sem links inventados' },
};
// Tipo de capa -> qual regra de texto usar.
const COVER_FIELD = { youtube_thumb: 'capa', reel_cover: 'capa', post_quote: 'capa_frase', post_split: 'capa_frase', carousel: 'capa_slide' };

// Atalhos que aparecem como botões (o rótulo fica na tela; a instrução vai para a IA).
const SHORTCUTS = {
  variar: { label: 'Outras opções', ask: 'Traga 3 opções novas, de ângulos bem diferentes entre si e do texto atual.' },
  curto: { label: 'Mais curto', ask: 'Deixe mais curto e direto, mantendo a ideia.' },
  impacto: { label: 'Mais impacto', ask: 'Mais impacto: gancho forte, palavras concretas. Sem exagero, sem clickbait, sem exclamações.' },
  pergunta: { label: 'Em pergunta', ask: 'Escreva em forma de pergunta que desperte curiosidade (e que a conversa responde).' },
  citacao: { label: 'Frase do convidado', ask: 'Use uma frase que o convidado realmente diz na transcrição (trecho literal ou quase).' },
  numero: { label: 'Com número', ask: 'Inclua um número ou dado concreto que aparece na conversa, se houver.' },
  serio: { label: 'Mais sério', ask: 'Tom mais sério e institucional.' },
  leve: { label: 'Mais leve', ask: 'Tom mais leve e próximo, sem gíria.' },
  hashtags: { label: 'Com hashtags', ask: 'Termine com 3 a 5 hashtags relevantes do tema (em minúsculas, sem acento).', only: ['descricao'] },
};
const shortcutsFor = (field) => Object.entries(SHORTCUTS).filter(([, s]) => !s.only || s.only.includes(field)).map(([key, s]) => ({ key, label: s.label }));

const SCHEMA = { type: 'OBJECT', properties: { opcoes: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['opcoes'] };

async function context({ episodeId = null, clipId = null }) {
  let clip = null; let episode = null; let guest = null; let transcript = '';
  if (clipId) {
    ({ rows: [clip] } = await db.query('SELECT id, title, post_title, caption, transcript, episode_id FROM episode_clips WHERE id = $1', [clipId]));
    if (clip?.episode_id) episodeId = clip.episode_id;
    transcript = clip?.transcript || '';
  }
  if (episodeId) {
    ({ rows: [episode] } = await db.query('SELECT * FROM episodes WHERE id = $1', [episodeId]));
    if (episode?.guest_id) ({ rows: [guest] } = await db.query('SELECT * FROM guests WHERE id = $1', [episode.guest_id]));
    if (!transcript) {
      const { rows: [t] } = await db.query('SELECT text FROM episode_transcripts WHERE episode_id = $1', [episodeId]);
      transcript = t?.text || '';
    }
  }
  return { clip, episode, guest, transcript };
}

// Limpa uma opção: sem emoji, sem exclamações em sequência, sem aspas sobrando, dentro do limite do campo.
function tidyOption(s, field) {
  let t = L.tidy(fin.stripEmoji(String(s || ''))).replace(/!{2,}/g, '!').replace(/\?{2,}/g, '?');
  if (!field.startsWith('descricao')) t = t.replace(/\s*\n+\s*/g, ' ');
  // aspas e pontuação final em qualquer ordem ("Frase!". -> Frase!); título e capa ficam sem ponto final
  const tail = ['capa', 'titulo'].includes(field) ? /["”'.;:,\s]+$/ : /["”'\s]+$/;
  if (/^["“]/.test(t)) t = t.replace(/^["“\s]+/, '').replace(/["”](?=[!?.…]*\s*$)/, ''); // "Frase"! -> Frase!
  t = t.replace(/^['\s]+/, '').replace(tail, '');
  return L.fitWords(t, FIELDS[field].max);
}

// field: chave de FIELDS (ou 'capa' com coverKind para escolher a regra certa). Devolve { opcoes } ou { error, status }.
async function suggest({ field, coverKind = null, current = '', shortcut = null, prompt = '', episodeId = null, clipId = null }) {
  if (!config.geminiConfigured) return { error: 'A IA não está configurada neste servidor.', status: 503 };
  const key = field === 'capa' && COVER_FIELD[coverKind] ? COVER_FIELD[coverKind] : field;
  if (!FIELDS[key]) return { error: 'Campo desconhecido.', status: 400 };
  const ask = shortcut && SHORTCUTS[shortcut] ? SHORTCUTS[shortcut].ask : '';
  const own = String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!ask && !own) return { error: 'Escolha um atalho ou escreva o que quer.', status: 400 };
  const ctx = await context({ episodeId, clipId });
  const now = String(current || '').trim().slice(0, 1500);
  const parts = [{ text: [
    fin.MARCA, '',
    ctx.episode ? fin.buildContext({ episode: ctx.episode, guest: ctx.guest, sponsors: [] }) : 'Podcast: Pulso (corte ainda sem episódio definido).',
    ctx.clip ? `Corte: ${ctx.clip.post_title || ctx.clip.title}` : '',
    '', `Campo: ${FIELDS[key].label}. Regras: ${FIELDS[key].rule}.`,
    now ? `Texto atual: ${now}` : 'O campo está vazio.',
    '', `Pedido: ${[ask, own].filter(Boolean).join(' ')}`,
    'Devolva EXATAMENTE 3 opções em "opcoes", cada uma pronta para colar no campo, diferentes entre si e do texto atual. Não explique nada.',
    ctx.transcript ? `\nTranscrição (trecho): ${L.fitWords(ctx.transcript, ctx.clip ? 3000 : 5000)}` : '',
  ].filter((x) => x !== '').join('\n') }];
  let data;
  try { ({ data } = await gemini.generateJson({ parts, schema: SCHEMA, temperature: shortcut === 'variar' ? 0.95 : 0.8, timeoutMs: 45_000, attempts: 2 })); } catch (err) {
    console.error(`[ia-texto] ${key}:`, err.message);
    return { error: gemini.friendlyError ? gemini.friendlyError(err) : 'A IA não respondeu agora. Tente de novo.', status: 502 };
  }
  const seen = new Set([now.toLowerCase()]);
  const opcoes = [];
  for (const o of data?.opcoes || []) {
    const t = tidyOption(o, key);
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); opcoes.push(t); }
  }
  if (!opcoes.length) return { error: 'A IA não trouxe opções novas. Tente outro atalho.', status: 502 };
  return { opcoes: opcoes.slice(0, 3) };
}

module.exports = { FIELDS, COVER_FIELD, SHORTCUTS, shortcutsFor, suggest, tidyOption };
