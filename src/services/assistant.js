// Assistente de IA do painel: conversa com histórico (por pessoa), entende texto ou áudio (Groq Whisper) e consulta o sistema
// por ferramentas que respeitam o perfil de quem pergunta (nunca mostra o que a pessoa não poderia ver no painel).
// Só uma ação muda dados: criar tarefa, e só quando a pessoa pede.
const db = require('../db/pool');
const gemini = require('./gemini');
const search = require('./search');
const tasksSvc = require('./tasks');
const C = require('../constants');
const { can, ROLES } = require('../permissions');
const fmt = require('../utils/format');

const MAX_HISTORY = 20; // mensagens que vão como contexto
const MAX_ROUNDS = 4;   // voltas de ferramenta por pergunta

const when = (d) => (d ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(d)) : null);
const epNo = (n) => (n ? `EP.${String(n).padStart(3, '0')}` : 'EP sem número');
const like = (s) => `%${String(s || '').replace(/[\\%_]/g, '\\$&').slice(0, 80)}%`;

// ---------------------------------------------------------------- ferramentas
const TOOLS = [
  {
    perm: null,
    decl: { name: 'buscar', description: 'Busca no painel (convidados, patrocinadores, episódios, tarefas, cortes, páginas e atalhos). Use para achar algo pelo nome.', parameters: { type: 'OBJECT', properties: { termo: { type: 'STRING' } }, required: ['termo'] } },
    async run({ termo }, user) {
      const r = await search.search(termo, user);
      return r.groups.map((g) => ({ grupo: g.label, itens: g.items.slice(0, 6).map((i) => ({ titulo: i.title, detalhe: i.sub || null, link: i.url })) }));
    },
  },
  {
    perm: 'tasks.read',
    decl: { name: 'tarefas', description: 'Lista tarefas. escopo: "minhas" (abertas da pessoa), "hoje" (vencendo hoje ou atrasadas da pessoa) ou "todas" (da equipe).', parameters: { type: 'OBJECT', properties: { escopo: { type: 'STRING', enum: ['minhas', 'hoje', 'todas'] } } } },
    async run({ escopo = 'minhas' }, user) {
      const rows = await tasksSvc.list({ user, scope: ['minhas', 'hoje', 'todas'].includes(escopo) ? escopo : 'minhas' });
      return rows.filter((t) => t.status !== 'feito').slice(0, 25).map((t) => ({
        titulo: t.title, status: C.TASK_STATUSES[t.status], vence: t.due_on ? fmt.formatDay(t.due_on) : null, responsavel: t.assignee_name || null,
        bloqueio: t.block_reason || null, link: `/tarefas/${t.id}`,
      }));
    },
  },
  {
    perm: 'guests.read',
    decl: { name: 'agenda', description: 'Gravações marcadas (convidados em Agendado e Em agendamento com data) dos próximos dias, com reservas de patrocinadores.', parameters: { type: 'OBJECT', properties: { dias: { type: 'NUMBER' } } } },
    async run({ dias = 30 }) {
      const { rows } = await db.query(
        `SELECT g.id, g.name, g.status, g.proposed_at, (SELECT string_agg(s.company, ', ') FROM sponsor_bookings b JOIN sponsors s ON s.id = b.sponsor_id WHERE b.guest_id = g.id) AS sponsors
           FROM guests g WHERE g.status IN ('agendado', 'em_agendamento') AND (g.proposed_at IS NULL OR g.proposed_at BETWEEN now() - interval '1 day' AND now() + ($1 || ' days')::interval)
          ORDER BY g.proposed_at NULLS LAST LIMIT 30`, [String(Math.min(180, Math.max(1, Number(dias) || 30)))]);
      return rows.map((g) => ({ convidado: g.name, etapa: C.STATUS_BY_KEY[g.status].label, gravacao: when(g.proposed_at) || 'data a definir', patrocinio: g.sponsors || null, link: `/convidados/${g.id}` }));
    },
  },
  {
    perm: 'episodes.read',
    decl: { name: 'episodios', description: 'Episódios em produção e onde cada um está (etapa, editor). Com "numero" ou "texto", detalha um episódio: o que falta para o próximo passo, tarefas abertas e conteúdo.', parameters: { type: 'OBJECT', properties: { numero: { type: 'NUMBER' }, texto: { type: 'STRING' } } } },
    async run({ numero, texto }, user) {
      const prod = require('./production');
      if (numero || texto) {
        const { rows: [ep] } = await db.query(
          `SELECT e.*, g.name AS guest_name, u.name AS editor_name FROM episodes e LEFT JOIN guests g ON g.id = e.guest_id LEFT JOIN users u ON u.id = e.editor_id
            WHERE ($1::int IS NOT NULL AND e.number = $1) OR ($2::text IS NOT NULL AND (e.title ILIKE $2 OR g.name ILIKE $2)) ORDER BY e.number DESC NULLS LAST LIMIT 1`,
          [numero ? Number(numero) : null, texto ? like(texto) : null]);
        if (!ep) return { erro: 'Episódio não encontrado.' };
        const [moves, tasks, clips] = await Promise.all([
          prod.availableMoves(ep, user.role),
          db.query("SELECT title, status, due_on FROM tasks WHERE episode_id = $1 AND status <> 'feito' ORDER BY due_on NULLS LAST", [ep.id]),
          db.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'pronto')::int AS prontos FROM episode_clips WHERE episode_id = $1", [ep.id]),
        ]);
        return {
          episodio: `${epNo(ep.number)} ${ep.title}`, etapa: C.EPISODE_STATUSES[ep.status], convidado: ep.guest_name, editor: ep.editor_name, gravado_em: ep.recorded_on ? fmt.formatDay(ep.recorded_on) : null,
          proximos_passos: moves.map((m) => ({ acao: m.label, pode_fazer: m.allowed, falta: m.missing })),
          tarefas_abertas: tasks.rows.map((t) => ({ titulo: t.title, status: C.TASK_STATUSES[t.status], vence: t.due_on ? fmt.formatDay(t.due_on) : null })),
          cortes: clips.rows[0], link: `/episodios/${ep.id}`,
        };
      }
      const { rows } = await db.query(
        `SELECT e.id, e.number, e.title, e.status, u.name AS editor_name FROM episodes e LEFT JOIN users u ON u.id = e.editor_id
          WHERE e.status <> 'publicado' ORDER BY e.number DESC NULLS LAST LIMIT 30`);
      return rows.map((e) => ({ episodio: `${epNo(e.number)} ${e.title}`, etapa: C.EPISODE_STATUSES[e.status], editor: e.editor_name || null, link: `/episodios/${e.id}` }));
    },
  },
  {
    perm: 'guests.read',
    decl: { name: 'convidado', description: 'Situação de um convidado pelo nome: etapa, contato, gravação, convite e o próximo passo.', parameters: { type: 'OBJECT', properties: { nome: { type: 'STRING' } }, required: ['nome'] } },
    async run({ nome }) {
      const { rows: [g] } = await db.query('SELECT g.*, u.name AS owner_name FROM guests g LEFT JOIN users u ON u.id = g.owner_id WHERE g.name ILIKE $1 OR g.instagram ILIKE $1 ORDER BY g.updated_at DESC LIMIT 1', [like(nome)]);
      if (!g) return { erro: 'Convidado não encontrado.' };
      const next = {
        prospect: g.invite_token ? 'Enviar o convite (e-mail ou WhatsApp).' : 'Gerar o link do convite.',
        convite_enviado: 'Esperar a resposta ou registrar que aceitou ou marcar como perdido (com o motivo).',
        em_agendamento: g.proposed_at ? 'Confirmar a data com estúdio, hosts e convidado.' : 'Definir a data da gravação.',
        agendado: 'Gravar e marcar como gravado (aí nasce o episódio).', gravado: 'A parte do convidado acabou; o resto é o episódio.',
        perdido: 'Retomar contato, se fizer sentido.', cancelado: 'Retomar contato, se fizer sentido.',
      }[g.status];
      return {
        convidado: g.name, instagram: g.instagram ? `@${g.instagram}` : null, etapa: C.STATUS_BY_KEY[g.status].label, responsavel: g.owner_name,
        contato: [g.email, g.phone].filter(Boolean).join(' · ') || 'sem contato', gravacao: when(g.proposed_at),
        convite: { enviado: when(g.invite_sent_at), aberto: when(g.invite_viewed_at) }, proximo_passo: next, link: `/convidados/${g.id}`,
      };
    },
  },
  {
    perm: 'sponsors.read',
    decl: { name: 'patrocinador', description: 'Situação de um patrocinador pelo nome: etapa, cota, formulário (pendências), entregas e gravações reservadas.', parameters: { type: 'OBJECT', properties: { nome: { type: 'STRING' } }, required: ['nome'] } },
    async run({ nome }) {
      const sp = require('./sponsors');
      const { rows: [s] } = await db.query('SELECT * FROM sponsors WHERE company ILIKE $1 ORDER BY updated_at DESC LIMIT 1', [like(nome)]);
      if (!s) return { erro: 'Patrocinador não encontrado.' };
      const [brief, logo, deliv, eps, books] = await Promise.all([
        sp.loadBrief(s.id), sp.hasLogoFile(s.id),
        require('./plans').deliverablesOf(s.id).then((rows) => ({ rows })),
        db.query('SELECT e.number, e.title, e.status, se.role FROM sponsor_episodes se JOIN episodes e ON e.id = se.episode_id WHERE se.sponsor_id = $1', [s.id]),
        db.query('SELECT g.name, g.proposed_at, b.role FROM sponsor_bookings b JOIN guests g ON g.id = b.guest_id WHERE b.sponsor_id = $1', [s.id]),
      ]);
      const st = sp.briefState(brief, { hasLogo: logo });
      return {
        patrocinador: s.company, etapa: C.SPONSOR_STAGE_BY_KEY[s.stage].label, cota: s.tier ? C.SPONSOR_TIERS[s.tier] : null, valor: s.value_cents != null ? fmt.formatBRL(s.value_cents) : null,
        formulario: `${st.answered} de ${st.total} respondidas${st.pending ? `; pendentes: ${st.pendingTitles.join(', ')}` : ''}`,
        entregaveis: deliv.rows.map((d) => `${d.label}${d.qty ? ` (${d.qty})` : ''}: ${C.DELIVERABLE_STATUSES[d.status]}`),
        episodios: eps.rows.map((e) => `${epNo(e.number)} ${e.title} (${e.role}, ${C.EPISODE_STATUSES[e.status]})`),
        gravacoes_reservadas: books.rows.map((b) => `${b.name} em ${when(b.proposed_at) || 'data a definir'} (${b.role})`),
        link: `/patrocinadores/${s.id}`,
      };
    },
  },
  {
    perm: 'social.read',
    decl: { name: 'social', description: 'Resumo das redes: posts esperando aprovação, agendados, com erro, conteúdo ainda não usado e ideias esperando.', parameters: { type: 'OBJECT', properties: {} } },
    async run() {
      const social = require('./social');
      const [pubs, clips, imgs, ideas] = await Promise.all([
        db.query("SELECT status, count(*)::int AS n FROM episode_publications WHERE status IN ('revisao','recusado','agendado','erro') GROUP BY status"),
        social.unusedClips(), social.unusedImages(), db.query("SELECT count(*)::int AS n FROM social_ideas WHERE status = 'sugerida'"),
      ]);
      const by = Object.fromEntries(pubs.rows.map((r) => [r.status, r.n]));
      return {
        esperando_aprovacao: by.revisao || 0, devolvidos: by.recusado || 0, agendados: by.agendado || 0, com_erro: by.erro || 0,
        sem_uso: { cortes: clips.length, posts: imgs.posts.length, carrosseis: imgs.carousels.length, stories: imgs.stories.length },
        ideias_esperando: ideas.rows[0].n, links: { publicacoes: '/social/publicacoes', novo_post: '/social/novo', ideias: '/social/ideias' },
      };
    },
  },
  {
    perm: 'tasks.write',
    decl: { name: 'criar_tarefa', description: 'Cria uma tarefa. SÓ use quando a pessoa pedir claramente para criar/anotar uma tarefa. vencimento no formato AAAA-MM-DD.', parameters: { type: 'OBJECT', properties: { titulo: { type: 'STRING' }, descricao: { type: 'STRING' }, vencimento: { type: 'STRING' } }, required: ['titulo'] } },
    async run({ titulo, descricao, vencimento }, user) {
      const { values, error } = tasksSvc.parse({ title: titulo, description: descricao || '', due_on: /^\d{4}-\d{2}-\d{2}$/.test(vencimento || '') ? vencimento : '' });
      if (error) return { erro: error };
      const t = await tasksSvc.create({ values, user, assigneeId: user.id, notifyAssignee: false });
      return { criada: true, titulo: t.title, vence: t.due_on ? fmt.formatDay(t.due_on) : null, link: `/tarefas/${t.id}` };
    },
  },
];

