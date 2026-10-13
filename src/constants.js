// Etapas do funil de convidados (ordem = colunas do quadro).
const GUEST_STATUSES = [
  { key: 'prospect', label: 'Prospecção', hint: 'Ainda não convidado' },
  { key: 'convite_enviado', label: 'Convite enviado', hint: 'Aguardando resposta' },
  { key: 'em_agendamento', label: 'Em agendamento', hint: 'Aceitou; alinhando data e detalhes' },
  { key: 'agendado', label: 'Agendado', hint: 'Data confirmada com Estúdio, hosts e convidado' },
  { key: 'gravado', label: 'Gravado', hint: 'Conversa gravada; daqui em diante é o episódio' },
  { key: 'perdido', label: 'Perdido', hint: 'Não vai participar; o motivo fica registrado' },
  { key: 'cancelado', label: 'Cancelado', hint: 'Desistência / cancelamento' },
];

const STATUS_BY_KEY = Object.fromEntries(GUEST_STATUSES.map((s) => [s.key, s]));
const isStatus = (key) => Object.prototype.hasOwnProperty.call(STATUS_BY_KEY, key);

// Status em que o convidado ainda pode responder pelo link público.
const RSVP_OPEN = ['prospect', 'convite_enviado', 'em_agendamento', 'perdido'];
// Etapas em que o clique em "Aceitar" move o convidado para "Em agendamento".
const ACCEPT_FROM = ['prospect', 'convite_enviado', 'perdido'];

// Motivo da perda (obrigatório em Perdido). "Outros" pede uma descrição.
const LOSS_REASONS = {
  recusado: 'Recusado',
  sem_agenda: 'Sem agenda próxima',
  nunca_respondeu: 'Nunca respondeu',
  parou_de_responder: 'Parou de responder',
  conflito_de_interesse: 'Conflito de interesse',
  outros: 'Outros',
};

const PROFILES = [
  { key: 'medico', label: 'Médico(a)' },
  { key: 'influencer', label: 'Influencer' },
  { key: 'empresario', label: 'Empresário(a)' },
  { key: 'profissional_saude', label: 'Profissional da saúde' },
];
const PROFILE_BY_KEY = Object.fromEntries(PROFILES.map((p) => [p.key, p]));

const CLICK_KINDS = { aceitar: 'Aceitar o convite', producao: 'Falar com a produção' };

