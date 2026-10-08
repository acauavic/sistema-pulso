// Cria (ou promove) o primeiro superadmin. Uso:
//   npm run create-superadmin -- email@dominio.com "Nome Completo"
// Senha: se SUPERADMIN_PASSWORD estiver no ambiente, é usada; senão gera um link de "definir senha"
// (impresso aqui no terminal e enviado por e-mail se o SMTP estiver disponível).
const config = require('../config');
config.assertConfig();

const db = require('../db/pool');
const { migrate } = require('../db/migrate');
const { hashPassword, passwordPolicyError } = require('../auth/password');
const { createAuthToken } = require('../auth/tokens');
const mailer = require('../services/mailer');
const { isEmail } = require('../utils/format');

async function main() {
  const email = (process.argv[2] || process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  const name = (process.argv[3] || process.env.SUPERADMIN_NAME || 'Superadmin').trim();
  if (!isEmail(email)) throw new Error('Informe um e-mail válido: npm run create-superadmin -- email@dominio.com "Nome"');

  await migrate();
  const password = process.env.SUPERADMIN_PASSWORD;
  if (password) {
    const problem = passwordPolicyError(password);
    if (problem) throw new Error(problem);
  }
  const hash = password ? await hashPassword(password) : null;

  const { rows: [user] } = await db.query(
    `INSERT INTO users (name, email, role, password_hash) VALUES ($1, $2, 'superadmin', $3)
     ON CONFLICT (lower(email)) DO UPDATE
       SET role = 'superadmin', active = true, password_hash = COALESCE($3, users.password_hash), updated_at = now()
     RETURNING id, email, name, password_hash`, [name, email, hash]);
  console.log(`Superadmin pronto: ${user.email}`);

  if (!user.password_hash) {
    const url = `${config.appBaseUrl}/senha/${await createAuthToken(user.id, 'invite')}`;
    console.log(`Link para definir a senha (vale 72h, uso único):\n${url}`);
    try {
      await mailer.sendUserInvite({ to: user.email, name: user.name, url, invitedBy: 'O sistema' });
      console.log('Link também enviado por e-mail.');
    } catch (err) {
      console.log(`(E-mail não enviado: ${err.message}) — use o link acima.`);
    }
  }
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.close());
