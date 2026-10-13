// Edição em massa de convidados (CRM > Lista): etapa, responsável, perfil, gênero e patrocinador de vários de uma vez.
// Cada convidado passa pelas mesmas regras de uma edição individual: a etapa só muda se o convidado tiver o que ela exige
// (foto, contato, motivo da perda…); o resto da mudança vale mesmo assim, e quem ficou para trás volta no relatório.
const db = require('../db/pool');
const rules = require('./guestRules');
const guestsSvc = require('./guests');
const production = require('./production');
const notify = require('./notify');
const { GUEST_STATUSES, STATUS_BY_KEY, LOSS_REASONS, PROFILE_BY_KEY } = require('../constants');
const { isUuid, isIntId } = require('../utils/wrap');
const { clean } = require('../utils/format');

const MAX_IDS = 200;
// Agendado pede a data e as três confirmações de cada um; Gravado faz nascer o episódio. Esses dois seguem um a um.
const BULK_STATUSES = GUEST_STATUSES.filter((s) => !['agendado', 'gravado'].includes(s.key));
const BULK_STATUS_KEYS = new Set(BULK_STATUSES.map((s) => s.key));

// Lê o formulário. Devolve { ids, changes, error }. Campo em branco = não alterar.
async function parse(body) {
  const ids = [...new Set([].concat(body.ids || []).filter((v) => isIntId(String(v))).map(Number))].slice(0, MAX_IDS);
  if (!ids.length) return { error: 'Marque pelo menos um convidado.' };
  const changes = {};

  if (body.status) {
    if (!BULK_STATUS_KEYS.has(body.status)) return { error: 'Essa etapa não é aplicada em massa: Agendado e Gravado pedem os dados de cada convidado.' };
    changes.status = body.status;
    if (body.status === 'perdido') {
      if (!Object.prototype.hasOwnProperty.call(LOSS_REASONS, body.loss_reason)) return { error: 'Escolha o motivo da perda.' };
      changes.loss_reason = body.loss_reason;
      changes.loss_note = clean(body.loss_note, 500) || null;
      if (changes.loss_reason === 'outros' && !changes.loss_note) return { error: 'Em Outros, descreva o motivo.' };
    }
  }
  if (body.owner_id) {
    if (body.owner_id === 'nenhum') changes.owner_id = null;
    else {
      if (!isUuid(body.owner_id)) return { error: 'Responsável inválido.' };
      const { rows: [u] } = await db.query('SELECT id, name FROM users WHERE id = $1 AND active', [body.owner_id]);
      if (!u) return { error: 'Responsável inválido ou inativo.' };
      changes.owner_id = u.id; changes.owner_name = u.name;
    }
  }
  if (body.profile) {
    if (!PROFILE_BY_KEY[body.profile]) return { error: 'Perfil inválido.' };
    changes.profile = body.profile;
  }
  if (body.gender) {
    if (!['m', 'f'].includes(body.gender)) return { error: 'Gênero inválido.' };
    changes.gender = body.gender;
  }
  if (body.sponsor_id) {
    if (body.sponsor_id === 'nenhum') { changes.sponsor_id = null; changes.sponsor_relation = null; } else {
      if (!isIntId(String(body.sponsor_id))) return { error: 'Patrocinador inválido.' };
      const { rows: [s] } = await db.query('SELECT id, company FROM sponsors WHERE id = $1', [body.sponsor_id]);
      if (!s) return { error: 'Patrocinador não encontrado.' };
      changes.sponsor_id = s.id; changes.sponsor_name = s.company;
      changes.sponsor_relation = body.sponsor_relation === 'representante' ? 'representante' : 'indicado';
    }
  }
  if (!Object.keys(changes).length) return { error: 'Escolha pelo menos uma mudança.' };
  return { ids, changes };
}

