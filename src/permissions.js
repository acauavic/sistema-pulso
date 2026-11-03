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
  'episodes.read': ALL,
  'episodes.write': ['superadmin', 'gestao', 'produtora'],
  'episodes.delete': ['superadmin', 'gestao'],
  // produção do episódio
  'production.manage': ['superadmin', 'gestao', 'produtora'],               // gravado, liberar para edição, tarefas, observações
  'production.upload': ['superadmin', 'gestao', 'produtora'], // subir brutos, bastidores, fotos (o editor recebe o material pronto; ele sobe só o vídeo editado)
  'production.edit': ['superadmin', 'gestao', 'editor_video'],              // assumir a edição, subir o editado, enviar para revisão
  'production.review': ['superadmin', 'gestao'],                            // aprovar, pedir ajustes, finalizar, publicar
  'production.checklists': ['superadmin', 'gestao', 'editor_video'],        // criar/editar modelos de checklist
  // social (redes)
  'social.read': ['superadmin', 'gestao', 'produtora'],  // ver publicações, ideias, insights e automações
  'social.ideas': ['superadmin', 'gestao', 'produtora'], // pedir ideias à IA e tocá-las (aprovar, pedir ao editor)
  'social.request': ['superadmin', 'gestao', 'produtora'], // montar post; sem social.publish ele vai para a revisão da gestão
  'social.publish': ['superadmin', 'gestao'],            // publicar direto, aprovar/devolver pedidos, editar posts
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
  // painel de gestão
  'notifications.manage': ['superadmin', 'gestao'],     // configuração geral das notificações
  'routines.manage': ['superadmin', 'gestao'],          // rotinas de tarefas (vencimento padrão)
  'reminders.manage': ['superadmin', 'gestao'],         // lembretes da gravação: endereço, horário e textos
  'plans.manage': ['superadmin', 'gestao'],             // planos de patrocínio (Ouro/Diamond): nome, preço e entregáveis
  'search.manage': ['superadmin', 'gestao'],            // atalhos e sugestões da busca global
  'contacts.manage': ['superadmin', 'gestao'],          // WhatsApp para onde vão os botões dos convites e do media kit, e as mensagens prontas
  'outreach.manage': ['superadmin', 'gestao'],          // cadência de abordagem: intervalos, metas diárias e o painel de follow-ups
  'audit.read': ['superadmin', 'gestao'],
  'trash.manage': ['superadmin', 'gestao'], // ver e restaurar tudo da lixeira e apagar de vez (cada pessoa vê e restaura o que ela apagou)
  'integrations.manage': ['superadmin', 'gestao'], // ver status e testar Brevo/YOURLS
};

function can(role, permission) {
  const allowed = PERMISSIONS[permission];
  return Boolean(allowed && allowed.includes(role));
}

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

module.exports = { ROLES, PERMISSIONS, can, canManageUser, assignableRoles, isRole };
