-- Respostas por IA: direct com o link da comunidade (só Instagram, "resposta privada" ao comentário, até 7 dias depois dele)
-- e o convite para seguir o Pulso, que a IA põe em parte das respostas públicas.
ALTER TABLE social_comments ADD COLUMN IF NOT EXISTS author_id TEXT;      -- id de quem comentou na rede (o direct precisa)
ALTER TABLE social_comments ADD COLUMN IF NOT EXISTS invited BOOLEAN NOT NULL DEFAULT false; -- a resposta pública leva o convite para seguir
ALTER TABLE social_comments ADD COLUMN IF NOT EXISTS dm_text TEXT;        -- o direct ({comunidade} vira o link na hora de mandar)
ALTER TABLE social_comments ADD COLUMN IF NOT EXISTS dm_status TEXT
  CHECK (dm_status IN ('proposta', 'aprovada', 'enviada', 'simulada', 'erro', 'pulada'));
ALTER TABLE social_comments ADD COLUMN IF NOT EXISTS dm_sent_at TIMESTAMPTZ;
ALTER TABLE social_comments ADD COLUMN IF NOT EXISTS dm_error TEXT;
CREATE INDEX IF NOT EXISTS social_comments_dm_idx ON social_comments (dm_status) WHERE dm_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS social_comments_author_idx ON social_comments (network, lower(author_username));
