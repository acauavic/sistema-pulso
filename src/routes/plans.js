// Gestão > Planos de patrocínio: nome, preço, textos e entregáveis do Ouro e do Diamond. O que muda aqui muda no media kit,
// no portal do patrocinador e nos entregáveis de cada patrocinador da cota (os personalizados e as sobrescritas ficam).
const express = require('express');
const db = require('../db/pool');
const C = require('../constants');
const plansSvc = require('../services/plans');
const { audit } = require('../services/audit');
const { requirePerm } = require('../middleware');
const { clean, parseBRL } = require('../utils/format');
const { wrap, isIntId } = require('../utils/wrap');

const router = express.Router();
const back = (key) => `/gestao/patrocinios${key ? `#${key}` : ''}`;
const text = (v, n) => String(v ?? '').replace(/\r/g, '').trim().slice(0, n) || null;

router.get('/gestao/patrocinios', requirePerm('plans.manage'), wrap(async (req, res) => {
  const [plans, usage] = await Promise.all([plansSvc.plans(), plansSvc.usage()]);
  res.render('gestao/plans', { title: 'Planos de patrocínio', blockInsertion: await require('../services/settings').blockInsertion(), plans, usage, kinds: C.DELIVERABLE_KINDS, money: plansSvc.money });
}));

router.post('/gestao/patrocinios/regras', requirePerm('plans.manage'), wrap(async (req, res) => {
  const on = req.body.block_insertion === '1';
  await require('../services/settings').set('block_insertion_in_exclusive', on);
  await audit(req, 'patrocinio.regra_exclusivo', 'settings', null, { ligada: on });
  await req.flash('ok', on ? 'Episódio exclusivo de um patrocinador não recebe inserção de outro.' : 'Episódio exclusivo agora aceita inserção de outros patrocinadores.');
  res.redirect(back());
}));

router.post('/gestao/patrocinios/:key', requirePerm('plans.manage'), wrap(async (req, res) => {
  const key = req.params.key;
  if (!plansSvc.KEYS.includes(key)) return res.redirect(back());
  const price = parseBRL(req.body.price);
  const name = clean(req.body.name, 40);
  if (name.length < 2) { await req.flash('error', 'Dê um nome ao plano.'); return res.redirect(back(key)); }
  if (price == null || Number.isNaN(price)) { await req.flash('error', 'Valor inválido. Use algo como 6.000,00.'); return res.redirect(back(key)); }
  const includes = key === 'diamond' && req.body.includes === '1' ? 'ouro' : null;
  await db.query(
    `UPDATE sponsor_plans SET name=$2, price_cents=$3, episodes_label=$4, tag=$5, headline=$6, lede=$7, includes=$8, choice_label=$9, note=$10, updated_at=now() WHERE key=$1`,
    [key, name, price, text(req.body.episodes_label, 80), text(req.body.tag, 120), text(req.body.headline, 160), text(req.body.lede, 400), includes, text(req.body.choice_label, 160), text(req.body.note, 400)]);
  await plansSvc.syncNames({ force: true });
  const n = await plansSvc.resyncPlan(key);
  await audit(req, 'plano.editado', 'sponsor_plan', key, { name });
  await req.flash('ok', `Plano ${name} salvo. Vale no media kit e no portal${n ? ` (${n} patrocinador${n > 1 ? 'es' : ''} atualizado${n > 1 ? 's' : ''})` : ''}.`);
  res.redirect(back(key));
}));

function parseItem(body) {
  const qty = Number.parseInt(body.quantity, 10);
  return {
    title: clean(body.title, 120), description: text(body.description, 500),
    kind: Object.prototype.hasOwnProperty.call(C.DELIVERABLE_KINDS, body.kind) ? body.kind : null,
    quantity: Number.isInteger(qty) && qty > 0 && qty < 1000 ? qty : null,
  };
}

