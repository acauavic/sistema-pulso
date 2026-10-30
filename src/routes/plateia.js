// Pulso Podcast com Plateia — páginas e endpoints PÚBLICOS (sem login). A agenda sai dos convidados; a inscrição vira um lead
// (com UTMs) e leva a pessoa ao WhatsApp da produtora. Nada é cobrado nem confirmado aqui.
const express = require('express');
const config = require('../config');
const audience = require('../services/audience');
const page = require('../services/audiencePage');
const b2 = require('../services/b2');
const db = require('../db/pool');
const { createLimiter } = require('../auth/rateLimit');
const { wrap, isIntId } = require('../utils/wrap');
const { icon } = require('../utils/icons');

const router = express.Router();
// O mesmo vídeo de fundo do media kit e do convite.
const HERO_VIDEO = 'https://s3.acauamedia.com/pulso-podcast/episodios/paola/Site%20Pulso.webm';
const BOT_RE = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|linkedin|skype|embedly|curl|wget|headless/i;
const isBot = (req) => BOT_RE.test(req.get('user-agent') || '');

const leadLimiter = createLimiter({ name: 'plateia_inscricao', max: 12, windowMs: 10 * 60_000 });
const eventLimiter = createLimiter({ name: 'plateia_evento', max: 300, windowMs: 10 * 60_000 });

