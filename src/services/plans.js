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

// Slides 10 (Ouro), 11 (Diamond) e 14 (comparativo) do media kit, gerados do que está cadastrado.
async function kitHtml() {
  const all = await plans();
  const out = { slide_ouro_html: '', slide_diamond_html: '', compare_html: '' };
  const [first, second] = all;
  const slide = (p, n, dark) => {
    const own = p.items;
    const inherited = p.includes ? all.find((x) => x.key === p.includes) : null;
    const cls = dark ? ' diamond-inherit' : '';
    return `
      <div class="eyebrow"${dark ? ' style="color:var(--lime); margin-bottom:18px;"' : ''}><span class="num">${n}</span> Patrocínio ${esc(p.name)}</div>
      <div class="plan-badge"><span class="plan-badge-name">Plano ${esc(p.name)}</span>${p.tag ? `<span class="plan-badge-tag">${esc(p.tag)}</span>` : ''}</div>
      <div class="plan-head">
        <div>
          <h2 class="slide-title" style="margin-bottom:8px;">${esc(p.headline || '')}</h2>
          ${p.lede ? `<p class="slide-lede" style="margin-bottom:0;">${esc(p.lede)}</p>` : ''}
        </div>
        <div class="plan-price"${dark ? ' style="font-size:clamp(24px,3.2vw,38px);"' : ''}>${money(p.price_cents)}<span class="unit">investimento</span></div>
      </div>
      <div class="deliver-list">
        ${inherited ? deliver({ title: `Tudo do plano ${inherited.name}`, description: `Todos os entregáveis do ${inherited.name}, inclusos.` }, cls) : ''}
        ${own.map((i) => deliver(i, cls)).join('\n        ')}
      </div>
      ${p.choices.length ? `<div class="choice-label"><span class="choice-badge">Escolha 1 de ${p.choices.length}</span> ${esc(p.choice_label || '')}</div>
      <div class="choice-grid">${p.choices.map((i) => `<div class="choice-item"><h4>${esc(i.title)}</h4>${i.description ? `<p>${esc(i.description)}</p>` : ''}</div>`).join('')}</div>` : ''}
      ${p.note ? `<div class="note-box">${esc(p.note)}</div>` : ''}`;
  };
  if (first) out.slide_ouro_html = slide(first, 10, false);
  if (second) out.slide_diamond_html = slide(second, 11, true);
  if (first && second) {
    const rows = [];
    rows.push(`<tr><td class="feat">Episódios patrocinados</td><td>${esc(first.episodes_label || '—')}</td><td>${esc(second.episodes_label || '—')}</td></tr>`);
    const seen = new Set();
    for (const p of [first, second]) {
      for (const i of effectiveItems(all, p.key).filter((x) => x.fromPlan === p.key)) {
        const k = i.title.toLowerCase(); if (seen.has(k)) continue; seen.add(k);
        const inFirst = chain(all, first.key).some((c) => c.items.some((x) => x.id === i.id));
        rows.push(`<tr><td class="feat">${esc(i.title)}</td><td${inFirst ? ' class="yes">✓' : '>—'}</td><td class="yes">✓</td></tr>`);
      }
    }
    if (second.choices.length) rows.push(`<tr><td class="feat">${esc(second.choice_label || 'Participação da marca no episódio especial')}</td><td>—</td><td class="yes">✓</td></tr>`);
    rows.push(`<tr><td class="feat">Investimento</td><td>${money(first.price_cents)}</td><td>${money(second.price_cents)}</td></tr>`);
    out.compare_html = `<table class="compare"><thead><tr><th>Entrega</th><th class="plan-col">${esc(first.name)}</th><th class="plan-col">${esc(second.name)}</th></tr></thead><tbody>${rows.join('\n            ')}</tbody></table>`;
  }
  return out;
}

module.exports = { KEYS, plans, syncNames, middleware, effectiveItems, chain, applyToSponsor, resyncPlan, usage, deliverablesOf, kitHtml, money, fmt };
