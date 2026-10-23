-- Magic link reutilizável: abrir o link do patrocinador cria uma sessão (cookie) e a URL fica limpa, sem o token.
CREATE TABLE sponsor_sessions (
  id           SERIAL PRIMARY KEY,
  sponsor_id   INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,         -- SHA-256 do cookie (o valor cru nunca fica no banco)
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent   TEXT
);
CREATE INDEX sponsor_sessions_sponsor_idx ON sponsor_sessions (sponsor_id);
