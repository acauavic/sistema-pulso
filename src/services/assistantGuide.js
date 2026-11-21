// O que cada perfil pode fazer, em português, para o assistente instruir cada pessoa pelo perfil dela.
// A fonte da verdade continua sendo src/permissions.js: aqui só descrevemos cada permissão. O teste confere que
// toda permissão da matriz tem uma descrição, então permissão nova sem texto aqui derruba a suíte.
const { PERMISSIONS, ROLES, can } = require('../permissions');

// perm -> { text: o que a pessoa faz, where: onde fica no painel }
const ACTIONS = {
  'users.read': { text: 'ver a lista de usuários', where: 'Gestão > Usuários' },
  'users.write': { text: 'criar, editar e desativar usuários (a gestão não mexe em superadmin)', where: 'Gestão > Usuários' },
  'users.delete': { text: 'excluir usuários', where: 'Gestão > Usuários' },
  'guests.read': { text: 'ver convidados, a agenda, o histórico e o quadro do CRM', where: 'Convidados' },
  'guests.write': { text: 'cadastrar e editar convidados, mudar a etapa (quadro, "próximo passo" ou janela da etapa), editar vários de uma vez na Lista, importar CSV, zerar o aceite, mandar os lembretes da gravação, enviar a foto do convidado e convidar a mesma pessoa também para outro projeto', where: 'Convidados' },
  'guests.invite': { text: 'gerar o link do convite e enviá-lo por e-mail', where: 'Convidado > Convite' },
  'guests.delete': { text: 'excluir convidados', where: 'Convidado > Excluir' },
  'sponsors.read': { text: 'ver patrocinadores e o que cada um já entregou', where: 'Patrocinadores' },
  'sponsors.write': { text: 'cadastrar patrocinadores, mudar a etapa, gerar os links, editar entregáveis e enviar arquivos', where: 'Patrocinadores' },
  'sponsors.delete': { text: 'excluir patrocinadores', where: 'Patrocinador > Excluir' },
  'episodes.read': { text: 'ver os episódios e em que etapa cada um está', where: 'Episódios' },
  'episodes.write': { text: 'registrar episódios e editar os dados deles', where: 'Episódios' },
  'episodes.delete': { text: 'excluir episódios', where: 'Episódio > Excluir' },
  'production.manage': { text: 'marcar como gravado, liberar para edição, mexer nas tarefas e nas observações do episódio', where: 'Episódio' },
  'production.upload': { text: 'subir material bruto, bastidores e fotos do episódio', where: 'Episódio > Material' },
  'production.edit': { text: 'assumir a edição, subir o vídeo editado e enviá-lo para revisão', where: 'Episódio > Material' },
  'production.review': { text: 'revisar o vídeo (aprovar ou pedir ajustes), finalizar e publicar o episódio', where: 'Episódio > Revisão e Finalização' },
  'covers.edit': { text: 'editar capas e posts de imagem (trocar o quadro, usar uma foto do episódio, enviar uma imagem, mudar o texto) e escolher a capa do corte', where: 'Novo post > Editar capa, ou a página do corte' },
  'production.checklists': { text: 'criar e editar os modelos de checklist', where: 'Episódio > Checklists' },
  'social.read': { text: 'ver publicações, ideias, insights e automações das redes', where: 'Social' },
  'social.ideas': { text: 'pedir ideias à IA e tocá-las (aprovar, pedir ao editor)', where: 'Social > Ideias' },
  'social.request': { text: 'montar posts (a gestão aprova antes de sair)', where: 'Social > Novo post' },
  'social.publish': { text: 'publicar direto, aprovar ou devolver pedidos de post e editar posts', where: 'Social > Publicações' },
  'social.comments': { text: 'ver os comentários dos posts, aprovar e editar as respostas da IA e responder os que precisam da equipe', where: 'Social > Comentários' },
  'social.automate': { text: 'criar, ativar e pausar as automações de comentários e directs, e ligar e configurar as respostas por IA', where: 'Social > Automações' },
  'finance.read': { text: 'ver contas a pagar e receber, fluxo de caixa e custo por episódio', where: 'Financeiro' },
  'finance.write': { text: 'lançar e pagar contas, criar regras de custo automático e parcelas de patrocínio', where: 'Financeiro' },
  'stock.read': { text: 'ver o estoque do estúdio', where: 'Financeiro > Estoque' },
  'stock.write': { text: 'cadastrar itens e ajustar o estoque', where: 'Financeiro > Estoque' },
  'audience.read': { text: 'ver os pedidos da plateia (lista e quadro), adicionar pessoas, editar, selecionar (com valor ou isenção) e atender', where: 'Plateia' },
  'audience.manage': { text: 'ajustar a página da plateia: preço, WhatsApp, local, imagens e rastreamento', where: 'Plateia > Ajustes' },
  'calendar.read': { text: 'ver o calendário com tudo que tem data (tarefas, gravações, lembretes, publicações, contas e parcerias, conforme o que o perfil enxerga) e salvar visualizações próprias', where: 'Calendário' },
  'calendar.share': { text: 'compartilhar uma visualização do calendário com a equipe e apagar as dos outros', where: 'Calendário > Salvar visualização' },
  'tasks.read': { text: 'ver tarefas', where: 'Tarefas' },
  'tasks.write': { text: 'criar tarefas (com prazo e hora, por voz ou digitando, com anexos) e mexer nas que criou ou que são dela', where: 'Tarefas' },
  'tasks.manage': { text: 'mexer em qualquer tarefa e reatribuir', where: 'Tarefas' },
  'chat.use': { text: 'trocar mensagens com a equipe em Mensagens: conversas individuais e grupos, threads, reações, áudio e resumo com IA' },
  'comments.write': { text: 'comentar em convidados, patrocinadores, episódios, cortes e tarefas, e na revisão do vídeo (texto formatado, imagens, anexos e áudio com transcrição; @ chama alguém)', where: 'Comentários de cada item' },
  'notifications.manage': { text: 'configurar quais avisos vão para o painel, o e-mail e quem os recebe', where: 'Gestão > Notificações' },
  'routines.manage': { text: 'configurar as rotinas de tarefas que nascem sozinhas', where: 'Gestão > Rotinas de tarefas' },
  'reminders.manage': { text: 'configurar os lembretes da gravação: endereço do estúdio, horário e textos', where: 'Gestão > Lembretes da gravação' },
  'plans.manage': { text: 'editar os planos de patrocínio (Ouro e Diamond) e escolher quais episódios publicados aparecem na galeria do media kit', where: 'Gestão > Planos de patrocínio e Galeria do media kit' },
  'search.manage': { text: 'editar os atalhos da busca global', where: 'Gestão > Busca global' },
  'contacts.manage': { text: 'mudar o WhatsApp da produção (botões do convite do convidado) e o do comercial (media kit e portal do patrocinador), e as mensagens prontas que abrem nele', where: 'Gestão > WhatsApp dos convites' },
  'outreach.manage': { text: 'configurar a cadência de follow-up (intervalos entre abordagens) e acompanhar o painel de abordagens por canal e por pessoa', where: 'Gestão > Cadência' },
  'pautas.read': { text: 'ler a pauta e o roteiro do vídeo (o editor lê o roteiro aprovado)', where: 'Vídeo > aba Pauta' },
  'pautas.write': { text: 'escrever a pauta e o roteiro, copiar para o grupo do WhatsApp e registrar a resposta de quem aprova', where: 'Vídeo > aba Pauta' },
  'roles.manage': { text: 'criar funções e escolher o que cada uma acessa, por área (e dar a cada pessoa uma função em cada projeto, na janela do usuário)', where: 'Gestão > Equipe > Funções' },
  'projects.manage': { text: 'ajustar o nome, a sigla e como cada projeto chama os seus vídeos, e marcar quem participa de cada projeto', where: 'Gestão > Sistema > Projetos' },
  'catalog.manage': { text: 'criar, renomear e desativar os tipos de vídeo (Pedir conteúdo, rotinas e a meta Vídeos entregues) e as categorias de tarefa', where: 'Gestão > Sistema > Categorias' },
  'goals.manage': { text: 'definir as metas de cada pessoa (até 3: o que contar, período, alvo e se aparece em número ou porcentagem) e ver o andamento das metas de todos', where: 'Gestão > Equipe > Metas' },
  'duplicates.manage': { text: 'ver a lista de convidados e patrocinadores cadastrados em dobro, juntar ou marcar "não é duplicata"', where: 'Gestão > Sistema > Duplicatas' },
  'audit.read': { text: 'consultar os logs de auditoria', where: 'Gestão > Logs' },
  'trash.manage': { text: 'ver tudo o que a equipe apagou, restaurar qualquer item e apagar de vez antes dos 15 dias', where: 'Gestão > Sistema > Lixeira' },
  'integrations.manage': { text: 'ver o status das integrações (e-mail, links curtos, armazenamento, IA, redes, Google Agenda), escolher o que vai para o Google Agenda e a duração de cada tipo, e ver a saúde do sistema', where: 'Gestão > Integrações e Sistema' },
};

