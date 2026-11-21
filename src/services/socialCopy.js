// Copy das redes: as regras que a IA segue para capa, título e legenda (o que faz alguém parar de rolar e querer ver) e a chamada
// do fim do texto, que muda com a rede (no YouTube é se inscrever, no Instagram é seguir o perfil...). A chamada não fica na
// legenda: cada rede recebe a sua no envio (options.ctas da publicação), então a mesma legenda serve para todas.
const L = require('./platformLimits');

const NETWORKS = ['instagram', 'tiktok', 'youtube', 'facebook', 'linkedin', 'threads', 'x'];
const LABEL = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook', linkedin: 'LinkedIn', threads: 'Threads', x: 'X' };
const CTA_MAX = 140;

// O que cada rede pede, para a IA escrever a chamada (verbo da rede + um motivo ligado ao tema do corte).
const CTA_RULE = {
  instagram: 'Instagram: peça para SEGUIR o perfil do Pulso (pode somar salvar ou mandar para alguém específico)',
  tiktok: 'TikTok: peça para SEGUIR o Pulso, num tom mais próximo',
  youtube: 'YouTube: peça para SE INSCREVER no canal (e, se couber, ver o episódio completo no canal)',
  facebook: 'Facebook: peça para SEGUIR a página do Pulso (pode somar compartilhar com alguém)',
  linkedin: 'LinkedIn: peça para SEGUIR o Pulso, com um motivo profissional (carreira, gestão, mercado da saúde)',
  threads: 'Threads: peça para SEGUIR o Pulso e responder com a opinião',
  x: 'X: peça para SEGUIR o Pulso, bem curto',
};

// Sem a chamada da IA (corte antigo ou sem fala): uma destas, escolhida pelo número do corte para não repetir sempre a mesma.
const DEFAULT_CTAS = {
  instagram: ['Siga o Pulso para ouvir as conversas que estão movimentando a saúde.', 'Siga o perfil do Pulso e receba as próximas conversas no seu feed.', 'Siga o Pulso e mande este vídeo para quem precisa ouvir isso.'],
  tiktok: ['Segue o Pulso para ver mais conversas como essa.', 'Segue o Pulso: toda semana tem conversa nova sobre saúde e carreira.', 'Segue o Pulso para não perder o próximo corte.'],
  youtube: ['Inscreva-se no canal do Pulso para não perder os próximos episódios.', 'Inscreva-se no canal e assista à conversa completa no Pulso.', 'Inscreva-se no Pulso: toda semana tem conversa nova com quem está movimentando a saúde.'],
  facebook: ['Siga a página do Pulso para acompanhar as próximas conversas.', 'Siga o Pulso e compartilhe com quem precisa ouvir isso.', 'Siga a página do Pulso: toda semana tem conversa nova sobre saúde.'],
  linkedin: ['Siga o Pulso para acompanhar quem está mudando a saúde, a gestão e a carreira na área.', 'Siga o Pulso e compartilhe com quem trabalha com saúde.', 'Siga o Pulso para mais conversas sobre carreira, gestão e inovação em saúde.'],
  threads: ['Siga o Pulso e conte aqui o que você achou.', 'Siga o Pulso para mais conversas como essa. Concorda?', 'Siga o Pulso e responda: você faria diferente?'],
  x: ['Siga o Pulso para mais conversas sobre saúde.', 'Siga o Pulso: conversa nova toda semana.', 'Siga o Pulso para não perder o próximo episódio.'],
};

// Frases que deixam a legenda genérica: a IA é proibida de usá-las e a conferência avisa.
const BANNED = ['veja o momento', 'momento de reflexão', 'assista ao trecho', 'assista o trecho', 'confira o trecho', 'confira esse', 'confira este', 'neste corte', 'nesse corte', 'neste trecho', 'nesse trecho', 'não perca', 'imperdível', 'link na bio', 'reflexão de', 'vale a pena assistir', 'dá o play', 'aperte o play'];

