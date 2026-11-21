// Papéis e permissões. ÚNICO lugar a editar quando os poderes de cada role forem definidos.
// ATENÇÃO: a matriz abaixo é PROVISÓRIA (rascunho até o dono do podcast descrever os poderes).

const ROLES = {
  superadmin: { label: 'Superadmin', rank: 4 },
  gestao: { label: 'Gestão', rank: 3 },
  produtora: { label: 'Produtora', rank: 2 },
  editor_video: { label: 'Editor de Vídeo', rank: 1 },
};

const ALL = Object.keys(ROLES);

// permissão -> roles que a possuem
const PERMISSIONS = {
  'users.read': ['superadmin', 'gestao'],
  'users.write': ['superadmin', 'gestao'], // gestão não mexe em superadmin (ver canManageUser)
  'users.delete': ['superadmin'],
  'guests.read': ALL, // o editor de vídeo só lê: precisa do briefing, das datas e do contexto do convidado
  'guests.write': ['superadmin', 'gestao', 'produtora'],
  'guests.invite': ['superadmin', 'gestao', 'produtora'], // gerar link e enviar e-mail
  'guests.delete': ['superadmin', 'gestao'],
  'sponsors.read': ALL, // o editor de vídeo só lê: briefing, restrições e material do patrocinador
  'sponsors.write': ['superadmin', 'gestao', 'produtora'], // cadastrar, mover etapa, gerar links, entregáveis e arquivos
  'sponsors.delete': ['superadmin', 'gestao'],
  'pautas.read': ALL,                                   // o editor lê o roteiro aprovado
  'pautas.write': ['superadmin', 'gestao', 'produtora'], // escrever, mandar para o WhatsApp e registrar a resposta
  'episodes.read': ALL,
  'episodes.write': ['superadmin', 'gestao', 'produtora'],
  'episodes.delete': ['superadmin', 'gestao'],
  // produção do episódio
  'production.manage': ['superadmin', 'gestao', 'produtora'],               // gravado, liberar para edição, tarefas, observações
  'production.upload': ['superadmin', 'gestao', 'produtora'], // subir brutos, bastidores, fotos (o editor recebe o material pronto; ele sobe só o vídeo editado)
  'production.edit': ['superadmin', 'gestao', 'editor_video'],              // assumir a edição, subir o editado, enviar para revisão
  'production.review': ['superadmin', 'gestao'],                            // aprovar, pedir ajustes, finalizar, publicar
  'covers.edit': ['superadmin', 'gestao', 'produtora', 'editor_video'],      // editar capas e posts de imagem (trocar quadro, foto, texto), escolher a capa do corte
  'production.checklists': ['superadmin', 'gestao', 'editor_video'],        // criar/editar modelos de checklist
  // social (redes)
  'social.read': ['superadmin', 'gestao', 'produtora'],  // ver publicações, ideias, insights e automações
  'social.ideas': ['superadmin', 'gestao', 'produtora'], // pedir ideias à IA e tocá-las (aprovar, pedir ao editor)
  'social.request': ['superadmin', 'gestao', 'produtora'], // montar post; sem social.publish ele vai para a revisão da gestão
  'social.publish': ['superadmin', 'gestao'],            // publicar direto, aprovar/devolver pedidos, editar posts
  'social.comments': ['superadmin', 'gestao', 'produtora'], // ver os comentários dos posts, aprovar e editar as respostas da IA, responder
  'social.automate': ['superadmin', 'gestao'],           // criar, ativar e pausar automações de comentários e directs
  // financeiro
  'finance.read': ['superadmin', 'gestao'],   // contas a pagar e receber, fluxo de caixa, custos por episódio
  'finance.write': ['superadmin', 'gestao'],  // lançar, pagar, regras de custo automático e parcelas de patrocínio
  'stock.read': ['superadmin', 'gestao', 'produtora'],
  'stock.write': ['superadmin', 'gestao', 'produtora'], // cadastrar itens e ajustar o estoque (compra, que gera conta a pagar, pede finance.write)
  // Pulso Podcast com Plateia (página pública de inscrição)
  'audience.read': ['superadmin', 'gestao', 'produtora'], // ver inscrições, resultados e atender
  'audience.manage': ['superadmin', 'gestao'],            // preço, WhatsApp, local, imagens e rastreamento da página
  // tarefas e colaboração (todo mundo trabalha com as próprias; a gestão mexe nas de todos)
  // calendário: tudo que tem data (cada tipo de evento só aparece para quem tem a permissão do assunto)
  'calendar.read': ALL,
  'calendar.share': ['superadmin', 'gestao'], // compartilhar uma visualização com a equipe e apagar as dos outros
  'tasks.read': ALL,
  'tasks.write': ALL,                                   // criar e mexer nas tarefas que criou ou que são suas
  'tasks.manage': ['superadmin', 'gestao', 'produtora'], // mexer em qualquer tarefa e reatribuir
  'comments.write': ALL,
  'chat.use': ALL, // mensagens da equipe: conversas individuais e grupos
  // painel de gestão
  'notifications.manage': ['superadmin', 'gestao'],     // configuração geral das notificações
  'routines.manage': ['superadmin', 'gestao'],          // rotinas de tarefas (vencimento padrão)
  'reminders.manage': ['superadmin', 'gestao'],         // lembretes da gravação: endereço, horário e textos
  'plans.manage': ['superadmin', 'gestao'],             // planos de patrocínio (Ouro/Diamond): nome, preço e entregáveis
  'search.manage': ['superadmin', 'gestao'],            // atalhos e sugestões da busca global
  'contacts.manage': ['superadmin', 'gestao'],          // WhatsApp para onde vão os botões dos convites e do media kit, e as mensagens prontas
  'outreach.manage': ['superadmin', 'gestao'],          // cadência de abordagem: intervalos e o painel de follow-ups
  'goals.manage': ['superadmin', 'gestao'],
  'projects.manage': ['superadmin', 'gestao'],          // Gestão > Projetos: nome, sigla e quem participa de cada projeto
  'roles.manage': ['superadmin', 'gestao'],             // Gestão > Funções: criar funções e escolher o que cada uma acessa
  'catalog.manage': ['superadmin', 'gestao'],           // Gestão > Categorias: tipos de vídeo e categorias de tarefa             // Gestão > Metas: definir as metas de cada pessoa e ver o andamento de todos
  'duplicates.manage': ['superadmin', 'gestao'], // lista de duplicatas (convidados e patrocinadores); o aviso no cadastro e o juntar seguem guests/sponsors.write
  'audit.read': ['superadmin', 'gestao'],
  'trash.manage': ['superadmin', 'gestao'], // ver e restaurar tudo da lixeira e apagar de vez (cada pessoa vê e restaura o que ela apagou)
  'integrations.manage': ['superadmin', 'gestao'], // ver status e testar Brevo/YOURLS
};

