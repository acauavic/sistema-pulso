// Páginas públicas do patrocinador, por MAGIC LINK reutilizável: o link com o token (/patrocinador/<token>[/cadastro|/portal])
// cria uma sessão (cookie HttpOnly) e redireciona para uma URL limpa (/patrocinador/kit|cadastro|portal). O token fica só na
// primeira URL; o resto usa o cookie + token CSRF. O link continua valendo até a equipe gerar outro (o que derruba as sessões).
// Cada página só abre na etapa certa do funil.
const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const sponsorsSvc = require('../services/sponsors');
const guestPhotos = require('../services/guestPhotos');
const sessions = require('../services/sponsorSessions');
const groq = require('../services/groq');
const mailer = require('../services/mailer');
const tpl = require('../services/inviteTemplate');
const pages = require('../services/publicPages');
const { createLimiter } = require('../auth/rateLimit');
const { wrap } = require('../utils/wrap');
const fmt = require('../utils/format');
const C = require('../constants');

const router = express.Router();
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const BOT_RE = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|linkedin|skype|embedly|curl|wget/i;
const isBot = (req) => BOT_RE.test(req.get('user-agent') || '');

const viewLimiter = createLimiter({ name: 'patrocinador_ver', max: 120, windowMs: 10 * 60_000 });
const writeLimiter = createLimiter({ name: 'patrocinador_escrita', max: 30, windowMs: 10 * 60_000 });
const answerLimiter = createLimiter({ name: 'patrocinador_resposta', max: 150, windowMs: 10 * 60_000 }); // uma pergunta por vez: muitas gravações pequenas
const voiceLimiter = createLimiter({ name: 'patrocinador_voz', max: 20, windowMs: 10 * 60_000 });

const VOICE_FIELDS = ['offer', 'presentation', 'key_points', 'restrictions'];
const MAX_LOGO = 5 * 1024 * 1024;
const MAX_AUDIO = 20 * 1024 * 1024;
const FORM_STAGES = ['ganho', 'ativo', 'inativo'];
const PORTAL_STAGES = ['ativo', 'inativo'];

// Cabeçalhos das páginas com script próprio nosso (formulário e portal): sem sandbox, mas só 'self' e microfone liberado.
const appHeaders = ({ scripts = true } = {}) => ({
  'Content-Security-Policy':
    `default-src 'none'; ${scripts ? "script-src 'self'; " : ''}style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; ` +
    "font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
});

const gone = (res) => res.status(404).set(tpl.publicHeaders()).type('html').send(pages.messageHtml('Link não encontrado', 'Este link não é válido ou foi substituído por um mais recente. Fale com a equipe do Pulso para receber um novo.'));
const notYet = (res, title, text) => res.status(403).set(tpl.publicHeaders()).type('html').send(pages.messageHtml(title, text));

async function sponsorByToken(token) {
  if (!TOKEN_RE.test(token)) return null;
  const { rows } = await db.query('SELECT * FROM sponsors WHERE public_token = $1', [token]);
  return rows[0] || null;
}

router.use('/patrocinador', (req, res, next) => { res.locals.fmt = fmt; next(); });

// ---- sessão ----
const needLink = (res) => res.status(401).set(tpl.publicHeaders()).type('html').send(
  pages.messageHtml('Abra pelo seu link', 'Para entrar, use o link que a equipe do Pulso enviou para você. Se ele não funcionar mais, peça um novo.'));

// Carrega a sessão do cookie. `write`: exige também o token CSRF (corpo `_csrf` ou cabeçalho x-csrf-token).
function withSession({ write = false, json = false } = {}) {
  return wrap(async (req, res, next) => {
    const session = await sessions.load(req);
    const fail = (status, message) => (json ? res.status(status).json({ ok: false, error: message }) : (status === 401 ? needLink(res) : res.status(status).send(message)));
    if (!session) return fail(401, 'Sessão expirada. Abra de novo o link que você recebeu.');
    if (write && !sessions.csrfOk(session, (req.body && req.body._csrf) || req.get('x-csrf-token'))) return fail(403, 'Requisição inválida. Recarregue a página e tente de novo.');
    req.sp = session;
    return next();
  });
}

