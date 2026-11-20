// Histórico de versões do Health Scale Studio (antes, Pulso Gestão), da mais nova para a mais antiga. A primeira entrada é a versão no ar:
// ela tem que ser igual ao "version" do package.json (o teste confere). Ao lançar: acrescente a entrada no topo,
// suba o package.json e avise no memory.md. Cada pessoa vê um aviso uma vez por versão nova e a página /novidades.
// kind: novo | ajuste | correcao
module.exports = [
  {
    version: '1.95.0', date: '2026-11-20', title: 'O painel agora é Health Scale Studio',
    items: [
      { kind: 'novo', text: 'O painel da equipe ganhou nome e cara novos: Health Scale Studio. Mudam o nome, a marca no menu e no login, o ícone do app (o monograma "St"), as cores (o verde no lugar do lime) e a letra dos títulos e textos. Os botões, as telas e os caminhos continuam nos mesmos lugares.' },
      { kind: 'ajuste', text: 'Tudo o que é do Pulso continua com a marca do Pulso: convite, portal do convidado, página pós-gravação, media kit, portal do patrocinador, plateia, capas e os e-mails que o convidado e o patrocinador recebem.' },
      { kind: 'ajuste', text: 'Os e-mails da equipe (acesso, senha e avisos do painel) passam a chegar como Health Scale Studio.' },
      { kind: 'ajuste', text: 'Quem tem o app instalado no celular vê o ícone e o nome novos depois da próxima atualização do app. Não precisa instalar de novo.' },
    ],
  },
  {
    version: '1.94.0', date: '2026-11-20', title: 'Capas pelos modelos do guia, capa do Spotify e vídeos do convidado',
    items: [
      { kind: 'novo', text: 'Finalização, passo "Capas e vídeos": um botão gera as peças do episódio pelos modelos do Guia de Capas. São 3 thumbnails do YouTube, uma por ângulo (curiosidade, contraste e autoridade), cada uma num modelo diferente, e a capa do Spotify (3000 × 3000). Os textos saem de uma ficha do episódio (quem é o convidado, a frase literal, o número dito), que você confere e edita numa janela.' },
      { kind: 'novo', text: 'Cada peça mostra como fica pequena (o tamanho do celular) e avisa quando não lê, quando o texto passa do limite ou quando a foto foi ampliada demais. "Ajustar" abre uma janela com a prévia ao vivo e três abas: Texto, Modelo (8 de thumbnail, 3 de Spotify) e Foto (trocar a foto, tocar no rosto, aproximar, afastar e espelhar).' },
      { kind: 'novo', text: 'Dá para aprovar mais de uma thumbnail: a primeira é a principal (vai para o YouTube) e as outras ficam para o teste de miniatura. "Baixar para o teste" entrega um ZIP com os nomes do guia. O download sai em PNG quando cabe em 2 MB; senão, em JPG.' },
      { kind: 'novo', text: 'Aba Vídeos: o story de lançamento (11 s, sem som) e o teaser para quem ainda não conhece (15 s, com a frase na voz do convidado e a legenda entrando palavra por palavra). Ficam prontos em 1 a 2 minutos e saem sem trilha: ela entra na hora de postar.' },
      { kind: 'novo', text: 'Cortes: as 3 capas sugeridas agora são dos modelos de Reels do guia (gancho com uma palavra em lime, tarja central e a frase literal do trecho). Na página do corte, "Ajustar capa" abre a mesma janela de texto, modelo e foto.' },
      { kind: 'ajuste', text: 'Mudou a ficha do episódio depois de aprovar uma capa? Ela ganha o chip "desatualizada" com "Atualizar", em vez de ser trocada sozinha. As capas antigas e os posts continuam abrindo no editor de sempre.' },
    ],
  },
  {
    version: '1.93.2', date: '2026-11-19', title: 'Reconectar o Instagram volta a abrir',
    items: [
      { kind: 'correcao', text: 'Integrações > Comentários e directs: o botão "Reconectar o Instagram" não fazia nada (o navegador barrava a ida para o Instagram). Agora ele abre uma página curta que leva ao Instagram na hora, com um botão de reserva.' },
      { kind: 'ajuste', text: 'Comentários > Números: quando a leitura não consegue ler um post, "Saúde da automação" diz qual é (com o link) e o motivo, em vez de só "1 com erro".' },
    ],
  },
  {
    version: '1.93.1', date: '2026-11-19', title: 'Respostas por IA logo depois de uma atualização',
    items: [
      { kind: 'correcao', text: 'Um comentário que chegasse no primeiro minuto depois de uma atualização do sistema não era lido pela IA (ficava parado até a leitura seguinte, ou de vez num post antigo). Agora é lido na hora, como os outros.' },
    ],
  },
  {
    version: '1.93.0', date: '2026-11-19', title: 'Números dos comentários e das automações',
    items: [
      { kind: 'novo', text: 'Social > Comentários > Números: o dia inteiro das respostas por IA num painel só. O caminho do comentário à comunidade (recebidos, respondidos em texto e com reação, com convite para seguir, directs e cliques no link), quem voltou a comentar depois da resposta, o saldo de seguidores, os posts que mais conversaram (com o total da rede ao lado do que o sistema leu), a automação por palavra e as barras de 30 em 30 minutos. Dá para voltar aos dias anteriores, com a média dos 7 dias antes.' },
      { kind: 'novo', text: '"Saúde da automação" mostra a última leitura, o último aviso da Outstand, as leituras da IA que falharam, as respostas e os directs que não saíram com o motivo, o que espera a equipe e o que foi barrado. Quando algo para (direct pausado, aviso da Outstand mudo há horas), um aviso aparece no topo.' },
      { kind: 'novo', text: 'O Resumo do dia e o Seu dia ganharam a faixa "Comentários nas redes": comentários, respondidos, directs, quem voltou a comentar e erros, com o link para os números.' },
      { kind: 'ajuste', text: 'O direct leva um link curto só dele para a comunidade (leva ao mesmo grupo), para os cliques do direct não se misturarem com os da bio. Os comentários são lidos de 30 em 30 minutos (antes, de hora em hora) e guardam a hora real em que foram feitos.' },
    ],
  },
  {
    version: '1.92.1', date: '2026-11-19', title: 'Direct também para quem foi respondido à mão',
    items: [
      { kind: 'correcao', text: 'O direct com a comunidade só saía depois de uma resposta da IA. Agora sai também para quem o Pulso respondeu de outro jeito (à mão, no app ou pela fila de respostas), dentro dos 7 dias do Instagram e no mesmo ritmo do dia.' },
      { kind: 'correcao', text: 'Resposta ou direct escrito pela IA com código no texto (marcação de página, script) não sai mais sozinho: vai para "Precisam de você" para alguém escrever.' },
    ],
  },
  {
    version: '1.92.0', date: '2026-11-19', title: 'Direct com a comunidade e convite para seguir nas respostas',
    items: [
      { kind: 'novo', text: 'Respostas por IA no Instagram: quem comentou com conteúdo (opinião, relato, pergunta) recebe, depois da resposta pública, um direct curto que cita o que a pessoa disse e chama para a comunidade do Pulso no WhatsApp. Até 150 por dia (ajustável), no máximo um por pessoa a cada 30 dias e só até 7 dias depois do comentário.' },
      { kind: 'novo', text: 'Em parte das respostas (no máximo 1 a cada 4, nunca duas vezes para a mesma pessoa), a IA convida a acompanhar o Pulso, principalmente nos Reels de teste, que chegam a quem ainda não segue.' },
      { kind: 'novo', text: 'Na aba Comentários, o direct aparece junto da resposta, com o estado (para aprovar, na fila, enviado). Dá para editar na mesma janela ou tirar só o direct. A configuração ganhou o limite de directs por dia e as opções de convite e direct.' },
    ],
  },
  {
    version: '1.91.0', date: '2026-11-19', title: 'Respostas por IA nos comentários dos posts',
    items: [
      { kind: 'novo', text: 'Social > Comentários: a IA lê os comentários dos posts que saíram pela Outstand (Instagram, Facebook e Threads), escreve uma resposta curta no tom do Pulso ou reage com um emoji e, sempre que dá, termina com uma pergunta para a pessoa comentar de novo. Conversa com o convidado, marcações, robôs e comentários vazios ficam de fora.' },
      { kind: 'novo', text: 'Você aprova antes (ou deixa no automático): aprove todas de uma vez, edite uma resposta com o "Sugerir com IA" ou marque "não responder". O que é pesado (pedido de orientação de saúde, ameaça, reclamação séria) vai para "Precisam de você" e a gestão e a produtora recebem um aviso.' },
      { kind: 'novo', text: 'As respostas saem aos poucos, com intervalo variado, até 25 por hora e só das 8h às 23h, para a conta não parecer robô. A aba "Na fila" mostra quando cada uma sai, e uma resposta enviada pode ser apagada da rede.' },
      { kind: 'novo', text: 'Na página da publicação, o cartão "Respostas por IA" liga e desliga a IA só daquele post e mostra quanto já foi respondido.' },
      { kind: 'correcao', text: 'A resposta pública da automação por palavra ("quem comentar a palavra recebe o link no direct") não saía no comentário: a Outstand pedia o código do post na rede. Agora sai.' },
    ],
  },
  {
    version: '1.90.0', date: '2026-11-19', title: 'Avisos que se limpam, respostas não lidas e tarefa a partir da mensagem',
    items: [
      { kind: 'ajuste', text: 'Quando uma tarefa passa para Fazendo ou Feito, os avisos dela que ainda estavam em Notificações (vence hoje, falta pouco, atrasada e bloqueada) ficam como lidos, para todo mundo que recebeu. O "criou uma tarefa para você" também, quando é você quem começa. O contador cai na hora.' },
      { kind: 'novo', text: 'Mensagens: dentro de cada conversa, a faixa "Respostas não lidas" junta as respostas novas nas threads que você segue (as suas mensagens, as threads em que respondeu e as em que foi marcado). Toque numa linha para abrir a thread.' },
      { kind: 'novo', text: 'Criar tarefa a partir de uma mensagem: no ícone de tarefa, ao lado de reagir e responder, a IA lê a mensagem (ou a thread inteira, se você escolher) e abre a janela Nova tarefa já preenchida. Confira e crie. A mensagem mostra "Tarefa · …" e a tarefa leva de volta à conversa.' },
      { kind: 'ajuste', text: 'Quando a IA preenche campos sozinha (tarefa por voz, tarefa da mensagem e "Sugerir textos para todos" nas capas em lote), o que você escreveu antes ou enquanto ela trabalhava fica como está. A IA só completa o que está vazio e avisa: "Mantive o que você escreveu em …".' },
      { kind: 'correcao', text: 'Ao abrir uma conversa, algumas mensagens podiam aparecer duas vezes.' },
    ],
  },
  {
    version: '1.89.0', date: '2026-11-19', title: 'Filtros em todas as listas e campos do cartão',
    items: [
      { kind: 'novo', text: 'Botão Filtros também em Episódios, Patrocinadores e nas abas Quadro, Posts e Pedidos de Conteúdo: combine etapa, responsável, datas (inclusive criado e atualizado em), campos vazios ou preenchidos e conexões, com E ou OU, e salve como visualização.' },
      { kind: 'novo', text: 'Campos do cartão: em cada quadro, escolha o que aparece nos cartões (e-mail, datas, contrato…). Fica guardado no seu navegador e "Restaurar padrão" volta ao cartão de sempre.' },
      { kind: 'ajuste', text: 'No quadro de Convidados, quem está em Gravado mostra a estreia prevista no cartão, ou "estreia não preenchida" quando falta a data.' },
    ],
  },
  {
    version: '1.88.0', date: '2026-11-19', title: 'Categoria dos vídeos e filtros combináveis',
    items: [
      { kind: 'novo', text: 'Cada vídeo de Conteúdo > Cortes agora tem categoria (os tipos de vídeo de Gestão > Categorias): mude na página do vídeo ou em vários de uma vez pela seleção, por exemplo um bastidor que entrou como corte ou um vídeo longo horizontal.' },
      { kind: 'novo', text: 'Botão Filtros em Convidados e em Conteúdo > Cortes: combine campos, etapa, responsável, datas e conexões, com "está vazio" e "está preenchido", e escolha se a lista mostra o que passa em todos (E) ou em qualquer um (OU).' },
      { kind: 'novo', text: 'Visualizações salvas: guarde uma combinação de filtros com nome, só para você ou para a equipe.' },
    ],
  },
  {
    version: '1.87.0', date: '2026-11-19', title: '"Não sou robô" nas telas públicas',
    items: [
      { kind: 'novo', text: 'O login, o "Esqueci minha senha", o link do estúdio, o pedido de participação na plateia e os formulários do site passam a ter a confirmação "não sou robô" do Cloudflare. Quase sempre ela é invisível; a caixa só aparece quando a visita parece suspeita.' },
      { kind: 'ajuste', text: 'No link do estúdio, a confirmação é feita uma vez ao abrir a página e vale por 12 horas: envios longos não pedem de novo.' },
    ],
  },
  {
    version: '1.86.1', date: '2026-11-19', title: 'Mais correções de segurança',
    items: [
      { kind: 'correcao', text: 'O e-mail de quem já tem senha só pode ser trocado por um superadmin, e trocar o e-mail ou a senha invalida os links de acesso que já tinham saído.' },
      { kind: 'correcao', text: 'Errar a senha de alguém de um lugar não trava mais o login dessa pessoa em outro lugar.' },
      { kind: 'correcao', text: 'Anexos de conversa só podem ser apagados por quem enviou, e a sessão pede um novo login a cada 90 dias.' },
      { kind: 'correcao', text: 'Reforços nos links públicos (estúdio, parceiro da plateia), na prévia de links e nos nomes dos arquivos dentro do ZIP.' },
    ],
  },
  {
    version: '1.86.0', date: '2026-11-18', title: 'Banco de horas do estúdio',
    items: [
      { kind: 'novo', text: 'Banco de horas do estúdio no Financeiro: as horas compradas, as usadas pelas gravações (a duração real, ou 1 h enquanto não é registrada) e as reservadas pelas gravações marcadas, com o que sobra. "Registrar compra" lança a compra como despesa paga de estúdio.' },
      { kind: 'novo', text: 'Aviso para renovar: quando sobram 3 h ou menos (ajustável em Custos automáticos > Estúdio e caixa), a gestão recebe um aviso e uma faixa aparece no Início e no Financeiro.' },
      { kind: 'ajuste', text: 'Gravações no banco de horas não geram mais sinal, saldo nem hora extra por episódio. Ao ligar o banco, as contas de estúdio ainda não pagas desses episódios e das gravações marcadas saem da lista; o que já foi pago fica como está.' },
    ],
  },
  {
    version: '1.85.1', date: '2026-11-18', title: 'Correções de segurança',
    items: [
      { kind: 'correcao', text: 'O resumo das reuniões com patrocinador passa a ser guardado só como texto formatado limpo, e os arquivos do patrocinador que não são imagem, áudio, vídeo ou PDF agora sempre baixam, em vez de abrir no painel.' },
      { kind: 'correcao', text: 'Bibliotecas do servidor atualizadas (leitura de formulários e envio de e-mail), fechando falhas conhecidas.' },
      { kind: 'ajuste', text: 'O backup diário do banco passa a ter uma cópia fora do servidor, no Backblaze.' },
    ],
  },
  {
    version: '1.85.0', date: '2026-11-18', title: 'Estreia prevista em todo calendário de publicação',
    items: [
      { kind: 'novo', text: 'A estreia prevista do convidado (preenchida a partir de Agendado, antes de o episódio existir) agora aparece em todo calendário de publicação: no site, no media kit ("Quem vem por aí", como estreia), no portal do patrocinador, no Calendário do sistema (como publicação prevista) e no portal do convidado.' },
      { kind: 'ajuste', text: 'Quando o convidado vai para Gravado e o episódio nasce, a estreia prevista vira a data de publicação do episódio, e o calendário passa a mostrar o episódio no lugar do convidado.' },
    ],
  },
  {
    version: '1.84.0', date: '2026-11-18', title: 'Site do Pulso: dados públicos para o podcastpulso.com e pedidos pelo site',
    items: [
      { kind: 'novo', text: 'Os pedidos para ser convidado e para patrocinar feitos no site entram direto no CRM de convidados e em Patrocinadores, com a origem "site" (e a campanha, quando vem) e um aviso para a gestão.' },
      { kind: 'novo', text: 'Na página do patrocinador, "Patrocinador oficial no site" (só um por vez) e "Esconder do site": o site mostra o oficial em destaque e a logo das marcas que fecharam ou patrocinam.' },
      { kind: 'novo', text: '"Estreia prevista" no convidado agendado: o site mostra quando ele vai ao ar, e a data passa para o episódio quando ele é criado.' },
    ],
  },
  {
    version: '1.83.0', date: '2026-11-18', title: 'Categorias, tipos de vídeo e rotinas que se repetem',
    items: [
      { kind: 'novo', text: 'Gestão > Sistema > Categorias: os tipos de vídeo (os de sempre, como Corte, Bastidores, Q&A e Trailer, e os que você criar) e as categorias de tarefa. Dá para criar, renomear e desativar; o que já existe continua com o nome.' },
      { kind: 'novo', text: 'Os tipos de vídeo novos aparecem em Pedir conteúdo, e a meta nova "Vídeos entregues" conta, por tipo, os vídeos que a pessoa enviou para revisão (cada vídeo uma vez). Exemplo: Bastidores, 3 por semana, para o editor.' },
      { kind: 'novo', text: 'Rotinas que se repetem, em Gestão > Rotinas: todo dia útil, toda semana (nos dias escolhidos) ou todo mês (no dia escolhido), com hora e responsável. Elas criam uma tarefa ou um pedido de conteúdo do tipo de vídeo escolhido.' },
      { kind: 'novo', text: '"Repetir" na tarefa nova: todo dia útil, toda semana ou todo mês. A tarefa mostra que se repete, e quem criou pode parar a repetição.' },
      { kind: 'ajuste', text: 'Na tarefa, "Tipo" passou a se chamar "Categoria".' },
    ],
  },
  {
    version: '1.82.0', date: '2026-11-18', title: 'Material do patrocinador em pastas',
    items: [
      { kind: 'novo', text: 'Aba Material na página do patrocinador, a partir de Ganho (também em Ativo e Inativo). As pastas são Logos, Moldura, QR Code e Material da marca, como no material do episódio: abrir a pasta, ver a miniatura, baixar um arquivo ou Selecionar e Baixar tudo num ZIP.' },
      { kind: 'novo', text: 'Enviar material: escolha ou arraste vários arquivos e diga a pasta de cada um. Eles sobem pela mesma fila dos episódios, em segundo plano e retomando de onde pararam; vídeo de inserção grande não trava a tela.' },
      { kind: 'novo', text: 'Logos: cabem várias versões, e uma é a principal, a que aparece no media kit, no portal do patrocinador e no episódio patrocinado. A primeira logo vira a principal, e "usar como principal" troca.' },
      { kind: 'novo', text: 'No episódio patrocinado, o link "Todo o material" leva o editor às pastas do patrocinador. O editor vê e baixa; quem edita patrocinadores envia, troca a logo principal e manda para a lixeira.' },
      { kind: 'ajuste', text: 'Moldura e QR Code agora são enviados pela aba Material e continuam indo para o entregável e o portal. A logo que o patrocinador manda pelo formulário entra na pasta Logos e não apaga as versões da equipe.' },
    ],
  },
  {
    version: '1.81.0', date: '2026-11-18', title: 'Início da produtora: o Seu dia',
    items: [
      { kind: 'novo', text: 'A produtora abre o Início no "Seu dia", com os números dela. O plano do dia mostra o que estava previsto e o que ela já fez: abordagens novas de patrocinadores e convites contra a meta diária, follow-ups de patrocinadores e de convidados marcados para o dia (e os atrasados de antes) e as tarefas do dia. O botão "Equipe" mostra o resumo da equipe.' },
      { kind: 'novo', text: 'No Seu dia, "O que o dia rendeu" traz convites aceitos, convidados perdidos (com o motivo), patrocinadores interessados, reuniões marcadas (e a próxima) e patrocínios fechados. As outras metas dela ficam em "Minhas metas".' },
      { kind: 'novo', text: 'Quentes agora, no cartão Hoje da produtora: patrocinador que abriu o media kit ou pediu uma conversa e convidado que abriu o convite e não respondeu, nas últimas 48 horas e sem abordagem depois. Logo abaixo, os aceitos ainda sem data de gravação.' },
      { kind: 'novo', text: 'Por que os convidados foram perdidos: os motivos dos últimos 30 dias, com quantidade e porcentagem, no Resumo do dia (logo abaixo do caminho dos convidados) e, só com os convidados dela, no Seu dia.' },
      { kind: 'novo', text: 'No Início da produtora, "Próximas gravações e reuniões" e "Suas tarefas" ficam no lugar de "Próximas gravações" e "Atividade recente".' },
      { kind: 'ajuste', text: 'A meta de abordagens de patrocinadores passa a contar só abordagens novas, a primeira de cada patrocinador. Follow-up não conta. Vale nas Metas, na Cadência e no Início.' },
    ],
  },
  {
    version: '1.80.0', date: '2026-11-18', title: 'Patrocínio no Resumo do dia',
    items: [
      { kind: 'novo', text: 'Resumo do dia: o caminho "Da prospecção ao patrocínio", logo abaixo do caminho dos convidados. Mostra os patrocinadores que entraram em prospecção (embaixo, quantos estão em prospecção), os abordados pela primeira vez (quantos ainda estão a abordar), os follow-ups do dia (quantos estão para hoje e os atrasados; num dia que passou, quantos ficaram atrasados), os interessados (foram para Em negociação) e os fechados (entraram em Ganho; embaixo, os patrocínios ativos). Os perdidos no dia ficam ao lado do título.' },
      { kind: 'novo', text: 'Abordagens e follow-ups vêm da cadência (Registrar abordagem). A primeira abordagem do ciclo conta como "abordado" no dia; falar de novo num dia seguinte é follow-up, e cada patrocinador conta uma vez por dia, mesmo quando o contato vai por mais de um canal.' },
      { kind: 'ajuste', text: 'Toda mudança de etapa do patrocinador passa a ser registrada, venha do quadro, do cadastro, do painel do patrocínio, do media kit ou de juntar duplicatas. O passado foi refeito pela linha do tempo de cada patrocinador, para qualquer dia aparecer certo.' },
    ],
  },
  {
    version: '1.79.0', date: '2026-11-18', title: 'Página pós-gravação para o convidado',
    items: [
      { kind: 'novo', text: 'Página pós-gravação (/pos-gravacao), a do QR Code do cartão de agradecimento: agradece, mostra o que acontece depois da gravação (triagem e edição; na sexta-feira antes do episódio, o portal do convidado com a data do episódio; bastidores; episódio e cortes), o que tem no portal (fotos, o episódio com os links do YouTube e do Spotify, posts em collab em tempo real, a agenda dos cortes e os cortes inéditos), os cortes em collab, as redes onde o Pulso posta e o WhatsApp da produção. É a mesma para todos os convidados, abre sem login e fica fora dos buscadores.' },
      { kind: 'novo', text: 'Em Gestão > WhatsApp dos convites, o link da página (Abrir e Copiar link) e a mensagem que abre no WhatsApp quando o convidado toca em "Falar com a produção" por ela.' },
      { kind: 'ajuste', text: 'Novo WhatsApp da produção: (11) 99978-8953, nos convites, no portal do convidado, na página pós-gravação e na página da plateia.' },
    ],
  },
  {
    version: '1.78.0', date: '2026-11-18', title: 'Metas por pessoa e o ritmo do editor',
    items: [
      { kind: 'novo', text: 'Metas: em Gestão > Equipe > Metas, a gestão define até 3 metas para cada pessoa: o que contar (convites enviados e aceitos, gravações marcadas, taxa de aceite, abordagens de convidados e de patrocinadores, reuniões agendadas, patrocínios fechados, cortes subidos, revisões de corte, posts publicados, episódios entregues e publicados, tarefas concluídas e no prazo, seguidores, inscritos, cortes postados e Reels de teste), o período (por dia útil, semana ou mês), o alvo e se aparece em número ou em porcentagem. O sistema conta sozinho.' },
      { kind: 'novo', text: 'Minhas metas: cada pessoa vê as dela no Início (no cartão Hoje), com quanto já fez, a barra de andamento e quanto falta até o fim do período. A barra fica lime quando a meta é batida.' },
      { kind: 'novo', text: 'Seu ritmo, no Início do editor: cortes subidos e revisões de corte de hoje e da semana, os episódios entregues na semana (e quantos voltaram com ajustes já feitos) e a próxima entrega, com as metas dele logo abaixo.' },
      { kind: 'ajuste', text: 'A meta diária de abordagens de patrocinadores saiu da Cadência e virou uma das metas, com o mesmo número para quem já tinha. A Cadência fica só com os intervalos de follow-up.' },
    ],
  },
  {
    version: '1.77.0', date: '2026-11-18', title: 'Ordem de edição e Resumo do dia redesenhado',
    items: [
      { kind: 'novo', text: 'Ordem de edição: o editor vê o que editar primeiro (1º, 2º, 3º…), pela data em que cada episódio vai ao ar, no Início dele, em Episódios (quadro e lista) e na página do episódio. A data fica vermelha se já passou e âmbar se é hoje ou nos próximos 2 dias; sem data, o episódio vai para o fim.' },
      { kind: 'novo', text: '"Liberar para edição" pergunta a data de veiculação quando o episódio ainda não tem, e o aviso ao editor já diz em que posição ele entra na ordem.' },
      { kind: 'novo', text: 'Resumo do dia: "Agendados para hoje" (cortes e posts marcados para o dia: quantos já saíram, quantos ainda vão sair e se algum deu erro) e o saldo de seguidores e inscritos da semana.' },
      { kind: 'ajuste', text: 'Resumo do dia redesenhado: um painel só, com o caminho do convite ao episódio e o do conteúdo desenhados como uma linha com pontos (o ponto aceso é onde algo aconteceu no dia). Número zerado fica apagado, e o ponto "ao vivo" marca o dia de hoje.' },
    ],
  },
  {
    version: '1.76.0', date: '2026-11-18', title: 'Resumo do dia no Início',
    items: [
      { kind: 'novo', text: 'Resumo do dia no Início: convites enviados, aceitos e perdidos; quantos estão em agendamento e agendados; episódios gravados a publicar e publicados; cortes subidos pelo editor, revisões (versão nova de um corte), cortes postados e Reels de teste; seguidores no Instagram, inscritos no YouTube e tarefas atrasadas. Abre em hoje; as setas e o calendário levam a qualquer dia desde 13/10, e cada número leva à lista dele.' },
      { kind: 'novo', text: 'Toda mudança de etapa do convidado fica registrada, venha de onde vier (quadro, cadastro, edição em massa, aceite ou recusa pelo link, convite por e-mail). O passado foi refeito pela linha do tempo de cada convidado.' },
      { kind: 'ajuste', text: 'O funil de etapas saiu do Início: os números dele estão no resumo (Prospecção e Cancelado continuam em Convidados). Os seguidores ganham uma leitura perto da meia-noite, para o saldo do dia fechar certo.' },
    ],
  },
  {
    version: '1.75.1', date: '2026-11-18', title: 'Segunda revisão da interface: celular, buscas e detalhes',
    items: [
      { kind: 'correcao', text: 'No celular, um tema longo em "Próximas gravações" alargava o Painel e empurrava a barra de baixo para fora da tela.' },
      { kind: 'correcao', text: 'Busca (Ctrl+K): enquanto a busca nova carrega, o resultado anterior fica apagado e o Enter espera a resposta certa, em vez de abrir o item da busca de antes. Na lista com busca, digitar um número não acha mais o episódio errado.' },
      { kind: 'novo', text: 'Listas longas dentro de janelas ganharam busca: "Escolher cortes" do media kit, "Gravações e episódios" do patrocinador e "Pedir ideias". O que já está marcado continua à vista durante a busca.' },
      { kind: 'ajuste', text: 'Convidados em lista: 100 por página. O corte diz no topo se já saiu (publicado, na fila, em revisão ou pronto para postar). Cortes mostra o total de atribuídos, e não só os da página.' },
      { kind: 'ajuste', text: '"Agendar N publicações" e "Salvar configuração" (avisos) ficam presos no pé da tela em páginas longas. "Gerar de novo" nos posts pede confirmação.' },
      { kind: 'ajuste', text: 'Detalhes: o episódio exclusivo virou um interruptor; Desempenho e Insights com abas em controle segmentado; Saúde do sistema e Duplicatas sem números internos; galeria do media kit alinhada; o aviso de fila parada sai no máximo uma vez por dia e sem jargão; etapa atual visível no tema claro; cartões sem sombra no tema claro; "apagar de vez" em vermelho; barra do editor de texto sempre inteira.' },
    ],
  },
  {
    version: '1.75.0', date: '2026-11-18', title: 'Revisão da interface inteira, números dos posts e agenda da semana',
    items: [
      { kind: 'novo', text: 'Listas longas com busca: todo seletor com muitas opções (episódio, convidado, patrocinador, pessoa) ganhou uma caixa de busca dentro dele. Digite parte do nome, sem se preocupar com acento.' },
      { kind: 'novo', text: 'Números de cada post: a publicação mostra views, curtidas, comentários e compartilhamentos por rede; o corte mostra o total; e Social > Insights ganhou "Cortes que mais funcionaram". O sistema lê os números a cada 6 horas, e a IA usa os cortes mais vistos como referência ao sugerir capa, título e legenda.' },
      { kind: 'novo', text: 'Agenda da semana: em Conteúdo > Cortes, "Agenda da semana" monta a semana com os cortes prontos, um episódio de cada vez, para conferir e agendar. "Ajustar" guarda as redes, quantos por dia, horários, Reels de teste e automação; toda segunda de manhã chega o aviso com a agenda pronta.' },
      { kind: 'novo', text: 'Palavra no direct: uma automação de Direct (Social > Automações) responde na própria conversa quando alguém manda a palavra. Precisa do aviso de mensagens da Outstand ligado em Integrações.' },
      { kind: 'novo', text: 'Novo post: a escolha do corte tem busca e filtro por episódio e mostra 24 por vez; escolhido, vira um resumo com "Trocar" e o formulário aparece logo abaixo.' },
      { kind: 'ajuste', text: 'Conteúdo mais leve: cada aba (Quadro, Cortes, Posts, Pedidos) abre só o que é dela, os cortes vêm em páginas de 60 e o vídeo do corte só carrega quando você toca no play.' },
      { kind: 'ajuste', text: 'Publicar ficou mais seguro: rede onde o corte já está no ar aparece como "no ar" e não pode ser marcada de novo, o título começa vazio (nada de "Corte 10" nas redes), o botão diz o destino ("Publicar em 2 redes") e só libera depois do "Entendi".' },
      { kind: 'ajuste', text: 'Alinhamento e leitura: botões e campos com a mesma altura, textos de apoio mais claros e maiores, rótulos que não quebram, barra de seleção que flutua no pé sem empurrar a lista, menu lateral mais compacto e link "Pular para o conteúdo" para quem usa teclado.' },
      { kind: 'ajuste', text: 'Lime só para ação e para o que foi publicado: "pronto para postar", "ativo" e "aprovado" viraram chips neutros, e os posts não têm mais um "Aprovar" lime em cada cartão.' },
      { kind: 'ajuste', text: 'Telas revistas uma a uma: tarefas com o status como chip e a data visível no celular; calendário que abre em hoje no celular; filtros de Convidados, Patrocinadores e Usuários que se aplicam sozinhos; editar convidado com seções que abrem; WhatsApp e site como links; cortes chamados pelo gancho, e não por "Corte 322"; Posts numa grade só; pedidos com filtro por situação; Ideias e Perfil em janelas; publicações com busca; Auditoria em português e com filtros; Lixeira juntando o que foi apagado de uma vez.' },
      { kind: 'correcao', text: 'O painel somava os atrasados em "a pagar nos próximos 7 dias" e mostrava um valor diferente do Financeiro; agora a conta é a mesma. "Excluir" que vai para a lixeira não diz mais que "não pode ser desfeito", e os plurais deixaram de aparecer como "(s)".' },
    ],
  },
  {
    version: '1.74.1', date: '2026-11-17', title: 'Automações do Instagram criadas à mão também pela Outstand',
    items: [
      { kind: 'correcao', text: 'A automação de comentário criada em Social > Automações (para qualquer post da conta ou um post específico) agora responde pela Outstand, como a da publicação. A leitura antiga dependia da Upload-Post, que não está mais conectada.' },
    ],
  },
  {
    version: '1.74.0', date: '2026-11-17', title: 'Automação "comentou, recebe no direct" na hora de publicar, e listas mais rápidas',
    items: [
      { kind: 'novo', text: 'Ao publicar um corte, um post ou vários de uma vez, ligue "Automação no Instagram": quem comentar a palavra (por padrão, o primeiro nome do convidado, como TAMIRIS) recebe no direct o link do episódio, do canal do YouTube ou da comunidade no WhatsApp. A chamada do Instagram passa a pedir a palavra sozinha, e a publicação e o corte mostram quantas respostas já saíram.' },
      { kind: 'novo', text: 'Social > Automações ganhou "Links que vão no direct" (canal do YouTube, comunidade no WhatsApp e Spotify). O link do episódio é o do próprio episódio no YouTube; antes da estreia, vai o do canal.' },
      { kind: 'novo', text: 'Integrações > Comentários e directs: reconectar o Instagram com acesso às mensagens (pela Outstand) e o endereço e o segredo do aviso de comentários, com a hora do último aviso recebido.' },
      { kind: 'ajuste', text: 'Quadro, cortes, posts e capas do episódio carregam miniaturas leves das capas em vez da imagem inteira, e a miniatura já fica pronta quando a capa nasce. Atribuir cortes a um episódio volta na hora: as capas são refeitas em segundo plano.' },
      { kind: 'ajuste', text: 'Publicar em massa lembra as últimas escolhas (redes, horários, por dia, Reel de teste e automação) neste navegador.' },
    ],
  },
  {
    version: '1.73.0', date: '2026-11-17', title: 'Conteúdo: filtro por episódio, ordem, publicar em massa e capas em lote',
    items: [
      { kind: 'novo', text: 'Publicar em massa: em Conteúdo > Cortes, marque os cortes e toque em "Publicar". Escolha as redes, a partir de quando, a janela do dia (ex.: das 08:00 às 22:00), quantos por dia e quantos vão ao Instagram como Reel de teste. O sistema distribui os horários na ordem da lista e mostra a agenda para conferir (dá para mudar um horário ou marcar e desmarcar o Reel de teste) antes de agendar. Cada corte sai com o próprio título, legenda, capa e chamada de cada rede.' },
      { kind: 'novo', text: 'Capas e textos em lote: com os cortes marcados, "Capas e textos" abre uma página com um corte por linha para escolher a capa e reescrever o texto. "Sugerir textos para todos" traz 3 opções da IA para cada um; ao salvar, o texto novo vira uma capa nova sobre o mesmo quadro do vídeo.' },
      { kind: 'novo', text: 'Filtros: a aba Cortes ganhou "Prontos para postar", filtro por episódio e ordem (mais recentes, mais antigos, por episódio, mais curtos primeiro). O quadro também filtra por episódio, e a coluna "Pronto para postar" leva direto à seleção para publicar.' },
    ],
  },
  {
    version: '1.72.1', date: '2026-11-17', title: 'Quadro de Conteúdo mostra o que já saiu há mais tempo',
    items: [
      { kind: 'correcao', text: 'No quadro de um episódio, a coluna Publicado mostra todos os cortes que já saíram, mesmo os de meses atrás. No quadro geral, o publicado há mais de 60 dias continua guardado, mas a própria coluna avisa quantos são e leva até eles.' },
    ],
  },
  {
    version: '1.72.0', date: '2026-11-17', title: 'Cortes lidos em paralelo',
    items: [
      { kind: 'ajuste', text: 'Quando vários cortes sobem de uma vez, o sistema lê até 5 ao mesmo tempo (quadros, título, legenda, chamadas e capas). Dez cortes ficam prontos em uns 3 minutos, e não mais em 12.' },
    ],
  },
  {
    version: '1.71.0', date: '2026-11-17', title: 'Copy das redes: capas, títulos e legendas que fazem parar de rolar, e a chamada certa em cada rede',
    items: [
      { kind: 'ajuste', text: 'A IA agora escreve título, texto da capa e legenda dos cortes com critério de copy: frase forte do convidado, tensão, promessa concreta, número ou pergunta. Rótulos genéricos e frases como "momento de reflexão" ou "assista ao trecho" estão proibidos, e a legenda que vier com elas é refeita.' },
      { kind: 'novo', text: 'Chamada no fim da legenda, por rede: no YouTube, "inscreva-se"; no Instagram, "siga o perfil"; no TikTok, "segue"; no LinkedIn, com um motivo profissional. A IA escreve uma para cada corte, ligada ao tema dele, e a janela de publicar mostra todas para ajustar antes de enviar.' },
      { kind: 'ajuste', text: 'A legenda fica sem a chamada: cada rede recebe a sua no envio, e a página da publicação mostra qual chamada foi para cada uma.' },
    ],
  },
  {
    version: '1.70.1', date: '2026-11-17', title: 'Convite com plateia mais limpo no topo',
    items: [
      { kind: 'ajuste', text: 'O topo do convite com plateia não tem mais a faixa "Podcast com plateia". O formato continua claro na frase "para o Pulso Podcast com plateia", no selo do canto e na abertura, e o "Veja como é" segue no bloco da plateia, em A experiência.' },
    ],
  },
  {
    version: '1.70.0', date: '2026-11-17', title: 'Media kit que leva para uma conversa',
    items: [
      { kind: 'ajuste', text: 'O media kit dos patrocinadores não mostra mais planos nem preços. No lugar, "O que a sua marca pode ter" lista tudo o que o Pulso entrega, e o botão principal virou "Agendar uma conversa" (abre o WhatsApp comercial e leva o patrocinador para Em negociação).' },
      { kind: 'novo', text: 'Vagas reais: o kit diz "no máximo 3 marcas ao mesmo tempo" e mostra quantas estão abertas, contando os patrocinadores Ativos. O máximo muda em Gestão > Planos.' },
      { kind: 'novo', text: 'Prova social: "Marcas que escolheram estar nessas conversas" mostra os patrocinadores marcados com "Mostrar no media kit" na página de cada um, com a logo quando houver.' },
      { kind: 'novo', text: 'Agenda "Quem vem por aí": data de estreia dos episódios já gravados (e de gravação de quem está agendado), foto, nome, @ e alcance. O convidado ganhou o campo Alcance no cadastro.' },
      { kind: 'ajuste', text: 'O QR Code agora aparece como "Leve a audiência direto para o seu site ou aplicativo" (aparece pelo menos 5 vezes no episódio), e as cadeiras na plateia (até 5 por gravação) entraram no que a marca pode ter.' },
    ],
  },
  {
    version: '1.69.0', date: '2026-11-17', title: 'Convite: a mesa do media kit, cortes escolhidos e "com plateia" em destaque',
    items: [
      { kind: 'novo', text: '"Quem já sentou à mesa" no convite agora é a mesma galeria do media kit dos patrocinadores: um convidado em destaque, trocando sozinho, e todos numa grade de fotos. Quem tem cortes ganha "Ver cortes" no destaque, que abre os vídeos numa janela.' },
      { kind: 'novo', text: 'Gestão > Galeria do media kit ganhou "Cortes de exemplo no convite": escolha até 4 cortes (só os que têm capa) para a seção "Os cortes". Sem escolha, o convite mostra o mais recente publicado de cada episódio, com capa.' },
      { kind: 'ajuste', text: 'No convite com plateia, isso fica claro logo de cara: a abertura diz "Podcast com plateia", a frase do topo termina em "com plateia" e uma faixa explica o formato com o atalho "Veja como é".' },
      { kind: 'ajuste', text: 'Na seção "Os cortes", título e texto ficam lado a lado, sem espaço perdido.' },
    ],
  },
  {
    version: '1.68.0', date: '2026-11-17', title: 'Convite do convidado: com plateia ou de mesa, "Por que você" e cortes de verdade',
    items: [
      { kind: 'novo', text: 'O convite tem dois formatos: de mesa (só o convidado e os hosts) e com plateia. O de plateia mostra como é a gravação com público, as fotos da recepção e da plateia e o botão "Veja como é", que abre o vídeo da gravação com plateia numa janela.' },
      { kind: 'novo', text: '"Por que você": na aba Convite do convidado, um texto curto dizendo por que o Pulso quer conversar com aquela pessoa, com "Sugerir com IA" a partir da bio, dos temas e do motivo interno. Ele aparece no topo do convite, no lugar da frase padrão.' },
      { kind: 'novo', text: 'As fotos de quem já sentou à mesa abrem uma janela com dois ou três cortes daquela pessoa, e uma seção nova, "Os cortes", mostra cortes recentes que o Pulso produziu.' },
      { kind: 'ajuste', text: 'O convite deixa de dizer "uma manhã" e "14 episódios até set/2026": o período sai da hora marcada (manhã, tarde ou noite) e o número de episódios é o real. Os eixos agora são saúde e inovação, mentalidade, estilo de vida e histórias inspiradoras.' },
    ],
  },
  {
    version: '1.67.0', date: '2026-11-16', title: 'Reel de teste no Instagram',
    items: [
      { kind: 'novo', text: 'Ao publicar um corte, o bloco do Instagram tem "Reel de teste": o Reel aparece primeiro só para quem não segue o Pulso. Dá para escolher se o Instagram libera sozinho para os seguidores quando for bem ou se a equipe libera no app.' },
      { kind: 'novo', text: 'Depois de publicado, a marca "Reel de teste" aparece na publicação (com o que fazer para liberar), na lista de publicações, na página do corte e no quadro do Conteúdo.' },
      { kind: 'ajuste', text: 'O Instagram não aceita collab em Reel de teste: com a opção marcada, o collab sai do formulário.' },
    ],
  },
  {
    version: '1.66.0', date: '2026-11-13', title: 'Link do estúdio para o material da gravação',
    items: [
      { kind: 'novo', text: 'Ao marcar como gravado, o episódio ganha um link para o estúdio subir o material direto para o sistema, sem WeTransfer e sem precisar baixar e subir de novo. O link fica na aba Material do episódio e no convidado, com "Copiar link".' },
      { kind: 'novo', text: 'A página do estúdio abre sem login, aceita pastas inteiras ou arquivos soltos (as quatro câmeras com o mesmo nome de arquivo não se confundem), sobe em partes direto para o armazenamento e continua de onde parou se a internet cair. No fim, "Terminei o envio" fecha o link e avisa a equipe.' },
      { kind: 'novo', text: '"Pedir reenvio" gera um link novo (o antigo para de funcionar na hora) e o material que já chegou continua no episódio. O link fecha sozinho depois de 7 dias sem uso.' },
      { kind: 'novo', text: 'Organizar: cada arquivo do material bruto tem um botão para mudar o tipo e o rótulo (por exemplo, "Câmera 2"). Gestão > WhatsApp dos convites ganhou o número do estúdio, para o botão "Mandar no WhatsApp" com a mensagem pronta.' },
    ],
  },
  {
    version: '1.65.0', date: '2026-11-12', title: 'Duplicatas de convidados e patrocinadores',
    items: [
      { kind: 'novo', text: 'Ao cadastrar um convidado ou patrocinador que parece já existir (mesmo @, e-mail, telefone, empresa ou site, ou nome parecido), o sistema mostra o que já está cadastrado antes de criar outro. Se for outra pessoa ou empresa, "Cadastrar mesmo assim".' },
      { kind: 'novo', text: 'O cadastro que tem uma duplicata mostra uma faixa no topo com "Comparar e juntar": você escolhe qual fica e o valor de cada campo diferente, e o histórico, as abordagens, os comentários, as tarefas, os episódios e as reuniões do outro passam para ele. O que sai vai para a lixeira.' },
      { kind: 'novo', text: 'Gestão > Sistema > Duplicatas lista todos os pares de convidados e de patrocinadores. "Não é duplicata" tira o aviso daquele par.' },
      { kind: 'correcao', text: 'O botão de criar convidado ou patrocinador trava depois do primeiro clique, para o cadastro não sair em dobro.' },
    ],
  },
  {
    version: '1.64.1', date: '2026-11-12', title: 'Follow-up não vence no fim de semana',
    items: [
      { kind: 'ajuste', text: 'Se o próximo follow-up cair num sábado ou domingo, ele passa para a segunda. Vale para convidados e patrocinadores, no quadro, na lista, no Início e no aviso do dia.' },
    ],
  },
  {
    version: '1.64.0', date: '2026-11-11', title: 'Reuniões com patrocinador no Google Agenda',
    items: [
      { kind: 'novo', text: 'Aba Reuniões no patrocinador: marque data, horário, Google Meet ou presencial, os convidados da empresa e o responsável. A reunião vai para o Google Agenda do Pulso, o Google cria o Meet e manda o convite.' },
      { kind: 'novo', text: 'Remarcar e cancelar avisam todo mundo pelo Google. O que muda direto no Google Agenda (horário, Meet criado lá, quem confirmou ou recusou) aparece no sistema em até 15 minutos.' },
      { kind: 'novo', text: 'Depois da reunião, o resumo fica guardado nela (por enquanto colado à mão; o envio automático vem numa próxima etapa). As reuniões aparecem no Calendário do painel e na linha do tempo do patrocinador.' },
    ],
  },
  {
    version: '1.63.2', date: '2026-11-11', title: 'Publicação nas redes mais segura',
    items: [
      { kind: 'correcao', text: 'Marcar pessoas num Reel fazia o Instagram recusar o post (pela Outstand ele só aceita marcação em foto). Agora, no vídeo, o campo "Marcar pessoas" não aparece (fica só o collab), e uma marcação antiga sai do envio com um aviso na publicação.' },
      { kind: 'correcao', text: 'Recusas do Instagram que não têm a ver com a conta (marcação, formato, campo inválido) não pedem mais para reconectar a conta; falha que a própria Meta marca como passageira tenta de novo sozinha.' },
      { kind: 'correcao', text: 'Envio parado na Outstand por mais de 30 minutos é cancelado lá (para não sair depois, repetido) e tenta de novo com o vídeo ajustado para as redes. Corte acima de 300 MB já vai ajustado (1080p).' },
      { kind: 'correcao', text: 'Apagar um corte para as publicações dele que ainda não saíram, e "Desfazer" devolve o agendamento. Antes, uma publicação sem o corte podia ser tratada como se fosse do episódio inteiro.' },
    ],
  },
  {
    version: '1.63.1', date: '2026-11-11', title: 'Mensagens com aviso próprio e lembretes para a produção',
    items: [
      { kind: 'ajuste', text: 'Mensagens não entram mais na lista de Notificações nem no número do sino. O aviso de mensagem, menção, reação e "adicionou você ao grupo" chega no celular com som e vibração, aparece em destaque no painel aberto e soma no contador de Mensagens.' },
      { kind: 'ajuste', text: 'O resumo diário de follow-ups vai só para a produção. Cada produtora recebe os dela; o que está com alguém da gestão ou sem responsável vai para as produtoras. Gestão e superadmin não recebem mais esse aviso.' },
      { kind: 'ajuste', text: 'Os lembretes do portal do convidado (avisar no WhatsApp que saiu post em collab e pedir a collab no YouTube) vão só para a produção.' },
    ],
  },
  {
    version: '1.63.0', date: '2026-11-11', title: 'Marcar pessoas e citar itens nas mensagens',
    items: [
      { kind: 'novo', text: 'Nos grupos, escreva @ e escolha a pessoa para marcá-la; @todos marca o grupo inteiro. Quem foi marcado recebe "fulano mencionou você", e a conversa ganha um @ na lista.' },
      { kind: 'novo', text: 'Escreva # para citar um episódio, corte, convidado, patrocinador, publicação ou tarefa: o item entra na mensagem como um link clicável, que abre a página dele. Vale nos grupos e nas conversas individuais.' },
      { kind: 'novo', text: 'Você escolhe como quer ser avisado. Em Notificações > Alertas: mensagens de grupo, todas ou só quando marcarem você (conversa individual e reação à sua mensagem sempre avisam). Em cada conversa, tocando no nome dela: padrão, todas, só quando me marcarem ou nenhum.' },
      { kind: 'ajuste', text: 'O som toca no instante em que a mensagem chega, se a conversa avisa você e você não está olhando para ela.' },
    ],
  },
  {
    version: '1.62.1', date: '2026-11-10', title: 'Notificações mais simples no celular',
    items: [
      { kind: 'ajuste', text: 'Notificações abre direto na lista de avisos. O filtro por tipo virou uma linha de botões que desliza e mostra só os tipos que você já recebeu.' },
      { kind: 'ajuste', text: 'Alertas do aparelho, som das mensagens e "silenciar" ficam no botão Alertas, no topo. Se os alertas estiverem desligados neste aparelho, um cartão curto acima da lista oferece ligar.' },
      { kind: 'ajuste', text: 'Cada aviso mostra a hora ("23:33" hoje, "09/11 08:13" em outro dia) e o botão de marcar como lida virou um ícone. Avisos de mensagem ganharam o ícone deles.' },
      { kind: 'correcao', text: 'No celular, o aviso "Sistema atualizado" cobria os botões do topo da página. Agora ele aparece embaixo, acima do assistente.' },
    ],
  },
  {
    version: '1.62.0', date: '2026-11-10', title: 'Insights de todas as redes e mensagens que avisam',
    items: [
      { kind: 'novo', text: 'Insights mostra cada rede pela conta em que ela está conectada: Instagram, Facebook, TikTok e Threads pela Outstand; YouTube e X pela Zernio. Resumo com seguidores e a variação em 7 dias, e uma aba por rede com os números dos últimos 30 dias (visualizações, alcance, curtidas, comentários, compartilhados, salvos e Stories), o gráfico de seguidores por dia e os posts que mais renderam.' },
      { kind: 'novo', text: 'Mensagens: avisos com som e vibração. Mensagem ou reação nova toca no app aberto e aparece em destaque; com o app fechado, o aviso do celular toca, vibra e fica na tela até você ver. O som pode ser desligado em Notificações.' },
      { kind: 'novo', text: 'Reagiram à sua mensagem? Você recebe o aviso. E o aviso de mensagem nova chega em cerca de 8 segundos (antes, 20).' },
      { kind: 'ajuste', text: 'Grupos: a conversa mostra quem criou o grupo, quem entrou, quem saiu e quando o nome mudou. Quem é adicionado recebe um aviso na hora, mesmo antes da primeira mensagem.' },
      { kind: 'correcao', text: 'No celular, o aviso "Sistema atualizado" cobria o botão "Nova conversa" em Mensagens. Agora ele aparece na próxima tela.' },
    ],
  },
  {
    version: '1.61.0', date: '2026-11-10', title: 'Capa editável na hora de agendar',
    items: [
      { kind: 'novo', text: 'A produtora agora edita capas: trocar o quadro, usar uma foto do episódio, enviar uma imagem e mudar o texto, e também escolher qual capa o corte usa. Gerar capas com a IA continua com a finalização.' },
      { kind: 'novo', text: 'Novo post: depois de escolher o corte ou a imagem, aparece "Editar capa" (ou "Editar imagem"). O editor volta para o post com o item escolhido, e o que você já escreveu na legenda continua lá.' },
      { kind: 'ajuste', text: 'Na publicação que ainda não saiu (em revisão, devolvida ou agendada), a capa tem o botão "Editar capa". A mudança vale para o envio, porque a capa é lida na hora de publicar.' },
    ],
  },
  {
    version: '1.60.0', date: '2026-11-10', title: 'Vídeos sem travar',
    items: [
      { kind: 'correcao', text: 'Os vídeos travavam porque o player tocava o arquivo original, pesado demais para assistir pela internet: cortes verticais em 4K a 90 Mbps (um corte de 1 minuto tinha 650 MB) e episódios de 12 a 18 GB. Agora o sistema prepara uma versão leve só para assistir (720p, cerca de 2 a 3 Mbps, começa na hora e pula para qualquer ponto sem esperar). O mesmo corte de 650 MB fica com 13 MB.' },
      { kind: 'ajuste', text: 'Baixar e publicar nas redes continuam usando o original, na qualidade enviada. Na revisão do episódio e na página do corte, "Ver no original" troca o player para o arquivo enviado sem perder o ponto em que você estava.' },
      { kind: 'ajuste', text: 'A versão leve é preparada sozinha depois de cada envio, numa fila separada (não atrasa cortes nem a finalização). Os vídeos que já estão no sistema entram aos poucos, dos mais novos para os mais antigos. Até ela ficar pronta, o player toca o original, como antes.' },
    ],
  },
  {
    version: '1.59.0', date: '2026-11-08', title: 'Mensagens da equipe',
    items: [
      { kind: 'novo', text: 'Mensagens: conversas individuais e grupos dentro do sistema. Dá para editar e apagar o que você enviou, reagir com emoji, responder em thread, anexar arquivos e mandar áudio com transcrição.' },
      { kind: 'novo', text: 'Grupos: quem administra renomeia, adiciona e remove pessoas e escolhe outros administradores. Qualquer pessoa pode sair.' },
      { kind: 'novo', text: '"Resumir" com IA: as não lidas, as últimas 24 horas, os últimos 7 dias ou uma thread, com o que foi falado, as decisões e as pendências.' },
      { kind: 'novo', text: 'Entrega garantida: sem conexão, a mensagem fica guardada e sai sozinha quando a conexão voltar, sem duplicar. Quem esteve fora recebe tudo ao reconectar. Quem não leu em 20 segundos recebe um aviso.' },
    ],
  },
  {
    version: '1.58.0', date: '2026-11-08', title: 'Marcadores da revisão no Premiere',
    items: [
      { kind: 'novo', text: '"Baixar marcadores" agora gera o arquivo do Premiere Pro (.xml), que já vem marcado: no Premiere, Arquivo > Importar cria a sequência "EP.0XX · ajustes da revisão" com um marcador por comentário (vermelho em aberto, amarelo feito, verde conferido; trecho vira marcador com duração). A janela explica como levar os marcadores para a sua edição.' },
      { kind: 'ajuste', text: 'A janela dos marcadores mostra só o que vale para o programa escolhido, e cada marcador continua avisando que a minutagem é aproximada.' },
    ],
  },
  {
    version: '1.57.0', date: '2026-11-07', title: 'Revisão que não se perde e marcadores para o editor',
    items: [
      { kind: 'novo', text: 'O editor marca cada ajuste pedido na revisão como feito, na aba Material. Ao subir a nova versão, o ajuste vira "feito na v2", e quem revisa confere um por um: "Conferido" ou "Ainda não" (volta para o editor). A revisão ganhou o filtro Todos | Para conferir | Em aberto | Conferidos.' },
      { kind: 'novo', text: '"Baixar marcadores": os ajustes da revisão num arquivo para o DaVinci Resolve (cada comentário vira um marcador na linha do tempo, com o texto) ou numa lista em texto. As minutagens são uma orientação: o arquivo e a tela lembram de conferir o ponto certo antes de cortar.' },
      { kind: 'correcao', text: 'Os comentários da revisão não somem mais junto com o vídeo: a versão que tem comentários não pode ser removida (a correção sobe como versão nova), e cada comentário guarda a versão em que foi feito ("minutagem da v1" quando o player já mostra outra).' },
      { kind: 'ajuste', text: 'Quem revisa recebe aviso quando chega uma versão nova durante a revisão, com quantos ajustes o editor marcou como feitos.' },
    ],
  },
  {
    version: '1.56.0', date: '2026-11-07', title: 'Imagens em WebP, assistente em tempo real e painel de desempenho',
    items: [
      { kind: 'novo', text: 'O assistente responde em tempo real: o texto vai aparecendo enquanto a IA escreve, e "Consultando o sistema" aparece quando ele busca dados antes de responder.' },
      { kind: 'novo', text: 'Gestão > Sistema > Desempenho: quanto cada página demora no navegador de quem usa (aparecer, responder ao clique, pular na tela), as respostas lentas do servidor e as consultas que mais pesam no banco.' },
      { kind: 'ajuste', text: 'As imagens para ver no sistema (fotos dos convidados, capas, quadros, logos, fotos da galeria) chegam em WebP, mais leves, e ficam guardadas no servidor depois da primeira visita. "Baixar" continua entregando o arquivo original, em JPG ou PNG como foi enviado.' },
      { kind: 'ajuste', text: 'Publicar agora, aprovar e reenviar não seguram mais a tela enquanto o vídeo sobe: se passar de alguns segundos, a página volta com "Enviando" e o resultado aparece sozinho (com aviso se algo falhar).' },
      { kind: 'ajuste', text: 'Gerar capas baixa só os quadros usados, vários de uma vez; o estado das contas das redes não faz mais a página esperar o provedor.' },
      { kind: 'ajuste', text: 'Auditoria, notificações e publicações ganharam páginas (Mais recentes / Mais antigos): o histórico antigo voltou a aparecer.' },
      { kind: 'ajuste', text: 'Busca global e sugestões do Instagram esperam você parar de digitar e cancelam a busca anterior; botões que demoram (gerar ideias, gerar capas, testes de integração, enviar convite) não disparam duas vezes; reagir a um comentário aparece na hora.' },
      { kind: 'ajuste', text: 'Painel mais rápido: duas cópias do servidor dividindo o acesso, arquivos do sistema comprimidos em Brotli e guardados no navegador, imagens abaixo da dobra carregando sob demanda e páginas de convidado, patrocinador, episódio e corte buscando os dados em paralelo.' },
    ],
  },
  {
    version: '1.55.0', date: '2026-11-07', title: 'Páginas mais rápidas e carregamento com esqueleto',
    items: [
      { kind: 'novo', text: 'Ao abrir outra página do painel, se ela demorar um pouco, a área de conteúdo mostra o contorno da tela que vem (lista, cadastro, painel, quadro ou calendário) em vez de ficar parada na página anterior. A busca global também mostra o contorno dos resultados enquanto procura.' },
      { kind: 'ajuste', text: 'Menos idas ao banco por página: ajustes do sistema, lista da equipe e configuração dos avisos são lidos uma vez por página; o estoque, o portal do convidado, os avisos e as ações em massa de pedidos deixaram de consultar item por item.' },
      { kind: 'ajuste', text: 'Novos índices nas consultas que mais rodam (publicações, fila de trabalhos, tarefas do convidado e do patrocinador, gravações no calendário, resultados da plateia), para o sistema continuar rápido conforme os dados crescem.' },
    ],
  },
  {
    version: '1.54.0', date: '2026-11-05', title: 'Media kit: quem já sentou à mesa, todos de uma vez',
    items: [
      { kind: 'ajuste', text: 'No media kit, o slide "Quem já sentou à mesa" não passa mais de página: um convidado aparece em destaque, com foto quadrada, alcance e apresentação, e troca sozinho; todos os outros ficam à vista numa grade de fotos quadradas. Passar o mouse ou clicar numa foto mostra aquele convidado. No celular, cada um é um cartão com a foto e a apresentação embaixo.' },
      { kind: 'ajuste', text: 'O rodapé do slide conta os episódios no ar e os gravados a caminho direto do sistema, em vez de um texto fixo.' },
    ],
  },
  {
    version: '1.53.0', date: '2026-11-05', title: 'Galeria do media kit com episódios gravados',
    items: [
      { kind: 'ajuste', text: 'Gestão > Galeria do media kit: além dos publicados, os episódios já gravados (em edição, revisão, finalização ou prontos para publicar) também podem entrar no slide "Quem já sentou à mesa". A lista mostra a etapa de cada episódio.' },
    ],
  },
  {
    version: '1.52.0', date: '2026-11-03', title: 'Trecho na revisão e troca do vídeo do corte',
    items: [
      { kind: 'novo', text: 'Na revisão do vídeo, o comentário pode marcar um trecho: arraste na linha do tempo, ou use "Marcar início do trecho" e "Marcar fim do trecho" (atalhos I e O). Clicar no tempo do comentário toca aquele trecho e para no fim dele.' },
      { kind: 'novo', text: 'O vídeo de um corte ainda não publicado pode ser trocado: "Trocar vídeo" na página do corte. Título, legenda, capa escolhida e comentários continuam, a versão anterior fica guardada para baixar, e quem revisa recebe um aviso quando a nova versão fica pronta.' },
    ],
  },
  {
    version: '1.51.0', date: '2026-11-03', title: 'Calendário de posts no portal do convidado',
    items: [
      { kind: 'novo', text: 'A aba Portal do convidado ganhou o "Calendário de posts": monte quantos posts vão sair, a data, o horário provável e, se quiser, o que sai em cada um. Salvo, ele aparece na seção de posts em collab do portal, como previsão. Não precisa ter o post pronto, e "tirar do portal" esconde sem apagar as datas.' },
    ],
  },
  {
    version: '1.50.0', date: '2026-11-02', title: 'Reações nos comentários',
    items: [
      { kind: 'novo', text: 'Todo comentário, inclusive os da revisão do vídeo, aceita reações com emoji: 👍 ❤️ 😂 🎉 😮 🙏. Clique no rostinho para reagir; clique de novo no emoji para tirar. Parar o mouse sobre a reação mostra quem reagiu.' },
      { kind: 'novo', text: 'Quem escreveu o comentário recebe um aviso a cada reação. Para não receber, marque "Silenciar reações" em Notificações.' },
    ],
  },
  {
    version: '1.49.0', date: '2026-11-02', title: 'Vídeo do episódio no portal e logo do parceiro',
    items: [
      { kind: 'novo', text: 'O portal do convidado pode oferecer o vídeo do episódio para baixar: na aba Portal do convidado, em "No portal agora", "liberar para baixar". Vem desligado, e entrega sempre a versão mais nova que o editor enviou.' },
      { kind: 'novo', text: 'Cada link de parceiro da plateia pode ter a logomarca dele: em "Links de parceiro", "enviar logo". Ela aparece no convite, na página de inscrição de quem chega por aquele link.' },
    ],
  },
  {
    version: '1.48.0', date: '2026-11-01', title: 'Baixar vários em ZIP',
    items: [
      { kind: 'novo', text: 'Com dois ou mais arquivos, "Baixar tudo", "Baixar pasta" e "Baixar selecionados" baixam um ZIP só (material do episódio, bastidores, galeria, posts e cortes). O ZIP é montado enquanto baixa, e a barra de downloads do navegador mostra o andamento e o tempo que falta. Um arquivo sozinho continua baixando direto.' },
    ],
  },
  {
    version: '1.47.2', date: '2026-11-01', title: 'Baixar tudo baixa todos os arquivos',
    items: [
      { kind: 'correcao', text: '"Baixar tudo", "Baixar pasta" e "Baixar selecionados" (material do episódio, galeria, bastidores, posts e cortes) baixavam só 4 ou 5 arquivos: cada download cancelava o anterior que ainda não tinha começado. Agora cada arquivo sai por conta própria e todos chegam. Se o navegador perguntar, permita baixar vários arquivos.' },
    ],
  },
  {
    version: '1.47.1', date: '2026-11-01', title: 'Página da plateia no celular',
    items: [
      { kind: 'ajuste', text: 'Na página de cada convidado, no celular, o título vem antes da foto e o botão "Pedir para participar" fica logo abaixo dela, sem precisar rolar. Os dados da gravação vêm depois do botão.' },
      { kind: 'ajuste', text: 'O vídeo dos bastidores virou a segunda seção das duas páginas da plateia, logo depois do topo, com o título "Veja como é participar do Pulso Podcast."' },
    ],
  },
  {
    version: '1.47.0', date: '2026-11-01', title: 'WhatsApp da produção na página da plateia',
    items: [
      { kind: 'novo', text: 'As páginas da plateia (a agenda geral e a de cada convidado) têm um botão flutuante "Dúvidas? Fale com a produção", que abre o WhatsApp da produtora com uma mensagem pronta. No celular ele vira um ícone redondo no canto. Só aparece com o WhatsApp informado em Plateia > Ajustes.' },
      { kind: 'ajuste', text: 'Os cliques no botão aparecem em Plateia > Resultados e chegam ao Pixel da Meta como "Contact".' },
    ],
  },
  {
    version: '1.46.0', date: '2026-10-31', title: 'Transcrição logo depois do envio',
    items: [
      { kind: 'novo', text: 'A transcrição do episódio começa sozinha, em segundo plano, assim que o vídeo editado termina de subir. O FFmpeg lê o vídeo direto do armazenamento e guarda só o áudio, sem ocupar o disco do servidor com o vídeo. O card "Vídeo editado" mostra se ela está pronta.' },
      { kind: 'ajuste', text: 'A análise por IA da finalização reaproveita a transcrição já pronta e termina mais rápido. Versão nova do vídeo gera transcrição nova.' },
    ],
  },
  {
    version: '1.45.0', date: '2026-10-31', title: 'Valor da plateia por gravação',
    items: [
      { kind: 'novo', text: 'Cada gravação pode ter o próprio valor da vaga: no cadastro do convidado, em "Podcast com plateia", "editar" ao lado do valor. Vazio usa o valor geral de Plateia > Ajustes. A página da gravação, a agenda, a mensagem de WhatsApp, o pedido e a conta a receber usam esse valor; pedidos já feitos guardam o valor da época.' },
      { kind: 'ajuste', text: 'Com gravações de valores diferentes, a agenda pública mostra o valor em cada cartão e o resumo da página diz "a partir de".' },
      { kind: 'correcao', text: 'Valores com centavos na plateia apareciam arredondados (R$ 197,50 virava R$ 198).' },
    ],
  },
  {
    version: '1.44.0', date: '2026-10-31', title: 'Meta Pixel nas páginas públicas',
    items: [
      { kind: 'novo', text: 'O Meta Pixel do Pulso mede as visitas das páginas da plateia, do patrocinador (media kit, cadastro e portal) e do convidado (convite e portal), com o nome de cada página.' },
      { kind: 'novo', text: 'Na plateia, enviar o formulário de interesse conta como conversão (Lead) no Pixel; abrir o formulário conta como início.' },
      { kind: 'ajuste', text: 'O convite e o portal do convidado, abertos pelo navegador, passam para um endereço limpo: o código secreto do link não vai para a Meta. O link enviado continua o mesmo.' },
    ],
  },
  {
    version: '1.43.2', date: '2026-10-30', title: 'Spotify tocando no portal',
    items: [
      { kind: 'correcao', text: 'Portal do convidado: o primeiro clique no play do Spotify não fazia nada. A galeria de fotos continuava trocando de foto fora da tela e atrapalhava; agora ela só passa sozinha quando está à vista, e o Spotify carrega junto com a página.' },
      { kind: 'ajuste', text: 'O vídeo do YouTube aparece como capa com o botão de play e só carrega quando a pessoa clica: a página abre mais rápido.' },
    ],
  },
  {
    version: '1.43.1', date: '2026-10-30', title: 'Galeria e Spotify do portal',
    items: [
      { kind: 'correcao', text: 'Portal do convidado: o player do Spotify encolhia e deixava um espaço vazio ao dar play (o episódio tem vídeo e o player estava na versão compacta). Agora ele vem no tamanho de vídeo do Spotify, com a permissão de reprodução.' },
      { kind: 'correcao', text: 'Galeria de fotos: a foto aparece inteira (vertical sem cortar a cabeça), só troca depois que a próxima carregou e a miniatura da foto atual fica sempre à vista.' },
      { kind: 'ajuste', text: '"Baixar todas" agora baixa um arquivo ZIP só, com todas as fotos, em vez de dezenas de downloads.' },
      { kind: 'correcao', text: 'Depois de cada atualização, algumas telas (o portal do convidado, a janela de reenviar e o recorte de foto) continuavam com o visual antigo por até uma hora. Agora o navegador pega a versão nova na hora.' },
    ],
  },
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
