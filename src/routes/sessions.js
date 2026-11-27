// Sessão de gravação (/sessoes): marcar a ida ao estúdio, escolher os vídeos, no dia marcar cada um como gravado, encerrar com
// a duração real e distribuir o material que o estúdio mandou pelo link da sessão.
const express = require('express');
const db = require('../db/pool');
const { requirePerm } = require('../middleware');
const { can } = require('../permissions');
const { wrap, isIntId } = require('../utils/wrap');
const { audit } = require('../services/audit');
const scope = require('../services/scope');
const S = require('../services/sessions');

const router = express.Router();
const notFound = (res) => res.status(404).render('error', { title: 'Não encontrado', message: 'Sessão não encontrada.' });
const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

async function load(req) {
  if (!isIntId(req.params.id)) return null;
  const s = await S.get(req.params.id);
  if (!s) return null;
  scope.assert(req, s.project_id);
  return s;
}
const home = (s, hash = '') => `/sessoes/${s.id}${hash}`;

router.get('/sessoes', requirePerm('episodes.read'), wrap(async (req, res) => {
  const rows = await S.list({ pids: scope.idsOf(req) });
  const now = Date.now();
  res.render('sessions/index', {
    title: 'Sessões de gravação', S,
    upcoming: rows.filter((r) => r.status === 'planejada'),
    past: rows.filter((r) => r.status !== 'planejada'),
    now, createProjects: req.scope.current ? [req.scope.current] : req.scope.projects.filter((p) => require('../services/projects').has(p, 'producao')),
  });
}));

router.post('/sessoes', requirePerm('production.manage'), wrap(async (req, res) => {
  const projectId = scope.target(req, req.body);
  if (!projectId) { await req.flash('error', 'Escolha o projeto da sessão.'); return res.redirect('/sessoes'); }
  const out = await S.create({ projectId, body: req.body, user: req.user });
  if (out.error) { await req.flash('error', out.error); return res.redirect('/sessoes?abrir=nova'); }
  await audit(req, 'sessao.criada', 'session', out.session.id, { projeto: projectId });
  await req.flash('ok', 'Sessão marcada. Agora escolha os vídeos que vão ser gravados.');
  return res.redirect(home(out.session, '?abrir=videos'));
}));

router.get('/sessoes/:id', requirePerm('episodes.read'), wrap(async (req, res) => {
  const s = await load(req);
  if (!s) return notFound(res);
  const manage = can(req.user, 'production.manage');
  const [videos, candidates, conflicts, link, pending] = await Promise.all([
    S.videos(s.id),
    manage && s.status === 'planejada' ? S.candidates(s) : [],
    s.status === 'planejada' ? S.conflicts({ startsAt: s.starts_at, minutes: s.planned_minutes, excludeId: s.id }) : [],
    S.currentLink(s.id),
    S.pendingFiles(s.id),
  ]);
  // só mostra o conflito que a pessoa pode ver (de outro projeto, diz só que o estúdio está ocupado)
  const visibleConflicts = conflicts.map((c) => (scope.canSee(req, c.projectId) ? c : { ...c, label: 'Estúdio ocupado por outro projeto', url: null }));
  res.render('sessions/show', {
    title: `Sessão de ${new Date(s.starts_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, s, S, videos, candidates, conflicts: visibleConflicts,
    link: link && require('../services/studioLinks').isOpen(link) ? { ...link, url: require('../services/studioLinks').urlOf(link, s.project_id) } : null,
    pending, manage, abrir: String(req.query.abrir || ''),
  });
}));

const act = (path, fn, { perm = 'production.manage', hash = '' } = {}) => router.post(`/sessoes/:id${path}`, requirePerm(perm), wrap(async (req, res) => {
  const s = await load(req);
  if (!s) return notFound(res);
  const msg = await fn(req, s);
  if (msg && msg.error) await req.flash('error', msg.error);
  else if (msg && msg.ok) await req.flash('ok', msg.ok);
  return res.redirect(home(s, (msg && msg.hash) || hash));
}));

act('', async (req, s) => {
  const out = await S.update(s, req.body);
  if (out.error) return out;
  await audit(req, 'sessao.editada', 'session', s.id, {});
  return { ok: 'Sessão atualizada.' };
});

act('/videos', async (req, s) => {
  const out = await S.setVideos(s, list(req.body.video), req.user);
  if (out.error) return out;
  await audit(req, 'sessao.videos', 'session', s.id, { videos: out.count });
  return { ok: `${out.count} vídeo${out.count === 1 ? '' : 's'} na sessão.` };
});

act('/videos/:eid/gravado', async (req, s) => {
  const out = await S.markRecorded(s, Number(req.params.eid), req.user);
  if (out.error) return { ...out, hash: `#v-${req.params.eid}` };
  return { hash: `#v-${req.params.eid}` };
});

act('/videos/:eid/nota', async (req, s) => { await S.setNote(s, Number(req.params.eid), req.body.note); return { hash: `#v-${req.params.eid}` }; });
act('/videos/:eid/mover', async (req, s) => { await S.moveVideo(s, Number(req.params.eid), req.body.dir === 'up' ? 'up' : 'down'); return { hash: `#v-${req.params.eid}` }; });
act('/videos/:eid/tirar', async (req, s) => {
  const keep = (await S.videos(s.id)).filter((v) => v.id !== Number(req.params.eid)).map((v) => v.id);
  const out = await S.setVideos(s, keep, req.user);
  return out.error ? out : { ok: 'O vídeo saiu da sessão e continua na pré-produção.' };
});

act('/encerrar', async (req, s) => {
  const minutes = Math.round((Number(String(req.body.horas || '0').replace(',', '.')) || 0) * 60 + (Number(req.body.minutos) || 0));
  const out = await S.close(s, minutes, req.user);
  if (out.error) return out;
  await audit(req, 'sessao.encerrada', 'session', s.id, { minutos: minutes, gravados: out.recorded });
  return { ok: `Sessão encerrada: ${S.fmtMinutes(minutes)} para ${out.recorded} vídeo${out.recorded === 1 ? '' : 's'}. O link do estúdio está pronto.` };
});

act('/duracao', async (req, s) => {
  const minutes = Math.round((Number(String(req.body.horas || '0').replace(',', '.')) || 0) * 60 + (Number(req.body.minutos) || 0));
  const out = await S.setActual(s, minutes);
  if (out.error) return out;
  await audit(req, 'sessao.duracao', 'session', s.id, { minutos: minutes });
  return { ok: 'Duração corrigida: o estúdio de cada vídeo foi refeito.' };
});

act('/cancelar', async (req, s) => {
  const out = await S.cancel(s, req.user);
  if (out.error) return out;
  await audit(req, 'sessao.cancelada', 'session', s.id, {});
  return { ok: 'Sessão cancelada. Os vídeos continuam na pré-produção.' };
});

act('/link', async (req, s) => {
  const l = await S.studioLink(s, req.user);
  return l ? { ok: 'Link do estúdio pronto.', hash: '#material' } : { error: 'Marque ao menos um vídeo como gravado antes.' };
});

act('/arquivos', async (req, s) => {
  const choices = {};
  for (const [k, v] of Object.entries(req.body)) { const m = k.match(/^arquivo_(\d+)$/); if (m && isIntId(v)) choices[m[1]] = v; }
  const out = await S.distribute(s, choices, req.user);
  return { ok: out.moved ? `${out.moved} arquivo${out.moved === 1 ? '' : 's'} no vídeo certo.` : 'Nada para distribuir.', hash: '#material' };
});

module.exports = router;
