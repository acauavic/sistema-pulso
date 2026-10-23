// Consultas do assistente sobre as partes do sistema que ele não conhecia: como fazer as coisas, cadência de follow-up, plateia,
// financeiro e estoque, notificações, novidades, equipe e comentários. Todas respeitam o perfil de quem pergunta.
const db = require('../db/pool');
const C = require('../constants');
const knowledge = require('./assistantKnowledge');
const lookup = require('./assistantLookup');
const { can, ROLES, PERMISSIONS } = require('../permissions');
const fmt = require('../utils/format');

const when = (d) => (d ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(d)) : null);
const cap = (n, def, max) => Math.min(max, Math.max(1, Number(n) || def));
const roleNames = (perm) => (perm && PERMISSIONS[perm] ? PERMISSIONS[perm].map((r) => ROLES[r].label) : null);

const TOOLS = [
  {
    perm: null,
    decl: { name: 'como_fazer', description: `Explica como fazer algo no painel (passos e onde fica), com o que o sistema faz hoje. Use SEMPRE que a pessoa perguntar "como faço...", "onde fica...", "como funciona..." ou quiser entender um recurso. Assuntos: ${knowledge.index().join(', ')}. Devolve também quem faz o passo e se o perfil de quem pergunta faz.`, parameters: { type: 'OBJECT', properties: { assunto: { type: 'STRING' } }, required: ['assunto'] } },
    async run({ assunto }, user) {
      const topics = knowledge.find(assunto, 2);
      if (!topics.length) return { erro: 'Não tenho um guia para esse assunto.', assuntos_que_conheco: knowledge.index() };
      return topics.map((t) => ({
        assunto: t.title, onde: t.where, passos: t.steps,
        ...(t.perm ? { quem_faz: roleNames(t.perm), seu_perfil_faz: can(user.role, t.perm) } : {}),
      }));
    },
  },
  {
    perm: null,
    decl: { name: 'follow_ups', description: 'Cadência de follow-up: convidados em "Convite enviado" e patrocinadores em "Prospecção" que precisam de abordagem hoje, atrasados ou com possível perda por falta de resposta, e a meta diária. quem: "meus" (padrão: os da pessoa e os sem responsável) ou "todos" (só a gestão).', parameters: { type: 'OBJECT', properties: { quem: { type: 'STRING', enum: ['meus', 'todos'] } } } },
    async run({ quem = 'meus' }, user) {
      const outreach = require('./outreach');
      const canGuests = can(user.role, 'guests.read'); const canSponsors = can(user.role, 'sponsors.read');
      if (!canGuests && !canSponsors) return { erro: 'O seu perfil não vê convidados nem patrocinadores.' };
      const STATE = { hoje: 'hoje', atrasado: 'atrasado', possivel_perdido: 'possível perdido (sem resposta)' };
      const shape = (x) => ({ tipo: x.kind === 'guest' ? 'convidado' : 'patrocinador', nome: x.name, situacao: STATE[x.state] || x.state, responsavel: x.owner_name || 'sem responsável', link: `${x.kind === 'guest' ? '/convidados' : '/patrocinadores'}/${x.id}` });
      const allowedKind = (x) => (x.kind === 'guest' ? canGuests : canSponsors);
      if (quem === 'todos') {
        if (!can(user.role, 'outreach.manage')) return { erro: 'Só a gestão vê os follow-ups de todo mundo.' };
        const [g, s] = await Promise.all([outreach.evaluateAll('guest'), outreach.evaluateAll('sponsor')]);
        const items = [...g.values(), ...s.values()].filter((x) => outreach.NEEDS.has(x.state) && allowedKind(x));
        return { total: items.length, itens: items.slice(0, 25).map(shape), painel: '/gestao/cadencia' };
      }
      const t = await outreach.todayFor(user);
      const items = t.items.filter(allowedKind);
      return { total: items.length, itens: items.slice(0, 25).map(shape), patrocinadores_a_abordar_hoje: t.toApproach, meta_diaria_de_patrocinadores: t.goal && t.goal.target != null ? { meta: t.goal.target, feitas_hoje: t.goal.done } : undefined, como_registrar: 'Use registrar_abordagem depois de abordar.' };
    },
  },
  {
    perm: 'audience.read',
    decl: { name: 'plateia', description: 'Pulso Podcast com Plateia: pedidos de vaga (nome, WhatsApp, situação, pagamento), resumo por situação e as próximas gravações com quantos pedidos e quantos selecionados. convidado: nome do convidado da gravação (opcional). situacao: novo, em_atendimento (em avaliação), confirmado (selecionado), nao_selecionado ou desistiu (opcional).', parameters: { type: 'OBJECT', properties: { convidado: { type: 'STRING' }, situacao: { type: 'STRING', enum: ['novo', 'em_atendimento', 'confirmado', 'nao_selecionado', 'desistiu'] }, limite: { type: 'NUMBER' } } } },
    async run({ convidado, situacao, limite }) {
      const LABEL = { novo: 'Novo pedido', em_atendimento: 'Em avaliação', confirmado: 'Selecionado', nao_selecionado: 'Não selecionado', desistiu: 'Desistiu' };
      const p = []; const w = [];
      if (convidado) { p.push(lookup.like(convidado)); w.push(`l.guest_name ILIKE $${p.length}`); }
      if (situacao && LABEL[situacao]) { p.push(situacao); w.push(`l.status = $${p.length}`); }
      const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
      const [{ rows: summary }, { rows: leads }, { rows: next }] = await Promise.all([
        db.query(`SELECT l.status, count(*)::int AS n FROM plateia_leads l ${convidado ? `WHERE l.guest_name ILIKE $1` : ''} GROUP BY l.status`, convidado ? [lookup.like(convidado)] : []),
        db.query(`SELECT l.id, l.name, l.phone, l.status, l.guest_name, l.recording_at, l.added_by, l.amount_cents, e.status AS pay_status, e.due_on AS pay_due
                    FROM plateia_leads l LEFT JOIN fin_entries e ON e.id = l.entry_id AND e.status <> 'cancelado' ${where} ORDER BY l.created_at DESC LIMIT ${cap(limite, 15, 30)}`, p),
        db.query(`SELECT g.id, g.name, g.proposed_at, count(l.id)::int AS pedidos, count(l.id) FILTER (WHERE l.status = 'confirmado')::int AS selecionados
                    FROM guests g LEFT JOIN plateia_leads l ON l.guest_id = g.id WHERE g.status = 'agendado' AND g.proposed_at > now() GROUP BY g.id ORDER BY g.proposed_at LIMIT 8`),
      ]);
      return {
        por_situacao: Object.fromEntries(summary.map((r) => [LABEL[r.status], r.n])),
        proximas_gravacoes: next.map((g) => ({ convidado: g.name, gravacao: when(g.proposed_at), pedidos: g.pedidos, selecionados: g.selecionados, link: `/plateia/painel?convidado=${g.id}` })),
        pedidos: leads.map((l) => ({
          id: l.id, nome: l.name, whatsapp: l.phone, situacao: LABEL[l.status], convidado: l.guest_name, gravacao: when(l.recording_at), adicionado_pela_equipe: Boolean(l.added_by) || undefined,
          pagamento: l.status !== 'confirmado' ? undefined : (l.amount_cents != null && Number(l.amount_cents) === 0 ? 'isento' : l.pay_status === 'pago' ? 'recebido' : `a receber${l.amount_cents != null ? ` ${fmt.formatBRL(Number(l.amount_cents))}` : ''}`),
        })),
        ver_tudo: '/plateia/painel',
      };
    },
  },
  {
    perm: 'finance.read',
    decl: { name: 'financeiro', description: 'Resumo do financeiro: números do mês (recebido, pago, a receber, a pagar), caixa de hoje, o que está atrasado, o que vence nos próximos 7 dias e itens do estoque para repor.', parameters: { type: 'OBJECT', properties: {} } },
    async run(_, user) {
      const fin = require('./finance');
      const o = await fin.overview({ months: 3 });
      const brl = (c) => fmt.formatBRL(Number(c));
      const e = (x) => ({ descricao: x.description, valor: brl(x.amount_cents), vence: fmt.formatDay(x.due_on), tipo: x.direction === 'entrada' ? 'a receber' : 'a pagar', atrasada: x.due_on < fin.todayISO() || undefined });
      return {
        mes: o.month.label, recebido: brl(o.month.in_paid), pago: brl(o.month.out_paid), resultado: brl(o.month.result), a_receber_no_mes: brl(o.month.in_open), a_pagar_no_mes: brl(o.month.out_open),
        caixa_hoje: brl(o.cash), atrasado_a_pagar: brl(o.late.out), atrasado_a_receber: brl(o.late.in), a_pagar_nos_proximos_7_dias: brl(o.out7),
        vencendo_ou_atrasadas: o.attention.map(e),
        projecao: o.forecast.map((f) => ({ mes: f.label, entra: brl(f.in), sai: brl(f.out), saldo_ao_fim: brl(f.balance) })),
        estoque_para_repor: can(user.role, 'stock.read') ? o.stock.map((i) => ({ item: i.name, situacao: fin.STOCK_STATE[i.state] })) : undefined,
        links: { resumo: '/financeiro', contas: '/financeiro/contas' },
      };
    },
  },
  {
    perm: 'finance.read',
    decl: { name: 'contas', description: 'Lista lançamentos em aberto do financeiro. escopo: "pagar", "receber" ou "atrasadas" (a pagar e a receber vencidas). busca: parte da descrição, fornecedor ou patrocinador.', parameters: { type: 'OBJECT', properties: { escopo: { type: 'STRING', enum: ['pagar', 'receber', 'atrasadas'] }, busca: { type: 'STRING' }, limite: { type: 'NUMBER' } } } },
    async run({ escopo = 'pagar', busca = '', limite }) {
      const fin = require('./finance');
      const today = fin.todayISO();
      let rows;
      if (escopo === 'atrasadas') rows = [...await fin.entries({ scope: 'pagar', q: busca }), ...await fin.entries({ scope: 'receber', q: busca })].filter((x) => x.due_on < today).sort((a, b) => a.due_on.localeCompare(b.due_on));
      else rows = await fin.entries({ scope: escopo === 'receber' ? 'receber' : 'pagar', q: busca });
      const total = rows.reduce((n, x) => n + x.amount_cents, 0);
      return {
        total_de_lancamentos: rows.length, soma: fmt.formatBRL(total),
        lancamentos: rows.slice(0, cap(limite, 12, 25)).map((x) => ({
          descricao: x.description, valor: fmt.formatBRL(x.amount_cents), vence: fmt.formatDay(x.due_on), tipo: x.direction === 'entrada' ? 'a receber' : 'a pagar', categoria: C.FIN_CATEGORIES[x.category] || x.category,
          ligado_a: x.sponsor_name || (x.episode_number ? `EP.${String(x.episode_number).padStart(3, '0')}` : x.guest_name) || undefined, atrasada: x.due_on < today || undefined,
        })),
        ver_no_painel: '/financeiro/contas',
      };
    },
  },
  {
    perm: 'stock.read',
    decl: { name: 'estoque', description: 'Estoque do estúdio: itens que precisam de reposição (acabou, comprar agora ou em breve) ou, com todos=true, todos os itens com a quantidade.', parameters: { type: 'OBJECT', properties: { todos: { type: 'BOOLEAN' } } } },
    async run({ todos = false }) {
      const fin = require('./finance');
      const items = (await fin.stockItems()).filter((i) => i.active && (todos || i.state !== 'ok'));
      return { itens: items.slice(0, 40).map((i) => ({ item: i.name, quantidade: `${i.qty} ${i.unit}`, situacao: fin.STOCK_STATE[i.state], fornecedor: i.supplier || undefined })), ver_no_painel: '/financeiro/estoque' };
    },
  },
  {
    perm: null,
    decl: { name: 'notificacoes', description: 'As notificações não lidas de quem pergunta (as mais recentes primeiro). Use para "o que tenho de novo?".', parameters: { type: 'OBJECT', properties: { limite: { type: 'NUMBER' } } } },
    async run({ limite }, user) {
      const [{ rows }, { rows: [c] }] = await Promise.all([
        db.query('SELECT title, body, url, created_at FROM notifications WHERE user_id = $1 AND read_at IS NULL ORDER BY created_at DESC LIMIT $2', [user.id, cap(limite, 10, 20)]),
        db.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [user.id]),
      ]);
      return { nao_lidas: c.n, mais_recentes: rows.map((n) => ({ aviso: n.title, detalhe: n.body || undefined, quando: when(n.created_at), link: n.url || undefined })), ver_todas: '/notificacoes' };
    },
  },
  {
    perm: null,
    decl: { name: 'novidades', description: 'O que mudou no sistema nas últimas versões (o que é novo, ajuste e correção). Use para "o que há de novo?", "qual a versão?".', parameters: { type: 'OBJECT', properties: { quantidade: { type: 'NUMBER' } } } },
    async run({ quantidade }) {
      const releases = require('../releases');
      return { versao_atual: releases[0].version, versoes: releases.slice(0, cap(quantidade, 3, 6)).map((r) => ({ versao: r.version, data: fmt.formatDay(r.date), titulo: r.title, itens: r.items.map((i) => `${{ novo: 'Novo', ajuste: 'Ajuste', correcao: 'Correção' }[i.kind] || i.kind}: ${i.text}`) })), pagina: '/novidades' };
    },
  },
  {
    perm: null,
    decl: { name: 'equipe', description: 'Quem está na equipe (nomes e perfis). Use para "quem é a produtora?", "quem edita?" ou para saber a quem direcionar algo.', parameters: { type: 'OBJECT', properties: {} } },
    async run() {
      const { rows } = await db.query('SELECT name, role FROM users WHERE active ORDER BY lower(name)');
      return rows.map((u) => ({ nome: u.name, perfil: ROLES[u.role]?.label || u.role }));
    },
  },
  {
    perm: null,
    decl: { name: 'comentarios', description: 'Os últimos comentários de um item (com áudios transcritos). tipo: convidado, patrocinador, episodio, tarefa ou corte. referencia: nome, número do episódio, título ou id. Para episódios, informa também os comentários de revisão do vídeo em aberto.', parameters: { type: 'OBJECT', properties: { tipo: { type: 'STRING', enum: ['convidado', 'patrocinador', 'episodio', 'tarefa', 'corte'] }, referencia: { type: 'STRING' }, limite: { type: 'NUMBER' } }, required: ['tipo', 'referencia'] } },
    async run({ tipo, referencia, limite }, user) {
      const comments = require('./comments');
      const map = { convidado: ['guest', lookup.guest, (r) => r.name], patrocinador: ['sponsor', lookup.sponsor, (r) => r.company], episodio: ['episode', lookup.episode, (r) => r.title], tarefa: ['task', lookup.task, (r) => r.title] };
      let type; let row; let title;
      if (tipo === 'corte') {
        type = 'clip';
        const { rows: [c] } = await db.query('SELECT id, title FROM episode_clips WHERE id::text = $1 OR title ILIKE $2 ORDER BY id DESC LIMIT 1', [String(referencia).trim(), lookup.like(referencia)]);
        if (!c) return { erro: 'Corte não encontrado.' };
        row = c; title = c.title;
      } else if (map[tipo]) {
        const [entityType, find, nameOf] = map[tipo];
        const r = await find(referencia);
        if (r.erro) return r;
        type = entityType; row = r.row; title = nameOf(row);
      } else return { erro: 'Tipo inválido.' };
      if (!comments.canSee(user.role, type)) return { erro: 'O seu perfil não vê esse item.' };
      const list = (await comments.list(type, row.id)).slice(-cap(limite, 8, 20));
      const out = {
        item: title,
        comentarios: list.map((c) => ({ quem: c.author_name || 'alguém que saiu', quando: when(c.created_at), texto: c.body || undefined, audio_transcrito: (c.attachments || []).filter((a) => a.kind === 'audio').map((a) => a.transcript || '(sem transcrição)')[0], anexos: (c.attachments || []).filter((a) => a.kind === 'file').map((a) => a.filename) })),
      };
      if (type === 'episode') {
        const { rows: [r] } = await db.query('SELECT count(*) FILTER (WHERE NOT resolved)::int AS abertos, count(*)::int AS total FROM episode_comments WHERE episode_id = $1', [row.id]);
        out.revisao_do_video = { comentarios_em_aberto: r.abertos, total: r.total, onde: `/episodios/${row.id}#revisao` };
      }
      return out;
    },
  },
];

module.exports = { TOOLS };
