-- Finalização assistida por IA: fila de trabalhos, transcrição, quadros do vídeo e metadados de publicação.
CREATE TABLE jobs (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  episode_id  INTEGER REFERENCES episodes(id) ON DELETE CASCADE,
  ref_id      INTEGER,                                   -- ex.: id do corte
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','error')),
  message     TEXT,                                      -- o que está fazendo agora
  progress    INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error       TEXT,
  payload     JSONB NOT NULL DEFAULT '{}',
  result      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX jobs_queue_idx ON jobs (status, created_at);
CREATE INDEX jobs_episode_idx ON jobs (episode_id, kind, created_at DESC);

CREATE TABLE episode_transcripts (
  episode_id   INTEGER PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  segments     JSONB NOT NULL,                           -- [{start_ms, end_ms, text}]
  language     TEXT,
  duration_ms  INTEGER,
  source_file_id INTEGER REFERENCES episode_files(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE episode_frames (                            -- quadros candidatos (capas, posts)
  id          SERIAL PRIMARY KEY,
  episode_id  INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  at_ms       INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  analysis    JSONB,                                     -- rostos, texto queimado, nitidez, nota (IA de visão)
  score       REAL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX episode_frames_idx ON episode_frames (episode_id, at_ms);

CREATE TABLE episode_metadata (
  episode_id     INTEGER PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
  suggestions    JSONB,                                  -- tudo o que a IA sugeriu (títulos, thumbnails, descrições, citações, momentos)
  yt_title       TEXT,
  yt_description TEXT,
  yt_tags        TEXT,
  sp_title       TEXT,
  sp_description TEXT,
  thumb_text     TEXT,
  thumb_frame_id INTEGER REFERENCES episode_frames(id) ON DELETE SET NULL,
  chapters       TEXT,                                   -- linhas "00:00 Título"
  ai_model       TEXT,
  ai_generated_at TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
