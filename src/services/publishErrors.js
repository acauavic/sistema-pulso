// Por que uma rede falhou e o que fazer: cada erro vira um código, se tenta de novo sozinho (e quando) e uma frase para a equipe.
// Fontes: documentação da Outstand (fila compartilhada do YouTube com retryAt, códigos do TikTok, falhas passageiras da Meta) e o
// que já aconteceu aqui (o Backblaze parou de entregar o vídeo no meio e cada rede falhou de um jeito: Reel pela metade, Facebook 500,
// Threads "could not process", X "terminated").
const MIN = 60_000;
// Espera entre tentativas de uma mesma rede: 2 min, 10 min, 30 min, 1 h, 3 h, 6 h (umas 11 h no total).
const BACKOFF = [2, 10, 30, 60, 180, 360].map((m) => m * MIN);
// Quantas tentativas (contando a primeira) cada tipo de falha ganha antes de parar e pedir ação.
const MAX_TRIES = { espera: 12, rede: 6, arquivo: 6, limite: 6, desconhecido: 3 };
const TERMINAL = new Set(['conta', 'conteudo']);

const hhmm = (d) => require('../utils/format').formatSoon(d); // "11:15" hoje, "28/10 04:01" em outro dia
const backoff = (tries) => BACKOFF[Math.min(Math.max(tries, 1), BACKOFF.length) - 1];

// Fila compartilhada do YouTube na Outstand (Managed Keys): o erro traz o motivo e a hora em que pode haver vaga.
const YT_REASON = {
  release_pending: 'Fila compartilhada do YouTube na Outstand: a próxima vaga abre',
  org_limit_reached: 'Limite diário de envios ao YouTube pela Outstand para esta conta: nova vaga',
  daily_limit_reached: 'A cota diária do YouTube na Outstand acabou: nova vaga',
  provider_quota_exhausted: 'O Google esgotou a cota do YouTube da Outstand: nova vaga',
  quota_unavailable: 'A Outstand não conseguiu conferir a vaga no YouTube agora',
};