// Entrada pelo link: cria a sessão (ou reaproveita a que já é deste patrocinador) e vai para a URL limpa.
// Robôs de pré-visualização não ganham sessão: recebem uma página simples com o nome da marca.
async function enter(req, res, page) {
  if (!await viewLimiter.hit(req.ip)) return res.status(429).send('Muitas requisições.');
  const sponsor = await sponsorByToken(req.params.token);
  if (!sponsor) return gone(res);
  if (isBot(req)) return res.set(tpl.publicHeaders()).type('html').send(pages.messageHtml(`Pulso · ${sponsor.company}`, 'Abra este link no navegador para acessar sua página do Pulso.'));
  const current = await sessions.load(req);
  if (!current || current.sponsor.id !== sponsor.id) await sessions.create(res, sponsor.id, req);
  return res.redirect(302, `/patrocinador/${page}`);
}

const entry = (page) => wrap((req, res) => enter(req, res, page));

// Avisa o responsável da equipe (melhor esforço).
async function notifyOwner(sponsor, subject, text) {
  if (!sponsor.owner_id) return;
  try {
    const { rows } = await db.query('SELECT email FROM users WHERE id = $1 AND active', [sponsor.owner_id]);
    if (rows[0]) await mailer.sendSponsorNotice({ to: rows[0].email, title: subject, text, url: `${config.appBaseUrl}/patrocinadores/${sponsor.id}` });
  } catch (err) {
    console.error('Falha ao avisar responsável:', err.message);
  }
}

// ===== páginas com sessão (URLs limpas, sem token) =====
// Entradas pelo magic link: registradas DEPOIS destas rotas fixas (ver o fim do arquivo).

// ---- media kit ----
router.get('/patrocinador/kit', withSession(), wrap(async (req, res) => {
  const sponsor = req.sp.sponsor;
  if (!sponsor.kit_viewed_at) {
    const { rowCount } = await db.query('UPDATE sponsors SET kit_viewed_at = now() WHERE id = $1 AND kit_viewed_at IS NULL', [sponsor.id]);
    if (rowCount) await sponsorsSvc.addEvent(sponsor.id, null, 'kit_visto', 'Abriu o media kit');
  }
  const html = tpl.render(tpl.mediaKitHtml(), { link_quero: '/patrocinador/quero', link_equipe: '/patrocinador/equipe', agenda_html: await sponsorsSvc.kitAgendaHtml(), guests_json: tpl.safeJson(await require('../services/kitGallery').items()), ...(await require('../services/plans').kitHtml()) });
  res.set(tpl.publicHeaders()).type('html').send(html);
}));

// "Quero ser patrocinador": conta o clique, leva a Prospecção para Em negociação e abre o WhatsApp comercial.
router.get('/patrocinador/quero', withSession(), wrap(async (req, res) => {
  const sponsor = req.sp.sponsor;
  const target = await sponsorsSvc.whatsappUrl('quero', sponsor);
  await sponsorsSvc.recordClick(sponsor.id, 'quero');
  const { rowCount } = await db.query("UPDATE sponsors SET stage = 'negociacao', updated_at = now() WHERE id = $1 AND stage = 'prospect'", [sponsor.id]);
  if (rowCount) {
    await sponsorsSvc.addEvent(sponsor.id, null, 'etapa', 'Clicou em “Quero ser patrocinador” no media kit: Prospecção → Em negociação');
    await notifyOwner(sponsor, `${sponsor.company} quer ser patrocinador`, 'Clicou em “Quero ser patrocinador” no media kit e foi levado(a) ao WhatsApp comercial.');
  } else {
    await sponsorsSvc.addEvent(sponsor.id, null, 'clique', 'Clicou de novo em “Quero ser patrocinador”');
  }
  return res.redirect(302, target);
}));

router.get('/patrocinador/equipe', withSession(), wrap(async (req, res) => {
  const sponsor = req.sp.sponsor;
  const { rows } = await db.query("SELECT 1 FROM sponsor_clicks WHERE sponsor_id = $1 AND kind = 'equipe' LIMIT 1", [sponsor.id]);
  await sponsorsSvc.recordClick(sponsor.id, 'equipe');
  if (!rows.length) await sponsorsSvc.addEvent(sponsor.id, null, 'clique', 'Clicou em “Falar com a equipe” no media kit');
  return res.redirect(302, await sponsorsSvc.whatsappUrl('equipe', sponsor));
}));

