// Base de conhecimento do assistente: como o Pulso Gestão funciona hoje, por assunto. O assistente consulta pela ferramenta
// "como_fazer" (em vez de carregar tudo no prompt) e responde com os passos e o lugar certo no painel.
// perm: a permissão de quem FAZ o passo (o assistente confere o perfil de quem pergunta e indica quem faz).
// Mantenha este arquivo junto das mudanças do sistema: assunto novo ou fluxo que mudou entra aqui.
const TOPICS = [
  {
    key: 'tarefas', title: 'Tarefas', words: ['tarefa', 'tarefas', 'to-do', 'afazer', 'prazo', 'hora', 'vencimento', 'atrasada', 'quadro de tarefas', 'rotina de tarefa', 'rotinas'],
    where: '/tarefas', perm: 'tasks.write',
    steps: [
      'Tarefas tem três visões (Lista, Quadro e Calendário) e três recortes: Minhas tarefas, Hoje e Todas. Status: A fazer, Fazendo, Feito e Bloqueada (bloquear pede o motivo).',
      'Criar: botão "Nova tarefa". Campos: o que fazer, detalhes (texto formatado), responsável, "Vence em" e "Hora" (opcional; só a hora vale para hoje), tipo e, se quiser, o episódio, convidado ou patrocinador ligado.',
      'Com hora, a tarefa atrasa quando a hora passa; sem hora, só no dia seguinte. A pessoa recebe aviso ao receber a tarefa, quando o prazo muda, de manhã no dia, na última hora e quando atrasa.',
      'Os detalhes aceitam negrito, listas, tabelas, links (só a URL ou miniatura), imagens coladas com Ctrl+V e anexos PDF, HTML e ZIP.',
      'Rotinas de tarefas (Gestão > Rotinas de tarefas) criam tarefas sozinhas em momentos da produção, como "episódio liberado para edição".',
      'Pelo assistente: "criar_tarefa" cria (pode escolher responsável, prazo e hora) e "atualizar_tarefa" muda status, prazo, hora e responsável.',
    ],
  },
  {
    key: 'tarefa_por_voz', title: 'Tarefa por voz', words: ['voz', 'falar tarefa', 'áudio tarefa', 'ditar', 'gravar tarefa'],
    where: '/tarefas', perm: 'tasks.write',
    steps: [
      'Em Tarefas, o botão "Falar tarefa" (ou o botão dentro de "Nova tarefa") grava até 2 minutos. A IA organiza a fala em uma tarefa clara (título, detalhes, responsável, prazo, hora, tipo e vínculos) e preenche os campos.',
      'Nada é criado sozinho: a pessoa confere, vê o que foi ouvido e toca em "Criar tarefa".',
    ],
  },
  {
    key: 'comentarios', title: 'Comentários, anexos e áudio', words: ['comentário', 'comentarios', 'comentar', 'menção', 'mencionar', 'arroba', 'áudio', 'audio', 'transcrição', 'anexo', 'anexar', 'imagem', 'print', 'pdf', 'zip', 'tabela', 'link miniatura', 'miniatura'],
    where: 'Cada convidado, patrocinador, episódio, corte e tarefa tem a caixa de comentários; a revisão do vídeo tem a dela', perm: 'comments.write',
    steps: [
      'Todas as caixas de comentário têm o mesmo editor: formatação, tabelas, imagens coladas ou arrastadas, anexos (imagem até 10 MB; PDF, HTML e ZIP até 25 MB), links com miniatura e @menções (a pessoa mencionada recebe notificação).',
      'O microfone grava um áudio (até ~2 minutos) e transcreve sozinho; o comentário mostra o player e o texto falado, e a transcrição vai no aviso da equipe. É possível inserir a transcrição no texto.',
      'Ctrl+Enter envia. Na revisão do vídeo, o comentário vale para o ponto do vídeo (ou geral) e pode ser marcado como resolvido.',
      'Quem escreveu pode editar o comentário (ícone de lápis; abre uma janela com o texto atual) ou apagar (lixeira). Um lápis pequeno marca o que foi editado. A gestão apaga os dos outros, mas só o autor edita.',
      'Pelo assistente: "comentar" publica um comentário de texto em um item e "comentarios" mostra os últimos comentários de um item.',
    ],
  },
  {
    key: 'convidados', title: 'Convidados (CRM) e convite', words: ['convidado', 'convidados', 'crm', 'convite', 'prospecção', 'prospeccao', 'aceite', 'etapa', 'perdido', 'agendar', 'agendado', 'foto do convidado', 'importar csv', 'edição em massa'],
    where: '/convidados', perm: 'guests.write',
    steps: [
      'Etapas: Prospecção, Convite enviado, Em agendamento, Agendado, Gravado, Perdido e Cancelado. A etapa muda pelo quadro (arrastar), pelo botão de próximo passo ou pela etiqueta no topo do convidado.',
      'Em agendamento e Agendado exigem a foto do convidado (moldura 4:3, enviada na página dele); Em agendamento pede e-mail ou WhatsApp; Agendado pede data, hora e as confirmações do estúdio, dos hosts e do convidado; Perdido pede o motivo.',
      'O convite é um link público (gerar e enviar por e-mail ou WhatsApp). Quando o convidado aceita, vai para Em agendamento e a equipe é avisada; o WhatsApp que abre depois é configurável em Gestão > WhatsApp dos convites.',
      'Convidado Agendado vira agenda (media kit, portal dos patrocinadores, página da plateia) e gera os lembretes da gravação. Quando grava, nasce o episódio.',
      'Se o aceite foi por engano, quem edita convidados usa "Zerar aceite e voltar para Prospecção" na aba Convite do convidado.',
      'Lista: seleção de vários para "Editar em massa" (etapa, responsável, perfil, gênero e patrocinador; Agendado e Gravado não vão em massa); Importar CSV traz convidados e, para gravados, o episódio com links.',
      'Pelo assistente: "convidado" mostra a situação, "lista_convidados" lista uma etapa, "criar_convidado" cadastra em Prospecção e "mudar_etapa_convidado" muda a etapa quando o convidado já tem o que a etapa exige.',
    ],
  },
  {
    key: 'cadencia', title: 'Cadência de follow-up', words: ['cadência', 'cadencia', 'follow-up', 'followup', 'follow up', 'abordagem', 'abordar', 'meta diária', 'possível perdido', 'sem resposta', 'registrar abordagem'],
    where: 'Convidado em Convite enviado e patrocinador em Prospecção (botão "Registrar abordagem"); painel em Gestão > Cadência', perm: 'guests.write',
    steps: [
      'Quem está sendo abordado (convidado em "Convite enviado", patrocinador em "Prospecção") tem um estado de follow-up: em dia, hoje, atrasado ou possível perdido (muitas tentativas sem resposta).',
      '"Registrar abordagem" abre uma janela curta: canal (Instagram, e-mail, WhatsApp, telefone, outro), qual endereço, se enviou ou se respondeu, quando e uma observação. Cada canal tem seu intervalo até o próximo follow-up.',
      'Para patrocinadores há uma meta diária de abordagens por pessoa. O Início mostra os follow-ups e a meta do dia; de manhã, quem tem pendências recebe um aviso.',
      'Gestão > Cadência (gestão) mostra o painel por canal e por pessoa e configura intervalos e metas.',
      'Pelo assistente: "follow_ups" mostra quem precisa de abordagem e "registrar_abordagem" registra uma abordagem feita.',
    ],
  },
  {
    key: 'patrocinadores', title: 'Patrocinadores, planos e media kit', words: ['patrocinador', 'patrocinadores', 'patrocínio', 'cota', 'ouro', 'diamond', 'media kit', 'mediakit', 'portal', 'formulário', 'entregável', 'entregaveis', 'plano', 'planos', 'galeria', 'quem já sentou'],
    where: '/patrocinadores', perm: 'sponsors.write',
    steps: [
      'Etapas: Prospecção, Em negociação, Ganho (formulário de cadastro), Ativo (portal e entregas), mais Inativo e Perdido. A página do patrocinador guia o próximo passo.',
      'Cada patrocinador recebe um link reutilizável (sem criar conta) para o media kit, o formulário de cadastro e o portal. "Quero ser patrocinador" no media kit leva à negociação e abre o WhatsApp comercial.',
      'Planos (Ouro e Diamond), com preço e entregáveis, ficam em Gestão > Planos de patrocínio e alimentam o media kit, a cota e as entregas do portal.',
      'O slide "Quem já sentou à mesa" do media kit mostra os episódios publicados que a gestão escolher em Gestão > Galeria do media kit (alcance e frase editáveis).',
      'O WhatsApp comercial e as mensagens prontas se configuram em Gestão > WhatsApp dos convites.',
      'Pelo assistente: "patrocinador" mostra etapa, cota, formulário, entregas e gravações reservadas.',
    ],
  },
  {
    key: 'episodios', title: 'Episódios e produção', words: ['episódio', 'episodio', 'episódios', 'produção', 'producao', 'edição', 'edicao', 'editor', 'revisão', 'revisao', 'aprovar', 'finalização', 'finalizacao', 'publicar', 'material bruto', 'bruto', 'bastidores', 'fotografias', 'liberar para edição', 'checklist'],
    where: '/episodios', perm: 'production.manage',
    steps: [
      'Etapas: Gravado, Disponível para edição, Em edição, Em revisão, Em finalização, Pronto para publicar e Publicado. Cada passo tem quem faz e o que precisa estar pronto (por exemplo, ao menos um vídeo bruto para liberar a edição).',
      'Material bruto: na aba Material, "Enviar material" aceita vários arquivos de uma vez (vídeos do episódio e bastidores, áudios, fotografias); só vídeos e áudios do episódio têm rótulo. Os envios seguem em segundo plano na bandeja do canto da tela, e dá para navegar enquanto sobe.',
      'Enviar de novo os mesmos arquivos é seguro: o sistema reconhece pelo nome, continua os que pararam no meio e pergunta o que fazer com os repetidos (não enviar, substituir ou manter os dois). Se o envio parar com "armazenamento cheio", a conta do Backblaze chegou ao limite: a gestão aumenta em Backblaze > Caps & Alerts e depois é só tocar em "Tentar todos de novo". O botão Galeria abre fotos e vídeos com prévia.',
      'Na aba Material, os arquivos aparecem em pastas: Vídeos do episódio, Áudios, Bastidores, Fotografias e Outros (com subpastas pelo rótulo), e o vídeo editado tem uma pasta por versão, com os comentários de revisão daquela versão.',
      'O editor assume a edição, sobe o vídeo editado (horizontal) e envia para revisão. A gestão revisa com comentários na minutagem (texto, imagem, áudio), pede ajustes ou aprova.',
      'Finalização usa IA (transcrição, quadros, títulos, descrições, capas e posts), depois publica. Cortes são enviados em Conteúdo e ligados ao episódio.',
      'O editor de vídeo tem um Início próprio (fila para assumir, o que está com ele e ajustes pedidos) e recebe avisos de cada etapa.',
      'Pelo assistente: "episodios" mostra a etapa e o que falta; "avancar_episodio" move a etapa quando o perfil pode e nada falta.',
    ],
  },
  {
    key: 'plateia', title: 'Pulso Podcast com Plateia', words: ['plateia', 'inscrição', 'inscrito', 'inscritos', 'pedido', 'pedidos', 'selecionado', 'selecionar', 'isento', 'link de pagamento', 'infinitepay', 'pagamento da plateia', 'vaga'],
    where: '/plateia/painel', perm: 'audience.read',
    steps: [
      'A página pública lista as gravações dos convidados Agendados (com data futura e "Aberto para plateia"). A pessoa pede a vaga e é levada ao WhatsApp da produtora.',
      'Em Plateia > Pedidos há a Lista e o Quadro (colunas: Novo pedido, Em avaliação, Selecionado, Não selecionado e Desistiu; arrastar muda a situação), com busca e filtros por episódio e origem.',
      'Selecionar pede o valor combinado (conta a receber no Financeiro), "já recebi" ou isento. Em avaliação gera o link de pagamento da InfinitePay (quando configurada). Sair de Selecionado cancela a conta ainda não paga.',
      '"Adicionar pessoa" inclui quem foi combinado por fora. Cada pedido pode ser editado ou excluído (pedido já pago não é excluído).',
      'No dia da gravação, se há selecionados, o sistema cria uma tarefa para a produtora lembrar todo mundo, com a lista e uma mensagem sugerida.',
      'Preço, local, WhatsApp e imagens da página: Plateia > Ajustes (gestão).',
      'Pelo assistente: "plateia" lista pedidos e quem está selecionado; "plateia_adicionar", "plateia_situacao" e "plateia_selecionar" agem sobre os pedidos.',
    ],
  },
  {
    key: 'financeiro', title: 'Financeiro e estoque', words: ['financeiro', 'conta', 'contas', 'pagar', 'receber', 'caixa', 'custo', 'custos', 'estoque', 'fluxo', 'cobrança', 'cobranca', 'parcela'],
    where: '/financeiro', perm: 'finance.read',
    steps: [
      'Financeiro (gestão) reúne contas a pagar e a receber, fluxo de caixa e custo por episódio. Parcelas de patrocínio, pedidos selecionados da plateia e custos automáticos (regras que disparam quando a gravação é agendada, o episódio é gravado ou publicado) viram lançamentos sozinhos.',
      'Estoque do estúdio (gestão e produtora): itens com consumo por episódio e aviso de reposição; a compra gera conta a pagar.',
      'Pelo assistente: "financeiro" resume o mês, o caixa e o que vence ou atrasou, "contas" lista lançamentos e "estoque" mostra o que precisa de reposição. O assistente não lança nem paga contas.',
    ],
  },
  {
    key: 'calendario', title: 'Calendário e Google Agenda', words: ['calendário', 'calendario', 'agenda', 'google agenda', 'google', 'convite da gravação', 'visualização', 'visualizacao'],
    where: '/calendario', perm: 'calendar.read',
    steps: [
      'O Calendário reúne tudo que tem data (gravações, lembretes, tarefas com hora, publicações, posts, contas e parcerias), com filtros por tipo e responsável e visualizações salvas.',
      'A integração com o Google Agenda (Integrações) envia o que a gestão escolher para a agenda do Pulso (gravações, lembretes, posts e outros tipos; os que têm horário pedem uma duração). O convite da gravação ao e-mail do convidado é opcional (vem desligado).',
      'Pelo assistente: "calendario" lista o que há nos próximos dias.',
    ],
  },
  {
    key: 'app_celular', title: 'App no celular (instalar e ligar os alertas)', words: ['app', 'aplicativo', 'instalar', 'celular', 'iphone', 'android', 'tela de início', 'tela inicial', 'pwa', 'offline', 'sem internet', 'ícone'],
    where: '/', perm: null,
    steps: [
      'O Pulso instala como app no celular (e no computador). No Início do celular aparece o cartão "Use o Pulso como app"; também há "Instalar o app" no rodapé do menu.',
      'Android (Chrome, Edge, Samsung): tocar em Instalar e confirmar. iPhone: no Safari, Compartilhar > Adicionar à Tela de Início > Adicionar, e abrir o Pulso pelo ícone (os alertas no iPhone só funcionam assim, iOS 16.4 ou mais novo).',
      'Com o app aberto pelo ícone, o Início oferece "Ativar alertas": a partir daí as notificações chegam com o app fechado e o número de não lidas aparece no ícone. Dá para desligar em Notificações > Avisos.',
      'Segurar o ícone do app mostra atalhos: Nova tarefa, Tarefas, Agenda e Notificações. No celular, a barra de baixo tem Painel, atalhos do seu perfil, Avisos e Menu.',
      'Sem internet o app mostra "Sem conexão" e volta sozinho quando a rede retorna; o que estava salvo continua no servidor.',
    ],
  },
  {
    key: 'notificacoes', title: 'Notificações e lembretes da gravação', words: ['notificação', 'notificacao', 'notificações', 'aviso', 'avisos', 'alerta', 'push', 'lembrete', 'lembretes'],
    where: '/notificacoes', perm: null,
    steps: [
      'O sino mostra os avisos (tarefas, comentários e menções, agendamentos, plateia, financeiro, etapas do episódio e corte disponível para a gestão, follow-ups). Cada pessoa liga os alertas do navegador em Notificações > Avisos (no iPhone, só com o painel na Tela de Início). Quem é responsável por um convidado, patrocinador, episódio, corte ou tarefa também recebe aviso quando outra pessoa altera ou exclui esse cadastro (tipos "Cadastro alterado" e "Cadastro excluído"); a gestão liga ou desliga em Gestão > Notificações e cada pessoa pode silenciar.',
      'Lembretes da gravação (3 dias, 1 dia, no dia de manhã e 3 horas antes) ficam em Notificações > Lembretes da gravação, com a mensagem pronta e o botão do WhatsApp; a produtora envia e marca como enviado.',
      'Pelo assistente: "notificacoes" mostra as não lidas.',
    ],
  },
  {
    key: 'social', title: 'Social e conteúdo', words: ['social', 'redes', 'post', 'publicação', 'instagram', 'ideias', 'insights', 'automação', 'automacao', 'corte', 'cortes', 'conteúdo', 'conteudo', 'carrossel', 'story'],
    where: '/social', perm: 'social.read',
    steps: [
      'Social: publicações (a produtora pede e a gestão aprova), novo post, ideias por episódio (IA), insights e automações de comentários e directs. Conteúdo (cortes) guarda os cortes enviados, com título, legenda e capas sugeridos.',
      'Pelo assistente: "social" resume o que espera aprovação, agendados, com erro e sem uso.',
    ],
  },
  {
    key: 'gestao', title: 'Painel de gestão', words: ['gestão', 'gestao', 'configurar', 'configuração', 'ajustes', 'usuários', 'usuarios', 'logs', 'auditoria', 'integrações', 'integracoes', 'rotinas', 'busca global', 'saúde do sistema', 'whatsapp dos convites'],
    where: '/gestao', perm: 'users.read',
    steps: [
      'O menu de Gestão tem grupos com abas: Visão geral; Equipe (Usuários, Logs); Operação (Cadência de follow-up, Lembretes da gravação, Rotinas de tarefas, Notificações); Convites e parcerias (WhatsApp dos convites, Planos de patrocínio, Galeria do media kit); Sistema (Integrações, Busca global, Saúde do sistema).',
      'Cada aba aparece só para quem tem a permissão dela.',
    ],
  },
  {
    key: 'novidades', title: 'Novidades e versões', words: ['novidade', 'novidades', 'versão', 'versao', 'atualização', 'atualizacao', 'o que mudou', 'release'],
    where: '/novidades', perm: null,
    steps: [
      'A página Novidades lista cada versão com o que mudou (novo, ajuste, correção). A versão aparece no rodapé do menu. Pelo assistente: "novidades" mostra as últimas versões.',
    ],
  },
];

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Os assuntos que mais combinam com o pedido (até `limit`), do mais ao menos relevante.
function find(query, limit = 2) {
  const q = norm(query);
  if (!q.trim()) return [];
  const scored = TOPICS.map((t) => {
    let score = 0;
    if (norm(t.key) === q || norm(t.title) === q) score += 10;
    for (const w of [t.key, t.title, ...t.words]) { const n = norm(w); if (n && (q.includes(n) || (q.length >= 4 && n.includes(q)))) score += n.length >= 5 ? 3 : 2; }
    for (const part of q.split(/[^a-z0-9]+/).filter((x) => x.length >= 4)) if (t.words.some((w) => norm(w).split(/[^a-z0-9]+/).includes(part))) score += 1;
    return { t, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.t);
}

const index = () => TOPICS.map((t) => t.key);

module.exports = { TOPICS, find, index };
