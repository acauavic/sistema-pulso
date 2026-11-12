-- Duplicatas de convidados e patrocinadores: o sistema compara na hora (services/duplicates.js) e só guarda os pares que alguém
-- marcou como "não é duplicata" (somem do aviso no cadastro e da lista da gestão). Sempre a_id < b_id.
CREATE TABLE duplicate_dismissals (
  kind          TEXT NOT NULL CHECK (kind IN ('guest', 'sponsor')),
  a_id          INTEGER NOT NULL,
  b_id          INTEGER NOT NULL,
  dismissed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  dismissed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, a_id, b_id),
  CHECK (a_id < b_id)
);
