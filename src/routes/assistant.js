// Assistente de IA flutuante: conversa por texto ou áudio, com histórico por pessoa. Respostas em JSON (o painel chama por fetch).
const express = require('express');
const config = require('../config');
const assistant = require('../services/assistant');
const groq = require('../services/groq');
const { createLimiter } = require('../auth/rateLimit');
const { wrap, isIntId } = require('../utils/wrap');

const router = express.Router();
const limiter = createLimiter({ name: 'assistente', max: 40, windowMs: 10 * 60_000 });
const MAX_AUDIO = 8 * 1024 * 1024; // ~2 min de voz em webm/ogg
const page = (v) => (typeof v === 'string' && /^\/[\w\-/?=&#.%]*$/.test(v) ? v.slice(0, 200) : null);

router.get('/assistente/conversas', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, ai: config.geminiConfigured, voice: config.groqConfigured, conversations: await assistant.conversations(req.user.id) });
}));

router.get('/assistente/conversas/:id', wrap(async (req, res) => {
  const conv = isIntId(req.params.id) ? await assistant.getConversation(req.user.id, Number(req.params.id)) : null;
  if (!conv) return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });
  res.set('Cache-Control', 'no-store').json({ ok: true, conversation: conv });
}));

router.post('/assistente/conversas/:id/excluir', wrap(async (req, res) => {
  const ok = isIntId(req.params.id) && await assistant.removeConversation(req.user.id, Number(req.params.id));
  res.status(ok ? 200 : 404).json({ ok });
}));

async function answer(req, res, text, extra = {}) {
  if (!await limiter.hit(req.user.id)) return res.status(429).json({ ok: false, error: 'Muitas perguntas seguidas. Espere alguns minutos.' });
  if (!config.geminiConfigured) return res.status(503).json({ ok: false, error: 'A IA não está configurada neste servidor.' });
  try {
    const conversationId = isIntId(String(req.body?.conversation_id ?? req.query.conversa ?? '')) ? Number(req.body?.conversation_id ?? req.query.conversa) : null;
    const r = await assistant.ask({ user: req.user, conversationId, text, page: page(req.body?.page ?? req.query.pagina), audio: Boolean(extra.transcript) });
    return res.json({ ok: true, ...r, ...extra });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : 'Não consegui responder agora.' });
  }
}

router.post('/assistente/mensagem', wrap(async (req, res) => answer(req, res, String(req.body?.text || ''))));

// Áudio: o navegador grava (MediaRecorder), o servidor transcreve (Groq Whisper) e segue como se fosse texto.
router.post('/assistente/audio', express.raw({ type: () => true, limit: MAX_AUDIO }), wrap(async (req, res) => {
  if (!config.groqConfigured) return res.status(503).json({ ok: false, error: 'A transcrição de voz não está configurada neste servidor.' });
  const type = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!type.startsWith('audio/') && type !== 'video/webm') return res.status(400).json({ ok: false, error: 'Formato de áudio não aceito.' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 500) return res.status(400).json({ ok: false, error: 'A gravação ficou vazia. Tente de novo.' });
  let text;
  try { text = await groq.transcribe(req.body, { filename: `pergunta.${type.split('/')[1] || 'webm'}`, contentType: type }); } catch (err) {
    console.error('[assistente] transcrição:', err.message);
    return res.status(502).json({ ok: false, error: 'Não consegui entender o áudio agora. Tente de novo ou escreva.' });
  }
  if (!text) return res.status(422).json({ ok: false, error: 'Não ouvi nada na gravação. Tente de novo mais perto do microfone.' });
  return answer(req, res, text, { transcript: text });
}));

module.exports = router;
