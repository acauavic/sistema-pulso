-- (1) Post feito pela produtora vai para a revisão da gestão antes de sair.
-- (2) Fila e rotinas prontas para mais de um processo: novas tentativas com espera, sinal de vida do worker, rotinas com trava
--     (uma réplica por vez) e limitador de tentativas no banco (deixa o painel rodar com várias réplicas).
-- (3) Assistente de IA com histórico de conversa.

-- (1) aprovação
ALTER TABLE episode_publications DROP CONSTRAINT IF EXISTS episode_publications_status_check;
ALTER TABLE episode_publications ADD CONSTRAINT episode_publications_status_check
  CHECK (status IN ('revisao', 'recusado', 'simulado', 'enviando', 'agendado', 'publicado', 'parcial', 'erro'));
ALTER TABLE episode_publications
  ADD COLUMN reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN review_note TEXT;

-- (2) fila: tentativas, espera entre elas e sinal de vida de quem está rodando
ALTER TABLE jobs
  ADD COLUMN attempts     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN run_after    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN heartbeat_at TIMESTAMPTZ,
  ADD COLUMN worker       TEXT,
  ADD COLUMN created_by   UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX jobs_ready_idx ON jobs (run_after) WHERE status = 'queued';

CREATE TABLE worker_heartbeats (                         -- cada processo que roda a fila ou as rotinas
  worker     TEXT PRIMARY KEY,
  role       TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  info       JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE scheduler_runs (                            -- última execução de cada rotina do sistema
  name        TEXT PRIMARY KEY,
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  ok          BOOLEAN,
  error       TEXT,
  runs        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE rate_hits (                                 -- limitador de tentativas compartilhado entre réplicas
  bucket TEXT NOT NULL,
  key    TEXT NOT NULL,
  at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rate_hits_idx ON rate_hits (bucket, key, at);

-- automações: o item é "reservado" antes de responder (duas réplicas nunca respondem o mesmo comentário)
ALTER TABLE social_events DROP CONSTRAINT IF EXISTS social_events_status_check;
ALTER TABLE social_events ADD CONSTRAINT social_events_status_check CHECK (status IN ('pendente', 'enviado', 'simulado', 'erro', 'ignorado'));

-- (3) assistente
CREATE TABLE assistant_conversations (
  id         SERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'Nova conversa',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assistant_conversations_idx ON assistant_conversations (user_id, updated_at DESC);

CREATE TABLE assistant_messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  meta            JSONB NOT NULL DEFAULT '{}',             -- ferramentas usadas, se veio por áudio, página de onde perguntou
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assistant_messages_idx ON assistant_messages (conversation_id, id);
