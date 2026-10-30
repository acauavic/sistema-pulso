// Histórico de versões do Pulso Gestão, da mais nova para a mais antiga. A primeira entrada é a versão no ar:
// ela tem que ser igual ao "version" do package.json (o teste confere). Ao lançar: acrescente a entrada no topo,
// suba o package.json e avise no memory.md. Cada pessoa vê um aviso uma vez por versão nova e a página /novidades.
// kind: novo | ajuste | correcao
module.exports = [
  {
    version: '1.43.0', date: '2026-10-30', title: 'Portal do convidado: players, galeria e validade',
    items: [
      { kind: 'novo', text: 'O episódio toca dentro do portal: o vídeo do YouTube e o player do Spotify aparecem incorporados (com o link do Instagram ao lado).' },
      { kind: 'novo', text: 'Fotos em galeria que passa sozinha (pausa ao passar o mouse), com setas, miniaturas, "Baixar esta foto" e "Baixar todas".' },
      { kind: 'novo', text: 'O material do portal fica disponível por 60 dias a partir do primeiro envio do link, e o portal avisa a data. Depois disso o link mostra que expirou; na aba Portal, a equipe estende por mais 60 dias.' },
      { kind: 'ajuste', text: 'Nos posts, as redes viraram ícones, abaixo de "Clique e veja:".' },
      { kind: 'correcao', text: 'As capas dos posts não apareciam no portal (a regra de segurança da página bloqueava as imagens do armazenamento).' },
    ],
  },
  {
    version: '1.42.0', date: '2026-10-30', title: 'Post feito por fora do sistema',
    items: [
      { kind: 'novo', text: 'Corte postado por fora (pelo app da rede, numa emergência ou quando o sistema falhou): na página do corte, "Postado por fora? Registrar o link". Cole o link do post em cada rede (o sistema reconhece a rede pelo link), o collab do Instagram e quando saiu. O corte passa a contar como publicado, inclusive no portal do convidado.' },
      { kind: 'novo', text: 'Na publicação, cada rede que falhou ganhou "postei por fora": registre o link e a rede passa a contar como no ar, sem novas tentativas automáticas.' },
    ],
  },
  {
    version: '1.41.0', date: '2026-10-30', title: 'Portal do convidado',
    items: [
      { kind: 'novo', text: 'Cada convidado com episódio ganhou a aba "Portal": uma página só dele, que se atualiza sozinha durante a semana do episódio, com o cronograma (cortes na segunda, episódio na sexta), as duas formas de collab e o botão para falar com a produção.' },
      { kind: 'novo', text: 'O portal reconhece sozinho os posts em collab com o convidado (pelo @ do Instagram no collab) e lista com a capa e o link de cada rede, junto da recomendação de compartilhar e citar a collab. Os outros posts do episódio, os links do YouTube, do Spotify e do Instagram e as fotos escolhidas pela equipe também aparecem.' },
      { kind: 'novo', text: 'Cortes exclusivos: todo corte do episódio que não foi publicado vai para o portal, para o convidado assistir, copiar a legenda e baixar. Dá para tirar um corte pela aba Portal ou pela página do corte.' },
      { kind: 'novo', text: 'Avisos: "Enviar link" manda o portal por e-mail ou abre o WhatsApp com a mensagem pronta. Cada post novo em collab avisa o convidado por e-mail, ou deixa um lembrete para a equipe mandar pelo WhatsApp.' },
      { kind: 'novo', text: 'Pelo portal, o convidado pode pedir que o episódio saia em collab com o canal dele no YouTube. A equipe recebe o aviso e marca como feita.' },
    ],
  },
  {
    version: '1.40.2', date: '2026-10-30', title: 'Benefícios junto do vídeo da plateia',
    items: [
      { kind: 'ajuste', text: 'Na página da plateia, a lista do que se vive na gravação (networking, interação com o convidado, coffee break, bastidores) passou para a seção do vídeo, abaixo do texto. Sem vídeo, ela continua no topo.' },
    ],
  },
  {
    version: '1.40.1', date: '2026-10-30', title: 'Vídeo dos bastidores tocando',
    items: [
      { kind: 'correcao', text: 'O vídeo dos bastidores aparecia na página da plateia, mas não tocava: a regra de segurança da página bloqueava o endereço do vídeo. Agora toca.' },
    ],
  },
  {
    version: '1.40.0', date: '2026-10-30', title: 'Vídeo dos bastidores e novo topo da plateia',
    items: [
      { kind: 'novo', text: 'As páginas da plateia (a geral e a de cada convidado) ganharam a seção "Veja como é estar na plateia", com o vídeo vertical dos bastidores de uma gravação.' },
      { kind: 'ajuste', text: 'Novo topo: "Conheça de perto [convidado] e participe também da gravação do Pulso Podcast", com o que a pessoa vive lá: networking qualificado com outros participantes selecionados, interação com o convidado, coffee break e os bastidores de uma produção profissional. Na página geral: "Conheça de perto quem move a saúde."' },
    ],
  },
  {
    version: '1.39.0', date: '2026-10-30', title: 'Página da plateia de cada convidado e link de parceiro',
    items: [
      { kind: 'novo', text: 'Cada convidado aberto para plateia pode ter uma página só da gravação dele. No cadastro do convidado, a aba "Página da plateia" ativa a página e permite colocar fotos, um texto de como será, o horário de chegada da plateia e um bloco extra. O que ficar vazio não aparece. Quem pede pela página cai no mesmo painel da plateia.' },
      { kind: 'novo', text: 'Link de parceiro: na mesma aba, crie um link com o nome do parceiro e quantas vagas isentas ele tem. Quem entra por ele vê que a participação é isenta, cortesia do parceiro. O pedido chega marcado no painel, sem link de pagamento, e a seleção já vem como Isento. A seleção continua com vocês. Esgotadas as vagas, o link mostra o valor normal.' },
    ],
  },
  {
    version: '1.38.0', date: '2026-10-28', title: 'Corrigir e reenviar uma rede',
    items: [
      { kind: 'novo', text: 'Na publicação, "Corrigir e reenviar" abre uma janela com as redes que falharam já marcadas, o motivo de cada uma, o texto e o collab do Instagram para corrigir. O texto novo vale só para as redes reenviadas; o que já está no ar não muda e não pode ser marcado de novo, para nada sair duplicado. Cada rede com erro também tem o atalho "Corrigir e reenviar só" ela.' },
      { kind: 'novo', text: 'Publicação que já saiu ganhou "Publicar em outra rede": manda o mesmo corte ou imagem para uma rede que ainda não recebeu, com texto próprio se quiser.' },
      { kind: 'ajuste', text: 'Quando a falha é passageira, o botão principal continua sendo reenviar como está. Quando reenviar igual não resolveria (perfil do collab, formato, conta), o principal passa a ser corrigir.' },
    ],
  },
  {
    version: '1.37.1', date: '2026-10-28', title: 'Perfil do collab que o Instagram não acha',
    items: [
      { kind: 'correcao', text: 'Quando o Instagram recusa um perfil do collab ou da marcação (conta privada ou nome errado), a publicação dizia para reconectar a conta, que estava boa. Agora diz qual perfil o Instagram não encontrou e pede para tirar ou corrigir esse perfil antes de publicar de novo.' },
    ],
  },
  {
    version: '1.37.0', date: '2026-10-28', title: 'Lixeira e ações em massa no Conteúdo',
    items: [
      { kind: 'novo', text: 'Lixeira: o que se apaga no sistema (episódio, convidado, patrocinador, tarefa, corte, post, pedido, arquivo, lançamento) fica 15 dias guardado e volta do jeito que estava, com comentários, imagens e arquivos. Logo depois de apagar, o aviso no topo traz o botão "Desfazer". A Lixeira fica no rodapé do menu: cada pessoa vê o que apagou; a gestão vê tudo e pode apagar de vez antes do prazo.' },
      { kind: 'novo', text: 'Em Conteúdo, "Selecionar" agora serve para mais que baixar. Em Cortes: atribuir vários ao episódio, baixar ou mandar para a lixeira. Em Posts e carrosséis: aprovar, tirar aprovação, baixar ou excluir. Em Pedidos: mudar responsável, prazo e prioridade de uma vez, cancelar ou excluir.' },
      { kind: 'ajuste', text: 'Pedido de conteúdo agora pode ser excluído (vai para a lixeira). Os vídeos entregues continuam em Cortes.' },
    ],
  },
  {
    version: '1.36.0', date: '2026-10-28', title: 'Conteúdos do episódio viram pedidos',
    items: [
      { kind: 'novo', text: 'Ao criar o episódio, "Pedir ao editor junto com o episódio" mostra Cortes, Q&A, Bastidores e Conteúdo extra para marcar. Cada um marcado vira um pedido de conteúdo, com prazo e responsável, e a entrega sobe aqui no sistema, sem link do Drive. Q&A e Bastidores são prioridade, porque saem no começo da semana para anunciar o episódio. Episódio criado a partir do convidado gravado já nasce com os que vêm marcados.' },
      { kind: 'novo', text: 'Os cortes do episódio são um pedido contínuo. O editor sobe cada corte quando fica pronto, sem precisar clicar em "Começar", e cada corte já aparece no Social para publicar, sem esperar a leva inteira. No fim, "Concluir cortes" encerra o pedido e avisa a gestão; "Retomar" reabre se faltar algum. Cortes subidos direto no episódio também contam.' },
      { kind: 'ajuste', text: 'Em Gestão > Rotinas, as rotinas do episódio criado escolhem se viram tarefa ou pedido de conteúdo, se já vêm marcadas e se são prioridade. Quando o editor do episódio é definido, os pedidos "do editor" sem responsável vão para ele.' },
    ],
  },
  {
    version: '1.35.2', date: '2026-10-27', title: 'Texto do X e do Threads no tamanho certo',
    items: [
      { kind: 'correcao', text: 'O X recusou um corte porque a legenda tinha 283 caracteres (o limite é 280). Agora o X e o Threads (limite de 500) recebem a versão que cabe, com parágrafos ou frases inteiras, sem cortar palavra. A tela avisa na hora de publicar. No Threads, texto acima do limite fazia a Outstand recusar o post inteiro, em todas as redes.' },
      { kind: 'ajuste', text: 'Fila do YouTube na Outstand: a nova tentativa agora chega segundos depois de a vaga abrir. Antes chegava 1 a 2 minutos depois, quando a vaga já tinha ido para outro cliente.' },
      { kind: 'ajuste', text: 'O link do post no TikTok, que às vezes chega só depois de o post sair, é buscado de novo nas horas seguintes e aparece na publicação.' },
    ],
  },
  {
    version: '1.35.1', date: '2026-10-27', title: 'Publicar não duplica com clique repetido',
    items: [
      { kind: 'correcao', text: 'Como o vídeo sobe para o provedor antes de publicar, "Publicar", "Aprovar e publicar" e "Reenviar agora" levam alguns segundos. Agora o botão mostra "Enviando…" e trava enquanto isso. E se o mesmo pedido chegar de novo em até 2 minutos (clique duplo), o sistema usa a publicação que já existe e nada sai duas vezes.' },
    ],
  },
  {
    version: '1.35.0', date: '2026-10-27', title: 'Publicação com entrega garantida',
    items: [
      { kind: 'correcao', text: 'Um corte saiu pela metade no Instagram e falhou nas outras redes porque o armazenamento (Backblaze) parou de entregar uma parte do vídeo, e cada rede baixou só o começo. Agora o vídeo é conferido do começo ao fim antes de ir para qualquer rede: se o arquivo não vem inteiro, nada é enviado, e a publicação espera e tenta de novo sozinha.' },
      { kind: 'novo', text: 'A rede que falha por motivo passageiro tenta de novo sozinha na hora certa (em 2 min, 10 min, 30 min, 1 h, 3 h e 6 h). A fila compartilhada do YouTube na Outstand volta no horário que ela informa. Só a rede que falhou é reenviada: o que já está no ar fica como está.' },
      { kind: 'novo', text: 'Cada rede mostra o motivo em português, a hora da nova tentativa ou o que fazer (por exemplo, reconectar a conta). Quem pediu recebe um aviso quando a publicação vai tentar de novo e outro quando sai. Quando precisa de ação, quem pediu e a gestão também são avisados. "Parar novas tentativas" interrompe as tentativas automáticas.' },
      { kind: 'novo', text: 'A publicação ganhou o "Histórico de envio": cada tentativa, por que começou, o que foi feito com o vídeo e o que cada rede respondeu. Em Gestão > Sistema, "Publicações nas redes" mostra o que está no provedor, o que tem nova tentativa marcada e o que precisa de ação.' },
      { kind: 'ajuste', text: 'O vídeo dos cortes e as imagens vão pelo armazenamento da Outstand para todas as redes (antes, só para o TikTok). A cópia é reaproveitada nas novas tentativas, sem depender do Backblaze de novo. Para agendados das próximas 3 horas, o material é conferido antes: se estiver ruim, a equipe é avisada com antecedência.' },
      { kind: 'ajuste', text: 'A duração do corte é conferida por rede antes de agendar: Reels do Facebook vão até 1 min 30 s, Shorts até 3 min, Threads até 5 min, e o TikTok respeita o limite da conta. Antes, um corte longo demais para uma rede fazia a Outstand recusar o post inteiro.' },
      { kind: 'correcao', text: 'O TikTok não sai mais com o link do Backblaze quando a hospedagem falha: a publicação espera e tenta de novo. Uma rede sem conta reconhecida ou com o TikTok indisponível falha só ela, e as outras saem. Envio que o servidor interrompeu no meio volta sozinho, e envio que ficou sem resposta repete com a mesma chave, sem publicar duas vezes.' },
      { kind: 'novo', text: 'Vigia do sistema: se o processo que publica e roda a fila parar, ou uma publicação agendada atrasar, a gestão recebe um aviso. Se o banco parar de responder ao processo, ele se reinicia sozinho.' },
    ],
  },
  {
    version: '1.34.0', date: '2026-10-27', title: 'Baixar vários posts de uma vez',
    items: [
      { kind: 'novo', text: 'Em Conteúdo > Posts, cada episódio com 2 ou mais imagens ganhou "Selecionar" e "Baixar tudo". Em "Selecionar" dá para marcar os posts (também clicando na própria imagem) e baixar só os escolhidos; os arquivos saem com o nome do episódio, o tipo e o número, como ep012-post-quote-1.jpg. A barra de seleção fica fixa no topo enquanto você rola. O botão Baixar de cada post continua como antes.' },
    ],
  },
  {
    version: '1.33.0', date: '2026-10-27', title: 'Baixar vários arquivos de uma vez',
    items: [
      { kind: 'novo', text: 'No material do episódio, dentro de cada pasta (Bastidores, Vídeos, Fotografias…), "Selecionar" deixa marcar vários arquivos e baixar só os escolhidos, e "Baixar tudo" baixa a pasta inteira. O mesmo vale na galeria ("Selecionar" e "Baixar pasta"). O botão Baixar de cada arquivo continua como sempre.' },
      { kind: 'ajuste', text: 'Os downloads saem um depois do outro, direto do armazenamento, e o navegador pode pedir permissão para baixar vários arquivos: permita. Acima de 2 GB o sistema pergunta antes, para não baixar o que não era para baixar.' },
    ],
  },
  {
    version: '1.32.3', date: '2026-10-26', title: 'TikTok pela Outstand e reenvio só do que falhou',
    items: [
      { kind: 'correcao', text: 'O TikTok recusava o vídeo ("domínio não verificado") quando o corte saía pela Outstand, porque o TikTok só baixa vídeo de domínio verificado. Agora, nos posts com TikTok, o vídeo vai antes para o armazenamento da própria Outstand e o TikTok baixa de lá.' },
      { kind: 'novo', text: 'Numa publicação parcial (algumas redes saíram, outras não), o botão "Reenviar as que falharam" manda de novo só as redes com erro. As que já estão no ar não são refeitas nem duplicadas.' },
    ],
  },
  {
    version: '1.32.2', date: '2026-10-26', title: 'Fila de cortes e tarefas em segundo plano deixa de travar',
    items: [
      { kind: 'correcao', text: 'Corrigido o travamento do processador em segundo plano: a cada 30 minutos várias rotinas começavam juntas e esgotavam as conexões com o banco, e o processador parava de vez. Com isso, cortes enviados ficavam em "processando" para sempre (e também ficavam parados o tratamento de vídeo, a IA e os e-mails). Agora as rotinas esperam a vez e a fila continua andando.' },
    ],
  },
  {
    version: '1.32.1', date: '2026-10-26', title: 'Envio direto com partes maiores',
    items: [
      { kind: 'ajuste', text: 'No envio direto, arquivos grandes agora são enviados em partes de até 64 MB (antes 16 MB): cada conexão com o Backblaze rende cerca de duas vezes mais com partes maiores. A fila usa as 6 conexões que o navegador abre com o Backblaze. Vale para os envios novos; os que já estão em andamento continuam com as partes que começaram.' },
    ],
  },
  {
    version: '1.32.0', date: '2026-10-26', title: 'Envio de arquivos grandes bem mais rápido',
    items: [
      { kind: 'novo', text: 'Os arquivos grandes (material bruto, vídeo editado e cortes) agora podem ir direto do navegador para o Backblaze, sem passar pelo servidor, que fica na Europa. Em teste, o envio direto chegou a cerca de 27 MB/s contra uns 3 MB/s do caminho antigo. Em Integrações > Armazenamento (Backblaze), a gestão liga isso com um clique ("Ligar envio direto"); sem isso, tudo continua passando pelo servidor, sem perder nada.' },
      { kind: 'ajuste', text: 'A fila de envio manda 8 partes ao mesmo tempo (eram 4), o que já acelera também o caminho pelo servidor, porque a viagem até a Europa é longa. Se o envio direto falhar na primeira tentativa (por exemplo, a regra do bucket ainda não está ligada), a fila volta sozinha ao caminho pelo servidor e segue de onde parou.' },
    ],
  },
  {
    version: '1.31.0', date: '2026-10-25', title: 'Cada rede pelo seu provedor e aviso de conta desconectada',
    items: [
      { kind: 'novo', text: 'Em Integrações > Redes sociais, "Cada rede por um provedor": o padrão é o provedor em uso, e dá para mandar redes específicas por outro (por exemplo, o X pela Zernio e o resto pela Outstand). Uma publicação para várias redes é dividida sozinha entre os provedores, e a página dela mostra por onde cada rede saiu.' },
      { kind: 'novo', text: 'O painel agora vigia as contas das redes: de 15 em 15 minutos pergunta a cada provedor se as contas continuam conectadas. Conta que cai (acesso vencido ou desconectada) vira "Reconectar" e a gestão recebe um aviso, com lembrete depois de 1 dia (até 3 avisos). Quando a conta volta, chega um aviso de que foi reconectada.' },
      { kind: 'novo', text: 'A lista "Contas das redes" em Integrações mostra cada conta com o estado (Conectada, Reconectar, Desconectada ou Sem conta), desde quando e um atalho para o painel do provedor. "Verificar agora" confere na hora. O alerta também aparece nas telas do Social e no Início da gestão.' },
      { kind: 'ajuste', text: 'No Novo post e nas janelas de publicar, a rede com conta para reconectar fica desabilitada e avisa em qual provedor reconectar. A publicação recusa o envio dessa rede com a explicação, em vez de falhar sem aviso. A configuração dos avisos fica em Gestão > Notificações ("Contas das redes").' },
    ],
  },
  {
    version: '1.30.0', date: '2026-10-25', title: 'Outstand como terceira via para publicar nas redes',
    items: [
      { kind: 'novo', text: 'Vídeos do episódio, cortes, posts, carrosséis e stories também podem sair pela Outstand. A gestão escolhe em Integrações > Redes sociais (junto com Upload-Post e Zernio), testa a conexão (lista as contas e avisa se alguma precisa reconectar) e liga a publicação de verdade com confirmação.' },
      { kind: 'novo', text: 'Funciona com o que já existia: collab (até 3 perfis) e marcação de pessoas no Instagram, capa do Reels, Shorts e capa do vídeo no YouTube, Reel no Facebook. O envio não duplica: se a rede falhar no meio, o painel repete com a mesma chave.' },
      { kind: 'novo', text: 'TikTok pela Outstand: "publicar direto" (o painel confere as opções de privacidade da conta antes) ou "enviar como rascunho" para a caixa do TikTok, onde quem publica termina no app. O resultado mostra "Rascunho" e o que falta fazer.' },
      { kind: 'ajuste', text: 'Avisos da Outstand aparecem na página da publicação (por exemplo, vídeo que o Instagram pode recusar). Em Integrações há a opção de ajustar o vídeo para cada rede, desligada por padrão porque a Outstand cobra por minuto de vídeo refeito.' },
      { kind: 'ajuste', text: 'A Outstand só edita post que ainda não saiu; depois de publicado o texto se edita no app da rede, e a página da publicação explica isso em vez de mostrar um botão que não funcionaria. Agendados continuam editáveis aqui.' },
    ],
  },
  {
    version: '1.29.1', date: '2026-10-23', title: 'Plateia sem as gravações que já passaram',
    items: [
      { kind: 'ajuste', text: 'Na Plateia, as pessoas de gravações que já passaram ficam ocultas na lista e no quadro. Um aviso diz quantas são e de quais convidados, com "Mostrar" para ver todo mundo. Filtrar pelo episódio ou buscar um nome continua encontrando qualquer pessoa.' },
    ],
  },
  {
    version: '1.29.0', date: '2026-10-23', title: 'Conteúdo vira a linha de produção: pedidos ao editor e quadro até o post publicado',
    items: [
      { kind: 'novo', text: 'Conteúdo abre num quadro com cada peça (pedidos, cortes, posts, carrosséis e stories) na etapa em que está: Pedido, Em produção, Em revisão, Pronto para postar, Na fila e Publicado. Já publicado mostra em quais redes e quando; dá para filtrar por vídeos, imagens ou pedidos.' },
      { kind: 'novo', text: 'Pedir conteúdo ao editor: trailer do canal, vídeo avulso, corte específico, post, carrossel ou story, com ou sem episódio, briefing com anexos, formato, responsável e prazo. O editor é avisado, começa, envia a entrega (vídeo ou imagens) e manda para a revisão; a gestão aprova ou pede ajustes com um recado. Aprovado, vai direto para o Social.' },
      { kind: 'novo', text: 'O Início do editor mostra os pedidos dele (e os livres, que qualquer editor pode pegar). O episódio mostra quantas peças já foram publicadas.' },
      { kind: 'ajuste', text: 'Novo post (Social) mostra só o que ainda não saiu, com os sugeridos primeiro (do episódio que foi ao ar mais recentemente), e tem "Ver também os já publicados". Story mostra só o que foi feito para story: capas de corte e thumbnails não entram mais; um post 4:5 pode virar story, à parte.' },
      { kind: 'ajuste', text: 'Cartões de corte trocam o "pronto" por "pronto para postar", "agendado" ou "publicado" com as redes. Conteúdo avulso (como o trailer) publica sem episódio.' },
    ],
  },
  {
    version: '1.28.0', date: '2026-10-23', title: 'Fotografias como fundo, mais edição de capa e IA nos textos',
    items: [
      { kind: 'novo', text: 'No editor de capa, a aba Fundo tem três origens: quadros do vídeo, fotografias do episódio (as que subiram no material bruto, inclusive bastidores) e enviar uma imagem. A foto entra em pé, na resolução certa, e a IA confere os rostos.' },
      { kind: 'novo', text: 'Girar 90°, espelhar e inverter a foto do fundo, e ajustes de brilho, contraste, saturação e desfoque, com atalho para preto e branco. As zonas de rosto acompanham o giro.' },
      { kind: 'novo', text: 'Texto da capa com sombra para qualquer lado (ou brilho em volta), distância da sombra, contorno com cor e fundo escuro atrás do texto. As opções ficam em seções que abrem, para o painel não virar um formulário enorme.' },
      { kind: 'novo', text: '"Sugerir com IA" embaixo do texto da capa, do título e da legenda dos cortes, do Novo post e do título e da descrição do YouTube: atalhos (outras opções, mais curto, em pergunta, frase do convidado…) ou um pedido do seu jeito. Vêm 3 opções a partir da conversa; tocar troca o texto e dá para desfazer.' },
    ],
  },
  {
    version: '1.27.0', date: '2026-10-23', title: 'Publicação de verdade ligada pelo painel',
    items: [
      { kind: 'novo', text: 'Em Integrações > Redes sociais, a gestão liga e desliga a publicação de verdade de cada provedor (Upload-Post e Zernio), sem mexer no servidor. Ligar pede a confirmação e fica na auditoria; voltar ao modo de teste é um botão.' },
      { kind: 'ajuste', text: 'A escolha vale na hora, inclusive para os agendamentos e para as respostas das automações (Upload-Post). Enquanto ninguém mexer no painel, vale o que está configurado no servidor, e a tela mostra de onde vem.' },
    ],
  },
  {
    version: '1.26.0', date: '2026-10-23', title: 'Collab e marcação de pessoas no Instagram',
    items: [
      { kind: 'novo', text: 'Ao publicar no Instagram (Reels, post ou carrossel), dá para convidar até 3 perfis para collab e marcar pessoas. Cada campo tem busca com sugestões (o convidado do episódio, convidados com Instagram cadastrado e perfis já usados antes) e aceita vários perfis, inclusive um @ digitado ou colado.' },
      { kind: 'novo', text: 'O @ do convidado do episódio já vem no collab (dá para tirar). Em post e carrossel, toque na imagem para posicionar cada marcação; quem não for posicionado vai para a base da imagem. Em vídeo, a marcação vai só com o @.' },
      { kind: 'ajuste', text: 'Funciona pelo Upload-Post e pela Zernio. A página da publicação mostra quem foi convidado e quem foi marcado. Stories não têm collab (limite do Instagram).' },
    ],
  },
  {
    version: '1.25.0', date: '2026-10-23', title: 'Zernio como alternativa para publicar nas redes',
    items: [
      { kind: 'novo', text: 'As publicações (vídeo do episódio, cortes, posts, carrosséis e stories) podem sair pela Zernio em vez do Upload-Post. A gestão escolhe em Integrações > Redes sociais, vê qual está em uso e testa a conexão (lista as contas conectadas).' },
      { kind: 'ajuste', text: 'Cada publicação lembra por onde saiu: trocar de provedor não atrapalha o que já foi enviado. Agendamentos saem pelo provedor escolhido na hora do envio.' },
      { kind: 'ajuste', text: 'Insights, comentários, directs e automações continuam pelo Upload-Post. Editar um post depois de publicado continua só para o que saiu pelo Upload-Post.' },
    ],
  },
  {
    version: '1.24.0', date: '2026-10-23', title: 'Aviso à gestão quando um corte fica disponível',
    items: [
      { kind: 'novo', text: 'Quando o editor sobe um corte e ele termina de ser preparado (capas sugeridas, título e legenda), a gestão recebe o aviso "Corte disponível", com o episódio, quem subiu e o que falta (atribuir ao episódio, escolher a capa e publicar). Vai uma vez por corte: "Ler de novo" não repete.' },
      { kind: 'ajuste', text: 'O aviso entra no tipo "Etapas do episódio": dá para ligar o e-mail ou silenciar em Notificações, como os outros.' },
    ],
  },
  {
    version: '1.23.2', date: '2026-10-22', title: 'Baixar a capa depois de editar',
    items: [
      { kind: 'correcao', text: 'Baixar uma capa logo depois de editá-la podia abrir uma página de erro ("NoSuchKey"): o navegador reaproveitava o endereço da imagem antiga, que é apagada ao salvar a edição. Agora o Baixar sempre pega a versão atual.' },
    ],
  },
  {
    version: '1.23.1', date: '2026-10-22', title: 'Miniaturas da galeria mais leves',
    items: [
      { kind: 'ajuste', text: 'As miniaturas das fotos e vídeos agora são feitas pelo seu próprio navegador logo depois do envio, a partir do arquivo que você já tem: o servidor não baixa nada do armazenamento para isso. Fotos do iPhone (HEIC) ganham miniatura quando enviadas pelo Safari.' },
      { kind: 'ajuste', text: 'Cada miniatura é feita uma vez só e fica guardada no servidor (fora do Backblaze, sem ocupar o limite da conta), e o navegador guarda sem prazo. Arquivos antigos ganham a miniatura na primeira vez que alguém abre a galeria, uma única vez.' },
    ],
  },
  {
    version: '1.23.0', date: '2026-10-22', title: 'Envio sem repetir arquivo, retomada do que parou e galeria com prévia',
    items: [
      { kind: 'novo', text: 'Ao enviar material, o sistema confere o que já está no episódio pelo nome. O que tinha parado no meio continua de onde parou (sem recomeçar). Para os que já subiram inteiros, você escolhe: não enviar de novo (padrão), substituir (o antigo só sai quando o novo termina) ou manter os dois.' },
      { kind: 'novo', text: 'Envios que pararam aparecem marcados como "não terminou", com a contagem e o tamanho, e um aviso no card: basta escolher os mesmos arquivos de novo. Também dá para descartar de uma vez os que não terminaram, liberando o espaço.' },
      { kind: 'novo', text: 'Galeria do material: um botão no card abre uma janela com as pastas (Vídeos do episódio, Bastidores, Fotografias, Vídeo editado…), miniaturas de fotos e vídeos, e a visualização grande com anterior e próximo (setas do teclado ou deslizando no celular), player de vídeo e áudio, e Baixar.' },
      { kind: 'correcao', text: 'Quando o armazenamento (Backblaze) chega ao limite da conta, o envio para na hora com a explicação e o caminho para resolver (Backblaze > Caps & Alerts), em vez de insistir arquivo por arquivo. A gestão recebe um aviso. Depois de liberar espaço, "Tentar todos de novo" continua de onde parou.' },
    ],
  },
  {
    version: '1.22.0', date: '2026-10-21', title: 'Material do episódio em pastas',
    items: [
      { kind: 'novo', text: 'No card do episódio, o Material bruto agora é visto em pastas: Vídeos do episódio, Áudios, Bastidores, Fotografias e Outros, cada uma com a contagem e o tamanho. Toque numa pasta para abrir, e use a seta para voltar. Dentro de Vídeos e Áudios, os arquivos se separam pelo rótulo (Câmera 1, Lapela…).' },
      { kind: 'novo', text: 'O Vídeo editado também virou pastas, uma por versão (a mais nova é a atual). Cada pasta mostra o arquivo, quem enviou e quando, e quantos comentários de revisão a versão recebeu e quantos estão em aberto, com atalho para a aba de revisão.' },
      { kind: 'ajuste', text: 'A pasta aberta continua aberta quando a página recarrega (depois de enviar ou remover um arquivo). Remover agora é um ícone de lixeira.' },
    ],
  },
  {
    version: '1.21.0', date: '2026-10-21', title: 'Avisos de alteração e exclusão, e comentários que dá para editar',
    items: [
      { kind: 'novo', text: 'Quem é responsável por um convidado, patrocinador, episódio (editor), corte ou tarefa agora recebe um aviso quando outra pessoa altera o cadastro, dizendo o que mudou, ou o exclui. Quem fez a ação não recebe aviso.' },
      { kind: 'novo', text: 'Configurável: em Gestão > Notificações, "Cadastro alterado" e "Cadastro excluído" podem ser ligados ou desligados (painel e e-mail), e cada pessoa silencia o que não quer ver em Notificações.' },
      { kind: 'novo', text: 'Comentários podem ser editados por quem os escreveu, em todos os tipos (convidado, patrocinador, episódio, corte, tarefa) e também na revisão do vídeo. A janela de edição abre com o texto atual, aceita novos anexos e áudio, e deixa tirar anexos. Um lápis pequeno marca o comentário editado, e quem for mencionado só na edição recebe o aviso.' },
      { kind: 'ajuste', text: 'Ações dos comentários agora são ícones: enviar, editar (lápis), apagar (lixeira), resolver e reabrir na revisão do vídeo, e o comentário geral. Passe o mouse (ou segure no celular) para ver o nome.' },
    ],
  },
  {
    version: '1.20.0', date: '2026-10-20', title: 'Pulso como app no celular, com alertas',
    items: [
      { kind: 'novo', text: 'O painel vira app: instale pelo cartão "Use o Pulso como app" no Início do celular (Android pede para instalar; no iPhone, uma janela mostra os três toques no Safari) ou por "Instalar o app" no rodapé do menu. Ele abre em tela cheia, com ícone próprio e atalhos (segure o ícone): Nova tarefa, Tarefas, Agenda e Notificações.' },
      { kind: 'novo', text: 'Alertas no app: com o app instalado, o Início oferece "Ativar alertas" e, a partir daí, tarefas, prazos e respostas chegam como notificação com o app fechado. O número de avisos não lidos aparece no ícone do app.' },
      { kind: 'novo', text: 'No celular, uma barra embaixo com Painel, Tarefas, Agenda, Avisos e Menu (os atalhos seguem o seu perfil). O Menu abre a lista completa por cima da página. A barra de cima ficou só com o logo e a busca.' },
      { kind: 'novo', text: 'Sem internet, o app mostra a página "Sem conexão" e volta sozinho quando a conexão retorna. Fontes, estilos e ícones ficam guardados no aparelho, então o app abre mais rápido.' },
      { kind: 'ajuste', text: 'Revisão do celular: etapas do convidado, do episódio e do patrocinador numa linha que desliza (já mostrando a etapa atual), abas e filtros que deslizam em vez de quebrar linha, calendário sem vazar para o lado, botões do cabeçalho numa linha só, janelas que sobem de baixo e campos que não dão zoom no iPhone.' },
      { kind: 'ajuste', text: 'Quem usa o sistema não cai mais no login toda semana: a sessão se renova enquanto você usa (continua saindo sozinha depois de 7 dias sem uso).' },
    ],
  },
  {
    version: '1.19.0', date: '2026-10-20', title: 'Assistente de IA atualizado: entende o sistema e faz mais',
    items: [
      { kind: 'novo', text: 'O assistente agora conhece o sistema de hoje: tarefas com hora e voz, comentários com anexos e áudio, cadência de follow-up, plateia (pedidos, quadro, pagamento), financeiro e estoque, media kit, Google Agenda e o painel de gestão. Pergunte "como faço…" e ele responde com os passos e diz se o seu perfil faz.' },
      { kind: 'novo', text: 'Novas consultas: quem precisa de follow-up, pedidos da plateia e quem está selecionado, resumo do financeiro e contas em aberto, estoque para repor, suas notificações, o que mudou no sistema, quem é quem na equipe e os últimos comentários de um item (com áudios transcritos).' },
      { kind: 'novo', text: 'Novas ações, só quando você pede: criar tarefa para outra pessoa com prazo e hora, concluir ou mudar uma tarefa, comentar num item, registrar uma abordagem, trocar o responsável, mudar a etapa de um convidado, avançar um episódio e cuidar da plateia (adicionar, mudar a situação, selecionar).' },
      { kind: 'ajuste', text: 'Ações de efeito maior (mudar etapa, selecionar na plateia, cancelar cobrança) sempre mostram um resumo e esperam o seu "sim". Tudo segue as regras das telas e o seu perfil, e fica na auditoria como feito pelo assistente.' },
    ],
  },
  {
    version: '1.18.0', date: '2026-10-20', title: 'Todos os comentários com texto rico, anexos e áudio',
    items: [
      { kind: 'novo', text: 'Convidados, patrocinadores, episódios e cortes passam a ter a mesma caixa de comentário das tarefas: formatação, tabelas, imagens coladas (Ctrl+V), PDF, HTML e ZIP, miniatura de links, @menções e áudio com transcrição.' },
      { kind: 'novo', text: 'A revisão do vídeo também: o comentário na minutagem aceita texto formatado, imagem, documento e áudio gravado (com transcrição), e entra na lista na hora, sem recarregar a página.' },
      { kind: 'ajuste', text: 'A exibição dos comentários mostra tudo isso: texto formatado, imagens ampliáveis, player de áudio com a transcrição e os documentos para baixar. Comentários antigos continuam iguais.' },
    ],
  },
  {
    version: '1.17.0', date: '2026-10-20', title: 'Tarefas e comentários com texto rico, anexos e áudio',
    items: [
      { kind: 'novo', text: 'A descrição da tarefa agora tem formatação: negrito, itálico, sublinhado, tachado, título, listas, citação, código, links e tabelas (com linhas e colunas que você adiciona e remove). Atalhos como "- " e "1. " viram lista. Na página da tarefa, a descrição aparece lida e o botão Editar abre o editor.' },
      { kind: 'novo', text: 'Cole imagens com Ctrl+V (ou arraste) direto no texto, e anexe PDF, HTML e ZIP. As imagens aparecem no texto e ampliam ao clicar; os documentos ficam em Anexos, sempre para baixar.' },
      { kind: 'novo', text: 'Links: ao colar um endereço você escolhe mostrar só a URL ou uma miniatura (título, resumo e imagem da página), como no ClickUp. Clique no link no editor para trocar a qualquer momento.' },
      { kind: 'novo', text: 'Comentários das tarefas ganharam o mesmo editor, com @menções, e gravação de áudio com transcrição automática: o comentário mostra o player e o texto falado, e dá para inserir a transcrição no comentário. O aviso para a equipe traz o que foi dito.' },
    ],
  },
  {
    version: '1.16.0', date: '2026-10-20', title: 'Tarefas com hora',
    items: [
      { kind: 'novo', text: 'As tarefas agora podem ter hora, além da data (opcional): "entregar hoje às 14h". O campo Hora fica ao lado de "Vence em" ao criar e editar. Se você preencher só a hora, vale para hoje.' },
      { kind: 'novo', text: 'A hora aparece nas listas, no quadro, no calendário, na página da tarefa, nas telas de convidado e patrocinador e na notificação que a pessoa recebe (nova tarefa, tarefa atribuída, prazo alterado).' },
      { kind: 'novo', text: 'Avisos de prazo mais úteis: de manhã, "Tarefa vence hoje às 14h"; na última hora, "Falta pouco"; e quando a hora passa, a tarefa fica atrasada e a pessoa é avisada. Sem hora, a tarefa continua vencendo no fim do dia.' },
      { kind: 'ajuste', text: 'Tarefa por voz e assistente entendem a hora: "entregar hoje às 14 horas" já vem preenchido com a data de hoje e 14:00.' },
    ],
  },
  {
    version: '1.15.0', date: '2026-10-20', title: 'Tarefa por voz',
    items: [
      { kind: 'novo', text: 'Em Tarefas, o botão "Falar tarefa" (e o botão dentro de "Nova tarefa") grava sua voz: você divaga sobre o que precisa ser feito, para quem e até quando, e a IA organiza em uma tarefa: título curto no imperativo, detalhes só com o que ajuda, responsável, prazo, tipo e vínculo com episódio, convidado ou patrocinador citados.' },
      { kind: 'novo', text: 'Nada é criado sozinho: os campos da janela são preenchidos para você conferir (dá para ver o que a IA ouviu) e só então tocar em Criar tarefa. Se você disser um nome que não está na equipe, ela avisa e deixa o responsável para você escolher.' },
    ],
  },
  {
    version: '1.14.0', date: '2026-10-19', title: 'Plateia: lista e quadro redesenhados, com editar e excluir',
    items: [
      { kind: 'ajuste', text: 'Plateia > Pedidos refeita: a lista virou uma tabela alinhada (pessoa, WhatsApp, situação, data, ações) e os detalhes pequenos viraram ícones com dica (WhatsApp, copiar link de pagamento, selecionar, receber, editar). A situação é um chip que abre as opções.' },
      { kind: 'ajuste', text: 'O quadro agora ocupa a altura da tela, cada coluna rola sozinha na vertical e a barra horizontal fica no pé da tela. Os cards têm tamanho uniforme, com nome, WhatsApp, convidado, data e estado do pagamento.' },
      { kind: 'ajuste', text: 'Barra de filtros enxuta: busca com lupa, episódio, origem e situação (a situação só na lista), e botões de ícone para quadro/lista, adicionar pessoa e exportar.' },
      { kind: 'novo', text: 'Editar pedido: nome, WhatsApp, gravação e observações. A conta a receber de quem já foi selecionado acompanha o nome e a gravação.' },
      { kind: 'novo', text: 'Excluir pedido, com confirmação. Se havia conta a receber ainda não paga, ela é cancelada; pedido com pagamento já recebido não é excluído (desfaça o recebimento antes).' },
    ],
  },
  {
    version: '1.13.0', date: '2026-10-19', title: 'Plateia em quadro',
    items: [
      { kind: 'novo', text: 'Plateia > Pedidos ganhou a visão em Quadro, ao lado da Lista: uma coluna por situação (Novo pedido, Em avaliação, Selecionado, Não selecionado, Desistiu). Arraste o pedido para mudar a situação; ao soltar em Selecionado, abre a janela do valor combinado.' },
      { kind: 'novo', text: 'Busca por nome, WhatsApp ou convidado e filtros por episódio e por origem (veio da página ou adicionada pela equipe), valendo na Lista e no Quadro.' },
      { kind: 'correcao', text: 'Janela "Confirmar participação" mostrava um pedaço de código no topo.' },
    ],
  },
  {
    version: '1.12.0', date: '2026-10-19', title: 'Plateia: adicionar pessoas e lembrete no dia',
    items: [
      { kind: 'novo', text: 'Plateia > Pedidos > Adicionar pessoa: a equipe inclui à mão quem já combinou por fora (nome, WhatsApp e a gravação). A pessoa pode entrar como novo pedido ou já Selecionada, com valor, já recebido ou isenta. Na lista aparece como "adicionada pela equipe" e não conta no funil da página pública.' },
      { kind: 'novo', text: 'No dia da gravação, se há pessoas Selecionadas na plateia, o sistema cria uma única tarefa para a produtora lembrar todo mundo, com a lista de nomes e WhatsApp e uma mensagem sugerida. Quem for selecionado depois, no mesmo dia, entra na lista da tarefa enquanto ela não for concluída.' },
    ],
  },
  {
    version: '1.11.0', date: '2026-10-19', title: 'Envio de material em segundo plano',
    items: [
      { kind: 'novo', text: 'Material bruto: escolha ou arraste vários arquivos de uma vez, de grupos diferentes (vídeos do episódio, áudios, bastidores, fotografias). Uma janela pergunta o que é cada um; só vídeos e áudios do episódio têm rótulo (Câmera 1, Lapela…). Fotografias e bastidores entram em quantidade, sem rótulo.' },
      { kind: 'novo', text: 'Os envios seguem em segundo plano: uma bandeja no canto mostra o andamento, a velocidade e o tempo que falta, e você pode continuar usando o sistema (abrir outras telas, comentar, criar tarefas) sem parar o envio. Dá para cancelar, tentar de novo, e se a internet cair ele retoma sozinho.' },
      { kind: 'ajuste', text: 'Vídeo editado e cortes também enviam pela bandeja. Na página do episódio, o material aparece agrupado: vídeos e áudios com rótulo, fotografias e bastidores recolhidos com a contagem.' },
      { kind: 'ajuste', text: 'Histórico do episódio: fotografias e bastidores enviados juntos viram uma linha só (por exemplo, "Fotografias enviadas: 23").' },
    ],
  },
  {
    version: '1.10.0', date: '2026-10-19', title: 'Galeria de convidados do media kit',
    items: [
      { kind: 'novo', text: 'Gestão > Galeria do media kit: você escolhe, entre os episódios publicados, quais convidados aparecem no slide "Quem já sentou à mesa". Cada um tem alcance e frase de apresentação editáveis; sem frase, vale o cargo e a empresa do cadastro.' },
      { kind: 'ajuste', text: 'No media kit, a galeria agora tem 4 colunas e 2 linhas (8 convidados por vez) e vira carrossel horizontal quando há mais: setas, pontos por página, passa sozinha e desliza no celular.' },
      { kind: 'correcao', text: 'Media kit: a galeria só passava sozinha quando o slide da agenda estava aberto (agora é quando ela mesma está na tela) e um texto do rodapé do slide saía com letras trocadas.' },
    ],
  },
  {
    version: '1.9.0', date: '2026-10-15', title: 'Revisão do vídeo mais fluida',
    items: [
      { kind: 'novo', text: 'Revisão: comentar, resolver e apagar comentários acontece na própria página, sem recarregar. O vídeo continua onde estava e o comentário novo já aparece na lista e na linha do tempo.' },
      { kind: 'novo', text: 'Player da revisão com botões de voltar e avançar (5 e 10 segundos), play e pausa, velocidade de 0,5× a 2× e tempo atual e total. Clicar na linha do tempo leva o vídeo até aquele ponto.' },
      { kind: 'novo', text: 'Atalhos no computador: espaço pausa, setas voltam e avançam 5 s, J e L 10 s, vírgula e ponto andam um quadro, C comenta neste ponto, Ctrl+Enter envia o comentário.' },
    ],
  },
  {
    version: '1.8.1', date: '2026-10-15', title: 'Página do episódio mais clara para o editor',
    items: [
      { kind: 'ajuste', text: 'O editor de vídeo volta a ver convidados e patrocinadores (só leitura), para consultar briefing, datas e restrições.' },
      { kind: 'ajuste', text: 'Na página do episódio, cada pessoa vê só os passos que faz: o editor não vê mais o envio de material bruto (é da produção) nem os botões da produção, e só envia o vídeo editado depois de assumir a edição.' },
    ],
  },
  {
    version: '1.8.0', date: '2026-10-15', title: 'Início e avisos do editor de vídeo',
    items: [
      { kind: 'novo', text: 'Avisos das etapas do episódio: o editor é avisado quando um episódio é liberado para edição, quando pedem ajustes e quando o vídeo é aprovado ou publicado. Quem revisa é avisado de que há vídeo para revisar, e a produção, de quem assumiu a edição.' },
      { kind: 'novo', text: 'O Início do editor de vídeo mostra a fila de edição, os episódios dele (com "ajustes pedidos") e as tarefas dele.' },
      { kind: 'ajuste', text: 'O editor de vídeo não vê mais convidados, patrocinadores e dados do CRM. Continua baixando logo, moldura e QR Code do patrocinador pela página do episódio.' },
    ],
  },
  {
    version: '1.7.0', date: '2026-10-14', title: 'Gestão em grupos e WhatsApp dos convites configurável',
    items: [
      { kind: 'novo', text: 'Gestão > WhatsApp dos convites: o número e as mensagens prontas de quem aceita o convite, fala com a produção, quer ser patrocinador ou fala com a equipe agora são configurados ali, sem mexer no servidor.' },
      { kind: 'ajuste', text: 'O menu da gestão foi organizado em grupos (Visão geral, Equipe, Operação, Convites e parcerias, Sistema), cada um com as suas abas.' },
    ],
  },
  {
    version: '1.6.1', date: '2026-10-14', title: 'Agenda do media kit em galeria',
    items: [
      { kind: 'correcao', text: 'Media kit: as fotos dos convidados confirmados não apareciam. O navegador bloqueava a imagem porque o kit abre isolado; corrigido.' },
      { kind: 'ajuste', text: 'Media kit: "Quem já está na agenda" virou uma galeria que passa sozinha, com setas, e cabe inteira no slide, sem rolagem vertical. Ao clicar num convidado, abre a foto grande com a data e o Instagram.' },
    ],
  },
  {
    version: '1.6.0', date: '2026-10-14', title: 'Cadência de follow-up e metas de abordagem',
    items: [
      { kind: 'novo', text: 'Convidados em Convite enviado e patrocinadores em Prospecção ganham a cadência: registre cada abordagem por canal (Instagram, e-mail, WhatsApp, telefone) e pelo endereço usado, e o sistema diz quando é o próximo follow-up.' },
      { kind: 'novo', text: 'Depois da última tentativa sem resposta, o card é indicado como possível perdido (nunca respondeu); quem decide é a pessoa. Se a pessoa respondeu, a cadência para.' },
      { kind: 'novo', text: 'No Início aparece "Hoje": seus follow-ups e a meta diária de abordagens de patrocinadores. No quadro de convidados há o estado de cada card e o filtro "só follow-ups pendentes".' },
      { kind: 'novo', text: 'Gestão > Cadência: abordagens por canal e por pessoa, taxa de resposta, follow-ups atrasados, cumprimento da meta e se os dados estão sendo preenchidos. Lá também ficam os intervalos e as metas.' },
      { kind: 'novo', text: 'Aviso diário (dias úteis, depois das 8h) com os follow-ups de cada responsável.' },
    ],
  },
  {
    version: '1.5.0', date: '2026-10-13', title: 'Link de pagamento da plateia (InfinitePay)',
    items: [
      { kind: 'novo', text: 'Plateia: ao colocar um pedido em Em avaliação, o sistema gera o link de pagamento da InfinitePay com o valor da página. Dá para copiar, enviar pelo WhatsApp e alterar o valor (cria um link novo).' },
      { kind: 'novo', text: 'Quando a InfinitePay confirma o pagamento, o pedido vira Selecionado sozinho, entra como recebido no Financeiro (Pix ou cartão) e a equipe é avisada.' },
    ],
  },
  {
    version: '1.4.0', date: '2026-10-13', title: 'Convite da gravação por e-mail ao convidado',
    items: [
      { kind: 'novo', text: 'Ao agendar a gravação, o convidado recebe um e-mail na marca com o convite do calendário (.ics), no endereço do CRM. Remarcou: vai a nova data. Cancelou: vai o aviso. Liga em Gestão > Integrações > O que vai para a agenda; quem já está agendado hoje não recebe.' },
    ],
  },
  {
    version: '1.3.0', date: '2026-10-13', title: 'Google Agenda completo: o que vai e quanto dura',
    items: [
      { kind: 'novo', text: 'Em Gestão > Integrações, "O que vai para a agenda": a gestão escolhe quais tipos vão para o Google Agenda (gravações, lembretes, tarefas, publicações, posts, contas e parcerias) e a duração de gravações, lembretes e posts.' },
      { kind: 'ajuste', text: 'Mudou a data de uma gravação (ou qualquer item) no painel? O Google Agenda acompanha em poucos segundos: cria, atualiza e remove sozinho.' },
    ],
  },
  {
    version: '1.2.0', date: '2026-10-13', title: 'Gravações no Google Agenda',
    items: [
      { kind: 'novo', text: 'Integração com o Google Agenda: cada convidado em Agendado, com data, vira um evento no calendário do Pulso Podcast, com tema, Instagram, responsável e link do painel.' },
      { kind: 'novo', text: 'O evento acompanha mudança de data, tema e responsável, e some se o convidado sai de Agendado. Em Gestão > Integrações há o status, o teste de conexão e o botão Sincronizar agora.' },
    ],
  },
  {
    version: '1.1.0', date: '2026-10-13', title: 'Condições da plateia, isenção e novidades do sistema',
    items: [
      { kind: 'novo', text: 'Página Novidades e aviso a cada atualização do sistema, com a versão no menu.' },
      { kind: 'novo', text: 'Plateia: a página pública mostra as condições (cancelamento, veto de plateia externa e devolução do valor) e o pedido só segue com o aceite.' },
      { kind: 'novo', text: 'Plateia: é possível isentar um inscrito. Ele participa sem cobrança e nenhuma conta a receber é criada.' },
      { kind: 'ajuste', text: 'Fotos dos convidados preenchem a moldura 4:3 no celular, com foco no rosto.' },
      { kind: 'correcao', text: 'Quadro de convidados: os cards ficam do mesmo tamanho, sem barra horizontal dentro da coluna.' },
    ],
  },
  {
    version: '1.0.0', date: '2026-10-12', title: 'Primeira versão numerada',
    items: [
      { kind: 'novo', text: 'Calendário com tudo que tem data, filtros e visualizações salvas.' },
      { kind: 'novo', text: 'Menu lateral recolhível e quadros que ocupam a altura da tela, com rolagem por coluna.' },
      { kind: 'novo', text: 'Lembretes das gravações (3 dias, 1 dia, manhã do dia e 3 horas antes) pelo WhatsApp, com reenvio.' },
      { kind: 'novo', text: 'Recorte da foto do convidado em moldura 4:3, usada na plateia, no media kit e no portal do patrocinador.' },
      { kind: 'novo', text: 'Edição em massa no CRM de convidados, importação por CSV e motivo de perda obrigatório.' },
      { kind: 'novo', text: 'Notificações no navegador (push) e assistente com os números do sistema.' },
    ],
  },
];
