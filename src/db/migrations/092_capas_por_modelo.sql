-- Capas por modelo (Guia de peças do episódio): a ficha do episódio e do corte, o modelo e o ângulo de cada capa, e a capa do Spotify.
ALTER TABLE episode_metadata ADD COLUMN IF NOT EXISTS cover_sheet JSONB;   -- ficha: credencial, eixo, 3 ângulos, frase literal, chamada do Spotify
ALTER TABLE episode_clips ADD COLUMN IF NOT EXISTS cover_sheet JSONB;      -- ficha do corte: gancho, apoio, frase
ALTER TABLE episode_covers ADD COLUMN IF NOT EXISTS model TEXT;            -- YT-A … RL-C (NULL = capa de antes dos modelos ou feita no editor livre)
ALTER TABLE episode_covers ADD COLUMN IF NOT EXISTS angle TEXT CHECK (angle IN ('curiosidade', 'contraste', 'autoridade'));
ALTER TABLE episode_covers ADD COLUMN IF NOT EXISTS stale BOOLEAN NOT NULL DEFAULT false; -- a ficha mudou depois que alguém aprovou esta capa
ALTER TABLE episode_covers DROP CONSTRAINT IF EXISTS episode_covers_kind_check;
ALTER TABLE episode_covers ADD CONSTRAINT episode_covers_kind_check CHECK (kind IN ('youtube_thumb', 'reel_cover', 'post_quote', 'post_split', 'carousel', 'entrega', 'spotify_cover'));

-- Vídeos do convidado (guia de peças, seção 07): o story de lançamento (11 s) e o teaser para público frio (15 s). Um de cada por episódio.
CREATE TABLE IF NOT EXISTS episode_teasers (
  id          SERIAL PRIMARY KEY,
  episode_id  INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('story', 'teaser')),
  status      TEXT NOT NULL DEFAULT 'fila' CHECK (status IN ('fila', 'gerando', 'pronto', 'erro')),
  error       TEXT,
  inputs      JSONB NOT NULL DEFAULT '{}',   -- o que entrou no vídeo: textos, foto, tempo da frase, se a legenda seguiu a fala
  storage_key TEXT,
  poster_key  TEXT,
  size_bytes  BIGINT,
  duration_ms INTEGER,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (episode_id, kind)
);