const toolsFor = (user) => TOOLS.filter((t) => !t.perm || can(user.role, t.perm));

function systemPrompt(user, page) {
  const today = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full' }).format(new Date());
  return [
    'Você é o assistente do Pulso Gestão, o painel da equipe do Podcast Pulso ("As conversas que estão movimentando a saúde").',
    `Hoje é ${today}. Quem pergunta: ${user.name} (${ROLES[user.role]?.label || user.role}).${page ? ` A pessoa está na página ${page}.` : ''}`,
    'Tom: português do Brasil, direto e cordial, frases curtas, sem exclamações, sem emoji, sem superlativos. Responda em poucas linhas; use listas curtas com "-" quando ajudar.',
    'Use as ferramentas para responder sobre dados do painel (agenda, tarefas, episódios, convidados, patrocinadores, redes). Nunca invente números, nomes ou datas: se a ferramenta não trouxer, diga que não encontrou.',
    'Quando citar algo do painel, inclua o link no formato [texto](/caminho) usando os links que as ferramentas devolvem.',
    'Como o sistema funciona: convidado vai de Prospecção a Gravado (a parte da pessoa); Agendado é a agenda (aparece no media kit e no portal dos patrocinadores, que podem reservar a gravação); quando grava, nasce o episódio, que vai de Gravado a Publicado (material bruto, edição, revisão, finalização com IA, publicação). Cortes são enviados em Conteúdo e atribuídos a um episódio. Social: publicações, novo post (produtora pede e a gestão aprova), ideias por episódio, insights e automações de comentários e directs. Patrocinador: Prospecção, Em negociação, Ganho (formulário de cadastro), Ativo (portal e entregas). Tarefas têm lista, quadro e calendário.',
    'Para criar tarefa, use criar_tarefa apenas quando a pessoa pedir; confirme o que foi criado. Você não publica, não move etapas e não apaga nada: explique onde a pessoa faz isso no painel.',
  ].join('\n');
}

