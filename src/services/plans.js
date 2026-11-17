// Planos de patrocínio (Ouro e Diamond): fonte única do nome, do preço e dos entregáveis. Quem lê daqui: media kit, portal do
// patrocinador, página do patrocinador e assistente. Cada patrocinador herda os entregáveis do plano (sponsor_deliverables.plan_item_id)
// e pode sobrescrever título, descrição e quantidade, ou ter entregáveis só dele.
const db = require('../db/pool');
const C = require('../constants');
const { esc } = require('./inviteTemplate');
const fmt = require('../utils/format');

const KEYS = ['ouro', 'diamond'];

async function plans() {
  const [{ rows: ps }, { rows: items }] = await Promise.all([
    db.query('SELECT * FROM sponsor_plans ORDER BY position'),
    db.query('SELECT * FROM plan_items ORDER BY plan_key, section, position, id'),
  ]);
  return ps.map((p) => ({ ...p, items: items.filter((i) => i.plan_key === p.key && i.section === 'entrega'), choices: items.filter((i) => i.plan_key === p.key && i.section === 'escolha') }));
}

// O nome do plano aparece em muitas telas pelo mapa C.SPONSOR_TIERS: mantemos o mapa igual ao banco (conferido a cada 30 s em cada réplica).
let checkedAt = 0;
async function syncNames({ force = false } = {}) {
  if (!force && Date.now() - checkedAt < 30_000) return;
  checkedAt = Date.now();
  const { rows } = await db.query('SELECT key, name FROM sponsor_plans');
  for (const r of rows) C.SPONSOR_TIERS[r.key] = r.name;
}
const middleware = (req, res, next) => { syncNames().then(() => next(), () => next()); };

// Itens que o plano entrega (os do próprio plano; Diamond soma os do Ouro).
function chain(all, key) {
  const out = []; const seen = new Set();
  for (let p = all.find((x) => x.key === key); p && !seen.has(p.key); p = all.find((x) => x.key === p.includes)) { seen.add(p.key); out.unshift(p); }
  return out;
}
const effectiveItems = (all, key) => chain(all, key).flatMap((p) => p.items.map((i) => ({ ...i, fromPlan: p.key })));

// Deixa os entregáveis do patrocinador iguais ao plano da cota: acrescenta o que falta, tira o que o plano não tem mais.
// Entregáveis personalizados (sem plan_item_id) não são mexidos.
async function applyToSponsor(sponsorId) {
  const { rows: [s] } = await db.query('SELECT id, tier FROM sponsors WHERE id = $1', [sponsorId]);
  if (!s) return { added: 0, removed: 0 };
  const all = await plans();
  const want = s.tier ? effectiveItems(all, s.tier) : [];
  const { rows: have } = await db.query('SELECT id, plan_item_id FROM sponsor_deliverables WHERE sponsor_id = $1 AND plan_item_id IS NOT NULL', [s.id]);
  const wantIds = new Set(want.map((i) => i.id));
  let removed = 0; let added = 0;
  for (const d of have.filter((x) => !wantIds.has(x.plan_item_id))) { await db.query('DELETE FROM sponsor_deliverables WHERE id = $1', [d.id]); removed += 1; }
  const haveIds = new Set(have.map((x) => x.plan_item_id));
  for (const i of want.filter((x) => !haveIds.has(x.id))) {
    const { rows: [file] } = ['moldura', 'qr_code'].includes(i.kind)
      ? await db.query('SELECT id FROM sponsor_files WHERE sponsor_id = $1 AND kind = $2 ORDER BY id DESC LIMIT 1', [s.id, i.kind === 'qr_code' ? 'qrcode' : 'moldura']) : { rows: [] };
    await db.query("INSERT INTO sponsor_deliverables (sponsor_id, kind, plan_item_id, status, file_id) VALUES ($1,$2,$3,'pendente',$4) ON CONFLICT DO NOTHING", [s.id, i.kind, i.id, file?.id || null]);
    added += 1;
  }
  return { added, removed };
}

