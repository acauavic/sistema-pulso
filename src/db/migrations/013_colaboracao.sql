-- Colaboração: tarefas para todo o sistema (não só do episódio), rotinas de vencimento, comentários com menção,
-- notificações (com configuração) e a busca global (registro de buscas e atalhos criados pela gestão).

-- ---------------------------------------------------------------- tarefas
ALTER TABLE episode_tasks RENAME TO tasks;
ALTER INDEX IF EXISTS episode_tasks_idx RENAME TO tasks_episode_idx;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS episode_tasks_kind_check;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS episode_tasks_status_check;
ALTER TABLE tasks ALTER COLUMN episode_id DROP NOT NULL;
UPDATE tasks SET status = CASE status WHEN 'pendente' THEN 'a_fazer' WHEN 'em_andamento' THEN 'fazendo' WHEN 'concluida' THEN 'feito' ELSE status END;
ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'a_fazer';
ALTER TABLE tasks
  ADD COLUMN description  TEXT,
  ADD COLUMN guest_id     INTEGER REFERENCES guests(id) ON DELETE CASCADE,
  ADD COLUMN sponsor_id   INTEGER REFERENCES sponsors(id) ON DELETE CASCADE,
  ADD COLUMN block_reason TEXT,
  ADD COLUMN created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN routine_id   INTEGER,
  ADD COLUMN completed_at TIMESTAMPTZ,
  ADD COLUMN updated_at   TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE tasks SET completed_at = created_at WHERE status = 'feito';
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('a_fazer', 'fazendo', 'feito', 'bloqueada'));
ALTER TABLE tasks ADD CONSTRAINT tasks_kind_check CHECK (kind IN ('geral', 'cortes', 'bastidores', 'extra', 'outro'));
ALTER TABLE tasks ADD CONSTRAINT tasks_block_reason_check CHECK (status <> 'bloqueada' OR coalesce(block_reason, '') <> '');
CREATE INDEX tasks_assignee_idx ON tasks (assignee_id, status, due_on);
CREATE INDEX tasks_due_idx ON tasks (due_on) WHERE status <> 'feito';

-- Rotinas: tarefas criadas sozinhas em momentos da produção, com vencimento padrão (sempre alterável na tarefa).
CREATE TABLE task_routines (
  id            SERIAL PRIMARY KEY,
  trigger       TEXT NOT NULL,                       -- 'episodio_criado' ou 'etapa:<etapa do episódio>'
  kind          TEXT NOT NULL DEFAULT 'geral' CHECK (kind IN ('geral', 'cortes', 'bastidores', 'extra', 'outro')),
  title         TEXT NOT NULL,
  description   TEXT,
  anchor        TEXT NOT NULL DEFAULT 'gatilho' CHECK (anchor IN ('gatilho', 'gravacao', 'veiculacao')),
  offset_days   INTEGER NOT NULL DEFAULT 0 CHECK (offset_days BETWEEN -365 AND 365),
  assignee_mode TEXT NOT NULL DEFAULT 'ninguem' CHECK (assignee_mode IN ('ninguem', 'editor', 'responsavel_convidado', 'usuario')),
  assignee_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- as 3 tarefas que já nasciam com o episódio viram rotinas (agora com vencimento padrão)
INSERT INTO task_routines (trigger, kind, title, anchor, offset_days, assignee_mode, position) VALUES
  ('episodio_criado', 'cortes', 'Produzir os cortes do episódio', 'gravacao', 7, 'editor', 1),
  ('episodio_criado', 'bastidores', 'Produzir os bastidores', 'gravacao', 3, 'responsavel_convidado', 2),
  ('episodio_criado', 'extra', 'Conteúdo extra (sinalizar o que for preciso)', 'gravacao', 10, 'ninguem', 3);
ALTER TABLE tasks ADD CONSTRAINT tasks_routine_fk FOREIGN KEY (routine_id) REFERENCES task_routines(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------- comentários
CREATE TABLE comments (
  id          SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('guest', 'sponsor', 'episode', 'task', 'clip')),
  entity_id   INTEGER NOT NULL,
  author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  mentions    UUID[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at   TIMESTAMPTZ
);
CREATE INDEX comments_entity_idx ON comments (entity_type, entity_id, created_at);

-- ---------------------------------------------------------------- notificações
CREATE TABLE notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('tarefa', 'comentario', 'agendamento', 'rotina')),
  title       TEXT NOT NULL,
  body        TEXT,
  url         TEXT,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  dedupe_key  TEXT,
  read_at     TIMESTAMPTZ,
  emailed_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notifications_dedupe_idx ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- Configuração geral (gestão): por tipo, se vai para o painel, se vai por e-mail e quem recebe os avisos gerais.
CREATE TABLE notification_settings (
  type       TEXT PRIMARY KEY CHECK (type IN ('tarefa', 'comentario', 'agendamento', 'rotina')),
  in_app     BOOLEAN NOT NULL DEFAULT true,
  email      BOOLEAN NOT NULL DEFAULT false,
  roles      TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO notification_settings (type, roles) VALUES
  ('tarefa', '{}'), ('comentario', '{}'), ('agendamento', '{superadmin,gestao}'), ('rotina', '{superadmin,gestao}');

-- Preferência de cada pessoa: tipos que ela silenciou.
CREATE TABLE notification_mutes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type    TEXT NOT NULL,
  PRIMARY KEY (user_id, type)
);

-- ---------------------------------------------------------------- busca global
CREATE TABLE search_shortcuts (
  id         SERIAL PRIMARY KEY,
  label      TEXT NOT NULL,
  url        TEXT NOT NULL,
  keywords   TEXT,
  perm       TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE search_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  q          TEXT NOT NULL,
  results    INTEGER NOT NULL,
  picked     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX search_log_q_idx ON search_log (lower(q));
CREATE TABLE search_dismissed (
  key        TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
