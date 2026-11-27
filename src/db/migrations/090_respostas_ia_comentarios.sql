-- Respostas por IA nos comentários dos posts (Social > Comentários). Um registro por comentário acompanhado: a IA propõe
-- (responder, reagir com emoji, ignorar ou chamar a equipe), alguém aprova (ou o modo automático aprova) e a rotina de envio
-- manda aos poucos pela Outstand. Configuração em app_settings 'respostas_ia'.
CREATE TABLE IF NOT EXISTS social_comments (
  id                BIGSERIAL PRIMARY KEY,
  provider          TEXT NOT NULL DEFAULT 'outstand',
  network           TEXT NOT NULL,
  post_ref          TEXT,              -- post na Outstand
  platform_post_id  TEXT,              -- post na rede
  publication_id    INTEGER REFERENCES episode_publications(id) ON DELETE CASCADE,
  comment_id        TEXT NOT NULL,
  parent_comment_id TEXT,              -- quando é resposta à resposta do Pulso
  author_username   TEXT,
  text              TEXT NOT NULL DEFAULT '',
  commented_at      TIMESTAMPTZ,
  likes             INTEGER NOT NULL DEFAULT 0,
  thread            JSONB NOT NULL DEFAULT '[]'::jsonb, -- a conversa em volta (respostas de outras pessoas, a do Pulso)
  status            TEXT NOT NULL DEFAULT 'nova'
                    CHECK (status IN ('nova', 'proposta', 'equipe', 'aprovada', 'enviada', 'simulada', 'ignorada', 'respondida', 'erro', 'apagada')),
  action            TEXT CHECK (action IN ('responder', 'reagir', 'ignorar', 'equipe')),
  reason            TEXT,
  ai_text           TEXT,              -- o que a IA propôs
  reply_text        TEXT,              -- o que vai (ou foi) para a rede
  confidence        NUMERIC,
  decided_by        UUID REFERENCES users(id) ON DELETE SET NULL, -- nulo = a IA decidiu (modo automático)
  decided_at        TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  reply_id          TEXT,
  error             TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS social_comments_uq ON social_comments (provider, network, comment_id);
CREATE INDEX IF NOT EXISTS social_comments_status_idx ON social_comments (status, created_at);
CREATE INDEX IF NOT EXISTS social_comments_pub_idx ON social_comments (publication_id);

-- A IA cuida dos comentários deste post (desligar tira o post da IA).
ALTER TABLE episode_publications ADD COLUMN IF NOT EXISTS ai_replies BOOLEAN NOT NULL DEFAULT true;

-- Aviso novo: comentários que precisam de alguém e respostas esperando aprovação (gestão e produtora).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('tarefa', 'comentario', 'reacao', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete', 'cadencia', 'episodio', 'alteracao', 'exclusao', 'integracao', 'mensagem', 'site', 'redes'));
ALTER TABLE notification_settings DROP CONSTRAINT IF EXISTS notification_settings_type_check;
ALTER TABLE notification_settings ADD CONSTRAINT notification_settings_type_check CHECK (type IN ('tarefa', 'comentario', 'reacao', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete', 'cadencia', 'episodio', 'alteracao', 'exclusao', 'integracao', 'mensagem', 'site', 'redes'));
INSERT INTO notification_settings (type, roles) VALUES ('redes', '{superadmin,gestao,produtora}') ON CONFLICT DO NOTHING;
