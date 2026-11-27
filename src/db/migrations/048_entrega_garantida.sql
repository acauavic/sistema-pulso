-- Entrega garantida nas redes: cada tentativa de envio fica registrada (o que foi, por onde, o que cada rede respondeu), a rede
-- que falha por motivo passageiro volta sozinha na hora certa (retry_at) e o vídeo hospedado no provedor é reaproveitado
-- entre tentativas (não depende do Backblaze de novo nem refaz o envio de 80 MB).
ALTER TABLE episode_publications ADD COLUMN retry_at TIMESTAMPTZ;   -- próxima tentativa automática (null = nenhuma marcada)
ALTER TABLE episode_publications ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX episode_publications_retry_idx ON episode_publications (retry_at) WHERE retry_at IS NOT NULL;

CREATE TABLE publication_attempts (
  id             SERIAL PRIMARY KEY,
  publication_id INTEGER NOT NULL REFERENCES episode_publications(id) ON DELETE CASCADE,
  trigger        TEXT NOT NULL,                   -- agora | agendado | aprovado | manual | automatico | retomado
  platforms      TEXT[] NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  media          JSONB,                           -- { source: outstand|b2, bytes, ms, reused }
  refs           JSONB,                           -- [{ provider, request_id }]
  outcome        JSONB,                           -- [{ platform, ok, code, error, retry_at }]
  error          TEXT                             -- falhou antes de chegar às redes (arquivo ilegível, provedor fora)
);
CREATE INDEX publication_attempts_pub_idx ON publication_attempts (publication_id, id DESC);

CREATE TABLE hosted_media (
  storage_key TEXT NOT NULL,
  provider    TEXT NOT NULL,
  url         TEXT NOT NULL,
  media_id    TEXT,
  size_bytes  BIGINT,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (storage_key, provider)
);
