-- Índices das consultas que mais rodam (levantamento de 07/11/2026: estatísticas do banco do ar + consultas por página na suíte).
-- As tabelas ainda são pequenas; os índices seguram o tempo de resposta quando elas crescerem.

-- Publicações: o menu conta "em revisão" em toda página; a rotina de 30 s procura agendadas, enviando e recém-publicadas;
-- a tela dos cortes consulta "enviando ou mexida há 2 min" a cada 4 s; o calendário busca pela data agendada.
CREATE INDEX IF NOT EXISTS episode_publications_status_idx ON episode_publications (status);
CREATE INDEX IF NOT EXISTS episode_publications_updated_idx ON episode_publications (updated_at);
CREATE INDEX IF NOT EXISTS episode_publications_scheduled_idx ON episode_publications (scheduled_at) WHERE scheduled_at IS NOT NULL;
-- Página do corte, lista de cortes do Social (EXISTS por corte) e regras dos cortes.
CREATE INDEX IF NOT EXISTS episode_publications_clip_idx ON episode_publications (clip_id) WHERE clip_id IS NOT NULL;

-- Fila: andamento de cada corte (último trabalho do corte, por linha) e a checagem de "já está na fila" ao enfileirar.
CREATE INDEX IF NOT EXISTS jobs_kind_ref_idx ON jobs (kind, ref_id, id DESC);

-- Quadros e capas de um corte.
CREATE INDEX IF NOT EXISTS episode_frames_clip_idx ON episode_frames (clip_id) WHERE clip_id IS NOT NULL;

-- Tarefas na página do convidado e do patrocinador.
CREATE INDEX IF NOT EXISTS tasks_guest_idx ON tasks (guest_id) WHERE guest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_sponsor_idx ON tasks (sponsor_id) WHERE sponsor_id IS NOT NULL;

-- Lista de episódios: contagem de patrocinadores por episódio (a chave da tabela começa pelo patrocinador).
CREATE INDEX IF NOT EXISTS sponsor_episodes_episode_idx ON sponsor_episodes (episode_id);

-- Gravações no calendário e na sincronização do Google Agenda (a cada minuto) e convites da agenda (a cada minuto).
CREATE INDEX IF NOT EXISTS guests_proposed_idx ON guests (proposed_at) WHERE proposed_at IS NOT NULL;

-- Resultados da plateia: cliques por convidado no período.
CREATE INDEX IF NOT EXISTS plateia_events_guest_idx ON plateia_events (guest_id, type, created_at) WHERE guest_id IS NOT NULL;
