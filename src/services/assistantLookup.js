// Achar "a coisa certa" pelo que a pessoa disse (nome, número ou id), sem chutar: se houver mais de uma candidata, devolve as opções
// para o assistente perguntar. Resultado: { row } ou { erro, opcoes? } (no formato que as ferramentas devolvem ao modelo).
const db = require('../db/pool');

const like = (s) => `%${String(s || '').replace(/[\\%_]/g, '\\$&').trim().slice(0, 80)}%`;
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Entre as candidatas, uma só vale: igualdade exata (sem acento) ou candidata única.
function pick(rows, term, label, nameOf) {
  if (!rows.length) return { erro: `${label} não encontrado(a): "${term}".` };
  const exact = rows.filter((r) => norm(nameOf(r)) === norm(term));
  if (exact.length === 1) return { row: exact[0] };
  if (rows.length === 1) return { row: rows[0] };
  return { erro: `Mais de um(a) ${label.toLowerCase()} combina com "${term}". Pergunte qual é.`, opcoes: rows.slice(0, 6).map(nameOf) };
}

async function user(ref) {
  const term = String(ref || '').trim();
  if (!term) return { erro: 'Diga o nome da pessoa.' };
  const { rows } = await db.query('SELECT id, name, role FROM users WHERE active AND (name ILIKE $1 OR split_part(name, \' \', 1) ILIKE $2) ORDER BY name LIMIT 8', [like(term), term.replace(/[\\%_]/g, '\\$&')]);
  return pick(rows, term, 'Pessoa da equipe', (r) => r.name);
}

async function guest(ref) {
  const term = String(ref || '').trim();
  if (!term) return { erro: 'Diga o nome do convidado.' };
  if (/^\d+$/.test(term)) { const { rows: [g] } = await db.query('SELECT * FROM guests WHERE id = $1', [term]); if (g) return { row: g }; }
  const { rows } = await db.query('SELECT * FROM guests WHERE name ILIKE $1 OR instagram ILIKE $1 ORDER BY updated_at DESC LIMIT 8', [like(term)]);
  return pick(rows, term, 'Convidado', (r) => r.name);
}

async function sponsor(ref) {
  const term = String(ref || '').trim();
  if (!term) return { erro: 'Diga o nome do patrocinador.' };
  const { rows } = await db.query('SELECT * FROM sponsors WHERE company ILIKE $1 ORDER BY updated_at DESC LIMIT 8', [like(term)]);
  return pick(rows, term, 'Patrocinador', (r) => r.company);
}

// "12", "EP.012", "episódio 12" ou parte do título/nome do convidado.
async function episode(ref) {
  const term = String(ref || '').trim();
  if (!term) return { erro: 'Diga o número ou o título do episódio.' };
  const num = term.match(/^(?:ep\.?\s*|epis[óo]dio\s*)?0*(\d{1,4})$/i);
  if (num) { const { rows: [e] } = await db.query('SELECT e.*, g.name AS guest_name FROM episodes e LEFT JOIN guests g ON g.id = e.guest_id WHERE e.number = $1', [Number(num[1])]); if (e) return { row: e }; }
  const { rows } = await db.query(
    'SELECT e.*, g.name AS guest_name FROM episodes e LEFT JOIN guests g ON g.id = e.guest_id WHERE e.title ILIKE $1 OR g.name ILIKE $1 ORDER BY e.number DESC NULLS LAST LIMIT 8', [like(term)]);
  return pick(rows, term, 'Episódio', (r) => `${r.number ? `EP.${String(r.number).padStart(3, '0')} ` : ''}${r.title}`);
}

// Tarefa por id ou por título. Prefere as abertas; entre várias abertas com o mesmo nome, pergunta.
async function task(ref) {
  const term = String(ref || '').trim();
  if (!term) return { erro: 'Diga qual tarefa (o título ou o id).' };
  if (/^\d+$/.test(term)) { const { rows: [t] } = await db.query('SELECT * FROM tasks WHERE id = $1', [term]); if (t) return { row: t }; }
  const { rows } = await db.query("SELECT * FROM tasks WHERE title ILIKE $1 ORDER BY (status = 'feito'), updated_at DESC LIMIT 8", [like(term)]);
  const open = rows.filter((r) => r.status !== 'feito');
  return pick(open.length ? open : rows, term, 'Tarefa', (r) => r.title);
}

module.exports = { like, norm, user, guest, sponsor, episode, task };
