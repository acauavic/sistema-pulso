-- Conteúdos do episódio viram pedidos de conteúdo (e não tarefas com link do Drive): cortes, Q&A, bastidores e conteúdo extra
-- nascem como pedidos quando o episódio é criado (quem cria marca quais quer). A entrega sobe no próprio sistema.
-- Cortes é um pedido contínuo: os cortes chegam aos poucos e cada um já pode ser publicado; o editor conclui quando termina a leva.
ALTER TABLE content_requests DROP CONSTRAINT IF EXISTS content_requests_kind_check;
ALTER TABLE content_requests ADD CONSTRAINT content_requests_kind_check
  CHECK (kind IN ('trailer', 'video', 'corte', 'post', 'carrossel', 'story', 'outro', 'cortes', 'qa', 'bastidores', 'extra'));
ALTER TABLE content_requests ADD COLUMN priority BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE content_requests ADD COLUMN routine_id INTEGER REFERENCES task_routines(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX content_requests_routine_uq ON content_requests (episode_id, routine_id) WHERE routine_id IS NOT NULL AND episode_id IS NOT NULL;

ALTER TABLE task_routines DROP CONSTRAINT IF EXISTS task_routines_kind_check;
ALTER TABLE task_routines ADD CONSTRAINT task_routines_kind_check CHECK (kind IN ('geral', 'cortes', 'bastidores', 'extra', 'outro', 'qa'));
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_kind_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_kind_check CHECK (kind IN ('geral', 'cortes', 'bastidores', 'extra', 'outro', 'qa'));
ALTER TABLE task_routines ADD COLUMN target TEXT NOT NULL DEFAULT 'tarefa' CHECK (target IN ('tarefa', 'pedido'));
ALTER TABLE task_routines ADD COLUMN default_on BOOLEAN NOT NULL DEFAULT true;   -- já vem marcado ao criar o episódio
ALTER TABLE task_routines ADD COLUMN priority BOOLEAN NOT NULL DEFAULT false;    -- pedido prioritário (sai no começo da semana)

-- as rotinas que nasciam com o episódio passam a criar pedidos
UPDATE task_routines SET target = 'pedido', title = 'Cortes do episódio' WHERE trigger = 'episodio_criado' AND kind = 'cortes' AND title = 'Produzir os cortes do episódio';
UPDATE task_routines SET target = 'pedido', title = 'Bastidores', priority = true WHERE trigger = 'episodio_criado' AND kind = 'bastidores' AND title = 'Produzir os bastidores';
UPDATE task_routines SET target = 'pedido', title = 'Conteúdo extra', default_on = false WHERE trigger = 'episodio_criado' AND kind = 'extra' AND title = 'Conteúdo extra (sinalizar o que for preciso)';
INSERT INTO task_routines (trigger, kind, title, anchor, offset_days, assignee_mode, position, target, default_on, priority)
  SELECT 'episodio_criado', 'qa', 'Q&A', 'gravacao', 3, 'editor', 2, 'pedido', true, true
   WHERE NOT EXISTS (SELECT 1 FROM task_routines WHERE trigger = 'episodio_criado' AND kind = 'qa');