const roleLabels = (roles) => roles.map((r) => ROLES[r].label);

// { role, label, can: [{ perm, text, where }], cannot: [{ perm, text, where, whoCan: [rótulos] }] }
function guide(role) {
  const mine = []; const notMine = [];
  for (const perm of Object.keys(PERMISSIONS)) {
    const a = ACTIONS[perm]; if (!a) continue;
    if (can(role, perm)) mine.push({ perm, ...a });
    else notMine.push({ perm, ...a, whoCan: roleLabels(PERMISSIONS[perm]) });
  }
  return { role, label: ROLES[role]?.label || role, can: mine, cannot: notMine };
}

// Texto para o prompt: o que o perfil faz e, do que não faz, quem faz.
function promptSection(role) {
  const g = guide(role);
  const lines = [`Perfil de quem pergunta: ${g.label}. O painel esconde ou recusa o que o perfil não permite; instrua sempre pelo que ESTE perfil consegue fazer.`,
    `O perfil ${g.label} pode: ${g.can.map((a) => a.text).join('; ')}.`];
  if (g.cannot.length) {
    lines.push(`O perfil ${g.label} NÃO pode (e quem pode): ${g.cannot.map((a) => `${a.text} [${a.whoCan.join(' ou ')}]`).join('; ')}.`);
  }
  lines.push('Se a pessoa pedir algo que o perfil dela não permite, diga com clareza que o perfil dela não faz isso e indique quem faz (um dos perfis acima). Nunca ensine um caminho que o perfil dela não vê.');
  return lines.join('\n');
}

module.exports = { ACTIONS, guide, promptSection };
