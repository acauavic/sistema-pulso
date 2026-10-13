-- Linha de produção do episódio: etapas, arquivos pesados (Backblaze, upload em partes), checklists padronizados,
-- tarefas, revisão com comentários na minutagem e linha do tempo.
ALTER TABLE episodes DROP CONSTRAINT episodes_status_check;
ALTER TABLE episodes ADD CONSTRAINT episodes_status_check CHECK (status IN
  ('planejado','agendado','gravado','disponivel_edicao','em_edicao','em_revisao','em_finalizacao','pronto_publicar','publicado'));
ALTER TABLE episodes
  ADD COLUMN editor_id    UUID REFERENCES users(id) ON DELETE SET NULL,   -- quem edita
  ADD COLUMN editor_notes TEXT,                                           -- observações da equipe para o editor
  ADD COLUMN youtube_url  TEXT,
  ADD COLUMN spotify_url  TEXT,
  ADD COLUMN published_at TIMESTAMPTZ,
  ADD COLUMN review_round INTEGER NOT NULL DEFAULT 0;                    -- quantas vezes foi para revisão
CREATE UNIQUE INDEX episodes_guest_unique ON episodes (guest_id) WHERE guest_id IS NOT NULL; -- um episódio por convidado

CREATE TABLE episode_files (
  id           SERIAL PRIMARY KEY,
  episode_id   INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('bruto_video','bruto_audio','bastidor','foto','editado','outro')),
  label        TEXT,                                  -- ex.: "Câmera 1", "Áudio da mesa"
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes   BIGINT NOT NULL CHECK (size_bytes >= 0),
  part_size    INTEGER,
  storage_key  TEXT NOT NULL,
  upload_id    TEXT,                                  -- envio em partes em andamento
  status       TEXT NOT NULL DEFAULT 'enviando' CHECK (status IN ('enviando','pronto')),
  version      INTEGER NOT NULL DEFAULT 1,            -- versões do vídeo editado (v1, v2…)
  uploaded_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX episode_files_episode_idx ON episode_files (episode_id, kind);

CREATE TABLE episode_file_parts (
  file_id     INTEGER NOT NULL REFERENCES episode_files(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL,
  etag        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  PRIMARY KEY (file_id, part_number)
);

CREATE TABLE episode_events (
  id         SERIAL PRIMARY KEY,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX episode_events_idx ON episode_events (episode_id, created_at DESC);

CREATE TABLE episode_tasks (
  id          SERIAL PRIMARY KEY,
  episode_id  INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('cortes','bastidores','extra','outro')),
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_andamento','concluida')),
  assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  due_on      DATE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX episode_tasks_idx ON episode_tasks (episode_id);

-- Checklists padronizados (modelos). gate: antes de ir para a revisão ('revisao'), antes de finalizar ('finalizado') ou livre.
CREATE TABLE checklist_templates (
  id       SERIAL PRIMARY KEY,
  name     TEXT NOT NULL,
  gate     TEXT NOT NULL DEFAULT 'revisao' CHECK (gate IN ('revisao','finalizado','livre')),
  required BOOLEAN NOT NULL DEFAULT true,           -- obrigatório para passar pela porta
  active   BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE checklist_template_items (
  id          SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  text        TEXT NOT NULL
);
CREATE INDEX checklist_template_items_idx ON checklist_template_items (template_id, position);

-- Itens de checklist de cada episódio (cópia dos modelos ativos + itens avulsos).
CREATE TABLE episode_checklist_items (
  id          SERIAL PRIMARY KEY,
  episode_id  INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES checklist_templates(id) ON DELETE SET NULL,
  group_name  TEXT NOT NULL,
  gate        TEXT NOT NULL CHECK (gate IN ('revisao','finalizado','livre')),
  required    BOOLEAN NOT NULL DEFAULT true,
  position    INTEGER NOT NULL DEFAULT 0,
  text        TEXT NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT false,
  done_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  done_at     TIMESTAMPTZ
);
CREATE INDEX episode_checklist_idx ON episode_checklist_items (episode_id, gate);

-- Revisão: comentários no vídeo, na minutagem.
CREATE TABLE episode_comments (
  id          SERIAL PRIMARY KEY,
  episode_id  INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  file_id     INTEGER REFERENCES episode_files(id) ON DELETE CASCADE,   -- a versão do vídeo comentada
  at_ms       INTEGER CHECK (at_ms >= 0),                              -- minutagem (null = comentário geral)
  body        TEXT NOT NULL,
  author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved    BOOLEAN NOT NULL DEFAULT false,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX episode_comments_idx ON episode_comments (episode_id, file_id, at_ms);

-- Modelos de checklist de fábrica (editáveis na tela de checklists).
WITH t AS (
  INSERT INTO checklist_templates (name, gate, required, position) VALUES
    ('Edição — antes da revisão', 'revisao', true, 1),
    ('Finalização — antes de publicar', 'finalizado', true, 2)
  RETURNING id, gate
)
INSERT INTO checklist_template_items (template_id, position, text)
SELECT t.id, i.position, i.text FROM t JOIN (VALUES
  ('revisao', 1, 'Áudio equalizado e normalizado (volume uniforme entre as vozes)'),
  ('revisao', 2, 'Cortes de gaguejos, pausas longas e trechos fora do tema'),
  ('revisao', 3, 'Moldura do patrocinador aplicada'),
  ('revisao', 4, 'QR Code do patrocinador inserido no momento combinado'),
  ('revisao', 5, 'Inserção de patrocinador no tempo certo'),
  ('revisao', 6, 'Nome e cargo do convidado conferidos (grafia)'),
  ('revisao', 7, 'Exportação final em 1080p ou 4K, H.264 e AAC'),
  ('finalizado', 1, 'Todos os comentários da revisão resolvidos'),
  ('finalizado', 2, 'Título e descrição aprovados'),
  ('finalizado', 3, 'Thumbnail aprovada'),
  ('finalizado', 4, 'Capítulos conferidos'),
  ('finalizado', 5, 'Links dos patrocinadores na descrição'),
  ('finalizado', 6, 'Cortes principais liberados')
) AS i(gate, position, text) ON i.gate = t.gate;
