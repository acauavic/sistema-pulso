-- Avisos ao responsável quando um cadastro é alterado ou excluído (configuráveis na gestão e silenciáveis por pessoa)
-- e marca de "editado" nos comentários.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('tarefa', 'comentario', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete', 'cadencia', 'episodio', 'alteracao', 'exclusao'));
ALTER TABLE notification_settings DROP CONSTRAINT IF EXISTS notification_settings_type_check;
ALTER TABLE notification_settings ADD CONSTRAINT notification_settings_type_check
  CHECK (type IN ('tarefa', 'comentario', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete', 'cadencia', 'episodio', 'alteracao', 'exclusao'));
INSERT INTO notification_settings (type, roles) VALUES ('alteracao', '{}'), ('exclusao', '{}') ON CONFLICT DO NOTHING;

ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ; -- já existia desde a 013, nunca preenchida
ALTER TABLE episode_comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
