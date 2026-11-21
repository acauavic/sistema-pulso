-- Cortes verticais do episódio (sugeridos pela IA ou marcados à mão) e publicações nas redes (Upload-Post).
CREATE TABLE episode_clips (
  id          SERIAL PRIMARY KEY,
  episode_id  INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  caption     TEXT,                                    -- legenda/descrição que vai para as redes
  reason      TEXT,                                    -- por que a IA escolheu este trecho
  cover_texts JSONB NOT NULL DEFAULT '[]',             -- 3 textos de capa sugeridos
  start_ms    INTEGER NOT NULL,
  end_ms      INTEGER NOT NULL,
  source      TEXT NOT NULL DEFAULT 'ia' CHECK (source IN ('ia','manual')),
  status      TEXT NOT NULL DEFAULT 'sugerido' CHECK (status IN ('sugerido','cortando','pronto','erro')),
  error       TEXT,
  storage_key TEXT,
  size_bytes  BIGINT,
  width       INTEGER,
  height      INTEGER,
  duration_ms INTEGER,
  layout      TEXT NOT NULL DEFAULT 'recorte' CHECK (layout IN ('recorte','inteiro')),  -- como o vídeo horizontal vira 9:16
  cover_id    INTEGER,                                 -- capa escolhida (episode_covers)
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_ms > start_ms)
);
CREATE INDEX episode_clips_idx ON episode_clips (episode_id, start_ms);

ALTER TABLE episode_covers ADD COLUMN clip_id INTEGER REFERENCES episode_clips(id) ON DELETE CASCADE;
CREATE INDEX episode_covers_clip_idx ON episode_covers (clip_id) WHERE clip_id IS NOT NULL;
ALTER TABLE episode_clips ADD CONSTRAINT episode_clips_cover_fk FOREIGN KEY (cover_id) REFERENCES episode_covers(id) ON DELETE SET NULL;

-- Quadros dos cortes (capas candidatas) ficam em episode_frames, marcados com o corte de origem.
ALTER TABLE episode_frames ADD COLUMN clip_id INTEGER REFERENCES episode_clips(id) ON DELETE CASCADE;

CREATE TABLE episode_publications (
  id           SERIAL PRIMARY KEY,
  episode_id   INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  clip_id      INTEGER REFERENCES episode_clips(id) ON DELETE SET NULL,
  platforms    TEXT[] NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  options      JSONB NOT NULL DEFAULT '{}',            -- tags, privacidade, capa usada…
  cover_id     INTEGER REFERENCES episode_covers(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'enviando' CHECK (status IN ('simulado','enviando','agendado','publicado','parcial','erro')),
  request_id   TEXT,
  job_id       TEXT,
  results      JSONB NOT NULL DEFAULT '[]',            -- por plataforma: ok, url, erro
  error        TEXT,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX episode_publications_idx ON episode_publications (episode_id, created_at DESC);
