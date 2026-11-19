// Banco de horas do estúdio: o Pulso compra um pacote de horas e, a partir do episódio de início, cada gravação sai dele
// (nada de sinal, saldo ou hora extra por episódio). Convidado agendado reserva a duração esperada; episódio gravado usa a
// duração real (ou a esperada). Disponível = comprado − usado − reservado; pode ficar negativo (a próxima compra cobre).
const db = require('../db/pool');

const TZ = 'America/Sao_Paulo';
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const iso = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : (v ? String(v).slice(0, 10) : null));
// "12,5 h", "20 h", "−4,5 h"
const fmtHours = (n) => `${Number(n) < 0 ? '−' : ''}${Math.abs(round2(n)).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h`;

// Dia que conta para o episódio: a data da gravação, ou o dia em que ele foi criado.
const EP_DAY = `coalesce(e.recorded_on, (e.created_at AT TIME ZONE '${TZ}')::date)`;

// O dia de início é o guardado ao ligar (editar ou apagar a data do episódio de início não move a fronteira); só sem ele vale
// a data do episódio.
async function config(qf = db.query) {
  const { rows: [s] } = await qf(
    `SELECT s.studio_mode, s.studio_bank_start_episode_id AS start_id, s.studio_minutes, s.studio_bank_alert_hours,
            coalesce(s.studio_bank_start_on, (SELECT ${EP_DAY} FROM episodes e WHERE e.id = s.studio_bank_start_episode_id)) AS start_on
       FROM fin_settings s WHERE s.id = 1`);
  return { active: s.studio_mode === 'banco', startId: s.start_id, startOn: iso(s.start_on), minutes: Number(s.studio_minutes) || 60, alertHours: Number(s.studio_bank_alert_hours) };
}

const bankActive = async () => (await config()).active;

// Episódios do banco: o de início e os gravados no mesmo dia ou depois dele.
async function bankEpisodes(c, qf = db.query) {
  if (!c.active || (!c.startId && !c.startOn)) return [];
  const { rows } = await qf(
    `SELECT e.id, e.number, e.title, ${EP_DAY} AS day, coalesce(e.recording_minutes, $3)::int AS minutes, g.name AS guest_name
       FROM episodes e LEFT JOIN guests g ON g.id = e.guest_id
      WHERE e.id = $1 OR ($2::date IS NOT NULL AND ${EP_DAY} >= $2::date)
      ORDER BY ${EP_DAY}, e.number NULLS LAST, e.id`, [c.startId, c.startOn, c.minutes]);
  return rows.map((r) => ({ ...r, day: iso(r.day) }));
}

// Gravações marcadas: convidado Agendado que ainda não virou episódio (sempre do banco, é futuro).
async function reservations(c) {
  if (!c.active) return [];
  const { rows } = await db.query(
    `SELECT g.id, g.name, g.proposed_at, (g.proposed_at AT TIME ZONE '${TZ}')::date AS proposed_on FROM guests g
      WHERE g.status = 'agendado' AND NOT EXISTS (SELECT 1 FROM episodes e WHERE e.guest_id = g.id)
      ORDER BY g.proposed_at NULLS LAST, g.id`);
  return rows.map((r) => ({ ...r, proposed_on: iso(r.proposed_on), minutes: c.minutes }));
}

async function isBankEpisode(epOrId) {
  const c = await config();
  if (!c.active) return false;
  const id = typeof epOrId === 'object' ? epOrId.id : Number(epOrId);
  if (c.startId && id === c.startId) return true;
  if (!c.startOn) return false;
  const { rows: [r] } = await db.query(`SELECT ${EP_DAY} >= $2::date AS inside FROM episodes e WHERE e.id = $1`, [id, c.startOn]);
  return Boolean(r && r.inside);
}

async function status() {
  const c = await config();
  const { rows: packRows } = await db.query('SELECT * FROM fin_hour_packs ORDER BY bought_on, id');
  const packs = packRows.map((p) => ({ ...p, hours: Number(p.hours), amount_cents: Number(p.amount_cents), bought_on: iso(p.bought_on) }));
  const [used, reserved] = await Promise.all([bankEpisodes(c), reservations(c)]);
  const purchasedHours = round2(packs.reduce((a, p) => a + p.hours, 0));
  const usedHours = round2(used.reduce((a, u) => a + u.minutes, 0) / 60);
  const reservedHours = round2(reserved.reduce((a, g) => a + g.minutes, 0) / 60);
  const availableHours = round2(purchasedHours - usedHours - reservedHours);
  return {
    active: c.active, startEpisodeId: c.startId, startOn: c.startOn,
    purchasedHours, usedHours, reservedHours, availableHours, alertHours: c.alertHours,
    low: c.active && availableHours <= c.alertHours,
    packs, used, reserved,
  };
}

