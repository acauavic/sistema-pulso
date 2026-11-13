-- Capas e posts gerados (thumbnails, capas de Reels/TikTok, posts de frase, tela dividida, carrosséis). O spec (JSON) é o que o
-- editor visual mexe; a imagem final é sempre renderizada no servidor com o mesmo motor.
CREATE TABLE episode_covers (
  id          SERIAL PRIMARY KEY,
  episode_id  INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('youtube_thumb','reel_cover','post_quote','post_split','carousel')),
  group_key   TEXT,                                      -- slides do mesmo carrossel
  position    INTEGER NOT NULL DEFAULT 0,
  label       TEXT,
  spec        JSONB NOT NULL,
  ctx         JSONB NOT NULL DEFAULT '{}',               -- rostos e legendas queimadas em pixels (zonas do editor e do verificador)
  lint        JSONB,
  storage_key TEXT NOT NULL,
  mime        TEXT NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  size_bytes  INTEGER NOT NULL,
  approved    BOOLEAN NOT NULL DEFAULT false,
  auto        BOOLEAN NOT NULL DEFAULT true,             -- false = alguém editou
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX episode_covers_idx ON episode_covers (episode_id, kind, position);
ALTER TABLE episode_metadata ADD COLUMN thumb_cover_id INTEGER REFERENCES episode_covers(id) ON DELETE SET NULL;