// ---- formulário de cadastro (briefing) ----
const formClosed = (res) => notYet(res, 'Formulário ainda não liberado', 'Assim que a parceria for confirmada, a equipe do Pulso libera este formulário para você.');

async function renderBrief(res, sp, extra = {}) {
  const sponsor = sp.sponsor;
  const [brief, files] = await Promise.all([
    sponsorsSvc.loadBrief(sponsor.id),
    db.query("SELECT id, kind, field, transcript FROM sponsor_files WHERE sponsor_id = $1 AND kind IN ('logo','audio') ORDER BY id DESC", [sponsor.id]),
  ]);
  const logo = files.rows.find((f) => f.kind === 'logo') || null;
  const status = sponsorsSvc.briefState(brief, { hasLogo: Boolean(logo) });
  res.set(appHeaders()).render('sponsor-public/brief', {
    title: `Cadastro — ${sponsor.company}`, sponsor, csrf: sp.csrf, brief: { ...brief, ...(extra.values || {}) }, logo, goals: C.SPONSOR_GOALS,
    questions: sponsorsSvc.BRIEF_QUESTIONS, status,
    base: '/patrocinador', voiceReady: config.groqConfigured, storageReady: config.storageConfigured,
    sent: Boolean(extra.sent), error: extra.error || null, voiceFields: VOICE_FIELDS,
  });
}

router.get('/patrocinador/cadastro', withSession(), wrap(async (req, res) => {
  if (!FORM_STAGES.includes(req.sp.sponsor.stage)) return formClosed(res);
  return renderBrief(res, req.sp, { sent: req.query.enviado === '1' });
}));

router.post('/patrocinador/cadastro', withSession({ write: true }), wrap(async (req, res) => {
  if (!await writeLimiter.hit(req.ip)) return res.status(429).send('Muitas requisições. Tente novamente em instantes.');
  const sponsor = req.sp.sponsor;
  if (!FORM_STAGES.includes(sponsor.stage)) return formClosed(res);
  const { values, error } = sponsorsSvc.parseBrief(req.body);
  if (error) return renderBrief(res.status(400), req.sp, { values: { ...values, landing_url: req.body.landing_url }, error });
  await sponsorsSvc.saveBrief(sponsor.id, values);
  // envio da página inteira (sem JavaScript): o que ficou em branco e pode ser deixado para depois vira pendência
  const st = await sponsorsSvc.briefStatus(sponsor.id);
  const toSkip = sponsorsSvc.BRIEF_QUESTIONS.filter((q) => q.skippable && st.states[q.key] === 'aberta').map((q) => q.key);
  if (toSkip.length) await db.query('UPDATE sponsor_briefs SET skipped = (SELECT array_agg(DISTINCT x) FROM unnest(skipped || $2::text[]) x) WHERE sponsor_id = $1', [sponsor.id, toSkip]);
  await closeBrief(sponsor);
  return res.redirect(303, '/patrocinador/cadastro?enviado=1');
}));

// Uma pergunta por vez: responder, pular (vira pendência) ou "não se aplica". Devolve o estado de todas as perguntas.
router.post('/patrocinador/resposta', withSession({ write: true, json: true }), wrap(async (req, res) => {
  if (!await answerLimiter.hit(req.ip)) return res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde um pouco.' });
  const sponsor = req.sp.sponsor;
  if (!FORM_STAGES.includes(sponsor.stage)) return res.status(403).json({ ok: false, error: 'Formulário ainda não liberado.' });
  const b = req.body || {};
  const result = await sponsorsSvc.applyAnswer(sponsor.id, String(b.pergunta || ''), String(b.acao || ''), b.valores && typeof b.valores === 'object' ? b.valores : {});
  if (result.error) return res.status(422).json({ ok: false, error: result.error });
  if (result.justCompleted) await sponsorsSvc.addEvent(sponsor.id, null, 'briefing', 'Respondeu todas as perguntas do formulário de cadastro');
  res.json({ ok: true, states: result.states, answered: result.answered, pending: result.pending, open: result.open, total: result.total, complete: result.complete });
}));

