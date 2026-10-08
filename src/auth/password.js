const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MIN_LENGTH = 10;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const [scheme, n, r, p, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Devolve mensagem de erro ou null.
function passwordPolicyError(password) {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    return `A senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`;
  }
  if (password.length > 200) return 'A senha é longa demais.';
  if (/^(.)\1+$/.test(password)) return 'Escolha uma senha menos previsível.';
  return null;
}

// Hash descartável: gasta o mesmo tempo quando o e-mail não existe (evita enumerar usuários pelo tempo de resposta).
let dummy;
async function burnPasswordCheck(password) {
  dummy = dummy || (await hashPassword('dummy-password-for-timing'));
  await verifyPassword(password, dummy);
}

module.exports = { hashPassword, verifyPassword, passwordPolicyError, burnPasswordCheck, MIN_LENGTH };