// Aplica. Devolve { updated, unchanged, stageSkipped: [{ name, why }], missing: n (ids que não existem mais) }.
async function apply({ ids, changes, user }) {
  const { rows: guests } = await db.query('SELECT * FROM guests WHERE id = ANY($1) ORDER BY id', [ids]);
  const result = { updated: 0, unchanged: 0, stageSkipped: [], missing: ids.length - guests.length };
  const touched = [];
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    for (const g of guests) {
      const set = {}; const notes = [];
      const same = (k) => (changes[k] ?? null) === (g[k] ?? null);

      if (changes.status && changes.status !== g.status) {
        const candidate = { ...g, status: changes.status, loss_reason: changes.loss_reason ?? null, loss_note: changes.loss_note ?? null };
        const missingData = rules.missingFor(changes.status, candidate);
        if (missingData.length) result.stageSkipped.push({ name: g.name, why: missingData.join(', ') });
        else {
          set.status = changes.status;
          set.loss_reason = changes.status === 'perdido' ? changes.loss_reason : null;
          set.loss_note = changes.status === 'perdido' ? changes.loss_note : null;
          notes.push(`etapa ${STATUS_BY_KEY[g.status].label} → ${STATUS_BY_KEY[changes.status].label}${changes.status === 'perdido' ? ` (motivo: ${LOSS_REASONS[changes.loss_reason]}${changes.loss_note ? `: “${changes.loss_note}”` : ''})` : ''}`);
        }
      }
      if ('owner_id' in changes && !same('owner_id') ) { set.owner_id = changes.owner_id; notes.push(`responsável → ${changes.owner_name || 'ninguém'}`); }
      if (changes.profile && changes.profile !== g.profile) { set.profile = changes.profile; notes.push(`perfil → ${PROFILE_BY_KEY[changes.profile].label}`); }
      if (changes.gender && changes.gender !== g.gender) { set.gender = changes.gender; notes.push(`gênero → ${changes.gender === 'f' ? 'feminino' : 'masculino'}`); }
      if ('sponsor_id' in changes && (!same('sponsor_id') || !same('sponsor_relation'))) {
        set.sponsor_id = changes.sponsor_id; set.sponsor_relation = changes.sponsor_relation;
        notes.push(`patrocinador → ${changes.sponsor_name || 'nenhum'}`);
      }

      const cols = Object.keys(set);
      if (!cols.length) { result.unchanged += 1; continue; }
      await client.query(`UPDATE guests SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [g.id, ...cols.map((c) => set[c])]);
      if ('sponsor_id' in set && g.sponsor_id && g.sponsor_id !== set.sponsor_id) { // trocou/tirou o patrocinador: a reserva automática sai
        await client.query('DELETE FROM sponsor_bookings WHERE guest_id = $1 AND sponsor_id = $2', [g.id, g.sponsor_id]);
      }
      await client.query('INSERT INTO guest_events (guest_id, user_id, type, message) VALUES ($1,$2,$3,$4)',
        [g.id, user.id, 'status', `Edição em massa por ${user.name}: ${notes.join('; ')}`]);
      touched.push({ id: g.id, ownerChanged: 'owner_id' in set, statusChanged: 'status' in set, sponsorChanged: 'sponsor_id' in set });
      result.updated += 1;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  for (const t of touched.filter((x) => x.statusChanged || x.sponsorChanged)) await production.syncFromGuest(t.id, user.id);
  // quem ganhou convidados recebe um aviso só (não um por convidado)
  if (changes.owner_id && String(changes.owner_id) !== String(user.id)) {
    const n = touched.filter((t) => t.ownerChanged).length;
    if (n) {
      await notify.notify({
        type: 'comentario', users: [changes.owner_id], actorId: user.id,
        title: `${user.name} colocou você como responsável por ${n} convidado${n > 1 ? 's' : ''}`, url: `/convidados?view=lista&owner=${changes.owner_id}`,
      });
    }
  }
  return result;
}

// Mensagem do resultado para a pessoa. tone 'error' quando alguém ficou para trás.
function summary(r) {
  const parts = [r.updated ? `${r.updated} convidado${r.updated > 1 ? 's' : ''} atualizado${r.updated > 1 ? 's' : ''}` : 'Nenhum convidado precisou mudar'];
  if (r.unchanged && r.updated) parts.push(`${r.unchanged} já estava${r.unchanged > 1 ? 'm' : ''} assim`);
  let text = `${parts.join('; ')}.`;
  if (r.stageSkipped.length) {
    const shown = r.stageSkipped.slice(0, 6).map((s) => `${s.name} (falta ${s.why})`).join('; ');
    text += ` A etapa não mudou para ${r.stageSkipped.length}: ${shown}${r.stageSkipped.length > 6 ? ` e mais ${r.stageSkipped.length - 6}` : ''}.`;
  }
  if (r.missing) text += ` ${r.missing} convidado${r.missing > 1 ? 's' : ''} não existe${r.missing > 1 ? 'm' : ''} mais.`;
  return { text, tone: r.stageSkipped.length || r.missing ? 'error' : 'ok' };
}

module.exports = { MAX_IDS, BULK_STATUSES, parse, apply, summary };