// Quando ele chega ao resumo: registra o que ficou pendente e avisa a equipe (uma vez por situação diferente).
async function closeBrief(sponsor) {
  const st = await sponsorsSvc.reconcileBrief(sponsor.id);
  await db.query('UPDATE sponsor_briefs SET sent_at = now() WHERE sponsor_id = $1', [sponsor.id]);
  const message = st.complete ? 'Respondeu todas as perguntas do formulário de cadastro'
    : `Fechou o formulário com ${st.answered} de ${st.total} respondidas. Faltam: ${st.unfinished.join(', ')}`;
  const { rows: [last] } = await db.query("SELECT message FROM sponsor_events WHERE sponsor_id = $1 AND type = 'briefing' ORDER BY id DESC LIMIT 1", [sponsor.id]);
  if (last?.message === message) return st;
  await sponsorsSvc.addEvent(sponsor.id, null, 'briefing', message);
  await require('../services/notify').notify({ type: 'rotina', users: [sponsor.owner_id], title: st.complete ? `${sponsor.company} respondeu o formulário` : `${sponsor.company} respondeu parte do formulário`, body: st.complete ? null : `Pendências: ${st.unfinished.join(', ')}`, url: `/patrocinadores/${sponsor.id}#briefing`, entity: { type: 'sponsor', id: sponsor.id } }).catch(() => {});
  await notifyOwner(sponsor, st.complete ? `${sponsor.company} respondeu o formulário` : `${sponsor.company} respondeu parte do formulário`,
    st.complete ? 'O patrocinador respondeu todas as perguntas do formulário de cadastro. As respostas já estão no cadastro dele.'
      : `O patrocinador respondeu ${st.answered} de ${st.total} perguntas. Pendências: ${st.unfinished.join(', ')}. Ele pode voltar ao mesmo link para responder o resto.`);
  return st;
}
router.post('/patrocinador/concluir', withSession({ write: true, json: true }), wrap(async (req, res) => {
  if (!await answerLimiter.hit(req.ip)) return res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde um pouco.' });
  const sponsor = req.sp.sponsor;
  if (!FORM_STAGES.includes(sponsor.stage)) return res.status(403).json({ ok: false, error: 'Formulário ainda não liberado.' });
  const st = await closeBrief(sponsor);
  res.json({ ok: true, answered: st.answered, pending: st.pending, open: st.open, total: st.total, complete: st.complete });
}));

// ---- logo (PNG, corpo cru) ----
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// PNG com canal alfa (cor tipo 4 ou 6) ou paleta com tRNS = tem transparência.
function pngHasAlpha(buf) {
  const colorType = buf[25];
  if (colorType === 4 || colorType === 6) return true;
  return colorType === 3 && buf.includes(Buffer.from('tRNS'));
}

