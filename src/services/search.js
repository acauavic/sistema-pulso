// Busca global (Ctrl/⌘ + K): procura nos dados (convidados, patrocinadores, episódios, tarefas, cortes, pessoas) e em atalhos de ação.
// Para acompanhar a evolução do sistema: registra o que as pessoas buscam e sugere à gestão o que incluir (buscas sem resultado,
// páginas novas sem atalho, dados novos que ainda não aparecem na busca, itens abertos com frequência).
const db = require('../db/pool');
const { can } = require('../permissions');

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const like = (q) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;
const pad3 = (n) => (n ? `EP.${String(n).padStart(3, '0')}` : '');
const allowed = (user, perm) => !perm || [].concat(perm).some((p) => can(user.role, p));

// ---------------------------------------------------------------- atalhos de ação (o sistema cresce: adicione aqui ou pela Gestão > Busca)
const ACTIONS = [
  { id: 'novo-convidado', label: 'Novo convidado', keywords: 'criar adicionar cadastrar convidado crm', url: '/convidados/novo', perm: 'guests.write', group: 'Criar' },
  { id: 'importar-convidados', label: 'Importar convidados (CSV)', keywords: 'planilha csv importar convidados', url: '/convidados/importar', perm: 'guests.write', group: 'Criar' },
  { id: 'novo-patrocinador', label: 'Novo patrocinador', keywords: 'criar adicionar patrocinio marca', url: '/patrocinadores/novo', perm: 'sponsors.write', group: 'Criar' },
  { id: 'novo-episodio', label: 'Registrar episódio gravado', keywords: 'criar novo episodio gravacao feita', url: '/episodios/novo', perm: 'episodes.write', group: 'Criar' },
  { id: 'nova-tarefa', label: 'Nova tarefa', keywords: 'criar tarefa to-do afazer', url: '/tarefas?nova=1', perm: 'tasks.write', group: 'Criar' },
  { id: 'enviar-cortes', label: 'Enviar cortes', keywords: 'subir upload cortes videos reels tiktok shorts', url: '/conteudo#cortes', perm: ['production.edit', 'production.review'], group: 'Criar' },
  { id: 'convidar-usuario', label: 'Convidar pessoa para o painel', keywords: 'usuario novo acesso equipe', url: '/usuarios/novo', perm: 'users.write', group: 'Criar' },
  { id: 'novo-post', label: 'Novo post nas redes', keywords: 'publicar postar corte reels tiktok carrossel story instagram', url: '/social/novo', perm: 'social.publish', group: 'Criar' },
  { id: 'ideias-redes', label: 'Ideias para as redes', keywords: 'sugerir ideias cortes stories carrosseis ia', url: '/social/ideias', perm: 'social.read', group: 'Ir para' },
  { id: 'publicacoes', label: 'Publicações nas redes', keywords: 'posts publicados agendados social', url: '/social/publicacoes', perm: 'social.read', group: 'Ir para' },
  { id: 'insights', label: 'Insights das redes', keywords: 'metricas seguidores alcance visualizacoes numeros', url: '/social/insights', perm: 'social.read', group: 'Ir para' },
  { id: 'automacoes', label: 'Automações de comentários e directs', keywords: 'manychat resposta automatica dm direct comentario', url: '/social/automacoes', perm: 'social.read', group: 'Ir para' },
  { id: 'plateia', label: 'Plateia: inscrições e resultados', keywords: 'podcast com plateia inscricoes publico whatsapp utm agenda publica leads', url: '/plateia/painel', perm: 'audience.read', group: 'Ir para' },
  { id: 'plateia-publica', label: 'Página pública da plateia', keywords: 'plateia pagina publica link inscricao', url: '/plateia', perm: 'audience.read', group: 'Ir para' },
  { id: 'financeiro', label: 'Financeiro: caixa e contas', keywords: 'dinheiro caixa resumo fluxo custos', url: '/financeiro', perm: 'finance.read', group: 'Ir para' },
  { id: 'contas', label: 'Contas a pagar e a receber', keywords: 'pagar receber despesa gasto conta vencimento parcela lancamento', url: '/financeiro/lancamentos', perm: 'finance.read', group: 'Ir para' },
  { id: 'estoque', label: 'Estoque (canecas, caixas, brindes)', keywords: 'canecas caixas presente brindes cartoes reposicao comprar', url: '/financeiro/estoque', perm: 'stock.read', group: 'Ir para' },
  { id: 'custos-automaticos', label: 'Custos automáticos: estúdio e mensais', keywords: 'estudio hora sinal salario mensal edicao uber regras', url: '/financeiro/regras', perm: 'finance.read', group: 'Ir para' },
  { id: 'minhas-tarefas', label: 'Minhas tarefas', keywords: 'tarefas minhas lista', url: '/tarefas', perm: 'tasks.read', group: 'Ir para' },
  { id: 'tarefas-hoje', label: 'Tarefas de hoje', keywords: 'hoje vencendo atrasadas prazo', url: '/tarefas?escopo=hoje', perm: 'tasks.read', group: 'Ir para' },
  { id: 'tarefas-quadro', label: 'Quadro de tarefas', keywords: 'kanban quadro tarefas', url: '/tarefas?visao=quadro', perm: 'tasks.read', group: 'Ir para' },
  { id: 'tarefas-calendario', label: 'Calendário de tarefas', keywords: 'calendario prazos vencimentos', url: '/tarefas?visao=calendario', perm: 'tasks.read', group: 'Ir para' },
  { id: 'todas-tarefas', label: 'Todas as tarefas', keywords: 'tarefas equipe todas', url: '/tarefas?escopo=todas', perm: 'tasks.read', group: 'Ir para' },
  { id: 'notificacoes', label: 'Notificações', keywords: 'avisos sino alertas', url: '/notificacoes', group: 'Ir para' },
  { id: 'convidados', label: 'Convidados (CRM)', keywords: 'crm convidados quadro funil', url: '/convidados', perm: 'guests.read', group: 'Ir para' },
  { id: 'patrocinadores', label: 'Patrocinadores', keywords: 'patrocinio marcas funil', url: '/patrocinadores', perm: 'sponsors.read', group: 'Ir para' },
  { id: 'episodios', label: 'Episódios', keywords: 'producao linha quadro', url: '/episodios', perm: 'episodes.read', group: 'Ir para' },
  { id: 'meus-episodios', label: 'Meus episódios (edição)', keywords: 'editor meus episodios', url: '/episodios?editor=eu', perm: 'episodes.read', group: 'Ir para' },
  { id: 'conteudo', label: 'Conteúdo: cortes, posts e carrosséis', keywords: 'cortes posts carrossel conteudo redes', url: '/conteudo', perm: 'episodes.read', group: 'Ir para' },
  { id: 'checklists', label: 'Modelos de checklist', keywords: 'checklist modelos revisao finalizacao', url: '/episodios/checklists', perm: 'production.checklists', group: 'Ir para' },
  { id: 'gestao', label: 'Painel de gestão', keywords: 'gestao configuracoes admin', url: '/gestao', perm: ['users.read', 'audit.read', 'notifications.manage'], group: 'Gestão' },
  { id: 'usuarios', label: 'Usuários', keywords: 'pessoas equipe acessos perfis', url: '/usuarios', perm: 'users.read', group: 'Gestão' },
  { id: 'auditoria', label: 'Logs (auditoria)', keywords: 'logs auditoria historico acoes', url: '/auditoria', perm: 'audit.read', group: 'Gestão' },
  { id: 'config-notificacoes', label: 'Configurar notificações', keywords: 'notificacoes email avisos configuracao', url: '/gestao/notificacoes', perm: 'notifications.manage', group: 'Gestão' },
  { id: 'rotinas', label: 'Rotinas de tarefas (vencimentos)', keywords: 'rotinas prazos vencimento padrao tarefas automaticas', url: '/gestao/rotinas', perm: 'routines.manage', group: 'Gestão' },
  { id: 'config-busca', label: 'Busca global: atalhos e sugestões', keywords: 'busca atalhos sugestoes', url: '/gestao/busca', perm: 'search.manage', group: 'Gestão' },
  { id: 'integracoes', label: 'Integrações', keywords: 'brevo email yourls backblaze groq gemini upload-post', url: '/integracoes', perm: 'integrations.manage', group: 'Gestão' },
  { id: 'perfil', label: 'Meu perfil e senha', keywords: 'perfil senha conta', url: '/perfil', group: 'Conta' },
  { id: 'tema', label: 'Alternar tema claro/escuro', keywords: 'tema escuro claro modo', js: 'theme', group: 'Conta' },
  { id: 'sair', label: 'Sair', keywords: 'logout sair desconectar', js: 'logout', group: 'Conta' },
];