// ---- patrocinadores ----
const SPONSOR_STAGES = [
  { key: 'prospect', label: 'Prospecção', hint: 'Ainda não falamos / media kit enviado' },
  { key: 'negociacao', label: 'Em negociação', hint: 'Mostrou interesse, acertando condições' },
  { key: 'ganho', label: 'Ganho', hint: 'Fechou; falta o cadastro e o pagamento' },
  { key: 'ativo', label: 'Ativo', hint: 'Pagou e acertou tudo; patrocínio em andamento' },
  { key: 'inativo', label: 'Inativo', hint: 'Patrocínio encerrado ou pausado' },
  { key: 'perdido', label: 'Perdido', hint: 'Não fechou' },
];
const SPONSOR_STAGE_BY_KEY = Object.fromEntries(SPONSOR_STAGES.map((s) => [s.key, s]));
const isSponsorStage = (key) => Object.prototype.hasOwnProperty.call(SPONSOR_STAGE_BY_KEY, key);
const SPONSOR_KINDS = { marca_pessoal: 'Marca pessoal', negocio: 'Negócio' };
const SPONSOR_TIERS = { ouro: 'Ouro', diamond: 'Diamond' };
const SPONSOR_GOALS = { reconhecimento: 'Gerar reconhecimento', autoridade: 'Construir autoridade', leads: 'Gerar leads', vendas: 'Gerar vendas', outro: 'Outro' };
const DELIVERABLE_KINDS = {
  episodio_exclusivo: 'Episódio exclusivo',
  insercao: 'Inserção em episódios',
  corte_exclusivo: 'Cortes exclusivos',
  corte_participacao: 'Cortes com participação',
  moldura: 'Moldura',
  qr_code: 'QR Code',
  presenca_plataformas: 'Presença no YouTube e Spotify',
};
const DELIVERABLE_STATUSES = { pendente: 'Pendente', em_producao: 'Em produção', ativo: 'Ativo', concluido: 'Concluído' };
// Linha de produção do episódio, em ordem.
const EPISODE_STAGES = [
  { key: 'gravado', label: 'Gravado', hint: 'Gravado; falta subir o material' },
  { key: 'disponivel_edicao', label: 'Disponível para edição', hint: 'Material bruto no ar; esperando o editor' },
  { key: 'em_edicao', label: 'Em edição', hint: 'O editor está trabalhando' },
  { key: 'em_revisao', label: 'Em revisão', hint: 'O gestor está revisando o vídeo' },
  { key: 'em_finalizacao', label: 'Em finalização', hint: 'Aprovado; título, descrição, thumbnail e cortes' },
  { key: 'pronto_publicar', label: 'Pronto para publicar', hint: 'Tudo certo; falta publicar' },
  { key: 'publicado', label: 'Publicado', hint: 'No ar' },
];
const EPISODE_STATUSES = Object.fromEntries(EPISODE_STAGES.map((s) => [s.key, s.label]));
const EPISODE_STAGE_BY_KEY = Object.fromEntries(EPISODE_STAGES.map((s) => [s.key, s]));
const EPISODE_FILE_KINDS = {
  bruto_video: 'Vídeo bruto', bruto_audio: 'Áudio bruto', bastidor: 'Bastidores', foto: 'Fotografia', editado: 'Vídeo editado', outro: 'Outro',
};
const TASK_KINDS = { geral: 'Geral', cortes: 'Cortes', bastidores: 'Bastidores', extra: 'Conteúdo extra', outro: 'Outro' };
const TASK_STATUSES = { a_fazer: 'A fazer', fazendo: 'Fazendo', feito: 'Feito', bloqueada: 'Bloqueada' };
// Notificações: o que cada tipo cobre (mostrado na configuração da gestão).
const NOTIFICATION_TYPES = {
  tarefa: { label: 'Tarefas', hint: 'Tarefa atribuída a você, bloqueada, concluída, vencendo hoje ou atrasada.' },
  comentario: { label: 'Comentários', hint: 'Comentários em convidados, patrocinadores, episódios, cortes e tarefas de que você participa, e menções com @.' },
  agendamento: { label: 'Agendamentos concluídos', hint: 'Convidado com gravação agendada (data, estúdio, hosts e convidado confirmados).' },
  plateia: { label: 'Plateia', hint: 'Nova inscrição pedida pela página pública do Pulso Podcast com Plateia.' },
  financeiro: { label: 'Financeiro', hint: 'Contas vencendo ou atrasadas e estoque que precisa ser reposto.' },
  rotina: { label: 'Rotinas do sistema', hint: 'Análise por IA pronta ou com erro, corte lido, publicação concluída, patrocinador respondeu o formulário.' },
};
// Momentos que disparam rotinas de tarefas.
const ROUTINE_TRIGGERS = {
  episodio_criado: 'Quando o episódio nasce (conversa gravada)',
  'etapa:disponivel_edicao': 'Quando fica Disponível para edição',
  'etapa:em_edicao': 'Quando entra Em edição',
  'etapa:em_revisao': 'Quando vai Em revisão',
  'etapa:em_finalizacao': 'Quando entra Em finalização',
  'etapa:pronto_publicar': 'Quando fica Pronto para publicar',
  'etapa:publicado': 'Quando é Publicado',
};
const ROUTINE_ANCHORS = { gatilho: 'a partir do dia do gatilho', gravacao: 'a partir da data da gravação', veiculacao: 'a partir da data de veiculação' };
const ROUTINE_ASSIGNEES = { ninguem: 'Ninguém (fica para alguém pegar)', editor: 'O editor do episódio', responsavel_convidado: 'O responsável pelo convidado', usuario: 'Uma pessoa fixa' };
const CHECKLIST_GATES = { revisao: 'Antes da revisão', finalizado: 'Antes de finalizar', livre: 'Livre (opcional)' };
// ---- financeiro ----
const FIN_OUT = {
  estudio: 'Estúdio', equipe: 'Equipe e salários', edicao: 'Edição', brindes: 'Brindes e presentes', impressos: 'Impressos e cartões',
  transporte: 'Transporte e Uber', marketing: 'Marketing e anúncios', software: 'Software e assinaturas', impostos: 'Impostos e taxas', outros: 'Outros custos',
};
const FIN_IN = { patrocinio: 'Patrocínio', plateia: 'Plateia', outros_in: 'Outras receitas' };
const FIN_CATEGORIES = { ...FIN_OUT, ...FIN_IN };
const FIN_TRIGGERS = {
  gravacao_agendada: 'Quando a gravação é agendada',
  episodio_gravado: 'Quando o episódio é gravado',
  episodio_publicado: 'Quando o episódio é publicado',
};
const FIN_ANCHORS = { gatilho: 'a partir do dia em que acontece', gravacao: 'a partir da data da gravação', veiculacao: 'a partir da data de veiculação' };
const FILE_KINDS = ['logo', 'audio', 'moldura', 'qrcode', 'material'];

module.exports = {
  LOSS_REASONS, FIN_OUT, FIN_IN, FIN_CATEGORIES, FIN_TRIGGERS, FIN_ANCHORS, NOTIFICATION_TYPES, ROUTINE_TRIGGERS, ROUTINE_ANCHORS, ROUTINE_ASSIGNEES, EPISODE_STAGES, EPISODE_STAGE_BY_KEY, EPISODE_FILE_KINDS, TASK_KINDS, TASK_STATUSES, CHECKLIST_GATES, SPONSOR_STAGES, SPONSOR_STAGE_BY_KEY, isSponsorStage, SPONSOR_KINDS, SPONSOR_TIERS, SPONSOR_GOALS,
  DELIVERABLE_KINDS, DELIVERABLE_STATUSES, EPISODE_STATUSES, FILE_KINDS, GUEST_STATUSES, STATUS_BY_KEY, isStatus, RSVP_OPEN, ACCEPT_FROM, PROFILES, PROFILE_BY_KEY, CLICK_KINDS };