// Uma transação num cliente só: tudo entra junto ou nada entra.
async function inTx(fn) {
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn((text, params) => client.query(text, params));
    await client.query(out && out.error ? 'ROLLBACK' : 'COMMIT');
    return out;
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

// Confere a compra antes de mexer em qualquer coisa (horas que arredondam para 0 não passam).
function checkPack({ hours, amountCents }) {
  const h = round2(hours);
  if (!(h > 0) || h > 9999) return 'Informe quantas horas foram compradas.';
  if (!(Number.isInteger(amountCents) && amountCents >= 0)) return 'Valor inválido. Use algo como 5.000,00.';
  return null;
}

async function insertPack(qf, { boughtOn, hours, amountCents, note = null, userId = null }) {
  const h = round2(hours);
  const day = boughtOn || todayISO();
  const { rows: [entry] } = await qf(
    `INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, paid_on, status, notes, source, created_by)
     VALUES ('saida', 'estudio', $1, $2, $3, $3, 'pago', $4, 'estudio', $5) RETURNING id`,
    [`Estúdio · banco de horas (${fmtHours(h)})`, amountCents, day, note, userId]);
  const { rows: [pack] } = await qf(
    'INSERT INTO fin_hour_packs (bought_on, hours, amount_cents, note, entry_id, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [day, h, amountCents, note, entry.id, userId]);
  return pack;
}

// Liga o banco com a primeira compra, numa transação só. A troca de modo é condicional (só sai de 'hora'): dois cliques ao mesmo
// tempo ligam uma vez. O estúdio ainda em aberto (sinal, saldo, extra) dos episódios do banco e dos convidados sem episódio que
// ainda não gravaram é cancelado pelo sistema; o que foi pago fica como está.
async function activate({ startEpisodeId, pack, userId = null }) {
  const bad = checkPack(pack || {});
  if (bad) return { error: bad };
  return inTx(async (qf) => {
    const { rows: [ep] } = await qf(`SELECT e.id, ${EP_DAY} AS day FROM episodes e WHERE e.id = $1`, [startEpisodeId]);
    if (!ep) return { error: 'Escolha o episódio de início.' };
    const { rows: [on] } = await qf(
      "UPDATE fin_settings SET studio_mode = 'banco', studio_bank_start_episode_id = $1, studio_bank_start_on = $2, updated_at = now() WHERE id = 1 AND studio_mode = 'hora' RETURNING id",
      [ep.id, iso(ep.day)]);
    if (!on) return { error: 'O banco de horas já está ligado.' };
    const episodes = await bankEpisodes(await config(qf), qf);
    const { rowCount } = await qf(
      `UPDATE fin_entries f SET status = 'cancelado', cancel_reason = 'sistema', updated_at = now()
        WHERE f.status = 'previsto' AND f.auto_key LIKE 'estudio-%'
          AND (f.episode_id = ANY($1::int[])
               OR (f.episode_id IS NULL AND EXISTS (SELECT 1 FROM guests g WHERE g.id = f.guest_id AND g.status <> 'gravado'
                                                    AND NOT EXISTS (SELECT 1 FROM episodes e WHERE e.guest_id = g.id))))`,
      [episodes.map((e) => e.id)]);
    const created = await insertPack(qf, { ...pack, userId });
    return { ok: true, canceled: rowCount, pack: created };
  });
}

// Compra (ou renovação): o pacote e a despesa paga de estúdio, ligados, na mesma transação.
async function addPack({ boughtOn, hours, amountCents, note = null, userId = null }) {
  const bad = checkPack({ hours, amountCents });
  if (bad) return { error: bad };
  const pack = await inTx((qf) => insertPack(qf, { boughtOn, hours, amountCents, note, userId }));
  return { ok: true, pack };
}

async function setAlertHours(hours) {
  await db.query('UPDATE fin_settings SET studio_bank_alert_hours = $1, updated_at = now() WHERE id = 1', [round2(hours)]);
}

// Acabou = nada disponível (zero ou negativo): uma fronteira só para a frase, a faixa do aviso e o vermelho das telas.
const isOut = (st) => st.availableHours <= 0;

// Frase do aviso de renovar (rotina, Início e Financeiro).
function alertText(st) {
  if (st.availableHours < 0) return `Banco de horas do estúdio: acabou, ${fmtHours(-st.availableHours)} além do comprado (com as gravações marcadas). Hora de renovar.`;
  if (isOut(st)) return 'Banco de horas do estúdio: acabou (com as gravações marcadas). Hora de renovar.';
  return `Banco de horas do estúdio: restam ${fmtHours(st.availableHours)} (com as gravações marcadas). Hora de renovar.`;
}

// Rotina do Financeiro: avisa a gestão uma vez por dia e por faixa (sobrando pouco / acabou).
async function tick() {
  const st = await status();
  if (!st.active || !st.low) return false;
  const band = isOut(st) ? 'acabou' : 'baixo';
  await require('./notify').notify({ type: 'financeiro', broadcast: true, title: alertText(st), url: '/financeiro', dedupe: `fin-banco-${todayISO()}-${band}` });
  return true;
}

module.exports = { status, activate, addPack, checkPack, setAlertHours, isBankEpisode, bankActive, alertText, isOut, fmtHours, tick };
