-- Vídeo e pauta: o episódio vira o caso "podcast" de uma coisa mais geral, o vídeo. Numeração por projeto, uma etapa antes da
-- gravação (Pré-produção) e a pauta/roteiro acompanhados até a aprovação, que acontece no WhatsApp (fora do sistema).

-- formato: o que já existe é podcast; o projeto diz o padrão do que nasce daqui em diante
ALTER TABLE episodes ADD COLUMN format TEXT NOT NULL DEFAULT 'podcast' CHECK (format IN ('podcast', 'video'));

-- numeração por projeto: EP.012 no Pulso e V.003 no Projeto 100 convivem
ALTER TABLE episodes DROP CONSTRAINT episodes_number_key;
ALTER TABLE episodes ADD CONSTRAINT episodes_project_number_key UNIQUE (project_id, number);

-- etapa nova no começo: o vídeo criado à mão nasce aqui (o episódio que vem do convidado continua nascendo em Gravado)
ALTER TABLE episodes DROP CONSTRAINT episodes_status_check;
ALTER TABLE episodes ADD CONSTRAINT episodes_status_check CHECK (status IN
  ('pre_producao','gravado','disponivel_edicao','em_edicao','em_revisao','em_finalizacao','pronto_publicar','publicado'));

-- Pauta (temas e perguntas) e roteiro (o texto do vídeo): um documento por vídeo, ou por participação do convidado enquanto o
-- episódio não existe. O conteúdo fica aqui (editor rico) ou num link (Google Docs).
CREATE TABLE pautas (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  episode_id  INTEGER REFERENCES episodes(id) ON DELETE CASCADE,
  guest_id    INTEGER REFERENCES guests(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('pauta', 'roteiro')),
  body        TEXT,                                   -- texto puro (busca e "Copiar para o WhatsApp")
  body_html   TEXT,                                   -- HTML já limpo (editor rico)
  link        TEXT,                                   -- quando o documento mora fora (Google Docs)
  owner_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  due_on      DATE,
  state       TEXT NOT NULL DEFAULT 'a_fazer' CHECK (state IN ('a_fazer', 'elaboracao', 'aprovacao', 'ajustes', 'aprovada')),
  sent_at     TIMESTAMPTZ,                            -- quando foi para o WhatsApp
  sent_to     TEXT,                                   -- para quem ("Grupo Projeto 100")
  approved_by TEXT,                                   -- quem aprovou, em texto (está fora do sistema)
  review_note TEXT,                                   -- o que pediram para ajustar
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pautas_dono_check CHECK (episode_id IS NOT NULL OR guest_id IS NOT NULL)
);
CREATE UNIQUE INDEX pautas_episode_kind_key ON pautas (episode_id, kind) WHERE episode_id IS NOT NULL;
CREATE UNIQUE INDEX pautas_guest_kind_key ON pautas (guest_id, kind) WHERE guest_id IS NOT NULL;
CREATE INDEX pautas_project_idx ON pautas (project_id);
CREATE INDEX pautas_state_idx ON pautas (state);

-- o que aconteceu com a pauta: escreveu, mandou, aprovaram, pediram ajustes
CREATE TABLE pauta_events (
  id         SERIAL PRIMARY KEY,
  pauta_id   INTEGER NOT NULL REFERENCES pautas(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pauta_events_pauta_idx ON pauta_events (pauta_id, created_at DESC);
