// Tarefa por voz: a pessoa divaga sobre o que precisa ser feito; a transcrição (Groq) é organizada pelo Gemini em UMA tarefa
// clara (título, detalhes, responsável, prazo, tipo e vínculos). Nada é criado aqui: devolve o rascunho para a pessoa conferir.
const db = require('../db/pool');
const gemini = require('./gemini');
const tasks = require('./tasks');
const C = require('../constants');

const TZ = 'America/Sao_Paulo';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    titulo: { type: 'STRING' },
    descricao: { type: 'STRING' },
    responsavel_id: { type: 'STRING', nullable: true },
    responsavel_citado: { type: 'STRING', nullable: true },
    vence_em: { type: 'STRING', nullable: true },
    vence_hora: { type: 'STRING', nullable: true },
    tipo: { type: 'STRING', enum: Object.keys(C.TASK_KINDS) },
    episodio_id: { type: 'INTEGER', nullable: true },
    convidado_id: { type: 'INTEGER', nullable: true },
    patrocinador_id: { type: 'INTEGER', nullable: true },
  },
  required: ['titulo', 'descricao', 'tipo'],
};

// Quem e o quê o modelo pode citar (só nomes que existem no sistema).
async function context() {
  const [users, episodes, guests, sponsors] = await Promise.all([
    db.query('SELECT id, name FROM users WHERE active ORDER BY lower(name)'),
    db.query('SELECT id, number, title FROM episodes ORDER BY coalesce(number, 0) DESC, id DESC LIMIT 40'),
    db.query("SELECT id, name FROM guests WHERE status NOT IN ('perdido', 'cancelado') ORDER BY updated_at DESC LIMIT 200"),
    db.query("SELECT id, company FROM sponsors WHERE stage <> 'perdido' ORDER BY updated_at DESC LIMIT 100"),
  ]);
  return { users: users.rows, episodes: episodes.rows, guests: guests.rows, sponsors: sponsors.rows };
}

function systemPrompt(user, today, weekday, nowHM) {
  return [
    'Você organiza o que uma pessoa da equipe do Podcast Pulso falou em voz alta e transforma em UMA tarefa clara. Português do Brasil, direto, sem enfeite.',
    `Hoje é ${weekday}, ${today} (AAAA-MM-DD), agora são ${nowHM} em Brasília. Quem está falando: ${user.name}.`,
    'Regras:',
    '- Não invente nada: nomes, números, datas, links ou etapas que a pessoa não disse ficam de fora.',
    '- "titulo": uma frase curta no imperativo, começando com verbo (ex.: "Confirmar a pauta com a Dra. Ana"). Sem ponto final, sem emoji, no máximo 90 caracteres.',
    '- "descricao": só o que ajuda a executar (contexto, passos, números e nomes ditos), em frases curtas. Use lista com "- " se houver mais de dois passos. Não repita o título, não escreva saudação nem "Tarefa:". Vazia se não houver detalhe além do título.',
    '- Tire hesitações, repetições e conversa solta ("hum", "tipo", "então", "né"), mantendo o sentido e a ordem do que foi dito.',
    '- "responsavel_id": o id da pessoa da EQUIPE a quem a tarefa é dirigida, se a fala citar o nome (primeiro nome ou apelido óbvio servem). "eu", "para mim", "eu mesmo" = quem está falando. Se ninguém foi citado, null. Se citou um nome que não está na equipe, deixe null e escreva o nome em "responsavel_citado".',
    '- "vence_em": data AAAA-MM-DD se houver prazo ("amanhã", "sexta", "dia 25", "até o fim da semana" = sexta-feira). Nunca no passado. Sem prazo, null.',
    '- "vence_hora": HH:MM (24 h, horário de Brasília) só se a pessoa disse uma hora ("às 14", "14 horas", "duas da tarde", "até o meio-dia" = 12:00); sem hora dita, null. Se disse só a hora ("entrega às 14h"), "vence_em" é hoje; se essa hora de hoje já passou, é amanhã.',
    '- "tipo": geral, cortes, bastidores, extra ou outro; geral em caso de dúvida.',
    '- "episodio_id", "convidado_id", "patrocinador_id": só se a fala citar claramente um item das listas; senão null.',
    '- Se a fala não tiver nenhuma tarefa (silêncio, ruído, só conversa), devolva "titulo" vazio.',
  ].join('\n');
}

const list = (rows, line) => (rows.length ? rows.map(line).join('\n') : '(nenhum)');

// Devolve { draft, warnings } ou { error }. `now` só existe para teste.
async function organize({ text, user, now = new Date() }) {
  const speech = String(text || '').trim().slice(0, 6000);
  if (!speech) return { error: 'Não ouvi nada na gravação.' };
  const ctx = await context();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
  const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long' }).format(now);
  const nowHM = tasks.nowTime(now);
  const prompt = [
    `EQUIPE (id | nome):\n${list(ctx.users, (u) => `${u.id} | ${u.name}`)}`,
    `EPISÓDIOS (id | número | título):\n${list(ctx.episodes, (e) => `${e.id} | ${e.number || '—'} | ${e.title}`)}`,
    `CONVIDADOS (id | nome):\n${list(ctx.guests, (g) => `${g.id} | ${g.name}`)}`,
    `PATROCINADORES (id | empresa):\n${list(ctx.sponsors, (s) => `${s.id} | ${s.company}`)}`,
    `FALA TRANSCRITA:\n"""${speech}"""`,
  ].join('\n\n');
  const { data } = await gemini.generateJson({ system: systemPrompt(user, today, weekday, nowHM), parts: [{ text: prompt }], schema: SCHEMA, temperature: 0.2, thinking: 'low', timeoutMs: 45_000, attempts: 2 });

  const title = String(data.titulo || '').replace(/\s+/g, ' ').trim().replace(/[.。]+$/, '').slice(0, 200);
  if (!title) return { error: 'Não encontrei uma tarefa nessa fala. Tente de novo dizendo o que precisa ser feito.' };
  const has = (rows, id, key = 'id') => rows.find((r) => String(r[key]) === String(id));
  const warnings = [];
  const assignee = data.responsavel_id && has(ctx.users, data.responsavel_id) ? String(data.responsavel_id) : null;
  if (!assignee && data.responsavel_citado && String(data.responsavel_citado).trim()) warnings.push(`Não achei "${String(data.responsavel_citado).trim().slice(0, 60)}" na equipe: escolha o responsável.`);
  let due = ISO.test(String(data.vence_em || '')) ? data.vence_em : null;
  if (due && (!tasks.parse({ title: 'x', due_on: due }).values.due_on || due < today)) due = null;
  let time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(data.vence_hora || '')) ? data.vence_hora : null;
  if (time && !due) due = time > nowHM ? today : tasks.addDays(today, 1); // só a hora: hoje, ou amanhã se já passou
  if (time && due === today && time < nowHM) time = null;            // hora que já passou hoje não vale
  if (!due) time = null;
  return {
    draft: {
      title,
      description: String(data.descricao || '').replace(/\r/g, '').trim().slice(0, 4000),
      assignee_id: assignee,
      due_on: due,
      due_time: time,
      kind: Object.prototype.hasOwnProperty.call(C.TASK_KINDS, data.tipo) ? data.tipo : 'geral',
      episode_id: has(ctx.episodes, data.episodio_id) ? Number(data.episodio_id) : null,
      guest_id: has(ctx.guests, data.convidado_id) ? Number(data.convidado_id) : null,
      sponsor_id: has(ctx.sponsors, data.patrocinador_id) ? Number(data.patrocinador_id) : null,
    },
    warnings,
  };
}

module.exports = { organize, SCHEMA };
