// Auditoria legível: "corte.excluido" vira "Corte · excluído"; "convidado.etapa" vira "Convidado mudou de etapa".
// Código novo que não estiver no dicionário sai pelo caminho genérico (área + verbo com acento), nunca cru.
const AREAS = {
  abordagem: 'Abordagem', automacao: 'Automação', busca: 'Busca', cadencia: 'Cadência', calendario: 'Calendário', capas: 'Capas',
  checklist: 'Checklist', convidado: 'Convidado', convidados: 'Convidados', convite: 'Convite', corte: 'Corte', episodio: 'Episódio',
  estoque: 'Estoque', estudio: 'Estúdio', metas: 'Metas', financeiro: 'Financeiro', integracao: 'Integração', kit: 'Media kit', lembretes: 'Lembretes',
  lixeira: 'Lixeira', login: 'Acesso', notificacoes: 'Notificações', patrocinador: 'Patrocinador', patrocinio: 'Patrocínio', pedido: 'Pedido',
  pauta: 'Pauta', perfil: 'Perfil', projeto: 'Projeto', piloto_semana: 'Agenda da semana', plano: 'Plano', plateia: 'Plateia', portal: 'Portal do convidado', publicacao: 'Publicação',
  rotina: 'Rotina', senha: 'Senha', tarefa: 'Tarefa', trabalho: 'Trabalho em segundo plano', usuario: 'Usuário', whatsapp: 'WhatsApp',
};
const WHOLE = {
  'login.ok': 'Entrou no sistema', 'login.falhou': 'Tentativa de entrar que falhou', 'senha.alterada': 'Trocou a senha',
  'convidado.etapa': 'Convidado mudou de etapa', 'patrocinador.etapa': 'Patrocinador mudou de etapa', 'episodio.etapa': 'Episódio mudou de etapa',
  'convidado.tambem_em_projeto': 'Convidado também em outro projeto', 'patrocinador.tambem_em_projeto': 'Negociação aberta também em outro projeto',
  'convidados.edicao_em_massa': 'Convidados editados em massa', 'convidados.importados': 'Convidados importados (planilha)',
  'capas.em_lote': 'Capas trocadas em lote', 'tarefa.voz': 'Tarefa criada por voz', 'trabalho.repetido': 'Trabalho em segundo plano repetido',
  'automacao.links': 'Links do direct alterados', 'piloto_semana.ajustado': 'Agenda da semana ajustada', 'kit.galeria_edita': 'Galeria do media kit editada',
  'patrocinio.regra_exclusivo': 'Regra do episódio exclusivo alterada', 'patrocinio.vagas': 'Vagas no media kit alteradas',
  'portal.link_email': 'Link do portal enviado por e-mail', 'portal.link_whatsapp': 'Link do portal enviado por WhatsApp',
  'financeiro.banco_ligado': 'Banco de horas do estúdio ligado', 'financeiro.banco_compra': 'Compra de horas do estúdio',
  'sessao.criada': 'Sessão de gravação marcada', 'sessao.editada': 'Sessão de gravação alterada', 'sessao.videos': 'Vídeos da sessão alterados', 'sessao.encerrada': 'Sessão de gravação encerrada', 'sessao.duracao': 'Duração da sessão corrigida', 'sessao.cancelada': 'Sessão de gravação cancelada', 'aprovacao.link': 'Link de aprovação gerado', 'aprovacao.cancelada': 'Link de aprovação cancelado', 'pauta.escrita': 'Pauta escrita', 'pauta.enviada': 'Pauta enviada para aprovação', 'pauta.ajustes': 'Pediram ajustes na pauta',
  'projeto.pessoas': 'Pessoas do projeto alteradas',
  'integracao.teste_email': 'Teste de e-mail', 'integracao.teste_infinitepay': 'Teste da InfinitePay',
};
const WORDS = {
  excluida: 'excluída', excluido: 'excluído', atribuido: 'atribuído', lancado: 'lançado', visualizacao: 'visualização', reuniao: 'reunião',
  reunioes: 'reuniões', edicao: 'edição', video: 'vídeo', duracao: 'duração', patrocinio: 'patrocínio', calendario: 'calendário', pagina: 'página',
  inscricao: 'inscrição', email: 'e-mail', whatsapp: 'WhatsApp', google: 'Google', outstand: 'Outstand', sync: 'sincronização',
  opcoes: 'opções', provedor: 'provedor', rotas: 'rotas', ok: 'ok',
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function auditLabel(action) {
  const a = String(action || '');
  if (WHOLE[a]) return WHOLE[a];
  const [area, ...rest] = a.split('.');
  const verb = rest.join(' ').split('_').map((w) => WORDS[w] || w).join(' ').trim();
  const who = AREAS[area] || cap(area.replace(/_/g, ' '));
  return verb ? `${who} · ${verb}` : who;
}

const ENTITIES = { clip: 'Corte', guest: 'Convidado', sponsor: 'Patrocinador', episode: 'Episódio', task: 'Tarefa', user: 'Usuário', publication: 'Publicação',
  cover: 'Imagem', request: 'Pedido', rule: 'Automação', settings: 'Configuração', fin_entry: 'Lançamento', fin_hour_pack: 'Banco de horas', stock_item: 'Estoque', plateia: 'Plateia' };
const entityLabel = (e) => ENTITIES[e] || (e ? cap(String(e).replace(/_/g, ' ')) : '');

module.exports = { AREAS, auditLabel, entityLabel };