// ---------------------------------------------------------------- dados (cada provedor diz qual tabela cobre)
// Busca sem acento e sem maiúsculas ("joao" acha "João"), por palavras: "maria souza" acha quem tem as duas palavras, em qualquer ordem.
const ACC_FROM = 'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ';
const ACC_TO = 'aaaaaaeeeeiiiiooooouuuucnaaaaaaeeeeiiiiooooouuuucn';
const sqlNorm = (expr) => `translate(lower(${expr}), '${ACC_FROM}', '${ACC_TO}')`;
// Devolve { sql, params } com uma condição por palavra sobre o texto junto das colunas. `base` = quantos parâmetros já existem.
function match(cols, q, base = 0) {
  const words = norm(q).split(/\s+/).filter(Boolean).slice(0, 6);
  const hay = sqlNorm(`concat_ws(' ', ${cols.join(', ')})`);
  return { sql: words.map((_, i) => `${hay} LIKE $${base + i + 1}`).join(' AND ') || 'true', params: words.map((w) => like(w)) };
}
const find = async (table, cols, q, select, order, limit = 6, extra = '') => {
  const m = match(cols, q);
  const { rows } = await db.query(`SELECT ${select} FROM ${table} WHERE (${m.sql}) ${extra} ORDER BY ${order} LIMIT ${limit}`, m.params);
  return rows;
};