router.post('/gestao/patrocinios/:key/itens', requirePerm('plans.manage'), wrap(async (req, res) => {
  const key = req.params.key;
  if (!plansSvc.KEYS.includes(key)) return res.redirect(back());
  const it = parseItem(req.body);
  const section = req.body.section === 'escolha' ? 'escolha' : 'entrega';
  if (it.title.length < 2) { await req.flash('error', 'Dê um nome ao entregável.'); return res.redirect(back(key)); }
  await db.query('INSERT INTO plan_items (plan_key, section, position, title, description, kind, quantity) VALUES ($1,$2,(SELECT coalesce(max(position),0)+1 FROM plan_items WHERE plan_key=$1 AND section=$2),$3,$4,$5,$6)',
    [key, section, it.title, it.description, it.kind, it.quantity]);
  const n = section === 'entrega' ? await plansSvc.resyncPlan(key) : 0;
  await audit(req, 'plano.item_criado', 'sponsor_plan', key, { title: it.title });
  await req.flash('ok', `Adicionado ao plano${n ? `; ${n} patrocinador${n > 1 ? 'es' : ''} da cota já receberam` : ''}.`);
  res.redirect(back(key));
}));

async function findItem(id) {
  if (!isIntId(id)) return null;
  return (await db.query('SELECT * FROM plan_items WHERE id = $1', [id])).rows[0] || null;
}

router.post('/gestao/patrocinios/itens/:id', requirePerm('plans.manage'), wrap(async (req, res) => {
  const item = await findItem(req.params.id);
  if (!item) return res.redirect(back());
  const it = parseItem(req.body);
  if (it.title.length < 2) { await req.flash('error', 'Dê um nome ao entregável.'); return res.redirect(back(item.plan_key)); }
  await db.query('UPDATE plan_items SET title=$2, description=$3, kind=$4, quantity=$5 WHERE id=$1', [item.id, it.title, it.description, it.kind, it.quantity]);
  // o tipo (moldura, QR Code…) também vai para quem já tem o entregável
  await db.query('UPDATE sponsor_deliverables SET kind = $2 WHERE plan_item_id = $1', [item.id, it.kind]);
  await audit(req, 'plano.item_editado', 'sponsor_plan', item.plan_key, { title: it.title });
  await req.flash('ok', 'Entregável salvo. Quem não personalizou já vê a mudança.');
  res.redirect(back(item.plan_key));
}));

router.post('/gestao/patrocinios/itens/:id/mover', requirePerm('plans.manage'), wrap(async (req, res) => {
  const item = await findItem(req.params.id);
  if (!item) return res.redirect(back());
  const { rows } = await db.query('SELECT id FROM plan_items WHERE plan_key=$1 AND section=$2 ORDER BY position, id', [item.plan_key, item.section]);
  const ids = rows.map((r) => r.id);
  const i = ids.indexOf(item.id); const j = i + (req.body.dir === 'up' ? -1 : 1);
  if (j >= 0 && j < ids.length) { [ids[i], ids[j]] = [ids[j], ids[i]]; for (const [n, id] of ids.entries()) await db.query('UPDATE plan_items SET position = $2 WHERE id = $1', [id, n + 1]); }
  res.redirect(back(item.plan_key));
}));

router.post('/gestao/patrocinios/itens/:id/excluir', requirePerm('plans.manage'), wrap(async (req, res) => {
  const item = await findItem(req.params.id);
  if (!item) return res.redirect(back());
  const { rows: [{ n }] } = await db.query('SELECT count(*)::int AS n FROM sponsor_deliverables WHERE plan_item_id = $1', [item.id]);
  await db.query('DELETE FROM plan_items WHERE id = $1', [item.id]);
  await audit(req, 'plano.item_excluido', 'sponsor_plan', item.plan_key, { title: item.title, patrocinadores: n });
  await req.flash('ok', `Entregável retirado do plano${n ? ` e de ${n} patrocinador${n > 1 ? 'es' : ''}` : ''}.`);
  res.redirect(back(item.plan_key));
}));

module.exports = router;
