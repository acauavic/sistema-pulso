// Histórico de versões do Pulso Gestão, da mais nova para a mais antiga. A primeira entrada é a versão no ar:
// ela tem que ser igual ao "version" do package.json (o teste confere). Ao lançar: acrescente a entrada no topo,
// suba o package.json e avise no memory.md. Cada pessoa vê um aviso uma vez por versão nova e a página /novidades.
// kind: novo | ajuste | correcao
module.exports = [
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
