// Cópia do backup do banco fora da VPS (Backblaze). Lê o .sql.gz pela entrada padrão e grava em
// "<prefixo>/backups/banco/<nome>"; apaga a cópia de 30 dias atrás. Roda no cron da VPS logo depois do pg_dump:
//   docker compose exec -T web node src/scripts/backupOffsite.js pulso-2026-11-19.sql.gz < /opt/pulso-backups/pulso-2026-11-19.sql.gz
// Bucket próprio (recomendado: com Object Lock e uma chave que só grava): BACKUP_BB_KEY_ID, BACKUP_BB_APPLICATION_KEY,
// BACKUP_BUCKET_NAME (e BACKUP_BB_PREFIX, se a chave tiver prefixo). Sem elas, usa o bucket e a chave do sistema.
const config = require('../config');

const KEEP_DAYS = 30;
const NAME_RE = /^pulso-(\d{4}-\d{2}-\d{2})\.sql\.gz$/;

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks);
}

async function main() {
  const name = process.argv[2] || '';
  const m = name.match(NAME_RE);
  if (!m) throw new Error('Nome esperado: pulso-AAAA-MM-DD.sql.gz');
  if (process.env.BACKUP_BUCKET_NAME) {
    Object.assign(config.b2, {
      keyId: process.env.BACKUP_BB_KEY_ID, appKey: process.env.BACKUP_BB_APPLICATION_KEY,
      bucket: process.env.BACKUP_BUCKET_NAME, prefix: process.env.BACKUP_BB_PREFIX || '', endpoint: '',
    });
  }
  if (!config.b2.keyId || !config.b2.appKey || !config.b2.bucket) throw new Error('Backblaze não configurado.');
  const b2 = require('../services/b2');
  const body = await readStdin();
  if (body.length < 1024 || body[0] !== 0x1f || body[1] !== 0x8b) throw new Error(`Arquivo vazio ou fora do formato gzip (${body.length} bytes).`);
  const key = await b2.keyFor('backups', 'banco', name);
  await b2.putObject(key, body, 'application/gzip');
  const head = await b2.headObject(key);
  if (!head || head.size !== body.length) throw new Error(`a cópia no Backblaze não confere (${head ? head.size : 'não encontrada'} de ${body.length} bytes).`);
  const old = new Date(`${m[1]}T12:00:00Z`); old.setUTCDate(old.getUTCDate() - KEEP_DAYS);
  await b2.deleteObject(await b2.keyFor('backups', 'banco', `pulso-${old.toISOString().slice(0, 10)}.sql.gz`)).catch(() => {});
  console.log(`[backup] ${name} copiado para o Backblaze (${body.length} bytes, conferido).`);
}

main().catch((err) => { console.error(`[backup] falhou: ${err.message}`); process.exit(1); });
