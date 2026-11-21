-- Visualizações salvas dos filtros em todas as listas: Convidados, Episódios, Patrocinadores e as quatro abas de Conteúdo.
ALTER TABLE saved_filters DROP CONSTRAINT IF EXISTS saved_filters_entity_check;
ALTER TABLE saved_filters ADD CONSTRAINT saved_filters_entity_check
  CHECK (entity IN ('guest', 'episode', 'sponsor', 'clip', 'board', 'post', 'request'));
