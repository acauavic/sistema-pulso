-- Categorias de tarefa e tipos de vídeo que a gestão cria (Gestão > Sistema > Categorias; só se desativam, para o histórico não
-- quebrar), rotinas que se repetem (todo dia útil, toda semana, todo mês) criando tarefa ou pedido de conteúdo, e quem entregou cada
-- pedido (a meta "Vídeos entregues" conta a primeira vez que o vídeo foi enviado para revisão).
CREATE TABLE IF NOT EXISTS task_categories (
  key        TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  builtin    BOOLEAN NOT NULL DEFAULT false,
  active     BOOLEAN NOT NULL DEFAULT true,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO task_categories (key, label, builtin, position) VALUES
  ('geral', 'Geral', true, 0), ('cortes', 'Cortes', true, 1), ('qa', 'Q&A', true, 2), ('bastidores', 'Bastidores', true, 3),
  ('extra', 'Conteúdo extra', true, 4), ('outro', 'Outro', true, 5)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS video_types (
  key        TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  builtin    BOOLEAN NOT NULL DEFAULT false,
  active     BOOLEAN NOT NULL DEFAULT true,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO video_types (key, label, builtin, position) VALUES
  ('corte', 'Corte', true, 0), ('cortes', 'Cortes do episódio', true, 1), ('trailer', 'Trailer do canal', true, 2), ('video', 'Vídeo avulso', true, 3),
  ('qa', 'Q&A', true, 4), ('bastidores', 'Bastidores', true, 5), ('extra', 'Conteúdo extra', true, 6), ('outro', 'Outro', true, 7)
ON CONFLICT (key) DO NOTHING;

-- o tipo agora vem dessas tabelas (validado no código)
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_kind_check;
ALTER TABLE task_routines DROP CONSTRAINT IF EXISTS task_routines_kind_check;
ALTER TABLE content_requests DROP CONSTRAINT IF EXISTS content_requests_kind_check;

-- rotinas que se repetem (trigger 'recorrente')
ALTER TABLE task_routines ADD COLUMN IF NOT EXISTS repeat TEXT;
ALTER TABLE task_routines DROP CONSTRAINT IF EXISTS task_routines_repeat_check;
ALTER TABLE task_routines ADD CONSTRAINT task_routines_repeat_check CHECK (repeat IS NULL OR repeat IN ('dia_util', 'semana', 'mes'));
ALTER TABLE task_routines ADD COLUMN IF NOT EXISTS weekdays SMALLINT[];          -- 1 = segunda … 7 = domingo
ALTER TABLE task_routines ADD COLUMN IF NOT EXISTS month_day SMALLINT;           -- 1 a 31 (mês mais curto: o último dia)
ALTER TABLE task_routines ADD COLUMN IF NOT EXISTS due_time TIME;
ALTER TABLE task_routines ADD COLUMN IF NOT EXISTS request_kind TEXT;            -- pedido de conteúdo: o tipo de vídeo
ALTER TABLE task_routines ADD COLUMN IF NOT EXISTS last_run_on DATE;
ALTER TABLE task_routines ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- pedidos: a primeira entrega (envio para revisão) e quem entregou
ALTER TABLE content_requests ADD COLUMN IF NOT EXISTS first_delivered_at TIMESTAMPTZ;
ALTER TABLE content_requests ADD COLUMN IF NOT EXISTS delivered_by UUID REFERENCES users(id) ON DELETE SET NULL;
UPDATE content_requests SET first_delivered_at = delivered_at, delivered_by = assignee_id WHERE delivered_at IS NOT NULL AND first_delivered_at IS NULL;

-- metas: o tipo de vídeo da meta "Vídeos entregues"
ALTER TABLE user_goals ADD COLUMN IF NOT EXISTS param TEXT;