const PROVIDERS = [
  { key: 'guests', label: 'Convidados', tables: ['guests'], perm: 'guests.read', async search(q) {
    const rows = await find('guests g', ['g.name', 'g.instagram', 'g.email', 'g.phone', 'g.company', 'g.topic'], q, 'g.id, g.name, g.instagram, g.company', 'g.updated_at DESC');
    return rows.map((r) => ({ title: r.name, sub: r.instagram ? `@${r.instagram}` : (r.company || 'convidado'), url: `/convidados/${r.id}` }));
  } },
  { key: 'sponsors', label: 'Patrocinadores', tables: ['sponsors', 'sponsor_briefs'], perm: 'sponsors.read', async search(q) {
    const rows = await find('sponsors s', ['s.company', 's.contact_name', 's.contact_email', 's.contact_phone', 's.website'], q, 's.id, s.company, s.contact_name', 's.updated_at DESC');
    return rows.map((r) => ({ title: r.company, sub: r.contact_name || 'patrocinador', url: `/patrocinadores/${r.id}` }));
  } },
  { key: 'episodes', label: 'Episódios', tables: ['episodes'], perm: 'episodes.read', async search(q) {
    const num = (String(q).trim().match(/^(?:ep\.?\s*)?(\d{1,4})$/i) || [])[1];
    const m = match(['e.title', 'g.name', "'ep ' || coalesce(e.number::text, '')", 'e.number::text'], q);
    const { rows } = await db.query(`SELECT e.id, e.number, e.title, g.name AS guest FROM episodes e LEFT JOIN guests g ON g.id = e.guest_id
      WHERE (${m.sql}) ${num ? `OR e.number = $${m.params.length + 1}` : ''} ORDER BY e.number DESC NULLS LAST LIMIT 6`, num ? [...m.params, Number(num)] : m.params);
    return rows.map((r) => ({ title: `${pad3(r.number) ? `${pad3(r.number)} · ` : ''}${r.title}`, sub: r.guest || 'episódio', url: `/episodios/${r.id}` }));
  } },
  { key: 'tasks', label: 'Tarefas', tables: ['tasks', 'task_routines'], perm: 'tasks.read', async search(q) {
    const m = match(['t.title', 't.description'], q);
    const { rows } = await db.query(`SELECT t.id, t.title, t.status, u.name AS who FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
      WHERE (${m.sql}) ORDER BY (t.status = 'feito'), t.due_on NULLS LAST LIMIT 6`, m.params);
    return rows.map((r) => ({ title: r.title, sub: `${r.who || 'sem responsável'}${r.status === 'feito' ? ' · feita' : ''}`, url: `/tarefas/${r.id}` }));
  } },
  { key: 'clips', label: 'Cortes', tables: ['episode_clips'], perm: 'episodes.read', async search(q) {
    const rows = await find('episode_clips c', ['c.title', 'c.post_title', 'c.caption'], q, 'c.id, c.title, c.post_title', 'c.id DESC', 5);
    return rows.map((r) => ({ title: r.title, sub: r.post_title || 'corte', url: `/cortes/${r.id}` }));
  } },
  { key: 'publications', label: 'Publicações nas redes', tables: ['episode_publications'], perm: 'social.read', async search(q) {
    const rows = await find('episode_publications p', ['p.title', 'p.description'], q, 'p.id, p.title, p.status, p.media', 'p.created_at DESC', 5);
    return rows.map((r) => ({ title: r.title, sub: `${{ video: 'vídeo', imagem: 'post', carrossel: 'carrossel', story: 'story' }[r.media]} · ${r.status}`, url: `/social/publicacoes/${r.id}` }));
  } },
  { key: 'ideas', label: 'Ideias para as redes', tables: ['social_ideas'], perm: 'social.read', async search(q) {
    const rows = await find('social_ideas i', ['i.title', 'i.hook'], q, 'i.id, i.title, i.kind, i.status', 'i.created_at DESC', 4);
    return rows.map((r) => ({ title: r.title, sub: `${r.kind} · ${r.status}`, url: '/social/ideias' }));
  } },
  { key: 'rules', label: 'Automações', tables: ['social_rules'], perm: 'social.read', async search(q) {
    const rows = await find('social_rules r', ['r.name', 'r.message'], q, 'r.id, r.name, r.active', 'r.id DESC', 4);
    return rows.map((r) => ({ title: r.name, sub: r.active ? 'ativa' : 'pausada', url: `/social/automacoes/${r.id}` }));
  } },
  { key: 'comments', label: 'Comentários', tables: ['comments'], perm: null, async search(q, user) {
    const rows = await find('comments c LEFT JOIN users u ON u.id = c.author_id', ['c.body'], q, 'c.id, c.entity_type, c.entity_id, c.body, u.name AS author', 'c.created_at DESC', 12);
    const { ENTITIES, canSee } = require('./comments');
    return rows.filter((r) => canSee(user.role, r.entity_type)).slice(0, 5).map((r) => ({ title: r.body.length > 80 ? `${r.body.slice(0, 77)}…` : r.body, sub: `${r.author || '—'} · ${ENTITIES[r.entity_type].label}`, url: ENTITIES[r.entity_type].url(r.entity_id) }));
  } },
  { key: 'finance', label: 'Financeiro', tables: ['fin_entries'], perm: 'finance.read', async search(q) {
    const rows = await find('fin_entries e', ['e.description', 'e.supplier'], q, 'e.id, e.description, e.direction, e.status, e.amount_cents, coalesce(e.paid_on, e.due_on) AS day', 'e.due_on DESC', 5);
    const brl = (c) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(c) / 100);
    return rows.map((r) => {
      const open = r.status === 'previsto'; const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(r.day).slice(0, 7);
      const scope = open ? (r.direction === 'entrada' ? 'receber' : 'pagar') : 'historico';
      return { title: r.description, sub: `${r.direction === 'entrada' ? 'a receber' : 'a pagar'} · ${open ? 'em aberto' : r.status === 'pago' ? 'quitado' : 'cancelado'} · ${brl(r.amount_cents)}`, url: `/financeiro/lancamentos?escopo=${scope}${open ? '' : `&mes=${month}`}&q=${encodeURIComponent(r.description.slice(0, 40))}` };
    });
  } },
  { key: 'plateia', label: 'Plateia', tables: ['plateia_leads'], perm: 'audience.read', async search(q) {
    const rows = await find('plateia_leads l', ['l.name', 'l.phone', 'l.guest_name'], q, 'l.id, l.name, l.phone, l.guest_name, l.guest_id, l.status', 'l.created_at DESC', 5);
    return rows.map((r) => ({ title: r.name, sub: `${r.guest_name} · ${r.phone} · ${r.status}`, url: r.guest_id ? `/plateia/painel?convidado=${r.guest_id}` : '/plateia/painel' }));
  } },
  { key: 'stock', label: 'Estoque', tables: ['fin_stock_items'], perm: 'stock.read', async search(q) {
    const rows = await find('fin_stock_items i', ['i.name', 'i.supplier'], q, 'i.id, i.name, i.supplier', 'i.name', 4);
    return rows.map((r) => ({ title: r.name, sub: r.supplier || 'item de estoque', url: '/financeiro/estoque' }));
  } },
  { key: 'users', label: 'Pessoas', tables: ['users'], perm: 'users.read', async search(q) {
    const rows = await find('users u', ['u.name', 'u.email'], q, 'u.id, u.name, u.email', 'u.name', 5);
    return rows.map((r) => ({ title: r.name, sub: r.email, url: `/usuarios/${r.id}/editar` }));
  } },
];