// Permissões DA CASA: alcançam o que não é de projeto nenhum (a casa inteira). Quem não é da equipe da casa não tem,
// mesmo com perfil de gestão: o gestor de um projeto cuida do projeto dele, não do sistema.
const HOUSE_PERMISSIONS = new Set([
  'users.read', 'users.write', 'users.delete', 'projects.manage', 'integrations.manage', 'catalog.manage',
  'routines.manage', 'notifications.manage', 'roles.manage', 'reminders.manage', 'search.manage', 'contacts.manage',
  'outreach.manage', 'stock.read', 'stock.write', 'audit.read', 'trash.manage',
]);

// `who` é a PESSOA (req.user). Com as funções (services/roles.js), a sessão traz `perms` (o que as funções dela dão, somando
// os projetos) e `projectPerms` (a função de cada projeto); `projectId` pergunta por um projeto só. Sem isso (o perfil em
// texto, ou uma pessoa lida do banco numa rotina), vale a matriz acima pelo "trabalha como". A permissão da casa ainda exige
// `house`.
const EMPTY = new Set();
function can(who, permission, projectId = null) {
  if (!PERMISSIONS[permission]) return false;
  const role = typeof who === 'string' ? who : (who && who.role);
  let allowed;
  if (who && typeof who === 'object' && who.perms) {
    const set = projectId != null && who.projectPerms ? (who.projectPerms[projectId] || EMPTY) : who.perms;
    allowed = set.has(permission);
  } else allowed = PERMISSIONS[permission].includes(role);
  if (!allowed) return false;
  if (!HOUSE_PERMISSIONS.has(permission)) return true;
  return typeof who === 'string' ? true : who.house !== false;
}

// O que cada perfil de fábrica tem (a matriz), como lista.
const permsOfBase = (base) => Object.keys(PERMISSIONS).filter((p) => PERMISSIONS[p].includes(base));

