// Consumo da IA (Gestão > Sistema > Consumo da IA): cada chamada ao Gemini vira uma linha em ai_usage, com a função que chamou,
// os tokens de entrada, de saída e de raciocínio (o Google cobra o raciocínio como saída) e se deu certo.
// O custo é estimativa pelo preço de tabela (GEMINI_PRICE_IN / GEMINI_PRICE_OUT, US$ por milhão de tokens); a conta de verdade
// fica no Google AI Studio.
const db = require('../db/pool');

const FEATURES = {
  comentarios: 'Respostas a comentários',
  comentarios_direct: 'Directs dos comentários',
  corte_textos: 'Título, legenda e capa do corte',
  quadros: 'Leitura dos quadros do vídeo',
  capas_ficha: 'Ficha das capas do episódio',
  episodio_textos: 'Títulos, descrições e capítulos do episódio',
  sugerir_texto: 'Sugerir com IA',
  assistente: 'Assistente',
  resumo_chat: 'Resumo das mensagens',
  tarefa_voz: 'Tarefa por voz ou mensagem',
  ideias: 'Ideias para as redes',
  outros: 'Outros',
};
const label = (key) => FEATURES[key] || FEATURES.outros;

const num = (v, dflt) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : dflt);
const prices = () => ({ input: num(process.env.GEMINI_PRICE_IN, 0.5), output: num(process.env.GEMINI_PRICE_OUT, 3) });
// Custo em dólares: entrada pelo preço de entrada; resposta e raciocínio pelo de saída.
const cost = ({ input_tokens: i = 0, output_tokens: o = 0, thinking_tokens: t = 0 }, p = prices()) => (Number(i) * p.input + (Number(o) + Number(t)) * p.output) / 1e6;

// Guarda uma chamada. Nunca derruba quem chamou a IA: se o banco falhar, só avisa no log.
async function record({ feature = null, model = null, usage = null, ok = true, status = null, error = null, ms = null }) {
  try {
    const u = usage || {};
    await db.query(
      `INSERT INTO ai_usage (feature, model, input_tokens, output_tokens, thinking_tokens, cached_tokens, ok, status, error, ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [FEATURES[feature] ? feature : 'outros', model, u.promptTokenCount || 0, u.candidatesTokenCount || 0, u.thoughtsTokenCount || 0,
        u.cachedContentTokenCount || 0, Boolean(ok), status, error ? String(error).slice(0, 300) : null, ms == null ? null : Math.round(ms)]);
  } catch (err) { console.warn('consumo da IA: não consegui registrar a chamada:', err.message); }
}

// Resumo dos últimos `days` dias: totais, por função (do que mais custa para o que menos) e por dia (em Brasília).
async function report(days = 7) {
  const p = prices();
  const since = `${Number(days)} days`;
  const sums = `count(*)::int AS calls, count(*) FILTER (WHERE NOT ok)::int AS failed,
    coalesce(sum(input_tokens),0)::bigint AS input_tokens, coalesce(sum(output_tokens),0)::bigint AS output_tokens,
    coalesce(sum(thinking_tokens),0)::bigint AS thinking_tokens`;
  const [{ rows: [total] }, { rows: byFeature }, { rows: byDay }, { rows: [last] }] = await Promise.all([
    db.query(`SELECT ${sums} FROM ai_usage WHERE created_at > now() - $1::interval`, [since]),
    db.query(`SELECT feature, ${sums} FROM ai_usage WHERE created_at > now() - $1::interval GROUP BY feature`, [since]),
    db.query(`SELECT to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS day, ${sums}
                FROM ai_usage WHERE created_at > now() - $1::interval GROUP BY 1 ORDER BY 1 DESC`, [since]),
    db.query("SELECT created_at, ok, status, error FROM ai_usage WHERE created_at > now() - interval '1 day' ORDER BY id DESC LIMIT 1"),
  ]);
  const withCost = (r) => ({ ...r, input_tokens: Number(r.input_tokens), output_tokens: Number(r.output_tokens), thinking_tokens: Number(r.thinking_tokens), cost: cost(r, p) });
  const t = withCost(total);
  const features = byFeature.map((r) => ({ ...withCost(r), label: label(r.feature) }))
    .map((r) => ({ ...r, share: t.cost > 0 ? r.cost / t.cost : 0 }))
    .sort((a, b) => b.cost - a.cost || b.calls - a.calls);
  return { days: Number(days), prices: p, total: t, features, byDay: byDay.map(withCost), stopped: stoppedReason(last) };
}

// A última chamada do dia falhou porque o Google cortou a conta? Diz o motivo em palavras simples (senão, null).
function stoppedReason(last) {
  if (!last || last.ok) return null;
  const m = String(last.error || '');
  if (last.status === 402 || /prepayment|credits are depleted/i.test(m)) return { at: last.created_at, text: 'Os créditos do Gemini acabaram: toda chamada à IA está sendo recusada. Ponha crédito no Google AI Studio.' };
  if (/spending cap/i.test(m)) return { at: last.created_at, text: 'O limite de gasto mensal do Gemini foi atingido: toda chamada à IA está sendo recusada até subir o limite no Google AI Studio.' };
  return null;
}

const purge = () => db.query("DELETE FROM ai_usage WHERE created_at < now() - interval '400 days'");

module.exports = { FEATURES, label, prices, cost, record, report, purge };