// Tabelas técnicas que não fazem sentido na busca (não viram sugestão).
const TECHNICAL = new Set(['migrations', 'schema_migrations', 'auth_tokens', 'checklist_template_items', 'sessions', 'user_tokens', 'audit_log', 'jobs', 'episode_file_parts', 'clip_upload_parts', 'sponsor_sessions',
  'invite_clicks', 'sponsor_clicks', 'notification_settings', 'notification_mutes', 'search_log', 'search_dismissed', 'search_shortcuts', 'episode_frames',
  'episode_transcripts', 'episode_metadata', 'episode_events', 'guest_events', 'sponsor_events', 'notifications', 'sponsor_files', 'episode_files',
  'checklist_templates', 'checklist_items', 'episode_checklist_items', 'episode_comments', 'sponsor_episodes', 'episode_covers', 'episode_publications',
  'sponsor_bookings', 'social_events', 'social_snapshots', 'fin_settings', 'plateia_events', 'fin_rules', 'fin_recurring', 'fin_stock_moves']);

function scoreAction(a, nq) {
  const label = norm(a.label); const kw = norm(a.keywords);
  if (label.startsWith(nq)) return 100;
  if (label.split(/\s+/).some((w) => w.startsWith(nq))) return 80;
  if (label.includes(nq)) return 60;
  if (kw.split(/\s+/).some((w) => w.startsWith(nq))) return 50;
  const words = (label + ' ' + kw).split(/\s+/);
  if (nq.split(/\s+/).every((p) => words.some((w) => w.startsWith(p)))) return 40;
  return 0;
}