// Página pública e indexável. Os scripts de análise (Meta Pixel e GA4) só entram se a gestão informar os códigos.
// mediaOrigin: o Backblaze, quando há o vídeo dos bastidores (o navegador busca o vídeo direto de lá, por link assinado).
function pageHeaders(s, mediaOrigin = null) {
  const scripts = ["'self'"]; const connect = ["'self'"]; const img = ["'self'", 'data:']; const media = ['https://s3.acauamedia.com'];
  if (mediaOrigin) media.push(mediaOrigin);
  if (s.metaPixel) { scripts.push('https://connect.facebook.net'); connect.push('https://www.facebook.com', 'https://connect.facebook.net'); img.push('https://www.facebook.com'); }
  if (s.ga4) { scripts.push('https://www.googletagmanager.com'); connect.push('https://www.google-analytics.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com'); img.push('https://www.google-analytics.com', 'https://www.googletagmanager.com'); }
  return {
    'Content-Security-Policy': `default-src 'none'; script-src ${scripts.join(' ')}; connect-src ${connect.join(' ')}; img-src ${img.join(' ')}; style-src 'self'; font-src 'self'; media-src ${media.join(' ')}; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Cache-Control': 'no-cache', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

// O que a pessoa vive na gravação (topo das duas páginas).
const BENEFITS = [
  ['users', 'Networking qualificado', 'com outros participantes selecionados pela produção'],
  ['mic', 'Interação com o convidado', 'perguntas, conversa e fotos nos bastidores'],
  ['sparkles', 'Coffee break', 'um espaço para conversar antes e depois da gravação'],
  ['film', 'Bastidores de verdade', 'a produção de um podcast profissional, de perto'],
];
// Vídeo vertical dos bastidores (Plateia > Ajustes): o endereço do Backblaze entra na CSP só quando há vídeo.
const reelsOrigin = async (s) => (s.reelsKey || s.reelsWebmKey ? new URL(await b2.endpoint()).origin : null);

const FAQ = (s) => [
  ['Pedir participação garante a minha vaga?', 'Não. A plateia de cada gravação é selecionada pela produção. Ao pedir participação, você fala com a nossa produtora pelo WhatsApp, que avalia o seu pedido e responde com os próximos passos.'],
  ['Como a plateia é escolhida?', 'Pensamos em cada episódio a partir do convidado: quem tem afinidade com o tema, pode contribuir com a conversa e aproveitar aquele encontro. Por isso as vagas são poucas e cada pedido é avaliado.'],
  ['Quanto custa participar?', `O investimento é de ${audience.money(s.priceCents)} por participante selecionado. O valor é combinado com a produção; esta página não faz nenhuma cobrança.`],
  ['Quanto tempo dura a experiência?', `A duração estimada é de ${s.duration}, incluindo a recepção e a experiência de gravação.`],
  ['Onde acontece a gravação?', 'No estúdio do Pulso Podcast, em Alphaville, São Paulo. O endereço completo é enviado apenas aos participantes selecionados.'],
  ['Posso escolher o episódio?', 'Sim. Você escolhe a gravação que quer pedir; a produção decide o encaixe conforme o convidado e as vagas de cada episódio.'],
];

router.get('/plateia', wrap(async (req, res) => {
  const s = await audience.settings();
  const agenda = s.active ? await audience.agenda() : [];
  res.set(pageHeaders(s, await reelsOrigin(s))).render('plateia/page', {
    benefits: BENEFITS, hasReels: Boolean(s.reelsKey || s.reelsWebmKey), hasWebm: Boolean(s.reelsWebmKey), hasMp4: Boolean(s.reelsKey), hasReelsPoster: Boolean(s.reelsPosterKey),
    title: 'Pulso Podcast com Plateia: assista às gravações em São Paulo',
    description: 'Assista de perto às gravações do Pulso Podcast em São Paulo. Uma plateia pequena, escolhida pela produção por afinidade com o convidado. Peça sua participação.',
    ogImage: `${config.appBaseUrl}/static/og-plateia.jpg?v=${res.locals.assetV}`, s, agenda, faq: FAQ(s), icon, countries: audience.COUNTRIES, price: audience.money(s.priceCents), videoUrl: HERO_VIDEO,
    hasHero: Boolean(s.heroKey), hasStudio: Boolean(s.studioKey), assetV: res.locals.assetV, canonical: `${config.appBaseUrl}/plateia`,
  });
}));

// Página de um convidado (/plateia/com/:slug) e o link de parceiro (/plateia/com/:slug/:token, participação isenta até o limite).
// A página existe enquanto a gestão a deixa ativa; fora da agenda (gravação passou, lotou ou encerrou) ela mostra que encerrou.
router.get(['/plateia/com/:slug', '/plateia/com/:slug/:token'], wrap(async (req, res, next) => {
  if (req.params.token === 'foto' || req.params.token === 'fotos') return next();
  const g = await page.bySlug(req.params.slug);
  if (!g) return res.status(404).set(require('../services/inviteTemplate').publicHeaders()).type('html').send(require('../services/publicPages').messageHtml('Página não encontrada', 'Esta página de plateia não existe ou foi desligada. Veja as próximas gravações em podcastpulso.com/plateia.'));
  const s = await audience.settings();
  const { partner, full } = req.params.token ? await page.partnerFor(g.id, req.params.token) : { partner: null, full: false };
  if (req.params.token && !partner) return res.redirect(302, `/plateia/com/${g.audience_slug}`); // link desativado ou de outra gravação: a página normal
  const open = s.active && g.on_agenda && g.audience_status === 'disponivel';
  const closedLabel = !g.on_agenda ? 'Inscrições encerradas' : g.audience_status === 'lotado' ? 'Gravação lotada' : 'Inscrições encerradas';
  const exempt = Boolean(partner && !full);
  const price = audience.money(s.priceCents);
  const view = {
    id: g.id, name: g.name, slug: g.audience_slug, firstName: String(g.name).split(/\s+/)[0], role: [g.job_title, g.company].filter(Boolean).join(' · '), instagram: g.instagram, topic: g.topic,
    hasPhoto: g.has_photo, initials: g.name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase(),
    date: audience.dateLong(g.proposed_at), time: audience.timeShort(g.proposed_at), weekday: audience.weekday(g.proposed_at), arrival: page.timeLabel(g.audience_arrival),
    intro: g.audience_intro, extraTitle: g.audience_extra_title, extra: g.audience_extra,
  };
  const canonical = `${config.appBaseUrl}/plateia/com/${g.audience_slug}`;
  res.set(pageHeaders(s, await reelsOrigin(s))).render('plateia/guest', {
    benefits: BENEFITS, hasReels: Boolean(s.reelsKey || s.reelsWebmKey), hasWebm: Boolean(s.reelsWebmKey), hasMp4: Boolean(s.reelsKey), hasReelsPoster: Boolean(s.reelsPosterKey),
    title: `Plateia com ${g.name} · Pulso Podcast`,
    description: `Assista de perto à gravação do Pulso Podcast com ${g.name}${g.topic ? ` sobre ${g.topic}` : ''}, em ${view.date}. Plateia pequena, selecionada pela produção. Peça sua participação.`,
    ogImage: g.has_photo ? `${canonical}/foto` : `${config.appBaseUrl}/static/og-plateia.jpg?v=${res.locals.assetV}`,
    canonical, s, g: view, photos: await page.photos(g.id), partner, partnerFull: full, exempt, open, closedLabel, price, priceLabel: exempt ? `Isenta (convite de ${partner.name})` : price,
    countries: audience.COUNTRIES, icon, assetV: res.locals.assetV,
  });
}));
router.get('/plateia/com/:slug/foto', wrap(async (req, res) => {
  const g = await page.bySlug(req.params.slug);
  if (!g) return res.status(404).send('Imagem não encontrada.');
  const { rows: [r] } = await db.query('SELECT photo_key FROM guests WHERE id = $1', [g.id]);
  return sendImage(res, r && r.photo_key);
}));
router.get('/plateia/com/:slug/fotos/:id', wrap(async (req, res) => {
  const g = isIntId(req.params.id) ? await page.bySlug(req.params.slug) : null;
  const { rows: [p] } = g ? await db.query('SELECT storage_key FROM guest_audience_photos WHERE id = $1 AND guest_id = $2', [req.params.id, g.id]) : { rows: [] };
  return sendImage(res, p && p.storage_key);
}));

// Fotos: do convidado (só enquanto ele está na agenda pública) e as imagens do estúdio escolhidas pela gestão.
async function sendImage(res, key) {
  const obj = key ? await b2.getObject(key).catch(() => null) : null;
  if (!obj) return res.status(404).send('Imagem não encontrada.');
  res.set({ 'Content-Type': obj.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  return res.send(Buffer.from(await obj.arrayBuffer()));
}

router.get('/plateia/foto/:id', wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return res.status(404).send('Imagem não encontrada.');
  const { rows: [g] } = await db.query("SELECT photo_key FROM guests WHERE id = $1 AND status = 'agendado' AND audience_enabled AND proposed_at > now()", [req.params.id]);
  return sendImage(res, g && g.photo_key);
}));

router.get('/plateia/imagem/:slot', wrap(async (req, res) => {
  const s = await audience.settings();
  const key = { hero: s.heroKey, estudio: s.studioKey, bastidores: s.reelsPosterKey }[req.params.slot];
  return sendImage(res, key);
}));

// Vídeo dos bastidores: link assinado do Backblaze (6 h), sem passar o arquivo pelo servidor. WebM primeiro; MP4 para quem não toca WebM.
router.get('/plateia/video/bastidores.:ext(webm|mp4)', wrap(async (req, res) => {
  const s = await audience.settings();
  const key = req.params.ext === 'webm' ? s.reelsWebmKey : s.reelsKey;
  if (!key) return res.status(404).send('Vídeo não encontrado.');
  res.set('Cache-Control', 'public, max-age=1800').redirect(302, await b2.presignGet(key, { expires: 6 * 3600, contentType: `video/${req.params.ext}` }));
}));

// Eventos da página: visualização, cliques na agenda e nos botões, abertura do formulário e abertura do WhatsApp.
router.post('/plateia/evento', wrap(async (req, res) => {
  if (isBot(req) || !await eventLimiter.hit(req.ip)) return res.status(204).end();
  const b = req.body || {};
  const guestId = isIntId(String(b.guest_id ?? '')) ? Number(b.guest_id) : null;
  const utm = audience.cleanUtm(b.utm);
  try {
    if (b.type === 'whatsapp' && typeof b.ref === 'string') {
      const { rows: [lead] } = await db.query('UPDATE plateia_leads SET whatsapp_opened_at = coalesce(whatsapp_opened_at, now()) WHERE ref = $1 RETURNING guest_id', [b.ref.slice(0, 40)]);
      if (lead) await audience.recordEvent({ type: 'whatsapp', guestId: lead.guest_id, visitorId: b.visitor_id, utm, referrer: b.referrer });
    } else if (['view', 'agenda_click', 'signup_click', 'form_open'].includes(b.type)) {
      await audience.recordEvent({ type: b.type, guestId, visitorId: b.visitor_id, utm, referrer: b.referrer });
    }
  } catch (err) {
    if (err.code !== '23503') console.error('plateia evento:', err.message); // convidado apagado no meio do caminho: ignora
  }
  res.status(204).end();
}));

router.post('/plateia/inscricao', wrap(async (req, res) => {
  const b = req.body || {};
  if (b.site) return res.json({ ok: true, ref: 'x', url: null }); // isca para robôs: parece aceitar, não grava
  if (!await leadLimiter.hit(req.ip)) return res.status(429).json({ ok: false, error: 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.' });
  const s = await audience.settings();
  if (!s.active) return res.status(403).json({ ok: false, error: 'As inscrições estão pausadas no momento.' });
  const guest = isIntId(String(b.guest_id ?? '')) ? await audience.agendaGuest(Number(b.guest_id)) : null;
  if (!guest) return res.status(404).json({ ok: false, error: 'Essa gravação não está mais na agenda. Atualize a página.' });
  if (guest.audience_status !== 'disponivel') return res.status(409).json({ ok: false, error: guest.audience_status === 'lotado' ? 'Esta gravação está lotada.' : 'As inscrições desta gravação foram encerradas.' });
  const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (name.length < 5 || !name.includes(' ')) return res.status(400).json({ ok: false, field: 'name', error: 'Informe seu nome completo.' });
  const phone = audience.validatePhone(String(b.country || ''), b.phone);
  if (phone.error) return res.status(400).json({ ok: false, field: 'phone', error: phone.error });
  if (b.terms !== true) return res.status(400).json({ ok: false, field: 'terms', error: 'Para continuar, aceite as condições da plateia.' });
  // link de parceiro: isento enquanto houver vaga dele; esgotado, o pedido segue pelo valor normal
  const { partner, full } = b.partner ? await page.partnerFor(guest.id, String(b.partner)) : { partner: null, full: false };
  const lead = await audience.createLead({
    guest, name, phone, utm: audience.cleanUtm(b.utm), referrer: b.referrer, landingUrl: b.landing, visitorId: b.visitor_id, userAgent: req.get('user-agent'),
    partner: partner && !full ? partner : null,
  });
  res.json({ ok: true, ref: lead.ref, url: lead.url, exempt: lead.exempt, price: lead.price, partnerFull: Boolean(partner && full) });
}));

module.exports = router;
