-- Capas por modelo (Guia de peças do episódio): a ficha do episódio e do corte, o modelo e o ângulo de cada capa, e a capa do Spotify.
ALTER TABLE episode_metadata ADD COLUMN IF NOT EXISTS cover_sheet JSONB;   -- ficha: credencial, eixo, 3 ângulos, frase literal, chamada do Spotify
ALTER TABLE episode_clips ADD COLUMN IF NOT EXISTS cover_sheet JSONB;      -- ficha do corte: gancho, apoio, frase
ALTER TABLE episode_covers ADD COLUMN IF NOT EXISTS model TEXT;            -- YT-A … RL-C (NULL = capa de antes dos modelos ou feita no editor livre)
ALTER TABLE episode_covers ADD COLUMN IF NOT EXISTS angle TEXT CHECK (angle IN ('curiosidade', 'contraste', 'autoridade'));
ALTER TABLE episode_covers ADD COLUMN IF NOT EXISTS stale BOOLEAN NOT NULL DEFAULT false; -- a ficha mudou depois que alguém aprovou esta capa
ALTER TABLE episode_covers DROP CONSTRAINT IF EXISTS episode_covers_kind_check;
ALTER TABLE episode_covers ADD CONSTRAINT episode_covers_kind_check CHECK (kind IN ('youtube_thumb', 'reel_cover', 'post_quote', 'post_split', 'carousel', 'entrega', 'spotify_cover'));