// ---------------------------------------------------------------- conversas
async function conversations(userId) {
  const { rows } = await db.query(
    `SELECT c.id, c.title, c.updated_at, (SELECT count(*)::int FROM assistant_messages m WHERE m.conversation_id = c.id) AS messages
       FROM assistant_conversations c WHERE c.user_id = $1 ORDER BY c.updated_at DESC LIMIT 50`, [userId]);
  return rows;
}

async function getConversation(userId, id) {
  const { rows: [c] } = await db.query('SELECT * FROM assistant_conversations WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!c) return null;
  const { rows } = await db.query('SELECT id, role, content, meta, created_at FROM assistant_messages WHERE conversation_id = $1 ORDER BY id', [c.id]);
  return { ...c, messages: rows };
}

const removeConversation = (userId, id) => db.query('DELETE FROM assistant_conversations WHERE id = $1 AND user_id = $2', [id, userId]).then((r) => r.rowCount > 0);

// Uma pergunta. Devolve { conversation, reply, tools } ou lança erro com mensagem amigável.
async function ask({ user, conversationId = null, text, page = null, audio = false }) {
  const question = String(text || '').trim().slice(0, 4000);
  if (!question) throw Object.assign(new Error('Escreva ou grave a pergunta.'), { status: 400 });
  let conv = conversationId ? (await db.query('SELECT * FROM assistant_conversations WHERE id = $1 AND user_id = $2', [conversationId, user.id])).rows[0] : null;
  if (!conv) ({ rows: [conv] } = await db.query('INSERT INTO assistant_conversations (user_id, title) VALUES ($1, $2) RETURNING *', [user.id, question.replace(/\s+/g, ' ').slice(0, 60)]));
  await db.query('INSERT INTO assistant_messages (conversation_id, role, content, meta) VALUES ($1, $2, $3, $4)', [conv.id, 'user', question, JSON.stringify({ audio, page })]);

  const { rows: history } = await db.query(
    'SELECT role, content FROM (SELECT * FROM assistant_messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2) h ORDER BY id', [conv.id, MAX_HISTORY]);
  const contents = history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const tools = toolsFor(user);
  const used = [];
  let reply = '';
  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const r = await gemini.chat({ system: systemPrompt(user, page), contents, tools: tools.map((t) => t.decl) });
      if (!r.calls.length) { reply = r.text; break; }
      contents.push({ role: 'model', parts: r.parts });
      const responses = [];
      for (const call of r.calls) {
        const tool = tools.find((t) => t.decl.name === call.name);
        let result;
        try { result = tool ? await tool.run(call.args || {}, user) : { erro: 'Ferramenta não disponível para o seu perfil.' }; } catch (err) { console.error(`[assistente] ${call.name}:`, err.message); result = { erro: 'Não consegui consultar agora.' }; }
        used.push(call.name);
        responses.push({ functionResponse: { name: call.name, response: { resultado: result } } });
      }
      contents.push({ role: 'user', parts: responses });
      if (round === MAX_ROUNDS - 1) reply = 'Precisei consultar coisas demais para responder. Pode perguntar de um jeito mais específico?';
    }
  } catch (err) {
    console.error('[assistente]', err.message);
    reply = gemini.friendlyError(err);
    await db.query('INSERT INTO assistant_messages (conversation_id, role, content, meta) VALUES ($1, $2, $3, $4)', [conv.id, 'assistant', reply, JSON.stringify({ error: true })]);
    await db.query('UPDATE assistant_conversations SET updated_at = now() WHERE id = $1', [conv.id]);
    return { conversation: { id: conv.id, title: conv.title }, reply, tools: used, error: true };
  }
  reply = reply || 'Não encontrei uma resposta para isso.';
  await db.query('INSERT INTO assistant_messages (conversation_id, role, content, meta) VALUES ($1, $2, $3, $4)', [conv.id, 'assistant', reply.slice(0, 8000), JSON.stringify({ tools: used })]);
  await db.query('UPDATE assistant_conversations SET updated_at = now() WHERE id = $1', [conv.id]);
  return { conversation: { id: conv.id, title: conv.title }, reply, tools: used };
}

module.exports = { TOOLS, toolsFor, systemPrompt, conversations, getConversation, removeConversation, ask };
