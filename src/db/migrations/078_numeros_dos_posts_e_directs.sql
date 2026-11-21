-- Números de cada post nas redes (views, curtidas, comentários…), lidos do provedor de tempos em tempos. Servem para mostrar o
-- que funcionou no cartão do corte e na publicação, e para a IA de copy aprender com os posts mais vistos.
CREATE TABLE IF NOT EXISTS post_metrics (
  publication_id  INTEGER NOT NULL REFERENCES episode_publications(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,
  views           INTEGER,
  likes           INTEGER,
  comments        INTEGER,
  shares          INTEGER,
  reach           INTEGER,
  engagement_rate NUMERIC,
  url             TEXT,
  published_at    TIMESTAMPTZ,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (publication_id, platform)
);
CREATE INDEX IF NOT EXISTS post_metrics_fetched_idx ON post_metrics (fetched_at);

-- Mensagens recebidas no direct (aviso message.received da Outstand), para a automação "mandou a palavra no direct".
ALTER TABLE social_inbox ADD COLUMN IF NOT EXISTS conversation_id TEXT;
ALTER TABLE social_inbox ADD COLUMN IF NOT EXISTS message_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS social_inbox_message_uq ON social_inbox (provider, message_id) WHERE message_id IS NOT NULL;

-- Piloto automático da semana: as escolhas ficam guardadas (app_settings 'piloto_semana').
