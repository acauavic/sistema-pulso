-- Sessão de gravação: o Projeto 100 grava em lote (uma tarde no estúdio, ~10 vídeos). As horas de estúdio são da SESSÃO:
-- cada vídeo leva a parte dele em minutos inteiros que somam a sessão (vai para episodes.recording_minutes, que é o que o
-- custo de estúdio e o banco de horas já leem). Sessão planejada reserva horas no banco.
CREATE TABLE recording_sessions (
  id               SERIAL PRIMARY KEY,
  project_id       INTEGER NOT NULL REFERENCES projects(id),
  starts_at        TIMESTAMPTZ NOT NULL,
  planned_minutes  INTEGER NOT NULL CHECK (planned_minutes > 0 AND planned_minutes <= 1440),
  actual_minutes   INTEGER CHECK (actual_minutes > 0 AND actual_minutes <= 1440),
  place            TEXT,
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'planejada' CHECK (status IN ('planejada', 'encerrada', 'cancelada')),
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at        TIMESTAMPTZ,
  closed_by        UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX recording_sessions_dia_idx ON recording_sessions (starts_at);

ALTER TABLE episodes ADD COLUMN session_id INTEGER REFERENCES recording_sessions(id) ON DELETE SET NULL;
ALTER TABLE episodes ADD COLUMN session_position INTEGER;
ALTER TABLE episodes ADD COLUMN session_note TEXT;          -- "take 3 é o bom"
CREATE INDEX episodes_sessao_idx ON episodes (session_id) WHERE session_id IS NOT NULL;

-- Um link do estúdio por sessão: o estúdio sobe tudo de uma vez. O link fica num vídeo da sessão (o primeiro), e o que chega
-- por ele espera a equipe dizer de qual vídeo é (`session_pending`).
ALTER TABLE episode_upload_links ADD COLUMN session_id INTEGER REFERENCES recording_sessions(id) ON DELETE SET NULL;
ALTER TABLE episode_files ADD COLUMN session_id INTEGER REFERENCES recording_sessions(id) ON DELETE SET NULL;
ALTER TABLE episode_files ADD COLUMN session_pending BOOLEAN NOT NULL DEFAULT false;
