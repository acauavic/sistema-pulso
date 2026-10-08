// Etapas do funil de convidados (ordem = colunas do quadro).
const GUEST_STATUSES = [
  { key: 'prospect', label: 'Prospecção', hint: 'Ainda não convidado' },
  { key: 'convite_enviado', label: 'Convite enviado', hint: 'Aguardando resposta' },
  { key: 'confirmado', label: 'Confirmado', hint: 'Aceitou participar' },
  { key: 'gravado', label: 'Gravado', hint: 'Episódio gravado' },
  { key: 'publicado', label: 'Publicado', hint: 'Episódio no ar' },
  { key: 'recusou', label: 'Recusou', hint: 'Não vai participar' },
  { key: 'cancelado', label: 'Cancelado', hint: 'Desistência / cancelamento' },
];

const STATUS_BY_KEY = Object.fromEntries(GUEST_STATUSES.map((s) => [s.key, s]));
const isStatus = (key) => Object.prototype.hasOwnProperty.call(STATUS_BY_KEY, key);

// Status em que o convidado ainda pode responder pelo link público.
const RSVP_OPEN = ['prospect', 'convite_enviado', 'confirmado', 'recusou'];

module.exports = { GUEST_STATUSES, STATUS_BY_KEY, isStatus, RSVP_OPEN };
