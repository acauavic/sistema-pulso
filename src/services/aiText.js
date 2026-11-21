// IA para os textos de publicação e de capa: gera 3 opções novas para um campo (texto da capa, título, legenda, título e
// descrição do YouTube) a partir de um atalho ("mais curto", "em pergunta"…) ou de um pedido livre, com o contexto do
// episódio/corte (convidado, transcrição) e o tom de voz da marca. Não grava nada: quem escolhe a opção é a pessoa.
const db = require('../db/pool');
const config = require('../config');
const gemini = require('./gemini');
const fin = require('./finalization');
const L = require('./platformLimits');
const SC = require('./socialCopy');

// Cada campo: o que é, as regras e o tamanho máximo (a IA é instruída e o resultado é cortado se passar).
const FIELDS = {
  capa: { label: 'texto da capa', max: L.LIMITS.thumbnailText.maxChars, rule: `texto curto para pôr em cima da imagem: de 2 a 5 palavras, até ${L.LIMITS.thumbnailText.maxChars} caracteres, sem ponto final. ${SC.COPY.capa}` },
  capa_frase: { label: 'frase do post', max: 200, rule: 'frase de impacto dita pelo convidado, de 8 a 30 palavras, até 200 caracteres; prefira um trecho literal da fala; sem aspas' },
  capa_slide: { label: 'texto do slide do carrossel', max: 140, rule: 'texto de um slide de carrossel: 1 ou 2 frases curtas, até 140 caracteres' },
  titulo: { label: 'título do post', max: 60, rule: `título do post do corte: de 4 a 9 palavras, até 60 caracteres, sem ponto final. ${SC.COPY.titulo}` },
  descricao: { label: 'legenda do post', max: 600, rule: `legenda para Reels, TikTok e Shorts: de 2 a 4 frases curtas (até 320 caracteres); sem hashtags (a não ser que o pedido peça). ${SC.COPY.legenda}` },
  titulo_youtube: { label: 'título do YouTube', max: 100, rule: 'título do episódio no YouTube: até 70 caracteres de preferência (no máximo 100), com o nome do convidado ou o tema central, sem caixa alta gritada, sem clickbait' },
  convite_motivo: { label: 'texto "Por que você" do convite', max: 600, rule: 'duas ou três frases curtas (até 350 caracteres) falando diretamente com a pessoa convidada ("você"), dizendo por que o Pulso quer conversar com ela: o que ela construiu, o que ela pensa ou faz de diferente e por que isso interessa ao profissional da saúde ou ao público que quer viver com mais saúde. Concreto, caloroso, sem bajulação, sem superlativo vazio, sem exclamações. Use só os dados fornecidos; se faltar dado, fique no que existe' },
  resposta: { label: 'resposta a um comentário do post', max: 300, rule: 'resposta curta (até 220 caracteres) ao comentário, falando com a pessoa, concreta sobre o assunto do post; se for opinião polêmica ou generalização, discorde com um toque leve de acidez, sem ofender; termine, sempre que der, com uma pergunta que faça a pessoa comentar de novo; sem conselho médico individual, sem hashtags, sem "link da bio" (a não ser que a pessoa pergunte onde assistir)' },
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
  acido: { label: 'Com acidez', ask: 'Discorde com um toque leve de acidez e elegância, sem ofender a pessoa, e termine com uma pergunta.', only: ['resposta'] },
};
// Atalhos que não fazem sentido em alguns campos (resposta a comentário não cita a transcrição nem traz número).
const EXCEPT = { resposta: ['citacao', 'numero', 'impacto', 'hashtags'] };
const shortcutsFor = (field) => Object.entries(SHORTCUTS).filter(([k, s]) => (!s.only || s.only.includes(field)) && !(EXCEPT[field] || []).includes(k)).map(([key, s]) => ({ key, label: s.label }));

