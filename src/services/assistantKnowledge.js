// Base de conhecimento do assistente: como o Health Scale Studio funciona hoje, por assunto. O assistente consulta pela ferramenta
// "como_fazer" (em vez de carregar tudo no prompt) e responde com os passos e o lugar certo no painel.
// perm: a permissão de quem FAZ o passo (o assistente confere o perfil de quem pergunta e indica quem faz).
// Mantenha este arquivo junto das mudanças do sistema: assunto novo ou fluxo que mudou entra aqui.
const TOPICS = [
  {
    key: 'projetos', title: 'Projetos (Pulso, Projeto 100) e o seletor de projeto', words: ['projeto', 'projetos', 'projeto 100', 'pulso', 'seletor', 'trocar de projeto', 'todos os projetos', 'sigla', 'quem participa'],
    where: 'Gestão > Sistema > Projetos', perm: 'projects.manage',
    steps: [
      'O sistema cuida de mais de um projeto. Tudo o que já existia é do Pulso; o Projeto 100 foi criado e ainda está vazio. Para quem trabalha num projeto só, nada muda.',
      'Quem participa de mais de um projeto vê o seletor no topo do menu: Todos os projetos, ou um deles. A escolha fica guardada e a mesma tela recarrega com o outro recorte. Em "Todos os projetos", cada cartão mostra a sigla do projeto entre colchetes.',
      'Convidados, Patrocinadores, Episódios, Conteúdo e Tarefas seguem o projeto escolhido. Início, Calendário, Busca, Social, Plateia e Financeiro ainda mostram tudo junto.',
      'O que você cria nasce no projeto escolhido; em "Todos os projetos" o formulário pergunta o projeto primeiro. Item ligado a outro fica no projeto dele (o episódio de um convidado, o corte de um episódio). Tarefa pode ser geral, sem projeto.',
      'Em Gestão > Sistema > Projetos a gestão ajusta o nome, a sigla e como o projeto chama os seus vídeos, e marca quem participa de cada um ("Pessoas"). Toda pessoa participa de pelo menos um projeto.',
    ],
  },
  {
    key: 'categorias', title: 'Categorias de tarefa e tipos de vídeo', words: ['categoria', 'categorias', 'tipo de vídeo', 'tipos de vídeo', 'tipo de video', 'novo tipo', 'bastidor', 'vídeos entregues', 'videos entregues', 'desativar categoria'],
    where: 'Gestão > Sistema > Categorias', perm: 'catalog.manage',
    steps: [
      'Em Gestão > Sistema > Categorias ficam os tipos de vídeo e as categorias de tarefa. Os que já existiam vêm marcados "padrão".',
      'Para criar: "Novo tipo de vídeo" ou "Nova categoria", com o nome. Já aparece nas listas: o tipo de vídeo em Pedir conteúdo, nas rotinas e nas metas; a categoria na tarefa nova e nas rotinas.',
      'Renomear muda o nome em todo o sistema. Para tirar de uso, desative pelo interruptor: some das listas de escolha, mas o que já existe continua com o nome (nada se apaga).',
      'A meta "Vídeos entregues" (Gestão > Metas) conta, por tipo de vídeo, os vídeos que a pessoa enviou para revisão; cada vídeo conta uma vez, mesmo se voltar com ajustes.',
    ],
  },
  {
    key: 'tarefas', title: 'Tarefas', words: ['tarefa', 'tarefas', 'to-do', 'afazer', 'prazo', 'hora', 'vencimento', 'atrasada', 'quadro de tarefas', 'rotina de tarefa', 'rotinas'],
    where: '/tarefas', perm: 'tasks.write',
    steps: [
      'Tarefas tem três visões (Lista, Quadro e Calendário) e três recortes: Minhas tarefas, Hoje e Todas. Status: A fazer, Fazendo, Feito e Bloqueada (bloquear pede o motivo).',
      'Criar: botão "Nova tarefa". Campos: o que fazer, detalhes (texto formatado), responsável, "Vence em" e "Hora" (opcional; só a hora vale para hoje), tipo e, se quiser, o episódio, convidado ou patrocinador ligado.',
      'Com hora, a tarefa atrasa quando a hora passa; sem hora, só no dia seguinte. A pessoa recebe aviso ao receber a tarefa, quando o prazo muda, de manhã no dia, na última hora e quando atrasa.',
      'Os detalhes aceitam negrito, listas, tabelas, links (só a URL ou miniatura), imagens coladas com Ctrl+V e anexos PDF, HTML e ZIP.',
      'Rotinas de tarefas (Gestão > Rotinas de tarefas) criam tarefas sozinhas em momentos da produção, como "episódio liberado para edição", ou repetindo: todo dia útil, toda semana (nos dias marcados) ou todo mês, criando uma tarefa ou um pedido de conteúdo.',
      'Na tarefa nova, "Repetir" (todo dia útil, toda semana ou todo mês, no mesmo dia) faz a tarefa voltar sozinha. Na tarefa, "parar de repetir" encerra (quem criou ou a gestão). A categoria da tarefa pode ser uma das criadas em Gestão > Categorias.',
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
    key: 'mensagens', title: 'Mensagens (chat da equipe)', words: ['mensagem', 'mensagens', 'chat', 'conversa', 'grupo', 'thread', 'direct'],
    where: '/mensagens', perm: 'chat.use',
    steps: [
      'Em Mensagens, "Nova conversa" abre com uma pessoa ou cria um grupo. Enter envia e Shift+Enter quebra a linha (no celular, o botão envia).',
      'Passe o mouse na mensagem (no celular, toque nela) para reagir, responder em thread e, nas suas, editar ou apagar.',
      'O microfone grava áudio com transcrição; o clipe anexa arquivo.',
      'Toque no nome da conversa para ver os participantes. Quem administra o grupo renomeia, adiciona, remove e escolhe outros administradores; qualquer pessoa pode sair.',
      '"Resumir" usa a IA para resumir as não lidas, as últimas 24 horas, os últimos 7 dias ou uma thread, com decisões e pendências.',
      'Sem conexão, a mensagem fica guardada e sai sozinha quando a conexão voltar. Quem não leu em cerca de 8 segundos recebe um aviso no celular, com som e vibração, e em destaque no painel aberto; reação à sua mensagem também avisa. Mensagem não entra na lista de Notificações nem no sino: o número fica no ícone de Mensagens. O som do painel aberto se desliga em Notificações > Alertas; para calar uma conversa, toque no nome dela e escolha Nenhum.',
      'No grupo, a conversa mostra quem criou, quem entrou, quem saiu e quando o nome mudou; quem é adicionado recebe um aviso.',
      'Para marcar alguém num grupo, escreva @ e escolha a pessoa (@todos marca todo mundo). Para citar um episódio, corte, convidado, patrocinador, publicação ou tarefa, escreva # e o nome: o item entra como link clicável.',
      'Avisos de mensagens: em Notificações > Alertas, escolha receber todas as mensagens de grupo ou só quando marcarem você (conversa individual sempre avisa). Em cada conversa, toque no nome dela para escolher: padrão, todas, só quando me marcarem ou nenhum.',
    ],
  },
  {
    key: 'comentarios', title: 'Comentários, anexos e áudio', words: ['comentário', 'comentarios', 'comentar', 'menção', 'mencionar', 'arroba', 'áudio', 'audio', 'transcrição', 'anexo', 'anexar', 'imagem', 'print', 'pdf', 'zip', 'tabela', 'link miniatura', 'miniatura'],
    where: 'Cada convidado, patrocinador, episódio, corte e tarefa tem a caixa de comentários; a revisão do vídeo tem a dela', perm: 'comments.write',
    steps: [
      'Trecho na revisão do vídeo: arraste na linha do tempo, ou use "Marcar início do trecho" e "Marcar fim do trecho" (atalhos I e O). O comentário guarda início e fim; clicar no tempo dele toca o trecho e para no fim.',
      'Reações: todo comentário aceita reação com emoji (👍 ❤️ 😂 🎉 😮 🙏) pelo ícone de rostinho; clicar de novo tira. Quem escreveu recebe um aviso; para não receber, marque "Silenciar reações" em Notificações. A gestão também pode desligar esse aviso para todos.',
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
      'A identidade (nome, @, telefone, e-mail, empresa, cargo, bio, foto) é da pessoa, não do projeto: corrigir num lugar vale em todos. No cadastro, "Em outros projetos" mostra onde mais ela está e "Convidar também para…" cria a participação no outro projeto, em Prospecção, com os dados que já estão lá.',
      'A mesma pessoa em dois projetos não é duplicata. Dois cadastros parecidos em projetos diferentes se resolvem com "É a mesma pessoa" (as duas participações continuam); no mesmo projeto, "Juntar os dois cadastros" manda um para a lixeira.',
      'Pelo assistente: "convidado" mostra a situação, "lista_convidados" lista uma etapa, "criar_convidado" cadastra em Prospecção e "mudar_etapa_convidado" muda a etapa quando o convidado já tem o que a etapa exige.',
    ],
  },
  {
    key: 'cadencia', title: 'Cadência de follow-up', words: ['cadência', 'cadencia', 'follow-up', 'followup', 'follow up', 'abordagem', 'abordar', 'meta diária', 'possível perdido', 'sem resposta', 'registrar abordagem'],
    where: 'Convidado em Convite enviado e patrocinador em Prospecção (botão "Registrar abordagem"); painel em Gestão > Cadência', perm: 'guests.write',
    steps: [
      'Quem está sendo abordado (convidado em "Convite enviado", patrocinador em "Prospecção") tem um estado de follow-up: em dia, hoje, atrasado ou possível perdido (muitas tentativas sem resposta).',
      '"Registrar abordagem" abre uma janela curta: canal (Instagram, e-mail, WhatsApp, telefone, outro), qual endereço, se enviou ou se respondeu, quando e uma observação. Cada canal tem seu intervalo até o próximo follow-up. Follow-up nunca vence no fim de semana: se cair no sábado ou no domingo, passa para a segunda.',
      'A meta diária de abordagens (de patrocinadores ou de convidados) é uma das metas de cada pessoa, em Gestão > Metas. A de patrocinadores conta só abordagens novas: a primeira de cada patrocinador (follow-up não conta). O Início mostra os follow-ups e as metas; de manhã, quem tem pendências recebe um aviso.',
      'Gestão > Cadência (gestão) mostra o painel por canal e por pessoa e configura os intervalos dos follow-ups.',
      'Pelo assistente: "follow_ups" mostra quem precisa de abordagem e "registrar_abordagem" registra uma abordagem feita.',
    ],
  },
  {
    key: 'pos-gravacao', title: 'Página pós-gravação (QR Code do cartão)', words: ['pós-gravação', 'pos-gravacao', 'pós gravação', 'cartão de agradecimento', 'qr code', 'qrcode', 'depois da gravação', 'página do convidado'],
    where: '/pos-gravacao; o link fica em Gestão > WhatsApp dos convites', perm: 'guests.read',
    steps: [
      'A página pós-gravação é a do QR Code do cartão de agradecimento: a mesma para todos os convidados, abre sem login e não aparece em buscadores.',
      'Ela agradece, mostra o que acontece depois da gravação (triagem e edição; na sexta antes do episódio, o portal com a data do episódio; bastidores; episódio e cortes), o que tem no portal (fotos, o episódio com os links do YouTube e do Spotify, posts em collab em tempo real, agenda dos cortes e cortes inéditos), os cortes em collab, as redes do Pulso e o WhatsApp da produção.',
      'O endereço completo, com Abrir e Copiar link, fica em Gestão > WhatsApp dos convites. Ali também se muda o número e a mensagem que abre no WhatsApp ("Na página pós-gravação").',
    ],
  },
  {
    key: 'metas', title: 'Metas por pessoa', words: ['meta', 'metas', 'objetivo', 'objetivos', 'minhas metas', 'definir meta', 'acompanhar meta', 'quanto falta', 'seu ritmo', 'ritmo'],
    where: 'Gestão > Equipe > Metas (gestão define); Início de cada pessoa (Minhas metas); Início do editor (Seu ritmo)', perm: 'tasks.read',
    steps: [
      'A gestão define até 3 metas para cada pessoa em Gestão > Equipe > Metas: a categoria e o que contar, o período (por dia útil, por semana de segunda a domingo ou por mês), o alvo e se aparece em número ("12 de 20") ou em porcentagem.',
      'O sistema conta sozinho: convites enviados e aceitos, gravações marcadas e taxa de aceite (dos convidados de que a pessoa é responsável); abordagens de convidados e abordagens novas de patrocinadores (as que ela registrou; de patrocinador, só a primeira de cada um); reuniões agendadas; patrocínios fechados; cortes subidos e revisões de corte; posts publicados; episódios entregues para revisão; tarefas concluídas e no prazo; e, da equipe, seguidores, inscritos, cortes postados, Reels de teste e episódios publicados.',
      'Cada pessoa vê as dela no Início, no cartão Hoje, com quanto já fez, a barra de andamento e quanto falta até o fim do período. A barra fica lime quando a meta é batida. Meta por dia útil não cobra sábado e domingo.',
      'O editor vê no Início o "Seu ritmo": cortes subidos e revisões de corte de hoje e da semana, episódios entregues na semana e a próxima entrega, com as metas dele embaixo.',
    ],
  },
  {
    key: 'ordem-edicao', title: 'Ordem de edição (o que editar primeiro)', words: ['ordem de edição', 'ordem de edicao', 'prioridade', 'editar primeiro', 'qual editar', 'fila de edição', 'fila de edicao', 'data de veiculação', 'data de veiculacao', 'vai ao ar'],
    where: 'Início do editor ("Ordem de edição"), Episódios (quadro e lista) e a página do episódio', perm: 'episodes.read',
    steps: [
      'O sistema monta a ordem de edição pela data de veiculação: o episódio que vai ao ar antes é o 1º, depois o 2º, e assim por diante. No mesmo dia, vale o número do episódio; sem data, ele vai para o fim.',
      'Entram os episódios disponíveis para edição e os em edição, inclusive os que voltaram com ajustes pedidos (ajuste não fura a fila). Em revisão, finalização e pronto ficam de fora.',
      'A data aparece em vermelho se já passou e o episódio não saiu, e em âmbar se vai ao ar hoje ou nos próximos 2 dias.',
      'Ao liberar para edição um episódio sem data de veiculação, o sistema pergunta a data (dá para liberar sem; aí ele vai para o fim). O aviso ao editor diz em que posição o episódio entrou.',
      'Para mudar a ordem, mude a data de veiculação do episódio em Editar.',
    ],
  },
  {
    key: 'seu-dia', title: 'Seu dia (Início da produtora)', words: ['seu dia', 'meu dia', 'início da produtora', 'inicio da produtora', 'plano do dia', 'previsto', 'previstos', 'feito de previsto', 'quentes agora', 'quente', 'aceitos sem data', 'motivos de perda', 'por que perdeu', 'o que o dia rendeu', 'minhas tarefas'],
    where: 'Início da produtora (bloco "Seu dia"); "Equipe" mostra o Resumo do dia da equipe', perm: 'guests.write',
    steps: [
      'A produtora abre o Início no "Seu dia", com os números dela e as mesmas setas e calendário do Resumo do dia. O botão "Equipe" mostra o resumo da equipe, e a escolha segue junto ao trocar de dia.',
      'Plano do dia (feito de previsto): abordagens novas de patrocinadores (só a primeira de cada um, contra a meta diária, e quantos ainda estão a abordar), follow-ups de patrocinadores e de convidados (os marcados para o dia pela cadência e quantos ela já fez; os atrasados de antes aparecem à parte), convites enviados (contra a meta diária, e quantos aguardam resposta) e as tarefas com prazo no dia.',
      'Follow-up feito = o patrocinador ou convidado recebeu contato no dia (Registrar abordagem) ou saiu da etapa (respondeu, avançou ou foi perdido). Contam os dela e os sem responsável.',
      'O que o dia rendeu: convites aceitos (e quantos estão em agendamento), convidados perdidos (com o motivo), patrocinadores interessados (foram para Em negociação), reuniões que ela marcou (e a próxima) e patrocínios fechados.',
      'Por que seus convidados foram perdidos: os motivos dos últimos 30 dias, com quantidade e porcentagem. As outras metas dela (as que não estão no plano) ficam em "Minhas metas".',
      'Embaixo: o cartão Hoje com os follow-ups que faltam e "Quentes agora" (patrocinador que abriu o media kit ou pediu uma conversa, convidado que abriu o convite e não respondeu, nas últimas 48 horas e sem abordagem depois), os aceitos ainda sem data de gravação, as próximas gravações e reuniões e as tarefas dela.',
    ],
  },
  {
    key: 'resumo-dia', title: 'Resumo do dia no Início', words: ['resumo do dia', 'resumo', 'painel', 'início', 'inicio', 'dashboard', 'números do dia', 'numeros do dia', 'convites enviados', 'convites aceitos', 'seguidores', 'inscritos', 'cortes postados', 'cortes subidos', 'revisões', 'revisoes', 'reels de teste', 'tarefas atrasadas', 'patrocínio', 'patrocinio', 'patrocinadores', 'prospecção', 'prospeccao', 'abordados', 'follow-ups', 'follow-up', 'interessados', 'fechados'],
    where: 'Início (a primeira tela), bloco "Resumo do dia"', perm: 'production.manage',
    steps: [
      'O Início abre com o Resumo do dia: convites enviados, aceitos (e quantos estão em agendamento), agendados e perdidos; episódios gravados e publicados; cortes subidos pelo editor, revisões (versão nova de um corte), agendados para hoje (cortes e posts: quantos já saíram e quantos ainda vão sair), cortes postados e Reels de teste; seguidores no Instagram, inscritos no YouTube (com o saldo da semana) e tarefas atrasadas.',
      'O caminho "Da prospecção ao patrocínio" mostra os patrocinadores que entraram em prospecção, os abordados pela primeira vez (e quantos ainda estão a abordar), os follow-ups do dia (e quantos estão para hoje ou atrasados na cadência; num dia que passou, quantos ficaram atrasados), os interessados (foram para Em negociação), os fechados (entraram em Ganho; embaixo, os patrocínios ativos) e os perdidos no dia.',
      'Abordagem e follow-up vêm do Registrar abordagem: a primeira abordagem do ciclo (desde que o patrocinador entrou em Prospecção) é "abordado"; contato de novo num dia seguinte é follow-up, um por patrocinador no dia, mesmo por mais de um canal.',
      'Logo abaixo do caminho dos convidados, "Por que os convidados foram perdidos": os motivos marcados nos convidados perdidos nos últimos 30 dias até o dia escolhido, do mais comum para o menos, com a quantidade e a porcentagem.',
      'Os três caminhos (do convite ao episódio, da prospecção ao patrocínio e o do conteúdo) têm um ponto em cada passo: aceso quando algo aconteceu naquele passo no dia.',
      'O número grande é o do dia; embaixo, como estava no fim daquele dia (hoje: até agora). Mudança de etapa desfeita no mesmo dia não conta.',
      'As setas mudam o dia, o calendário escolhe qualquer dia desde o primeiro convidado e "Hoje" volta. O dia fica no endereço, então dá para mandar o link de um dia.',
      'Cada número leva à lista dele: convidados da etapa, cortes, publicações, Insights ou tarefas.',
      'Seguidores e inscritos são o saldo do dia (entradas menos saídas): a última leitura do dia menos a do dia anterior. Dia sem leitura aparece como "sem leitura".',
    ],
  },
  {
    key: 'material-patrocinador', title: 'Material do patrocinador (logos, moldura, QR Code)', words: ['logo', 'logos', 'logomarca', 'marca', 'moldura', 'qr code', 'qrcode', 'material do patrocinador', 'material da marca', 'manual da marca', 'vídeo de inserção', 'video de insercao', 'logo principal', 'pasta do patrocinador'],
    where: 'Página do patrocinador, aba Material (a partir de Ganho)', perm: 'sponsors.read',
    steps: [
      'A aba Material aparece quando o patrocinador está em Ganho, Ativo ou Inativo, com as pastas Logos, Moldura, QR Code e Material da marca.',
      'Para enviar: Enviar material (ou arraste os arquivos para a aba), diga a pasta de cada um e confirme. Os arquivos sobem em segundo plano, como o material do episódio; dá para continuar usando o sistema.',
      'Logos: a principal é a que aparece no media kit, no portal do patrocinador e no episódio patrocinado. A primeira enviada vira a principal; para trocar, use "usar como principal" na logo que quiser.',
      'Moldura e QR Code enviados vão para o entregável e para o portal do patrocinador.',
      'Para baixar: o botão Baixar de cada arquivo, ou Selecionar e Baixar tudo para um ZIP com vários.',
      'O editor vê e baixa (no episódio patrocinado há o link "Todo o material"); enviar, trocar a principal e apagar é de quem edita patrocinadores.',
    ],
  },
  {
    key: 'patrocinadores', title: 'Patrocinadores, planos e media kit', words: ['patrocinador', 'patrocinadores', 'patrocínio', 'cota', 'ouro', 'diamond', 'media kit', 'mediakit', 'portal', 'reunião', 'reuniões', 'meet', 'google meet', 'formulário', 'entregável', 'entregaveis', 'plano', 'planos', 'galeria', 'quem já sentou'],
    where: '/patrocinadores', perm: 'sponsors.write',
    steps: [
      'Etapas: Prospecção, Em negociação, Ganho (formulário de cadastro), Ativo (portal e entregas), mais Inativo e Perdido. A página do patrocinador guia o próximo passo.',
      'Reuniões: na aba Reuniões do patrocinador, "Marcar reunião" pede data e hora, duração, Google Meet ou presencial (com endereço), os e-mails da empresa e o responsável. A reunião vai para o Google Agenda do Pulso, o Google cria o Meet e manda o convite. Remarcar e cancelar avisam todo mundo; o que muda no Google Agenda (horário, Meet, quem confirmou) aparece em até 15 minutos. Depois da reunião, o resumo fica guardado nela ("Colar resumo"). Se aparecer "Não foi para o Google", o motivo vem junto e "Tentar de novo" envia outra vez.',
      'Cada patrocinador recebe um link reutilizável (sem criar conta) para o media kit, o formulário de cadastro e o portal. "Agendar uma conversa" no media kit leva à negociação e abre o WhatsApp comercial. O kit não mostra planos nem preços: lista o que a marca pode ter, as vagas abertas (máximo em Gestão > Planos), as marcas marcadas \"Mostrar no media kit\" e a agenda dos próximos convidados com estreia e alcance.',
      'Planos (Ouro e Diamond), com preço e entregáveis, ficam em Gestão > Planos de patrocínio e alimentam o media kit, a cota e as entregas do portal.',
      'O slide "Quem já sentou à mesa" do media kit mostra os episódios gravados (publicados ou ainda em produção) que a gestão escolher em Gestão > Galeria do media kit (alcance e frase editáveis). O slide mostra um convidado em destaque, que troca sozinho, e todos os escolhidos numa grade de fotos quadradas, sem passar de página.',
      'O WhatsApp comercial e as mensagens prontas se configuram em Gestão > WhatsApp dos convites.',
      'Pelo assistente: "patrocinador" mostra etapa, cota, formulário, entregas e gravações reservadas.',
    ],
  },
  {
    key: 'episodios', title: 'Episódios e produção', words: ['episódio', 'episodio', 'episódios', 'produção', 'producao', 'edição', 'edicao', 'editor', 'revisão', 'revisao', 'aprovar', 'finalização', 'finalizacao', 'publicar', 'material bruto', 'bruto', 'bastidores', 'fotografias', 'liberar para edição', 'checklist'],
    where: '/episodios', perm: 'production.manage',
    steps: [
      'Quando o editor termina de subir o vídeo editado, a transcrição começa sozinha em segundo plano (ninguém precisa esperar). O card "Vídeo editado" mostra se ela está pronta. A análise por IA da finalização usa essa transcrição.',
      'Etapas: Gravado, Disponível para edição, Em edição, Em revisão, Em finalização, Pronto para publicar e Publicado. Cada passo tem quem faz e o que precisa estar pronto (por exemplo, ao menos um vídeo bruto para liberar a edição).',
      'Material bruto: na aba Material, "Enviar material" aceita vários arquivos de uma vez (vídeos do episódio e bastidores, áudios, fotografias); só vídeos e áudios do episódio têm rótulo. Os envios seguem em segundo plano na bandeja do canto da tela, e dá para navegar enquanto sobe.',
      'Enviar de novo os mesmos arquivos é seguro: o sistema reconhece pelo nome, continua os que pararam no meio e pergunta o que fazer com os repetidos (não enviar, substituir ou manter os dois). Se o envio parar com "armazenamento cheio", a conta do Backblaze chegou ao limite: a gestão aumenta em Backblaze > Caps & Alerts e depois é só tocar em "Tentar todos de novo". O botão Galeria abre fotos e vídeos com prévia.',
      'Para baixar vários arquivos do material de uma vez: abra a pasta (por exemplo, Bastidores) e use "Selecionar" para marcar os arquivos e "Baixar selecionados", ou "Baixar tudo" para a pasta inteira; a galeria tem "Selecionar" e "Baixar pasta". Em Conteúdo > Posts, cada episódio com duas ou mais imagens também tem "Selecionar" (dá para marcar clicando na imagem) e "Baixar tudo". O botão Baixar de cada arquivo continua valendo. Com dois ou mais arquivos, tudo vem num ZIP só, montado enquanto baixa (a barra de downloads do navegador mostra o andamento); um arquivo sozinho baixa direto.',
      'Na aba Material, os arquivos aparecem em pastas: Vídeos do episódio, Áudios, Bastidores, Fotografias e Outros (com subpastas pelo rótulo), e o vídeo editado tem uma pasta por versão, com os comentários de revisão daquela versão.',
      'O editor assume a edição, sobe o vídeo editado (horizontal) e envia para revisão. A gestão revisa com comentários na minutagem (texto, imagem, áudio), pede ajustes ou aprova.',
      'Ajustes da revisão: na aba Material, o editor marca cada ajuste como feito; ao subir a nova versão ele vira "feito na v2" e quem revisa confere ("Conferido") ou devolve ("Ainda não"). A versão que tem comentários não pode ser removida: a correção sobe como versão nova, e os comentários seguem.',
      '"Baixar marcadores" (no cartão de ajustes e na revisão): gera um arquivo para o Premiere Pro (.xml: Arquivo > Importar cria a sequência "ajustes da revisão" com os marcadores; para levá-los à edição, copie a sua sequência e cole nela, no início), para o DaVinci Resolve (Timeline > Import > Timeline Markers from EDL) ou uma lista em texto. As minutagens são aproximadas, uma orientação: o editor confere o ponto certo antes de cortar.',
      'Finalização usa IA (transcrição, quadros, títulos, descrições, capas e posts), depois publica. Cortes são enviados em Conteúdo e ligados ao episódio.',
      'Editar uma capa: o botão "Editar" do cartão (Finalização > Capas e vídeos, página do corte) tem duas formas. "Editor completo" mexe em cada parte da capa: texto, fonte, peso, tamanho, cor, lugar, transparência e a ordem das camadas; tocar nas palavras marca o destaque (e escolhe a cor dele); o quadradinho no canto aumenta ou diminui (com Shift, só a largura da caixa do texto); dá para adicionar texto, tarja, logotipo e linha, duplicar, ocultar, desfazer e refazer. "Ajustar pelo modelo" troca o modelo, a foto ou o texto com os limites do guia e monta a capa de novo (o que foi mexido no editor completo se perde, e a janela avisa). A capa mexida no editor completo não muda sozinha quando a ficha muda: fica "desatualizada", com Atualizar.',
      'Post que falhou: em Conteúdo, os filtros "Falha ao publicar", "Motivo da falha" e "Rede que falhou" mostram o que não saiu, e o cartão do corte diz em que rede falhou e quando tenta de novo. Falha por assinatura, chave ou contas do provedor (Outstand, Zernio) volta sozinha para a fila quando o provedor responde de novo (de 20 em 20 minutos, até 3 dias depois); a gestão é avisada.',
      'Reler vários cortes com a IA: Conteúdo > Cortes, Selecionar, marque os cortes e toque em "Reler com IA" (o filtro "Leitura da IA incompleta" acha os que ficaram sem capa ou sem a leitura). A legenda que já existe e as capas editadas ou aprovadas ficam.',
      'No editor completo, aba Foto e fundo: aproximar, mover e espelhar a foto (o rosto continua no lugar), brilho, contraste, saturação e preto e branco, a cor do fundo, e trocar a foto por um quadro do vídeo, uma fotografia do material bruto (HEIC não abre, use JPG/PNG/WebP) ou uma imagem enviada. Nas capas antigas e nos posts também dá para girar, inverter, desfocar e escurecer. Na aba Camadas, a sombra do texto vai para qualquer lado, com contorno e fundo atrás do texto.',
      'Automação "comentou, recebe no direct": ao publicar (um corte, um post ou vários), abra "Automação no Instagram" e marque "Responder no direct quem comentar a palavra". A palavra padrão é o primeiro nome do convidado (ex.: TAMIRIS); a chamada do Instagram passa a ser "Comente TAMIRIS e receba no direct o link do episódio completo". A mensagem usa {episodio} (link do episódio no YouTube; antes da estreia, o canal), {comunidade}, {canal}, {spotify} e {convidado}. Os links ficam em Social > Automações. Para funcionar, a gestão liga uma vez em Integrações > Comentários e directs: reconectar o Instagram com acesso às mensagens e cadastrar o aviso (webhook) na Outstand. O Instagram só deixa uma resposta no direct por comentário, até 7 dias depois dele.',
      'Publicar vários cortes de uma vez: Conteúdo > Cortes, "Prontos para postar" (dá para filtrar por episódio e ordenar), "Selecionar", marque os cortes e toque em "Publicar". Escolha as redes, o dia de início, a janela do dia (ex.: das 08:00 às 22:00), quantos por dia e quantos vão ao Instagram como Reel de teste. A agenda aparece para conferir: dá para mudar o horário de um corte e marcar ou desmarcar o Reel de teste. Depois, "Agendar". A produtora manda para a revisão da gestão.',
      'Capas de vários cortes: com os cortes marcados, "Capas e textos" abre uma linha por corte para escolher a capa e reescrever o texto. "Sugerir textos para todos" pede 3 opções à IA para cada um. Ao salvar, o texto novo vira uma capa nova sobre o mesmo quadro do vídeo e fica escolhida.',
      'Chamada no fim da legenda, por rede: na janela de publicar, "Chamada no fim da legenda, por rede" mostra a chamada de cada rede (YouTube: inscreva-se; Instagram: siga o perfil; TikTok: segue; LinkedIn: siga, com motivo profissional). A IA escreve uma para cada corte; sem ela, entra uma padrão da rede. Dá para editar, apagar a de uma rede ou desmarcar "Terminar a legenda com a chamada da rede". A legenda em si não leva a chamada.',
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
      'Trocar o vídeo de um corte: na página do corte, "Trocar vídeo" (editor e gestão), enquanto ele não foi publicado. Título, legenda, capa escolhida e comentários continuam, e a versão anterior fica em "Versões anteriores" para baixar. Publicação agendada ou em revisão sai com o vídeo novo. Depois de publicado, não dá mais para trocar.',
      'Calendário de posts: na aba Portal, "Montar calendário" abre uma janela com uma linha por post (data, horário provável e o que sai). Salvo, aparece no portal, na seção de posts em collab, como previsão; não precisa ter o post pronto. "Tirar do portal" esconde sem apagar as datas. O convidado não recebe aviso automático: mande o link.',
      'Vídeo do episódio para baixar: não vem ligado. Na aba Portal, em "No portal agora", "liberar para baixar" deixa o convidado baixar a versão mais nova do vídeo editado (ela acompanha cada versão nova do editor); "tirar" fecha.',
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
      'As páginas da plateia têm um botão flutuante "Dúvidas? Fale com a produção" que abre o WhatsApp da produtora (o número de Plateia > Ajustes); os cliques aparecem nos Resultados.',
      'Em Plateia > Pedidos há a Lista e o Quadro (colunas: Novo pedido, Em avaliação, Selecionado, Não selecionado e Desistiu; arrastar muda a situação), com busca e filtros por episódio e origem.',
      'Selecionar pede o valor combinado (conta a receber no Financeiro), "já recebi" ou isento. Em avaliação gera o link de pagamento da InfinitePay (quando configurada). Sair de Selecionado cancela a conta ainda não paga.',
      '"Adicionar pessoa" inclui quem foi combinado por fora. Cada pedido pode ser editado ou excluído (pedido já pago não é excluído).',
      'No dia da gravação, se há selecionados, o sistema cria uma tarefa para a produtora lembrar todo mundo, com a lista e uma mensagem sugerida.',
      'Meta Pixel: as páginas da plateia, do patrocinador (media kit, cadastro, portal) e do convidado (convite, portal) medem as visitas; na plateia, enviar o formulário de interesse conta como conversão (Lead). O ID do Pixel da plateia pode ser trocado em Plateia > Ajustes.',
      'Valor da vaga: o geral fica em Plateia > Ajustes; cada gravação pode ter o seu no cadastro do convidado, em "Podcast com plateia" (editar; vazio = o geral). Pedidos já feitos guardam o valor da época.',
      'Preço, local, WhatsApp e imagens da página: Plateia > Ajustes (gestão).',
      'As duas páginas da plateia mostram o vídeo dos bastidores ("Veja como é participar do Pulso Podcast", logo depois do topo) e, no topo, os benefícios: networking com outros participantes selecionados, interação com o convidado, coffee break e bastidores. Trocar o vídeo hoje é pelo suporte técnico (não há botão no painel).',
      'Página de um convidado: no cadastro do convidado aberto para plateia, a aba "Página da plateia" ativa uma página só daquela gravação (Copiar link). "Editar página" põe o texto de como será, o horário de chegada da plateia e um bloco extra; até 6 fotos. O que ficar vazio não aparece. Os pedidos caem no mesmo painel.',
      'Logo do parceiro: no cartão do link, "enviar logo" (PNG, JPEG ou WebP, até 5 MB). Ela aparece no convite, na página de inscrição de quem chega por aquele link, sobre um fundo claro.',
      'Link de parceiro (isento): na mesma aba, "Novo link" com o nome do parceiro e as vagas isentas (vazio = sem limite). Quem pede pelo link vê a participação isenta; o pedido chega marcado "parceiro · Nome", sem link de pagamento, e a seleção já vem como Isento. A seleção continua com a equipe. Vaga de quem não foi selecionado ou desistiu volta para o parceiro; esgotado, o link mostra o valor normal.',
      'Pelo assistente: "plateia" lista pedidos e quem está selecionado; "plateia_adicionar", "plateia_situacao" e "plateia_selecionar" agem sobre os pedidos.',
    ],
  },
  {
    key: 'financeiro', title: 'Financeiro e estoque', words: ['financeiro', 'conta', 'contas', 'pagar', 'receber', 'caixa', 'custo', 'custos', 'estoque', 'fluxo', 'cobrança', 'cobranca', 'parcela', 'banco de horas', 'horas do estúdio', 'horas do estudio'],
    where: '/financeiro', perm: 'finance.read',
    steps: [
      'Financeiro (gestão) reúne contas a pagar e a receber, fluxo de caixa e custo por episódio. Parcelas de patrocínio, pedidos selecionados da plateia e custos automáticos (regras que disparam quando a gravação é agendada, o episódio é gravado ou publicado) viram lançamentos sozinhos.',
      'Estoque (gestão e produtora): itens com consumo por episódio e aviso de reposição; a compra gera conta a pagar. Cada item é de um projeto ou compartilhado (o que todos usam): com um projeto escolhido no menu, aparecem só os itens dele e os compartilhados, e o vídeo gravado desconta só esses.',
      'Comprovante: na janela de novo lançamento (a nota ou o boleto) e na de pagar (o comprovante do pagamento), "Anexar arquivo" aceita PDF ou foto. Depois, o clipe na linha do lançamento mostra os arquivos, anexa mais (mesmo já pago) e tira um.',
      'Banco de horas do estúdio: ligado em Custos automáticos > Estúdio e caixa ("Ligar banco de horas", com o primeiro episódio do banco e a primeira compra). Daí em diante as gravações não geram sinal nem saldo: o convidado Agendado reserva horas e o episódio gravado usa a duração real. O cartão no topo do Financeiro mostra o que sobra, "Registrar compra" lança a renovação como despesa paga e a gestão é avisada quando sobram poucas horas.',
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
      'O sino mostra os avisos (tarefas, comentários e menções, agendamentos, plateia, financeiro, etapas do episódio e corte disponível para a gestão, follow-ups, que vão só para as produtoras; mensagens não entram no sino, têm aviso próprio). Cada pessoa liga os alertas do navegador em Notificações > Avisos (no iPhone, só com o painel na Tela de Início). Quem é responsável por um convidado, patrocinador, episódio, corte ou tarefa também recebe aviso quando outra pessoa altera ou exclui esse cadastro (tipos "Cadastro alterado" e "Cadastro excluído"); a gestão liga ou desliga em Gestão > Notificações e cada pessoa pode silenciar.',
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
      'Insights: cada rede aparece pela conta em que está conectada (Instagram, Facebook, TikTok e Threads pela Outstand; YouTube e X pela Zernio). O Resumo mostra seguidores e a variação em 7 dias; cada aba de rede mostra os números dos últimos 30 dias, o gráfico de seguidores por dia e os posts que mais renderam. Os números são lidos no máximo uma vez por hora; "Atualizar agora" lê de novo.',
      'Pela Outstand, o TikTok pode sair publicado direto ou como rascunho na caixa do TikTok (quem publica termina no app): a escolha fica em Integrações. A Outstand só edita post que ainda não saiu; depois de publicado, o texto se muda no app da rede. Pela Outstand, marcar pessoas só vale em foto: no Reel use o collab. Envio que fica parado lá por mais de 30 minutos é cancelado e tentado de novo. O vídeo vai como foi enviado (exporte os cortes em 1080p, até 10 Mbps); ajustar o vídeo na Outstand é cobrado e só acontece se a gestão ligar em Integrações.',
      'Entrega garantida: antes de ir a qualquer rede, o vídeo é conferido do começo ao fim (e, pela Outstand, vai para o armazenamento dela). Se o arquivo não vem inteiro, nada é enviado e a publicação espera. A rede que falha por motivo passageiro tenta de novo sozinha (2 min, 10 min, 30 min, 1 h, 3 h, 6 h; a fila do YouTube na Outstand, no horário que ela informa), e só ela é reenviada. Cada rede mostra o motivo, a hora da nova tentativa ou o que fazer; quando precisa de ação (reconectar conta, enviar o vídeo de novo), quem pediu e a gestão recebem um aviso. Na publicação, "Histórico de envio" mostra cada tentativa e "Parar novas tentativas" interrompe; Gestão > Sistema lista o que espera e o que precisa de ação.',
      'Post feito por fora (pelo app da rede, numa emergência ou falha): na página do corte, "Postado por fora? Registrar o link" recebe os links do post (a rede é reconhecida pelo endereço), o collab e quando saiu, e o corte passa a contar como publicado. Numa publicação com rede que falhou, "postei por fora" na linha da rede registra o link e para as novas tentativas.',
      'Corrigir e reenviar: na publicação com rede que falhou, "Corrigir e reenviar" abre uma janela com as redes que falharam marcadas, o motivo, o texto e o collab do Instagram. O texto editado vale só para as redes reenviadas (o que já saiu não muda) e rede que já está no ar não pode ser marcada. Cada rede com erro tem o atalho "Corrigir e reenviar só" ela. Em publicação que já saiu, "Publicar em outra rede" manda para uma rede que ainda não recebeu.',
      'Duração do corte por rede (conferida ao agendar): Reels do Facebook de 3 s a 1 min 30 s, Reels do Instagram até 15 min, Shorts até 3 min, Threads até 5 min, TikTok até o limite da conta (10 min no máximo); no X, mais de 2 min 20 s só funciona em conta Premium (é só aviso). Legenda: o X aceita 280 caracteres e o Threads 500; acima disso, cada um recebe a versão que cabe (parágrafos ou frases inteiras) e a tela avisa.',
      'Pelo assistente: "social" resume o que espera aprovação, agendados, com erro e sem uso.',
      'Conteúdo abre num quadro com cada peça na sua etapa (Pedido, Em produção, Em revisão, Pronto para postar, Na fila, Publicado). Para pedir algo ao editor que não é tarefa comum (trailer do canal, vídeo avulso, post, carrossel, story), use "Pedir conteúdo": briefing, prazo e responsável; a entrega volta para a gestão aprovar ou pedir ajustes e, aprovada, aparece no Social.',
      'Conteúdos do episódio: ao criar o episódio, marque o que pedir ao editor (Cortes, Q&A, Bastidores, Conteúdo extra). Cada um vira um pedido de conteúdo com prazo e responsável das rotinas, e a entrega sobe no sistema, sem Drive. Q&A e Bastidores são prioridade. Os cortes são um pedido contínuo: cada corte sobe quando fica pronto e já pode ser publicado. No fim, "Concluir cortes" encerra a leva, e "Retomar" reabre.',
      'Ações em massa no Conteúdo: em Cortes, Posts e carrosséis ou Pedidos, toque em "Selecionar", marque os itens (Shift marca um intervalo) e use a barra: cortes podem ser atribuídos ao episódio, baixados ou excluídos; posts aprovados, baixados ou excluídos; pedidos mudam responsável, prazo e prioridade, são cancelados ou excluídos. O que vai para a lixeira dá para desfazer.',
      'No Novo post do Social só aparece o que ainda não saiu, com os sugeridos primeiro; "Ver também os já publicados" mostra o resto, marcado. Story é só o que foi feito para story (capas de corte não entram). Para achar um corte, use a busca (título, convidado ou EP) e o filtro de episódio acima dos cartões; escolhido, ele vira um resumo com "Trocar" e o formulário aparece logo abaixo.',
      'Agenda da semana: em Conteúdo > Cortes, "Agenda da semana" (ou o link no fim da coluna "Pronto para postar" do quadro) monta a semana com os cortes prontos que ainda não saíram, um episódio de cada vez, começando pelo que foi ao ar mais recentemente. Confira, mude horários ou o Reel de teste e agende. "Ajustar" guarda as redes, quantos por dia, os horários, os Reels de teste e a automação; toda segunda de manhã a equipe recebe o aviso com a agenda pronta. Nada sai sem alguém agendar.',
      'Números dos posts: o sistema lê a cada 6 horas as views, curtidas, comentários e compartilhamentos do que saiu pelo painel (pela Outstand e pela Zernio). A publicação mostra os números de cada rede, o corte mostra o total, o quadro mostra as views no cartão e Social > Insights > "O que publicamos" lista os cortes que mais funcionaram. A IA usa os cinco mais vistos como referência ao sugerir capa, título e legenda. Post feito por fora do sistema não tem como ser lido.',
      'Palavra no direct: em Social > Automações, uma automação do tipo Direct responde na própria conversa quando alguém manda a palavra no direct do Instagram. Precisa do aviso de mensagens (message.received) da Outstand, ligado pela gestão em Integrações > Comentários e directs. O Instagram só deixa responder até 24 horas depois da mensagem.',
      'Listas longas têm busca: todo seletor com muitas opções (episódio, convidado, patrocinador, pessoa) abre com uma caixa de busca; digite parte do nome, sem acento. Os filtros das listas (Convidados, Patrocinadores, Usuários, Publicações, Auditoria) se aplicam ao escolher, sem botão "Filtrar".',
    ],
  },
  {
    key: 'gestao', title: 'Painel de gestão', words: ['gestão', 'gestao', 'configurar', 'configuração', 'ajustes', 'usuários', 'usuarios', 'logs', 'auditoria', 'integrações', 'integracoes', 'rotinas', 'busca global', 'saúde do sistema', 'whatsapp dos convites'],
    where: '/gestao', perm: 'users.read',
    steps: [
      'O menu de Gestão tem grupos com abas: Visão geral; Equipe (Usuários, Logs); Operação (Cadência de follow-up, Lembretes da gravação, Rotinas de tarefas, Notificações); Convites e parcerias (WhatsApp dos convites, Planos de patrocínio, Galeria do media kit); Sistema (Integrações, Busca global, Saúde do sistema, Desempenho, Lixeira).',
      'Cada aba aparece só para quem tem a permissão dela.',
    ],
  },
  {
    key: 'reel_teste', title: 'Reel de teste no Instagram', words: ['reel de teste', 'reels de teste', 'trial reel', 'trial reels', 'teste no instagram', 'testar reel', 'não seguidores', 'nao seguidores', 'quem não segue'],
    where: '/conteudo', perm: 'social.publish',
    steps: [
      'Abra o corte e clique em publicar. Com o Instagram marcado, marque "Reel de teste" no bloco do Instagram.',
      'Escolha como liberar para os seguidores: "Libera sozinho se for bem" (o Instagram decide nas primeiras 72 horas) ou "Eu libero no app".',
      'Reel de teste não aceita collab: com a opção marcada, o collab sai do formulário.',
      'Depois de publicado, a marca "Reel de teste" aparece na publicação, na lista de publicações, no corte e no quadro do Conteúdo. Para mostrar aos seguidores, abra o Reel no app do Instagram e escolha compartilhar com os seguidores.',
    ],
  },
  {
    key: 'convite_formato', title: 'Convite: com plateia ou de mesa e "Por que você"', words: ['convite', 'plateia', 'de mesa', 'por que você', 'porque você', 'motivo do convite', 'formato do convite', 'cortes no convite'],
    where: '/convidados', perm: 'guests.write',
    steps: [
      'Abra o convidado e vá na aba Convite. O cartão "Como o convite chega" mostra o formato e o texto "Por que você".',
      'Clique em Editar: escolha De mesa (só o convidado e os hosts) ou Com plateia (mostra a plateia, as fotos e o vídeo "Veja como é").',
      'Escreva o "Por que você" (duas ou três frases falando com a pessoa) ou use "Sugerir com IA", que escreve a partir da bio, dos temas e do motivo interno. Vazio, o convite usa a frase padrão.',
      'Use "Ver convite" para conferir. O número de episódios e os cortes de quem já veio se atualizam sozinhos.',
    ],
  },
  {
    key: 'link_estudio', title: 'Link do estúdio (material da gravação)', words: ['link do estúdio', 'link do estudio', 'estúdio', 'estudio', 'danilo', 'wetransfer', 'we transfer', 'material bruto', 'subir material', 'enviar material', 'câmeras', 'reenvio do material'],
    where: '/episodios', perm: 'production.upload',
    steps: [
      'Quando o convidado é marcado como gravado, o episódio ganha um link para o estúdio subir o material da gravação. Ele aparece no próximo passo do convidado ("Copiar link do estúdio") e na aba Material do episódio.',
      'Copie o link e mande ao estúdio pelo WhatsApp (ou use "Mandar no WhatsApp", se o número do estúdio estiver em Gestão > WhatsApp dos convites). O estúdio abre sem login, arrasta as pastas ou os arquivos e espera subir; se a internet cair, continua de onde parou.',
      'No fim, o estúdio clica "Terminei o envio": o link fecha e a equipe recebe o aviso. O material aparece na aba Material, com a marca "estúdio".',
      'Precisa de mais material? "Pedir reenvio" na aba Material gera um link novo (o antigo deixa de funcionar); o que já chegou continua. O link também fecha sozinho depois de 7 dias sem uso.',
      'Para organizar, use o lápis de cada arquivo: muda o tipo (vídeo bruto, áudio, bastidores, foto, outro) e o rótulo (ex.: Câmera 2).',
    ],
  },
  {
    key: 'duplicatas', title: 'Cadastros duplicados (convidados e patrocinadores)', words: ['duplicata', 'duplicado', 'duplicados', 'duplicada', 'repetido', 'cadastro repetido', 'cadastrado duas vezes', 'em dobro', 'juntar', 'mesclar', 'unir cadastros'],
    where: '/gestao/duplicatas', perm: null,
    steps: [
      'Ao cadastrar um convidado ou patrocinador que parece já existir, o formulário mostra o que já está cadastrado antes de criar outro. Se for outra pessoa ou empresa, use "Cadastrar mesmo assim".',
      'Duplicata certa: convidado com o mesmo @, e-mail ou telefone; patrocinador com a mesma empresa ou o mesmo site. Possível: nome parecido, ou o mesmo e-mail ou telefone de contato no patrocinador (grupos de empresas costumam dividir e-mail).',
      'O cadastro que tem duplicata mostra uma faixa no topo. "Comparar e juntar" abre os dois lado a lado: escolha qual fica e, onde os dois são diferentes, qual valor fica. O histórico, as abordagens, os comentários, as tarefas, os episódios, os lançamentos e as reuniões do outro passam para ele, e o outro vai para a lixeira (o valor que não ficou vai para as observações).',
      '"Não é duplicata" tira o aviso daquele par. A gestão vê todos os pares em Gestão > Sistema > Duplicatas e pode voltar a avisar.',
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
