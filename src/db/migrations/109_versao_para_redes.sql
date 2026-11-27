-- Versão para as redes: o corte pesado (lado menor acima de 1080 px ou acima de ~12 Mbps) ganha uma cópia em 1080p, H.264 até
-- 10 Mbps, que é a que vai para as redes (o Instagram, o Threads e o X não processam 4K de 500 MB). O original continua sendo o
-- que se baixa. Uma linha por arquivo de origem (o vídeo trocado ganha a dele).
CREATE TABLE IF NOT EXISTS social_renditions (
  id            SERIAL PRIMARY KEY,
  source_key    TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pronto', 'original', 'erro')),
  rendition_key TEXT,
  size_bytes    BIGINT,
  width         INTEGER,
  height        INTEGER,
  source_mbps   NUMERIC(8,2),
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);