// Áreas da tela de Funções: cada permissão mora numa área; os níveis são atalhos que marcam as caixas
// (Vê = as de ler; Edita = + as de fazer; Gerencia = tudo da área). O nome de cada permissão é o que aparece na caixa.
const AREAS = [
  { key: 'convidados', label: 'Convidados', read: ['guests.read'], edit: ['guests.write', 'guests.invite'], manage: ['guests.delete', 'duplicates.manage'] },
  { key: 'patrocinio', label: 'Patrocinadores', read: ['sponsors.read'], edit: ['sponsors.write'], manage: ['sponsors.delete', 'plans.manage'] },
  { key: 'pautas', label: 'Pautas e roteiros', read: ['pautas.read'], edit: ['pautas.write'], manage: [] },
  { key: 'producao', label: 'Vídeos e produção', read: ['episodes.read'], edit: ['episodes.write', 'production.manage', 'production.upload', 'production.edit', 'covers.edit', 'production.checklists'], manage: ['production.review', 'episodes.delete'] },
  { key: 'redes', label: 'Redes', read: ['social.read'], edit: ['social.ideas', 'social.request', 'social.comments'], manage: ['social.publish', 'social.automate'] },
  { key: 'financeiro', label: 'Financeiro', read: ['finance.read'], edit: ['finance.write'], manage: [] },
  { key: 'estoque', label: 'Estoque', read: ['stock.read'], edit: ['stock.write'], manage: [] },
  { key: 'plateia', label: 'Plateia', read: ['audience.read'], edit: [], manage: ['audience.manage'] },
  { key: 'tarefas', label: 'Tarefas e calendário', read: ['tasks.read', 'calendar.read'], edit: ['tasks.write', 'comments.write'], manage: ['tasks.manage', 'calendar.share', 'goals.manage'] },
  { key: 'mensagens', label: 'Mensagens', read: ['chat.use'], edit: [], manage: [] },
  { key: 'sistema', label: 'Sistema (só para a equipe da casa)', read: ['users.read', 'audit.read'], edit: ['users.write', 'notifications.manage', 'reminders.manage', 'search.manage', 'contacts.manage', 'outreach.manage', 'routines.manage', 'catalog.manage'], manage: ['users.delete', 'roles.manage', 'projects.manage', 'integrations.manage', 'trash.manage'] },
];
const PERM_LABELS = {
  'guests.read': 'Ver convidados', 'guests.write': 'Cadastrar e mover convidados', 'guests.invite': 'Gerar e enviar convites', 'guests.delete': 'Apagar convidados', 'duplicates.manage': 'Lista de duplicatas',
  'sponsors.read': 'Ver patrocinadores', 'sponsors.write': 'Cadastrar, mover e cuidar dos patrocinadores', 'sponsors.delete': 'Apagar patrocinadores', 'plans.manage': 'Planos de patrocínio',
  'pautas.read': 'Ler pautas e roteiros', 'pautas.write': 'Escrever, mandar para aprovação e registrar a resposta',
  'episodes.read': 'Ver vídeos e episódios', 'episodes.write': 'Criar e editar vídeos', 'production.manage': 'Tocar a produção (gravado, liberar, tarefas)', 'production.upload': 'Subir material bruto e fotos',
  'production.edit': 'Editar o vídeo (assumir, subir o editado, mandar para revisão)', 'covers.edit': 'Editar capas e posts de imagem', 'production.checklists': 'Modelos de checklist',
  'production.review': 'Revisar, aprovar e publicar', 'episodes.delete': 'Apagar vídeos',
  'social.read': 'Ver publicações, ideias e números', 'social.ideas': 'Pedir ideias à IA', 'social.request': 'Montar posts (vão para revisão)', 'social.comments': 'Cuidar dos comentários',
  'social.publish': 'Publicar direto e aprovar posts', 'social.automate': 'Automações de comentários e directs',
  'finance.read': 'Ver contas, caixa e resultado', 'finance.write': 'Lançar, pagar, acertar e fechar o mês',
  'stock.read': 'Ver o estoque', 'stock.write': 'Cadastrar e ajustar o estoque',
  'audience.read': 'Ver inscrições da plateia', 'audience.manage': 'Ajustar a página da plateia',
  'tasks.read': 'Ver tarefas', 'calendar.read': 'Ver o calendário', 'tasks.write': 'Criar e mexer nas próprias tarefas', 'comments.write': 'Comentar',
  'tasks.manage': 'Mexer em qualquer tarefa e reatribuir', 'calendar.share': 'Compartilhar visualizações do calendário', 'goals.manage': 'Definir metas da equipe',
  'chat.use': 'Usar as mensagens da equipe',
  'users.read': 'Ver usuários', 'audit.read': 'Ver a auditoria', 'users.write': 'Criar e editar usuários', 'notifications.manage': 'Configurar avisos', 'reminders.manage': 'Lembretes da gravação',
  'search.manage': 'Atalhos da busca', 'contacts.manage': 'WhatsApp dos convites', 'outreach.manage': 'Cadência de abordagem', 'routines.manage': 'Rotinas de tarefas', 'catalog.manage': 'Categorias',
  'users.delete': 'Excluir usuários', 'roles.manage': 'Funções', 'projects.manage': 'Projetos', 'integrations.manage': 'Integrações', 'trash.manage': 'Lixeira completa',
};

// Quem pode criar/editar/desativar/excluir o usuário `target`?
// Regra: superadmin só é tocado por superadmin.
function canManageUser(actorRole, targetRole) {
  if (!can(actorRole, 'users.write')) return false;
  if (targetRole === 'superadmin' || targetRole == null) return actorRole === 'superadmin';
  return true;
}

// Roles que o ator pode atribuir.
function assignableRoles(actorRole) {
  if (!can(actorRole, 'users.write')) return [];
  return Object.keys(ROLES).filter((r) => r !== 'superadmin' || actorRole === 'superadmin');
}

const isRole = (value) => Object.prototype.hasOwnProperty.call(ROLES, value);

module.exports = { ROLES, PERMISSIONS, HOUSE_PERMISSIONS, AREAS, PERM_LABELS, can, permsOfBase, canManageUser, assignableRoles, isRole };
