-- Automação de comentário → direct ligada à publicação (individual ou em massa): quem comentar a palavra no post recebe o link
-- no direct. Pela Outstand, o comentário chega por webhook (social_inbox) e a resposta sai como "private reply" do Instagram.
ALTER TABLE social_rules ADD COLUMN IF NOT EXISTS publication_id INTEGER REFERENCES episode_publications(id) ON DELETE CASCADE;
ALTER TABLE social_rules ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'uploadpost';
ALTER TABLE social_rules ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE social_rules DROP CONSTRAINT IF EXISTS social_rules_scope_check;
ALTER TABLE social_rules ADD CONSTRAINT social_rules_scope_check CHECK (scope IN ('recentes', 'post', 'publicacao'));
CREATE INDEX IF NOT EXISTS social_rules_publication_idx ON social_rules (publication_id);

-- Avisos que chegam da Outstand (comentários). Um por comentário: a Outstand pode mandar o mesmo aviso mais de uma vez.
CREATE TABLE IF NOT EXISTS social_inbox (
  id                BIGSERIAL PRIMARY KEY,
  provider          TEXT NOT NULL,
  event             TEXT NOT NULL,
  network           TEXT,
  account_id        TEXT,
  post_ref          TEXT,          -- post na Outstand (null se não saiu pela Outstand)
  platform_post_id  TEXT,          -- id do post na rede
  comment_id        TEXT,
  parent_comment_id TEXT,
  author_id         TEXT,
  author_username   TEXT,
  text              TEXT,
  payload           JSONB NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  result            TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS social_inbox_comment_uq ON social_inbox (provider, account_id, comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS social_inbox_received_idx ON social_inbox (received_at DESC);
