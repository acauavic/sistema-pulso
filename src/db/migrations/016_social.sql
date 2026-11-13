-- Social: publicações de vídeo E de imagem (post, carrossel, story), ideias sugeridas por episódio (com memória do que já
-- foi feito), automações de comentários e directs (estilo ManyChat, via Upload-Post) e fotos diárias dos números das redes.

-- publicações: além do vídeo (episódio/corte), imagens geradas no editor de capas
ALTER TABLE episode_publications
  ADD COLUMN media     TEXT NOT NULL DEFAULT 'video' CHECK (media IN ('video', 'imagem', 'carrossel', 'story')),
  ADD COLUMN cover_ids INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN edited_at TIMESTAMPTZ;

-- ideias: cortes, stories e carrosséis sugeridos para um episódio. fingerprint = título normalizado (não sugerir de novo)
CREATE TABLE social_ideas (
  id          SERIAL PRIMARY KEY,
  episode_id  INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('corte', 'story', 'carrossel')),
  title       TEXT NOT NULL,
  hook        TEXT,
  body        JSONB NOT NULL DEFAULT '{}',              -- trechos (início/fim/frase), slides, legenda
  fingerprint TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'sugerida' CHECK (status IN ('sugerida', 'aprovada', 'feita', 'descartada')),
  task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (episode_id, kind, fingerprint)
);
CREATE INDEX social_ideas_idx ON social_ideas (episode_id, status);

-- automações: gatilho (comentário ou direct) + palavras-chave -> resposta. Nascem pausadas.
CREATE TABLE social_rules (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  trigger       TEXT NOT NULL CHECK (trigger IN ('comentario', 'direct')),
  platform      TEXT NOT NULL DEFAULT 'instagram',
  scope         TEXT NOT NULL DEFAULT 'recentes' CHECK (scope IN ('recentes', 'post')),
  post_url      TEXT,
  keywords      TEXT[] NOT NULL DEFAULT '{}',            -- vazio = qualquer mensagem
  action        TEXT NOT NULL DEFAULT 'dm' CHECK (action IN ('dm', 'resposta', 'ambos')),
  message       TEXT NOT NULL,
  reply_text    TEXT,                                     -- resposta pública (quando a ação inclui "resposta")
  buttons       JSONB NOT NULL DEFAULT '[]',              -- até 3 {title, url}
  active        BOOLEAN NOT NULL DEFAULT false,
  active_since  TIMESTAMPTZ,                              -- só responde o que chegou depois de ativar
  last_run_at   TIMESTAMPTZ,
  last_error    TEXT,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE social_events (                             -- o que cada automação viu e respondeu (nunca responde duas vezes)
  id          SERIAL PRIMARY KEY,
  rule_id     INTEGER NOT NULL REFERENCES social_rules(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  platform    TEXT NOT NULL,
  author      TEXT,
  text        TEXT,
  reply       TEXT,
  status      TEXT NOT NULL CHECK (status IN ('enviado', 'simulado', 'erro', 'ignorado')),
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rule_id, external_id)
);
CREATE INDEX social_events_idx ON social_events (rule_id, created_at DESC);

CREATE TABLE social_snapshots (                          -- números das redes, uma foto por dia e rede
  taken_on   DATE NOT NULL,
  platform   TEXT NOT NULL,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (taken_on, platform)
);
