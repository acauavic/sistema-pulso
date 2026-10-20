-- Tarefas e comentários com texto rico, anexos (imagens, documentos, áudio com transcrição) e prévia de links.
ALTER TABLE tasks ADD COLUMN description_html TEXT;      -- HTML já limpo (lista branca); description guarda o texto puro (busca, avisos)
ALTER TABLE comments ADD COLUMN body_html TEXT;           -- idem; body é o texto puro (menções, avisos)

CREATE TABLE attachments (
  id           SERIAL PRIMARY KEY,
  entity_type  TEXT CHECK (entity_type IN ('task', 'comment')),   -- nulo = enviado mas ainda não salvo na tarefa/comentário
  entity_id    INTEGER,
  kind         TEXT NOT NULL CHECK (kind IN ('image', 'audio', 'file')),
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL CHECK (size_bytes > 0),
  storage_key  TEXT NOT NULL,
  transcript   TEXT,                                               -- áudio: o que foi dito
  duration_ms  INTEGER,
  uploaded_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((entity_type IS NULL) = (entity_id IS NULL))
);
CREATE INDEX attachments_entity_idx ON attachments (entity_type, entity_id);
CREATE INDEX attachments_loose_idx ON attachments (created_at) WHERE entity_id IS NULL;

CREATE TABLE link_previews (                                       -- miniaturas de links (título, resumo, imagem), com validade
  url         TEXT PRIMARY KEY,
  ok          BOOLEAN NOT NULL,
  title       TEXT,
  description TEXT,
  image       TEXT,
  site        TEXT,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
