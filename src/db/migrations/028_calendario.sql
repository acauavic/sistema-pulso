-- Calendário: visualizações salvas (combinação de modo, tipos, responsável e "ocultar concluídos"), pessoais ou da equipe.
CREATE TABLE calendar_views (
  id         SERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  config     JSONB NOT NULL,
  shared     BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE INDEX calendar_views_shared_idx ON calendar_views (shared) WHERE shared;