async function shortcuts() {
  const { rows } = await db.query('SELECT * FROM search_shortcuts ORDER BY label');
  return rows.map((s) => ({ id: `atalho-${s.id}`, label: s.label, keywords: s.keywords || '', url: s.url, perm: s.perm || null, group: 'Atalhos da equipe', custom: true }));
}

async function actionsFor(user) {
  return [...ACTIONS, ...(await shortcuts())].filter((a) => allowed(user, a.perm));
}

// Resultado agrupado. Sem texto: os atalhos principais.
async function search(q, user) {
  const query = String(q || '').trim().slice(0, 80);
  const actions = await actionsFor(user);
  if (query.length < 1) return { q: '', groups: [{ label: 'Atalhos', items: actions.filter((a) => ['Criar', 'Atalhos da equipe'].includes(a.group) || ['minhas-tarefas', 'tarefas-hoje', 'notificacoes'].includes(a.id)).slice(0, 10).map(asItem) }], total: 0 };
  const nq = norm(query);
  const matched = actions.map((a) => ({ a, s: scoreAction(a, nq) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, 8).map((x) => asItem(x.a));
  const groups = [];
  if (matched.length) groups.push({ label: 'Ações e atalhos', items: matched });
  if (query.length >= 2) {
    const results = await Promise.all(PROVIDERS.filter((p) => allowed(user, p.perm)).map(async (p) => ({ label: p.label, items: (await p.search(query, user)).map((r) => ({ ...r, kind: p.key })) })));
    for (const g of results) if (g.items.length) groups.push(g);
  }
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  return { q: query, groups, total };
}
const asItem = (a) => ({ title: a.label, sub: a.group, url: a.url || null, js: a.js || null, kind: 'acao', id: a.id });

const log = (user, q, results, picked = null) => db.query('INSERT INTO search_log (user_id, q, results, picked) VALUES ($1,$2,$3,$4)', [user.id, String(q).slice(0, 80), results, picked ? String(picked).slice(0, 300) : null]);

// Todas as páginas GET do painel (sem parâmetros), lidas do próprio Express: o que entrar no sistema aparece aqui sozinho.
function pagesOf(app) {
  const out = new Set();
  const walk = (stack) => {
    for (const layer of stack || []) {
      if (layer.route) {
        const paths = [].concat(layer.route.path);
        if (!layer.route.methods.get) continue;
        for (const p of paths) if (typeof p === 'string' && !p.includes(':') && !/\.(json|csv|ico|txt|xml)$|\/(status|resumo)$|^\/(static|healthz|patrocinador|convite|login|logout|esqueci|definir|busca)/.test(p) && p !== '/') out.add(p); // só páginas (não endpoints de dados)
      } else if (layer.handle?.stack) walk(layer.handle.stack);
    }
  };
  walk(app._router?.stack);
  return [...out].sort();
}
const pathOf = (url) => String(url || '').split(/[?#]/)[0];

// Sugestões para a gestão. Cada uma tem uma chave (para "dispensar") e, quando der, um atalho pronto para criar.
async function suggestions(app) {
  const { rows: dismissed } = await db.query('SELECT key FROM search_dismissed');
  const skip = new Set(dismissed.map((r) => r.key));
  const out = [];
  const actionPaths = new Set([...ACTIONS, ...(await shortcuts())].map((a) => pathOf(a.url)).filter(Boolean));

  const { rows: misses } = await db.query(
    `SELECT lower(q) AS q, count(*)::int AS n, max(created_at) AS last FROM search_log WHERE results = 0 AND created_at > now() - interval '90 days'
      GROUP BY lower(q) HAVING count(*) >= 2 ORDER BY count(*) DESC, max(created_at) DESC LIMIT 15`);
  for (const m of misses) out.push({ key: `busca:${m.q}`, kind: 'busca', title: `Buscaram “${m.q}” ${m.n} vezes sem resultado`, hint: 'Crie um atalho com essa palavra-chave (para a página certa) ou anote como pedido de funcionalidade.', shortcut: { label: '', url: '', keywords: m.q } });

  for (const p of pagesOf(app)) if (!actionPaths.has(p)) out.push({ key: `pagina:${p}`, kind: 'pagina', title: `A página ${p} ainda não tem atalho na busca`, hint: 'Página nova do sistema. Um atalho deixa ela a um Ctrl+K de distância.', shortcut: { label: '', url: p, keywords: p.split('/').filter(Boolean).join(' ') } });

  const covered = new Set(PROVIDERS.flatMap((p) => p.tables));
  const { rows: tables } = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name");
  for (const t of tables.map((r) => r.table_name)) if (!covered.has(t) && !TECHNICAL.has(t)) out.push({ key: `tabela:${t}`, kind: 'dados', title: `Os dados de “${t}” ainda não aparecem na busca`, hint: 'Tabela nova no banco. Para buscar nela, inclua um provedor em src/services/search.js (PROVIDERS).' });

  const { rows: picks } = await db.query(
    `SELECT picked, count(*)::int AS n FROM search_log WHERE picked IS NOT NULL AND picked ~ '^/[a-z]+/[0-9]+' AND created_at > now() - interval '60 days'
      GROUP BY picked HAVING count(*) >= 3 ORDER BY count(*) DESC LIMIT 10`);
  for (const p of picks) if (!actionPaths.has(pathOf(p.picked))) out.push({ key: `fixar:${p.picked}`, kind: 'frequente', title: `${p.picked} foi aberto ${p.n} vezes pela busca`, hint: 'Vale um atalho fixo com um nome fácil.', shortcut: { label: '', url: p.picked, keywords: '' } });

  return out.filter((s) => !skip.has(s.key));
}

module.exports = { ACTIONS, PROVIDERS, TECHNICAL, norm, search, actionsFor, log, suggestions, pagesOf };
