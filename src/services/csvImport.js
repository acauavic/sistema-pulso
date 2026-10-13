// Importação de convidados por CSV: leitura do arquivo, mapeamento de colunas e validação linha a linha.
// Funções puras (sem banco), exceto `markDuplicates`, que consulta quem já existe.
const db = require('../db/pool');
const rules = require('./guestRules');
const { clean, isEmail } = require('../utils/format');

const MAX_ROWS = 500;

// Lê CSV (RFC 4180: aspas, aspas duplicadas, quebras de linha dentro de campo). Separador detectado: ; , ou tab.
function parseCsv(input) {
  let text = String(input || '').replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => firstLine.split(ch).length - 1;
  const delim = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

const norm = (h) => rules.normText(h).replace(/[^a-z0-9]/g, '');
const ALIASES = {
  name: ['nome', 'name', 'convidado', 'nomecompleto'],
  instagram: ['instagram', 'insta', 'ig', 'perfilinstagram', 'usuarioinstagram'],
  phone: ['whatsapp', 'telefone', 'celular', 'fone', 'phone', 'whats'],
  profile: ['perfil', 'tipo', 'categoria', 'tipodeperfil'],
  email: ['email', 'emailopcional', 'mail'],
  invite_reason: ['motivo', 'motivodoconvite', 'motivoconvite', 'porque'],
  gender: ['genero', 'sexo'],
};
const REQUIRED = { name: 'nome', instagram: 'instagram', profile: 'perfil' };

// Devolve { rows: [{ line, data, errors }], headerError }.
function parseGuests(input) {
  const table = parseCsv(input);
  if (!table.length) return { rows: [], headerError: 'O arquivo está vazio.' };
  const header = table[0].map(norm);
  const col = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const idx = header.findIndex((h) => names.includes(h));
    if (idx >= 0) col[field] = idx;
  }
  const absent = Object.entries(REQUIRED).filter(([field]) => col[field] === undefined).map(([, label]) => label);
  if (absent.length) return { rows: [], headerError: `Faltam colunas obrigatórias no cabeçalho: ${absent.join(', ')}.` };
  if (table.length - 1 > MAX_ROWS) return { rows: [], headerError: `O arquivo tem mais de ${MAX_ROWS} convidados. Divida em partes menores.` };

  const rows = table.slice(1).map((cells, i) => {
    const get = (field) => (col[field] === undefined ? '' : String(cells[col[field]] ?? '').trim());
    const errors = [];
    const name = clean(get('name'), 150);
    const instagram = rules.normalizeInstagram(get('instagram'));
    const profile = rules.normalizeProfile(get('profile'));
    const email = clean(get('email'), 254).toLowerCase();
    const gender = rules.normalizeGender(get('gender'));
    if (name.length < 2) errors.push('nome ausente');
    if (!instagram) errors.push(get('instagram') ? 'Instagram inválido' : 'Instagram ausente');
    if (!profile) errors.push(get('profile') ? `perfil “${get('profile')}” não reconhecido` : 'perfil ausente');
    if (email && !isEmail(email)) errors.push('e-mail inválido');
    if (gender === null) errors.push('gênero inválido (use m ou f)');
    return {
      line: i + 2,
      errors,
      duplicate: null,
      data: {
        name, instagram, profile, email, gender: gender || 'm',
        phone: clean(get('phone'), 40), invite_reason: clean(get('invite_reason'), 1000),
      },
    };
  });
  return { rows, headerError: null };
}

// Marca como duplicadas as linhas cujo Instagram/e-mail já existe no banco ou aparece antes no próprio arquivo.
async function markDuplicates(rows) {
  const valid = rows.filter((r) => !r.errors.length);
  const igs = valid.map((r) => r.data.instagram);
  const emails = valid.map((r) => r.data.email).filter(Boolean);
  const { rows: found } = await db.query(
    'SELECT lower(instagram) AS ig, lower(email) AS email, name FROM guests WHERE lower(instagram) = ANY($1) OR lower(email) = ANY($2)',
    [igs, emails]);
  const byIg = new Map(found.filter((f) => f.ig).map((f) => [f.ig, f.name]));
  const byEmail = new Map(found.filter((f) => f.email).map((f) => [f.email, f.name]));
  const seenIg = new Set();
  const seenEmail = new Set();
  for (const r of valid) {
    const { instagram, email } = r.data;
    if (byIg.has(instagram)) r.duplicate = `@${instagram} já cadastrado (${byIg.get(instagram)})`;
    else if (email && byEmail.has(email)) r.duplicate = `${email} já cadastrado (${byEmail.get(email)})`;
    else if (seenIg.has(instagram)) r.duplicate = `@${instagram} repetido no arquivo`;
    else if (email && seenEmail.has(email)) r.duplicate = `${email} repetido no arquivo`;
    seenIg.add(instagram);
    if (email) seenEmail.add(email);
  }
  return rows;
}

const TEMPLATE_CSV = '﻿nome;instagram;whatsapp;perfil;email;motivo do convite\r\n' +
  'Maria Souza;@maria.souza;(12) 99999-0000;médico;maria@exemplo.com;Referência em saúde da mulher\r\n' +
  'João Lima;@joaolima;;influencer;;Fala com um público jovem sobre autocuidado\r\n';

module.exports = { parseCsv, parseGuests, markDuplicates, TEMPLATE_CSV, MAX_ROWS };
