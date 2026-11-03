// Cadência de abordagem: registrar o contato (por canal e endereço), apagar um registro errado e o painel da gestão.
const express = require('express');
const db = require('../db/pool');
const outreach = require('../services/outreach');
const { audit } = require('../services/audit');
const { requirePerm } = require('../middleware');
const { can } = require('../permissions');
const { wrap, isIntId } = require('../utils/wrap');
const { formatDateTime } = require('../utils/format');

const router = express.Router();
const PERM = { guest: 'guests.write', sponsor: 'sponsors.write' };

const shortDay = (iso) => iso.split('-').reverse().slice(0, 2).join('/');

function registerRoute(kind) {
  const k = outreach.KINDS[kind];
  router.post(`${k.base}/:id/abordagens`, requirePerm(PERM[kind]), wrap(async (req, res) => {
    const back = `${k.base}/${req.params.id}#abordagens`;
    if (!isIntId(req.params.id)) return res.redirect(k.base);
    const { rows: [subject] } = await db.query(`SELECT * FROM ${k.table} WHERE id = $1`, [req.params.id]);
    if (!subject) return res.redirect(k.base);
    // o endereço vem do select do canal escolhido (addr_<canal>) e, se for "outro", do campo novo_<canal>
    const body = { ...req.body, addr: req.body[`addr_${req.body.canal}`], novo: req.body[`novo_${req.body.canal}`] };
    const r = await outreach.register(kind, subject.id, body, req.user.id);
    if (r.error) { await req.flash('error', r.error); return res.redirect(back); }
    await audit(req, 'abordagem.registrada', kind, subject.id, { canal: r.attempt.channel, resultado: r.attempt.result });
    const ev = (await outreach.evaluateAll(kind, { ids: [subject.id] })).get(subject.id);
    let msg = 'Abordagem registrada.';
    if (r.attempt.result === 'respondeu') msg = `Resposta registrada. A cadência parou: agora é ${kind === 'guest' ? 'marcar que aceitou o convite ou combinar os próximos passos' : 'seguir a conversa e, se houver interesse, mover para Em negociação'}.`;
    else if (ev && ev.state === 'possivel_perdido') msg = 'Abordagem registrada. Já foram todas as tentativas da cadência: se não houve resposta, vale marcar como perdido.';
    else if (ev && ev.due) msg = `Abordagem registrada. Próximo follow-up: ${shortDay(ev.due)}.`;
    await req.flash('ok', msg);
    return res.redirect(back);
  }));
}
registerRoute('guest');
registerRoute('sponsor');

router.post('/abordagens/:id/excluir', wrap(async (req, res) => {
  if (!isIntId(req.params.id)) return res.redirect('/');
  const { rows: [a] } = await db.query('SELECT * FROM outreach_attempts WHERE id = $1', [req.params.id]);
  if (!a) return res.redirect('/');
  if (!can(req.user.role, PERM[a.subject_type])) return res.status(403).render('error', { title: 'Sem permissão', message: 'Seu perfil não tem acesso a esta área.' });
  await outreach.remove(a.id);
  await audit(req, 'abordagem.excluida', a.subject_type, a.subject_id, { canal: a.channel, resultado: a.result, em: formatDateTime(a.at) });
  await req.flash('ok', 'Registro apagado.');
  res.redirect(`${outreach.KINDS[a.subject_type].base}/${a.subject_id}#abordagens`);
}));

// ---------------------------------------------------------------- painel da gestão
router.get('/gestao/cadencia', requirePerm('outreach.manage'), wrap(async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.dias)) ? Number(req.query.dias) : 30;
  const r = await outreach.report(days);
  const goalOf = await outreach.goals(r.users);
  const { rows: own } = await db.query('SELECT user_id, daily_target FROM outreach_goals');
  res.render('gestao/cadencia', { title: 'Cadência', r, days, CHANNELS: outreach.CHANNELS, goalOf, ownGoal: new Map(own.map((o) => [o.user_id, o.daily_target])), shortDay, base: (k) => outreach.KINDS[k].base });
}));

router.post('/gestao/cadencia/config', requirePerm('outreach.manage'), wrap(async (req, res) => {
  const { rows: users } = await db.query("SELECT id, name, role FROM users WHERE active AND role IN ('superadmin','gestao','produtora')");
  const next = await outreach.saveConfig(req.body, users);
  await audit(req, 'cadencia.configurada', 'system', null, { convidados: next.guest, patrocinadores: next.sponsor, meta_padrao: next.sponsorGoal });
  await req.flash('ok', 'Cadência e metas salvas.');
  res.redirect('/gestao/cadencia');
}));

module.exports = router;
