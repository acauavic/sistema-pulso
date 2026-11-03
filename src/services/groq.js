// Transcrição de voz com Whisper large-v3 na Groq (API compatível com OpenAI).
const config = require('../config');

// Texto puro (respostas por voz) ou, com { verbose: true }, texto + trechos com tempo: { text, segments:[{start_ms,end_ms,text}], duration_ms }.
async function transcribe(buffer, { filename = 'audio.webm', contentType = 'audio/webm', verbose = false } = {}) {
  if (!config.groqConfigured) throw new Error('Transcrição não configurada (GROQ_APIKEY).');
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType }), filename);
  form.append('model', config.groq.model);
  form.append('language', 'pt');
  form.append('response_format', verbose ? 'verbose_json' : 'json');
  if (verbose) form.append('timestamp_granularities[]', 'segment');
  form.append('temperature', '0');
  let res;
  for (let attempt = 1; ; attempt += 1) {
    res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${config.groq.key}` }, body: form, signal: AbortSignal.timeout(180_000),
    });
    if (res.status !== 429 && res.status < 500) break;
    if (attempt >= 3) break;
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Groq recusou a transcrição (${res.status}): ${json.error?.message || 'erro desconhecido'}`);
  const text = String(json.text || '').trim();
  if (!verbose) return text;
  return {
    text,
    duration_ms: Math.round(Number(json.duration || 0) * 1000),
    segments: (json.segments || []).map((s) => ({ start_ms: Math.round(s.start * 1000), end_ms: Math.round(s.end * 1000), text: String(s.text || '').trim() })).filter((s) => s.text),
  };
}

module.exports = { transcribe };