const SCHEMA = { type: 'OBJECT', properties: { opcoes: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['opcoes'] };

async function context({ episodeId = null, clipId = null, guestId = null }) {
  let clip = null; let episode = null; let guest = null; let transcript = '';
  if (guestId) ({ rows: [guest] } = await db.query('SELECT * FROM guests WHERE id = $1', [guestId]));
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
// Dados do convidado para o texto do convite (nunca vai o contato).
function guestBrief(g) {
  return ['Convidado (ainda não gravou):', `Nome: ${g.name}`, g.job_title && `Cargo: ${g.job_title}`, g.company && `Empresa: ${g.company}`, g.positioning && `Posicionamento: ${g.positioning}`,
    g.topic && `Temas: ${g.topic}`, g.bio && `Biografia: ${String(g.bio).slice(0, 1500)}`, g.invite_reason && `Motivo interno do convite (anotação da equipe): ${g.invite_reason}`,
    g.instagram && `Instagram: @${String(g.instagram).replace(/^@/, '')}`, `Formato da gravação: ${g.invite_format === 'plateia' ? 'com plateia' : 'de mesa (sem plateia)'}`,
    g.is_plural ? 'É uma dupla: fale com "vocês".' : ''].filter(Boolean).join('\n');
}

async function suggest({ field, coverKind = null, current = '', shortcut = null, prompt = '', episodeId = null, clipId = null, guestId = null, commentId = null }) {
  if (!config.geminiConfigured) return { error: 'A IA não está configurada neste servidor.', status: 503 };
  const key = field === 'capa' && COVER_FIELD[coverKind] ? COVER_FIELD[coverKind] : field;
  if (!FIELDS[key]) return { error: 'Campo desconhecido.', status: 400 };
  const ask = shortcut && SHORTCUTS[shortcut] ? SHORTCUTS[shortcut].ask : (key === 'convite_motivo' ? 'Escreva o texto a partir dos dados do convidado.' : '');
  const own = String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!ask && !own) return { error: 'Escolha um atalho ou escreva o que quer.', status: 400 };
  let comment = null; // resposta a um comentário: o comentário, a conversa e o post entram no contexto
  if (key === 'resposta') {
    if (commentId) ({ rows: [comment] } = await db.query('SELECT c.*, p.clip_id, p.episode_id FROM social_comments c LEFT JOIN episode_publications p ON p.id = c.publication_id WHERE c.id = $1', [commentId]));
    if (!comment) return { error: 'Comentário não encontrado.', status: 404 };
    clipId = comment.clip_id || clipId; episodeId = comment.episode_id || episodeId;
  }
  const ctx = await context({ episodeId, clipId, guestId: key === 'convite_motivo' ? guestId : null });
  if (key === 'convite_motivo' && !ctx.guest) return { error: 'Convidado não encontrado.', status: 404 };
  const now = String(current || '').trim().slice(0, 1500);
  const parts = [{ text: [
    fin.MARCA, '',
    key === 'convite_motivo' ? `Missão do Pulso: ajudar o profissional da saúde a ser um profissional melhor e levar ao público mais saúde e qualidade de vida. Eixos: saúde e inovação, mentalidade, estilo de vida e histórias inspiradoras.\n${guestBrief(ctx.guest)}`
      : ctx.episode ? fin.buildContext({ episode: ctx.episode, guest: ctx.guest, sponsors: [] }) : 'Podcast: Pulso (corte ainda sem episódio definido).',
    ctx.clip ? `Corte: ${ctx.clip.post_title || ctx.clip.title}` : '',
    ['capa', 'titulo', 'descricao'].includes(key) ? await require('./postMetrics').examples() : '',
    comment ? `Comentário de @${comment.author_username || 'alguém'} no post: ${comment.text}${(comment.thread || []).length ? `\nConversa em volta: ${comment.thread.map((t) => `@${t.usuario || 'alguém'}${t.pulso ? ' (Pulso)' : ''}: ${t.texto}`).join(' | ')}` : ''}` : '',
    '', `Campo: ${FIELDS[key].label}. Regras: ${FIELDS[key].rule}.`,
    now ? `Texto atual: ${now}` : 'O campo está vazio.',
    '', `Pedido: ${[ask, own].filter(Boolean).join(' ')}`,
    'Devolva EXATAMENTE 3 opções em "opcoes", cada uma pronta para colar no campo, diferentes entre si e do texto atual. Não explique nada.',
    ctx.transcript && key !== 'resposta' ? `\nTranscrição (trecho): ${L.fitWords(ctx.transcript, ctx.clip ? 3000 : 5000)}` : '',
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

module.exports = { FIELDS, COVER_FIELD, SHORTCUTS, EXCEPT, shortcutsFor, suggest, tidyOption };