router.post('/patrocinador/logo', express.raw({ type: () => true, limit: MAX_LOGO }), withSession({ write: true, json: true }), wrap(async (req, res) => {
  if (!await writeLimiter.hit(req.ip)) return res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde um pouco.' });
  const sponsor = req.sp.sponsor;
  if (!FORM_STAGES.includes(sponsor.stage)) return res.status(403).json({ ok: false, error: 'Formulário ainda não liberado.' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 100) return res.status(400).json({ ok: false, error: 'Arquivo vazio.' });
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return res.status(400).json({ ok: false, error: 'Envie a logo em PNG (de preferência sem fundo).' });
  const file = await sponsorsSvc.storeFile({
    sponsorId: sponsor.id, kind: 'logo', buffer: buf, filename: fmt.clean(req.query.nome, 150) || 'logo.png', contentType: 'image/png', fromSponsor: true, replace: true,
  });
  await db.query('UPDATE sponsors SET updated_at = now() WHERE id = $1', [sponsor.id]);
  await sponsorsSvc.addEvent(sponsor.id, null, 'arquivo', 'Enviou a logo da marca');
  await sponsorsSvc.reconcileBrief(sponsor.id); // a logo tira a pergunta das pendências
  res.json({ ok: true, id: file.id, url: `/patrocinador/arquivo/${file.id}`, hasAlpha: pngHasAlpha(buf) });
}));

// ---- voz: grava, guarda o áudio e devolve a transcrição para a pessoa revisar ----
router.post('/patrocinador/audio', express.raw({ type: () => true, limit: MAX_AUDIO }), withSession({ write: true, json: true }), wrap(async (req, res) => {
  if (!await voiceLimiter.hit(req.ip)) return res.status(429).json({ ok: false, error: 'Muitas gravações seguidas. Aguarde um pouco ou digite a resposta.' });
  const sponsor = req.sp.sponsor;
  if (!FORM_STAGES.includes(sponsor.stage)) return res.status(403).json({ ok: false, error: 'Formulário ainda não liberado.' });
  const field = String(req.query.campo || '');
  if (!VOICE_FIELDS.includes(field)) return res.status(400).json({ ok: false, error: 'Campo inválido.' });
  const type = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!type.startsWith('audio/') && type !== 'video/webm') return res.status(400).json({ ok: false, error: 'Formato de áudio não aceito.' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 500) return res.status(400).json({ ok: false, error: 'A gravação ficou vazia. Tente de novo.' });
  const file = await sponsorsSvc.storeFile({ sponsorId: sponsor.id, kind: 'audio', field, buffer: buf, filename: `${field}.${type.split('/')[1] || 'webm'}`, contentType: type, fromSponsor: true });
  let text;
  try {
    text = await groq.transcribe(buf, { filename: file.filename, contentType: type });
  } catch (err) {
    console.error('Falha na transcrição:', err.message);
    return res.status(502).json({ ok: false, id: file.id, error: 'Guardamos o áudio, mas não conseguimos transcrever agora. Digite a resposta ou tente gravar de novo.' });
  }
  await db.query('UPDATE sponsor_files SET transcript = $2 WHERE id = $1', [file.id, text]);
  await sponsorsSvc.addEvent(sponsor.id, null, 'audio', `Gravou uma resposta por voz (${field})`);
  res.json({ ok: true, id: file.id, text });
}));

// ---- foto do convidado no media kit e no portal: endereço assinado e com validade (o kit roda isolado, sem cookie) ----
router.get('/agenda/foto/:id', wrap(async (req, res) => {
  if (!guestPhotos.verify(req.params.id, req.query.e, req.query.s)) return res.status(404).type('text').send('Foto não encontrada.');
  if (!await guestPhotos.send(res, Number(req.params.id))) return res.status(404).type('text').send('Foto não encontrada.');
}));

// ---- arquivos que o próprio patrocinador pode ver (logo, moldura, QR Code) ----
router.get('/patrocinador/arquivo/:fid', withSession(), wrap(async (req, res) => {
  if (!/^\d{1,9}$/.test(req.params.fid)) return gone(res);
  const { rows: [file] } = await db.query("SELECT * FROM sponsor_files WHERE id = $1 AND sponsor_id = $2 AND kind IN ('logo','moldura','qrcode')", [req.params.fid, req.sp.sponsor.id]);
  if (!file) return gone(res);
  return sponsorsSvc.sendFile(res, file);
}));

// ---- portal do patrocinador ativo ----
router.get('/patrocinador/portal', withSession(), wrap(async (req, res) => {
  const sponsor = req.sp.sponsor;
  if (!PORTAL_STAGES.includes(sponsor.stage)) return notYet(res, 'Portal ainda não disponível', 'O portal do patrocinador abre assim que a parceria estiver ativa. Fale com a equipe do Pulso se tiver dúvidas.');
  const data = await sponsorsSvc.portalData(sponsor);
  res.set(appHeaders({ scripts: false })).render('sponsor-public/portal', {
    title: `Portal ${sponsor.company}`, sponsor, ...data, C, base: '/patrocinador', photoUrl: guestPhotos.signedUrl,
  });
}));

// ===== entradas pelo magic link (token na URL) =====
router.get('/patrocinador/:token', entry('kit'));
router.get('/patrocinador/:token/cadastro', entry('cadastro'));
router.get('/patrocinador/:token/portal', entry('portal'));

module.exports = router;
