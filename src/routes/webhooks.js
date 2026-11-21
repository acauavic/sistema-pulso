// Avisos que chegam de fora, sem login: o comentário recebido na Outstand (automação de comentário → direct).
// Montado antes dos leitores de corpo do app: a assinatura confere o corpo exato que chegou.
const express = require('express');
const { wrap } = require('../utils/wrap');

const router = express.Router();

router.post('/webhooks/outstand', express.raw({ type: () => true, limit: '256kb' }), wrap(async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const r = await require('../services/commentAutomation').receive(raw, req.get('x-outstand-signature'));
  res.status(r.status).json(r.body);
}));

module.exports = router;
