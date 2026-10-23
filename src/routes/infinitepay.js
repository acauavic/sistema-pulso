// InfinitePay: webhook de pagamento (sem login; protegido pelo segredo no endereço e pela conferência na API) e a página
// para onde o cliente volta depois de pagar.
const express = require('express');
const config = require('../config');
const ip = require('../services/infinitePay');
const { wrap } = require('../utils/wrap');

const router = express.Router();

router.post('/webhooks/infinitepay/:secret', wrap(async (req, res) => {
  if (!config.infinitepayConfigured || !ip.secretOk(req.params.secret)) return res.status(404).json({ ok: false });
  const r = await ip.handleWebhook(req.body);
  res.status(r.status).json(r.body);
}));

router.get('/plateia/pagamento-concluido', (req, res) => {
  res.set({ 'Content-Security-Policy': "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'", 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  res.render('plateia/pagamento-concluido', { title: 'Pagamento recebido · Pulso Podcast com Plateia', assetV: res.locals.assetV });
});

module.exports = router;
