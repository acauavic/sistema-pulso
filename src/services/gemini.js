// Gemini (Google): texto estruturado (JSON) e leitura de imagens. Modelo configurável (padrão: gemini-3.8-flash).
const config = require('../config');

const imagePart = (buffer, mime = 'image/jpeg') => ({ inline_data: { mime_type: mime, data: Buffer.from(buffer).toString('base64') } });

// Chama o modelo pedindo JSON que obedece ao `schema` (formato OpenAPI do Gemini). Tenta de novo em 429/5xx.
async function generateJson({ system, parts, schema, temperature = 0.7, thinking = null, model = config.gemini.model, timeoutMs = 180_000, attempts = 5 }) {
  if (!config.geminiConfigured) throw new Error('IA não configurada (GEMINI_KEY).');
  const body = {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature, responseMimeType: 'application/json', ...(schema ? { responseSchema: schema } : {}),
      ...(thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}), // 'low' = respostas bem mais rápidas (leitura de imagens)
    },
  };
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': config.gemini.key }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      if (!text) { lastErr = new Error(`Gemini não devolveu texto (${json.candidates?.[0]?.finishReason || json.promptFeedback?.blockReason || 'sem motivo'}).`); } else {
        try { return { data: JSON.parse(text), usage: json.usageMetadata || null, model }; } catch { lastErr = new Error('Gemini devolveu um JSON inválido.'); }
      }
    } else {
      lastErr = new Error(`Gemini recusou (${res.status}): ${json.error?.message || 'erro desconhecido'}`);
      if (res.status !== 429 && res.status < 500) throw lastErr;
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  throw lastErr;
}

// Conversa com ferramentas (function calling). contents: [{ role: 'user'|'model', parts }]. Devolve a resposta do modelo:
// { text, calls: [{ name, args }], parts } — quem chama executa as ferramentas e chama de novo com os resultados.
async function chat({ system, contents, tools = [], temperature = 0.5, model = config.gemini.model, timeoutMs = 60_000, attempts = 2 }) {
  if (!config.geminiConfigured) throw new Error('IA não configurada (GEMINI_KEY).');
  const body = {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    ...(tools.length ? { tools: [{ functionDeclarations: tools }] } : {}),
    generationConfig: { temperature },
  };
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': config.gemini.key }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      const parts = json.candidates?.[0]?.content?.parts || [];
      const calls = parts.filter((p) => p.functionCall).map((p) => ({ name: p.functionCall.name, args: p.functionCall.args || {} }));
      const text = parts.map((p) => p.text || '').join('').trim();
      if (text || calls.length) return { text, calls, parts };
      lastErr = new Error(`Gemini não respondeu (${json.candidates?.[0]?.finishReason || json.promptFeedback?.blockReason || 'sem motivo'}).`);
    } else {
      lastErr = new Error(`Gemini recusou (${res.status}): ${json.error?.message || 'erro desconhecido'}`);
      if (res.status !== 429 && res.status < 500) throw lastErr;
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw lastErr;
}

// Mensagem para a equipe quando a IA falha (sem jargão).
function friendlyError(err) {
  const m = String(err?.message || err);
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(m)) return 'A cota da IA acabou por agora. Tente de novo mais tarde (ou ative o faturamento do Gemini).';
  if (/não configurada/i.test(m)) return 'A IA não está configurada neste servidor.';
  if (/timeout|aborted|timed out/i.test(m)) return 'A IA demorou demais para responder. Tente de novo.';
  return 'A IA não conseguiu responder agora. Tente de novo em instantes.';
}

module.exports = { generateJson, chat, friendlyError, imagePart };