// Regras na ordem: a primeira que casa decide. wait(tries, m) devolve ms de espera ou um Date absoluto.
const RULES = [
  { re: /\[youtube_upload_error:([a-z_]+)(?:;\s*retryAt=([0-9T:.\-+Z]+))?\]/i, code: 'youtube_fila', kind: 'espera',
    wait: (tries, m) => { const t = m[2] && Date.parse(m[2]); return Number.isFinite(t) && t > Date.now() ? new Date(t + 90_000 + Math.floor(Math.random() * 60_000)) : 15 * MIN; },
    hint: (m) => YT_REASON[m[1]] || 'Fila do YouTube na Outstand' },
  { re: /shared youtube upload capacity|youtube upload capacity/i, code: 'youtube_fila', kind: 'espera', wait: () => 15 * MIN, hint: () => 'Fila compartilhada do YouTube na Outstand' },
  { re: /url_ownership_unverified/i, code: 'tiktok_dominio', kind: 'arquivo', wait: () => 2 * MIN, hint: () => 'O TikTok só busca vídeo de endereço verificado: a próxima tentativa manda o vídeo pelo armazenamento da Outstand' },
  { re: /reached_active_user_cap|global_quota_exhausted/i, code: 'tiktok_cota', kind: 'limite', wait: (t) => Math.max(3 * 60 * MIN, backoff(t)), hint: () => 'O app do TikTok da Outstand atingiu o limite de contas nas últimas 24 h (dá para mandar como rascunho em Integrações)' },
  { re: /spam_risk_too_many_posts/i, code: 'tiktok_limite_diario', kind: 'limite', wait: (t) => Math.max(6 * 60 * MIN, backoff(t)), hint: () => 'O TikTok limitou os posts desta conta por hoje' },
  { re: /rate_limit_exceeded/i, code: 'limite', kind: 'limite', wait: (t) => Math.max(2 * MIN, backoff(t)), hint: () => 'Muitos envios em sequência para esta rede' },
  { re: /privacy_level_option_mismatch/i, code: 'tiktok_privacidade', kind: 'rede', wait: () => 2 * MIN, hint: () => 'As opções de privacidade do TikTok mudaram: a próxima tentativa lê de novo' },
  { re: /unaudited_client_can_only_post_to_private_accounts/i, code: 'tiktok_privado', kind: 'conta', hint: () => 'O app do TikTok só publica como privado: em Integrações, mande o TikTok como rascunho' },
  { re: /spam_risk_user_banned_from_posting/i, code: 'tiktok_bloqueado', kind: 'conta', hint: () => 'O TikTok bloqueou esta conta de publicar: só o suporte do TikTok resolve' },
  { re: /access_token_invalid|scope_not_authorized|token (?:has )?expired|expired token|access token|re-?auth|reconnect|session has been invalidated|oauthexception|invalid_grant|unauthori[sz]ed|\b401\b|not authorized|needs? reconnection/i,
    code: 'conta', kind: 'conta', hint: () => 'A conta desta rede precisa ser reconectada em Integrações > Redes sociais' },
  { re: /duplicate|already been posted|identical content|content already exists/i, code: 'repetido', kind: 'conteudo', hint: () => 'A rede recusou por ser conteúdo repetido' },
  { re: /rate.?limit|too many requests|\b429\b|\(#(?:4|17|32|613)\)|limit reached|quota/i, code: 'limite', kind: 'limite', wait: (t) => Math.max(30 * MIN, backoff(t)), hint: () => 'A rede limitou os envios por agora' },
  { re: /aspect ratio|too long|too short|duration|unsupported|not supported|invalid (?:video|media|image|file|format)|codec|resolution|file (?:is )?too large|\b2207\d{3}\b/i,
    code: 'formato', kind: 'conteudo', hint: () => 'A rede recusou o formato do arquivo' },
  { re: /terminated|fetch failed|econnreset|etimedout|econnrefused|eai_again|socket|timed? ?out|could not (?:fetch|download|process|retrieve)|failed to (?:upload|download|fetch)|\b5\d\d\b|unknown error|temporar|unavailable|try again|internal (?:server )?error|\(unknown\)/i,
    code: 'rede', kind: 'rede', wait: (t) => backoff(t), hint: () => 'Falha passageira ao levar o vídeo até a rede' },
];

// Erros que nós mesmos levantamos antes de chegar às redes (arquivo ilegível, provedor fora): vêm com err.code.
const OWN = {
  arquivo_indisponivel: { kind: 'arquivo', hint: 'O armazenamento (Backblaze) não entregou o arquivo inteiro: nada foi enviado às redes' },
  arquivo_sumiu: { kind: 'conteudo', hint: 'O arquivo não está mais no armazenamento: envie o vídeo de novo no corte' },
  arquivo_incompleto: { kind: 'conteudo', hint: 'O arquivo no armazenamento está incompleto: envie o vídeo de novo no corte' },
  provedor_fora: { kind: 'rede', hint: 'O provedor não respondeu agora' },
  provedor_chave: { kind: 'conta', hint: 'A chave ou a assinatura do provedor não vale: confira em Integrações' },
  recusado: { kind: 'conteudo', hint: 'O pedido foi recusado' },
  removido: { kind: 'conteudo', hint: 'O material desta publicação foi removido' },
  em_preparo: { kind: 'arquivo', hint: 'O vídeo está sendo enviado ou lido de novo: a publicação espera ele ficar pronto' },
  formato: { kind: 'conteudo', hint: 'A rede recusou o formato do arquivo' },
  sem_conta: { kind: 'conta', hint: 'Não há conta conectada para esta rede no provedor' },
  tiktok_privado: { kind: 'conta', hint: 'O app do TikTok só publica como privado: em Integrações, mande o TikTok como rascunho' },
  interrompido: { kind: 'rede', hint: 'O envio foi interrompido (o servidor reiniciou no meio)' },
  sem_resposta: { kind: 'conteudo', hint: 'O provedor não respondeu sobre este envio por mais de 2 dias' },
};

// tries: quantas tentativas esta rede já teve, contando a que acabou de falhar.
// Devolve { code, kind, hint, retryAt (Date|null), terminal, exhausted }.
function classify(message, { code = null, tries = 1, now = Date.now() } = {}) {
  const msg = String(message || '');
  let out;
  if (code && OWN[code]) {
    const o = OWN[code];
    out = { code, kind: o.kind, hint: o.hint, wait: TERMINAL.has(o.kind) ? null : (code === 'interrompido' ? MIN : backoff(tries)) };
  } else {
    const rule = RULES.find((r) => r.re.test(msg));
    if (rule) { const m = msg.match(rule.re); out = { code: rule.code, kind: rule.kind, hint: rule.hint(m), wait: rule.wait ? rule.wait(tries, m) : null }; } else out = { code: 'desconhecido', kind: 'desconhecido', hint: 'A rede recusou sem dizer o motivo', wait: backoff(tries) };
  }
  const terminal = TERMINAL.has(out.kind) || out.wait == null;
  const exhausted = !terminal && tries >= (MAX_TRIES[out.kind] || 3);
  let retryAt = null;
  if (!terminal && !exhausted) retryAt = out.wait instanceof Date ? out.wait : new Date(now + out.wait);
  return { code: out.code, kind: out.kind, hint: out.hint, retryAt, terminal, exhausted };
}

// Frase para a tela: o motivo e, se for o caso, a hora da nova tentativa ou o que a equipe precisa fazer.
function sentence(c, tries = 1) {
  if (c.retryAt) return /vaga abre|nova vaga$/.test(c.hint) ? `${c.hint} às ${hhmm(c.retryAt)}.` : `${c.hint}. Nova tentativa automática às ${hhmm(c.retryAt)}.`;
  if (c.exhausted) return `${c.hint}. Já tentamos ${tries} vezes: confira e reenvie quando quiser.`;
  return `${c.hint}.`;
}

// A próxima tentativa marcada entre as redes que falharam (ou null).
function nextRetry(results) {
  const times = (results || []).filter((r) => !r.ok && r.retry_at).map((r) => Date.parse(r.retry_at)).filter(Number.isFinite);
  return times.length ? new Date(Math.min(...times)) : null;
}

module.exports = { classify, sentence, nextRetry, hhmm, BACKOFF, MAX_TRIES };
