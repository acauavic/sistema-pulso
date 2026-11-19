// Campos do cartão de cada quadro: o que pode aparecer no cartão e o que aparece de padrão (o cartão como sempre foi).
// Cada pessoa escolhe no botão "Campos do cartão"; a escolha fica no navegador (localStorage) e "Restaurar padrão" volta a esta lista.
// Nas views, cada parte opcional do cartão leva data-cf="chave" (e hidden se não é padrão); src/public/card-fields.js aplica a escolha.
const LISTS = {
  convidados: [
    { key: 'perfil', label: 'Instagram e perfil', default: true },
    { key: 'tema', label: 'Tema', default: true },
    { key: 'perda', label: 'Motivo de perda', default: true },
    { key: 'gravacao', label: 'Data da gravação', default: true },
    { key: 'estreia', label: 'Estreia prevista (em Gravado)', default: true },
    { key: 'followup', label: 'Follow-up', default: true },
    { key: 'convite', label: 'Convite (enviado, aberto)', default: true },
    { key: 'responsavel', label: 'Responsável', default: true },
    { key: 'empresa', label: 'Empresa e cargo', default: false },
    { key: 'email', label: 'E-mail', default: false },
    { key: 'whatsapp', label: 'WhatsApp', default: false },
    { key: 'alcance', label: 'Alcance', default: false },
    { key: 'cadastro', label: 'Cadastrado em', default: false },
    { key: 'atualizado', label: 'Atualizado em', default: false },
  ],
  episodios: [
    { key: 'numero', label: 'Número, ordem e veiculação', default: true },
    { key: 'convidado', label: 'Convidado', default: true },
    { key: 'patrocinadores', label: 'Patrocinadores', default: true },
    { key: 'arquivos', label: 'Arquivos de material', default: true },
    { key: 'tarefas', label: 'Tarefas', default: true },
    { key: 'ajustes', label: 'Ajustes em aberto', default: true },
    { key: 'editor', label: 'Editor', default: true },
    { key: 'gravado', label: 'Gravado em', default: false },
    { key: 'publicado', label: 'Publicado em', default: false },
    { key: 'rodada', label: 'Rodadas de revisão', default: false },
    { key: 'criado', label: 'Criado em', default: false },
    { key: 'atualizado', label: 'Atualizado em', default: false },
  ],
  patrocinadores: [
    { key: 'contato', label: 'Contato', default: true },
    { key: 'plano', label: 'Plano', default: true },
    { key: 'tipo', label: 'Tipo', default: true },
    { key: 'valor', label: 'Valor', default: true },
    { key: 'briefing', label: 'Briefing', default: true },
    { key: 'responsavel', label: 'Responsável', default: true },
    { key: 'email', label: 'E-mail', default: false },
    { key: 'telefone', label: 'Telefone', default: false },
    { key: 'site', label: 'Site', default: false },
    { key: 'contrato', label: 'Início e fim do contrato', default: false },
    { key: 'etapa_desde', label: 'Na etapa desde', default: false },
    { key: 'criado', label: 'Cadastrado em', default: false },
    { key: 'atualizado', label: 'Atualizado em', default: false },
  ],
  conteudo: [
    { key: 'capa', label: 'Capa', default: true },
    { key: 'tipo', label: 'Tipo e episódio', default: true },
    { key: 'pedido', label: 'Responsável, prazo e prioridade (pedidos)', default: true },
    { key: 'situacao', label: 'Situação e avisos', default: true },
    { key: 'views', label: 'Views', default: true },
    { key: 'redes', label: 'Redes e data em que saiu', default: true },
    { key: 'criado', label: 'Criado em', default: false },
    { key: 'atualizado', label: 'Atualizado em', default: false },
  ],
  cortes: [
    { key: 'capa', label: 'Capa', default: true },
    { key: 'dados', label: 'Categoria, duração e tamanho', default: true },
    { key: 'redes', label: 'Redes e views', default: true },
    { key: 'pedido', label: 'Pedido', default: true },
    { key: 'episodio', label: 'Episódio', default: true },
    { key: 'legenda', label: 'Legenda', default: false },
    { key: 'enviado', label: 'Enviado em', default: false },
    { key: 'atualizado', label: 'Atualizado em', default: false },
  ],
};

// Para a view: a lista e um ajudante que devolve o atributo da parte do cartão (data-cf + hidden quando não é padrão).
function forList(list) {
  const fields = LISTS[list];
  const def = new Set(fields.filter((f) => f.default).map((f) => f.key));
  return { list, fields, attr: (key) => ` data-cf="${key}"${def.has(key) ? '' : ' hidden'}` };
}

module.exports = { LISTS, forList };
