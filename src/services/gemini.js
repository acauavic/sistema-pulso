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

// Igual ao chat, mas a resposta chega aos pedaços (streamGenerateContent em SSE): onText(pedaço) é chamado a cada trecho de
// texto, para a tela ir escrevendo enquanto o modelo gera. Devolve { text, calls, parts } como o chat.
// Sem novas tentativas no meio do texto (já foi mostrado): só tenta de novo se falhar antes do primeiro pedaço.
async function chatStream({ system, contents, tools = [], temperature = 0.5, model = config.gemini.model, timeoutMs = 60_000, attempts = 2, onText = () => {} }) {
  if (!config.geminiConfigured) throw new Error('IA não configurada (GEMINI_KEY).');
  const body = {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    ...(tools.length ? { tools: [{ functionDeclarations: tools }] } : {}),
    generationConfig: { temperature },
  };
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let started = false;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': config.gemini.key }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        lastErr = new Error(`Gemini recusou (${res.status}): ${json.error?.message || 'erro desconhecido'}`);
        if (res.status !== 429 && res.status < 500) throw lastErr;
      } else {
        let text = ''; const calls = []; const callParts = []; let finish = null; let buf = '';
        const decoder = new TextDecoder();
        const handle = (line) => {
          if (!line.startsWith('data:')) return;
          let json; try { json = JSON.parse(line.slice(5).trim()); } catch { return; }
          const cand = json.candidates?.[0];
          if (cand?.finishReason) finish = cand.finishReason;
          for (const part of cand?.content?.parts || []) {
            if (part.functionCall) { calls.push({ name: part.functionCall.name, args: part.functionCall.args || {} }); callParts.push(part); } else if (part.text && !part.thought) { text += part.text; started = true; onText(part.text); }
          }
        };
        for await (const chunk of res.body) {
          buf += decoder.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
        }
        handle(buf.trim());
        text = text.trim();
        // o turno do modelo volta no histórico como veio: texto (se houve) + as chamadas de ferramenta (com a assinatura delas)
        const parts = [...(text ? [{ text }] : []), ...callParts];
        if (text || calls.length) return { text, calls, parts };
        lastErr = new Error(`Gemini não respondeu (${finish || 'sem motivo'}).`);
      }
    } catch (err) {
      if (started) throw err; // já mostrou parte do texto: não repete
      lastErr = err;
      if (/recusou \((4\d\d)\)/.test(err.message) && !/\(429\)/.test(err.message)) throw err;
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

module.exports = { chatStream, generateJson, chat, friendlyError, imagePart };
