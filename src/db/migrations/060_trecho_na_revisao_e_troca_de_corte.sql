-- Revisão do vídeo: o comentário pode marcar um trecho (at_ms até end_ms), e não só um ponto.
ALTER TABLE episode_comments ADD COLUMN end_ms INTEGER;
ALTER TABLE episode_comments ADD CONSTRAINT episode_comments_trecho_check CHECK (end_ms IS NULL OR (at_ms IS NOT NULL AND end_ms > at_ms));

-- Corte: o vídeo pode ser trocado enquanto não foi publicado. A linha do corte guarda a versão atual; as anteriores ficam aqui.
ALTER TABLE episode_clips ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE episode_clips ADD COLUMN video_by UUID REFERENCES users(id) ON DELETE SET NULL; -- quem subiu a versão atual (vazio = quem criou o corte)
CREATE TABLE clip_versions (
  id           SERIAL PRIMARY KEY,
  clip_id      INTEGER NOT NULL REFERENCES episode_clips(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  storage_key  TEXT NOT NULL,
  filename     TEXT,
  content_type TEXT,
  size_bytes   BIGINT,
  duration_ms  INTEGER,
  width        INTEGER,
  height       INTEGER,
  uploaded_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  replaced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clip_id, version)
);
-- A troca em andamento: o vídeo atual continua valendo até o envio terminar. As partes usam clip_upload_parts, como no primeiro envio.
CREATE TABLE clip_replacements (
  id           SERIAL PRIMARY KEY,
  clip_id      INTEGER NOT NULL UNIQUE REFERENCES episode_clips(id) ON DELETE CASCADE,
  storage_key  TEXT NOT NULL,
  upload_id    TEXT NOT NULL,
  filename     TEXT,
  content_type TEXT,
  part_size    INTEGER NOT NULL,
  size_bytes   BIGINT NOT NULL,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
