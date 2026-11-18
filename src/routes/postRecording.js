// Página pós-gravação (/pos-gravacao): a mesma para todos os convidados, aberta pelo QR Code do cartão de agradecimento. Pública
// (sem login), fora dos buscadores (noindex) e sem link no resto do site: agradece, mostra o que acontece depois da gravação, o que
// tem no portal do convidado, os cortes em collab, as redes onde o Pulso posta e o WhatsApp da produção (o número e a mensagem ficam
// em Gestão > WhatsApp dos convites, para a equipe atualizar sem mexer no código).
const express = require('express');
const config = require('../config');
const contacts = require('../services/contacts');
const fmt = require('../utils/format');
const { icon } = require('../utils/icons');
const { brand } = require('../utils/brandIcons');
const { wrap } = require('../utils/wrap');

const router = express.Router();
const PATH = '/pos-gravacao';
const HEADERS = {
  'Content-Security-Policy': "default-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache',
};
// As redes do Pulso, na ordem em que o convidado mais reconhece.
const NETWORKS = [['instagram', 'Instagram e Reels'], ['youtube', 'YouTube e Shorts'], ['tiktok', 'TikTok'], ['linkedin', 'LinkedIn'], ['x', 'X (Twitter)'], ['threads', 'Threads'], ['facebook', 'Facebook']];
// número com o código do Brasil vira "(12) 99105-3852"; de fora, fica com o "+"
const prettyPhone = (n) => fmt.phone(/^55\d{10,11}$/.test(n) ? n.slice(2) : n);

router.get(PATH, wrap(async (req, res) => {
  const producao = (await contacts.current()).producao;
  const wa = producao.number ? await contacts.waUrl('producao', 'posgravacao', '') : null;
  res.set(HEADERS).render('portal/pos-gravacao', {
    title: `Depois da gravação · ${config.podcastName}`, wa, phone: producao.number ? prettyPhone(producao.number) : null,
    networks: NETWORKS, icon, brand, assetV: res.locals.assetV,
  });
}));

module.exports = router;
module.exports.PATH = PATH;