// Mudou o plano: todos os patrocinadores dessa cota (e das que a incluem) acompanham.
async function resyncPlan(key) {
  const all = await plans();
  const keys = all.filter((p) => chain(all, p.key).some((c) => c.key === key)).map((p) => p.key);
  const { rows } = await db.query('SELECT id FROM sponsors WHERE tier = ANY($1)', [keys]);
  for (const s of rows) await applyToSponsor(s.id);
  return rows.length;
}

const usage = async () => Object.fromEntries((await db.query('SELECT tier, count(*)::int AS n FROM sponsors WHERE tier IS NOT NULL GROUP BY tier')).rows.map((r) => [r.tier, r.n]));

// Entregáveis do patrocinador já com o que vale (plano ou personalização).
async function deliverablesOf(sponsorId) {
  const { rows } = await db.query(
    `SELECT d.*, pi.title AS plan_title, pi.description AS plan_description, pi.quantity AS plan_quantity, pi.kind AS plan_kind
       FROM sponsor_deliverables d LEFT JOIN plan_items pi ON pi.id = d.plan_item_id LEFT JOIN sponsor_plans pl ON pl.key = pi.plan_key
      WHERE d.sponsor_id = $1 ORDER BY (d.plan_item_id IS NULL), pl.position, pi.position, d.id`, [sponsorId]);
  return rows.map((d) => ({
    ...d,
    label: d.title || d.plan_title || C.DELIVERABLE_KINDS[d.kind] || 'Entregável',
    text: d.description || d.plan_description || null,
    qty: d.quantity ?? d.plan_quantity ?? null,
    fromPlan: Boolean(d.plan_item_id),
    customized: Boolean(d.plan_item_id && (d.title || d.description || d.quantity)),
  }));
}

// ---------------------------------------------------------------- media kit
const money = (cents) => `R$ ${new Intl.NumberFormat('pt-BR').format(Math.round(cents / 100))}`;
const deliver = (i, cls = '') => `<div class="deliver-item${cls}"><h4>${esc(i.title)}</h4>${i.description ? `<p>${esc(i.description)}</p>` : ''}</div>`;

// Benefício que não é entregável de plano: cadeiras na plateia para a marca presentear.
const EXTRA_ITEMS = [{ title: 'Cadeiras na plateia', description: 'Até 5 cadeiras nas gravações com plateia, para presentear parceiros ou a própria equipe.' }];

// Slide "O que a sua marca pode ter" do media kit: tudo o que os planos entregam, sem nome de plano nem preço (o formato e o
// investimento saem da conversa). Os itens vêm do cadastro dos planos (Gestão > Planos), sem repetir.
async function kitHtml() {
  const all = await plans();
  const seen = new Set();
  const items = [];
  for (const i of [...all.flatMap((p) => p.items), ...EXTRA_ITEMS]) {
    const k = String(i.title).toLowerCase();
    if (!seen.has(k)) { seen.add(k); items.push(i); }
  }
  const choices = [];
  for (const i of all.flatMap((p) => p.choices)) if (!choices.some((c) => c.title === i.title)) choices.push(i);
  const oferta_html = `
      <div class="eyebrow"><span class="num">11</span> O que a sua marca pode ter</div>
      <h2 class="slide-title" style="margin-bottom:10px;">Presença sob medida, desenhada com você.</h2>
      <p class="slide-lede">Não trabalhamos com pacote fechado. Na conversa, entendemos o objetivo da marca e montamos juntos a combinação que faz sentido.</p>
      <div class="deliver-list">
        ${items.map((i) => deliver(i)).join('\n        ')}
      </div>
      ${choices.length ? `<p class="offer-special"><span class="choice-badge">Episódio especial</span> a marca pode ${choices.map((i) => `<span>${esc(String(i.title).charAt(0).toLowerCase() + String(i.title).slice(1))}</span>`).join('<span class="sep">·</span>')}</p>` : ''}
      <div class="offer-cta"><a class="btn lime-fill" href="/patrocinador/quero" target="_blank" rel="noopener">Agendar uma conversa →</a><span class="mono">O formato e o investimento saem da conversa.</span></div>`;
  return { oferta_html };
}

module.exports = { KEYS, plans, syncNames, middleware, effectiveItems, chain, applyToSponsor, resyncPlan, usage, deliverablesOf, kitHtml, money, fmt };
