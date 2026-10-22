// Histórico de versões do Pulso Gestão, da mais nova para a mais antiga. A primeira entrada é a versão no ar:
// ela tem que ser igual ao "version" do package.json (o teste confere). Ao lançar: acrescente a entrada no topo,
// suba o package.json e avise no memory.md. Cada pessoa vê um aviso uma vez por versão nova e a página /novidades.
// kind: novo | ajuste | correcao
module.exports = [
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
