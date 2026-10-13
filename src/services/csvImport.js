// Importação de convidados por CSV: leitura do arquivo, mapeamento de colunas e validação linha a linha.
// Funções puras (sem banco), exceto `markDuplicates`, que consulta quem já existe.
const db = require('../db/pool');
const rules = require('./guestRules');
const { clean, isEmail } = require('../utils/format');
const { STATUS_BY_KEY } = require('../constants');

const MAX_ROWS = 500;
// Etapas que a planilha pode trazer. Agendado pede data e hora da gravação e entra com estúdio, hosts e convidado
// confirmados (quem marca "Agendado" na planilha está dizendo que a data está fechada).
// Gravado e "Publicado" (convidado Gravado + episódio Publicado) trazem o histórico: pedem a data da gravação (só o dia
// basta) e criam o episódio como histórico, sem tarefas, custos ou avisos.
const IMPORT_STATUSES = ['prospect', 'convite_enviado', 'em_agendamento', 'agendado', 'gravado', 'perdido', 'cancelado'];
const PUBLISHED_WORDS = ['publicado', 'publicada', 'no ar', 'episodio publicado'];
const parseEpisodeNumber = (v) => { const m = String(v || '').match(/^\s*(?:ep\.?\s*)?0*(\d{1,4})\s*$/i); return m ? Number(m[1]) : null; };

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
  status: ['status', 'etapa', 'situacao', 'fase', 'etapadofunil'],
  recording_at: ['dataehoradagravacao', 'datadagravacao', 'datagravacao', 'gravacao', 'data', 'datahora', 'dataehora', 'agendamento', 'dataagendada'],
  recording_time: ['horadagravacao', 'horagravacao', 'hora', 'horario'],
  loss_reason: ['motivodaperda', 'motivoperda', 'perda', 'motivodeperda'],
  episode_number: ['episodio', 'numerodoepisodio', 'numeroepisodio', 'ep', 'epnumero', 'numero'],
  youtube: ['youtube', 'linkyoutube', 'linkdoyoutube'],
  spotify: ['spotify', 'linkspotify', 'linkdospotify'],
  notes: ['observacoes', 'observacao', 'obs', 'notas', 'anotacoes', 'notes'],
  episode_title: ['titulodoepisodio', 'tituloepisodio', 'titulo', 'title'],
  aired_on: ['publicadoem', 'datadepublicacao', 'datapublicacao', 'publicacao', 'dataderelease'],
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
    const published = PUBLISHED_WORDS.includes(rules.normText(get('status')));
    const status = published ? 'gravado' : rules.normalizeStatus(get('status')) || (get('status') ? null : 'prospect');
    const phone = clean(get('phone'), 40);
    if (!status) errors.push(`status “${get('status')}” não reconhecido`);
    else if (!IMPORT_STATUSES.includes(status)) errors.push(`${STATUS_BY_KEY[status].label} não entra por planilha (use Agendado)`);
    else if (status === 'em_agendamento' && rules.missingFor(status, { email, phone }).length) errors.push('Em agendamento pede e-mail ou WhatsApp');
    // Perdido: motivo da coluna "motivo da perda" (texto que não é uma das opções vira "Outros" com a descrição);
    // status "Recusou"/"Recusado" já diz o motivo.
    const lossCell = clean(get('loss_reason'), 500);
    let lossReason = null; let lossNote = null;
    if (status === 'perdido') {
      lossReason = rules.normalizeLossReason(lossCell) || (lossCell ? 'outros' : rules.normalizeLossReason(get('status')));
      if (lossReason === 'outros' && !rules.normalizeLossReason(lossCell)) lossNote = lossCell || null;
      if (!lossReason) errors.push('Perdido pede o motivo da perda');
      else if (lossReason === 'outros' && !lossNote) errors.push('motivo “Outros” pede a descrição');
    }
    const history = status === 'gravado';
    const when = rules.parseRecordingAt(get('recording_at'), get('recording_time'), { dateOnly: history });
    if (when.error) errors.push(when.error);
    else if (status === 'agendado' && !when.value) errors.push('Agendado pede data e hora da gravação');
    else if (status === 'agendado' && when.value < new Date()) errors.push('a data da gravação já passou');
    else if (history && !when.value) errors.push(`${published ? 'Publicado' : 'Gravado'} pede a data da gravação`);
    else if (history && when.value > new Date()) errors.push('Gravado com data no futuro: use Agendado');
    // episódio do histórico: número (opcional), links e data de publicação
    let episode = null;
    if (history) {
      const number = get('episode_number') ? parseEpisodeNumber(get('episode_number')) : null;
      if (get('episode_number') && !number) errors.push(`número do episódio “${get('episode_number')}” inválido (use 12 ou EP.012)`);
      const yt = rules.normalizeUrl(get('youtube'), rules.YOUTUBE_HOSTS);
      const sp = rules.normalizeUrl(get('spotify'), rules.SPOTIFY_HOSTS);
      if (yt.error) errors.push('link do YouTube inválido');
      if (sp.error) errors.push('link do Spotify inválido');
      const aired = get('aired_on') ? rules.parseRecordingAt(get('aired_on'), '', { dateOnly: true }) : { value: null };
      if (aired.error) errors.push('data de publicação inválida (use 25/10/2026)');
      if (!published && (yt.value || sp.value || aired.value)) errors.push('tem link ou data de publicação: use o status Publicado');
      episode = { number, title: clean(get('episode_title'), 200) || null, status: published ? 'publicado' : 'gravado', youtube_url: yt.value || null, spotify_url: sp.value || null, aired_at: aired.value || null };
    } else if (get('episode_number') || get('youtube') || get('spotify')) {
      errors.push('número do episódio e links só valem para Gravado ou Publicado');
    }
    return {
      line: i + 2,
      errors,
      duplicate: null,
      data: {
        name, instagram, profile, email, gender: gender || 'm', status: status || null, proposed_at: when.value || null, loss_reason: lossReason, loss_note: lossNote, episode,
        phone, invite_reason: clean(get('invite_reason'), 1000), notes: clean(get('notes'), 4000) || null,
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
  const nums = valid.map((r) => r.data.episode?.number).filter(Boolean);
  const { rows: eps } = nums.length ? await db.query('SELECT number, title FROM episodes WHERE number = ANY($1)', [nums]) : { rows: [] };
  const epTaken = new Map(eps.map((e) => [e.number, e.title]));
  const seenEp = new Set();
  const seenIg = new Set();
  const seenEmail = new Set();
  for (const r of valid) {
    const { instagram, email } = r.data;
    if (byIg.has(instagram)) r.duplicate = `@${instagram} já cadastrado (${byIg.get(instagram)})`;
    else if (email && byEmail.has(email)) r.duplicate = `${email} já cadastrado (${byEmail.get(email)})`;
    else if (seenIg.has(instagram)) r.duplicate = `@${instagram} repetido no arquivo`;
    else if (email && seenEmail.has(email)) r.duplicate = `${email} repetido no arquivo`;
    const n = r.data.episode?.number;
    if (!r.duplicate && n && epTaken.has(n)) r.duplicate = `EP.${String(n).padStart(3, '0')} já existe (${epTaken.get(n)})`;
    else if (!r.duplicate && n && seenEp.has(n)) r.duplicate = `EP.${String(n).padStart(3, '0')} repetido no arquivo`;
    if (n) seenEp.add(n);
    seenIg.add(instagram);
    if (email) seenEmail.add(email);
  }
  return rows;
}

const TEMPLATE_CSV = '﻿nome;instagram;whatsapp;perfil;email;motivo do convite;status;data da gravação\r\n' +
  'Maria Souza;@maria.souza;(12) 99999-0000;médico;maria@exemplo.com;Referência em saúde da mulher;Agendado;25/11/2026 14:30\r\n' +
  'João Lima;@joaolima;;influencer;;Fala com um público jovem sobre autocuidado;;\r\n';

module.exports = { parseCsv, parseGuests, markDuplicates, TEMPLATE_CSV, MAX_ROWS, IMPORT_STATUSES };
