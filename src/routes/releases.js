// Novidades: histórico de versões do sistema e o aviso de atualização (visto uma vez por versão, por pessoa).
const express = require('express');
const releases = require('../services/releases');
const { requireAuth } = require('../middleware');
const { wrap } = require('../utils/wrap');

const router = express.Router();

router.get('/novidades', requireAuth, wrap(async (req, res) => {
  await releases.markSeen(req.user.id);
  res.render('releases/index', { title: 'Novidades', releases: releases.list, kinds: releases.KINDS });
}));

// Dispensar o aviso sem abrir a página. Volta para onde a pessoa estava (só caminhos do próprio painel).
router.post('/novidades/visto', requireAuth, wrap(async (req, res) => {
  await releases.markSeen(req.user.id);
  const back = String(req.body.voltar || '/');
  res.redirect(/^\/(?!\/)/.test(back) ? back : '/');
}));

module.exports = router;
