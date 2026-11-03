-- Reações com emoji nos comentários (dos itens e da revisão do vídeo). Uma linha por pessoa e emoji.
CREATE TABLE comment_reactions (
  id         SERIAL PRIMARY KEY,
  comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  review_id  INTEGER REFERENCES episode_comments(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((comment_id IS NULL) <> (review_id IS NULL))
);
CREATE UNIQUE INDEX comment_reactions_comment_idx ON comment_reactions (comment_id, user_id, emoji) WHERE comment_id IS NOT NULL;
CREATE UNIQUE INDEX comment_reactions_review_idx ON comment_reactions (review_id, user_id, emoji) WHERE review_id IS NOT NULL;

-- Aviso de reação: ligado por padrão; cada pessoa silencia nas Notificações, e a gestão pode desligar para todos.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('tarefa', 'comentario', 'reacao', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete', 'cadencia', 'episodio', 'alteracao', 'exclusao', 'integracao'));
ALTER TABLE notification_settings DROP CONSTRAINT IF EXISTS notification_settings_type_check;
ALTER TABLE notification_settings ADD CONSTRAINT notification_settings_type_check
  CHECK (type IN ('tarefa', 'comentario', 'reacao', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete', 'cadencia', 'episodio', 'alteracao', 'exclusao', 'integracao'));
INSERT INTO notification_settings (type, roles) VALUES ('reacao', '{}') ON CONFLICT DO NOTHING;
