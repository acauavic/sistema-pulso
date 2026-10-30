// Lixeira: o que foi apagado fica 15 dias e pode voltar. Cada pessoa vê e restaura o que ela apagou; a gestão vê tudo e apaga de vez.
const express = require('express');
const trash = require('../services/trash');
const { audit } = require('../services/audit');
const { can } = require('../permissions');
const { wrap, isIntId } = require('../utils/wrap');

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const backTo = (req, fallback) => { const v = String(req.body.voltar || ''); return /^\/(?!\/)[\w\-/?=&#.%]*$/.test(v) ? v : fallback; };
const manager = (user) => can(user.role, 'trash.manage');
const mayRestore = (user, t) => manager(user) || String(t.deleted_by || '') === String(user.id);
// Grupos do filtro (o tipo de cada item fica no rótulo da linha).
const GROUPS = {
  conteudo: { label: 'Conteúdo', kinds: ['clip', 'cover', 'request'] },
  episodios: { label: 'Episódios', kinds: ['episode', 'episode_file'] },
  cadastros: { label: 'Convidados e patrocinadores', kinds: ['guest', 'sponsor', 'sponsor_file'] },
  outros: { label: 'Tarefas e financeiro', kinds: ['task', 'fin_entry'] },
};

router.get('/lixeira', wrap(async (req, res) => {
  const all = manager(req.user);
  const mine = !all || req.query.de === 'mim';
  const items = await trash.list({ userId: mine ? req.user.id : null });
  const group = GROUPS[req.query.tipo] ? req.query.tipo : '';
  const counts = Object.fromEntries(Object.entries(GROUPS).map(([k, g]) => [k, items.filter((i) => g.kinds.includes(i.kind)).length]));
  res.render('trash/index', {
    title: 'Lixeira', items: group ? items.filter((i) => GROUPS[group].kinds.includes(i.kind)) : items, total: items.length,
    GROUPS, counts, group, mine, all, KINDS: trash.KINDS, DAYS: trash.DAYS, daysLeft: trash.daysLeft,
    canRestore: (t) => mayRestore(req.user, t),
  });
}));

router.post('/lixeira/:id/restaurar', wrap(async (req, res) => {
  const t = isIntId(req.params.id) ? await trash.get(req.params.id) : null;
  if (!t) { await req.flash('error', 'Este item não está mais na lixeira.'); return res.redirect('/lixeira'); }
  if (!mayRestore(req.user, t)) return res.status(403).render('error', { title: 'Sem permissão', message: 'Só quem apagou (ou a gestão) restaura este item.' });
  const out = await trash.restore(t.id);
  if (out.error) { await req.flash('error', out.error); return res.redirect(backTo(req, '/lixeira')); }
  await audit(req, 'lixeira.restaurado', t.kind, t.ref_id, { titulo: t.title });
  await req.flash('ok', `${trash.KINDS[t.kind].label} restaurado: ${t.title}.`);
  res.redirect(req.body.voltar ? backTo(req, '/lixeira') : out.url);
}));

// "Desfazer" do aviso depois de apagar: devolve tudo o que saiu naquela exclusão.
router.post('/lixeira/lote/:batch/restaurar', wrap(async (req, res) => {
  if (!UUID.test(req.params.batch)) return res.redirect('/lixeira');
  const out = await trash.restoreBatch(req.params.batch, (t) => mayRestore(req.user, t));
  const back = backTo(req, '/lixeira');
  if (!out.done.length && !out.failed) { await req.flash('error', out.denied ? 'Só quem apagou (ou a gestão) desfaz esta exclusão.' : 'Nada para desfazer: os itens já saíram da lixeira.'); return res.redirect(back); }
  for (const d of out.done) await audit(req, 'lixeira.restaurado', d.kind, null, { titulo: d.title });
  if (out.failed) { await req.flash('error', `${out.done.length ? `${out.done.length} restaurado(s); ` : ''}${out.failed} não voltou: ${out.error}`); return res.redirect(back); }
  await req.flash('ok', out.done.length === 1 ? `Restaurado: ${out.done[0].title}.` : `${out.done.length} itens restaurados.`);
  res.redirect(back); // a página onde o aviso apareceu (a lista de onde o item saiu): ele volta a aparecer ali
}));

router.post('/lixeira/:id/apagar', wrap(async (req, res) => {
  if (!manager(req.user)) return res.status(403).render('error', { title: 'Sem permissão', message: 'Só a gestão apaga de vez.' });
  const t = isIntId(req.params.id) ? await trash.get(req.params.id) : null;
  if (!t) return res.redirect('/lixeira');
  await trash.purge({ id: t.id });
  await audit(req, 'lixeira.apagado', t.kind, t.ref_id, { titulo: t.title });
  await req.flash('ok', `Apagado de vez: ${t.title}.`);
  res.redirect(backTo(req, '/lixeira'));
}));

module.exports = router;