const COPY = {
  capa: [
    'Texto da capa (o que aparece em cima do vídeo, no feed e na grade): é ele que decide se a pessoa para de rolar.',
    'Use UM destes caminhos: (1) uma frase forte que a pessoa realmente disse, encurtada; (2) uma tensão ou contradição ("Médico não é vendedor?", "Currículo não traz paciente"); (3) uma promessa concreta e verdadeira do que o trecho entrega; (4) um número ou dado que aparece na fala; (5) uma pergunta que o trecho responde.',
    'Concreto, com substantivo e verbo fortes; fala com quem assiste (profissional da saúde ou quem quer viver com mais saúde). Faz sentido sozinho, sem o vídeo.',
    'Proibido: rótulo de tema ("Liderança", "Saúde mental"), nome do convidado sozinho, palavras vagas ("reflexão", "momento", "dicas", "importante", "incrível"), clickbait que o trecho não cumpre.',
  ].join(' '),
  titulo: [
    'Título do post: o gancho vem nas primeiras palavras e diz por que isso importa para quem assiste.',
    'Caminhos que funcionam: afirmação que contraria o senso comum, erro comum + consequência, pergunta específica, número concreto, frase marcante do convidado. Específico vence genérico ("O erro que trava o consultório no 2º ano" > "Dicas de gestão").',
    'Proibido: "Neste corte", "Reflexão sobre", "Momento de", nome do episódio, clickbait que o trecho não cumpre.',
  ].join(' '),
  legenda: [
    'Legenda: a primeira linha é um gancho que acrescenta algo ao vídeo (não repete o título) e aparece antes do "mais", então cabe em até 120 caracteres.',
    'Depois, 1 ou 2 frases com o contexto ou a ideia central, dizendo quem fala (nome e o que faz) quando ajuda a dar autoridade.',
    'Termine com UMA pergunta específica do tema que dê vontade de comentar ou com um pedido concreto de salvar ou mandar para alguém ("Mande para aquele colega que ainda acha que...").',
    'NÃO peça para seguir, se inscrever nem curtir: a chamada de cada rede é colocada depois, automaticamente.',
    `Proibido: ${BANNED.map((b) => `"${b}"`).join(', ')}.`,
  ].join(' '),
};

const tidyCta = (s) => L.fitWords(L.tidy(String(s || '').replace(/\s*\n+\s*/g, ' ')).replace(/!{2,}/g, '!'), CTA_MAX);
const pick = (net, seed = 0) => { const list = DEFAULT_CTAS[net] || []; return list.length ? list[Math.abs(Number(seed) || 0) % list.length] : ''; };

// Chamadas de um corte para as redes pedidas: a que a IA escreveu para ele ou uma padrão da rede.
function forClip(clip, platforms = NETWORKS) {
  const own = clip?.ctas || {};
  return Object.fromEntries(platforms.filter((n) => LABEL[n]).map((n) => [n, tidyCta(own[n]) || pick(n, clip?.id)]));
}

// Lê o formulário de publicar: cta_on=1 liga; cta_<rede> traz o texto de cada rede (vazio = sem chamada naquela rede).
function readForm(body, platforms) {
  if (!body || String(body.cta_on || '') !== '1') return null;
  const out = {};
  for (const n of platforms) { const t = tidyCta(body[`cta_${n}`]); if (t) out[n] = t; }
  return Object.keys(out).length ? out : null;
}

// Legenda + chamada (sem repetir se a legenda já termina com ela).
function compose(description, cta) {
  const d = String(description || '').trim(); const c = String(cta || '').trim();
  if (!c) return d;
  if (d.toLowerCase().endsWith(c.toLowerCase())) return d;
  return d ? `${d}\n\n${c}` : c;
}

// Frases genéricas que aparecem no texto (para avisar e para a IA refazer).
const bannedIn = (text) => { const t = String(text || '').toLowerCase(); return BANNED.filter((b) => t.includes(b)); };

module.exports = { NETWORKS, LABEL, CTA_MAX, CTA_RULE, DEFAULT_CTAS, BANNED, COPY, tidyCta, pick, forClip, readForm, compose, bannedIn };
