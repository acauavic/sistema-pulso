// Assistente de IA do painel: conversa com histórico (por pessoa), entende texto ou áudio (Groq Whisper) e consulta o sistema
// por ferramentas que respeitam o perfil de quem pergunta (nunca mostra o que a pessoa não poderia ver no painel).
// Só duas ações mudam dados, e só quando a pessoa pede: criar tarefa e cadastrar convidado novo (em Prospecção).
const db = require('../db/pool');
const gemini = require('./gemini');
const search = require('./search');
const tasksSvc = require('./tasks');
const C = require('../constants');
const rules = require('./guestRules');
const guide = require('./assistantGuide');
const { audit } = require('./audit');
const { can, ROLES } = require('../permissions');
const fmt = require('../utils/format');
const { clean, isEmail } = fmt;

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
    perm: null,
    decl: { name: 'numeros', description: 'Números (contagens) do sistema que a pessoa pode ver: convidados por etapa e por motivo de perda, patrocinadores por etapa, episódios por etapa, tarefas, redes, plateia e financeiro. Use para "quantos...?". assunto limita a um tema (padrão: tudo).', parameters: { type: 'OBJECT', properties: { assunto: { type: 'STRING', enum: ['tudo', 'convidados', 'patrocinadores', 'episodios', 'tarefas', 'social', 'plateia', 'financeiro'] } } } },
    async run({ assunto = 'tudo' }, user) {
      const subjects = {
        convidados: { perm: 'guests.read', run: async () => {
          const [by, loss, extra] = await Promise.all([
            db.query('SELECT status, count(*)::int AS n FROM guests GROUP BY status'),
            db.query("SELECT loss_reason, count(*)::int AS n FROM guests WHERE status = 'perdido' GROUP BY loss_reason"),
            db.query(`SELECT count(*)::int AS total,
                             count(*) FILTER (WHERE owner_id IS NULL AND status NOT IN ('perdido', 'cancelado', 'gravado'))::int AS sem_responsavel,
                             count(*) FILTER (WHERE status = 'agendado' AND proposed_at BETWEEN now() AND now() + interval '7 days')::int AS agendados_7_dias,
                             count(*) FILTER (WHERE status IN ('em_agendamento', 'agendado') AND photo_key IS NULL)::int AS sem_foto
                        FROM guests`),
          ]);
          const n = Object.fromEntries(by.rows.map((r) => [r.status, r.n]));
          return {
            total: extra.rows[0].total,
            por_etapa: C.GUEST_STATUSES.map((s) => ({ etapa: s.label, quantidade: n[s.key] || 0, link: `/convidados?view=lista&status=${s.key}` })),
            motivos_de_perda: Object.fromEntries(loss.rows.map((r) => [C.LOSS_REASONS[r.loss_reason] || 'sem motivo', r.n])),
            sem_responsavel_em_andamento: extra.rows[0].sem_responsavel, agendados_nos_proximos_7_dias: extra.rows[0].agendados_7_dias,
            em_agendamento_ou_agendado_sem_foto: extra.rows[0].sem_foto,
          };
        } },
        patrocinadores: { perm: 'sponsors.read', run: async () => {
          const { rows } = await db.query('SELECT stage, count(*)::int AS n FROM sponsors GROUP BY stage');
          const n = Object.fromEntries(rows.map((r) => [r.stage, r.n]));
          return { por_etapa: C.SPONSOR_STAGES.map((s) => ({ etapa: s.label, quantidade: n[s.key] || 0 })), link: '/patrocinadores' };
        } },
        episodios: { perm: 'episodes.read', run: async () => {
          const { rows } = await db.query('SELECT status, count(*)::int AS n FROM episodes GROUP BY status');
          const n = Object.fromEntries(rows.map((r) => [r.status, r.n]));
          return { total: rows.reduce((t, r) => t + r.n, 0), por_etapa: C.EPISODE_STAGES.map((s) => ({ etapa: s.label, quantidade: n[s.key] || 0 })), link: '/episodios' };
        } },
        tarefas: { perm: 'tasks.read', run: async () => {
          const { rows: [r] } = await db.query(
            `SELECT count(*) FILTER (WHERE status <> 'feito')::int AS abertas,
                    count(*) FILTER (WHERE status <> 'feito' AND assignee_id = $1)::int AS minhas_abertas,
                    count(*) FILTER (WHERE status <> 'feito' AND due_on < CURRENT_DATE)::int AS atrasadas,
                    count(*) FILTER (WHERE status = 'bloqueada')::int AS bloqueadas FROM tasks`, [user.id]);
          return { ...r, link: '/tarefas' };
        } },
        social: { perm: 'social.read', run: () => TOOLS.find((t) => t.decl.name === 'social').run({}, user) },
        plateia: { perm: 'audience.read', run: async () => {
          const { rows } = await db.query('SELECT status, count(*)::int AS n FROM plateia_leads GROUP BY status');
          return { inscricoes_por_status: Object.fromEntries(rows.map((r) => [r.status, r.n])), link: '/plateia/painel' };
        } },
        financeiro: { perm: 'finance.read', run: async () => {
          const { rows: [r] } = await db.query(
            `SELECT count(*) FILTER (WHERE direction = 'saida' AND status = 'previsto' AND due_on < CURRENT_DATE)::int AS a_pagar_atrasadas,
                    coalesce(sum(amount_cents) FILTER (WHERE direction = 'saida' AND status = 'previsto' AND due_on < CURRENT_DATE), 0)::bigint AS a_pagar_atrasado_cents,
                    count(*) FILTER (WHERE direction = 'entrada' AND status = 'previsto' AND due_on < CURRENT_DATE)::int AS a_receber_atrasadas
               FROM fin_entries`);
          return { contas_a_pagar_atrasadas: r.a_pagar_atrasadas, valor_a_pagar_atrasado: fmt.formatBRL(Number(r.a_pagar_atrasado_cents)), contas_a_receber_atrasadas: r.a_receber_atrasadas, link: '/financeiro' };
        } },
      };
      const wanted = assunto === 'tudo' ? Object.keys(subjects) : [assunto].filter((k) => subjects[k]);
      const out = {}; const noAccess = [];
      for (const k of wanted) {
        if (!can(user.role, subjects[k].perm)) { noAccess.push(k); continue; }
        out[k] = await subjects[k].run();
      }
      if (noAccess.length) out.sem_acesso_para_o_seu_perfil = noAccess;
      return out;
    },
  },
  {
    perm: 'guests.read',
    decl: { name: 'lista_convidados', description: 'Lista os convidados de uma etapa do CRM (nomes, responsável, gravação). Use depois de "numeros" quando a pessoa quiser ver quem são. responsavel: "eu" ou parte do nome de quem cuida.', parameters: { type: 'OBJECT', properties: { etapa: { type: 'STRING', enum: C.GUEST_STATUSES.map((s) => s.key) }, responsavel: { type: 'STRING' }, limite: { type: 'NUMBER' } }, required: ['etapa'] } },
    async run({ etapa, responsavel, limite = 20 }, user) {
      const key = C.isStatus(etapa) ? etapa : rules.normalizeStatus(etapa);
      if (!key) return { erro: `Etapa desconhecida. Use: ${C.GUEST_STATUSES.map((s) => s.label).join(', ')}.` };
      const params = [key]; const where = ['g.status = $1'];
      if (responsavel) {
        if (/^(eu|meus|minhas?)$/i.test(String(responsavel).trim())) { params.push(user.id); where.push(`g.owner_id = $${params.length}`); } else { params.push(like(responsavel)); where.push(`u.name ILIKE $${params.length}`); }
      }
      const cap = Math.min(30, Math.max(1, Number(limite) || 20));
      const [{ rows: [{ total }] }, { rows }] = await Promise.all([
        db.query(`SELECT count(*)::int AS total FROM guests g LEFT JOIN users u ON u.id = g.owner_id WHERE ${where.join(' AND ')}`, params),
        db.query(`SELECT g.id, g.name, g.instagram, g.proposed_at, g.loss_reason, u.name AS owner_name FROM guests g LEFT JOIN users u ON u.id = g.owner_id
                   WHERE ${where.join(' AND ')} ORDER BY g.updated_at DESC LIMIT ${cap}`, params),
      ]);
      return {
        etapa: C.STATUS_BY_KEY[key].label, total, mostrando: rows.length,
        convidados: rows.map((g) => ({ nome: g.name, instagram: g.instagram ? `@${g.instagram}` : null, responsavel: g.owner_name || 'sem responsável', gravacao: when(g.proposed_at), motivo_da_perda: g.loss_reason ? C.LOSS_REASONS[g.loss_reason] : undefined, link: `/convidados/${g.id}` })),
        ver_todos: `/convidados?view=lista&status=${key}`,
      };
    },
  },
  {
    perm: 'guests.write',
    decl: { name: 'criar_convidado', description: 'Cadastra um convidado novo em Prospecção, com a pessoa que pediu como responsável. SÓ use quando a pessoa pedir claramente para cadastrar. Nome, Instagram e perfil são obrigatórios: se faltar algum, pergunte antes de chamar. perfil: médico, influencer, empresário ou profissional da saúde.', parameters: { type: 'OBJECT', properties: { nome: { type: 'STRING' }, instagram: { type: 'STRING' }, perfil: { type: 'STRING' }, genero: { type: 'STRING', enum: ['m', 'f'] }, email: { type: 'STRING' }, whatsapp: { type: 'STRING' }, motivo_do_convite: { type: 'STRING' }, tema: { type: 'STRING' } }, required: ['nome', 'instagram', 'perfil'] } },
    async run(a, user) {
      const name = clean(a.nome, 150);
      const instagram = rules.normalizeInstagram(a.instagram);
      const profile = rules.normalizeProfile(a.perfil);
      const gender = rules.normalizeGender(a.genero);
      const email = clean(a.email, 254).toLowerCase();
      const problems = [];
      if (name.length < 2) problems.push('nome');
      if (!instagram) problems.push(a.instagram ? 'Instagram inválido' : 'Instagram');
      if (!profile) problems.push(a.perfil ? `perfil “${a.perfil}” não reconhecido (use médico, influencer, empresário ou profissional da saúde)` : 'perfil');
      if (email && !isEmail(email)) problems.push('e-mail inválido');
      if (gender === null) problems.push('gênero (m ou f)');
      if (problems.length) return { erro: `Faltam ou estão inválidos: ${problems.join(', ')}. Peça à pessoa e tente de novo.` };
      const { rows: [dup] } = await db.query("SELECT id, name, status FROM guests WHERE lower(instagram) = $1 OR ($2 <> '' AND lower(email) = $2) LIMIT 1", [instagram, email]);
      if (dup) return { erro: `Já existe um convidado com esse Instagram ou e-mail: ${dup.name} (${C.STATUS_BY_KEY[dup.status].label}).`, link: `/convidados/${dup.id}` };
      const { rows: [g] } = await db.query(
        `INSERT INTO guests (name, instagram, phone, profile, email, invite_reason, topic, gender, owner_id, created_by, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'prospect') RETURNING id`,
        [name, instagram, clean(a.whatsapp, 40) || null, profile, email || null, clean(a.motivo_do_convite, 1000) || null, clean(a.tema, 500) || null, gender || 'm', user.id]);
      await require('./guests').addEvent(g.id, user.id, 'criado', `Cadastrado pelo assistente a pedido de ${user.name}`);
      await audit({ user, ip: 'assistente' }, 'convidado.criado', 'guest', g.id, { name, via: 'assistente' });
      return {
        criado: true, convidado: name, instagram: `@${instagram}`, perfil: C.PROFILE_BY_KEY[profile].label, etapa: 'Prospecção', responsavel: user.name,
        proximo_passo: can(user.role, 'guests.invite') ? 'Abrir o convidado e gerar o link do convite.' : 'Pedir a alguém da Gestão ou da Produção para gerar o convite.', link: `/convidados/${g.id}`,
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
    'Como o sistema funciona (use para instruir; confirme sempre se o perfil da pessoa faz o passo):',
    '- Convidados (CRM): etapas Prospecção, Convite enviado, Em agendamento, Agendado, Gravado, Perdido e Cancelado. Em agendamento e Agendado exigem a foto do convidado (enviada na página dele, bloco "Podcast com plateia"); Em agendamento pede e-mail ou WhatsApp; Agendado pede data, hora e a confirmação do estúdio, dos hosts e do convidado; Perdido pede o motivo (Recusado, Sem agenda próxima, Nunca respondeu, Parou de responder, Conflito de interesse ou Outros com descrição). A etapa muda pelo quadro (arrastar), pelo botão de próximo passo ou pela etiqueta da etapa no topo da página do convidado.',
    '- Aceite do convite: quando o convidado clica em Aceitar, vai para Em agendamento e a equipe recebe uma notificação. Se foi por engano, quem edita convidados usa "Zerar aceite e voltar para Prospecção" na aba Convite do convidado.',
    '- Edição em massa: em Convidados > Lista, marque os convidados e use "Editar em massa" para mudar etapa, responsável, perfil, gênero e patrocinador. Agendado e Gravado não vão em massa. Quem não tem o que a etapa exige fica onde está e aparece no resultado.',
    '- Importar CSV (Convidados > Importar CSV): aceita status, data da gravação, motivo da perda e, para Gravado ou Publicado, o episódio com links do YouTube e do Spotify.',
    '- Quando o convidado fica Agendado, vira agenda (media kit, portal dos patrocinadores e página da plateia). Os lembretes da gravação (3 dias, 1 dia, no dia de manhã e 3 horas antes) aparecem em Notificações > Lembretes da gravação, com a mensagem pronta e o botão do WhatsApp; a produtora envia e marca como enviado.',
    '- Quando grava, nasce o episódio: Gravado, Disponível para edição, Em edição, Em revisão, Em finalização, Pronto para publicar e Publicado (material bruto, edição, revisão, finalização com IA, publicação). Cortes são enviados em Conteúdo e atribuídos a um episódio.',
    '- Social: publicações, novo post (a produtora pede e a gestão aprova), ideias por episódio, insights e automações de comentários e directs. Patrocinador: Prospecção, Em negociação, Ganho (formulário de cadastro), Ativo (portal e entregas). Tarefas têm lista, quadro e calendário. Plateia: página pública de inscrição, com agenda gerada dos convidados agendados.',
    '- Alertas: cada pessoa liga os alertas do navegador em Notificações > Avisos > Alertas neste aparelho (no iPhone, só com o painel na Tela de Início).',
    guide.promptSection(user.role),
    'Números: para "quantos", "quanto está parado", "como está o funil", use a ferramenta numeros (e lista_convidados para dizer quem são). Cite o número exato que veio, com o link. Se o assunto aparecer em sem_acesso_para_o_seu_perfil, diga que o perfil da pessoa não vê isso e quem vê.',
    'Cadastro: se a pessoa pedir para cadastrar um convidado, use criar_convidado. Nome, Instagram e perfil são obrigatórios: pergunte o que faltar antes de chamar. Depois confirme o que foi criado e diga o próximo passo.',
    'Para criar tarefa, use criar_tarefa apenas quando a pessoa pedir; confirme o que foi criado. Você só cria tarefas e convidados novos (em Prospecção). Não muda etapas, não publica, não edita e não apaga nada: explique onde a pessoa faz isso no painel, pelo perfil dela.',
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
