// Importa convidados de um CSV pelo terminal, com as mesmas regras da tela Convidados > Importar CSV.
// Uso: node src/scripts/importGuests.js <arquivo.csv | -> <email de quem importa> [--gravar]
// Sem --gravar só mostra a prévia (prontos, erros e duplicados). "-" lê o CSV da entrada padrão.
require('dotenv').config();
const fs = require('fs');
const db = require('../db/pool');
const { analyse, importGuests } = require('../services/guestImport');
const { STATUS_BY_KEY } = require('../constants');

async function main() {
  const [file, email, flag] = process.argv.slice(2);
  if (!file || !email) throw new Error('Uso: node src/scripts/importGuests.js <arquivo.csv | -> <email> [--gravar]');
  const text = fs.readFileSync(file === '-' ? 0 : file, 'utf8');
  const { rows: [user] } = await db.query('SELECT id, name, email FROM users WHERE lower(email) = lower($1) AND active', [email]);
  if (!user) throw new Error(`Usuário ativo não encontrado: ${email}`);

  const preview = await analyse(text);
  if (preview.headerError) throw new Error(preview.headerError);
  for (const r of preview.rows) {
    const what = r.errors.length ? `ERRO: ${r.errors.join('; ')}` : r.duplicate ? `DUPLICADO: ${r.duplicate}` : 'ok';
    const stage = r.data.episode?.status === 'publicado' ? 'Publicado' : STATUS_BY_KEY[r.data.status]?.label || '—';
    console.log(`${String(r.line).padStart(4)}  ${r.data.name.padEnd(40)} ${stage.padEnd(16)} ${what}`);
  }
  const ready = preview.rows.filter((r) => !r.errors.length && !r.duplicate).length;
  console.log(`\n${ready} prontos · ${preview.rows.length - ready} ignorados · ${preview.rows.length} linhas`);
  if (flag !== '--gravar') { console.log('Prévia apenas. Rode com --gravar para importar.'); return; }

  const r = await importGuests(text, user);
  if (r.headerError) throw new Error(r.headerError);
  await db.query("INSERT INTO audit_log (user_id, user_email, action, entity, meta) VALUES ($1, $2, 'convidados.importados', 'guest', $3)",
    [user.id, email, JSON.stringify({ criados: r.created.length, episodios: r.episodes, ignorados: r.skipped, origem: 'script' })]);
  console.log(`Importados: ${r.created.length} convidado(s), ${r.episodes} episódio(s) do histórico; ignoradas: ${r.skipped}.`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.close());
