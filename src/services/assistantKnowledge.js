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
      'Para baixar vários arquivos do material de uma vez: abra a pasta (por exemplo, Bastidores) e use "Selecionar" para marcar os arquivos e "Baixar selecionados", ou "Baixar tudo" para a pasta inteira; a galeria tem "Selecionar" e "Baixar pasta". Em Conteúdo > Posts, cada episódio com duas ou mais imagens também tem "Selecionar" (dá para marcar clicando na imagem) e "Baixar tudo". O botão Baixar de cada arquivo continua valendo. Os downloads saem um depois do outro e o navegador pode pedir permissão para baixar vários arquivos.',
      'Na aba Material, os arquivos aparecem em pastas: Vídeos do episódio, Áudios, Bastidores, Fotografias e Outros (com subpastas pelo rótulo), e o vídeo editado tem uma pasta por versão, com os comentários de revisão daquela versão.',
      'O editor assume a edição, sobe o vídeo editado (horizontal) e envia para revisão. A gestão revisa com comentários na minutagem (texto, imagem, áudio), pede ajustes ou aprova.',
      'Finalização usa IA (transcrição, quadros, títulos, descrições, capas e posts), depois publica. Cortes são enviados em Conteúdo e ligados ao episódio.',
      'No editor de capa, aba Fundo: quadros do vídeo, Fotografias (as fotos e bastidores do material bruto do episódio; HEIC não abre, use JPG/PNG/WebP) ou Enviar uma imagem. Dá para girar, espelhar, inverter, ajustar brilho/contraste/saturação/desfoque e deixar em preto e branco. Na aba Camadas, a sombra do texto vai para qualquer lado, com contorno e fundo escuro.',
      'Botão "Sugerir com IA" embaixo do texto da capa, do título e da legenda dos cortes, do Novo post e do título/descrição do YouTube: atalhos (outras opções, mais curto, em pergunta, frase do convidado, com número, mais sério, mais leve, com hashtags na legenda) ou um pedido livre. Vêm 3 opções; tocar aplica e "Desfazer" volta.',
      'O editor de vídeo tem um Início próprio (fila para assumir, o que está com ele e ajustes pedidos) e recebe avisos de cada etapa.',
      'Pelo assistente: "episodios" mostra a etapa e o que falta; "avancar_episodio" move a etapa quando o perfil pode e nada falta.',
    ],
  },
  {
    key: 'portal_convidado', title: 'Portal do convidado', words: ['portal do convidado', 'portal', 'collab', 'cortes exclusivos', 'exclusivo', 'fotos do convidado', 'entrega ao convidado', 'youtube collab'],
    where: '/convidados', perm: 'guests.read',
    steps: [
      'Cada convidado com episódio tem a aba "Portal" no cadastro. "Ativar portal" cria uma página só dele (link secreto), que se atualiza sozinha durante a semana do episódio.',
      'O portal mostra: o cronograma (cortes começam na segunda da semana em que o episódio sai, episódio no ar, cortes exclusivos), os posts em collab com ele (o sistema reconhece pelo @ do Instagram do cadastro no collab da publicação), os outros posts do episódio, o vídeo do YouTube e o player do Spotify incorporados, o link do Instagram, as fotos escolhidas (em galeria) e as duas formas de collab, com o botão "Falar com a produção".',
      'Cortes exclusivos: todo corte do episódio que não foi publicado entra como exclusivo do convidado, para ele baixar e postar, a partir da data dos exclusivos (padrão: o dia em que o episódio sai). Para tirar um, use "tirar" na aba Portal ou "tirar do portal" na página do corte.',
      '"Cronograma e aviso" ajusta as datas (vazio = automático) e como avisar de post novo em collab: e-mail sai sozinho; no WhatsApp a equipe recebe um lembrete e manda pelo botão "Avisar no WhatsApp" da aba.',
      '"Enviar link" manda o portal por e-mail ou abre o WhatsApp com a mensagem pronta. O que já estava em collab quando o link foi enviado não gera aviso.',
      'O material do portal fica disponível por 60 dias a partir do primeiro envio do link. Depois o link mostra que expirou; na aba Portal, "estender por mais 60 dias" libera de novo.',
      'Pelo portal, o convidado pode pedir o episódio em collab com o canal dele no YouTube; a equipe recebe o aviso, faz o convite no YouTube Studio e marca como feita na aba.',
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
      'As duas páginas da plateia mostram o vídeo dos bastidores ("Veja como é estar na plateia") e, no topo, os benefícios: networking com outros participantes selecionados, interação com o convidado, coffee break e bastidores. Trocar o vídeo hoje é pelo suporte técnico (não há botão no painel).',
      'Página de um convidado: no cadastro do convidado aberto para plateia, a aba "Página da plateia" ativa uma página só daquela gravação (Copiar link). "Editar página" põe o texto de como será, o horário de chegada da plateia e um bloco extra; até 6 fotos. O que ficar vazio não aparece. Os pedidos caem no mesmo painel.',
      'Link de parceiro (isento): na mesma aba, "Novo link" com o nome do parceiro e as vagas isentas (vazio = sem limite). Quem pede pelo link vê a participação isenta; o pedido chega marcado "parceiro · Nome", sem link de pagamento, e a seleção já vem como Isento. A seleção continua com a equipe. Vaga de quem não foi selecionado ou desistiu volta para o parceiro; esgotado, o link mostra o valor normal.',
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
      'No Instagram (Reels, post e carrossel) dá para convidar até 3 perfis para collab e marcar pessoas na janela de publicar: busca com sugestões (o convidado do episódio já vem no collab); em foto, toque na imagem para posicionar a marcação. Stories não têm collab.',
      'As publicações saem pelo Upload-Post, pela Zernio ou pela Outstand: a gestão escolhe em Integrações > Redes sociais (e testa a conexão). Ali também liga ou desliga a publicação de verdade de cada um (no modo de teste o pedido é montado, mas nada sai). Cada publicação é acompanhada por onde saiu. Insights, comentários, directs e automações são do Upload-Post.',
      'Cada rede pode sair por um provedor diferente: em Integrações > "Cada rede por um provedor" a gestão manda, por exemplo, o X pela Zernio e o resto pela Outstand. A publicação para várias redes é dividida sozinha. O painel vigia as contas a cada 15 minutos: conta desconectada ou que precisa reconectar aparece em "Contas das redes" (Integrações), em um alerta nas telas do Social e como aviso para a gestão; reconecta-se no painel do provedor e "Verificar agora" confere na hora.',
      'Envio de arquivos grandes: a fila manda 8 partes ao mesmo tempo e, com o "envio direto" ligado em Integrações > Armazenamento (Backblaze), o navegador envia direto ao Backblaze sem passar pelo servidor (cerca de 10 vezes mais rápido em teste). Se o envio parar, abra a página de novo e escolha os mesmos arquivos: ele continua de onde parou.',
      'Pela Outstand, o TikTok pode sair publicado direto ou como rascunho na caixa do TikTok (quem publica termina no app): a escolha fica em Integrações. A Outstand só edita post que ainda não saiu; depois de publicado, o texto se muda no app da rede.',
      'Entrega garantida: antes de ir a qualquer rede, o vídeo é conferido do começo ao fim (e, pela Outstand, vai para o armazenamento dela). Se o arquivo não vem inteiro, nada é enviado e a publicação espera. A rede que falha por motivo passageiro tenta de novo sozinha (2 min, 10 min, 30 min, 1 h, 3 h, 6 h; a fila do YouTube na Outstand, no horário que ela informa), e só ela é reenviada. Cada rede mostra o motivo, a hora da nova tentativa ou o que fazer; quando precisa de ação (reconectar conta, enviar o vídeo de novo), quem pediu e a gestão recebem um aviso. Na publicação, "Histórico de envio" mostra cada tentativa e "Parar novas tentativas" interrompe; Gestão > Sistema lista o que espera e o que precisa de ação.',
      'Post feito por fora (pelo app da rede, numa emergência ou falha): na página do corte, "Postado por fora? Registrar o link" recebe os links do post (a rede é reconhecida pelo endereço), o collab e quando saiu, e o corte passa a contar como publicado. Numa publicação com rede que falhou, "postei por fora" na linha da rede registra o link e para as novas tentativas.',
      'Corrigir e reenviar: na publicação com rede que falhou, "Corrigir e reenviar" abre uma janela com as redes que falharam marcadas, o motivo, o texto e o collab do Instagram. O texto editado vale só para as redes reenviadas (o que já saiu não muda) e rede que já está no ar não pode ser marcada. Cada rede com erro tem o atalho "Corrigir e reenviar só" ela. Em publicação que já saiu, "Publicar em outra rede" manda para uma rede que ainda não recebeu.',
      'Duração do corte por rede (conferida ao agendar): Reels do Facebook de 3 s a 1 min 30 s, Reels do Instagram até 15 min, Shorts até 3 min, Threads até 5 min, TikTok até o limite da conta (10 min no máximo); no X, mais de 2 min 20 s só funciona em conta Premium (é só aviso). Legenda: o X aceita 280 caracteres e o Threads 500; acima disso, cada um recebe a versão que cabe (parágrafos ou frases inteiras) e a tela avisa.',
      'Pelo assistente: "social" resume o que espera aprovação, agendados, com erro e sem uso.',
      'Conteúdo abre num quadro com cada peça na sua etapa (Pedido, Em produção, Em revisão, Pronto para postar, Na fila, Publicado). Para pedir algo ao editor que não é tarefa comum (trailer do canal, vídeo avulso, post, carrossel, story), use "Pedir conteúdo": briefing, prazo e responsável; a entrega volta para a gestão aprovar ou pedir ajustes e, aprovada, aparece no Social.',
      'Conteúdos do episódio: ao criar o episódio, marque o que pedir ao editor (Cortes, Q&A, Bastidores, Conteúdo extra). Cada um vira um pedido de conteúdo com prazo e responsável das rotinas, e a entrega sobe no sistema, sem Drive. Q&A e Bastidores são prioridade. Os cortes são um pedido contínuo: cada corte sobe quando fica pronto e já pode ser publicado. No fim, "Concluir cortes" encerra a leva, e "Retomar" reabre.',
      'Ações em massa no Conteúdo: em Cortes, Posts e carrosséis ou Pedidos, toque em "Selecionar", marque os itens (Shift marca um intervalo) e use a barra: cortes podem ser atribuídos ao episódio, baixados ou excluídos; posts aprovados, baixados ou excluídos; pedidos mudam responsável, prazo e prioridade, são cancelados ou excluídos. O que vai para a lixeira dá para desfazer.',
      'No Novo post do Social só aparece o que ainda não saiu, com os sugeridos primeiro; "Ver também os já publicados" mostra o resto, marcado. Story é só o que foi feito para story (capas de corte não entram).',
    ],
  },
  {
    key: 'gestao', title: 'Painel de gestão', words: ['gestão', 'gestao', 'configurar', 'configuração', 'ajustes', 'usuários', 'usuarios', 'logs', 'auditoria', 'integrações', 'integracoes', 'rotinas', 'busca global', 'saúde do sistema', 'whatsapp dos convites'],
    where: '/gestao', perm: 'users.read',
    steps: [
      'O menu de Gestão tem grupos com abas: Visão geral; Equipe (Usuários, Logs); Operação (Cadência de follow-up, Lembretes da gravação, Rotinas de tarefas, Notificações); Convites e parcerias (WhatsApp dos convites, Planos de patrocínio, Galeria do media kit); Sistema (Integrações, Busca global, Saúde do sistema, Lixeira).',
      'Cada aba aparece só para quem tem a permissão dela.',
    ],
  },
  {
    key: 'lixeira', title: 'Lixeira (restaurar o que foi apagado)', words: ['lixeira', 'restaurar', 'recuperar', 'apaguei', 'apagado', 'excluído', 'excluido', 'desfazer', 'voltar item', 'deletei'],
    where: '/lixeira', perm: null,
    steps: [
      'O que se apaga no sistema (episódio, convidado, patrocinador, tarefa, corte, post, pedido de conteúdo, arquivo do episódio ou do patrocinador, lançamento) vai para a Lixeira e fica 15 dias. Restaurar devolve o item como estava, com comentários, imagens e arquivos, no mesmo endereço.',
      'Logo depois de apagar, o aviso no topo da página tem o botão "Desfazer" (numa exclusão em massa, devolve todos). Depois, abra a Lixeira no rodapé do menu e use "Restaurar".',
      'Cada pessoa vê e restaura o que ela apagou. A gestão vê tudo (Gestão > Sistema > Lixeira), restaura qualquer item e pode "apagar de vez" antes do prazo. Passados 15 dias, o item e os arquivos saem de vez sozinhos.',
      'Se o item dependia de algo que também foi apagado (um corte de um episódio apagado), a Lixeira avisa para restaurar o outro antes.',
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
