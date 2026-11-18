// Ordem de edição: o que o editor edita primeiro. Entram os episódios que esperam edição (disponíveis na fila e em edição,
// inclusive os que voltaram com ajustes pedidos), pela data de veiculação: quem vai ao ar antes vem primeiro; no mesmo dia, o
// número do episódio; sem data, no fim. Em revisão, finalização e pronto não dependem do editor e ficam de fora. Ajuste pedido
// não fura a fila: vale a data em que o episódio vai ao ar.
const db = require('../db/pool');
const cal = require('./calendar');

const STAGES = ['disponivel_edicao', 'em_edicao'];
const SOON_DAYS = 2; // âmbar: vai ao ar hoje ou nos próximos 2 dias
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

// A fila inteira, já com a posição (rank 1 = editar primeiro).
async function list() {
  const { rows } = await db.query(
    `SELECT e.id, e.number, e.title, e.status, e.editor_id, e.review_round, to_char(e.aired_on, 'YYYY-MM-DD') AS aired, u.name AS editor_name
       FROM episodes e LEFT JOIN users u ON u.id = e.editor_id
      WHERE e.status = ANY($1::text[])
      ORDER BY e.aired_on NULLS LAST, e.number NULLS LAST, e.id`, [STAGES]);
  return rows.map((r, i) => ({ ...r, rank: i + 1, air: airInfo(r.aired) }));
}

// Quando vai ao ar, em palavras, com a cor do prazo: vermelho (late) se a data passou e o episódio ainda não saiu, âmbar (soon)
// se é hoje ou nos próximos 2 dias, neutro no resto; sem data, apagado (none).
function airInfo(aired, today = cal.todayISO()) {
  if (!aired) return { line: 'sem data de veiculação', short: 'sem data', tone: 'none' };
  const days = Math.round((Date.parse(`${aired}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  const date = `${WEEKDAYS[new Date(`${aired}T12:00:00Z`).getUTCDay()]} ${aired.slice(8, 10)}/${aired.slice(5, 7)}`;
  const short = `${aired.slice(8, 10)}/${aired.slice(5, 7)}`;
  if (days < -1) return { line: `devia ter saído ${date} · há ${-days} dias`, short, tone: 'late' };
  if (days === -1) return { line: `devia ter saído ontem, ${date}`, short, tone: 'late' };
  if (days === 0) return { line: `vai ao ar hoje, ${date}`, short, tone: 'soon' };
  if (days === 1) return { line: `vai ao ar amanhã, ${date}`, short, tone: 'soon' };
  return { line: `vai ao ar ${date} · em ${days} dias`, short, tone: days <= SOON_DAYS ? 'soon' : '' };
}

// A posição de um episódio (null se ele não está esperando edição).
async function positionOf(id) { return (await list()).find((e) => e.id === Number(id)) || null; }
// id -> item, para o quadro e a lista de Episódios.
async function byId() { return Object.fromEntries((await list()).map((e) => [e.id, e])); }

module.exports = { STAGES, list, airInfo, positionOf, byId };
