// Histórico de versões do Pulso Gestão, da mais nova para a mais antiga. A primeira entrada é a versão no ar:
// ela tem que ser igual ao "version" do package.json (o teste confere). Ao lançar: acrescente a entrada no topo,
// suba o package.json e avise no memory.md. Cada pessoa vê um aviso uma vez por versão nova e a página /novidades.
// kind: novo | ajuste | correcao
module.exports = [
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
